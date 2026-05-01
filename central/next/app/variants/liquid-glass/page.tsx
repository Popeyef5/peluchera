"use client";

import { Bricolage_Grotesque, Geist_Mono } from "next/font/google";
import { useEffect, useState } from "react";
import VariantLayout from "../_shared/VariantLayout";
import { useColorMode } from "@/components/ui/color-mode";

const display = Bricolage_Grotesque({
	weight: ["400", "500", "700", "800"],
	subsets: ["latin"],
	variable: "--lg-display",
});
const mono = Geist_Mono({
	weight: ["400", "500"],
	subsets: ["latin"],
	variable: "--lg-mono",
});

const TIERS = [
	{ name: "Common", odds: "70%", dot: "#a8b0b8" },
	{ name: "Rare",   odds: "25%", dot: "#5a626c" },
	{ name: "Chase",  odds: "5%",  dot: "#e8eef2", halo: "#e8eef2" },
];

const Wordmark = () => (
	<span className="lg-wordmark">
		<span className="lg-wordmark__main">Garra</span>
		<span className="lg-wordmark__sub">claw · pokémon · 2026</span>
	</span>
);

const ThemeToggle = () => {
	const { colorMode, toggleColorMode } = useColorMode();
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	return (
		<button className="lg-chip lg-theme" aria-label="toggle theme" onClick={toggleColorMode}>
			{mounted ? (colorMode === "dark" ? "☾" : "☀") : "◐"}
		</button>
	);
};
const Wallet = () => <button className="lg-chip">Wallet</button>;

const PrizePanel = () => (
	<div className="lg-glass lg-prize">
		<div className="lg-tag">Drop rates</div>
		<div className="lg-prize__rows">
			{TIERS.map((t) => (
				<div className="lg-prize__row" key={t.name}>
					<span
						className="lg-prize__dot"
						style={{
							background: `radial-gradient(circle at 30% 30%, #ffffff 0%, ${t.dot} 60%, ${t.dot} 100%)`,
							boxShadow: `0 0 10px ${t.halo ?? t.dot}88, inset 0 1px 0 rgba(255,255,255,0.5)`,
						}}
					/>
					<span className="lg-prize__name">{t.name}</span>
					<span className="lg-prize__odds">{t.odds}</span>
				</div>
			))}
		</div>
	</div>
);

const RulesTrigger = () => {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button className="lg-rules" onClick={() => setOpen(true)}>How to play</button>
			{open && (
				<div className="lg-modal" onClick={() => setOpen(false)}>
					<div className="lg-glass lg-modal__inner" onClick={(e) => e.stopPropagation()}>
						<button className="lg-modal__close" onClick={() => setOpen(false)} aria-label="close">✕</button>
						<div className="lg-tag">Quick start</div>
						<h2>How to play</h2>
						<ol>
							<li>Connect a wallet to load USDC.</li>
							<li>Drive the claw — WASD or arrows, space to grab.</li>
							<li>Lift a sphere → score a Pokémon booster.</li>
							<li>Cash out instantly, or vault it for shipment within 30 days.</li>
						</ol>
					</div>
				</div>
			)}
		</>
	);
};

