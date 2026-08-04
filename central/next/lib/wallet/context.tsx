"use client";

import { createContext, useContext } from "react";

// Provider-agnostic wallet surface the whole app consumes via useWallet().
// A per-provider "bridge" (ReownWalletBridge / PrivyWalletBridge) fills this in
// by calling that provider's own hooks, so switching providers touches only the
// bridge — not the ~4 components that read wallet state or trigger login.
export type WalletApi = {
  address: `0x${string}` | undefined;
  isConnected: boolean;
  chainId: number | undefined;
  login: () => void; // connect / sign-in flow
  logout: () => void; // disconnect / sign-out
  openAccount: () => void; // account view (balance, disconnect, …)
};

const noop = () => {};

export const WalletContext = createContext<WalletApi>({
  address: undefined,
  isConnected: false,
  chainId: undefined,
  login: noop,
  logout: noop,
  openAccount: noop,
});

export function useWallet(): WalletApi {
  return useContext(WalletContext);
}
