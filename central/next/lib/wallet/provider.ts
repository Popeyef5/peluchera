// Which wallet stack the app mounts. Selected at RUNTIME from the server-side
// WALLET_PROVIDER env var (read in app/layout.tsx, a server component, and passed
// down as a prop) — so swapping providers is a container restart, not a rebuild.
//
// The providers' PUBLIC keys (NEXT_PUBLIC_PROJECT_ID for Reown,
// NEXT_PUBLIC_PRIVY_APP_ID for Privy) are still baked at build time, so both must
// be present in the build for at-will swapping to work; only the selector is
// runtime.
export type WalletProviderKind = "reown" | "privy";

export function normalizeWalletProvider(
  v: string | undefined | null,
): WalletProviderKind {
  return v === "privy" ? "privy" : "reown";
}
