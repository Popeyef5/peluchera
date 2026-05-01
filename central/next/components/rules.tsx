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
		placement={"bottom"}
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
			<Drawer.Positioner pos={containerRef ? "absolute" : "fixed"} boxSize={"full"}>
				<Drawer.Content
					borderTopRadius={"1.5rem"}
					borderBottomRadius={isMobile ? "0" : "1.5rem"}
					color={{ base: "white", _dark: "black" }}
					backgroundColor={{ base: "black", _dark: "white" }}
				>
					<Drawer.Header>
						<Drawer.Title>Rules</Drawer.Title>
					</Drawer.Header>
					<Drawer.Body >
						<VStack gap={8}>
							<VStack gap={4} align={"start"}>
								<p>Pay to play, control the claw, and try to grab a sphere. Each sphere holds a Pokémon booster pack.</p>
								<p>If you grab one, you choose what to do with the pack:</p>
								<p>• <b>Cash out</b> instantly for its USDC value.</p>
								<p>• <b>Hold in your vault</b> for up to 30 days, then request bulk shipping of all your loot.</p>
								<p>Pack rarity is shown in the &quot;What&apos;s in the machine&quot; panel. Odds are fixed per pack tier.</p>
							</VStack>
							<Card.Root variant={"elevated"} backgroundColor={"gray.400"}>
								<Card.Header><Text fontWeight={500}>Example</Text></Card.Header>
								<Card.Body>
									<p>You grab a Rare pack ($12 cash-out value).</p>
									<p>Cash out → $12 USDC in your wallet.</p>
									<p>Hold in vault → keep the physical pack, ship it with the rest of your wins anytime within 30 days.</p>
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