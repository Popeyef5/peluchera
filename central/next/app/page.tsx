"use client";

import { Bricolage_Grotesque, Geist_Mono } from "next/font/google";
import React, { useEffect, useRef, useState } from "react";
import { Box, Drawer, Flex, HStack, Portal, VStack } from "@chakra-ui/react";
import Image from "next/image";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { ClawProvider, SocketProvider, useClaw } from "@/components/providers";
import WebRTCPlayer from "@/components/WebRTCPlayer";
import GameController from "@/components/GameController";
import AccountManager from "@/components/AccountManager";
import { useColorMode } from "@/components/ui/color-mode";
import { useIsMobile } from "@/components/hooks/useIsMobile";

const display = Bricolage_Grotesque({
	weight: ["400", "500", "700", "800"],
	subsets: ["latin"],
	variable: "--lg-display",
});
const mono = Geist_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--lg-mono" });

/* ── Tweakable design tokens ───────────────────────────────────────────── */

const TEMPS = {
	silver:    { p1: "#ebe7df", p2: "#d4d0c8", p3: "#bfbcb4" },
	pearl:     { p1: "#efe9da", p2: "#d8d2c2", p3: "#c8c2b2" },
	champagne: { p1: "#f0e6d2", p2: "#e0d4ba", p3: "#cabd9e" },
	black:     { p1: "#2a2520", p2: "#1c1815", p3: "#100e0c" },
} as const;
const ACCENTS = {
	iris:   "oklch(62% 0.14 320)",
	violet: "oklch(58% 0.14 280)",
	cyan:   "oklch(62% 0.13 200)",
	rose:   "oklch(62% 0.14 25)",
	lime:   "oklch(72% 0.16 130)",
} as const;

const DEFAULTS = {
	colorTemp: "pearl" as keyof typeof TEMPS,
	accent: "iris" as keyof typeof ACCENTS,
	frost: 1,
	typeScale: 1,
	rim: 0.85,
	spec: 1,
	glossMode: "radial" as "static" | "linear" | "radial",
};

/* ── Hooks ─────────────────────────────────────────────────────────────── */

/** Global specular tracker. Writes --spec-angle + --spec-strength on every
 *  `.spec` element on every pointermove. */
function useGlobalSpecular() {
	useEffect(() => {
		const update = (cx: number, cy: number) => {
			const els = document.querySelectorAll<HTMLElement>(".spec");
			for (const el of els) {
				const r = el.getBoundingClientRect();
				const ex = r.left + r.width / 2;
				const ey = r.top + r.height / 2;
				const dx = cx - ex;
				const dy = cy - ey;
				const ang = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
				const diag = Math.hypot(r.width, r.height) / 2;
				const dist = Math.hypot(dx, dy);
				const near = diag * 1.2;
				const far = diag * 2.8;
				let strength = 1 - (dist - near) / (far - near);
				if (strength < 0) strength = 0;
				if (strength > 1) strength = 1;
				el.style.setProperty("--spec-angle", `${ang}deg`);
				el.style.setProperty("--spec-strength", strength.toFixed(3));
			}
		};
		const onMove = (e: PointerEvent) => update(e.clientX, e.clientY);
		window.addEventListener("pointermove", onMove);
		return () => window.removeEventListener("pointermove", onMove);
	}, []);
}

/* ── Pieces ────────────────────────────────────────────────────────────── */

const ThemeToggle = () => {
	const { colorMode, toggleColorMode } = useColorMode();
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const dark = mounted && colorMode === "dark";
	return (
		<button className="chip chip--circle holo-rim spec" onClick={toggleColorMode} aria-label="Toggle theme">
			{mounted ? (dark ? "☀" : "☾") : "◐"}
		</button>
	);
};

