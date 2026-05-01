"use client";

import { Box, Heading, HStack, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import Link from "next/link";
import { VARIANTS } from "./registry";

export default function VariantsIndex() {
	return (
		<VStack p={6} align="stretch" gap={6} minH="100vh">
			<HStack justify="space-between" align="end">
				<VStack align="start" gap={1}>
					<Heading size="lg">UI variants — contact sheet</Heading>
					<Text fontSize="sm" opacity={0.7}>
						{VARIANTS.length} variant{VARIANTS.length === 1 ? "" : "s"}. Click a tile to open full-size.
					</Text>
				</VStack>
			</HStack>
			<SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap={6}>
				{VARIANTS.map((v) => (
					<VStack key={v.slug} align="stretch" gap={2}>
						<HStack justify="space-between">
							<Text fontWeight={600}>{v.label}</Text>
							<Link href={`/variants/${v.slug}`} target="_blank">
								<Text fontSize="sm" textDecoration="underline">open ↗</Text>
							</Link>
						</HStack>
						{v.notes && <Text fontSize="xs" opacity={0.6}>{v.notes}</Text>}
						<Box
							borderRadius="md"
							borderWidth={1}
							overflow="hidden"
							aspectRatio={16 / 10}
							bg="black"
						>
							<iframe
								src={`/variants/${v.slug}`}
								title={v.label}
								style={{ width: "100%", height: "100%", border: 0 }}
							/>
						</Box>
					</VStack>
				))}
			</SimpleGrid>
		</VStack>
	);
}
