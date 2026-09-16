"use client";

// Reown SIWX: the player proves they control their wallet before the server
// trusts the address.
//
// Without this the backend accepted whatever address the browser reported, so
// anyone could act as any player. Now:
//   createMessage  asks the server for a single-use nonce and builds an
//                  EIP-4361 "Sign-In with Ethereum" message around it;
//   addSession     sends the signed message to the server, which verifies it
//                  (including smart-account signatures) and returns a token;
//   getSessions    lets a returning player skip the prompt while their stored
//                  token is still accepted by the server.
// ClawProvider then sends the token with wallet_connected.
//
// Two AppKit paths call into this: the ordinary one signs our own message; the
// WalletConnect one-click path has the wallet format the message and hands us
// the results through setSessions. The server parses both.

import type { createAppKit } from "@reown/appkit/react";
import { getAddress } from "viem";
import { getSocket } from "@/components/providers/SocketProvider";
import {
  clearAllPlayerSessions,
  clearPlayerSession,
  readPlayerSession,
  writePlayerSession,
} from "./playerSession";

// Derived from createAppKit itself: AppKit 1.7.2 doesn't export these types,
// and this way they can't drift from the installed version.
type SIWXConfig = NonNullable<Parameters<typeof createAppKit>[0]["siwx"]>;
type SIWXSession = Parameters<SIWXConfig["addSession"]>[0];
type SIWXInput = Parameters<SIWXConfig["createMessage"]>[0];
type SIWXMessage = Awaited<ReturnType<SIWXConfig["createMessage"]>>;
type SIWXData = Omit<SIWXMessage, "toString">;

const STATEMENT = "Sign in to Garra to play and claim your prizes.";
// How long the player has to approve the prompt. The session itself lasts
// 30 days and is set by the server.
const MESSAGE_TTL_MS = 10 * 60 * 1000;
const ACK_TIMEOUT_MS = 20_000;

type Ack = { status: string; error?: string; [k: string]: unknown };

function ask(event: string, payload?: unknown): Promise<Ack> {
  return getSocket().timeout(ACK_TIMEOUT_MS).emitWithAck(event, payload) as Promise<Ack>;
}

function formatMessage(d: SIWXData): string {
  const chain = d.chainId.split(":")[1];
  const lines = [
    `${d.domain} wants you to sign in with your Ethereum account:`,
    getAddress(d.accountAddress),
    "",
    d.statement ?? STATEMENT,
    "",
    `URI: ${d.uri}`,
    `Version: ${d.version}`,
    `Chain ID: ${chain}`,
    `Nonce: ${d.nonce}`,
    `Issued At: ${d.issuedAt}`,
  ];
  if (d.expirationTime) lines.push(`Expiration Time: ${d.expirationTime}`);
  if (d.notBefore) lines.push(`Not Before: ${d.notBefore}`);
  return lines.join("\n");
}

async function verifyAndStore(session: SIWXSession) {
  const res = await ask("auth_verify", {
    message: session.message,
    signature: session.signature,
  });
  if (res.status !== "ok") {
    throw new Error(res.error || "Sign-in could not be verified.");
  }
  writePlayerSession({
    token: String(res.token),
    expiresAt: Number(res.expires_at),
    address: String(res.address),
    chainId: session.data.chainId,
    session,
  });
}

export function createGarraSiwx(): SIWXConfig {
  return {
    async createMessage(input: SIWXInput): Promise<SIWXMessage> {
      const res = await ask("auth_nonce");
      if (res.status !== "ok" || !res.nonce) {
        throw new Error("Could not start sign-in. Check your connection and try again.");
      }
      const now = Date.now();
      const data: SIWXData = {
        accountAddress: input.accountAddress,
        chainId: input.chainId,
        notBefore: input.notBefore,
        domain: window.location.host,
        uri: window.location.origin,
        version: "1",
        nonce: String(res.nonce),
        statement: STATEMENT,
        issuedAt: new Date(now).toISOString(),
        expirationTime: new Date(now + MESSAGE_TTL_MS).toISOString(),
      };
      return { ...data, toString: () => formatMessage(data) };
    },

    async addSession(session) {
      await verifyAndStore(session);
    },

    async setSessions(sessions) {
      clearAllPlayerSessions();
      // One-click auth can return one signature per chain, all carrying the
      // same single-use nonce. The server honours a nonce once, so verify the
      // first and skip repeats rather than failing the whole sign-in.
      const seen = new Set<string>();
      for (const session of sessions) {
        if (seen.has(session.data.nonce)) continue;
        seen.add(session.data.nonce);
        await verifyAndStore(session);
      }
    },

    async getSessions(chainId, address) {
      const stored = readPlayerSession<SIWXSession>(address);
      if (!stored || stored.chainId !== chainId) return [];
      // Confirm the server still accepts it, so a dead token prompts a fresh
      // sign-in instead of leaving the player refused on every action.
      try {
        const res = await ask("auth_check", { token: stored.token, address });
        if (res.status === "ok") return [stored.session];
      } catch {
        // Unreachable server: keep the session; the socket re-checks it anyway.
        return [stored.session];
      }
      clearPlayerSession(address);
      return [];
    },

    async revokeSession(_chainId, address) {
      clearPlayerSession(address);
    },

    // Refusing to sign disconnects the wallet. A connected but unproven wallet
    // would look signed in while the server refuses everything it does.
    getRequired: () => true,
  };
}
