// Rarity strings match simeydotme/pokemon-cards-css conventions exactly so
// the GPL-ported CSS selectors apply.
export type Rarity =
	| "common"
	| "rare reverse holo"
	| "rare holo"
	| "rare holo cosmos"
	| "amazing rare"
	| "radiant rare"
	| "rare holo v"
	| "rare ultra"
	| "rare holo vmax"
	| "rare holo vstar"
	| "rare rainbow"
	| "rare rainbow alt"
	| "rare secret"
	| "trainer gallery rare holo"
	| "rare shiny"
	| "rare shiny v"
	| "rare shiny vmax";

export type Supertype = "pokémon" | "trainer" | "energy";

export type Card = {
	id: string;
	name: string;
	image: string;
	rarity: Rarity;
	supertype?: Supertype;
	subtypes?: string[];
	mask?: string;
	trainerGallery?: boolean; // sets data-trainer-gallery="true" — distinct simey CSS treatment
	// Direct foil-texture override. Real won cards set this from their admin
	// holo `type` (see foilForHoloType); the mock deck leaves it unset and the
	// foil is derived from rarity/subtypes instead.
	foil?: string;
};

// One card per visual rarity treatment, in the same order simey lists them
// at https://poke-holo.simey.me. Images come from the official Pokémon TCG
// API (https://images.pokemontcg.io) — same URLs simey's showcase uses, no
// local download needed.
const TCG = "https://images.pokemontcg.io";
export const MOCK_DECK: Card[] = [
	{ id: "common",       name: "Squirtle (Common)",                 rarity: "common",                    supertype: "pokémon", subtypes: ["basic"],     image: `${TCG}/sm10/33.png` },
	{ id: "reverse-holo", name: "Togedemaru (Reverse Holo)",         rarity: "rare reverse holo",         supertype: "pokémon", subtypes: ["basic"],     image: `${TCG}/swsh12/127.png` },
	{ id: "rare-holo",    name: "Articuno (Holofoil Rare)",          rarity: "rare holo",                 supertype: "pokémon", subtypes: ["stage1"],    image: `${TCG}/pgo/24.png` },
	{ id: "cosmos",       name: "Morpeko (Cosmos Holo)",             rarity: "rare holo cosmos",          supertype: "pokémon", subtypes: ["stage1"],    image: `${TCG}/swshp/SWSH012.png` },
	{ id: "amazing",      name: "Celebi (Amazing Rare)",             rarity: "amazing rare",              supertype: "pokémon", subtypes: ["basic"],     image: `${TCG}/swsh4/9.png` },
	{ id: "radiant",      name: "Radiant Charizard",                 rarity: "radiant rare",              supertype: "pokémon", subtypes: ["basic"],     image: `${TCG}/pgo/11.png` },
	{ id: "tg-holo",      name: "Charizard (Trainer Gallery Holo)",  rarity: "trainer gallery rare holo", supertype: "pokémon", subtypes: ["stage2"],    image: `${TCG}/swsh11tg/TG03.png` },
	{ id: "v-regular",    name: "Rayquaza V",                        rarity: "rare holo v",               supertype: "pokémon", subtypes: ["basic", "v"], image: `${TCG}/swsh7/110.png` },
	{ id: "v-full-art",   name: "Mew V (Full Art)",                  rarity: "rare ultra",                supertype: "pokémon", subtypes: ["basic", "v"], image: `${TCG}/swsh8/250.png` },
	{ id: "v-alt-art",    name: "Flareon V (Alternate Art)",         rarity: "rare ultra",                supertype: "pokémon", subtypes: ["basic", "v"], image: `${TCG}/swshp/SWSH179.png` },
	{ id: "vmax",         name: "Gyarados VMAX",                     rarity: "rare holo vmax",            supertype: "pokémon", subtypes: ["vmax"],      image: `${TCG}/swsh7/29.png` },
	{ id: "vmax-alt",     name: "Espeon VMAX (Alternate)",           rarity: "rare rainbow alt",          supertype: "pokémon", subtypes: ["vmax"],      image: `${TCG}/swsh8/270.png` },
	{ id: "vstar",        name: "Mewtwo VSTAR",                      rarity: "rare holo vstar",           supertype: "pokémon", subtypes: ["vstar"],     image: `${TCG}/pgo/31.png` },
	{ id: "trainer-fa",   name: "Peonia (Trainer Full Art)",         rarity: "rare ultra",                supertype: "trainer", subtypes: ["supporter"], image: `${TCG}/swsh6/196.png` },
	{ id: "rainbow",      name: "Pikachu VMAX (Rainbow)",            rarity: "rare rainbow",              supertype: "pokémon", subtypes: ["vmax"],      image: `${TCG}/swsh4/188.png` },
	{ id: "secret",       name: "Twin Energy (Secret Rare)",         rarity: "rare secret",               supertype: "energy",  subtypes: ["special"],   image: `${TCG}/swsh2/209.png` },
	{ id: "tg-v",         name: "Mimikyu V (Trainer Gallery)",       rarity: "rare holo v",               supertype: "pokémon", subtypes: ["basic", "v"], image: `${TCG}/swsh9tg/TG16.png`, trainerGallery: true },
	{ id: "tg-vmax",      name: "Mimikyu VMAX (Trainer Gallery)",    rarity: "rare holo vmax",            supertype: "pokémon", subtypes: ["vmax"],      image: `${TCG}/swsh9tg/TG17.png`, trainerGallery: true },
	{ id: "shiny",        name: "Minccino (Shiny Vault)",            rarity: "rare shiny",                supertype: "pokémon", subtypes: ["basic"],     image: `${TCG}/swsh45sv/SV093.png` },
	{ id: "shiny-v",      name: "Lapras V (Shiny Vault)",            rarity: "rare shiny v",              supertype: "pokémon", subtypes: ["basic", "v"], image: `${TCG}/swsh45sv/SV101.png` },
	// Note: simey's own dataset lists this card as "Rare Holo VMAX", not
	// "Rare Shiny VMAX" — they file it under the Shiny Vault section but
	// apply the standard VMAX rarity styling.
	{ id: "shiny-vmax",   name: "Charizard VMAX (Shiny Vault)",      rarity: "rare holo vmax",            supertype: "pokémon", subtypes: ["vmax"],      image: `${TCG}/swsh45sv/SV107.png` },
];

