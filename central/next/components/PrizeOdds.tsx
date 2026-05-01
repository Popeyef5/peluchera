"use client";

import { HStack, VStack, Text, Box } from "@chakra-ui/react";
import { FramedLayoutCard, FramedLayoutCardProps } from "./ui/framedLayoutCard";

type Tier = {
	name: string;
	odds: string;
	color: string;
};

const TIERS: Tier[] = [
	{ name: "Common pack", odds: "70%", color: "gray.400" },
	{ name: "Rare pack", odds: "25%", color: "blue.400" },
	{ name: "Chase pack", odds: "5%", color: "yellow.400" },
];

type PrizeOddsProps = Partial<FramedLayoutCardProps>;

const PrizeOdds = (props: PrizeOddsProps) => {
	return (
		<FramedLayoutCard title="What's in the machine" {...props}>
			<VStack w="100%" gap={2} align="stretch">
				{TIERS.map((t) => (
					<HStack key={t.name} justify="space-between" w="100%">
						<HStack>
							<Box boxSize={3} borderRadius="full" bg={t.color} />
							<Text>{t.name}</Text>
						</HStack>
						<Text>{t.odds}</Text>
					</HStack>
				))}
			</VStack>
		</FramedLayoutCard>
	);
};

export default PrizeOdds;
