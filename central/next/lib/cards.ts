export type Card = {
	id: string;
	name: string;
	image: string; // path under /public
};

// Drop card art at central/next/public/cards/card-N.png to see real images.
// Missing files fall back to a procedural holo tile (see HoloCard).
export const MOCK_DECK: Card[] = [
	{ id: "c1", name: "Card 1", image: "/cards/card-1.png" },
	{ id: "c2", name: "Card 2", image: "/cards/card-2.png" },
	{ id: "c3", name: "Card 3", image: "/cards/card-3.png" },
	{ id: "c4", name: "Card 4", image: "/cards/card-4.png" },
	{ id: "c5", name: "Card 5", image: "/cards/card-5.png" },
	{ id: "c6", name: "Card 6", image: "/cards/card-6.png" },
];

export const CARD_BACK_IMAGE = "/cards/back.png";