const Play = ({ glossMode, mobile = false }: { glossMode: "static" | "linear" | "radial"; mobile?: boolean }) => {
	const { isPlaying, position, loading, approveAndBet, queueCount, clawSocketOn } = useClaw();
	const { isConnected } = useAppKitAccount();
	const { open } = useAppKit();
	const [userText, setUserText] = useState("");
	const ref = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		let raf: number | null = null;
		const update = (cx: number, cy: number) => {
			const el = ref.current;
			if (!el) return;
			const r = el.getBoundingClientRect();
			el.style.setProperty("--lmx", `${cx - r.left}px`);
			el.style.setProperty("--lmy", `${cy - r.top}px`);
			const ex = r.left + r.width / 2;
			const ey = r.top + r.height / 2;
			const dx = cx - ex;
			const dy = cy - ey;
			const ang = (Math.atan2(dx, -dy) * 180) / Math.PI;
			el.style.setProperty("--gangle", `${ang}deg`);
		};
		const onMove = (e: PointerEvent) => {
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = null;
				update(e.clientX, e.clientY);
			});
		};
		window.addEventListener("pointermove", onMove);
		return () => {
			window.removeEventListener("pointermove", onMove);
			if (raf) cancelAnimationFrame(raf);
		};
	}, []);

	useEffect(() => {
		if (position > 1) setUserText(`Your position in queue: ${position}`);
		else if (position === 1) setUserText(`You are next`);
		else if (position === 0) setUserText(`Your turn will start in a few seconds. Be ready!`);
		else if (position < 0 && queueCount > 1) setUserText(`${queueCount} players in queue.`);
		else if (position < 0 && queueCount === 1) setUserText(`1 player in queue.`);
		else setUserText(`No players in queue.`);
	}, [position, queueCount]);

	const glossCls =
		glossMode === "linear" ? "play--gloss-linear" : glossMode === "radial" ? "play--gloss-radial" : "";
	const onClick = !isConnected ? () => open() : approveAndBet;
	const disabled = loading || (isConnected && !clawSocketOn);
	const label = !isConnected ? "CONNECT WALLET" : "PLAY";

	const content = isPlaying ? (
		<GameController />
	) : (
		<>
			{position < 0 && (
				<button
					ref={ref}
					className={`play holo-rim spec ${glossCls}`}
					onClick={onClick}
					disabled={disabled}
				>
					<span className="play__inner-gloss" />
					<span className="play__sweep" />
					<span className="play__label">{label}</span>
				</button>
			)}
			<Box className="queue">{userText}</Box>
		</>
	);

	if (mobile) {
		return (
			<VStack w="full" justify="center" align="stretch" gap={3}>
				{content}
			</VStack>
		);
	}
	return (
		<VStack flex="1 1 auto" w="full" justify="space-evenly" align="stretch" gap={0}>
			{content}
		</VStack>
	);
};

const Rates = () => (
	<div className="glass holo-rim spec rates">
		<div className="rates__tag">Drop rates</div>
		<div className="rates__rows">
			<div className="rates__row">
				<span className="sphere sphere--common" />
				<span className="rates__name">Common</span>
				<span className="rates__odds">70%</span>
			</div>
			<div className="rates__row">
				<span className="sphere sphere--rare" />
				<span className="rates__name">Rare</span>
				<span className="rates__odds">25%</span>
			</div>
			<div className="rates__row">
				<span className="sphere sphere--chase" />
				<span className="rates__name">Chase</span>
				<span className="rates__odds">5%</span>
			</div>
		</div>
	</div>
);

const Rules = ({ containerRef }: { containerRef?: React.RefObject<HTMLElement | null> }) => {
	const [open, setOpen] = useState(false);
	const isMobile = useIsMobile();
	return (
		<Drawer.Root placement="bottom" open={open} onOpenChange={(e) => setOpen(e.open)}>
			<Drawer.Trigger asChild>
				<button className="rules holo-rim spec">How to play</button>
			</Drawer.Trigger>
			<Portal container={containerRef}>
				<Drawer.Backdrop className="rules-backdrop" />
				<Drawer.Positioner pos={containerRef ? "absolute" : "fixed"} boxSize="full">
					<Drawer.Content
						className="glass holo-rim rules-drawer"
						borderTopRadius="1.5rem"
						borderBottomRadius={isMobile ? "0" : "1.5rem"}
					>
						<button className="rules-drawer__close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
						<div className="rates__tag">Quick start</div>
						<h2>How to play</h2>
						<ol>
							<li>Connect a wallet to load USDC.</li>
							<li>Drive the claw — WASD or arrows, space to grab.</li>
							<li>Lift a sphere → score a Pokémon booster.</li>
							<li>Cash out instantly, or vault it for shipment within 30 days.</li>
						</ol>
					</Drawer.Content>
				</Drawer.Positioner>
			</Portal>
		</Drawer.Root>
	);
};

