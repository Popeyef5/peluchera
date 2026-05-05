"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Dialog, HStack, Portal, VStack } from "@chakra-ui/react";
import { Canvas } from "@react-three/fiber";
import { Environment, Float, PresentationControls } from "@react-three/drei";
import { useClaw } from "@/components/providers";
import Booster from "@/components/Booster";
import CardStack from "@/components/CardStack";

type Phase = "pack" | "tearing" | "revealing" | "flipping" | "swiping";

const TIMINGS = {
	tearing: 600,    // pack shrinks + sparkles
	revealing: 500,  // canvas fades out, stack fades in
	flipping: 700,   // top card flips face-up
};

const WinChoiceModal = () => {
	const { roundWon } = useClaw();
	const lastSeen = useRef(roundWon);
	const [open, setOpen] = useState(false);
	const [phase, setPhase] = useState<Phase>("pack");

	useEffect(() => {
		console.log('[WinChoiceModal] phase ->', phase);
	}, [phase]);

	useEffect(() => {
		if (roundWon > lastSeen.current) {
			lastSeen.current = roundWon;
			setPhase("pack");
			setOpen(true);
		}
	}, [roundWon]);

	const close = () => setOpen(false);

	const openPack = () => {
		setPhase("tearing");
		setTimeout(() => setPhase("revealing"), TIMINGS.tearing);
		setTimeout(() => setPhase("flipping"), TIMINGS.tearing + TIMINGS.revealing);
		setTimeout(
			() => setPhase("swiping"),
			TIMINGS.tearing + TIMINGS.revealing + TIMINGS.flipping,
		);
	};

	// Reset phase when modal closes so next win starts fresh.
	useEffect(() => {
		if (!open) {
			const t = setTimeout(() => setPhase("pack"), 300);
			return () => clearTimeout(t);
		}
	}, [open]);

	const showCanvas = open && phase !== "swiping";
	const canvasOpacity = phase === "revealing" || phase === "flipping" || phase === "swiping" ? 0 : 1;
	const stackOpacity  = phase === "revealing" ? 0.3 : phase === "flipping" || phase === "swiping" ? 1 : 0;
	const stackPointer  = phase === "swiping";

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
							<Box
								position="relative"
								w="full"
								aspectRatio={1}
								borderRadius="1.25rem"
								overflow="visible"
							>
								{/* Layer A — 3D pack */}
								<Box
									position="absolute"
									inset={0}
									transition="opacity 500ms ease"
									style={{
										opacity: canvasOpacity,
										pointerEvents: phase === "pack" ? "auto" : "none",
									}}
								>
									{showCanvas && (
										<Canvas
											camera={{ position: [0, 0, 3.2], fov: 35 }}
											dpr={[1, 2]}
											gl={{ antialias: true, alpha: true }}
										>
											<ambientLight intensity={0.45} />
											<directionalLight position={[2, 3, 4]} intensity={1.2} />
											<Environment preset="studio" />
											{phase === "pack" ? (
												<PresentationControls
													global
													snap
													polar={[-Math.PI / 4, Math.PI / 4]}
													azimuth={[-Math.PI, Math.PI]}
													config={{ mass: 1, tension: 170, friction: 26 }}
												>
													<Float speed={1.2} rotationIntensity={0.35} floatIntensity={0.5}>
														<Booster tearing={false} />
													</Float>
												</PresentationControls>
											) : (
												<Booster tearing={phase === "tearing" || phase === "revealing"} />
											)}
										</Canvas>
									)}
								</Box>

								{/* Layer B — 2D card stack */}
								<Box
									position="absolute"
									inset={0}
									transition="opacity 500ms ease"
									style={{
										opacity: stackOpacity,
										pointerEvents: stackPointer ? "auto" : "none",
									}}
								>
									{(phase === "revealing" || phase === "flipping" || phase === "swiping") && (
										<CardStack flipFirst={phase === "flipping" || phase === "swiping"} />
									)}
								</Box>
							</Box>

							{phase === "pack" && (
								<HStack gap={3} w="full" justify="center" wrap="wrap">
									<button className="lg-btn" onClick={close}>Resell</button>
									<button className="lg-btn" onClick={close}>Store</button>
									<button className="lg-btn" onClick={openPack}>Open now</button>
								</HStack>
							)}

							{phase === "swiping" && (
								<HStack gap={3} w="full" justify="center">
									<button className="lg-btn" onClick={close}>Done</button>
								</HStack>
							)}
						</VStack>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
};

export default WinChoiceModal;
