// The player's proven session, kept in the browser so a returning player is
// signed in without signing again.
//
// The server issues the token after verifying a SIWX signature (auth_verify)
// and the socket refuses any wallet_connected whose token doesn't name the same
// address. Losing it only costs a fresh signature prompt.

export const PLAYER_SESSION_EVENT = "garra:player-session";

const PREFIX = "garra:player-session:";
// Treat a token as expired a minute early, so it can't lapse mid-handshake.
const EXPIRY_MARGIN_MS = 60_000;

export type StoredPlayerSession<S = unknown> = {
  token: string;
  expiresAt: number; // unix seconds
  address: string;
  chainId: string; // CAIP-2, e.g. "eip155:84532"
  session: S;
};

function key(address: string) {
  return PREFIX + address.toLowerCase();
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // storage blocked (private mode, site data disabled)
  }
}

export function readPlayerSession<S = unknown>(address: string): StoredPlayerSession<S> | null {
  const raw = storage()?.getItem(key(address));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredPlayerSession<S>;
    if (parsed.expiresAt * 1000 - EXPIRY_MARGIN_MS <= Date.now()) {
      storage()?.removeItem(key(address));
      return null;
    }
    return parsed;
  } catch {
    storage()?.removeItem(key(address));
    return null;
  }
}

export function readPlayerToken(address: string): string | null {
  return readPlayerSession(address)?.token ?? null;
}

export function writePlayerSession<S>(value: StoredPlayerSession<S>) {
  storage()?.setItem(key(value.address), JSON.stringify(value));
  notifyPlayerSession();
}

export function clearPlayerSession(address: string) {
  storage()?.removeItem(key(address));
  notifyPlayerSession();
}

export function clearAllPlayerSessions() {
  const s = storage();
  if (!s) return;
  for (let i = s.length - 1; i >= 0; i--) {
    const k = s.key(i);
    if (k?.startsWith(PREFIX)) s.removeItem(k);
  }
  notifyPlayerSession();
}

function notifyPlayerSession() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PLAYER_SESSION_EVENT));
}
