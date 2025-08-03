"use client";

import { FramedLayoutCard } from "./ui/framedLayoutCard";
import { VStack, HStack, Text, Separator, BoxProps } from "@chakra-ui/react";
import { InfoTip } from "./ui/toggle-tip";
import { useClaw } from "@/components/providers"

interface StatsProps extends BoxProps {
	w: number | string,
	textFontSize?: string,
	titleFontSize?: string,
}

const Stats = ({
	w,
	textFontSize = "xl",
	titleFontSize = "lg"
}: StatsProps) => {
	const { roundWon, roundPlayed, gameState } = useClaw();

	return <FramedLayoutCard title="Your stats this epoch" w={w} titleFontSize={titleFontSize}>
		<VStack fontSize={textFontSize} w={"100%"} >
			<HStack justify="space-between" w="100%"><Text>Played</Text><Text>{roundPlayed}</Text></HStack>
			<HStack justify="space-between" w="100%"><Text>Won</Text><Text>{roundWon}</Text></HStack>
			<HStack justify="space-between" w="100%"><HStack><Text>Current payout</Text><InfoTip content="Remember this can change if by the end of the epoch the ratio of wins and losses changes" /></HStack><Text>{Math.round(100 * roundWon * gameState[0] / Math.max(gameState[1], 1)) / 100}</Text></HStack>
		</VStack>
	</FramedLayoutCard>
}

export default Stats;