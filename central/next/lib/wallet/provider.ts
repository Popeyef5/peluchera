// Which wallet stack the app mounts. Build-time flag (NEXT_PUBLIC_* is inlined at
// build), so "choosing" a provider = set this + rebuild. The two providers mount
// fundamentally different React trees, so it can't be a runtime toggle.
export type WalletProviderKind = "reown" | "privy";

export const WALLET_PROVIDER: WalletProviderKind =
  process.env.NEXT_PUBLIC_WALLET_PROVIDER === "privy" ? "privy" : "reown";
