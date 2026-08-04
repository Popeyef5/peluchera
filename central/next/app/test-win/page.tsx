"use client";

import HomePage from "../page";
import { TestWinProvider } from "@/components/TestWinPicker";

// Dev-only harness. Renders the real home page, but PLAY opens a picker of the
// actual loaded balls (TestWinProvider + the DEV_TOOLS-gated dev_win_ball
// socket event). Confirming forces the mock chute to drop the chosen ball and
// runs a REAL turn — queue wait, then the normal win animation. No production
// route: /test-win only does anything while NEXT_PUBLIC_DEV_TOOLS is set.
export default function TestWinPage() {
	return (
		<TestWinProvider>
			<HomePage />
		</TestWinProvider>
	);
}
