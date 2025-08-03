"use client";
import React from 'react';
import { Grid, GridItem, HStack, VStack, Box, Flex, Separator } from '@chakra-ui/react';
import { SocketProvider, ClawProvider } from '@/components/providers';
import WebRTCPlayer from '@/components/WebRTCPlayer';
import Rules from '@/components/rules';
import { ColorModeButton, useColorMode } from '@/components/ui/color-mode';
import AccountManager, { AccountManagerMobile } from '@/components/AccountManager';
import { WinMultiplier, EpochCountdown, EpochStats } from '@/components/GameInfo';
import ActionButton from '@/components/ActionButton';
import Stats from '@/components/Stats';
import { useIsMobile } from '@/components/hooks/useIsMobile';
import Image from 'next/image'

/* ───────── HUD ───────── */
const HUD: React.FC = () => {
  const { colorMode } = useColorMode();

  return (
    <HStack w={"100vw"} h={"100vh"} p={"3.2vh"}>
      <Flex h={"full"}>
        <WebRTCPlayer />
      </Flex>
      <VStack w="full" h="full" px={"3.2vh"} gap={"2.4vh"}>
        <HStack justify={"space-between"} w="full">
          <ColorModeButton />
          <Box w="80%" maxW={"40vh"}>
            <Image width={800} height={200} src={colorMode === "light" ? "/logo.png" : "/logo_white.png"} alt="logo" />
          </Box>
          <AccountManagerMobile />
        </HStack>
        <ActionButton
          flex={1}
          w="full"
          buttonWidth={"full"}
          buttonHeight={"12vh"}
          borderBottom={{ base: "2px solid black", _dark: "2px solid white" }}
          keySize={'8vh'}
          buttonSize={'18vh'}
        />
        <HStack w={"full"}>
          <WinMultiplier flex={1} textFontSize='3.5vh' />
          <EpochCountdown flex={1} textFontSize='3.5vh' />
        </HStack>
        <EpochStats w={"full"} />
        <Rules w={"full"} />
      </VStack>
    </HStack>
  )
};

const Mobile = () => {
  const { colorMode } = useColorMode();

  return <VStack w={"full"} p={8} gap={8}>
    <HStack w="full" justify={"space-between"}>
      <ColorModeButton />
      <Image width={200} height={360} src={colorMode === "light" ? "/logo.png" : "/logo_white.png"} alt="logo" />
      <AccountManager />
    </HStack>
    <Flex aspectRatio={4 / 3} w="full" justifyItems={"center"}>
      <WebRTCPlayer />
    </Flex>
    <Flex w="full" minH="140px" borderBottom={{ base: "1px solid black", _dark: "1px solid white" }} justify={"center"} align={"start"}>
      <ActionButton userTextSize={"xl"} />
    </Flex>
    <HStack w={"full"}>
      <WinMultiplier flex={1} titleFontSize='md' textFontSize='2xl' />
      <EpochCountdown flex={1} titleFontSize='md' textFontSize='2xl' />
    </HStack>
    {/* <GameInfo minW={44} direction="row" titleFontSize='sm' textFontSize='xl' w="full" justify={"space-between"} gap={2} /> */}
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