const LiveChip = () => {
	const { clawSocketOn } = useClaw();
	return (
		<div className={`video__live ${clawSocketOn ? "" : "video__live--off"}`}>
			<span className="video__live__dot" aria-hidden />
			{clawSocketOn ? "LIVE" : "OFFLINE"}
		</div>
	);
};

const Video = () => (
	<div className="video">
		<div className="video__frame">
			<div className="video__screen">
				<WebRTCPlayer />
			</div>
			<div className="video__rim spec" aria-hidden />
			<LiveChip />
		</div>
	</div>
);

/* ── Styles ────────────────────────────────────────────────────────────── */

const Styles = ({ accent }: { accent: string }) => (
	<style jsx global>{`
		.lg-root {
			font-family: var(--lg-display);
			color: var(--ink);
			min-height: 100vh;
			background: var(--paper-2);
			position: relative;
			isolation: isolate;
			letter-spacing: -0.005em;
			--accent: ${accent};
			--ink: #1f1d1a;
			--ink-soft: #5a564f;
			--holo: conic-gradient(from 0deg,
				oklch(72% 0.16 30) 0deg,
				oklch(78% 0.14 70) 60deg,
				oklch(80% 0.13 130) 120deg,
				oklch(74% 0.16 200) 180deg,
				oklch(68% 0.18 270) 240deg,
				oklch(70% 0.18 330) 300deg,
				oklch(72% 0.16 30) 360deg);
			--holo-soft: conic-gradient(from 200deg,
				oklch(78% 0.10 30  / 0.55) 0deg,
				oklch(82% 0.08 80  / 0.55) 90deg,
				oklch(80% 0.10 200 / 0.55) 180deg,
				oklch(74% 0.12 290 / 0.55) 270deg,
				oklch(78% 0.10 30  / 0.55) 360deg);
		}

		/* Atmosphere */
		.lg-root::before {
			content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none;
			background:
				radial-gradient(ellipse 70vmax 50vmax at 18% 18%, color-mix(in oklab, var(--paper-1) 80%, white) 0%, transparent 55%),
				radial-gradient(ellipse 60vmax 40vmax at 82% 28%, color-mix(in oklab, var(--paper-1) 60%, white) 0%, transparent 55%),
				radial-gradient(ellipse 80vmax 55vmax at 75% 88%, var(--paper-3) 0%, transparent 55%),
				radial-gradient(ellipse 55vmax 40vmax at 12% 95%, var(--paper-3) 0%, transparent 55%),
				linear-gradient(135deg, var(--paper-1) 0%, var(--paper-2) 45%, var(--paper-1) 70%, var(--paper-3) 100%);
			animation: lgh-shimmer 28s ease-in-out infinite alternate;
		}
		.lg-root::after {
			content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none;
			background:
				conic-gradient(from 200deg at 30% 30%,
					oklch(80% 0.05 30  / 0.10),
					oklch(82% 0.05 100 / 0.10),
					oklch(80% 0.05 200 / 0.10),
					oklch(76% 0.06 290 / 0.10),
					oklch(80% 0.05 30  / 0.10)),
				url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='4'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.06 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
			background-size: cover, 220px 220px;
			mix-blend-mode: multiply;
		}
		@keyframes lgh-shimmer {
			0%   { filter: brightness(1)    saturate(1)    contrast(1); }
			50%  { filter: brightness(1.03) saturate(1.02) contrast(1.01); }
			100% { filter: brightness(0.99) saturate(1)    contrast(1); }
		}
		.lg-root > * { position: relative; z-index: 1; }

		/* Glass */
		.lg-root .glass {
			position: relative;
			border-radius: 22px;
			background: linear-gradient(135deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.22) 100%);
			backdrop-filter: blur(calc(28px * var(--frost))) saturate(125%);
			-webkit-backdrop-filter: blur(calc(28px * var(--frost))) saturate(125%);
			border: 1px solid rgba(255,255,255,0.65);
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,0.85),
				inset 0 -1px 0 rgba(31,29,26,0.06),
				0 12px 36px rgba(31,29,26,0.14),
				0 2px 6px rgba(31,29,26,0.08);
		}

		/* Holographic rim */
		.lg-root .holo-rim::before {
			content: ""; position: absolute; inset: -1px;
			border-radius: inherit;
			background: var(--holo);
			-webkit-mask: linear-gradient(#000,#000) content-box, linear-gradient(#000,#000);
			        mask: linear-gradient(#000,#000) content-box, linear-gradient(#000,#000);
			-webkit-mask-composite: xor;
			        mask-composite: exclude;
			padding: 1.4px;
			opacity: var(--rim-opacity);
			pointer-events: none;
			z-index: 2;
		}

		/* Cursor-tracked specular wedge */
		.lg-root .spec { --spec-angle: 220deg; --spec-strength: 0; }
		.lg-root .spec::after {
			content: ""; position: absolute; inset: -1px;
			border-radius: inherit;
			background: conic-gradient(
				from calc(var(--spec-angle) - 55deg),
				transparent 0deg,
				rgba(255,255,255,0) 8deg,
				rgba(255,255,255,calc(0.55 * var(--spec-strength) * var(--spec-intensity))) 38deg,
				rgba(255,255,255,calc(0.95 * var(--spec-strength) * var(--spec-intensity))) 55deg,
				rgba(255,255,255,calc(0.55 * var(--spec-strength) * var(--spec-intensity))) 72deg,
				rgba(255,255,255,0) 102deg,
				transparent 360deg);
			-webkit-mask: linear-gradient(#000,#000) content-box, linear-gradient(#000,#000);
			        mask: linear-gradient(#000,#000) content-box, linear-gradient(#000,#000);
			-webkit-mask-composite: xor;
			        mask-composite: exclude;
			padding: 1.6px;
			pointer-events: none;
			z-index: 3;
		}
		.dark .lg-root .spec::after { mix-blend-mode: plus-lighter; }

		/* Chip — head buttons */
		.lg-root .chip {
			height: 4.4vh; padding: 0 1.4vh;
			display: inline-flex; align-items: center; justify-content: center;
			font-family: var(--lg-display);
			font-weight: 500;
			font-size: calc(0.78rem * var(--type-scale));
			letter-spacing: -0.005em;
			border-radius: 999px;
			color: var(--ink);
			cursor: pointer;
			background: linear-gradient(180deg, rgba(255,255,255,0.65) 0%, rgba(220,216,206,0.40) 100%);
			backdrop-filter: blur(calc(20px * var(--frost))) saturate(125%);
			-webkit-backdrop-filter: blur(calc(20px * var(--frost))) saturate(125%);
			border: 1px solid rgba(255,255,255,0.7);
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,0.95),
				inset 0 -1px 0 rgba(31,29,26,0.06),
				0 6px 14px rgba(31,29,26,0.10);
			transition: transform 200ms ease;
			position: relative;
		}
		.lg-root .chip:hover { transform: translateY(-1px); }
		.lg-root .chip--circle { width: 4.4vh; padding: 0; border-radius: 50%; font-size: calc(0.85rem * var(--type-scale)); }
		.lg-root .chip--circle svg { width: 1.1em; height: 1.1em; }

		/* Logo image — dropdown shadow lifts it off the brushed surface */
		.lg-root .logo {
			display: block;
			width: 100%;
			height: auto;
			filter: drop-shadow(0 2px 6px rgba(31,29,26,0.18));
		}
		.dark .lg-root .logo { filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5)); }

		/* Play */
		.lg-root .play {
			width: 100%;
			height: 12vh;
			flex: 0 0 auto;
			display: flex; align-items: center; justify-content: center;
			position: relative; overflow: hidden;
			border-radius: 26px; cursor: pointer;
			background: linear-gradient(180deg, rgba(255,255,255,0.72) 0%, rgba(220,216,206,0.40) 100%);
			backdrop-filter: blur(calc(28px * var(--frost))) saturate(130%);
			-webkit-backdrop-filter: blur(calc(28px * var(--frost))) saturate(130%);
			border: 1px solid rgba(255,255,255,0.75);
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,1),
				inset 0 -1px 0 rgba(31,29,26,0.08),
				0 14px 36px rgba(31,29,26,0.16),
				0 2px 6px rgba(31,29,26,0.08);
			transition: transform 220ms ease, box-shadow 220ms ease;
		}
		.lg-root .play:hover { transform: translateY(-1px); }
		.lg-root .play:active { transform: translateY(0); }
		.lg-root .play:disabled { opacity: 0.6; cursor: not-allowed; }
		.lg-root .play__label {
			font-family: var(--lg-display); font-weight: 700;
			font-size: calc(1.15rem * var(--type-scale));
			letter-spacing: 0.18em;
			color: var(--ink);
			z-index: 3;
		}
		.lg-root .play__sweep {
			position: absolute; inset: 0; pointer-events: none; z-index: 2;
			background: radial-gradient(
				ellipse 75% 140% at var(--lmx, 50%) var(--lmy, 50%),
				oklch(82% 0.06 80 / 0.10) 0%,
				oklch(80% 0.07 200 / 0.08) 35%,
				oklch(74% 0.09 290 / 0.06) 60%,
				transparent 85%);
			opacity: 0;
			transition: opacity 380ms ease;
		}
		.lg-root .play:hover .play__sweep { opacity: 1; }
		.lg-root .play__inner-gloss {
			position: absolute; inset: 0; border-radius: inherit;
			background: linear-gradient(180deg,
				rgba(255,255,255,0.45) 0%,
				rgba(255,255,255,0.12) 35%,
				rgba(255,255,255,0) 70%);
			pointer-events: none; z-index: 1;
		}
		.lg-root .play--gloss-linear .play__inner-gloss {
			background: linear-gradient(
				var(--gangle, 180deg),
				rgba(255,255,255,0.55) 0%,
				rgba(255,255,255,0.20) 35%,
				rgba(255,255,255,0.04) 65%,
				rgba(255,255,255,0) 100%);
		}
		.lg-root .play--gloss-radial .play__inner-gloss {
			background: radial-gradient(
				ellipse 90% 140% at var(--lmx, 50%) var(--lmy, 50%),
				rgba(255,255,255,0.55) 0%,
				rgba(255,255,255,0.22) 25%,
				rgba(255,255,255,0.06) 55%,
				rgba(255,255,255,0) 90%);
		}

		/* Queue line */
		.lg-root .queue {
			text-align: center;
			font-family: var(--lg-display);
			font-size: calc(0.95rem * var(--type-scale));
			color: var(--ink-soft);
			margin: -0.5vh 0 0.5vh;
			letter-spacing: -0.005em;
		}

		/* Drop rates */
		.lg-root .rates { padding: 1.6vh 2vh; width: 100%; }
		.lg-root .rates__tag {
			font-family: var(--lg-mono);
			font-size: calc(0.6rem * var(--type-scale));
			letter-spacing: 0.24em; text-transform: uppercase;
			color: var(--ink-soft);
			margin-bottom: 1.1vh;
		}
		.lg-root .rates__rows { display: flex; flex-direction: column; gap: 0.8vh; }
		.lg-root .rates__row {
			display: grid; grid-template-columns: auto 1fr auto;
			align-items: center; gap: 0.9em;
			padding: 0.4vh 0;
			font-size: calc(1rem * var(--type-scale));
		}
		.lg-root .rates__row + .rates__row {
			border-top: 1px solid rgba(31,29,26,0.06);
			padding-top: 0.8vh;
		}
		.lg-root .rates__name { color: var(--ink); font-weight: 500; }
		.lg-root .rates__odds { font-family: var(--lg-mono); font-variant-numeric: tabular-nums; }

		/* Iridescent spheres */
		.lg-root .sphere {
			width: 14px; height: 14px; border-radius: 50%;
			position: relative;
			background:
				radial-gradient(circle at 30% 28%, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 35%),
				var(--sphere-bg, var(--holo));
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,0.55),
				inset 0 -2px 3px rgba(31,29,26,0.18),
				0 0 8px var(--sphere-halo, rgba(255,255,255,0.4)),
				0 1px 2px rgba(31,29,26,0.18);
		}
		.lg-root .sphere--common {
			--sphere-bg: linear-gradient(135deg, #c8c2b2, #8a8478);
			--sphere-halo: rgba(180,178,170,0.35);
		}
		.lg-root .sphere--rare {
			--sphere-bg: conic-gradient(from 200deg,
				oklch(78% 0.10 200), oklch(76% 0.12 230), oklch(72% 0.14 270), oklch(76% 0.12 230), oklch(78% 0.10 200));
			--sphere-halo: oklch(76% 0.12 230 / 0.55);
		}
		.lg-root .sphere--chase {
			--sphere-bg: var(--holo);
			--sphere-halo: oklch(78% 0.14 30 / 0.7);
		}

		/* Rules button */
		.lg-root .rules {
			width: 100%; padding: 1.1em 1em;
			font-family: var(--lg-display); font-weight: 500;
			font-size: calc(0.95rem * var(--type-scale));
			letter-spacing: -0.005em;
			color: var(--ink);
			border-radius: 18px; cursor: pointer;
			background: linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(220,216,206,0.35) 100%);
			backdrop-filter: blur(calc(20px * var(--frost))) saturate(125%);
			-webkit-backdrop-filter: blur(calc(20px * var(--frost))) saturate(125%);
			border: 1px solid rgba(255,255,255,0.7);
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,0.95),
				0 6px 18px rgba(31,29,26,0.10);
			transition: transform 200ms ease;
			position: relative;
		}
		.lg-root .rules:hover { transform: translateY(-1px); }

		/* Video */
		.lg-root .video {
			position: relative;
			width: 100%; height: 100%;
			display: flex; align-items: center; justify-content: center;
		}
		.lg-root .video__frame {
			position: relative;
			width: 100%;
			aspect-ratio: 4/3;
			max-height: 100%;
			border-radius: 28px;
			overflow: visible;
		}
		.lg-root .video__frame::before {
			content: ""; position: absolute; inset: -3vh;
			border-radius: 36px;
			background: var(--holo-soft);
			filter: blur(calc(28px * var(--frost)));
			opacity: 0.55;
			z-index: -1;
			pointer-events: none;
		}
		.lg-root .video__screen {
			position: absolute; inset: 0;
			border-radius: 26px;
			overflow: hidden;
			background: #0a0a0c;
			box-shadow:
				0 32px 80px rgba(20,18,14,0.48),
				0 12px 30px rgba(20,18,14,0.28),
				inset 0 1px 0 rgba(255,255,255,0.08);
			display: flex;
		}
		.lg-root .video__screen > * { width: 100%; height: 100%; }
		.lg-root .video__rim {
			position: absolute; inset: 0;
			border-radius: 26px;
			background: var(--holo);
			-webkit-mask: linear-gradient(#000,#000) content-box, linear-gradient(#000,#000);
			        mask: linear-gradient(#000,#000) content-box, linear-gradient(#000,#000);
			-webkit-mask-composite: xor; mask-composite: exclude;
			padding: 1.4px;
			opacity: 0.5;
			pointer-events: none;
			z-index: 5;
		}
		.lg-root .video__live {
			position: absolute; top: 1.6vh; right: 1.6vh;
			z-index: 6;
			display: inline-flex; align-items: center; gap: 0.5em;
			padding: 0.42em 0.85em;
			font-family: var(--lg-mono);
			font-size: calc(0.6rem * var(--type-scale));
			letter-spacing: 0.18em; text-transform: uppercase;
			border-radius: 999px;
			color: #fff;
			background: rgba(20,18,14,0.55);
			backdrop-filter: blur(14px) saturate(140%);
			-webkit-backdrop-filter: blur(14px) saturate(140%);
			border: 1px solid rgba(255,255,255,0.18);
			box-shadow: 0 4px 14px rgba(0,0,0,0.35);
		}
		.lg-root .video__live__dot {
			width: 6px; height: 6px; border-radius: 50%;
			background: oklch(72% 0.20 25);
			box-shadow: 0 0 8px oklch(72% 0.20 25 / 0.6);
			animation: lgh-live 1.6s ease-in-out infinite;
		}
		.lg-root .video__live--off .video__live__dot {
			background: var(--ink-soft);
			box-shadow: none;
			animation: none;
		}
		@keyframes lgh-live { 50% { opacity: 0.4; } }

		/* Rules drawer (slides up from bottom) */
		.rules-backdrop {
			background: rgba(120,116,108,0.30);
			backdrop-filter: blur(calc(8px * var(--frost, 1)));
			-webkit-backdrop-filter: blur(calc(8px * var(--frost, 1)));
		}
		.dark .rules-backdrop { background: rgba(0,0,0,0.55); }
		.rules-drawer {
			padding: 4vh 5vw 5vh;
			color: var(--ink);
			font-family: var(--lg-display);
			position: relative;
		}
		.rules-drawer h2 {
			font-weight: 700; font-size: 1.6rem; letter-spacing: -0.025em;
			margin: 0.2em 0 0.6em;
		}
		.rules-drawer ol { padding-left: 1.4em; line-height: 1.65; font-size: 1rem; color: var(--ink); }
		.rules-drawer ol li { margin: 0.5em 0; }
		.rules-drawer__close {
			position: absolute; top: 1.5vh; right: 1.5vh;
			width: 2.2em; height: 2.2em;
			display: flex; align-items: center; justify-content: center;
			border-radius: 50%;
			background: rgba(255,255,255,0.6);
			border: 1px solid rgba(255,255,255,0.7);
			cursor: pointer;
			color: var(--ink);
			z-index: 4;
		}
		.dark .rules-drawer { color: var(--ink); }
		.dark .rules-drawer__close {
			background: rgba(255,255,255,0.10);
			border: 1px solid rgba(255,255,255,0.16);
			color: var(--ink);
		}

		/* ── Dark — Space Black Titanium ─────────────────────────── */
		.dark .lg-root::before {
			background:
				radial-gradient(ellipse 70vmax 50vmax at 18% 18%, color-mix(in oklab, var(--paper-1) 70%, white 8%) 0%, transparent 55%),
				radial-gradient(ellipse 60vmax 40vmax at 82% 28%, color-mix(in oklab, var(--paper-1) 60%, white 6%) 0%, transparent 55%),
				radial-gradient(ellipse 80vmax 55vmax at 75% 88%, var(--paper-3) 0%, transparent 55%),
				radial-gradient(ellipse 55vmax 40vmax at 12% 95%, var(--paper-3) 0%, transparent 55%),
				linear-gradient(135deg, var(--paper-1) 0%, var(--paper-2) 45%, var(--paper-1) 70%, var(--paper-3) 100%);
		}
		.dark .lg-root::after { mix-blend-mode: screen; }
		.dark .lg-root .glass {
			background: linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.025) 100%);
			border: 1px solid rgba(255,255,255,0.10);
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,0.14),
				inset 0 -1px 0 rgba(0,0,0,0.32),
				0 14px 40px rgba(0,0,0,0.55),
				0 2px 8px rgba(0,0,0,0.30);
		}
		.dark .lg-root .chip {
			color: var(--ink);
			background: linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 100%);
			border: 1px solid rgba(255,255,255,0.13);
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,0.18),
				0 6px 14px rgba(0,0,0,0.4);
		}
		.dark .lg-root .play {
			background: linear-gradient(180deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.04) 100%);
			border: 1px solid rgba(255,255,255,0.16);
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,0.20),
				0 14px 40px rgba(0,0,0,0.55);
		}
		.dark .lg-root .rules {
			background: linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 100%);
			border: 1px solid rgba(255,255,255,0.12);
			color: var(--ink);
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,0.16),
				0 6px 18px rgba(0,0,0,0.45);
		}
		.dark .lg-root .wordmark__name {
			background: linear-gradient(180deg,
				color-mix(in oklab, var(--ink) 95%, white) 0%,
				color-mix(in oklab, var(--ink) 50%, var(--paper-2)) 100%);
			-webkit-background-clip: text; background-clip: text;
			color: transparent;
		}
		.dark .lg-root .play__inner-gloss {
			background: linear-gradient(180deg, rgba(255,255,255,0.20), rgba(255,255,255,0));
		}
		.dark .lg-root .video__screen { background: #060608; }
		.dark .lg-root {
			--ink: #ece6d8;
			--ink-soft: #a59f93;
		}

		@media (prefers-reduced-motion: reduce) {
			.lg-root *, .lg-root *::before, .lg-root *::after { animation: none !important; }
		}
	`}</style>
);

