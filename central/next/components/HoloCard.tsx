"use client";

import React, { useEffect, useRef, useState } from "react";
import { CARD_BACK_IMAGE, type Rarity, type Supertype } from "@/lib/cards";
import { useIsMobile } from "@/components/hooks/useIsMobile";
import { TILT, FOIL } from "@/lib/animConfig";

type Props = {
	image: string;
	faceUp: boolean;
	rarity?: Rarity;
	supertype?: Supertype;
	subtypes?: string[];
	mask?: string;
	trainerGallery?: boolean;
	className?: string;
	// When true: skip the foil overlay layers and the orientation/pointer
	// listener. Used for non-active stack slots and the in-flight departing
	// card to keep mobile composition cost down.
	decorative?: boolean;
};

const MAX_TILT_DEG = TILT.maxDeg;
const TILT_FALLOFF_PX = TILT.falloffPx;

// Module-level shared rest calibration for mobile orientation tilt. All
// HoloCards on the page read from these so every card uses the SAME zero
// baseline — otherwise each card captures its own rest at mount time and you
// get cards that respond off slightly different baselines, producing the
// "stacked / amplified" tilt effect the user reported.
let sharedRestBeta: number | null = null;
let sharedRestGamma: number | null = null;
const clearSharedRest = () => { sharedRestBeta = null; sharedRestGamma = null; };
if (typeof window !== "undefined") {
	window.screen?.orientation?.addEventListener?.("change", clearSharedRest);
}

/**
 * Layered holographic card. Three nested transform layers:
 *   __translater  →  framer-controlled position (set by parent)
 *   __rotator     →  rotateY/rotateX driven by CSS vars from pointer tracking
 *   __front/__back/__shine/__glare  →  flat faces + foil overlays
 *
 * Tilt behavior is inverted from the usual: when the pointer is *outside* the
 * card's bounding rect, the rotator tilts toward the pointer; when inside,
 * the rotator snaps to neutral (so drag works cleanly). Per-card pointer
 * listener is rAF-throttled.
 */
