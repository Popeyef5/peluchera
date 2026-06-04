import type { NextConfig } from "next";

// Standalone output keeps the prod Docker image small (Next bundles its own
// server.js with just the needed node_modules) — mirrors central/next.
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
};

export default nextConfig;
