import { Box, Text, VStack } from '@chakra-ui/react';
import React, { ReactNode } from 'react';

interface FramedLayoutCardProps {
	title: string;
	children?: ReactNode;
	className?: string;
	titleClassName?: string;
	borderColor?: string;
	backgroundColor?: string;
	titleBackground?: string;
	minW?: number;
	minH?: number;
}

const FramedLayoutCard: React.FC<FramedLayoutCardProps> = ({
	title,
	children,
	borderColor = 'black',
	minW = 0,
	minH = 0
}) => {
	return (
		<Box borderRadius="xl" borderColor={borderColor} borderWidth={3} p={6} minH={minH} minW={minW} pos="relative" fontSize={"4xl"}>
			<Text pos="absolute" top={-4} left={3} background="white" px={2} fontSize={"lg"} fontWeight={600}>{title}</Text>
			<VStack>
				{children}
			</VStack>
		</Box>
	);
};

export { FramedLayoutCard };