"use client";

import { FramedLayoutCard } from "./ui/framedLayoutCard";
import { Stack, StackProps } from "@chakra-ui/react"
import { useClaw } from '@/components/providers'

interface GameInfoProps extends StackProps {
	minW: number | string,
	titleFontSize?: string,
	textFontSize?: string,
}

const GameInfo = ({
	minW,
	titleFontSize = "lg",
	textFontSize = "4xl",
	...props
}: GameInfoProps) => {
	const { secondsLeft, gameState } = useClaw();

	return <Stack gap={8} {...props}>
		<FramedLayoutCard
			title="Current multiplier"
			minW={minW}
			titleFontSize={titleFontSize}
			textFontSize={textFontSize}
		>
			{Math.round(10 * (gameState[0] + 1) / (gameState[1] + 1)) / 10}x
		</FramedLayoutCard>
		<FramedLayoutCard
			title="Epoch ends"
			minW={minW}
			titleFontSize={titleFontSize}
			textFontSize={textFontSize}
		>
			{String(Math.floor(secondsLeft / 3600)).padStart(2, '0')}h{String(Math.ceil((secondsLeft / 60) % 60)).padStart(2, '0')}m
		</FramedLayoutCard>
	</Stack>
}

export default GameInfo;