export type Rarity = "common" | "rare-holo" | "full-art";
export type Supertype = "pokemon" | "trainer" | "energy";

export type Card = {
	id: string;
	name: string;
	image: string;        // path under /public
	rarity: Rarity;
	supertype?: Supertype;
	subtypes?: string[];  // e.g. ["stage-1"], ["supporter"]
	mask?: string;        // optional clip-mask image for masked holos
};

// Drop card art at central/next/public/cards/card-N.png to see real images.
// Missing files fall back to the procedural holo tile (see HoloCard).
export const MOCK_DECK: Card[] = [
	{ id: "c1", name: "Card 1", image: "/cards/card-1.png", rarity: "common", supertype: "pokemon", subtypes: ["basic"] },
	{ id: "c2", name: "Card 2", image: "/cards/card-2.png", rarity: "common", supertype: "pokemon", subtypes: ["basic"] },
	{ id: "c3", name: "Card 3", image: "/cards/card-3.png", rarity: "common", supertype: "pokemon", subtypes: ["stage-1"] },
	{ id: "c4", name: "Card 4", image: "/cards/card-4.png", rarity: "common", supertype: "trainer", subtypes: ["supporter"] },
	{ id: "c5", name: "Card 5", image: "/cards/card-5.png", rarity: "rare-holo", supertype: "pokemon", subtypes: ["stage-1"] },
	{ id: "c6", name: "Card 6", image: "/cards/card-6.png", rarity: "full-art", supertype: "pokemon", subtypes: ["v"] },
];

export const CARD_BACK_IMAGE = "/cards/back.png";