export default function HoloCard({
	image,
	faceUp,
	rarity = "common",
	supertype,
	subtypes,
	mask,
	trainerGallery,
	className,
	decorative,
}: Props) {
	const cardRef = useRef<HTMLDivElement>(null);
	const rotatorRef = useRef<HTMLDivElement>(null);
	const [frontOk, setFrontOk] = useState(true);
	const [backOk, setBackOk] = useState(true);
	const isMobile = useIsMobile();

	useEffect(() => {
		const img = new Image();
		img.onload = () => setFrontOk(true);
		img.onerror = () => setFrontOk(false);
		img.src = image;
	}, [image]);

	useEffect(() => {
		const img = new Image();
		img.onload = () => setBackOk(true);
		img.onerror = () => setBackOk(false);
		img.src = CARD_BACK_IMAGE;
	}, []);

	// Desktop: outside-pointer tilt — card tilts toward the cursor when it's
	// outside the card, snaps to neutral when inside (so drag works).
	useEffect(() => {
		// Skip tilt when face-down: foil isn't visible anyway, and the
		// constant rotator transform updates can interfere with iOS Safari's
		// compositor during the auto-shuffle motion animations.
		if (isMobile || decorative || !faceUp) return;
		let raf = 0;
		let pendingX = 0;
		let pendingY = 0;
		const rotator = rotatorRef.current;
		const card = cardRef.current;
		if (!rotator || !card) return;

		// Verbatim port of simey's interact() formulas — see
		// simeydotme/pokemon-cards-css src/lib/components/Card.svelte.
		// Listener fires only while the cursor is over the card; outside,
		// vars decay (we set --card-opacity = 0 on leave).
		const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
		const adjust = (v: number, fromMin: number, fromMax: number, toMin: number, toMax: number) =>
			toMin + ((v - fromMin) / (fromMax - fromMin)) * (toMax - toMin);

		const apply = () => {
			raf = 0;
			const rect = card.getBoundingClientRect();
			const absX = pendingX - rect.left;
			const absY = pendingY - rect.top;
			const px = clamp((100 / rect.width) * absX);   // 0..100, clamped
			const py = clamp((100 / rect.height) * absY);
			const cx = px - 50;                            // -50..+50
			const cy = py - 50;

			// Rotation: simey uses /3.5 (≈14° max). We expose the divisor as
			// TILT.maxDeg via 50 / maxDeg so the user can tune amplitude.
			const rotDivisor = 50 / MAX_TILT_DEG;
			rotator.style.setProperty("--rotate-x", `${-cx / rotDivisor}deg`);
			rotator.style.setProperty("--rotate-y", `${cy / rotDivisor}deg`);

			// Background parallax: simey's narrow 37–63% / 33–67% remap.
			rotator.style.setProperty("--background-x", `${adjust(px, 0, 100, 37, 63)}%`);
			rotator.style.setProperty("--background-y", `${adjust(py, 0, 100, 33, 67)}%`);

			// Glare position = raw cursor%.
			rotator.style.setProperty("--pointer-x", `${px}%`);
			rotator.style.setProperty("--pointer-y", `${py}%`);

			// Filter inputs: simey divides by 50, not the half-diagonal.
			const fromCenter = clamp(Math.hypot(cy, cx) / 50, 0, 1);
			rotator.style.setProperty("--pointer-from-center", `${fromCenter}`);
			rotator.style.setProperty("--pointer-from-top", `${py / 100}`);
			rotator.style.setProperty("--pointer-from-left", `${px / 100}`);

			// Opacity: 1 while interacting (matches simey's hover state).
			// FOIL.opacityFloor/Range still let the user dim if they want.
			rotator.style.setProperty(
				"--card-opacity",
				`${FOIL.opacityFloor + FOIL.opacityRange * 1}`,
			);
		};

		const onMove = (e: PointerEvent) => {
			pendingX = e.clientX;
			pendingY = e.clientY;
			if (!raf) raf = requestAnimationFrame(apply);
		};

		const onLeave = () => {
			rotator.style.setProperty("--card-opacity", "0");
		};

		// Listener attaches to the card itself — simey's behavior: only fire
		// while cursor is over the card.
		card.addEventListener("pointermove", onMove);
		card.addEventListener("pointerleave", onLeave);
		return () => {
			card.removeEventListener("pointermove", onMove);
			card.removeEventListener("pointerleave", onLeave);
			if (raf) cancelAnimationFrame(raf);
		};
	}, [isMobile, decorative, faceUp]);

	// Mobile: device-orientation tilt — physically tilting the phone drives
	// the same CSS vars (rotate-x/y, pointer-x/y, card-opacity) so the foil
	// and glare respond as if you held the card in your hand. Activated only
	// after the parent dispatches 'garra:tilt-granted' (fired post-permission
	// from the Open Now button on iOS, or immediately on Android/desktop).
	useEffect(() => {
		if (!isMobile || decorative || !faceUp) return;
		const rotator = rotatorRef.current;
		if (!rotator) return;
		let raf = 0;
		let beta = 0;
		let gamma = 0;
		let attached = false;

		const TILT_SENSITIVITY = TILT.sensitivity;
		const TILT_DEAD_ZONE_DEG = TILT.deadZoneDeg;

		const getScreenAngle = (): number => {
			// Returns one of 0, 90, -90, 180 — accounts for landscape orientation.
			const o = (window.screen?.orientation?.angle ?? 0);
			return o === 270 ? -90 : o;
		};

		const apply = () => {
			raf = 0;
			// Use the SHARED rest baseline so every card on the page tilts off
			// the same zero point. The first listener to fire captures rest;
			// every subsequent card reads from the same module-level value.
			if (sharedRestBeta == null || sharedRestGamma == null) {
				sharedRestBeta = beta;
				sharedRestGamma = gamma;
			}
			let dBeta = beta - sharedRestBeta;
			let dGamma = gamma - sharedRestGamma;

			// Account for landscape orientation: swap/flip axes accordingly.
			const angle = getScreenAngle();
			if (angle === 90)        { const t = dBeta;  dBeta = -dGamma; dGamma = t;  }
			else if (angle === -90)  { const t = dBeta;  dBeta = dGamma;  dGamma = -t; }
			else if (angle === 180)  { dBeta = -dBeta;   dGamma = -dGamma; }

			// Dead zone — kill jitter when phone is held still
			if (Math.abs(dGamma) < TILT_DEAD_ZONE_DEG) dGamma = 0;
			if (Math.abs(dBeta)  < TILT_DEAD_ZONE_DEG) dBeta = 0;

			// Lateral (gamma) flipped: when you tilt the phone right, a real foil's
			// reflection moves the *opposite* way as the surface normal rotates.
			const tiltX = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, -dGamma * TILT_SENSITIVITY));
			const tiltY = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, dBeta * TILT_SENSITIVITY));

			// On mobile we DON'T set --rotate-x / --rotate-y: the phone is already
			// physically tilting in the user's hand, so the card moving in the
			// frame would feel weird. We only drive the foil/glare/background
			// projection so the holo effect responds as if light were hitting it.
			const px = 50 + (tiltX / MAX_TILT_DEG) * 50;
			const py = 50 + (-tiltY / MAX_TILT_DEG) * 50;
			rotator.style.setProperty("--pointer-x", `${px}%`);
			rotator.style.setProperty("--pointer-y", `${py}%`);

			const norm = Math.min(1, Math.hypot(tiltX, tiltY) / MAX_TILT_DEG);
			rotator.style.setProperty("--card-opacity", `${FOIL.opacityFloor + FOIL.opacityRange * norm}`);
			rotator.style.setProperty("--background-x", `${50 + (tiltX / MAX_TILT_DEG) * 30}%`);
			rotator.style.setProperty("--background-y", `${50 + (-tiltY / MAX_TILT_DEG) * 30}%`);
			// Drive simey's filter vars from tilt magnitude/direction so
			// metallic shines reach full vibrancy (brightness ramps up with
			// pointer-from-center) instead of staying at the dim 0.5 floor.
			const fromLeftMobile = Math.max(0, Math.min(1, 0.5 + (tiltX / MAX_TILT_DEG) * 0.5));
			const fromTopMobile  = Math.max(0, Math.min(1, 0.5 + (-tiltY / MAX_TILT_DEG) * 0.5));
			rotator.style.setProperty("--pointer-from-left", `${fromLeftMobile}`);
			rotator.style.setProperty("--pointer-from-top", `${fromTopMobile}`);
			rotator.style.setProperty("--pointer-from-center", `${norm}`);
		};

		const onOrientation = (e: DeviceOrientationEvent) => {
			beta = e.beta ?? 0;
			gamma = e.gamma ?? 0;
			if (!raf) raf = requestAnimationFrame(apply);
		};

		const attach = () => {
			if (attached) return;
			attached = true;
			window.addEventListener("deviceorientation", onOrientation);
			// Screen-rotation re-calibration is handled at module level
			// (clearSharedRest) so all cards re-baseline together.
		};

		// On Android / desktop, tilt is available without permission — attach
		// straight away. On iOS we wait for the 'granted' event, OR if the user
		// already granted earlier in this session (we may mount AFTER the event
		// already fired), we attach right away based on the sessionStorage flag.
		const DOE = (typeof DeviceOrientationEvent !== "undefined"
			? (DeviceOrientationEvent as unknown as { requestPermission?: unknown })
			: null);
		const alreadyGranted = (() => {
			try { return sessionStorage.getItem("garra:tilt-granted") === "1"; } catch { return false; }
		})();
		if (!DOE || typeof DOE.requestPermission !== "function" || alreadyGranted) {
			attach();
		}

		const onGranted = () => attach();
		window.addEventListener("garra:tilt-granted", onGranted);

		return () => {
			window.removeEventListener("garra:tilt-granted", onGranted);
			if (attached) {
				window.removeEventListener("deviceorientation", onOrientation);
			}
			if (raf) cancelAnimationFrame(raf);
		};
	}, [isMobile, decorative, faceUp]);

	// Simey's CSS expects an <img> structure: __back is a sibling, __front is
	// a wrapper containing the front image + shine + glare. The `interactive`
	// class disables their built-in hover behavior so our JS-set CSS vars
	// drive the card.
	void frontOk; void backOk;
	return (
		<div
			ref={cardRef}
			className={`holo-card interactive ${className ?? ""}`}
			data-rarity={rarity}
			data-supertype={supertype ?? ""}
			data-subtypes={subtypes?.join(" ") ?? ""}
			data-trainer-gallery={trainerGallery ? "true" : undefined}
			data-face={faceUp ? "up" : "down"}
			style={mask ? ({ ["--mask" as string]: `url(${mask})` } as React.CSSProperties) : undefined}
		>
			<div className="holo-card__translater">
				<div
					ref={rotatorRef}
					className="holo-card__rotator"
					style={{ transform: `rotateY(${faceUp ? 0 : 180}deg) rotateY(var(--rotate-x, 0deg)) rotateX(var(--rotate-y, 0deg))` }}
				>
					{/* <img> with decoding="sync" forces iOS Safari to decode the
					    bitmap before paint, avoiding the "transparent ghost" frame
					    that appears when a freshly-mounted card animates while its
					    background-image is still being decoded into a GPU layer. */}
					<img
						className="holo-card__back"
						src={CARD_BACK_IMAGE}
						alt=""
						decoding="sync"
						loading="eager"
					/>
					<div className="holo-card__front">
						<div
							style={{
								backgroundImage: `url(${image})`,
								backgroundSize: "cover",
								backgroundPosition: "center",
							}}
						/>
						{!decorative && <div className="holo-card__shine" />}
						{!decorative && <div className="holo-card__glare" />}
					</div>
				</div>
			</div>
		</div>
	);
}
