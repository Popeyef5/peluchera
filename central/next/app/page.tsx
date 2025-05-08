'use client';
import React, { useEffect, useState } from 'react';
import {
  Box, Button, Flex, Grid, GridItem, HStack, VStack, Icon, Text,
  useDisclosure,
  AspectRatio
} from '@chakra-ui/react';
import { SocketProvider, ClawProvider, useClaw } from '@/app/components/providers';
import GameController from '@/app/components/GameController';
// import { Slider } from '@/app/components/chakra/slider';
import WebRTCPlayer from '@/app/components/WebRTCPlayer';
import { useAppKit, useAppKitAccount } from '@reown/appkit/react';
import { FiSettings } from 'react-icons/fi';

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

/* ───────── HUD ───────── */
const HUD: React.FC = () => {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const {
    queueCount, position, isPlaying, loading,
    approveAndBet, withdraw, gameState, accountBalance
  } = useClaw();
  const { open: isOpen, onToggle } = useDisclosure();
  const [showAccount, setShowAccount] = useState(false);
  const [showSummary, setShowSummary] = useState(true);
  const [grow, setGrow] = useState(false);

  useEffect(() => {
    const onGrow = async () => {
      setShowSummary(false);
      await delay(50);

      setGrow(true); // second step
      await delay(550);

      setShowAccount(true); // third step
    };

    const onShrink = async () => {
      setShowAccount(false);
      await delay(50);

      setGrow(false);
      await delay(550);

      setShowSummary(true)
    }

    if (isOpen) {
      onGrow();
    } else {
      onShrink();
    }
  }, [isOpen])

  return (
    <VStack h="100vh">
      <HStack w="100%" justify="space-between" p={4}>
        <Box>
          Queue: {queueCount} | Position: {position} | Playing: {isPlaying ? 'yes' : 'no'}
          {' '}| Game State: Bet: {gameState[0]} Won: {gameState[1]}
        </Box>
        {/* {isConnected && (
          <Button onClick={() => open()} borderRadius="24px">
            {address?.slice(0, 6)}…{address?.slice(-4)}
          </Button>
        )} */}
        {isConnected && (
          <Box position="relative" h="full">
            <Flex
              cursor="pointer"
              position="absolute"
              top={0}
              right={0}
              bg="black"
              color="white"
              borderRadius="1rem"
              w="fit-content"
              // h={grow ? "200px" : "50px"}
              transition="all 0.5s ease-in-out"
              onClick={onToggle}
              align="center"
              justify="center"
              py={grow ? 8 : 2}
              px={8}
              >
              <VStack>
                <HStack>
                  <Text mr={grow ? "5rem" : "0"} fontSize={grow ? 'x-large' : 'large'} transition="margin 0.5s ease-in-out, font-size 0.5s ease">{address?.slice(0, 6)}...{address?.slice(address.length - 4)}</Text>
                  <Icon onClick={() => { open() }} opacity={showAccount ? 1 : 0} transition="opacity 0.1s ease"><FiSettings /></Icon>
                  <Text opacity={showSummary ? 1 : 0} transition="opacity 0.1s ease">${accountBalance}</Text>
                </HStack>
                <VStack maxH={grow ? "100vh" : "0px"} opacity={showAccount ? 1 : 0} transition="opacity 0.1s ease, max-height 0.5s ease-in-out">
                  <Box fontSize={'xx-large'}>${accountBalance}</Box>
                  <Button bg="white" color="black" onClick={withdraw}>WITHDRAW</Button>
                </VStack>
              </VStack>
            </Flex>

          </Box>
        )}
      </HStack>

      <Grid
        /* 3 columns: empty | centre | empty  */
        templateColumns="1fr 4fr 1fr"
        /* 2 rows:   grow   | auto‑height    */
        templateRows="1fr auto"
        gap={16}
        /* take full viewport height minus the header height (≈ 56 px) */
        minH={0}
        flex="1"
        w="100%"
        p={16}
      >
        {/* ── TOP‑LEFT / TOP‑RIGHT left blank intentionally ── */}
        <GridItem colStart={1} rowStart={1}>
          <VStack h="100%" justify="center" align="center">
            <Box>Total rounds played: {gameState[0]}</Box>
            <Box>Total rounds won: {gameState[1]}</Box>
            <Box><Text>Current win multiplier: {Math.round(10 * (gameState[0] + 1) / (gameState[1] + 1)) / 10}x</Text></Box>
          </VStack>
        </GridItem>

        {/* central column, top row — video feeds & in‑game controls */}
        <GridItem colStart={2} rowStart={1}>
          <VStack h="100%" justify="center">
            {/* <AspectRatio ratio={4 / 3}> */}
            <WebRTCPlayer />
            {/* </AspectRatio> */}

          </VStack>
        </GridItem>

        {/* central column, bottom row — slider + queue UI */}
        <GridItem colStart={2} rowStart={2}>
          <VStack gap={4}>
            {!isPlaying && (
              <>
                {position < 0 && (
                  <Button
                    loading={loading}
                    onClick={!isConnected ? () => open() : approveAndBet}
                    size={"xl"}
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
                {position < 0 && queueCount === 0 && <Box>No players in queue.</Box>}
              </>
            )}
            {isPlaying && <GameController />}
          </VStack>
        </GridItem>
      </Grid>
    </VStack>
  )
};

/* ───────── page wrapper ───────── */
export default function Page() {
  return (
    <SocketProvider>
      <ClawProvider>
        <HUD />
      </ClawProvider>
    </SocketProvider>
  );
}
