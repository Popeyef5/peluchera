import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    optimizePackageImports: ["@chakra-ui/react"],
  },
  webpack: (config, { webpack }) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
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
