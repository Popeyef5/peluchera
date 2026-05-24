"use client";

import { useEffect } from "react";
import HomePage from "../page";

declare global {
	interface Window {
		__garraTestWin?: boolean;
		__garraTiltResolved?: boolean;
	}
}

export default function TestWinPage() {
	useEffect(() => {
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		// Don't start the 3s countdown while the motion-permission modal is
		// still up (or pending). MotionPermissionModal fires garra:tilt-resolved
		// when it has settled — either bailed out (desktop / no API / prior
		// session) or the user resolved it. The window flag handles the race
		// where the modal resolves before this listener attaches.
		const start = () => {
			if (cancelled) return;
			timer = setTimeout(() => {
				console.log("[test-win] firing garra:test-win");
				window.__garraTestWin = true;
				window.dispatchEvent(new CustomEvent("garra:test-win"));
			}, 3000);
		};

		if (window.__garraTiltResolved) {
			start();
		} else {
			const onResolved = () => start();
			window.addEventListener("garra:tilt-resolved", onResolved, { once: true });
			return () => {
				cancelled = true;
				if (timer) clearTimeout(timer);
				window.removeEventListener("garra:tilt-resolved", onResolved);
			};
		}

		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, []);

	return <HomePage />;
}
