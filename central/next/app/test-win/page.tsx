"use client";

import { useEffect } from "react";
import HomePage from "../page";

declare global {
	interface Window {
		__garraTestWin?: boolean;
	}
}

export default function TestWinPage() {
	useEffect(() => {
		const t = setTimeout(() => {
			console.log("[test-win] firing garra:test-win");
			// Window flag is a safety net: if WinChoiceModal hasn't finished its
			// dynamic import + mount by the time we dispatch (slow mobile bundles),
			// the modal's mount-time check picks up this flag and fires anyway.
			window.__garraTestWin = true;
			window.dispatchEvent(new CustomEvent("garra:test-win"));
		}, 3000);
		return () => clearTimeout(t);
	}, []);

	return <HomePage />;
}
