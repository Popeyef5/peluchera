/**
 * Shared device-orientation tracker. One window listener, many subscribers.
 *
 * Consumers (rim specular, Play button gloss) call `subscribeOrientation` and
 * receive a stream of TiltState objects derived from `deviceorientation`. The
 * module handles iOS-style permission gating (attaches the listener only after
 * `garra:tilt-granted` fires or sessionStorage flag is present), captures a
 * shared rest baseline on the first event so all consumers tilt off the same
 * zero, and re-baselines on screen rotation.
 *
 * HoloCard keeps its own listener — its baseline is captured per-card-mount
 * and lives on a different timeline from this module. They don't need to share.
 */

export type TiltState = {
	/** Front-back tilt delta from rest, in degrees (positive = phone tipped forward). */
	dBeta: number;
	/** Left-right tilt delta from rest, in degrees (positive = phone tipped right). */
	dGamma: number;
	/** Compass-style angle of the tilt direction, in degrees (0 = top, 90 = right, 180 = bottom, 270 = left). */
	angle: number;
	/** 0..1 magnitude of the tilt; reaches 1 at `STRENGTH_FULL_AT_DEG` total tilt. */
	strength: number;
};

type Subscriber = (state: TiltState) => void;

const STRENGTH_FULL_AT_DEG = 22;

const subscribers = new Set<Subscriber>();
let restBeta: number | null = null;
let restGamma: number | null = null;
let lastBeta = 0;
let lastGamma = 0;
let raf = 0;
let attached = false;
let initialized = false;

function getScreenAngle(): number {
	if (typeof window === "undefined") return 0;
	const o = window.screen?.orientation?.angle ?? 0;
	return o === 270 ? -90 : o;
}

function fire() {
	raf = 0;
	if (restBeta == null || restGamma == null) {
		restBeta = lastBeta;
		restGamma = lastGamma;
	}
	let dBeta = lastBeta - restBeta;
	let dGamma = lastGamma - restGamma;

	const ang = getScreenAngle();
	if (ang === 90)       { const t = dBeta; dBeta = -dGamma; dGamma = t;  }
	else if (ang === -90) { const t = dBeta; dBeta = dGamma;  dGamma = -t; }
	else if (ang === 180) { dBeta = -dBeta; dGamma = -dGamma; }

	const magnitude = Math.hypot(dBeta, dGamma);
	const strength = Math.min(1, magnitude / STRENGTH_FULL_AT_DEG);
	const angle = (Math.atan2(dGamma, dBeta) * 180 / Math.PI + 360) % 360;

	const state: TiltState = { dBeta, dGamma, angle, strength };
	for (const sub of subscribers) sub(state);
}

function onOrientation(e: DeviceOrientationEvent) {
	lastBeta = e.beta ?? 0;
	lastGamma = e.gamma ?? 0;
	if (!raf) raf = requestAnimationFrame(fire);
}

function clearRest() {
	restBeta = null;
	restGamma = null;
}

function attach() {
	if (attached || typeof window === "undefined") return;
	attached = true;
	window.addEventListener("deviceorientation", onOrientation);
	window.screen?.orientation?.addEventListener?.("change", clearRest);
}

function initialize() {
	if (initialized || typeof window === "undefined") return;
	initialized = true;
	const needsIOSPermission = (() => {
		if (typeof DeviceOrientationEvent === "undefined") return false;
		const fn = (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission;
		return typeof fn === "function";
	})();
	const alreadyGranted = (() => {
		try { return sessionStorage.getItem("garra:tilt-granted") === "1"; }
		catch { return false; }
	})();
	if (!needsIOSPermission || alreadyGranted) attach();
	window.addEventListener("garra:tilt-granted", attach);
}

export function subscribeOrientation(cb: Subscriber): () => void {
	initialize();
	subscribers.add(cb);
	return () => { subscribers.delete(cb); };
}
