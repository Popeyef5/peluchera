"use client";

import { type ReactNode } from "react";
import {
  useAppKit,
  useAppKitAccount,
  useAppKitNetwork,
} from "@reown/appkit/react";
import { useDisconnect } from "wagmi";
import { WalletContext, type WalletApi } from "@/lib/wallet/context";

// Relays Reown's own hooks into the provider-agnostic WalletContext. Uses the
// EXACT hooks the app used before the abstraction (useAppKitAccount /
// useAppKitNetwork / useAppKit), so the Reown path is behaviour-identical.
// Mounted only under the Reown stack (after createAppKit()).
export function ReownWalletBridge({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAppKitAccount();
  const { chainId } = useAppKitNetwork();
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();

  const api: WalletApi = {
    address: address as `0x${string}` | undefined,
    isConnected,
    chainId: chainId == null ? undefined : Number(chainId),
    login: () => open(),
    logout: () => disconnect(),
    openAccount: () => open({ view: "Account" }),
  };

  return <WalletContext.Provider value={api}>{children}</WalletContext.Provider>;
}
