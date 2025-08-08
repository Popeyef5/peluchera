import { Button, Portal, VStack, Text, Card, Drawer } from "@chakra-ui/react"
import { useIsMobile } from "./hooks/useIsMobile";
import { useState } from "react";

interface RulesProps {
	w: number | string;
	containerRef?: React.RefObject<HTMLElement | null>
}

const Rules = ({ w, containerRef }: RulesProps) => {
	const isMobile = useIsMobile();
	const [drawerOpen, setDrawerOpen] = useState(false);

	return <Drawer.Root
		placement={isMobile ? "top" : "bottom"}
		open={drawerOpen}
		onOpenChange={(e) => { setDrawerOpen(e.open) }}
	>
		<Drawer.Trigger asChild>
			<Button borderRadius="1.5rem" fontSize="lg" w={w} p={"3vh"}>
				Rules
			</Button>
		</Drawer.Trigger>
		<Portal container={containerRef}>
			<Drawer.Backdrop />
			<Drawer.Positioner pos={"absolute"} boxSize={"full"}>
				<Drawer.Content
					borderBottomRadius={"1.5rem"}
					borderTopRadius={isMobile ? "0" : "1.5rem"}
					color={{ base: "white", _dark: "black" }}
					backgroundColor={{ base: "black", _dark: "white" }}
				>
					<Drawer.Header>
						<Drawer.Title>Rules</Drawer.Title>
					</Drawer.Header>
					<Drawer.Body >
						<VStack gap={8}>
							<VStack gap={4} align={"start"}>
								<p>Every time you play, your USDC goes into a prize pool.</p>
								<p>Every win earns you one share of the prize pool.</p>
								<p>At the end of each epoch (24h), the prize pool (minus a fee) is split amongst the winners. Each one gets a cut proportional to their numner of shares.</p>
								<p>The fee will not exceed 20% and winners will never lose money.</p>
							</VStack>
							<Card.Root variant={"elevated"} backgroundColor={"gray.400"}>
								<Card.Header><Text fontWeight={500}>Example</Text></Card.Header>
								<Card.Body>
									<p>Final prize pool: $1000</p>
									<p>Prize after fee: $800</p>
									<p>Total wins: 20 → each win = $40</p>
									<p>You won 2 times → you get $80</p>
								</Card.Body>
							</Card.Root>
						</VStack>
					</Drawer.Body>
					<Drawer.Footer>
						{/* <Drawer.Title>Drawer Title</Drawer.Title> */}
					</Drawer.Footer>
				</Drawer.Content>
			</Drawer.Positioner>
		</Portal>
	</Drawer.Root>
}

export default Rules