const styles = (
	<style jsx global>{`
		.lg-root {
			font-family: var(--lg-display);
			color: #232830;
			min-height: 100vh;
			background: #c8ccd2;
			position: relative;
			isolation: isolate;
			letter-spacing: -0.005em;
		}
		/* Brushed silver scene: directional gradient + soft highlights */
		.lg-root::before {
			content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none;
			background:
				radial-gradient(ellipse 70vmax 50vmax at 18% 18%, rgba(255,255,255,0.85) 0%, transparent 55%),
				radial-gradient(ellipse 60vmax 40vmax at 82% 28%, rgba(255,255,255,0.45) 0%, transparent 55%),
				radial-gradient(ellipse 80vmax 55vmax at 75% 88%, rgba(120,130,140,0.45) 0%, transparent 55%),
				radial-gradient(ellipse 55vmax 40vmax at 12% 95%, rgba(150,160,170,0.30) 0%, transparent 55%),
				linear-gradient(135deg, #d8dde3 0%, #b6bdc5 45%, #d2d8de 70%, #aab2bc 100%);
			animation: lg-shimmer 28s ease-in-out infinite alternate;
		}
		/* Faint anisotropic streaks for that brushed-metal quality */
		.lg-root::after {
			content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none;
			background:
				repeating-linear-gradient(95deg,
					rgba(255,255,255,0.05) 0px,
					rgba(255,255,255,0) 1.2px,
					rgba(0,0,0,0.025) 2.4px,
					rgba(255,255,255,0) 3.6px),
				radial-gradient(ellipse at center, transparent 55%, rgba(40,46,52,0.35) 100%);
		}
		@keyframes lg-shimmer {
			0%   { filter: brightness(1)    saturate(1)    contrast(1); }
			50%  { filter: brightness(1.04) saturate(0.98) contrast(1.02); }
			100% { filter: brightness(0.98) saturate(1.02) contrast(1); }
		}
		.lg-root > * { position: relative; z-index: 1; }

		/* glass surface — frosted on chrome */
		.lg-glass {
			width: 100%;
			backdrop-filter: blur(28px) saturate(125%);
			-webkit-backdrop-filter: blur(28px) saturate(125%);
			background: linear-gradient(135deg, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.18) 100%);
			border: 1px solid rgba(255,255,255,0.65);
			border-radius: 22px;
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,0.85),
				inset 0 -1px 0 rgba(40,46,52,0.08),
				0 12px 36px rgba(40,46,52,0.18),
				0 2px 6px rgba(40,46,52,0.10);
		}

		/* All buttons: silvery glass pill */
		.lg-root button {
			font-family: var(--lg-display) !important;
			font-weight: 500 !important;
			letter-spacing: -0.005em !important;
			backdrop-filter: blur(20px) saturate(125%) !important;
			-webkit-backdrop-filter: blur(20px) saturate(125%) !important;
			background: linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(220,226,232,0.35) 100%) !important;
			color: #232830 !important;
			border: 1px solid rgba(255,255,255,0.7) !important;
			border-radius: 16px !important;
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,0.9),
				inset 0 -1px 0 rgba(40,46,52,0.08),
				0 6px 18px rgba(40,46,52,0.18) !important;
			transition: transform 200ms ease, background 200ms ease, box-shadow 200ms ease;
		}
		.lg-root button:hover {
			background: linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(220,226,232,0.5) 100%) !important;
			transform: translateY(-1px);
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,1),
				0 10px 28px rgba(40,46,52,0.22) !important;
		}
		.lg-root button:active { transform: translateY(0); }

		.lg-wordmark { display: inline-flex; flex-direction: column; gap: 0.18em; line-height: 1; }
		.lg-wordmark__main {
			font-family: var(--lg-display);
			font-weight: 700;
			font-size: clamp(1.6rem, 3.4cqw, 2.6rem);
			letter-spacing: -0.025em;
			background: linear-gradient(180deg, #1a1d22 0%, #6a727c 100%);
			-webkit-background-clip: text;
			background-clip: text;
			color: transparent;
		}
		.lg-wordmark__sub {
			font-family: var(--lg-mono);
			font-size: 0.62rem;
			letter-spacing: 0.18em;
			color: rgba(40,46,52,0.55);
			text-transform: uppercase;
		}

		.lg-chip {
			padding: 0.55em 0.9em !important;
			font-size: 0.78rem !important;
			border-radius: 999px !important;
		}

		.lg-tag {
			font-family: var(--lg-mono);
			font-size: 0.62rem;
			letter-spacing: 0.24em;
			text-transform: uppercase;
			color: rgba(40,46,52,0.55);
			margin-bottom: 1.2vh;
		}

		.lg-prize { padding: 1.6vh 2vh; }
		.lg-prize__rows { display: flex; flex-direction: column; gap: 0.8vh; }
		.lg-prize__row {
			display: grid;
			grid-template-columns: auto 1fr auto;
			align-items: center;
			gap: 0.8em;
			padding: 0.4vh 0;
			font-size: 1rem;
		}
		.lg-prize__dot {
			width: 12px; height: 12px; border-radius: 50%;
			display: inline-block;
		}
		.lg-prize__name { color: #232830; font-weight: 500; }
		.lg-prize__odds {
			font-family: var(--lg-mono);
			color: #232830;
			font-variant-numeric: tabular-nums;
			font-size: 1rem;
		}

		.lg-rules {
			width: 100% !important;
			padding: 1em !important;
			font-size: 0.95rem !important;
			border-radius: 18px !important;
		}

		.lg-modal {
			position: fixed; inset: 0; z-index: 200;
			display: flex; align-items: center; justify-content: center;
			background: rgba(120,128,138,0.35);
			backdrop-filter: blur(8px);
			-webkit-backdrop-filter: blur(8px);
			padding: 4vh 4vw;
		}
		.lg-modal__inner {
			max-width: 520px;
			padding: 4vh 4vw;
			position: relative;
			border-radius: 28px !important;
		}
		.lg-modal__inner h2 {
			font-weight: 700; font-size: 1.6rem;
			letter-spacing: -0.025em;
			margin: 0.4vh 0 1.6vh;
			color: #1a1d22;
		}
		.lg-modal__inner ol {
			padding-left: 1.4em; line-height: 1.65;
			font-size: 1rem;
			color: #2e343c;
		}
		.lg-modal__inner ol li { margin: 0.6vh 0; }
		.lg-modal__close {
			position: absolute !important;
			top: 1vh !important; right: 1vw !important;
			width: 2.2em !important; height: 2.2em !important;
			padding: 0 !important;
			border-radius: 50% !important;
			font-size: 0.9rem !important;
		}

		/* ───── Dark / Space Black Titanium ───── */
		.dark .lg-root {
			color: #d8dadd;
			background: #16181b;
		}
		.dark .lg-root::before {
			background:
				radial-gradient(ellipse 70vmax 50vmax at 18% 18%, rgba(72,80,88,0.85) 0%, transparent 55%),
				radial-gradient(ellipse 60vmax 40vmax at 82% 28%, rgba(56,62,70,0.6) 0%, transparent 55%),
				radial-gradient(ellipse 80vmax 55vmax at 75% 88%, rgba(8,10,12,0.7) 0%, transparent 55%),
				radial-gradient(ellipse 55vmax 40vmax at 12% 95%, rgba(20,22,26,0.65) 0%, transparent 55%),
				linear-gradient(135deg, #2a2d31 0%, #1a1c20 45%, #252830 70%, #14161a 100%);
		}
		.dark .lg-root::after {
			background:
				repeating-linear-gradient(95deg,
					rgba(255,255,255,0.025) 0px,
					rgba(255,255,255,0) 1.2px,
					rgba(0,0,0,0.06) 2.4px,
					rgba(255,255,255,0) 3.6px),
				radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.65) 100%);
		}
		.dark .lg-glass {
			background: linear-gradient(135deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.03) 100%);
			border: 1px solid rgba(255,255,255,0.10);
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,0.16),
				inset 0 -1px 0 rgba(0,0,0,0.32),
				0 14px 40px rgba(0,0,0,0.55),
				0 2px 8px rgba(0,0,0,0.35);
		}
		.dark .lg-root button {
			background: linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%) !important;
			color: #e2e4e7 !important;
			border: 1px solid rgba(255,255,255,0.14) !important;
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,0.18),
				inset 0 -1px 0 rgba(0,0,0,0.32),
				0 6px 18px rgba(0,0,0,0.5) !important;
		}
		.dark .lg-root button:hover {
			background: linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.06) 100%) !important;
			box-shadow:
				inset 0 1px 0 rgba(255,255,255,0.24),
				0 10px 28px rgba(0,0,0,0.6) !important;
		}
		.dark .lg-wordmark__main {
			background: linear-gradient(180deg, #f0f2f4 0%, #7a8088 100%);
			-webkit-background-clip: text;
			background-clip: text;
			color: transparent;
		}
		.dark .lg-wordmark__sub { color: rgba(216,218,221,0.5); }
		.dark .lg-tag { color: rgba(216,218,221,0.5); }
		.dark .lg-prize__name { color: #e2e4e7; }
		.dark .lg-prize__odds { color: #e2e4e7; }
		.dark .lg-modal { background: rgba(0,0,0,0.55); }
		.dark .lg-modal__inner h2 { color: #f0f2f4; }
		.dark .lg-modal__inner ol { color: #c8ccd0; }
	`}</style>
);

export default function LiquidGlassVariant() {
	return (
		<VariantLayout
			className={`lg-root ${display.variable} ${mono.variable}`}
			globalStyles={styles}
			themeToggle={<ThemeToggle />}
			wordmark={<Wordmark />}
			wallet={<Wallet />}
			prizePanel={() => <PrizePanel />}
			rulesTrigger={() => <RulesTrigger />}
		/>
	);
}
