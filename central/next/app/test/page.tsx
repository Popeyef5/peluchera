"use client"

import {
	Box,
	HStack,
	AspectRatio,
	Text,
	useBreakpointValue,
} from "@chakra-ui/react";

type VideoWithSidebarProps = {
	/** Path or URL for the <video> source */
	src: string;
	/** Minimum width of the green column (defaults to 16 rem ≈ 256 px) */
	minSidebarW?: string | number;
};

const VideoWithSidebar: React.FC<VideoWithSidebarProps> = ({
	src,
	minSidebarW = "16rem",
}) => {

	return (
		<HStack
			w="100vw"          /* never spill horizontally */
			maxH="100vh"       /* rule 4: shrink video if needed */
			align="stretch"
			overflow="hidden"  /* hide any accidental overflow */
			p={"24px"}
		>
			{/* 1 & 3 — the text column */}
			<Box
				bg="green.400"
				minW={"33vh"}
				flex="1 1 auto"   /* can grow once min-W is satisfied */
				p={4}
			>
				<Text>…your text…</Text>
			</Box>

			{/* 2 & 4 — the 4 : 3 video */}
			<AspectRatio
				ratio={4 / 3}
				flex="1 1 0"      /* steal every leftover pixel */
				maxH="100%"       /* never exceed the row height */
			>
				<video src={src} controls style={{ objectFit: "cover" }} />
			</AspectRatio>
		</HStack>
	);
};

export default VideoWithSidebar