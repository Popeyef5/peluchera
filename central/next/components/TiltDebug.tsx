"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Floating overlay that shows orientation-tilt diagnostics on mobile, so we
 * can debug device-orientation issues without Safari Web Inspector.
 * Mount conditionally where you want it visible.
 */
export default function TiltDebug() {
	const [mounted, setMounted] = useState(false);
	const [doeStatus, setDoeStatus] = useState<string>("init");
	const [grantedFlag, setGrantedFlag] = useState<string>("?");
	const [beta, setBeta] = useState<number | null>(null);
	const [gamma, setGamma] = useState<number | null>(null);
	const [count, setCount] = useState(0);
	const [orientationAngle, setOrientationAngle] = useState<number | null>(null);

	useEffect(() => { setMounted(true); }, []);

	useEffect(() => {
		// Detect DOE + requestPermission availability
		try {
			if (typeof DeviceOrientationEvent === "undefined") {
				setDoeStatus("DOE undefined");
			} else {
				const fn = (DeviceOrientationEvent as unknown as { requestPermission?: unknown })
					.requestPermission;
				setDoeStatus(typeof fn === "function" ? "iOS (perm gated)" : "open (Android/desktop)");
			}
		} catch {
			setDoeStatus("DOE error");
		}

		// Read session-storage grant flag
		try {
			const v = sessionStorage.getItem("garra:tilt-granted");
			setGrantedFlag(v ?? "null");
		} catch {
			setGrantedFlag("storage error");
		}

		// Refresh granted flag when our custom event fires
		const onGranted = () => {
			try { setGrantedFlag(sessionStorage.getItem("garra:tilt-granted") ?? "null"); } catch {}
		};
		window.addEventListener("garra:tilt-granted", onGranted);

		// Listen for orientation events
		const onOrient = (e: DeviceOrientationEvent) => {
			setBeta(e.beta);
			setGamma(e.gamma);
			setCount((c) => c + 1);
		};
		window.addEventListener("deviceorientation", onOrient);

		// Track screen orientation
		const updateOA = () => setOrientationAngle(window.screen?.orientation?.angle ?? null);
		updateOA();
		window.screen?.orientation?.addEventListener?.("change", updateOA);

		return () => {
			window.removeEventListener("garra:tilt-granted", onGranted);
			window.removeEventListener("deviceorientation", onOrient);
			window.screen?.orientation?.removeEventListener?.("change", updateOA);
		};
	}, []);

	const requestPermission = async () => {
		try {
			const fn = (DeviceOrientationEvent as unknown as {
				requestPermission?: () => Promise<"granted" | "denied" | "default">;
			}).requestPermission;
			if (typeof fn !== "function") {
				setDoeStatus("no requestPermission");
				return;
			}
			const result = await fn();
			setDoeStatus(`request → ${result}`);
			if (result === "granted") {
				try { sessionStorage.setItem("garra:tilt-granted", "1"); } catch {}
				window.dispatchEvent(new CustomEvent("garra:tilt-granted"));
			}
		} catch (e) {
			setDoeStatus(`error: ${(e as Error).message ?? e}`);
		}
	};

	const clearGrant = () => {
		try { sessionStorage.removeItem("garra:tilt-granted"); } catch {}
		setGrantedFlag("null");
	};

	if (!mounted) return null;

	const node = (
		<div
			style={{
				position: "fixed",
				bottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)",
				left: "8px",
				zIndex: 99999,
				padding: "6px 8px",
				background: "rgba(0,0,0,0.82)",
				color: "#7CFC95",
				font: "11px/1.35 monospace",
				borderRadius: "6px",
				border: "1px solid rgba(124,252,149,0.35)",
				maxWidth: "62vw",
			}}
		>
			<div>doe: {doeStatus}</div>
			<div>grant: {grantedFlag}</div>
			<div>orient°: {orientationAngle ?? "—"}</div>
			<div>β: {beta?.toFixed(1) ?? "—"} γ: {gamma?.toFixed(1) ?? "—"}</div>
			<div>events: {count}</div>
			<div style={{ marginTop: 4, display: "flex", gap: 4 }}>
				<button
					onClick={requestPermission}
					style={{
						padding: "2px 6px",
						background: "#7CFC95",
						color: "#000",
						border: "none",
						borderRadius: 3,
						font: "11px monospace",
					}}
				>
					Request
				</button>
				<button
					onClick={clearGrant}
					style={{
						padding: "2px 6px",
						background: "transparent",
						color: "#7CFC95",
						border: "1px solid #7CFC95",
						borderRadius: 3,
						font: "11px monospace",
					}}
				>
					Clear
				</button>
			</div>
		</div>
	);

	return createPortal(node, document.body);
}
