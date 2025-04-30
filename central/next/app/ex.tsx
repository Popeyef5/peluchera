'use client';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import {
  Box, Button, Flex, HStack, VStack, Icon,
  useDisclosure, Collapsible, Text
} from '@chakra-ui/react';
import { FiSettings } from "react-icons/fi";

import { useAppKit, useAppKitAccount, useAppKitNetwork } from '@reown/appkit/react';
import { Slider } from './components/chakra/slider';
import { USDCAddress, erc20WithPermitAbi, clawAddress } from '@/lib/crypto/contracts';
import { readContract, signTypedData } from 'wagmi/actions';
import { config } from '@/config';
import { types } from '@/lib/crypto/permit';
import WebRTCPlayer from './components/VideoPlayer';

/* ───── bitmask helpers ───── */
const KEYMAP: Record<string, number> = {
  ArrowLeft: 0b0001,
  ArrowRight: 0b0010,
  ArrowUp: 0b0100,
  ArrowDown: 0b1000,
  ' ': 0b0001_0000,   // Grab (space)
  c: 0b0010_0000,     // Credit
};

const ACTION_TO_KEY: Record<'left' | 'right' | 'up' | 'down' | 'grab', string> = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  grab: ' ',
};


interface ConnectedData { status: string; queue: number }
interface JoinQueueUpdateData { status: string; position: number }
interface AuthErrorData { error: string }

