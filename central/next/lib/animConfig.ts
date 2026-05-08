/**
 * Central knobs for the win-flow animation. All numeric and timing values that
 * an artist/designer might want to tune are exported from here so the
 * components stay focused on logic.
 *
 * If you change a knob and don't see the effect, check whether there's a CSS
 * counterpart in `app/globals.css` that also needs to change (some values are
 * mirrored — e.g., the mobile flip transition is set in CSS at 1000ms but its
 * conceptual value is `FLIP.mobileMs` here. We don't drive CSS from this
 * module yet — the duplication is intentional, this file is the source of
 * truth for the JS side and globals.css is the source of truth for CSS).
 */

// ──────────────────────────── tilt / orientation ───────────────────────────
export const TILT = {
	/** Peak tilt the card visual will respond to in either axis (degrees).
	 *  Both desktop pointer and mobile orientation handlers clamp to ±this. */
	maxDeg: 25,

	/** Desktop only. Distance (in pixels) from the card center at which the
	 *  pointer-tracking tilt reaches `maxDeg`. Lower = more sensitive cursor. */
	falloffPx: 600,

	/** Mobile only. Multiplier applied to (rawDegrees − rest) before clamping
	 *  to `maxDeg`. Higher = phone tilts produce bigger card response. */
	sensitivity: 1,

	/** Mobile only. Tilt magnitude (degrees) below this is treated as zero so
	 *  the foil doesn't shimmer when the phone is held still. */
	deadZoneDeg: 1.5,
};

// ─────────────────────────── foil / glare intensity ─────────────────────────
export const FOIL = {
	/** Resting opacity of shine + glare layers when the user is barely
	 *  tilting. Drives `--card-opacity`. Higher = always visible foil. */
	opacityFloor: 0,

	/** Extra opacity added at maximum tilt. Final opacity = floor + range. */
	opacityRange: 0.7,
};

// ─────────────────────────── stack-Z (cards approach) ───────────────────────
export const STACK_APPROACH = {
	/** Desktop initial Z (in CSS px) for the card stack while the booster pack
	 *  is still on screen. Cards animate from this to 0 once the pack falls. */
	initialZ: -400,

	/** Mobile equivalent — bigger cards on mobile feel like they need to come
	 *  from further away to read as a proper "approach". */
	initialZMobile: -1200,

	/** CSS transition duration (ms) for the Z animation. Note: this value is
	 *  also reflected in `app/globals.css` on the Layer B Box transition. */
	durationMs: 900,
};

// ─────────────────── booster pack (3D, the modal's centerpiece) ─────────────
export const PACK = {
	/** Delay (ms) after the modal opens before the pack starts rising into
	 *  view. Gives Chakra Dialog's own enter animation time to finish so the
	 *  pack rise isn't happening while the modal is invisible. */
	entryDelayMs: 380,

	/** Duration (ms) of the rise-in from below the viewport. */
	entryDurationMs: 1500,

	/** Duration (ms) of the fall-out (translateY 0 → 100vh) on Open Now. */
	tearingMs: 2100,

	/** Brief beat (ms) between pack-gone and start-of-shuffling. */
	revealingMs: 200,
};

// ──────────────────── card flip (face-down → face-up) ───────────────────────
export const FLIP = {
	/** Duration (ms) of the flip rotation on desktop. Mirrored in
	 *  `app/globals.css` on `.holo-card__rotator` (transform transition). */
	desktopMs: 700,

	/** Duration (ms) of the flip on mobile (cards are bigger, slower flip
	 *  reads better). Mirrored in CSS. */
	mobileMs: 1000,
};

// ─────────────────────── auto-shuffle (pre-flip showcase) ───────────────────
export const SHUFFLE = {
	/** How many face-down lift-and-back animations play before the cards
	 *  flip face-up. */
	count: 3,

	/** Lift phase duration (ms) of a single shuffle. Card rises to apex. */
	liftMs: 600,

	/** Recede phase duration (ms). Card descends behind the stack with
	 *  scale < 1, fading into the back of the deck. */
	recedeMs: 600,
};

// ───────────── swipe (user drag commit and the resulting flight arc) ────────
export const SWIPE = {
	/** Drag distance (in px from drag origin, any direction) above which a
	 *  release commits to a swipe. Below this the card springs back. */
	commitPx: 140,

	/** Y-coordinate of the lift apex on desktop (in CSS px, negative = up).
	 *  How far above its rest position the swiped card travels before
	 *  receding behind the deck. */
	liftApex: -420,

	/** Mobile lift apex — bigger cards need ~10% more headroom. */
	liftApexMobile: -462,

	/** Final scale of the recede phase (1 = same size, < 1 = appears further
	 *  back). Drives the visual "settling at the back of the deck" effect. */
	recedeScale: 0.86,
};

// ─────────────────────────── deck visual proportions ────────────────────────
export const DECK = {
	/** CSS width of the card deck as a percent of the modal's inner Box.
	 *  Default is 60% (desktop). Mobile override is in `globals.css` via
	 *  `@media (max-width: 768px) { --deck-width: 90% }`. */
	desktopWidthPercent: 60,
	mobileWidthPercent: 90,
};
