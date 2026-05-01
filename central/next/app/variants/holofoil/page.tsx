"use client";

import { Bungee, Nunito } from "next/font/google";
import { useState } from "react";
import VariantLayout from "../_shared/VariantLayout";

const display = Bungee({ weight: "400", subsets: ["latin"], variable: "--hf-display" });
const body = Nunito({ weight: ["400", "700", "900"], subsets: ["latin"], variable: "--hf-body" });

const TIERS = [
	{ name: "Common", odds: "70%", foil: "silver", emoji: "🟢" },
	{ name: "Rare",   odds: "25%", foil: "blue",   emoji: "🔵" },
	{ name: "Chase",  odds: "5%",  foil: "rainbow", emoji: "🌈" },
];

const Wordmark = () => (
	<span className="hf-wordmark">
		<span className="hf-wordmark__sun">☆</span>
		<span className="hf-wordmark__main">GARRA!</span>
	</span>
);

const ThemeToggle = () => <button className="hf-icon" aria-label="theme">☀</button>;
const Wallet = () => <button className="hf-icon">$</button>;

const PrizePanel = () => (
	<div className="hf-panel">
		<div className="hf-panel__title">⟡ what’s in the machine ⟡</div>
		<div className="hf-panel__cards">
			{TIERS.map((t) => (
				<div className={`hf-card hf-card--${t.foil}`} key={t.name}>
					<div className="hf-card__shimmer" aria-hidden />
					<span className="hf-card__emoji" aria-hidden>{t.emoji}</span>
					<span className="hf-card__name">{t.name}</span>
					<span className="hf-card__odds">{t.odds}</span>
				</div>
			))}
		</div>
	</div>
);

const RulesTrigger = () => {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button className="hf-rules" onClick={() => setOpen(true)}>?  HOW · 2 · PLAY  ?</button>
			{open && (
				<div className="hf-modal" onClick={() => setOpen(false)}>
					<div className="hf-modal__inner" onClick={(e) => e.stopPropagation()}>
						<button className="hf-modal__close" onClick={() => setOpen(false)}>✕</button>
						<div className="hf-modal__sticker">HOW 2 PLAY!</div>
						<ol>
							<li>Connect your wallet to <b>insert a coin</b>.</li>
							<li>Drive the claw — <b>WASD</b> or arrows, <b>SPACE</b> to grab.</li>
							<li>Snag a sphere → score a Pokémon pack.</li>
							<li>Choose: <b>cash out</b>, or <b>vault</b> it for shipment within 30 days.</li>
						</ol>
					</div>
				</div>
			)}
		</>
	);
};

