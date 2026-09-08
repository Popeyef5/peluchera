import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    optimizePackageImports: ["@chakra-ui/react", "@react-three/drei"],
  },
  webpack: (config, { webpack, dev }) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");

    // DEV ONLY: don't compile the wallet stack we aren't using.
    //
    // Both stacks ship so WALLET_PROVIDER can be flipped with a restart rather
    // than a rebuild (see context/index.tsx). next/dynamic with ssr:false
    // controls RENDERING, not compilation — the import is statically
    // analyzable, so webpack builds the chunk regardless. Measured: the Privy
    // chunk alone is 18MB and 4.6k module references, built on every cold
    // compile while Reown is selected and Privy is never rendered.
    //
    // Prod keeps both, so the runtime swap still works there.
    if (dev) {
      const unusedWalletStack =
        process.env.WALLET_PROVIDER === "privy" ? /^@reown\// : /^@privy-io\//;
      config.plugins.push(
        new webpack.IgnorePlugin({ resourceRegExp: unusedWalletStack }),
      );
    }
    // Privy declares cross-chain integrations as OPTIONAL peers (Solana,
    // Farcaster mini-apps, Abstract, ERC-4337 via `permissionless`). We're
    // Ethereum/Base-only and don't install them, so webpack fails to bundle
    // those code paths with "Module not found". IgnorePlugin resolves the whole
    // set to empty modules — safe because our Ethereum-only usage never hits the
    // Solana/Farcaster paths — which also fixes `next build` and skips compiling
    // that dead code.
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp:
          /^(@abstract-foundation\/agw-client|@farcaster\/mini-app-solana|@solana\/kit|@solana-program\/(system|token|memo)|permissionless)$/,
      }),
    );
    return config;
  },
  /* config options here */
};

export default nextConfig;
