"use client";

import { Italiana, Cormorant_Garamond } from "next/font/google";
import { useState } from "react";
import VariantLayout from "../_shared/VariantLayout";

const display = Italiana({ weight: "400", subsets: ["latin"], variable: "--bq-display" });
const body = Cormorant_Garamond({
	weight: ["300", "400", "500"],
	style: ["normal", "italic"],
	subsets: ["latin"],
	variable: "--bq-body",
});

const TIERS = [
	{ roman: "I.", name: "Common", odds: "70" },
	{ roman: "II.", name: "Rare", odds: "25" },
	{ roman: "III.", name: "Chase", odds: "5" },
];

const Wordmark = () => (
	<span className="bq-wordmark">
		<span className="bq-wordmark__main">Garra</span>
		<span className="bq-wordmark__sub">Maison · Est. MMXXV</span>
	</span>
);

const ThemeToggle = () => <button className="bq-icon" aria-label="theme">◐</button>;
const Wallet = () => <button className="bq-icon">Wallet ↗</button>;

const PrizePanel = () => (
	<div className="bq-panel">
		<div className="bq-eyebrow">Manifest</div>
		<ul>
			{TIERS.map((t) => (
				<li key={t.name}>
					<span className="bq-roman">{t.roman}</span>
					<span className="bq-tier-name">{t.name}</span>
					<span className="bq-odds">{t.odds}<span className="bq-odds__pct">%</span></span>
				</li>
			))}
		</ul>
	</div>
);

const RulesTrigger = () => {
	const [open, setOpen] = useState(false);
	return (
		<>
			<button className="bq-rules" onClick={() => setOpen(true)}>
				<em>A concordance</em> ↗
			</button>
			{open && (
				<aside className="bq-overlay" onClick={() => setOpen(false)}>
					<div className="bq-sheet" onClick={(e) => e.stopPropagation()}>
						<button className="bq-close" onClick={() => setOpen(false)}>Close</button>
						<div className="bq-eyebrow">A Concordance</div>
						<h2>Of the Game</h2>
						<p><em>One.</em> A claw waits. A small fee, paid in coin of the realm.</p>
						<p><em>Two.</em> You manoeuvre. The claw obeys, with some delay.</p>
						<p><em>Three.</em> If fortune attends, a sphere lifts.</p>
						<p><em>Four.</em> Choose: liquidate at once, or hold against future shipment — for thirty days, no longer.</p>
					</div>
				</aside>
			)}
		</>
	);
};

const styles = (
	<style jsx global>{`
		.bq-root {
			font-family: var(--bq-body);
			background: #f5f1ea;
			color: #0d0c0a;
			min-height: 100vh;
			position: relative;
		}
		.bq-root::before {
			content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 99;
			opacity: 0.07;
			background-image: radial-gradient(rgba(0,0,0,0.7) 1px, transparent 1px);
			background-size: 3px 3px;
		}
		.bq-root button {
			font-family: var(--bq-body) !important;
			font-weight: 400 !important;
			background: transparent !important;
			color: #0d0c0a !important;
			border: 1px solid #0d0c0a !important;
			border-radius: 0 !important;
			box-shadow: none !important;
			letter-spacing: 0.32em !important;
			text-transform: uppercase;
			font-size: 0.78rem !important;
			transition: background 240ms ease, color 240ms ease;
		}
		.bq-root button:hover { background: #0d0c0a !important; color: #f5f1ea !important; }
		.bq-wordmark { display: inline-flex; flex-direction: column; gap: 0.2em; line-height: 1; }
		.bq-wordmark__main {
			font-family: var(--bq-display);
			font-size: clamp(1.8rem, 4cqw, 2.8rem);
			letter-spacing: 0.04em;
		}
		.bq-wordmark__sub {
			font-size: 0.62rem; letter-spacing: 0.32em;
			text-transform: uppercase; color: #6a5f4d;
		}
		.bq-icon {
			padding: 0.5em 0.9em !important;
			font-size: 0.7rem !important;
		}
		.bq-eyebrow {
			font-family: var(--bq-body);
			font-size: 0.7rem; letter-spacing: 0.36em;
			text-transform: uppercase; color: #6a5f4d;
			margin-bottom: 1.2vh;
		}
		.bq-panel {
			width: 100%;
			padding: 0;
		}
		.bq-panel ul {
			list-style: none; padding: 0; margin: 0;
			border-top: 1px solid #0d0c0a;
		}
		.bq-panel li {
			display: grid;
			grid-template-columns: 2.2em 1fr auto;
			align-items: baseline; gap: 1em;
			padding: 1.2vh 0;
			border-bottom: 1px solid #0d0c0a;
		}
		.bq-roman {
			font-family: var(--bq-display);
			font-size: 1.3rem; color: #b88c3a;
		}
		.bq-tier-name {
			font-size: 1.1rem; letter-spacing: 0.04em;
		}
		.bq-odds {
			font-family: var(--bq-display);
			font-size: 1.5rem;
			color: #0d0c0a;
		}
		.bq-odds__pct { font-size: 0.85rem; margin-left: 0.1em; color: #6a5f4d; }
		.bq-rules {
			width: 100%;
			background: transparent !important;
			color: #1a1814 !important;
			border: 0 !important;
			border-bottom: 1px solid #0d0c0a !important;
			border-radius: 0 !important;
			padding: 1.2em 0 !important;
			letter-spacing: 0.04em !important;
			text-transform: none !important;
			font-size: 1rem !important;
			font-style: italic;
		}
		.bq-rules:hover { background: transparent !important; color: #b88c3a !important; }
		.bq-overlay {
			position: fixed; inset: 0;
			background: rgba(13,12,10,0.45);
			display: flex; justify-content: flex-end; z-index: 200;
		}
		.bq-sheet {
			background: #f5f1ea;
			width: min(520px, 90vw);
			height: 100%;
			padding: 6vh 4vw;
			overflow-y: auto;
			box-shadow: -30px 0 80px rgba(0,0,0,0.2);
			position: relative;
		}
		.bq-sheet h2 {
			font-family: var(--bq-display);
			font-size: 2.4rem; line-height: 1; margin: 1vh 0 2.4vh;
			font-weight: 400;
		}
		.bq-sheet p { font-size: 1.1rem; margin: 1.2vh 0; }
		.bq-sheet em { color: #b88c3a; font-style: italic; }
		.bq-close {
			position: absolute !important;
			top: 2vh !important; right: 2vw !important;
			padding: 0.6em 1em !important;
			width: auto !important;
		}
	`}</style>
);

export default function BoutiqueVariant() {
	return (
		<VariantLayout
			className={`bq-root ${display.variable} ${body.variable}`}
			globalStyles={styles}
			themeToggle={<ThemeToggle />}
			wordmark={<Wordmark />}
			wallet={<Wallet />}
			prizePanel={() => <PrizePanel />}
			rulesTrigger={() => <RulesTrigger />}
		/>
	);
}
