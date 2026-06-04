"use client";
import React, { useEffect, useState } from 'react';
import { Grid, GridItem, HStack, VStack, Flex } from '@chakra-ui/react';
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
  const [logoSrc, setLogoSrc] = useState("");
  useEffect(() => {
    if (colorMode === "dark") {
      setLogoSrc("/logo_white.png");
    } else {
      setLogoSrc("/logo.png")
    }
  }, [colorMode])

  return (
    <VStack h="100vh" gap={0}>
      <HStack w="100%" justify="space-between" h={24} px={4} paddingTop={4}>
        <ColorModeButton />
        <Image width={250} height={100} src={logoSrc} alt="logo" />
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
          {/* <GameInfo minW={56} h="100%" justify="center" align="center" /> */}
          <Flex w={"full"} h={"full"} align={"center"}>
            <VStack w={"60%"} gap={6}>
              <WinMultiplier w={"full"} />
              <EpochCountdown w={"full"} />
            </VStack>
          </Flex>
        </GridItem>

        <GridItem colStart={2} rowStart={1}>
          <VStack h="100%" justify="center">
            <WebRTCPlayer />
          </VStack>
        </GridItem>

        <GridItem colStart={3} rowStart={1}>
          <VStack h="100%" justify="center" align="center" gap={3}>
            <EpochStats minW={72} />
            <Rules w={72} />
          </VStack>
        </GridItem>

        <GridItem colStart={2} rowStart={2}>
          <ActionButton h="100%" />
        </GridItem>
      </Grid>
    </VStack>
  )
};

const Mobile = () => {
  const { colorMode } = useColorMode();
  const [logoSrc, setLogoSrc] = useState("");
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
