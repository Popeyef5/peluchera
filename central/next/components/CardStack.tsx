"use client";

import React, { useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import HoloCard from "@/components/HoloCard";
import { MOCK_DECK } from "@/lib/cards";

type Props = {
	flipFirst: boolean; // when true, the cards in the open pack are face-up
};

const SWIPE_COMMIT_PX = 140; // any direction past this commits
const LIFT_MS   = 1000; // up off the stack (zIndex 4, in front)
const RECEDE_MS = 1000; // recedes in z + descends (zIndex 0, behind)

type DepartPhase = "lift" | "recede";
type Departing = {
	id: string;       // unique key per departure (so successive swipes each animate)
	image: string;
	faceUp: boolean;
	startX: number;
	startY: number;
	phase: DepartPhase;
};

/**
 * Stack of holo cards. Top card is freely draggable; on commit it spawns a
 * separate "departing" overlay that arcs up, recedes in z, and lands behind
 * the stack. The deck rotates immediately so the next card snaps into the
 * top slot, while the overlay plays out its animation independently.
 */
export default function CardStack({ flipFirst }: Props) {
	const [deck, setDeck] = useState(MOCK_DECK);
	const [departing, setDeparting] = useState<Departing | null>(null);
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

	const commit = (offsetX: number, offsetY: number) => {
		const head = deck[0];
		const id = `${head.id}-${Date.now()}`;
		setDeparting({
			id,
			image: head.image,
			faceUp: flipFirst,
			startX: offsetX,
			startY: offsetY,
			phase: "lift",
		});
		setDeck((d) => {
			const [h, ...rest] = d;
			return [...rest, h];
		});
		x.set(0);
		y.set(0);
		// Promote to phase 2 once the lift completes — discrete zIndex switch.
		setTimeout(() => {
			setDeparting((d) => (d && d.id === id ? { ...d, phase: "recede" } : d));
		}, LIFT_MS);
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
				{/* Slot 1 — the draggable card. Re-keyed per top.id so it remounts
				    cleanly whenever the deck rotates. No exit animation here —
				    the departing overlay below handles the post-swipe arc. */}
				<motion.div
					key={top.id}
					className="card-stack__slot card-stack__slot--1"
					drag
					dragMomentum={false}
					style={{ x, y }}
					onDragEnd={(_, info) => {
						const dist = Math.hypot(info.offset.x, info.offset.y);
						if (dist > SWIPE_COMMIT_PX) {
							commit(info.offset.x, info.offset.y);
						} else {
							animate(x, 0, { type: "spring", stiffness: 320, damping: 28 });
							animate(y, 0, { type: "spring", stiffness: 320, damping: 28 });
						}
					}}
				>
					<HoloCard image={top.image} faceUp={flipFirst} />
				</motion.div>

				{/* Departing overlay. Two-phase animation:
				      lift   — rises off the stack, in front (zIndex 4)
				      recede — settles to slot-3 position, behind the stack (zIndex 0)
				    zIndex flips discretely between phases. */}
				{departing && (
					<motion.div
						key={departing.id}
						className="card-stack__slot card-stack__departing"
						initial={{
							x: departing.startX,
							y: departing.startY,
							z: 0,
							rotateX: 0,
							opacity: 1,
						}}
						animate={
							departing.phase === "lift"
								? { x: 0, y: -420, z: 0, rotateX: -8, opacity: 1 }
								: { x: 0, y: 0, z: -50, rotateX: 0, opacity: 1 }
						}
						transition={{
							duration: (departing.phase === "lift" ? LIFT_MS : RECEDE_MS) / 1000,
							ease: [0.4, 0, 0.2, 1],
						}}
						style={{ zIndex: departing.phase === "lift" ? 4 : 0 }}
						onAnimationComplete={() => {
							if (departing.phase === "recede") setDeparting(null);
						}}
					>
						<HoloCard image={departing.image} faceUp={departing.faceUp} />
					</motion.div>
				)}
			</div>
		</div>
	);
}
