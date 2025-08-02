"use client";
import React from 'react';
import { Grid, GridItem, HStack, VStack, Box, Flex, Separator } from '@chakra-ui/react';
import { SocketProvider, ClawProvider } from '@/components/providers';
import WebRTCPlayer from '@/components/WebRTCPlayer';
import Rules from '@/components/rules';
import { ColorModeButton, useColorMode } from '@/components/ui/color-mode';
import AccountManager, { AccountManagerMobile } from '@/components/AccountManager';
import GameInfo from '@/components/GameInfo';
import ActionButton from '@/components/ActionButton';
import Stats from '@/components/Stats';
import { useIsMobile } from '@/components/hooks/useIsMobile';
import Image from 'next/image'

/* ───────── HUD ───────── */
const HUD: React.FC = () => {
  const { colorMode } = useColorMode();

  return (
    <HStack w={"100vw"} h={"100vh"} p={8}>
      <Flex h={"full"}>
        <WebRTCPlayer />
      </Flex>
      <VStack w="full" h="full" px={8} gap={6}>
        <HStack justify={"space-between"} w="full">
          <ColorModeButton />
          <Image width={500} height={100} src={colorMode === "light" ? "/logo.png" : "/logo_white.png"} alt="logo" />
          <AccountManagerMobile />
        </HStack>
        <ActionButton
          flex={1}
          w="full"
          buttonWidth={"full"}
          buttonHeight={24}
          borderBottom={{ base: "2px solid black", _dark: "2px solid white" }}
          keySize={20}
          buttonSize={40}
        />
        <GameInfo direction={"row"} justify={"space-between"} minW={60} w="full" />
        <Stats minW={"full"} />
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
    <Flex w="full" minH="140px" borderBottom={{ base: "1px solid black", _dark: "1px solid white" }} justify={"center"} align={"start"}><ActionButton /></Flex>
    <GameInfo minW={44} direction="row" titleFontSize='sm' textFontSize='xl' w="full" justify={"space-between"} gap={2} />
    <Stats minW="full" titleFontSize='sm' textFontSize='md' />
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
