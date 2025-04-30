'use client';
import React from 'react';
import {
  Box, Button, HStack, VStack, Grid, GridItem
} from '@chakra-ui/react';
import { SocketProvider, ClawProvider, useClaw } from '@/app/components/providers';
import GameController, { Kbd } from '@/app/components/GameController';
import { Slider } from '@/app/components/chakra/slider';
import WebRTCPlayer from '@/app/components/WebRTCPlayer';
import { useAppKit, useAppKitAccount } from '@reown/appkit/react';

const HUD: React.FC = () => {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const {
    queueCount, position, isPlaying, loading,
    betAmount, setBetAmount, approveAndBet, gameState
  } = useClaw();

  return (
    <VStack>
      <HStack w="100%" justify="space-between" p={4}>
        <Box>
          Queue: {queueCount} | Position: {position} | Playing: {isPlaying ? 'yes' : 'no'} | Game State: Bet: {gameState[0]} Won: {gameState[1]}
        </Box>
        {isConnected && (
          <Button onClick={() => open()} borderRadius="24px">
            {address?.slice(0, 6)}…{address?.slice(-4)}
          </Button>
        )}
      </HStack>

      <WebRTCPlayer />

      {/* join / queue info */}
      {!isPlaying && (
        <>
          {isConnected && position < 0 && <Slider
            width="800px"
            min={1}
            max={1000}
            label="Bet amount"
            showValue
            value={[betAmount]}
            onValueChange={e => setBetAmount(e.value[0])}
          />}
          {position < 0 && (
            <Button
              loading={loading}
              onClick={!isConnected ? () => { open() } : approveAndBet}
            >
              {!isConnected ? 'CONNECT WALLET' : 'PLAY'}
            </Button>
          )}

          {position > 1 && <Box>Your position in queue: {position}</Box>}
          {position === 1 && <Box>You are next</Box>}
          {position === 0 && <Box>Your turn will start in a few seconds. Be ready!</Box>}
          {position < 0 && queueCount > 0 && (
            <Box>{queueCount} player{queueCount > 1 && 's'} in queue.</Box>
          )}
          {position < 0 && queueCount == 0 && (
            <Box>No players in queue.</Box>
          )}
        </>
      )
      }
      {/* in‑game controls */}
      {isPlaying && <GameController />}
      
    </VStack>
  );
};

export default function Page() {
  return (
    <SocketProvider>
      <ClawProvider>
        <HUD />
      </ClawProvider>
    </SocketProvider>
  );
}
