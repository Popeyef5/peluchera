import { Box, BoxProps, Text, VStack } from '@chakra-ui/react';
import React, { ReactNode } from 'react';

export interface FramedLayoutCardProps extends BoxProps {
	title: string;
	children?: ReactNode;
	className?: string;
	titleClassName?: string;
	borderColor?: string;
	backgroundColor?: string;
	titleBackground?: string;
	minW?: number | string;
	minH?: number | string;
	textFontSize?: string;
	titleFontSize?: string;
}

const FramedLayoutCard: React.FC<FramedLayoutCardProps> = ({
	title,
	children,
	borderColor = 'black',
	minW = 0,
	minH = 0,
	textFontSize = '4xl',
	titleFontSize = 'lg'
}) => {
	return (
		<Box
			borderRadius="xl"
			borderColor={{ base: borderColor, _dark: "white" }}
			borderWidth={3}
			p={6}
			minH={minH}
			minW={minW}
			pos="relative"
			fontSize={textFontSize}
		>
			<Text
				pos="absolute"
				top={-4}
				left={3}
				background={{base:"white", _dark: "black"}}
				px={2}
				fontSize={titleFontSize}
				fontWeight={600}
			>
				{title}
			</Text>
			<VStack>
				{children}
			</VStack>
		</Box>
	);
};

export { FramedLayoutCard };