export const CARD_BACK_IMAGE = "/cards/back.webp";

/**
 * Maps a card to the tileable foil texture used as the first layer of its
 * shine/glare `background-image` stacks (CSS `var(--foil)`). Simey points
 * `--foil` at a per-card painted texture served from a private CDN; we don't
 * have access to that, so we pick one of our generic foils per rarity bucket.
 * We lose per-card variation but every premium rarity gets a real texture
 * instead of an empty layer.
 *
 * Texture choices follow simey's etch+style buckets:
 *   sunpillar  → metal.png      (V, radiant, shiny V)
 *   swsecret   → galaxy.jpg     (VMAX, VSTAR, secret, rainbow alt, shiny VMAX)
 *   rainbow    → rainbow.webp   (rainbow holo, trainer gallery default)
 *   swholo     → cosmos.webp    (rare holo, rare holo cosmos)
 *   glitter    → glitter.png    (amazing rare, shiny)
 *   wave       → wave.png       (rare ultra full-art, reverse holo)
 */
export function getFoilTexture(
	card: Pick<Card, "rarity" | "subtypes" | "trainerGallery">,
): string | undefined {
	if (card.trainerGallery) {
		if (card.subtypes?.includes("vmax")) return "/img/galaxy.jpg";
		if (card.subtypes?.includes("v"))    return "/img/metal.png";
		if (card.rarity === "rare secret")   return "/img/galaxy.jpg";
		return "/img/rainbow.webp";
	}
	switch (card.rarity) {
		case "common":                    return undefined;
		case "rare reverse holo":         return "/img/wave.png";
		case "rare holo":                 return "/img/cosmos.webp";
		case "rare holo cosmos":          return "/img/cosmos.webp";
		// Drop the .shine:before texture layer entirely — every generic tile we
		// have shows visible pattern artifacts here, and simey's hand-painted
		// per-card swsecret texture isn't something we can fake. Leaving --foil
		// unset invalidates the .shine:before background-image, so the layer
		// just doesn't render — the double-glitter base + .glare highlight are
		// closer to simey's appearance than any tiled foil we can substitute.
		case "amazing rare":              return undefined;
		case "radiant rare":              return "/img/metal.png";
		case "rare holo v":               return "/img/metal.png";
		case "rare ultra":                return "/img/wave.png";
		case "rare holo vmax":            return "/img/galaxy.jpg";
		case "rare holo vstar":           return "/img/galaxy.jpg";
		case "rare rainbow":              return "/img/rainbow.webp";
		case "rare rainbow alt":          return "/img/rainbow.webp";
		case "rare secret":               return "/img/galaxy.jpg";
		case "trainer gallery rare holo": return "/img/rainbow.webp";
		case "rare shiny":                return "/img/glitter.png";
		case "rare shiny v":              return "/img/metal.png";
		case "rare shiny vmax":           return "/img/galaxy.jpg";
		default:                          return undefined;
	}
}

// Every foil overlay getFoilTexture() can return. These are CSS background
// layers applied the instant a card flips, so if they aren't already in cache
// they decode visibly mid-animation. Preload the whole set up front (see
// preloadWinAssets). Keep in sync with the returns above.
export const FOIL_TEXTURES = [
	"/img/cosmos.webp",
	"/img/rainbow.webp",
	"/img/galaxy.jpg",
	"/img/metal.png",
	"/img/wave.png",
	"/img/glitter.png",
] as const;

// ─── Holo type → simey render treatment ──────────────────────────────────
//
// Single source of truth mapping an admin holo `type` (the managed `holo_type`
// vocabulary) to the simeydotme/pokemon-cards-css treatment: the data-rarity /
// data-subtypes / data-supertype / trainer-gallery attributes the ported CSS
// keys off (see globals.css), plus the tiled foil texture. Keys are holo_type
// names (kebab-case). The categories mirror https://poke-holo.simey.me, so a
// card lights up with the right effect the instant it's shown — instead of the
// old behavior, which flattened every won card to a matte common.
export type HoloStyle = {
	rarity: Rarity;
	subtypes?: string[];
	supertype?: Supertype;
	trainerGallery?: boolean;
	foil?: string;
};

