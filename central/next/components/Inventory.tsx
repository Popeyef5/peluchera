"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Box, Flex, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { toaster } from "@/components/ui/toaster";
import { useClaw, type InventoryWin, type WinCard, type PrizeKind } from "@/components/providers";

const fmtCents = (c: number) => `$${(c / 100).toFixed(2)}`;

// Render "in 6d 4h" / "in 3h 12m" / "in 14m" / "expired" for the auto-resell deadline.
const fmtExpiresIn = (unix: number): string => {
	const secs = Math.floor(unix - Date.now() / 1000);
	if (secs <= 0) return "expired";
	const days = Math.floor(secs / 86400);
	const hours = Math.floor((secs % 86400) / 3600);
	const mins = Math.floor((secs % 3600) / 60);
	if (days > 0) return `in ${days}d ${hours}h`;
	if (hours > 0) return `in ${hours}h ${mins}m`;
	return `in ${mins}m`;
};

const RARITY_LABEL: Record<string, string> = {
	COMMON: "Common",
	UNCOMMON: "Uncommon",
	RARE: "Rare",
	HOLO_RARE: "Holo Rare",
	ULTRA_RARE: "Ultra Rare",
	CHASE: "Chase",
};

const Inventory: React.FC = () => {
	const {
		getInventory,
		openBoosterByWinId,
		resellWinByWinId,
		keepCardByWinId,
		resellCardFromCollection,
	} = useClaw();

	const [pending, setPending] = useState<InventoryWin[] | null>(null);
	const [cards, setCards] = useState<WinCard[] | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		const r = await getInventory();
		if (r.ok && r.data) {
			setPending(r.data.pendingWins);
			setCards(r.data.cards);
		}
	}, [getInventory]);

	useEffect(() => { refresh(); }, [refresh]);

	const handleOpen = async (winId: string) => {
		setBusyId(winId);
		const r = await openBoosterByWinId(winId);
		setBusyId(null);
		if (r.ok) {
			toaster.create({ description: "Pack opened — check your cards", type: "success", duration: 2000 });
			await refresh();
		} else {
			toaster.create({ description: `Couldn't open: ${r.error}`, type: "error", duration: 2500 });
		}
	};

	const handleResellWin = async (winId: string, kind: PrizeKind) => {
		setBusyId(winId);
		const r = await resellWinByWinId(winId, kind);
		setBusyId(null);
		if (r.ok) {
			toaster.create({
				description: `Sold for ${fmtCents(r.data?.credited_cents ?? 0)}`,
				type: "success", duration: 2500,
			});
			await refresh();
		} else {
			toaster.create({ description: `Couldn't resell: ${r.error}`, type: "error", duration: 2500 });
		}
	};

	const handleKeep = async (winId: string) => {
		setBusyId(winId);
		const r = await keepCardByWinId(winId);
		setBusyId(null);
		if (r.ok) {
			toaster.create({ description: "Added to your collection", type: "success", duration: 2000 });
			await refresh();
		} else {
			toaster.create({ description: `Couldn't keep: ${r.error}`, type: "error", duration: 2500 });
		}
	};

	const handleResellCard = async (cardId: string) => {
		setBusyId(cardId);
		const r = await resellCardFromCollection(cardId);
		setBusyId(null);
		if (r.ok) {
			toaster.create({
				description: `Sold for ${fmtCents(r.data?.credited_cents ?? 0)}`,
				type: "success", duration: 2500,
			});
			await refresh();
		} else {
			toaster.create({ description: `Couldn't resell: ${r.error}`, type: "error", duration: 2500 });
		}
	};

	// Ship is intentionally disabled until the address-collection form exists.
	const shipNotImplemented = () => toaster.create({
		description: "Shipping requires an address — coming soon.",
		type: "info", duration: 2500,
	});

	return (
		// Grow with the content — up to (almost) the full viewport, then scroll —
		// so a big collection fills the screen instead of being boxed into a
		// short pane. dvh keeps it honest on mobile browsers.
		<Box className="inv-scroll" w="full" maxH="calc(100dvh - 15rem)" overflowY="auto" pe={2}>
			<VStack gap={3} align="stretch" w="full">
				<SectionHeader label="Pending" count={pending?.length ?? 0} />
				{pending === null ? (
					<VStack gap={2}><Skeleton h="2.5rem" w="100%" /><Skeleton h="2.5rem" w="100%" /></VStack>
				) : pending.length === 0 ? (
					<Flex minH="3rem" align="center" justify="center"><Text color="var(--ink-soft)">Nothing pending</Text></Flex>
				) : (
					pending.map((w) => (
						<PendingRow
							key={w.win_id}
							win={w}
							busy={busyId === w.win_id}
							onOpen={() => handleOpen(w.win_id)}
							onKeep={() => handleKeep(w.win_id)}
							onResell={() => handleResellWin(w.win_id, w.prize_kind)}
							onShip={shipNotImplemented}
						/>
					))
				)}

				<SectionHeader label="Cards" count={cards?.length ?? 0} />
				{cards === null ? (
					<VStack gap={2}><Skeleton h="2rem" w="100%" /><Skeleton h="2rem" w="100%" /></VStack>
				) : cards.length === 0 ? (
					<Flex minH="3rem" align="center" justify="center"><Text color="var(--ink-soft)">No cards yet</Text></Flex>
				) : (
					cards.map((c) => (
						<CardRow
							key={c.id}
							card={c}
							busy={busyId === c.id}
							onResell={() => handleResellCard(c.id)}
							onShip={shipNotImplemented}
						/>
					))
				)}
			</VStack>
		</Box>
	);
};