export default function Home() {
  /* ───────── state ───────── */
  const [betAmount, setBetAmount] = useState(1);
  const [queueCount, setQueueCount] = useState(0);
  const [position, setPosition] = useState(-1);       // -1 = not in queue
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [, setActiveKeys] = useState(0);
  const { open: isOpen, onToggle } = useDisclosure();

  /* ───────── wallet ──────── */
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { chainId } = useAppKitNetwork();

  /* ───────── socket (fresh per HMR) ───────── */
  const socket: Socket = useMemo(
    () => io({ transports: ['websocket'] }),
    []                                      // created once
  );

  /* ───────── first connect → tell server who we are ───────── */
  useEffect(() => {
    if (!address) return;
    socket.emit('wallet_connected', { address }, (res: ConnectedData) => {
      setQueueCount(res.queue);
    });
  }, [address, socket]);

  /* ───────── event handlers ───────── */
  useEffect(() => {
    /* wrap callbacks so we can remove them in cleanup */
    const onPlayerQueued = () => setQueueCount(q => q + 1);

    const onTurnStart = () => {
      setQueueCount(q => Math.max(q - 1, 0));
      setPosition(p => (p > 0 ? p - 1 : p));
      setIsPlaying(false);
    };

    const onYourTurn = () => {
      alert("It's your turn!");
      setIsPlaying(true);
    };

    const onTurnEnd = () => {
      setIsPlaying(false);
      setPosition(p => (p >= 0 ? p - 1 : p));
    };

    const onAuthError = (d: AuthErrorData) => alert(`Authentication error: ${d.error}`);

    socket.on('player_queued', onPlayerQueued);
    socket.on('turn_start', onTurnStart);
    socket.on('your_turn', onYourTurn);
    socket.on('turn_end', onTurnEnd);
    socket.on('auth_error', onAuthError);

    /* cleanup to avoid duplicate listeners on Fast Refresh */
    return () => {
      socket.off('player_queued', onPlayerQueued);
      socket.off('turn_start', onTurnStart);
      socket.off('your_turn', onYourTurn);
      socket.off('turn_end', onTurnEnd);
      socket.off('auth_error', onAuthError);
    };
  }, [socket]);

  /* ───────── send bitmask ───────── */
  const emitMovement = useCallback(
    (mask: number) => {
      socket.emit('move', { bitmask: mask });
    },
    [socket],
  );

  /* bitmask setters for UI buttons */
  const press = useCallback((action: keyof typeof ACTION_TO_KEY) => {
    const key = ACTION_TO_KEY[action];
    const bit = KEYMAP[key];
    setActiveKeys((prev) => {
      if (prev & bit) return prev; // already pressed
      const next = prev | bit;
      emitMovement(next);
      return next;
    });
  }, [emitMovement]);

  const release = useCallback((action: keyof typeof ACTION_TO_KEY) => {
    const key = ACTION_TO_KEY[action];
    const bit = KEYMAP[key];
    setActiveKeys((prev) => {
      if (!(prev & bit)) return prev; // already clear
      const next = prev & ~bit;
      emitMovement(next);
      return next;
    });
  }, [emitMovement]);

  /* ───────── keyboard control ───────── */
  useEffect(() => {
    if (!isPlaying) return;
    const down = (e: KeyboardEvent) => {
      if (!KEYMAP[e.key]) return;
      setActiveKeys((prev) => {
        if (prev & KEYMAP[e.key]) return prev;
        const next = prev | KEYMAP[e.key];
        emitMovement(next);
        return next;
      });
    };
    const up = (e: KeyboardEvent) => {
      if (!KEYMAP[e.key]) return;
      setActiveKeys((prev) => {
        if (!(prev & KEYMAP[e.key])) return prev;
        const next = prev & ~KEYMAP[e.key];
        emitMovement(next);
        return next;
      });
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [isPlaying, emitMovement]);

  // /* ───────── controls ───────── */
  // const sendControl = useCallback(
  //   (action: 'up' | 'down' | 'left' | 'right' | 'grab') => {
  //     socket.emit('control', { action });
  //   },
  //   [socket],
  // );
  // /* keyboard shortcuts while playing */
  // useEffect(() => {
  //   if (!isPlaying) return;
  //   const onKey = (e: KeyboardEvent) => {
  //     switch (e.key) {
  //       case 'ArrowUp': sendControl('up'); break;
  //       case 'ArrowDown': sendControl('down'); break;
  //       case 'ArrowLeft': sendControl('left'); break;
  //       case 'ArrowRight': sendControl('right'); break;
  //       case ' ': sendControl('grab'); break;
  //       default: break;
  //     }
  //   };
  //   window.addEventListener('keydown', onKey);
  //   return () => window.removeEventListener('keydown', onKey);
  // }, [isPlaying, sendControl]);

  /* ───────── approve + bet (unchanged except loading prop) ───────── */
  const approveAndBet = async () => {
    if (!address || !chainId) return;
    setLoading(true);
    const amount = BigInt(betAmount);
    const userAddress = address as `0x${string}`;

    const USDCContract = {
      address: USDCAddress,
      abi: erc20WithPermitAbi
    } as const

    try {

      // Fetch contract name
      const name = await readContract(config, {
        ...USDCContract,
        functionName: "name"
      })

      // Fetch address nonce
      const nonce = await readContract(config, {
        ...USDCContract,
        functionName: "nonces",
        args: [userAddress]
      })

      // Fetch contract version
      const version = await readContract(config, {
        ...USDCContract,
        functionName: "version"
      })

      // Set permit deadline
      const deadline = BigInt(Math.floor(Date.now() / 1000 + 60 * 60 * 24))

      // Sign EIP712 signature
      const signature = await signTypedData(config, {
        account: userAddress,
        types,
        message: {
          owner: userAddress,
          spender: clawAddress,
          value: amount,
          nonce,
          deadline
        },
        primaryType: "Permit",
        domain: {
          name,
          chainId: BigInt(chainId),
          version,
          verifyingContract: USDCAddress
        }
      })


      socket.emit(
        'join_queue',
        { address, amount: Number(betAmount), deadline: Number(deadline), signature },
        (res: JoinQueueUpdateData) => {
          if (res.status === 'ok') setPosition(res.position);
          setLoading(false);
        }
      );
    } catch (e) {
      console.error(e);
      setLoading(false);
    }
  };

  /* ───────── render ───────── */
  return (
    <VStack>
      <HStack w="100%" justify="space-between" padding="16px">
        <Box>
          Queue: {queueCount} &nbsp;|&nbsp; Position: {position} &nbsp;|&nbsp;
          Playing: {isPlaying ? 'yes' : 'no'}
        </Box>
        {/* {isConnected && (
          <Button onClick={() => { open() }} borderRadius="24px">{address?.slice(0, 6)}...{address?.slice(address.length-4)}</Button>
        )} */}
        {/* {isConnected &&
          <Box
            border="1px solid"
            borderColor="gray.200"
            borderRadius="md"
            transition="all 0.2s ease"
            _hover={{ shadow: "md" }}
            w={isOpen ? "300px" : "200px"}
          >
            <Flex
              align="center"
              justify="space-between"
              p={2}
              onClick={onToggle}
              cursor="pointer"
            >
              <Text>{address}</Text>
              {isOpen && <Icon as={FiSettings} />}
            </Flex>

            <Collapsible.Root open={isOpen}>
              <Collapsible.Content>
                <Box p={2} pt={0}>
                  <Text fontSize="sm">Balance: 1.2 ETH</Text>
                  <Button size="sm" mt={2}>Disconnect</Button>
                </Box>
              </Collapsible.Content>
            </Collapsible.Root>
          </Box>
        } */}
        {/* {isConnected && (
          <Box position="relative">
            

            <Collapsible.Root >
              <Collapsible.Trigger>
                <Box
                  transition="all 0.4s ease"
                  color="white"
                  bg="black"
                  w={isOpen ? "300px" : "200px"}
                  p={4}
                >

                  <Flex
                    align="center"
                    justify="space-between"
                    onClick={onToggle}
                    cursor="pointer"
                  >
                    <Text>{address?.slice(0, 6)}...{address?.slice(address.length - 4)}</Text>
                    {isOpen && <Icon as={FiSettings} />}
                  </Flex>
                </Box>
              </Collapsible.Trigger>
              <Collapsible.Content transition="all 0.4s ease">
                <Box
                  position="absolute"
                  top="100%"
                  left={0}
                  w="full"
                  bg="black"
                  zIndex={10}
                >
                  <Text fontSize="sm">Balance: 1.2 ETH</Text>
                  <Button size="sm" mt={2} bg="white" color="black">Disconnect</Button>
                </Box>
              </Collapsible.Content>
            </Collapsible.Root>
          </Box>
        )} */}
        {isConnected && (
          <Box position="relative">
            <Box
              bg="black"
              color="white"
              transition="width 3.5s ease"
              _hover={{ shadow: "md" }}
              w={isOpen ? "300px" : "200px"}
            >
              <Flex
                align="center"
                justify="space-between"
                p={2}
                onClick={onToggle}
                cursor="pointer"
              >
                <Text>{address?.slice(0, 6)}...{address?.slice(address.length - 4)}</Text>
                {isOpen && <Icon as={FiSettings} />}
              </Flex>
            </Box>

            {/* Dropdown panel, animated manually */}
            <Box
              position="absolute"
              top="100%"
              left={0}
              w="full"
              bg="black"
              color="white"
              borderBottomRadius="md"
              zIndex={10}
              p={2}
              shadow="md"
              pointerEvents={isOpen ? "auto" : "none"}
              opacity={isOpen ? 1 : 0}
              transition="max-height 3.4s ease"
              maxHeight={isOpen ? "400px" : "0px"}
            >
              <Text fontSize="sm">Balance: 1.2 ETH</Text>
              <Button size="sm" mt={2}>Disconnect</Button>
            </Box>
          </Box>
        )}
      </HStack>
      <WebRTCPlayer />
      <VStack>
        {!isPlaying && isConnected && position < 0 && <Slider
          width="800px"
          min={1}
          max={1000}
          label="Bet amount"
          showValue
          value={[betAmount]}
          onValueChange={e => setBetAmount(e.value[0])}
        />}
        {!isPlaying && position < 0 && (
          <Button
            loading={loading}
            onClick={!isConnected ? () => { open() } : approveAndBet}
          >
            {!isConnected ? 'CONNECT WALLET' : 'PLAY'}
          </Button>
        )}

        {!isPlaying && position > 1 && <Box>Your position in queue: {position}</Box>}
        {!isPlaying && position === 1 && <Box>You are next</Box>}
        {!isPlaying && position === 0 && <Box>Your turn will start in a few seconds. Be ready!</Box>}
        {!isPlaying && position < 0 && queueCount > 0 && (
          <Box>{queueCount} player{queueCount > 1 && 's'} in queue.</Box>
        )}
        {!isPlaying && position < 0 && queueCount == 0 && (
          <Box>No players in queue.</Box>
        )}
        {/* ───────── controls ───────── */}
        {isPlaying && (
          <Flex align="center" gap={6} mt={4}>
            {/* Arrow pad */}
            <VStack >
              <Button
                onMouseDown={() => press('up')}
                onMouseUp={() => release('up')}
                onMouseLeave={() => release('up')}
              >
                &uarr;
              </Button>

              <HStack >
                <Button
                  onMouseDown={() => press('left')}
                  onMouseUp={() => release('left')}
                  onMouseLeave={() => release('left')}
                >
                  &larr;
                </Button>
                <Button
                  onMouseDown={() => press('right')}
                  onMouseUp={() => release('right')}
                  onMouseLeave={() => release('right')}
                >
                  &rarr;
                </Button>
              </HStack>

              <Button
                onMouseDown={() => press('down')}
                onMouseUp={() => release('down')}
                onMouseLeave={() => release('down')}
              >
                &darr;
              </Button>
            </VStack>

            {/* Grab */}
            <Button
              size="lg"
              colorScheme="red"
              onMouseDown={() => press('grab')}
              onMouseUp={() => release('grab')}
              onMouseLeave={() => release('grab')}
            >
              GRAB
            </Button>
          </Flex>
        )}
      </VStack>
    </VStack>
  );
}
