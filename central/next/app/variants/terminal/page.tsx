"use client";

import { JetBrains_Mono } from "next/font/google";
import { useState } from "react";
import VariantLayout from "../_shared/VariantLayout";

const mono = JetBrains_Mono({ weight: ["400", "500", "700"], subsets: ["latin"], variable: "--tm-mono" });

const TIERS = [
	{ key: "common", odds: 0.70 },
	{ key: "rare",   odds: 0.25 },
	{ key: "chase",  odds: 0.05 },
];

const bar = (p: number, w = 12) => "█".repeat(Math.round(p * w)) + "░".repeat(w - Math.round(p * w));

const Wordmark = () => (
	<span className="tm-wordmark">
		<span className="tm-wordmark__bracket">[</span>
		<span className="tm-wordmark__main">GARRA::CLAW</span>
		<span className="tm-wordmark__bracket">]</span>
		<span className="tm-wordmark__ver">v0.4</span>
	</span>
);

const ThemeToggle = () => <button className="tm-chip">{`>`} dark</button>;
const Wallet = () => <button className="tm-chip">[$] connect</button>;

const PrizePanel = () => (
	<div className="tm-panel">
		<div className="tm-tag">// odds</div>
		<pre className="tm-manifest">
{`KIND     PROB
${TIERS.map((t) => `${t.key.toUpperCase().padEnd(7)}  ${(t.odds * 100).toFixed(1).padStart(4)}%  ${bar(t.odds)}`).join("\n")}`}
		</pre>
	</div>
);

const RulesTrigger = () => {
	const [open, setOpen] = useState(false);
	return (
		<div className="tm-help" style={{ width: "100%" }}>
			<button className="tm-help__toggle" onClick={() => setOpen((v) => !v)}>
				{open ? "[-]" : "[+]"} /help
			</button>
			{open && (
				<pre className="tm-help__body">
{`> CLAW PROTOCOL
  1. authenticate :: connect.wallet
  2. enqueue      :: pay-per-grab
  3. drive        :: WASD / arrows + SPACE
  4. resolve      :: cash-out OR vault[<=30d]`}
				</pre>
			)}
		</div>
	);
};

const styles = (
	<style jsx global>{`
		.tm-root {
			font-family: var(--tm-mono);
			background: #000;
			color: #efefef;
			min-height: 100vh;
			position: relative;
			font-size: 14px;
		}
		.tm-root::before {
			content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;
			background-image:
				linear-gradient(0deg, rgba(255,255,255,0.04) 1px, transparent 1px),
				linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px);
			background-size: 28px 28px;
		}
		.tm-root > * { position: relative; z-index: 1; }
		.tm-root button {
			font-family: var(--tm-mono) !important;
			font-size: 12px !important;
			font-weight: 700 !important;
			text-transform: uppercase;
			letter-spacing: 0.16em !important;
			background: #efefef !important;
			color: #000 !important;
			border-radius: 0 !important;
			box-shadow: none !important;
			border: 1px solid #efefef !important;
		}
		.tm-root button:hover {
			background: #ff2400 !important;
			color: #fff !important;
			border-color: #ff2400 !important;
		}
		.tm-wordmark { display: inline-flex; align-items: baseline; gap: 0.4em; font-family: var(--tm-mono); }
		.tm-wordmark__bracket { color: #6a6a6a; }
		.tm-wordmark__main {
			font-weight: 700; font-size: clamp(0.95rem, 2cqw, 1.4rem);
			letter-spacing: 0.16em; color: #fff;
		}
		.tm-wordmark__ver { font-size: 0.7rem; color: #00cf6c; letter-spacing: 0.1em; }
		.tm-chip {
			padding: 0.5em 0.9em !important;
			background: transparent !important;
			color: #efefef !important;
			border: 1px solid #6a6a6a !important;
		}
		.tm-chip:hover { border-color: #00cf6c !important; color: #00cf6c !important; background: transparent !important; }
		.tm-panel { width: 100%; padding: 1vh 0; border-top: 1px dashed #2a2a2a; border-bottom: 1px dashed #2a2a2a; }
		.tm-tag {
			font-size: 11px; color: #6a6a6a;
			letter-spacing: 0.1em;
			margin-bottom: 1vh;
		}
		.tm-manifest {
			font-family: var(--tm-mono);
			font-size: 12px; line-height: 1.5;
			color: #efefef;
			margin: 0; white-space: pre;
		}
		.tm-help { padding: 0.6vh 0; }
		.tm-help__toggle {
			font-family: var(--tm-mono) !important;
			font-size: 12px !important; color: #00cf6c !important;
			background: transparent !important; border: 0 !important;
			padding: 0 !important; cursor: pointer;
			letter-spacing: 0.05em !important;
			text-transform: none !important;
			text-align: left;
			width: auto !important;
		}
		.tm-help__toggle:hover { color: #efefef !important; background: transparent !important; }
		.tm-help__body {
			font-family: var(--tm-mono); font-size: 12px;
			color: #9aa0a6; margin-top: 1vh;
			white-space: pre;
		}
	`}</style>
);

export default function TerminalVariant() {
	return (
		<VariantLayout
			className={`tm-root ${mono.variable}`}
			globalStyles={styles}
			themeToggle={<ThemeToggle />}
			wordmark={<Wordmark />}
			wallet={<Wallet />}
			prizePanel={() => <PrizePanel />}
			rulesTrigger={() => <RulesTrigger />}
		/>
	);
}
