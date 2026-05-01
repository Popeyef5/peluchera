export type Variant = {
	slug: string;
	label: string;
	notes?: string;
};

export const VARIANTS: Variant[] = [
	{ slug: "default", label: "Current", notes: "Baseline — alias of app/page.tsx" },
	{ slug: "arcade", label: "Arcade CRT", notes: "Y2K cabinet. Press Start 2P + VT323. Neon, scanlines, synthwave grid." },
	{ slug: "boutique", label: "Maison Garra", notes: "Editorial luxury. Italiana + Cormorant. Cream, ink, gold hairlines." },
	{ slug: "terminal", label: "Terminal v0.4", notes: "Brutalist mono terminal. JetBrains Mono. Hex grid, ASCII, signal red." },
	{ slug: "holofoil", label: "Holofoil TCG", notes: "Pokémon-card playful. Bungee + Nunito. Foil shimmer, chunky, tilted." },
	{ slug: "liquid-glass", label: "Liquid Glass", notes: "Apple-style frosted panels with vibrancy. Bricolage Grotesque + Geist Mono." },
];
