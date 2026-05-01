"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Dialog, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import { useClaw } from "@/components/providers";
import { toaster } from "@/components/ui/toaster";

type Pack = {
	name: string;
	tier: "common" | "rare" | "chase";
	cashOutValue: string;
};

const SAMPLE_PACKS: Pack[] = [
	{ name: "Scarlet & Violet — Surging Sparks", tier: "common", cashOutValue: "$4.00" },
	{ name: "Twilight Masquerade", tier: "rare", cashOutValue: "$12.00" },
	{ name: "151 Booster Bundle", tier: "chase", cashOutValue: "$60.00" },
];

const pickRandomPack = (): Pack => SAMPLE_PACKS[Math.floor(Math.random() * SAMPLE_PACKS.length)];

const WinChoiceModal = () => {
	const { roundWon } = useClaw();
	const lastSeen = useRef(roundWon);
	const [open, setOpen] = useState(false);
	const [pack, setPack] = useState<Pack | null>(null);

	useEffect(() => {
		if (roundWon > lastSeen.current) {
			lastSeen.current = roundWon;
			setPack(pickRandomPack());
			setOpen(true);
		}
	}, [roundWon]);

	const handleCashOut = () => {
		if (!pack) return;
		toaster.create({
			description: `Cashed out for ${pack.cashOutValue}`,
			type: "success",
			duration: 2500,
		});
		setOpen(false);
	};

	const handleVault = () => {
		if (!pack) return;
		toaster.create({
			description: `${pack.name} stored in your vault`,
			type: "success",
			duration: 2500,
		});
		setOpen(false);
	};

	return (
		<Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)} placement="center">
			<Portal>
				<Dialog.Backdrop />
				<Dialog.Positioner>
					<Dialog.Content borderRadius="1.5rem" p={4}>
						<Dialog.Header>
							<Dialog.Title>You won a pack!</Dialog.Title>
						</Dialog.Header>
						<Dialog.Body>
							<VStack gap={4} align="stretch">
								<Text fontSize="lg" fontWeight={600}>
									{pack?.name}
								</Text>
								<Text>
									Cash out instantly, or hold it in your vault and ship it out later
									with the rest of your loot (up to 30 days).
								</Text>
							</VStack>
						</Dialog.Body>
						<Dialog.Footer>
							<HStack w="full" justify="space-between">
								<Button variant="outline" onClick={handleCashOut}>
									Cash out {pack?.cashOutValue}
								</Button>
								<Button onClick={handleVault}>Hold in vault</Button>
							</HStack>
						</Dialog.Footer>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
};

export default WinChoiceModal;
