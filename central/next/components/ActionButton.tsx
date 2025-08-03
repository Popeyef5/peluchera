"use client";

import { VStack, Box, Button, StackProps } from "@chakra-ui/react";
import { useClaw } from "@/components/providers"
import GameController from "./GameController";
import { useAppKitAccount, useAppKit } from '@reown/appkit/react';
import { useEffect, useState } from "react";

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
	const [userText, setUserText] = useState("");

	useEffect(() => {
		if (position > 1) {
			setUserText(`Your position in queue: ${position}`)
		} else if (position === 1) {
			setUserText(`You are next`)
		} else if (position === 0) {
			setUserText(`Your turn will start in a few seconds. Be ready!`)
		} else if (position < 0 && queueCount > 1) {
			setUserText(`${queueCount} players in queue.`)
		} else if (position < 0 && queueCount === 1) {
			setUserText(`1 player in queue.`)
		} else if (position < 0 && queueCount === 0) {
			setUserText(`No players in queue.`)
		}
	}, [position, queueCount])

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

				<Box fontSize={"2.5vh"}>{userText}</Box>
			</>
		)}
		{isPlaying && <GameController keySize={keySize} buttonSize={buttonSize} />}
	</VStack>
}

export default ActionButton;