const styles = (
	<style jsx global>{`
		.hf-root {
			font-family: var(--hf-body);
			min-height: 100vh;
			background: linear-gradient(180deg, #cfeeff 0%, #ffe7c7 75%, #ffd9b3 100%);
			color: #1d3557;
			position: relative;
		}
		.hf-root::before {
			content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
			background:
				radial-gradient(ellipse 280px 120px at 12% 14%, #fff 0%, transparent 60%),
				radial-gradient(ellipse 200px 80px at 78% 22%, #fff 0%, transparent 60%),
				radial-gradient(ellipse 360px 140px at 90% 78%, #fff 0%, transparent 60%);
			opacity: 0.7;
		}
		.hf-root > * { position: relative; z-index: 1; }
		.hf-root button {
			font-family: var(--hf-display) !important;
			background: #ffcb05 !important;
			color: #cc0000 !important;
			border: 4px solid #cc0000 !important;
			border-radius: 16px !important;
			box-shadow: 4px 4px 0 #1d3557 !important;
			letter-spacing: 0.04em !important;
		}
		.hf-root button:hover { transform: translate(-1px, -1px); box-shadow: 5px 5px 0 #1d3557 !important; }
		.hf-root button:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0 #1d3557 !important; }
		.hf-wordmark { display: inline-flex; align-items: center; gap: 0.3em; }
		.hf-wordmark__sun {
			font-family: var(--hf-display);
			font-size: 1.4rem; color: #ffcb05;
			filter: drop-shadow(0 2px 0 #cc0000);
			animation: hf-spin 12s linear infinite;
		}
		@keyframes hf-spin { to { transform: rotate(360deg); } }
		.hf-wordmark__main {
			font-family: var(--hf-display);
			font-size: clamp(1.4rem, 3cqw, 2.4rem);
			color: #ffcb05;
			letter-spacing: 0.02em;
			-webkit-text-stroke: 2px #cc0000;
			text-shadow: 3px 3px 0 #1d3557;
		}
		.hf-icon {
			width: 2.6em !important; height: 2.6em !important;
			padding: 0 !important;
			border-radius: 50% !important;
			font-size: 1rem !important;
			border-width: 3px !important;
		}
		.hf-panel {
			width: 100%;
			background: #fff;
			border: 4px solid #1d3557;
			border-radius: 18px;
			padding: 1.6vh 1.6vh;
			box-shadow: 4px 4px 0 #ffcb05;
			transform: rotate(-0.6deg);
		}
		.hf-panel__title {
			font-family: var(--hf-display);
			font-size: 0.78rem;
			color: #1d3557;
			text-align: center;
			margin-bottom: 1vh;
			letter-spacing: 0.04em;
		}
		.hf-panel__cards { display: flex; flex-direction: column; gap: 0.8vh; }
		.hf-card {
			position: relative;
			display: grid;
			grid-template-columns: auto 1fr auto;
			align-items: center;
			gap: 0.6em;
			padding: 0.8vh 1.2vh;
			border: 3px solid #1d3557;
			border-radius: 12px;
			overflow: hidden;
		}
		.hf-card__emoji { font-size: 1.4rem; }
		.hf-card__name {
			font-family: var(--hf-display);
			font-size: 0.9rem;
			color: #1d3557;
		}
		.hf-card__odds {
			font-family: var(--hf-display);
			font-size: 1.1rem;
			color: #cc0000;
		}
		.hf-card__shimmer {
			position: absolute; inset: 0;
			mix-blend-mode: screen;
			background: linear-gradient(115deg, transparent 30%, rgba(255,255,255,0.65) 48%, transparent 66%);
			transform: translateX(-30%);
			animation: hf-shimmer 4s ease-in-out infinite;
			pointer-events: none;
		}
		@keyframes hf-shimmer {
			0%,100% { transform: translateX(-40%); opacity: 0; }
			50% { transform: translateX(40%); opacity: 1; }
		}
		.hf-card--silver { background: linear-gradient(135deg, #fff 0%, #f0f0f0 60%, #d6d6d6 100%); }
		.hf-card--blue   { background: linear-gradient(135deg, #cfe2ff 0%, #fff 50%, #b8d8ff 100%); }
		.hf-card--rainbow { background: linear-gradient(120deg, #ffd1dc 0%, #ffe8b3 25%, #c8f0c5 50%, #c5e8ff 75%, #e7c5ff 100%); }
		.hf-rules {
			width: 100% !important;
			font-size: 0.95rem !important;
			padding: 1em 1.4em !important;
		}
		.hf-modal {
			position: fixed; inset: 0; background: rgba(29,53,87,0.55);
			display: flex; align-items: center; justify-content: center; z-index: 200;
		}
		.hf-modal__inner {
			position: relative;
			background: #fff;
			border: 6px solid #1d3557;
			border-radius: 28px;
			padding: 4vh 5vw; max-width: 540px;
			box-shadow: 10px 10px 0 #ffcb05;
			transform: rotate(-1deg);
		}
		.hf-modal__sticker {
			position: absolute; top: -1.2em; left: 50%;
			transform: translateX(-50%) rotate(-4deg);
			font-family: var(--hf-display);
			font-size: 1.1rem;
			background: #cc0000; color: #fff;
			padding: 0.5em 1.4em;
			border-radius: 12px;
			box-shadow: 4px 4px 0 #1d3557;
		}
		.hf-modal__inner ol {
			margin: 1vh 0 0; padding-left: 1.6em;
			font-size: 1.05rem; line-height: 1.65;
			font-family: var(--hf-body);
		}
		.hf-modal__inner b { color: #cc0000; }
		.hf-modal__close {
			position: absolute !important;
			top: 1vh !important; right: 1vw !important;
			width: 2.4em !important; height: 2.4em !important;
			padding: 0 !important;
			border-radius: 50% !important;
		}
	`}</style>
);

export default function HolofoilVariant() {
	return (
		<VariantLayout
			className={`hf-root ${display.variable} ${body.variable}`}
			globalStyles={styles}
			themeToggle={<ThemeToggle />}
			wordmark={<Wordmark />}
			wallet={<Wallet />}
			prizePanel={() => <PrizePanel />}
			rulesTrigger={() => <RulesTrigger />}
		/>
	);
}
