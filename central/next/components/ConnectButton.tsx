'use client'

import { useWallet } from '@/lib/wallet/context'

export const ConnectButton = () => {
  const { isConnected, login, openAccount, address } = useWallet()
  return (
    <div>
      <button onClick={() => (isConnected ? openAccount() : login())}>
        {isConnected
          ? `${address?.slice(0, 6)}…${address?.slice(-4)}`
          : 'Connect Wallet'}
      </button>
    </div>
  )
}
