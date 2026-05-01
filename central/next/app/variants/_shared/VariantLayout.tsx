"use client";

import React, { ReactNode, RefObject, useEffect, useRef, useState } from "react";
import { Box, Flex, HStack, VStack } from "@chakra-ui/react";
import { ClawProvider, SocketProvider } from "@/components/providers";
import WebRTCPlayer from "@/components/WebRTCPlayer";
import ActionButton from "@/components/ActionButton";
import { useIsMobile } from "@/components/hooks/useIsMobile";

type ColumnRef = RefObject<HTMLDivElement | null>;

interface Slots {
	themeToggle?: ReactNode;
	wordmark: ReactNode;
	wallet?: ReactNode;
	prizePanel: (columnRef: ColumnRef) => ReactNode;
	rulesTrigger: (columnRef: ColumnRef) => ReactNode;
	renderVideoFrame?: (player: ReactNode) => ReactNode;
}

interface VariantLayoutProps extends Slots {
	className?: string;
	globalStyles?: ReactNode;
}

const HUD = ({ themeToggle, wordmark, wallet, prizePanel, rulesTrigger, renderVideoFrame }: Slots) => {
	const columnRef = useRef<HTMLDivElement>(null);
	const player = <WebRTCPlayer />;

	return (
		<HStack w={"100vw"} h={"100vh"} p={"3.2vh"} gap={"3.2vh"} containerType={"size"}>
			<VStack
				w="full"
				h="full"
				gap={"2.4vh"}
				flex={"1 0 34.5vh"}
				ref={columnRef}
				pos={"relative"}
			>
				<HStack justify={"space-between"} w="full">
					<Box>{themeToggle}</Box>
					<Box w="80%" maxW={"40vh"} textAlign="center">{wordmark}</Box>
					<Box>{wallet}</Box>
				</HStack>
				<ActionButton
					flex={1}
					w="full"
					buttonWidth={"full"}
					buttonHeight={"12vh"}
					borderBottom={{ base: "2px solid black", _dark: "2px solid white" }}
					keySize={"13cqw"}
					buttonSize={"30cqw"}
				/>
				{prizePanel(columnRef)}
				{rulesTrigger(columnRef)}
			</VStack>
			<Flex h={"full"} maxW={"133cqh"} flex={"1000 1 auto"} align={"center"}>
				{renderVideoFrame ? renderVideoFrame(player) : player}
			</Flex>
		</HStack>
	);
};

const Mobile = ({ themeToggle, wordmark, wallet, prizePanel, rulesTrigger, renderVideoFrame }: Slots) => {
	const columnRef = useRef<HTMLDivElement>(null);
	const player = <WebRTCPlayer />;

	return (
		<VStack w={"full"} p={8} gap={8} ref={columnRef}>
			<HStack w="full" justify={"space-between"}>
				<Box>{themeToggle}</Box>
				<Box>{wordmark}</Box>
				<Box>{wallet}</Box>
			</HStack>
			<Flex aspectRatio={4 / 3} w="full" justifyItems={"center"}>
				{renderVideoFrame ? renderVideoFrame(player) : player}
			</Flex>
			<Flex w="full" minH="140px" justify={"center"} align={"center"}>
				<ActionButton userTextSize={"xl"} buttonWidth={"full"} w={"full"} />
			</Flex>
			{prizePanel(columnRef)}
			{rulesTrigger(columnRef)}
		</VStack>
	);
};

export default function VariantLayout({ className, globalStyles, ...slots }: VariantLayoutProps) {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const isMobile = useIsMobile();
	const showMobile = mounted && isMobile;
	return (
		<SocketProvider>
			<ClawProvider>
				<div className={className}>
					{globalStyles}
					{!showMobile ? <HUD {...slots} /> : <Mobile {...slots} />}
				</div>
			</ClawProvider>
		</SocketProvider>
	);
}
