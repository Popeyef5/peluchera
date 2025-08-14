"use client";

import { FramedLayoutCard, FramedLayoutCardProps } from "./ui/framedLayoutCard";
import { VStack, HStack, Text, Box } from "@chakra-ui/react"
import { useClaw } from '@/components/providers'
import { InfoTip } from "./ui/toggle-tip";
import { currentPayout, marginalMultiplier } from "@/lib/utils";

type GameInfoProps = Partial<FramedLayoutCardProps>

export const WinMultiplier = (props: GameInfoProps) => {
	const { gameState, roundInfo } = useClaw();

	return <FramedLayoutCard
		title="Multiplier"
		{...props}
	>
		<Box>
			{Math.round(10 * marginalMultiplier(gameState, roundInfo)) / 10}x <InfoTip content="This value can fluctuate as win-rate varies during the epoch. Read the rules for more details." />
		</Box>
	</FramedLayoutCard>
}


export const EpochCountdown = (props: GameInfoProps) => {
	const { secondsLeft } = useClaw();

	return <FramedLayoutCard
		title="Epoch ends"
		{...props}
	>
		{String(Math.floor(secondsLeft / 3600)).padStart(2, '0')}h{String(Math.ceil((secondsLeft / 60) % 60)).padStart(2, '0')}m
	</FramedLayoutCard>
}


export const EpochStats = (props: GameInfoProps) => {
	const { roundWon, roundPlayed, gameState, roundInfo } = useClaw();

	return <FramedLayoutCard
		title="Your stats this epoch"
		{...props}
	>
		<VStack w={"100%"} >
			<HStack justify="space-between" w="100%">
				<Text>Played</Text>
				<Text>{roundPlayed}</Text>
			</HStack>
			<HStack justify="space-between" w="100%">
				<Text>Won</Text>
				<Text>{roundWon}</Text>
			</HStack>
			<HStack justify="space-between" w="100%">
				<HStack>
					<Text>Current payout</Text>
					<InfoTip content="Remember this can change if by the end of the epoch the ratio of wins and losses changes" />
				</HStack>
				<Text>{Math.round(100 * currentPayout(gameState, roundInfo, roundWon)) / 100}</Text>
			</HStack>
		</VStack>
	</FramedLayoutCard>
}