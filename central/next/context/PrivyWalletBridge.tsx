"use client";

import { type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount, useChainId } from "wagmi";
import { WalletContext, type WalletApi } from "@/lib/wallet/context";

// Relays Privy into the provider-agnostic WalletContext. Wallet STATE comes from
// wagmi (Privy feeds the wagmi config via @privy-io/wagmi, so useAccount/
// useChainId reflect the embedded or connected wallet); the login/logout ACTIONS
// come from Privy. Mounted only under the Privy stack.
export function PrivyWalletBridge({ children }: { children: ReactNode }) {
  const { login, logout, authenticated, ready } = usePrivy();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const api: WalletApi = {
    address,
    // Gate on Privy auth so we don't report "connected" before login resolves.
    isConnected: ready && authenticated && isConnected,
    chainId,
    login: () => login(),
    logout: () => logout(),
    // Privy has no single "account modal" like Reown; the app's AccountManager
    // drawer already renders the address + a logout affordance, so re-invoking
    // login() is a reasonable best-effort for the openAccount slot.
    openAccount: () => login(),
  };

  return <WalletContext.Provider value={api}>{children}</WalletContext.Provider>;
}
