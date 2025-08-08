"use client";
import React, { useEffect, useRef, useState } from 'react';
import { Grid, GridItem, HStack, VStack, Box, Flex, Drawer } from '@chakra-ui/react';
import { SocketProvider, ClawProvider } from '@/components/providers';
import WebRTCPlayer from '@/components/WebRTCPlayer';
import Rules from '@/components/rules';
import { ColorModeButton, useColorMode } from '@/components/ui/color-mode';
import AccountManager from '@/components/AccountManager';
import { WinMultiplier, EpochCountdown, EpochStats } from '@/components/GameInfo';
import ActionButton from '@/components/ActionButton';
import { useIsMobile } from '@/components/hooks/useIsMobile';
import Image from 'next/image'

/* ───────── HUD ───────── */
const HUD: React.FC = () => {
  const { colorMode } = useColorMode();
  const [logoSrc, setLogoSrc] = useState("/logo.png");
  useEffect(() => {
    if (colorMode === "dark") {
      setLogoSrc("/logo_white.png");
    } else {
      setLogoSrc("/logo.png")
    }
  }, [colorMode])
  const columnRef = useRef<HTMLDivElement>(null);

  return (
    <HStack w={"100vw"} h={"100vh"} p={"3.2vh"} gap={"3.2vh"} containerType={"size"}>
      <VStack
        w="full"
        h="full"
        gap={"2.4vh"}
        flex={"1 0 33.5vh"}
        ref={columnRef}
        pos={"relative"}
      >
        <HStack justify={"space-between"} w="full">
          <ColorModeButton />
          <Box w="80%" maxW={"40vh"}>
            <Image width={800} height={200} src={logoSrc} alt="logo" />
          </Box>
          <AccountManager containerRef={columnRef} />
        </HStack>
        <ActionButton
          flex={1}
          w="full"
          buttonWidth={"full"}
          buttonHeight={"12vh"}
          borderBottom={{ base: "2px solid black", _dark: "2px solid white" }}
          keySize={'13cqw'}
          buttonSize={'30cqw'}
        />
        <HStack w={"full"}>
          <WinMultiplier flex={1} textFontSize='3.5vh' />
          <EpochCountdown flex={1} textFontSize='3.5vh' />
        </HStack>
        <EpochStats w={"full"} />
        <Rules w={"full"} containerRef={columnRef} />
      </VStack>
      <Flex
        h={"full"}
        maxW={"133cqh"}
        flex={"1000 1 auto"}
        align={"center"}
      >
        <WebRTCPlayer />
      </Flex>
    </HStack>
  )
};

const Mobile = () => {
  const { colorMode } = useColorMode();
  const [logoSrc, setLogoSrc] = useState("/logo.png");
  useEffect(() => {
    if (colorMode === "dark") {
      setLogoSrc("/logo_white.png");
    } else {
      setLogoSrc("/logo.png")
    }
  }, [colorMode])

  return <VStack w={"full"} p={8} gap={8}>
    <HStack w="full" justify={"space-between"}>
      <ColorModeButton />
      <Image width={200} height={360} src={logoSrc} alt="logo" />
      <AccountManager />
    </HStack>
    <Flex aspectRatio={4 / 3} w="full" justifyItems={"center"}>
      <WebRTCPlayer />
    </Flex>
    <Flex w="full" minH="140px" justify={"center"} align={"center"}>
      <ActionButton userTextSize={"xl"} buttonWidth={"full"} w={"full"} />
    </Flex>
    <HStack w={"full"}>
      <WinMultiplier flex={1} titleFontSize='md' textFontSize='2xl' />
      <EpochCountdown flex={1} titleFontSize='md' textFontSize='2xl' />
    </HStack>
    <EpochStats w="full" titleFontSize='md' textFontSize='md' />
    <Rules w={"full"} />
  </VStack>
}

/* ───────── page wrapper ───────── */
export default function Page() {
  const isMobile = useIsMobile();
  return (
    <SocketProvider>
      <ClawProvider>
        {!isMobile ? <HUD /> : <Mobile />}
      </ClawProvider>
    </SocketProvider>
  );
}
