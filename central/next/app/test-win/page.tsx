"use client";

import { useEffect } from "react";
import HomePage from "../page";

export default function TestWinPage() {
	useEffect(() => {
		const t = setTimeout(() => {
			window.dispatchEvent(new CustomEvent("garra:test-win"));
		}, 3000);
		return () => clearTimeout(t);
	}, []);

	return <HomePage />;
}
