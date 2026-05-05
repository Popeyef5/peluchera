"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Dialog, HStack, Portal, VStack } from "@chakra-ui/react";
import { Canvas } from "@react-three/fiber";
import { Environment, Float, PresentationControls } from "@react-three/drei";
import { useClaw } from "@/components/providers";
import Booster from "@/components/Booster";

const WinChoiceModal = () => {
	const { roundWon } = useClaw();
	const lastSeen = useRef(roundWon);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (roundWon > lastSeen.current) {
			lastSeen.current = roundWon;
			setOpen(true);
		}
	}, [roundWon]);

	const close = () => setOpen(false);

	return (
		<Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)} placement="center">
			<Portal>
				<Dialog.Backdrop className="lg-drawer-backdrop" />
				<Dialog.Positioner>
					<Dialog.Content
						className="glass holo-rim"
						w="min(90vw, 540px)"
						borderRadius="1.75rem"
						p={0}
						overflow="hidden"
						bg="transparent"
					>
						<VStack gap={5} p={6}>
							<Box w="full" aspectRatio={1} borderRadius="1.25rem" overflow="hidden">
								{open && (
									<Canvas
										camera={{ position: [0, 0, 3.2], fov: 35 }}
										dpr={[1, 2]}
										gl={{ antialias: true, alpha: true }}
									>
										<ambientLight intensity={0.45} />
										<directionalLight position={[2, 3, 4]} intensity={1.2} />
										<Environment preset="studio" />
										<PresentationControls
											global
											snap
											polar={[-Math.PI / 4, Math.PI / 4]}
											azimuth={[-Math.PI, Math.PI]}
											config={{ mass: 1, tension: 170, friction: 26 }}
										>
											<Float speed={1.2} rotationIntensity={0.35} floatIntensity={0.5}>
												<Booster />
											</Float>
										</PresentationControls>
									</Canvas>
								)}
							</Box>
							<HStack gap={3} w="full" justify="center" wrap="wrap">
								<button className="lg-btn" onClick={close}>Resell</button>
								<button className="lg-btn" onClick={close}>Store</button>
								<button className="lg-btn" onClick={close}>Open now</button>
							</HStack>
						</VStack>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
};

export default WinChoiceModal;