/* ── Layouts ───────────────────────────────────────────────────────────── */

const HUD = ({ logoSrc }: { logoSrc: string }) => {
	const columnRef = useRef<HTMLDivElement>(null);
	return (
		<HStack w="100vw" h="100vh" p="3.2vh" gap="3.2vh" containerType="size">
			<VStack
				w="full"
				h="full"
				gap="2.4vh"
				flex="1 0 34.5vh"
				ref={columnRef}
				pos="relative"
				align="stretch"
			>
				<HStack justify="space-between" w="full">
					<ThemeToggle />
					<Box w="80%" maxW="40vh" textAlign="center">
						<Image className="logo" width={800} height={200} src={logoSrc} alt="Garra" priority />
					</Box>
					<AccountManager containerRef={columnRef} triggerClassName="chip chip--circle holo-rim spec" />
				</HStack>
				<Play glossMode={DEFAULTS.glossMode} />
				<Rates />
				<Rules containerRef={columnRef} />
			</VStack>
			<Flex h="full" maxW="133cqh" flex="1000 1 auto" align="center">
				<Video />
			</Flex>
		</HStack>
	);
};

const Mobile = ({ logoSrc }: { logoSrc: string }) => {
	return (
		<VStack w="full" p={8} gap={8} align="stretch">
			<HStack w="full" justify="space-between">
				<ThemeToggle />
				<Box maxW="50%">
					<Image className="logo" width={200} height={360} src={logoSrc} alt="Garra" priority />
				</Box>
				<AccountManager triggerClassName="chip chip--circle holo-rim spec" />
			</HStack>
			<Flex aspectRatio={4 / 3} w="full" justifyItems="center">
				<Video />
			</Flex>
			<Flex w="full" minH="140px" justify="center" align="center">
				<Play glossMode={DEFAULTS.glossMode} mobile />
			</Flex>
			<Rates />
			<Rules />
		</VStack>
	);
};

