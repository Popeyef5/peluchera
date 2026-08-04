"use client";

import React, { type ReactNode } from "react";
import type { WalletProviderKind } from "@/lib/wallet/provider";
import ReownStack from "./reown";
import PrivyStack from "./privy";

// Wallet-provider switch. `walletProvider` comes from the server (app/layout.tsx
// reads WALLET_PROVIDER and passes it in), so flipping it is a restart, not a
// rebuild. Each stack mounts its own provider tree + bridge, and the whole app
// reads wallet state through useWallet() regardless.
function ContextProvider({
  children,
  cookies,
  walletProvider,
}: {
  children: ReactNode;
  cookies: string | null;
  walletProvider: WalletProviderKind;
}) {
  if (walletProvider === "privy") {
    return <PrivyStack>{children}</PrivyStack>;
  }
  return <ReownStack cookies={cookies}>{children}</ReownStack>;
}

export default ContextProvider;
