import { Button, CloseButton, Dialog, Portal, VStack, Text, Card } from "@chakra-ui/react"

interface RulesProps {
	w: number;
}

const Rules = ({w}: RulesProps) => {
	return (
		<Dialog.Root placement={"center"}>
			<Dialog.Trigger asChild>
				<Button borderRadius="1rem" fontSize="md" w={w}>
					Rules
				</Button>
			</Dialog.Trigger>
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content>
						<Dialog.Header>
							<Dialog.Title>Rules</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<VStack gap={8}>
								<VStack gap={4} align={"start"}>
									<p>Every time you play, your USDC goes into a prize pool.</p>
									<p>20% is taken as a fee. The rest is split among all the winners at the end of the epoch (each lasts 24h).</p>
									<p>Every win earns you one share of the prize pool.</p>
									<p>If you win multiple times, you get multiple shares.</p>
								</VStack>
								<Card.Root variant={"elevated"} backgroundColor={"gray.400"}>
									<Card.Header><Text fontWeight={500}>Example</Text></Card.Header>
									<Card.Body>
										<p>Final prize pool: $1000</p>
										<p>Total wins: 20 → each win = $50</p>
										<p>You won 2 times → you get $100</p>
									</Card.Body>
								</Card.Root>
							</VStack>
						</Dialog.Body>
						<Dialog.Footer>
							<Dialog.ActionTrigger asChild>
								<Button>Ok</Button>
							</Dialog.ActionTrigger>
						</Dialog.Footer>
						<Dialog.CloseTrigger asChild>
							<CloseButton size="sm" />
						</Dialog.CloseTrigger>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	)
}

export default Rules