/* ── Shell ─────────────────────────────────────────────────────────────── */

function Shell() {
	useGlobalSpecular();

	const { colorMode } = useColorMode();
	const dark = colorMode === "dark";
	const temp = dark ? TEMPS.black : TEMPS[DEFAULTS.colorTemp];
	const accent = ACCENTS[DEFAULTS.accent];
	const logoSrc = dark ? "/logo_white.png" : "/logo.png";

	const cssVars: Record<string, string | number> = {
		"--paper-1": temp.p1,
		"--paper-2": temp.p2,
		"--paper-3": temp.p3,
		"--frost": DEFAULTS.frost,
		"--type-scale": DEFAULTS.typeScale,
		"--rim-opacity": DEFAULTS.rim,
		"--spec-intensity": DEFAULTS.spec,
	};

	const isMobile = useIsMobile();

	return (
		<Box
			className={`lg-root ${display.variable} ${mono.variable}`}
			style={cssVars as React.CSSProperties}
			minH="100vh"
		>
			<Styles accent={accent} />
			{!isMobile ? <HUD logoSrc={logoSrc} /> : <Mobile logoSrc={logoSrc} />}
		</Box>
	);
}

/* ── Page wrapper ──────────────────────────────────────────────────────── */

export default function Page() {
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	if (!mounted) return null;
	return (
		<SocketProvider>
			<ClawProvider>
				<Shell />
			</ClawProvider>
		</SocketProvider>
	);
}
