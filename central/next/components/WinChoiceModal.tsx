"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Box, Dialog, HStack, Portal, VStack } from "@chakra-ui/react";
import { Canvas } from "@react-three/fiber";
import { Float, PresentationControls } from "@react-three/drei";
import { useClaw } from "@/components/providers";
import { toaster } from "@/components/ui/toaster";
import { useIsMobile } from "@/components/hooks/useIsMobile";
import Booster from "@/components/Booster";
import CardStack from "@/components/CardStack";
import { PACK, SHUFFLE, FLIP, STACK_APPROACH } from "@/lib/animConfig";

type Phase = "pack" | "tearing" | "revealing" | "shuffling" | "flipping" | "swiping";

const TIMINGS = {
	tearing: PACK.tearingMs,
	revealing: PACK.revealingMs,
	flipping: FLIP.desktopMs,
};

const AUTO_SHUFFLE_COUNT = SHUFFLE.count;

const WinChoiceModal = () => {
	const { roundWon, pendingWin, openBoosterWin, resellPendingWin, keepCardWin, dismissPendingWin } = useClaw();
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
	// Two independent gates for `entered`: Chakra's own dialog-enter has to
	// finish first (delayPassed), AND the GLB has to be loaded (meshReady).
	// Without the mesh gate the rise can race the fetch and the user sees a
	// half-loaded mesh pop into existence mid-climb.
	const [meshReady, setMeshReady] = useState(false);
	const [delayPassed, setDelayPassed] = useState(false);

	const ENTRY_DELAY_MS = PACK.entryDelayMs;
	const ENTRY_DURATION_MS = PACK.entryDurationMs;
	// Hard upper bound for waiting on the GLB. With useGLTF.preload() at
	// module load the mesh is normally cached well before this; the fallback
	// only fires for cold loads, slow networks, or load failures.
	const MESH_WAIT_TIMEOUT_MS = 1200;

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
			setDelayPassed(false);
			// meshReady is intentionally NOT reset — drei's useGLTF caches
			// the parsed scene globally, so once it's loaded it stays loaded
			// for the lifetime of the page.
			return;
		}
		// Chakra Dialog's own enter animation (~300ms) plays first; the rise
		// shouldn't start while the modal is still flying in.
		const t1 = setTimeout(() => setDelayPassed(true), ENTRY_DELAY_MS);
		// Fallback in case the GLB never reports ready (load failure, very
		// slow network) — start the rise anyway so the UI doesn't lock up.
		const t2 = setTimeout(() => setMeshReady(true), MESH_WAIT_TIMEOUT_MS);
		return () => {
			clearTimeout(t1);
			clearTimeout(t2);
		};
	}, [open]);

	// Rise starts when both gates are open: dialog-enter delay elapsed AND
	// the GLB is loaded (or the fallback timeout fired). Buttons follow
	// ENTRY_DURATION_MS after the rise begins.
	useEffect(() => {
		if (!open || entered) return;
		if (meshReady && delayPassed) setEntered(true);
	}, [open, meshReady, delayPassed, entered]);

	useEffect(() => {
		if (!entered) return;
		const t = setTimeout(() => setBoosterReady(true), ENTRY_DURATION_MS);
		return () => clearTimeout(t);
	}, [entered, ENTRY_DURATION_MS]);

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

		// Settle the win on the backend in parallel with the animation. The
		// response carries the actual revealed cards but we don't yet feed
		// them into CardStack (it still uses the mock seed in lib/cards.ts);
		// that's the next polish slice.
		if (pendingWin?.prize_kind === 'BOOSTER_PAIR') {
			openBoosterWin().then((res) => {
				if (!res.ok) console.warn('openBoosterWin failed:', res.error, res.code);
			});
		}
	};

	const handleResell = async () => {
		if (!pendingWin) { close(); return; }
		const res = await resellPendingWin();
		if (res.ok) {
			const cents = res.data?.credited_cents ?? 0;
			toaster.create({
				description: `Sold for $${(cents / 100).toFixed(2)}`,
				type: "success",
				duration: 2500,
			});
		} else {
			toaster.create({
				description: `Couldn't resell: ${res.error ?? "unknown error"}`,
				type: "error",
				duration: 2500,
			});
		}
		close();
	};

	const handleKeepCard = async () => {
		if (!pendingWin) { close(); return; }
		const res = await keepCardWin();
		if (res.ok) {
			toaster.create({
				description: "Added to your collection",
				type: "success",
				duration: 2000,
			});
		} else {
			toaster.create({
				description: `Couldn't keep card: ${res.error ?? "unknown error"}`,
				type: "error",
				duration: 2500,
			});
		}
		close();
	};

	// Local dismiss only — the Win row stays PENDING in the DB and shows up
	// in the user's inventory tab to act on later.
	const handleAddToInventory = () => {
		dismissPendingWin();
		close();
	};

	// "Open now" is the booster-pack reveal animation. For single-card wins
	// the same button position becomes "Add to collection" — different
	// backend call, no animation, since there's nothing to "open."
	const isSingleCard = pendingWin?.prize_kind === 'SINGLE_CARD';
	const primaryLabel = isSingleCard ? "Add to collection" : "Open now";
	const onPrimary = isSingleCard ? handleKeepCard : openPack;

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
						w="min(92vw, 660px)"
						borderRadius={0}
						p={0}
						overflow="visible"
						bg="transparent"
						boxShadow="none"
						style={{ background: "transparent", backdropFilter: "none", WebkitBackdropFilter: "none" }}
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
											<ambientLight intensity={8.45} />
											<directionalLight position={[2, 3, 4]} intensity={1.2} />
											<Suspense fallback={null}>
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
														<Booster onReady={() => setMeshReady(true)} />
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
									<button className="lg-btn" onClick={handleResell}>Resell</button>
									<button className="lg-btn" onClick={handleAddToInventory}>Add to inventory</button>
									<button className="lg-btn" onClick={onPrimary}>{primaryLabel}</button>
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
