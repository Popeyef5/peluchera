"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/components/hooks/useIsMobile";

const SS_GRANTED = "garra:tilt-granted";
const SS_PROMPTED = "garra:tilt-prompted";
const PROBE_MS = 700;

function ssGet(key: string): string | null {
	try { return sessionStorage.getItem(key); } catch { return null; }
}
function ssSet(key: string, val: string): void {
	try { sessionStorage.setItem(key, val); } catch { /* private mode */ }
}

function hasIOSPermissionAPI(): boolean {
	if (typeof DeviceOrientationEvent === "undefined") return false;
	const fn = (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission;
	return typeof fn === "function";
}

// Fires once per page load when the permission state has been settled — either
// we never needed to ask (desktop / Android / already granted / already
// dismissed), or the user resolved the modal. Consumers (e.g. /test-win) wait
// for this so their own auto-trigger logic doesn't race the permission UI.
function markResolved(): void {
	(window as Window & { __garraTiltResolved?: boolean }).__garraTiltResolved = true;
	window.dispatchEvent(new CustomEvent("garra:tilt-resolved"));
}

/**
 * First-visit modal that requests iOS motion permission. Shown only when:
 *   - viewport is mobile-sized
 *   - DeviceOrientationEvent.requestPermission exists (iOS Safari)
 *   - we haven't already been granted this session
 *   - we haven't already prompted this session
 *
 * Probe-then-show: iOS Safari sometimes keeps the permission alive within a
 * tab session, so we first attach a throwaway listener for ~700ms. If events
 * fire, we treat the grant as still active and skip the modal. If nothing
 * fires, we open the modal and ask the user to tap Enable — that tap is the
 * user gesture that lets us call `requestPermission()` synchronously, which
 * triggers the native iOS allow/deny sheet.
 *
 * Renders via React's `createPortal` into `containerRef.current` so the
 * markup sits inside `.lg-root` and inherits the scoped `glass holo-rim`
 * / CSS-var styling. Chakra v3's `Dialog` + `<Portal container={ref}>`
 * combo didn't actually mount any DOM in dev testing — hand-rolling is
 * smaller and works.
 */
type Props = {
	containerRef?: React.RefObject<HTMLElement | null>;
};

export default function MotionPermissionModal({ containerRef }: Props) {
	const [open, setOpen] = useState(false);
	const isMobile = useIsMobile();

	useEffect(() => {
		if (!isMobile) { markResolved(); return; }
		if (!hasIOSPermissionAPI()) { markResolved(); return; }
		if (ssGet(SS_GRANTED) === "1") { markResolved(); return; }
		if (ssGet(SS_PROMPTED) === "1") { markResolved(); return; }

		let gotEvent = false;
		const probe = () => { gotEvent = true; };
		window.addEventListener("deviceorientation", probe);
		const t = setTimeout(() => {
			window.removeEventListener("deviceorientation", probe);
			if (gotEvent) {
				ssSet(SS_GRANTED, "1");
				window.dispatchEvent(new CustomEvent("garra:tilt-granted"));
				markResolved();
			} else {
				setOpen(true);
			}
		}, PROBE_MS);
		return () => {
			clearTimeout(t);
			window.removeEventListener("deviceorientation", probe);
		};
	}, [isMobile]);

	const onEnable = async () => {
		try {
			type DOE = typeof DeviceOrientationEvent & {
				requestPermission: () => Promise<"granted" | "denied" | "default">;
			};
			const result = await (DeviceOrientationEvent as unknown as DOE).requestPermission();
			if (result === "granted") {
				ssSet(SS_GRANTED, "1");
				window.dispatchEvent(new CustomEvent("garra:tilt-granted"));
			}
		} catch {
			/* denied or unavailable */
		}
		ssSet(SS_PROMPTED, "1");
		setOpen(false);
		markResolved();
	};

	const onSkip = () => {
		ssSet(SS_PROMPTED, "1");
		setOpen(false);
		markResolved();
	};

	// Prefer the lg-root container so scoped CSS applies; fall back to body
	// if the ref isn't attached yet so the modal is still visible (un-rimmed).
	const portalTarget = containerRef?.current ?? (typeof document !== "undefined" ? document.body : null);

	if (!open || !portalTarget) return null;

	return createPortal(
		<>
			<div
				className="lg-drawer-backdrop"
				onClick={onSkip}
				style={{ position: "fixed", inset: 0, zIndex: 1000 }}
			/>
			<div
				style={{
					position: "fixed",
					inset: 0,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					zIndex: 1001,
					pointerEvents: "none",
					padding: 16,
				}}
			>
				<div
					className="glass holo-rim motion-perm"
					style={{
						width: "min(86vw, 360px)",
						borderRadius: "1.5rem",
						pointerEvents: "auto",
						background: "transparent",
						boxShadow: "none",
					}}
				>
					<div style={{ display: "flex", flexDirection: "column", gap: "2.2vh", padding: "3.5vh 6vw" }}>
						<div className="rates__tag">Motion</div>
						<h2 className="motion-perm__title">Garra is best with motion</h2>
						<p className="motion-perm__body">
							Tilting your phone brings the iridescent rim and foil cards to life.
							We&apos;ll ask iOS for motion access next.
						</p>
						<div style={{ display: "flex", gap: 12, paddingTop: "0.8vh" }}>
							<button className="motion-perm__btn motion-perm__btn--ghost" onClick={onSkip} style={{ flex: 1 }}>
								Not now
							</button>
							<button className="motion-perm__btn" onClick={onEnable} style={{ flex: 1 }}>
								Enable motion
							</button>
						</div>
					</div>
				</div>
			</div>
		</>,
		portalTarget,
	);
}
