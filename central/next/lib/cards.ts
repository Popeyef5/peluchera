// Rarity strings match simeydotme/pokemon-cards-css conventions.
export type Rarity =
	| "common"
	| "rare holo"
	| "rare ultra"
	| "rare holo v"
	| "rare holo vmax";

export type Supertype = "pokémon" | "trainer" | "energy";

export type Card = {
	id: string;
	name: string;
	image: string;
	rarity: Rarity;
	supertype?: Supertype;
	subtypes?: string[];
	mask?: string;
};

// Drop card art at central/next/public/cards/card-N.png to see real images.
export const MOCK_DECK: Card[] = [
	{ id: "c1", name: "Card 1", image: "/cards/card-1.png", rarity: "common",     supertype: "pokémon", subtypes: ["basic"] },
	{ id: "c2", name: "Card 2", image: "/cards/card-2.png", rarity: "common",     supertype: "pokémon", subtypes: ["basic"] },
	{ id: "c3", name: "Card 3", image: "/cards/card-3.png", rarity: "common",     supertype: "pokémon", subtypes: ["stage1"] },
	{ id: "c4", name: "Card 4", image: "/cards/card-4.png", rarity: "common",     supertype: "trainer", subtypes: ["supporter"] },
	{ id: "c5", name: "Card 5", image: "/cards/card-5.png", rarity: "rare holo",  supertype: "pokémon", subtypes: ["stage1"] },
	{ id: "c6", name: "Card 6", image: "/cards/card-6.png", rarity: "rare ultra", supertype: "pokémon", subtypes: ["v"] },
];

export const CARD_BACK_IMAGE = "/cards/back.png";
