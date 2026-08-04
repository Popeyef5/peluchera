"use client";

import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { baseSepolia } from "@reown/appkit/networks";
import { cookieToInitialState, WagmiProvider, type Config } from "wagmi";
import { wagmiAdapter, projectId } from "@/config";
import { WALLET_PROVIDER } from "@/lib/wallet/provider";
import { ReownWalletBridge } from "./ReownWalletBridge";

const queryClient = new QueryClient();

const metadata = {
  name: "Claw",
  description: "Claw Example",
  url: "https://cryptoclaw.xyz", // origin must match your Reown dashboard domain
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
};

// createAppKit is a global singleton side effect. Guard it on the flag so that
// when the app is built for Privy this module (statically imported by the switch)
// doesn't spin up WalletConnect. When it IS Reown, this runs once at module load,
// exactly as before.
if (WALLET_PROVIDER === "reown") {
  if (!projectId) throw new Error("Project ID is not defined");
  createAppKit({
    adapters: [wagmiAdapter],
    projectId,
    networks: [baseSepolia],
    defaultNetwork: baseSepolia,
    metadata,
    featuredWalletIds: [
      "fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa",
    ],
    features: {
      analytics: false,
      // Embedded-wallet login for non-crypto users — email/social provisions a
      // self-custodial smart account (the player's identity + payout address).
      // Requires email/socials enabled for this projectId in the Reown dashboard
      // and the dashboard domain matching metadata.url.
      email: true,
      socials: ["google", "apple", "x"],
      emailShowWallets: true,
    },
  });
}

export default function ReownStack({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const initialState = cookieToInitialState(
    wagmiAdapter.wagmiConfig as Config,
    cookies,
  );

  return (
    <WagmiProvider
      config={wagmiAdapter.wagmiConfig as Config}
      initialState={initialState}
    >
      <QueryClientProvider client={queryClient}>
        <ReownWalletBridge>{children}</ReownWalletBridge>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
