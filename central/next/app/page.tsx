'use client';
import React, { useEffect, useState, useRef } from 'react';
import {
  Box, Button, Flex, Grid, GridItem, HStack, VStack, Icon, Text,
  useDisclosure,
  Separator, Tabs
} from '@chakra-ui/react';
import { SocketProvider, ClawProvider, useClaw } from '@/app/components/providers';
import GameController from '@/app/components/GameController';
import WebRTCPlayer from '@/app/components/WebRTCPlayer';
import { useAppKit, useAppKitAccount } from '@reown/appkit/react';
import { FiSettings } from 'react-icons/fi';
import { FramedLayoutCard } from '@/components/ui/framedLayoutCard';
import Rules from '@/components/rules';
import { InfoTip } from '@/components/ui/toggle-tip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ColorModeButton } from '@/components/ui/color-mode';

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

/* ───────── HUD ───────── */
const HUD: React.FC = () => {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const {
    queueCount, position, isPlaying, loading,
    approveAndBet, withdraw, gameState, accountBalance, clawSocketOn, roundPlayed, roundWon, secondsLeft
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
    <VStack h="100vh" gap={0}>
      <HStack w="100%" justify="space-between" h={16} px={4} paddingTop={4}>
        {/* <Box>
          Queue: {queueCount} | Position: {position} | Playing: {isPlaying ? 'yes' : 'no'}
          {' '}| Game State: Bet: {gameState[0]} Won: {gameState[1]} | Claw socket: {clawSocketOn ? "on" : "off"}
        </Box> */}
        {/* {isConnected && (
          <Button onClick={() => open()} borderRadius="24px">
            {address?.slice(0, 6)}…{address?.slice(-4)}
          </Button>
        )} */}
        <ColorModeButton />
        {isConnected && (
          <Box position="relative" h="full">
            <Flex
              cursor="pointer"
              position="absolute"
              top={0}
              right={0}
              bg={{ base: "black", _dark: "white" }}
              color={{ base: "white", _dark: "black" }}
              borderRadius="1rem"
              w="fit-content"
              // h={grow ? "200px" : "50px"}
              transition="all 0.5s ease-in-out"
              // onClick={onToggle}
              align="center"canvas-confetti
              justify="center"
              py={grow ? 8 : 3}
              px={8}
              zIndex={100}
            >
              <VStack gap={grow ? 4 : 0}>
                <HStack onClick={onToggle}>
                  <Text mr={grow ? "5rem" : "0"} fontSize={grow ? 'x-large' : 'large'} transition="margin 0.5s ease-in-out, font-size 0.5s ease">{address?.slice(0, 6)}...{address?.slice(address.length - 4)}</Text>
                  <Icon onClick={(event) => { event.stopPropagation(); open() }} opacity={showAccount ? 1 : 0} transition="opacity 0.1s ease"><FiSettings /></Icon>
                  <Text opacity={showSummary ? 1 : 0} transition="opacity 0.1s ease">${accountBalance}</Text>
                </HStack>
                <VStack gap={6} maxH={grow ? "100vh" : "0px"} opacity={showAccount ? 1 : 0} transition="opacity 0.1s ease, max-height 0.5s ease-in-out">
                  <Box fontSize={'xx-large'}>${accountBalance}</Box>
                  <Button bg={{ base: "white", _dark: "black" }} color={{ base: "black", _dark: "white" }} onClick={withdraw} h={12} w={40} fontWeight={"500"} fontSize={"md"} borderRadius={"1rem"}>WITHDRAW</Button>
                  <Tabs.Root lazyMount unmountOnExit defaultValue="Bets" onClick={(event) => { event.stopPropagation() }}>
                    <Tabs.List mb={2} borderBottom="0px" gap={4} justifyContent={"space-around"}>
                      {['Bets', 'Withdrawals'].map((label) => (
                        <Tabs.Trigger
                          key={label}
                          value={label}
                          color="gray.400"
                          borderBottom={{ base: '4px solid black', _dark: '4px solid white' }}
                          fontSize={"md"}
                          _selected={{
                            borderBottom: { base: '4px solid white', _dark: '4px solid black' },
                            color: { base: 'white', _dark: 'black' },
                          }}
                        >
                          {label}
                        </Tabs.Trigger>
                      ))}
                    </Tabs.List>
                    <Tabs.Content value="Bets" p={0}>
                      <ScrollArea className='h-[100px]'>
                        <VStack>
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) =>
                            <HStack key={i} justify={"space-between"} w={"full"} minW={grow ? 80 : 0} paddingEnd={6}><Text>Apr 2</Text><Text>$5</Text><Text>2x</Text></HStack>
                          )}
                        </VStack>
                      </ScrollArea>
                    </Tabs.Content>
                    <Tabs.Content value="Withdrawals" p={0}>
                      <ScrollArea className='h-[100px]'>
                        <VStack>
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) =>
                            <HStack key={i} justify={"space-between"} w={"full"} minW={grow ? 80 : 0} paddingEnd={6}><Text>Apr 2</Text><Text>$25</Text></HStack>
                          )}
                        </VStack>
                      </ScrollArea>
                    </Tabs.Content>
                  </Tabs.Root>
                </VStack>
              </VStack>
            </Flex>

          </Box>
        )}
      </HStack>

      <Grid
        /* 3 columns: empty | centre | empty  */
        templateColumns="1fr 3fr 1fr"
        /* 2 rows:   grow   | auto‑height    */
        templateRows="5.25fr 1fr"
        gap={8}
        /* take full viewport height minus the header height (≈ 56 px) */
        minH={0}
        flex="1"
        w="100%"
        p={10}
      >
        {/* ── TOP‑LEFT / TOP‑RIGHT left blank intentionally ── */}
        <GridItem colStart={1} rowStart={1}>
          <VStack h="100%" justify="center" align="center" gap={8}>
            <FramedLayoutCard title="Current multiplier" minW={56}>
              {Math.round(10 * (gameState[0] + 1) / (gameState[1] + 1)) / 10}x
            </FramedLayoutCard>
            <FramedLayoutCard title="Epoch ends" minW={56}>
              {String(Math.floor(secondsLeft / 3600)).padStart(2, '0')}h{String(Math.ceil((secondsLeft / 60) % 60)).padStart(2, '0')}m
            </FramedLayoutCard>
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

        {/* ── TOP‑RIGHT / TOP‑RIGHT left blank intentionally ── */}
        <GridItem colStart={3} rowStart={1}>
          <VStack h="100%" justify="center" align="center" gap={3}>
            <FramedLayoutCard title="Your stats this epoch" minW={72}>
              <VStack fontSize={"xl"} w={"100%"} separator={<Separator />}>
                <HStack justify="space-between" w="100%"><Text>Played</Text><Text>{roundPlayed}</Text></HStack>
                <HStack justify="space-between" w="100%"><Text>Won</Text><Text>{roundWon}</Text></HStack>
                <HStack justify="space-between" w="100%"><HStack><Text>Current payout</Text><InfoTip content="Remember this can change if by the end of the epoch the ratio of wins and losses changes" /></HStack><Text>{Math.round(100 * roundWon * gameState[0] / Math.max(gameState[1], 1)) / 100}</Text></HStack>
              </VStack>
            </FramedLayoutCard>
            <Rules w={72} />
          </VStack>
        </GridItem>

        {/* central column, bottom row — slider + queue UI */}
        <GridItem colStart={2} rowStart={2}>
          <VStack gap={4} h="100%" justify="space-around">
            {/* <GameController/> */}
            {!isPlaying && (
              <>
                {position < 0 && (
                  <Button
                    loading={loading}
                    onClick={!isConnected ? () => open() : approveAndBet}
                    size={"2xl"}
                    fontSize={"2xl"}
                    borderRadius={"1rem"}
                    w={72}
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
