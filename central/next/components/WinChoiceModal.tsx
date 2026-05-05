"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Box, Dialog, HStack, Portal, VStack } from "@chakra-ui/react";
import { Canvas } from "@react-three/fiber";
import { Environment, Float, PresentationControls } from "@react-three/drei";
import { useClaw } from "@/components/providers";
import Booster from "@/components/Booster";
import CardStack from "@/components/CardStack";

type Phase = "pack" | "tearing" | "revealing" | "flipping" | "swiping";

const TIMINGS = {
	tearing: 2100,   // pack slides down through the bottom of the canvas
	revealing: 200,  // brief beat to let the canvas fade out cleanly
	flipping: 700,   // top card flips face-up
};

const WinChoiceModal = () => {
	const { roundWon } = useClaw();
	const lastSeen = useRef(roundWon);
	const [open, setOpen] = useState(false);
	const [phase, setPhase] = useState<Phase>("pack");

	// `entered` gates the entry animation. We render the canvas Box at
	// translateY(100vh) on the very first frame so the pack starts below the
	// viewport, then flip to true on the next rAF so the CSS transition runs.
	// `boosterReady` flips once the rise-in animation finishes — buttons appear then.
	const [entered, setEntered] = useState(false);
	const [boosterReady, setBoosterReady] = useState(false);

	const ENTRY_DELAY_MS = 380;
	const ENTRY_DURATION_MS = 1500;

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

	useEffect(() => {
		if (!open) {
			setEntered(false);
			setBoosterReady(false);
			return;
		}
		// Delay past Chakra Dialog's own enter animation (~300ms) so the user
		// actually sees the pack rise into view, not animate while invisible.
		const t1 = setTimeout(() => setEntered(true), ENTRY_DELAY_MS);
		const t2 = setTimeout(() => setBoosterReady(true), ENTRY_DELAY_MS + ENTRY_DURATION_MS);
		return () => {
			clearTimeout(t1);
			clearTimeout(t2);
		};
	}, [open]);

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
	const canvasOpacity = phase === "flipping" || phase === "swiping" ? 0 : 1;
	// Cards live BEHIND the pack (see JSX order). They fade in as soon as the
	// pack starts dropping so the receding pack reveals them.
	const stackOpacity  = phase === "pack" ? 0 : 1;
	// Cards start far back in z while the pack is still in view, then come
	// forward to z=0 once the pack is gone.
	const stackZ        = phase === "pack" || phase === "tearing" ? -400 : 0;
	const stackPointer  = phase === "swiping";

	return (
		<Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)} placement="center">
			<Portal>
				<Dialog.Backdrop className="lg-drawer-backdrop" />
				<Dialog.Positioner overflow="hidden">
					<Dialog.Content
						className="glass holo-rim"
						w="min(92vw, 660px)"
						borderRadius="1.75rem"
						p={0}
						overflow="visible"
						bg="transparent"
					>
						<VStack gap={5} p={6}>
							<Box
								position="relative"
								w="full"
								aspectRatio="10 / 11"
								borderRadius="1.25rem"
								overflow="visible"
							>
								{/* Layer B — 2D card stack (BEHIND the pack so the dropping pack reveals it) */}
								<Box
									position="absolute"
									inset={0}
									transition="opacity 700ms ease, transform 900ms cubic-bezier(0.16, 1, 0.3, 1)"
									style={{
										opacity: stackOpacity,
										transform: `perspective(1200px) translateZ(${stackZ}px)`,
										transformStyle: "flat",
										pointerEvents: stackPointer ? "auto" : "none",
									}}
								>
									{phase !== "pack" && (
										<CardStack flipFirst={phase === "flipping" || phase === "swiping"} />
									)}
								</Box>

								{/* Layer A — 3D pack (IN FRONT). Enters from below the viewport
								    (translateY 100vh → 0 with expo-out), then falls back through
								    the bottom on tearing (0 → 100vh with ease-in). The canvas tree
								    shape is kept stable across phases — Float speeds + Presentation
								    Controls clamps just go to zero when not in 'pack' so Booster
								    doesn't unmount/remount and the GLTF scene isn't double-attached.
								    Box extends past the inner area on top/left/right so rotation
								    tips don't clip at the canvas edge. Bottom stays at 0 to avoid
								    overlapping the button row below. */}
								<Box
									position="absolute"
									top="-15%"
									left="-15%"
									right="-15%"
									bottom={0}
									transition={
										phase === "pack"
											? "transform 1800ms cubic-bezier(0.16, 1, 0.3, 1)"
											: "transform 1300ms cubic-bezier(0.55, 0, 0.85, 0.5)"
									}
									style={{
										opacity: canvasOpacity,
										transform: entered && phase === "pack"
											? "translateY(0)"
											: "translateY(100vh)",
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
											<Suspense fallback={null}>
												<Environment preset="studio" />
												<PresentationControls
													global
													snap
													polar={phase === "pack" ? [-Math.PI / 4, Math.PI / 4] : [0, 0]}
													azimuth={phase === "pack" ? [-Math.PI, Math.PI] : [0, 0]}
													config={{ mass: 1, tension: 170, friction: 26 }}
												>
													<Float
														speed={phase === "pack" ? 1.2 : 0}
														rotationIntensity={phase === "pack" ? 0.35 : 0}
														floatIntensity={phase === "pack" ? 0.5 : 0}
													>
														<Booster />
													</Float>
												</PresentationControls>
											</Suspense>
										</Canvas>
									)}
								</Box>
							</Box>

							{phase === "pack" && (
								<HStack
									gap={3}
									w="full"
									justify="center"
									wrap="wrap"
									transition="opacity 350ms ease, transform 350ms ease"
									style={{
										opacity: boosterReady ? 1 : 0,
										transform: boosterReady ? "translateY(0)" : "translateY(8px)",
										pointerEvents: boosterReady ? "auto" : "none",
									}}
								>
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
