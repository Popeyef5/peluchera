"use client";

import { VStack, Box, Button, StackProps } from "@chakra-ui/react";
import { useClaw } from "@/components/providers"
import GameController from "./GameController";
import { useAppKitAccount, useAppKit } from '@reown/appkit/react';

interface ActionButtonProps extends StackProps {
	buttonWidth?: number | string,
	buttonHeight?: number | string,
	buttonFontSize?: string,
	keySize?: string | number,
	buttonSize?: string | number,
}

const ActionButton = ({
	buttonWidth = 72,
	buttonHeight = 16,
	buttonFontSize = "2xl",
	keySize = 4,
	buttonSize = 28,
	...props }: ActionButtonProps) => {
	const { isPlaying, position, loading, approveAndBet, queueCount } = useClaw();
	const { isConnected } = useAppKitAccount();
	const { open } = useAppKit();

	return <VStack gap={4} justify="space-evenly" {...props}>
		{!isPlaying && (
			<>
				{position < 0 && (
					<Button
						loading={loading}
						onClick={!isConnected ? () => open() : approveAndBet}
						h={buttonHeight}
						fontSize={buttonFontSize}
						borderRadius={"1rem"}
						w={buttonWidth}
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
		{isPlaying && <GameController keySize={keySize} buttonSize={buttonSize} />}
	</VStack>
}

export default ActionButton;