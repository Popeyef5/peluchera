import { cookieStorage, createStorage, http } from "wagmi";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { mainnet, arbitrum, baseSepolia } from "@reown/appkit/networks";
import { WALLET_PROVIDER } from "@/lib/wallet/provider";
import { privyConfig } from "./privy";

// Get projectId from https://cloud.reown.com
export const projectId =
  process.env.NEXT_PUBLIC_PROJECT_ID || "b56e18d47c72ab683b10814fe9495694"; // this is a public projectId only to use on localhost

if (!projectId) {
  throw new Error("Project ID is not defined");
}

export const networks = [baseSepolia];

//Set up the Wagmi Adapter (Config)
export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  projectId,
  networks,
});

// The ACTIVE wagmi config the app transacts against (writeContract, etc.).
// Must match whichever provider stack is mounted, so branch on the same flag.
// Importing privyConfig here is a harmless object build; the heavy provider
// side effects live in the stack components, not the config.
export const config =
  WALLET_PROVIDER === "privy" ? privyConfig : wagmiAdapter.wagmiConfig;
