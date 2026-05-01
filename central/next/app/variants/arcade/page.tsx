"use client";

import { Press_Start_2P, VT323 } from "next/font/google";
import { useState } from "react";
import VariantLayout from "../_shared/VariantLayout";

const display = Press_Start_2P({ weight: "400", subsets: ["latin"], variable: "--arc-display" });
const body = VT323({ weight: "400", subsets: ["latin"], variable: "--arc-body" });

const TIERS = [
	{ name: "COMMON", odds: "70%", glow: "#00ffff", icon: "□" },
	{ name: "RARE", odds: "25%", glow: "#ff00aa", icon: "◇" },
	{ name: "CHASE", odds: "05%", glow: "#ffaa00", icon: "★" },
];

const Wordmark = () => (
	<span className="arc-wordmark">
		<span className="arc-wordmark__title">GARRA</span>
		<span className="arc-wordmark__sub">★ GRAB·A·PACK ★</span>
	</span>
);

const ThemeToggle = () => <button className="arc-chip" aria-label="theme">▣</button>;
const Wallet = () => <button className="arc-chip">¢ INSERT</button>;

const PrizePanel = () => (
	<div className="arc-panel arc-prize">
		<div className="arc-panel__title">★ PRIZE TABLE ★</div>
		{TIERS.map((t) => (
			<div className="arc-prize__row" key={t.name} style={{ ["--glow" as string]: t.glow }}>
				<span className="arc-prize__icon">{t.icon}</span>
				<span className="arc-prize__name">{t.name}</span>
				<span className="arc-prize__odds">{t.odds}</span>
			</div>
		))}
	</div>
);

const RulesTrigger = () => {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button className="arc-rules-btn" onClick={() => setOpen(true)}>?? RULES ??</button>
			{open && (
				<div className="arc-rules-modal" onClick={() => setOpen(false)}>
					<div className="arc-rules-modal__inner" onClick={(e) => e.stopPropagation()}>
						<button className="arc-rules-close" onClick={() => setOpen(false)}>×</button>
						<h2>HOW TO PLAY</h2>
						<p>1. INSERT COIN — CONNECT WALLET</p>
						<p>2. PRESS START — CLAW MOVES</p>
						<p>3. GRAB A POKÉMON PACK</p>
						<p>4. CASH OUT OR HOLD IN VAULT</p>
					</div>
				</div>
			)}
		</>
	);
};

const styles = (
	<style jsx global>{`
		.arc-root {
			font-family: var(--arc-body);
			background: radial-gradient(ellipse at top, #2a0040 0%, #0a0014 65%, #000 100%);
			color: #f0e6ff;
			min-height: 100vh;
			position: relative;
		}
		.arc-root::before {
			content: ""; position: fixed; inset: 0;
			background: repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0 2px, transparent 2px 4px);
			pointer-events: none; z-index: 100; mix-blend-mode: multiply;
		}
		.arc-root::after {
			content: ""; position: fixed; inset: 0;
			background: radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.78) 100%);
			pointer-events: none; z-index: 99;
		}
		.arc-root button {
			font-family: var(--arc-display) !important;
			letter-spacing: 0.08em !important;
			border-radius: 0 !important;
			background: #ff00aa !important;
			color: #fff !important;
			box-shadow: 4px 4px 0 #00ffff !important;
		}
		.arc-root button:hover { transform: translate(-1px, -1px); box-shadow: 5px 5px 0 #00ffff !important; }
		.arc-root button:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0 #00ffff !important; }
		.arc-wordmark { display: inline-flex; flex-direction: column; gap: 0.4em; line-height: 1; }
		.arc-wordmark__title {
			font-family: var(--arc-display); font-size: clamp(1.4rem, 3.6cqw, 2.6rem);
			color: #fff; letter-spacing: 0.08em;
			text-shadow: 0 0 6px #ff00aa, 0 0 14px #ff00aa, 0 0 28px #ff00aa66;
			animation: arc-flicker 6s infinite;
		}
		.arc-wordmark__sub {
			font-family: var(--arc-display); font-size: 0.46rem;
			color: #ffaa00; letter-spacing: 0.32em; text-shadow: 0 0 4px #ffaa00;
		}
		@keyframes arc-flicker { 0%,92%,100% { opacity: 1; } 93%,95% { opacity: 0.78; } 94% { opacity: 1; } }
		.arc-chip {
			font-family: var(--arc-display) !important;
			font-size: 0.55rem !important;
			background: #2a0040 !important; color: #ffaa00 !important;
			padding: 0.5em 0.7em !important;
			border: 2px solid #ffaa00 !important;
			box-shadow: 3px 3px 0 #ffaa00 !important;
		}
		.arc-panel {
			width: 100%;
			background: rgba(0,0,0,0.72);
			border: 3px solid #00ffff;
			padding: 2vh 1.6vh;
			box-shadow: 0 0 28px rgba(0,255,255,0.32), inset 0 0 28px rgba(0,255,255,0.08);
		}
		.arc-panel__title {
			font-family: var(--arc-display);
			font-size: 0.66rem; color: #00ffff; text-align: center;
			margin-bottom: 1.6vh; letter-spacing: 0.12em;
			text-shadow: 0 0 6px #00ffff;
		}
		.arc-prize__row {
			display: grid; grid-template-columns: auto 1fr auto;
			align-items: center; gap: 0.8em;
			font-family: var(--arc-body); font-size: 1.4rem;
			padding: 0.4vh 0;
			color: var(--glow); text-shadow: 0 0 6px var(--glow);
		}
		.arc-prize__icon { font-size: 1.6rem; }
		.arc-rules-btn {
			width: 100%;
			font-size: 0.62rem !important;
			background: #2a0040 !important;
			color: #ffaa00 !important;
			border: 2px solid #ffaa00 !important;
			box-shadow: 4px 4px 0 #ffaa00 !important;
			padding: 1.2vh !important;
		}
		.arc-rules-btn:hover { box-shadow: 5px 5px 0 #ffaa00 !important; }
		.arc-rules-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.88); display: flex; align-items: center; justify-content: center; z-index: 200; }
		.arc-rules-modal__inner {
			background: #0a0014; border: 4px solid #00ffff;
			padding: 4vh 5vw; max-width: 520px;
			color: #f0e6ff; font-family: var(--arc-body); font-size: 1.4rem;
			position: relative; box-shadow: 0 0 56px #00ffff;
		}
		.arc-rules-modal__inner h2 {
			font-family: var(--arc-display); font-size: 1rem; color: #00ffff;
			margin-bottom: 2vh; text-shadow: 0 0 8px #00ffff; letter-spacing: 0.1em;
		}
		.arc-rules-modal__inner p { margin: 1.2vh 0; }
		.arc-rules-close {
			position: absolute !important; top: 0 !important; right: 0.4em !important;
			background: transparent !important; border: none !important;
			color: #ff00aa !important; font-size: 1.4rem !important;
			box-shadow: none !important; padding: 0.2em 0.5em !important;
		}
	`}</style>
);

export default function ArcadeVariant() {
	return (
		<VariantLayout
			className={`arc-root ${display.variable} ${body.variable}`}
			globalStyles={styles}
			themeToggle={<ThemeToggle />}
			wordmark={<Wordmark />}
			wallet={<Wallet />}
			prizePanel={() => <PrizePanel />}
			rulesTrigger={() => <RulesTrigger />}
		/>
	);
}
