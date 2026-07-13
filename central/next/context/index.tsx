'use client'

import { wagmiAdapter, projectId } from '@/config'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createAppKit } from '@reown/appkit/react'
import { baseSepolia } from '@reown/appkit/networks'
import React, { type ReactNode } from 'react'
import { cookieToInitialState, WagmiProvider, type Config } from 'wagmi'

// Set up queryClient
const queryClient = new QueryClient()

if (!projectId) {
  throw new Error('Project ID is not defined')
}

// Set up metadata
const metadata = {
  name: 'Claw',
  description: 'Claw Example',
  url: 'https://cryptoclaw.xyz', // origin must match your domain & subdomain
  icons: ['https://avatars.githubusercontent.com/u/179229932']
}

// Create the modal
const modal = createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: [baseSepolia],
  defaultNetwork: baseSepolia,
  metadata: metadata,
  featuredWalletIds: [
    "fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa"
  ],
  features: {
    analytics: false, // Optional - defaults to your Cloud configuration,
    // Embedded-wallet login for non-crypto users: signing in with email or a
    // social account provisions a self-custodial smart account, so the player
    // gets a wallet address (used as their identity AND winnings payout target)
    // without a seed phrase. Requires email/social + the matching providers to
    // be enabled for this projectId in the Reown Cloud dashboard, and the
    // dashboard domain to match `metadata.url` above.
    email: true,
    socials: ['google', 'apple', 'x'],
    emailShowWallets: true, // keep external wallets visible alongside email/social
  }
})

function ContextProvider({ children, cookies }: { children: ReactNode; cookies: string | null }) {
  const initialState = cookieToInitialState(wagmiAdapter.wagmiConfig as Config, cookies)

  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig as Config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}

export default ContextProvider
