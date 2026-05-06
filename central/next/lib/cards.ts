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
};

// One card per visual rarity treatment, in the same order simey lists them
// at https://poke-holo.simey.me. Images come from the official Pokémon TCG
// API (https://images.pokemontcg.io) — same URLs simey's showcase uses, no
// local download needed.
const TCG = "https://images.pokemontcg.io";
export const MOCK_DECK: Card[] = [
	{ id: "common",       name: "Squirtle (Common)",                 rarity: "common",                    supertype: "pokémon", subtypes: ["basic"],     image: `${TCG}/sm10/33_hires.png` },
	{ id: "reverse-holo", name: "Togedemaru (Reverse Holo)",         rarity: "rare reverse holo",         supertype: "pokémon", subtypes: ["basic"],     image: `${TCG}/swsh12/127_hires.png` },
	{ id: "rare-holo",    name: "Articuno (Holofoil Rare)",          rarity: "rare holo",                 supertype: "pokémon", subtypes: ["stage1"],    image: `${TCG}/pgo/24_hires.png` },
	{ id: "cosmos",       name: "Morpeko (Cosmos Holo)",             rarity: "rare holo cosmos",          supertype: "pokémon", subtypes: ["stage1"],    image: `${TCG}/swshp/SWSH012_hires.png` },
	{ id: "amazing",      name: "Celebi (Amazing Rare)",             rarity: "amazing rare",              supertype: "pokémon", subtypes: ["basic"],     image: `${TCG}/swsh4/9_hires.png` },
	{ id: "radiant",      name: "Radiant Charizard",                 rarity: "radiant rare",              supertype: "pokémon", subtypes: ["basic"],     image: `${TCG}/pgo/11_hires.png` },
	{ id: "tg-holo",      name: "Charizard (Trainer Gallery Holo)",  rarity: "trainer gallery rare holo", supertype: "pokémon", subtypes: ["stage2"],    image: `${TCG}/swsh11tg/TG03_hires.png` },
	{ id: "v-regular",    name: "Rayquaza V",                        rarity: "rare holo v",               supertype: "pokémon", subtypes: ["basic", "v"], image: `${TCG}/swsh7/110_hires.png` },
	{ id: "v-full-art",   name: "Mew V (Full Art)",                  rarity: "rare ultra",                supertype: "pokémon", subtypes: ["basic", "v"], image: `${TCG}/swsh8/250_hires.png` },
	{ id: "v-alt-art",    name: "Flareon V (Alternate Art)",         rarity: "rare ultra",                supertype: "pokémon", subtypes: ["basic", "v"], image: `${TCG}/swshp/SWSH179_hires.png` },
	{ id: "vmax",         name: "Gyarados VMAX",                     rarity: "rare holo vmax",            supertype: "pokémon", subtypes: ["vmax"],      image: `${TCG}/swsh7/29_hires.png` },
	{ id: "vmax-alt",     name: "Espeon VMAX (Alternate)",           rarity: "rare rainbow alt",          supertype: "pokémon", subtypes: ["vmax"],      image: `${TCG}/swsh8/270_hires.png` },
	{ id: "vstar",        name: "Mewtwo VSTAR",                      rarity: "rare holo vstar",           supertype: "pokémon", subtypes: ["vstar"],     image: `${TCG}/pgo/31_hires.png` },
	{ id: "trainer-fa",   name: "Peonia (Trainer Full Art)",         rarity: "rare ultra",                supertype: "trainer", subtypes: ["supporter"], image: `${TCG}/swsh6/196_hires.png` },
	{ id: "rainbow",      name: "Pikachu VMAX (Rainbow)",            rarity: "rare rainbow",              supertype: "pokémon", subtypes: ["vmax"],      image: `${TCG}/swsh4/188_hires.png` },
	{ id: "secret",       name: "Twin Energy (Secret Rare)",         rarity: "rare secret",               supertype: "energy",  subtypes: ["special"],   image: `${TCG}/swsh2/209_hires.png` },
	{ id: "tg-v",         name: "Mimikyu V (Trainer Gallery)",       rarity: "rare holo v",               supertype: "pokémon", subtypes: ["basic", "v"], image: `${TCG}/swsh9tg/TG16_hires.png`, trainerGallery: true },
	{ id: "tg-vmax",      name: "Mimikyu VMAX (Trainer Gallery)",    rarity: "rare holo vmax",            supertype: "pokémon", subtypes: ["vmax"],      image: `${TCG}/swsh9tg/TG17_hires.png`, trainerGallery: true },
	{ id: "shiny",        name: "Minccino (Shiny Vault)",            rarity: "rare shiny",                supertype: "pokémon", subtypes: ["basic"],     image: `${TCG}/swsh45sv/SV093_hires.png` },
	{ id: "shiny-v",      name: "Lapras V (Shiny Vault)",            rarity: "rare shiny v",              supertype: "pokémon", subtypes: ["basic", "v"], image: `${TCG}/swsh45sv/SV101_hires.png` },
	{ id: "shiny-vmax",   name: "Charizard VMAX (Shiny Vault)",      rarity: "rare shiny vmax",           supertype: "pokémon", subtypes: ["vmax"],      image: `${TCG}/swsh45sv/SV107_hires.png` },
];

export const CARD_BACK_IMAGE = "/cards/back.png";
