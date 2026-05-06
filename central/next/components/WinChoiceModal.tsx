"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { Box, Dialog, HStack, Portal, VStack } from "@chakra-ui/react";
import { Canvas } from "@react-three/fiber";
import { Environment, Float, PresentationControls } from "@react-three/drei";
import { useClaw } from "@/components/providers";
import { useIsMobile } from "@/components/hooks/useIsMobile";
import Booster from "@/components/Booster";
import CardStack from "@/components/CardStack";
import { PACK, SHUFFLE, FLIP, STACK_APPROACH } from "@/lib/animConfig";

type Phase = "pack" | "tearing" | "revealing" | "shuffling" | "flipping" | "swiping";

// Tiny error boundary so a failed HDR fetch (drei's Environment loads an
// external file from pmndrs/drei-assets) doesn't crash the whole canvas.
class SilentBoundary extends React.Component<
	{ children: React.ReactNode; fallback?: React.ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };
	static getDerivedStateFromError() { return { failed: true }; }
	componentDidCatch() {/* swallow — fallback renders */}
	render() {
		return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
	}
}

const TIMINGS = {
	tearing: PACK.tearingMs,
	revealing: PACK.revealingMs,
	flipping: FLIP.desktopMs,
};

const AUTO_SHUFFLE_COUNT = SHUFFLE.count;

