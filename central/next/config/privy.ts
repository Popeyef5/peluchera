import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { baseSepolia } from "viem/chains";

// wagmi config for the Privy stack. @privy-io/wagmi's createConfig wires Privy's
// embedded/connected wallets in as the wagmi connector, so the app's existing
// wagmi/viem calls (writeContract, waitForTransactionReceipt) work unchanged.
export const privyConfig = createConfig({
  chains: [baseSepolia],
  transports: {
    [baseSepolia.id]: http(),
  },
});

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";