export const HOLO_STYLES: Record<string, HoloStyle> = {
	// Non-foil base
	"basic":            { rarity: "common", subtypes: ["basic"], supertype: "pokémon" },
	"common":           { rarity: "common", subtypes: ["basic"], supertype: "pokémon" },
	// Classic holofoils
	"reverse-holo":     { rarity: "rare reverse holo",          foil: "/img/wave.png" },
	"holo":             { rarity: "rare holo",                  foil: "/img/cosmos.webp" },
	"cosmos-holo":      { rarity: "rare holo cosmos",           foil: "/img/cosmos.webp" },
	"amazing":          { rarity: "amazing rare" },
	"radiant-holo":     { rarity: "radiant rare",     subtypes: ["basic"],      foil: "/img/metal.png" },
	// V / VMAX / VSTAR line
	"v":                { rarity: "rare holo v",       subtypes: ["basic", "v"], foil: "/img/metal.png" },
	"v-full-art":       { rarity: "rare ultra",        subtypes: ["basic", "v"], foil: "/img/wave.png" },
	"ultra":            { rarity: "rare ultra",        subtypes: ["basic", "v"], foil: "/img/wave.png" },
	"vmax":             { rarity: "rare holo vmax",    subtypes: ["vmax"],       foil: "/img/galaxy.jpg" },
	"vmax-alt":         { rarity: "rare rainbow alt",  subtypes: ["vmax"],       foil: "/img/rainbow.webp" },
	"vstar":            { rarity: "rare holo vstar",   subtypes: ["vstar"],      foil: "/img/galaxy.jpg" },
	// Rainbow / secret / gold
	"rainbow":          { rarity: "rare rainbow",      subtypes: ["vmax"],       foil: "/img/rainbow.webp" },
	"galaxy-holo":      { rarity: "rare secret",       foil: "/img/galaxy.jpg" },
	"secret":           { rarity: "rare secret",       foil: "/img/galaxy.jpg" },
	// Trainer gallery / full art
	"trainer-gallery":  { rarity: "trainer gallery rare holo", trainerGallery: true, foil: "/img/rainbow.webp" },
	"trainer-full-art": { rarity: "rare ultra", supertype: "trainer", subtypes: ["supporter"], foil: "/img/wave.png" },
	// Shiny vault
	"shiny":            { rarity: "rare shiny",        subtypes: ["basic"],      foil: "/img/glitter.png" },
	"shiny-v":          { rarity: "rare shiny v",      subtypes: ["basic", "v"], foil: "/img/metal.png" },
};

// The simey treatment for an admin holo `type`. Unknown/empty → a matte common.
export function holoStyle(type: string | null | undefined): HoloStyle {
	return HOLO_STYLES[(type || "").toLowerCase()] ?? { rarity: "common" };
}

// Back-compat: the foil texture alone for a holo `type` — now read from the
// HOLO_STYLES map above so there's one place to keep in sync.
export function foilForHoloType(type: string | null | undefined): string | undefined {
	return holoStyle(type).foil;
}

// A card as it arrives in the player_win / open-booster payload.
export type WinRevealCard = {
	id: string;
	name: string | null;
	image_url: string | null;
	type: string | null;
	rarity: string | null;
	position?: number | null;
};

// Convert the won cards into the deck shape the reveal (CardStack/HoloCard)
// renders. The holo `type` drives the full simey treatment — data-rarity,
// subtypes, supertype, trainer-gallery and the foil texture — so each card
// shows the effect for its own category instead of rendering flat.
export function winCardsToDeck(cards: WinRevealCard[]): Card[] {
	return cards.map((c) => {
		const s = holoStyle(c.type);
		return {
			id: c.id,
			name: c.name ?? "Card",
			image: c.image_url ?? CARD_BACK_IMAGE,
			rarity: s.rarity,
			subtypes: s.subtypes,
			supertype: s.supertype,
			trainerGallery: s.trainerGallery,
			foil: s.foil,
		};
	});
}

// Warm the browser cache for everything the win reveal paints, so nothing
// fetches mid-animation on a slow machine. Images only (the GLB + booster
// textures are warmed by Booster.tsx via drei's loaders). Safe to call more
// than once — the browser dedupes by URL. No-op on the server.
export function preloadWinAssets() {
	if (typeof window === "undefined") return;
	for (const url of [CARD_BACK_IMAGE, ...FOIL_TEXTURES]) {
		const img = new window.Image();
		img.decoding = "async";
		img.src = url;
	}
	// Warm the pack mesh over HTTP. Booster.tsx also preloads it via drei, but
	// that only runs once the heavy 3D chunk has parsed; a plain fetch here
	// populates the shared HTTP cache earlier, so drei's later fetch is a cache
	// hit and the mesh isn't racing the rise animation on a cold load.
	fetch("/booster.glb").catch(() => {});
}
