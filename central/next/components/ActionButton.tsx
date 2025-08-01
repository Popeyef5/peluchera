"use client";

import { VStack, Box, Button } from "@chakra-ui/react";
import { useClaw } from "@/components/providers"
import GameController from "./GameController";
import { useAppKitAccount, useAppKit } from '@reown/appkit/react';

const ActionButton = () => {
	const { isPlaying, position, loading, approveAndBet, queueCount } = useClaw();
	const { isConnected } = useAppKitAccount();
	const { open } = useAppKit();
	// const isPlaying = true;

	return <VStack gap={4} h="100%" justify="space-around">
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
}

export default ActionButton;