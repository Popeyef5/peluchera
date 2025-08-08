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
	textFontSize = '2.5vh',
	titleFontSize = '2vh',
	...props
}) => {
	return (
		<Box
			borderRadius="1.5rem"
			borderColor={{ base: borderColor, _dark: "white" }}
			borderWidth={"0.3vh"}
			p={"2.4vh"}
			minH={minH}
			minW={minW}
			pos="relative"
			fontSize={textFontSize}
			{...props}
		>
			<Text
				pos="absolute"
				top={"-1.6vh"}
				left={"2vh"}
				background={{ base: "white", _dark: "black" }}
				px={1}
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