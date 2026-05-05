"use client";

import React, { useEffect, useState } from "react";
import { CARD_BACK_IMAGE } from "@/lib/cards";

type Props = {
	image: string;       // front art
	faceUp: boolean;     // true => front visible
	className?: string;
};

/**
 * Two-sided card with a subtle holo foil overlay.
 * The `.spec` class taps the global pointer tracker in page.tsx so the foil
 * angle drifts with the mouse without painting a hard cursor wedge.
 */
export default function HoloCard({ image, faceUp, className }: Props) {
	const [frontOk, setFrontOk] = useState(true);
	const [backOk, setBackOk] = useState(true);

	useEffect(() => {
		console.log('[HoloCard] faceUp prop ->', faceUp);
	}, [faceUp]);

	useEffect(() => {
		const img = new Image();
		img.onload = () => setFrontOk(true);
		img.onerror = () => setFrontOk(false);
		img.src = image;
	}, [image]);

	useEffect(() => {
		const img = new Image();
		img.onload = () => setBackOk(true);
		img.onerror = () => setBackOk(false);
		img.src = CARD_BACK_IMAGE;
	}, []);

	return (
		<div className={`holo-card ${className ?? ""}`}>
			<div
				className="holo-card__inner"
				style={{ transform: `rotateY(${faceUp ? 0 : 180}deg)` }}
			>
				{/* Front face (no extra rotation; visible when faceUp) */}
				<div
					className="holo-card__face holo-card__face--front spec"
					style={frontOk ? { backgroundImage: `url(${image})` } : undefined}
				>
					<div className="holo-card__foil" />
				</div>
				{/* Back face (rotated 180; visible when !faceUp) */}
				<div
					className="holo-card__face holo-card__face--back spec"
					style={backOk ? { backgroundImage: `url(${CARD_BACK_IMAGE})` } : undefined}
				/>
			</div>
		</div>
	);
}
