"use client";

import React, { type ReactNode } from "react";
import { WALLET_PROVIDER } from "@/lib/wallet/provider";
import ReownStack from "./reown";
import PrivyStack from "./privy";

// Wallet-provider switch. Picks the Reown or Privy stack from the build-time
// NEXT_PUBLIC_WALLET_PROVIDER flag. Each stack mounts its own provider tree +
// bridge, and the whole app reads wallet state through useWallet() regardless.
function ContextProvider({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  if (WALLET_PROVIDER === "privy") {
    return <PrivyStack>{children}</PrivyStack>;
  }
  return <ReownStack cookies={cookies}>{children}</ReownStack>;
}

export default ContextProvider;