// A small pack/card thumbnail. Shows the card art when we have it, otherwise a
// glyph badge (📦 booster / 🃏 card) so the row still reads at a glance.
const Thumb: React.FC<{ image?: string | null; glyph: string }> = ({ image, glyph }) => (
	<div className="inv-thumb" style={image ? { backgroundImage: `url(${image})` } : undefined}>
		{image ? null : glyph}
	</div>
);

const SectionHeader: React.FC<{ label: string; count: number }> = ({ label, count }) => (
	<HStack justify="space-between" w="full" pe={4}>
		<Text
			fontFamily="var(--lg-mono)"
			fontSize="xs"
			letterSpacing="0.18em"
			textTransform="uppercase"
			color="var(--ink-soft)"
		>{label}</Text>
		<Text fontFamily="var(--lg-mono)" fontSize="xs" color="var(--ink-soft)">{count}</Text>
	</HStack>
);

const PendingRow: React.FC<{
	win: InventoryWin;
	busy: boolean;
	onOpen: () => void;
	onKeep: () => void;
	onResell: () => void;
	onShip: () => void;
}> = ({ win, busy, onOpen, onKeep, onResell, onShip }) => {
	const isBooster = win.prize_kind === 'OPENED_BOOSTER';
	const title = isBooster
		? (win.opened_booster?.sku ?? win.closed_booster?.sku ?? 'Booster')
		: (win.card_preview ? `${RARITY_LABEL[win.card_preview.rarity] ?? win.card_preview.rarity} card` : 'Card');

	return (
		<div className="inv-row">
			<Thumb image={isBooster ? undefined : win.card_preview?.image_url} glyph={isBooster ? "📦" : "🃏"} />
			<div className="inv-meta">
				<span className="inv-title">{title}</span>
				<span className="inv-sub">
					{fmtExpiresIn(win.expires_at)}
					<span className="inv-sub__dot">·</span>
					<span className="inv-price">{fmtCents(win.resell_price_cents)}</span>
				</span>
			</div>
			<div className="inv-actions">
				<MiniBtn label={isBooster ? "Open" : "Keep"} onClick={isBooster ? onOpen : onKeep} disabled={busy} variant="primary" />
				<MiniBtn label="Resell" onClick={onResell} disabled={busy} />
				<MiniBtn label="Ship" onClick={onShip} disabled={busy} variant="muted" />
			</div>
		</div>
	);
};

const CardRow: React.FC<{
	card: WinCard;
	busy: boolean;
	onResell: () => void;
	onShip: () => void;
}> = ({ card, busy, onResell, onShip }) => (
	<div className="inv-row">
		<Thumb image={card.image_url} glyph="🃏" />
		<div className="inv-meta">
			<span className="inv-title">{RARITY_LABEL[card.rarity] ?? card.rarity}</span>
			<span className="inv-sub">{card.set} · #{card.number}</span>
		</div>
		<div className="inv-actions">
			<MiniBtn label="Resell" onClick={onResell} disabled={busy} />
			<MiniBtn label="Ship" onClick={onShip} disabled={busy} variant="muted" />
		</div>
	</div>
);

const MiniBtn: React.FC<{
	label: string;
	onClick: () => void;
	disabled?: boolean;
	variant?: "primary" | "muted";
}> = ({ label, onClick, disabled, variant }) => (
	<button
		type="button"
		onClick={onClick}
		disabled={disabled}
		className={`inv-btn${variant ? ` inv-btn--${variant}` : ""}`}
	>
		{label}
	</button>
);

export default Inventory;
