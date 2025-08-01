"use client";
import React from 'react';
import { Grid, GridItem, HStack, VStack, Box, Flex, Separator } from '@chakra-ui/react';
import { SocketProvider, ClawProvider } from '@/components/providers';
import WebRTCPlayer from '@/components/WebRTCPlayer';
import Rules from '@/components/rules';
import { ColorModeButton, useColorMode } from '@/components/ui/color-mode';
import AccountManager from '@/components/AccountManager';
import GameInfo from '@/components/GameInfo';
import ActionButton from '@/components/ActionButton';
import Stats from '@/components/Stats';
import { useIsMobile } from '@/components/hooks/useIsMobile';
import Image from 'next/image'

/* ───────── HUD ───────── */
const HUD: React.FC = () => {
  const { colorMode } = useColorMode();

  return (
    <VStack h="100vh" gap={0}>
      <HStack w="100%" justify="space-between" h={24} px={4} paddingTop={4}>
        <ColorModeButton />
        <Image width={250} height={100} src={colorMode === "light" ? "/logo.png" : "/logo_white.png"} alt="logo" />
        <AccountManager />
      </HStack>

      <Grid
        templateColumns="1fr 3fr 1fr"
        templateRows="5.25fr 1fr"
        gap={8}
        minH={0}
        flex="1"
        w="100%"
        p={10}
      >
        <GridItem colStart={1} rowStart={1}>
          <GameInfo minW={56} />
        </GridItem>

        <GridItem colStart={2} rowStart={1}>
          <VStack h="100%" justify="center">
            <WebRTCPlayer />
          </VStack>
        </GridItem>

        <GridItem colStart={3} rowStart={1}>
          <VStack h="100%" justify="center" align="center" gap={3}>
            <Stats minW={72} />
            <Rules w={72} />
          </VStack>
        </GridItem>

        <GridItem colStart={2} rowStart={2}>
          <ActionButton />
        </GridItem>
      </Grid>
    </VStack>
  )
};

const Mobile = () => {
  const { colorMode } = useColorMode();

  return <VStack w={"full"} p={8} gap={8}>
    <HStack w="full" justify={"space-between"}>
      <ColorModeButton/>
      <Image width={200} height={360} src={colorMode === "light" ? "/logo.png" : "/logo_white.png"} alt="logo" />
      <AccountManager/>
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
