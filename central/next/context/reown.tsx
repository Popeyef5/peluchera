"use client";

import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { baseSepolia } from "@reown/appkit/networks";
import { cookieToInitialState, WagmiProvider, type Config } from "wagmi";
import { wagmiAdapter, projectId } from "@/config";
import { ReownWalletBridge } from "./ReownWalletBridge";

const queryClient = new QueryClient();

const metadata = {
  name: "Claw",
  description: "Claw Example",
  url: "https://cryptoclaw.xyz", // origin must match your Reown dashboard domain
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
};

// createAppKit is a global singleton side effect. With the runtime selector this
// module is statically imported even when Privy is active, so we must NOT run it
// at module load — only lazily, the first time ReownStack actually mounts (i.e.
// Reown was selected). Guarded so it runs exactly once. It executes at the top of
// ReownStack's render, before the Wagmi/bridge children, so the Reown hooks in
// ReownWalletBridge find the initialized modal.
let appKitInited = false;
function ensureAppKit() {
  if (appKitInited) return;
  appKitInited = true;
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
  ensureAppKit();
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
