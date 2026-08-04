"use client";

import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { baseSepolia } from "viem/chains";
import { privyConfig, PRIVY_APP_ID } from "@/config/privy";
import { PrivyWalletBridge } from "./PrivyWalletBridge";

const queryClient = new QueryClient();

// Privy provider stack. Order matters: PrivyProvider → QueryClientProvider →
// WagmiProvider (from @privy-io/wagmi, NOT plain wagmi) → bridge. Only mounted
// when NEXT_PUBLIC_WALLET_PROVIDER=privy.
export default function PrivyStack({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) {
    throw new Error(
      "NEXT_PUBLIC_WALLET_PROVIDER=privy but NEXT_PUBLIC_PRIVY_APP_ID is unset. " +
        "Create an app at dashboard.privy.io and set the id.",
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["google", "apple", "twitter", "email", "wallet"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia],
        appearance: { theme: "dark" },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={privyConfig}>
          <PrivyWalletBridge>{children}</PrivyWalletBridge>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
