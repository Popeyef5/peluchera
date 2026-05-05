"use client";

import React, { useEffect, useRef, useState } from "react";
import { CARD_BACK_IMAGE, type Rarity, type Supertype } from "@/lib/cards";

type Props = {
	image: string;
	faceUp: boolean;
	rarity?: Rarity;
	supertype?: Supertype;
	subtypes?: string[];
	mask?: string;
	className?: string;
};

const MAX_TILT_DEG = 20;        // ±12° rotation when pointer is far from the card
const TILT_FALLOFF_PX = 600;    // distance from card center at which tilt is maxed

/**
 * Layered holographic card. Three nested transform layers:
 *   __translater  →  framer-controlled position (set by parent)
 *   __rotator     →  rotateY/rotateX driven by CSS vars from pointer tracking
 *   __front/__back/__shine/__glare  →  flat faces + foil overlays
 *
 * Tilt behavior is inverted from the usual: when the pointer is *outside* the
 * card's bounding rect, the rotator tilts toward the pointer; when inside,
 * the rotator snaps to neutral (so drag works cleanly). Per-card pointer
 * listener is rAF-throttled.
 */
export default function HoloCard({
	image,
	faceUp,
	rarity = "common",
	supertype,
	subtypes,
	mask,
	className,
}: Props) {
	const cardRef = useRef<HTMLDivElement>(null);
	const rotatorRef = useRef<HTMLDivElement>(null);
	const [frontOk, setFrontOk] = useState(true);
	const [backOk, setBackOk] = useState(true);

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

	// Outside-pointer tilt
	useEffect(() => {
		let raf = 0;
		let pendingX = 0;
		let pendingY = 0;
		const rotator = rotatorRef.current;
		const card = cardRef.current;
		if (!rotator || !card) return;

		const onMove = (e: PointerEvent) => {
			pendingX = e.clientX;
			pendingY = e.clientY;
			if (raf) return;
			raf = requestAnimationFrame(() => {
				raf = 0;
				const rect = card.getBoundingClientRect();
				const cx = rect.left + rect.width / 2;
				const cy = rect.top + rect.height / 2;
				const inside =
					pendingX >= rect.left && pendingX <= rect.right &&
					pendingY >= rect.top  && pendingY <= rect.bottom;

				if (inside) {
					rotator.style.setProperty("--rotate-x", "0deg");
					rotator.style.setProperty("--rotate-y", "0deg");
					rotator.style.setProperty("--pointer-x", "50%");
					rotator.style.setProperty("--pointer-y", "50%");
					rotator.style.setProperty("--card-opacity", "0");
					return;
				}

				const dx = pendingX - cx;
				const dy = pendingY - cy;
				const norm = Math.min(1, Math.hypot(dx, dy) / TILT_FALLOFF_PX);
				const ax = (dx / TILT_FALLOFF_PX) * MAX_TILT_DEG;
				const ay = (dy / TILT_FALLOFF_PX) * MAX_TILT_DEG;
				const clampedX = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, ax));
				const clampedY = Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, ay));

				rotator.style.setProperty("--rotate-x", `${clampedX}deg`);
				rotator.style.setProperty("--rotate-y", `${-clampedY}deg`);
				// Pointer position projected onto the card surface (used by glare gradient)
				const px = ((pendingX - rect.left) / rect.width) * 100;
				const py = ((pendingY - rect.top) / rect.height) * 100;
				rotator.style.setProperty("--pointer-x", `${px}%`);
				rotator.style.setProperty("--pointer-y", `${py}%`);
				rotator.style.setProperty("--card-opacity", `${0.55 + 0.35 * norm}`);
				rotator.style.setProperty("--background-x", `${50 - (dx / rect.width) * 30}%`);
				rotator.style.setProperty("--background-y", `${50 - (dy / rect.height) * 30}%`);
			});
		};

		window.addEventListener("pointermove", onMove);
		return () => {
			window.removeEventListener("pointermove", onMove);
			if (raf) cancelAnimationFrame(raf);
		};
	}, []);

	return (
		<div
			ref={cardRef}
			className={`holo-card ${className ?? ""}`}
			data-rarity={rarity}
			data-supertype={supertype ?? ""}
			data-subtypes={subtypes?.join(" ") ?? ""}
			style={mask ? ({ ["--mask" as string]: `url(${mask})` } as React.CSSProperties) : undefined}
		>
			<div className="holo-card__translater">
				<div
					ref={rotatorRef}
					className="holo-card__rotator"
					style={{ transform: `rotateY(${faceUp ? 0 : 180}deg) rotateY(var(--rotate-x, 0deg)) rotateX(var(--rotate-y, 0deg))` }}
				>
					<div
						className="holo-card__face holo-card__back"
						style={backOk ? { backgroundImage: `url(${CARD_BACK_IMAGE})` } : undefined}
					/>
					<div
						className="holo-card__face holo-card__front"
						style={frontOk ? { backgroundImage: `url(${image})` } : undefined}
					>
						<div className="holo-card__shine" />
						<div className="holo-card__glare" />
					</div>
				</div>
			</div>
		</div>
	);
}
