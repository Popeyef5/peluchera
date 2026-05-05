"use client";

import React, { useState } from "react";
import { motion, useMotionValue, useTransform, animate, AnimatePresence } from "framer-motion";
import HoloCard from "@/components/HoloCard";
import { MOCK_DECK } from "@/lib/cards";

type Props = {
	flipFirst: boolean; // when true, the cards in the open pack are face-up
};

const SWIPE_COMMIT_PX = 140; // any direction past this commits

/**
 * Stack of holo cards. Top card is freely draggable; on commit it flies off
 * (handled by AnimatePresence exit) and the deck recycles to the back.
 */
export default function CardStack({ flipFirst }: Props) {
	const [deck, setDeck] = useState(MOCK_DECK);
	const x = useMotionValue(0);
	const y = useMotionValue(0);

	React.useEffect(() => {
		console.log('[CardStack] flipFirst prop ->', flipFirst);
	}, [flipFirst]);

	// As the top card moves, the next card peeks (rises and grows slightly)
	const peekProgress = useTransform([x, y], (v: number[]) => {
		const [vx, vy] = v;
		return Math.min(1, Math.hypot(vx, vy) / SWIPE_COMMIT_PX);
	});
	const peekScale = useTransform(peekProgress, (p) => 0.94 + p * 0.06);
	const peekY     = useTransform(peekProgress, (p) => 14 - p * 14);

	const advance = () => {
		setDeck((d) => {
			const [head, ...rest] = d;
			return [...rest, head];
		});
		x.set(0);
		y.set(0);
	};

	const top = deck[0];
	const next = deck[1] ?? deck[0];
	const after = deck[2] ?? deck[0];

	return (
		<div className="card-stack">
			<div className="card-stack__deck">
				{/* Slot 3 — bottom of the visible stack */}
				<div className="card-stack__slot card-stack__slot--3">
					<HoloCard image={after.image} faceUp={flipFirst} />
				</div>
				{/* Slot 2 — peeks during drag */}
				<motion.div
					className="card-stack__slot card-stack__slot--2"
					style={{ scale: peekScale, y: peekY }}
				>
					<HoloCard image={next.image} faceUp={flipFirst} />
				</motion.div>
				{/* Slot 1 — draggable */}
				<AnimatePresence initial={false} mode="popLayout">
					<motion.div
						key={top.id}
						className="card-stack__slot card-stack__slot--1"
						drag
						dragMomentum={false}
						style={{ x, y }}
						onDragEnd={(_, info) => {
							const dist = Math.hypot(info.offset.x, info.offset.y);
							if (dist > SWIPE_COMMIT_PX) {
								advance();
							} else {
								animate(x, 0, { type: "spring", stiffness: 320, damping: 28 });
								animate(y, 0, { type: "spring", stiffness: 320, damping: 28 });
							}
						}}
						initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
						animate={{ scale: 1, opacity: 1 }}
						exit={{
							x: x.get() * 4,
							y: (y.get() || -120) * 1.6,
							scale: 0.7,
							opacity: 0,
							transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] },
						}}
					>
						<HoloCard image={top.image} faceUp={flipFirst} />
					</motion.div>
				</AnimatePresence>
			</div>
		</div>
	);
}