const WinChoiceModal = () => {
	const { roundWon } = useClaw();
	const isMobile = useIsMobile();
	const lastSeen = useRef(roundWon);
	const [open, setOpen] = useState(false);
	const [phase, setPhase] = useState<Phase>("pack");

	// `entered` gates the entry animation. We render the canvas Box at
	// translateY(100vh) on the very first frame so the pack starts below the
	// viewport, then flip to true on the next rAF so the CSS transition runs.
	// `boosterReady` flips once the rise-in animation finishes — buttons appear then.
	const [entered, setEntered] = useState(false);
	const [boosterReady, setBoosterReady] = useState(false);

	const ENTRY_DELAY_MS = PACK.entryDelayMs;
	const ENTRY_DURATION_MS = PACK.entryDurationMs;

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

	// Test hook — /test-win route dispatches this event 3s after mount so we can
	// preview the win flow on mobile without going through the full claw cycle.
	useEffect(() => {
		const onTestWin = () => {
			console.log("[WinChoiceModal] test-win received");
			(window as Window & { __garraTestWin?: boolean }).__garraTestWin = false;
			setPhase("pack");
			setOpen(true);
		};
		window.addEventListener("garra:test-win", onTestWin);
		// Late-mount fallback: heavy dynamic-import bundles on mobile can take
		// longer than the test-win 3s delay, so the event may fire before this
		// listener attaches. Check the flag set by the test-win page and fire
		// retroactively if needed.
		if ((window as Window & { __garraTestWin?: boolean }).__garraTestWin) {
			onTestWin();
		}
		return () => window.removeEventListener("garra:test-win", onTestWin);
	}, []);

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
		// iOS DeviceOrientationEvent.requestPermission() must run inside a user
		// gesture. We fire-and-forget here; HoloCard listens for the resulting
		// 'garra:tilt-granted' event to start its orientation handler.
		(async () => {
			type DOEWithPermission = typeof DeviceOrientationEvent & {
				requestPermission?: () => Promise<"granted" | "denied" | "default">;
			};
			const DOE = (typeof DeviceOrientationEvent !== "undefined"
				? (DeviceOrientationEvent as unknown as DOEWithPermission)
				: null);
			const grant = () => {
				try { sessionStorage.setItem("garra:tilt-granted", "1"); } catch {}
				window.dispatchEvent(new CustomEvent("garra:tilt-granted"));
			};
			if (DOE?.requestPermission) {
				try {
					const result = await DOE.requestPermission();
					if (result === "granted") grant();
				} catch {
					/* user denied or unavailable */
				}
			} else {
				// No permission gate (Android / desktop) — just signal availability.
				grant();
			}
		})();

		setPhase("tearing");
		setTimeout(() => setPhase("revealing"), TIMINGS.tearing);
		setTimeout(() => setPhase("shuffling"), TIMINGS.tearing + TIMINGS.revealing);
		// shuffling → flipping is triggered by CardStack's onAutoShuffleComplete
	};

	const onAutoShuffleComplete = () => {
		setPhase("flipping");
		setTimeout(() => setPhase("swiping"), TIMINGS.flipping);
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
	// forward to z=0 once the pack is gone. Mobile cards are bigger, so they
	// start ~50% further away to feel like a proper "approach" reveal.
	const initialZ = isMobile ? STACK_APPROACH.initialZMobile : STACK_APPROACH.initialZ;
	const stackZ   = phase === "pack" || phase === "tearing" ? initialZ : 0;
	const stackPointer  = phase === "swiping";

	return (
		<Dialog.Root open={open} onOpenChange={(e) => setOpen(e.open)} placement="center">
			<Portal>
				<Dialog.Backdrop className="lg-drawer-backdrop" />
				<Dialog.Positioner overflow="hidden">
					<Dialog.Content
						className={isMobile ? undefined : "glass holo-rim"}
						w="min(92vw, 660px)"
						borderRadius={isMobile ? 0 : "1.75rem"}
						p={0}
						overflow="visible"
						bg="transparent"
						boxShadow={isMobile ? "none" : undefined}
						style={isMobile ? { background: "transparent", backdropFilter: "none", WebkitBackdropFilter: "none" } : undefined}
					>
						<VStack gap={5} p={6} bg="transparent">
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
										<CardStack
											flipFirst={phase === "flipping" || phase === "swiping"}
											autoShuffles={phase === "shuffling" ? AUTO_SHUFFLE_COUNT : 0}
											onAutoShuffleComplete={onAutoShuffleComplete}
										/>
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
								{(phase === "pack" || phase === "tearing") && (
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
											gl={{ antialias: true, alpha: true, premultipliedAlpha: false }}
											onCreated={({ gl }) => {
												gl.setClearColor(0x000000, 0);
											}}
											style={{ background: "transparent" }}
										>
											<ambientLight intensity={0.45} />
											<directionalLight position={[2, 3, 4]} intensity={1.2} />
											<Suspense fallback={null}>
												<SilentBoundary>
													<Environment preset="studio" />
												</SilentBoundary>
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
								)}
							</Box>

							{/* Fixed-height button slot. Both button rows are always mounted
							    inside, absolutely-positioned, and fade between phases — keeps
							    the canvas above from reflowing when buttons swap in/out.
							    Mobile gets extra top margin because the bigger cards extend
							    past the inner Box vertically. */}
							<Box
								position="relative"
								w="full"
								minH="2.75rem"
								mt={isMobile ? "3rem" : 0}
							>
								<HStack
									gap={3}
									w="full"
									justify="center"
									wrap="wrap"
									position="absolute"
									inset={0}
									transition="opacity 350ms ease, transform 350ms ease"
									style={{
										opacity: phase === "pack" && boosterReady ? 1 : 0,
										transform: phase === "pack" && boosterReady
											? "translateY(0)"
											: "translateY(8px)",
										pointerEvents: phase === "pack" && boosterReady ? "auto" : "none",
									}}
								>
									<button className="lg-btn" onClick={close}>Resell</button>
									<button className="lg-btn" onClick={close}>Store</button>
									<button className="lg-btn" onClick={openPack}>Open now</button>
								</HStack>

								<HStack
									gap={3}
									w="full"
									justify="center"
									position="absolute"
									inset={0}
									transition="opacity 350ms ease"
									style={{
										opacity: phase === "swiping" ? 1 : 0,
										pointerEvents: phase === "swiping" ? "auto" : "none",
									}}
								>
									<button className="lg-btn" onClick={close}>Done</button>
								</HStack>
							</Box>
						</VStack>
					</Dialog.Content>
				</Dialog.Positioner>
			</Portal>
		</Dialog.Root>
	);
};

export default WinChoiceModal;
