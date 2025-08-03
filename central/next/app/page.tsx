"use client";
import React from 'react';
import { Grid, GridItem, HStack, VStack, Box, Flex, Separator } from '@chakra-ui/react';
import { SocketProvider, ClawProvider } from '@/components/providers';
import WebRTCPlayer from '@/components/WebRTCPlayer';
import Rules from '@/components/rules';
import { ColorModeButton, useColorMode } from '@/components/ui/color-mode';
import AccountManager from '@/components/AccountManager';
import { WinMultiplier, EpochCountdown, EpochStats } from '@/components/GameInfo';
import ActionButton from '@/components/ActionButton';
import Stats from '@/components/Stats';
import { useIsMobile } from '@/components/hooks/useIsMobile';
import Image from 'next/image'

const sidesWidth = "60%";

/* ───────── HUD ───────── */
const HUD: React.FC = () => {
  const { colorMode } = useColorMode();

  return (
    <VStack h="100vh" gap={6} w={"full"} p={4}>
      <HStack w="full" justify="space-between" h={28} px={6}>
        <ColorModeButton />
        <Image width={250} height={100} src={colorMode === "light" ? "/logo.png" : "/logo_white.png"} alt="logo" />
        <AccountManager />
      </HStack>
      <HStack w="full" justify={"space-evenly"} >
        <Flex align={"center"} justify={"center"} flex={1} w={"full"}>
          <VStack gap={6} w={sidesWidth}>
            <WinMultiplier w={"full"} />
            <EpochCountdown w={"full"}/>
          </VStack>
        </Flex>
        <Flex flex={10} aspectRatio={4 / 3} maxW={"87vh"}>
          <WebRTCPlayer />
        </Flex>
        <Flex align={"center"} justify={"center"} flex={1} w={"full"}>
          <VStack gap={3} w={sidesWidth}>
            <EpochStats w={"full"} />
            <Rules w={"full"} />
          </VStack>
        </Flex>
      </HStack>
      <ActionButton h="100%" paddingBottom={4}/>
    </VStack>
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
