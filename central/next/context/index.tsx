"use client";

import React, { type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { WalletProviderKind } from "@/lib/wallet/provider";

// Lazy-load each stack so only the ACTIVE provider's code (Reown or Privy) is
// compiled/bundled per session — the other's heavy deps (@reown/appkit vs
// @privy-io/*) aren't pulled into the route. Both are still in the build, so a
// runtime WALLET_PROVIDER swap + restart works without a rebuild. ssr stays on so
// the provider tree still server-renders (wagmi cookie hydration, no flash).
const ReownStack = dynamic(() => import("./reown"));
const PrivyStack = dynamic(() => import("./privy"));

// Wallet-provider switch. `walletProvider` comes from the server (app/layout.tsx
// reads WALLET_PROVIDER and passes it in), so flipping it is a restart, not a
// rebuild. The whole app reads wallet state through useWallet() regardless.
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
