"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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

// Collapse identical items into groups (preserving first-seen order) so the list
// shows one row per distinct prize with a ×N badge instead of N near-identical
// rows. Boosters group by SKU; cards (pending or owned) by set·number·rarity.
function groupItems<T>(arr: T[], key: (t: T) => string): T[][] {
	const map = new Map<string, T[]>();
	for (const it of arr) {
		const k = key(it);
		const g = map.get(k);
		if (g) g.push(it); else map.set(k, [it]);
	}
	return [...map.values()];
}
const pendingKey = (w: InventoryWin) =>
	w.prize_kind === "OPENED_BOOSTER"
		? `b:${w.opened_booster?.sku ?? w.closed_booster?.sku ?? "?"}`
		: `c:${w.card_preview?.set ?? ""}-${w.card_preview?.number ?? ""}-${w.card_preview?.rarity ?? ""}`;
const cardKey = (c: WinCard) => `${c.set}-${c.number}-${c.rarity}`;

const pendingTitle = (w: InventoryWin) =>
	w.prize_kind === "OPENED_BOOSTER"
		? (w.opened_booster?.sku ?? w.closed_booster?.sku ?? "Booster")
		: (w.card_preview ? `${RARITY_LABEL[w.card_preview.rarity] ?? w.card_preview.rarity} card` : "Card");

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

	const pendingGroups = useMemo(() => (pending ? groupItems(pending, pendingKey) : []), [pending]);
	const cardGroups = useMemo(() => (cards ? groupItems(cards, cardKey) : []), [cards]);

	return (
		// Fill the space the account modal gives us (it flex-caps at the host
		// column's height) and scroll within — so a big collection fills the
		// panel instead of being boxed into a short pane, and the modal keeps its
		// symmetric top/bottom margins.
		<Box className="inv-scroll" w="full" minH="0" overflowY="auto" pe={2}>
			<VStack gap={3} align="stretch" w="full">
				<SectionHeader label="Pending" count={pending?.length ?? 0} />
				{pending === null ? (
					<VStack gap={2}><Skeleton h="2.5rem" w="100%" /><Skeleton h="2.5rem" w="100%" /></VStack>
				) : pending.length === 0 ? (
					<Flex minH="3rem" align="center" justify="center"><Text color="var(--ink-soft)">Nothing pending</Text></Flex>
				) : (
					pendingGroups.map((g) => (
						g.length === 1 ? (
							<PendingRow
								key={g[0].win_id}
								win={g[0]}
								busy={busyId === g[0].win_id}
								onOpen={() => handleOpen(g[0].win_id)}
								onKeep={() => handleKeep(g[0].win_id)}
								onResell={() => handleResellWin(g[0].win_id, g[0].prize_kind)}
								onShip={shipNotImplemented}
							/>
						) : (
							<PendingGroup
								key={pendingKey(g[0])}
								items={g}
								busyId={busyId}
								onOpen={handleOpen}
								onKeep={handleKeep}
								onResell={handleResellWin}
								onShip={shipNotImplemented}
							/>
						)
					))
				)}

				<SectionHeader label="Cards" count={cards?.length ?? 0} />
				{cards === null ? (
					<VStack gap={2}><Skeleton h="2rem" w="100%" /><Skeleton h="2rem" w="100%" /></VStack>
				) : cards.length === 0 ? (
					<Flex minH="3rem" align="center" justify="center"><Text color="var(--ink-soft)">No cards yet</Text></Flex>
				) : (
					cardGroups.map((g) => (
						g.length === 1 ? (
							<CardRow
								key={g[0].id}
								card={g[0]}
								busy={busyId === g[0].id}
								onResell={() => handleResellCard(g[0].id)}
								onShip={shipNotImplemented}
							/>
						) : (
							<CardGroup
								key={cardKey(g[0])}
								items={g}
								busyId={busyId}
								onResell={handleResellCard}
								onShip={shipNotImplemented}
							/>
						)
					))
				)}
			</VStack>
		</Box>
	);
};

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

// A small pack/card thumbnail. Shows the card art when we have it, otherwise a
// glyph badge (📦 booster / 🃏 card) so the row still reads at a glance.
const Thumb: React.FC<{ image?: string | null; glyph: string }> = ({ image, glyph }) => (
	<div className="inv-thumb" style={image ? { backgroundImage: `url(${image})` } : undefined}>
		{image ? null : glyph}
	</div>
);

const Chevron: React.FC<{ open: boolean }> = ({ open }) => (
	<span className={`inv-chevron${open ? " inv-chevron--open" : ""}`} aria-hidden>▾</span>
);

// ─── Pending ────────────────────────────────────────────────────────────

const PendingRow: React.FC<{
	win: InventoryWin;
	busy: boolean;
	onOpen: () => void;
	onKeep: () => void;
	onResell: () => void;
	onShip: () => void;
}> = ({ win, busy, onOpen, onKeep, onResell, onShip }) => {
	const isBooster = win.prize_kind === "OPENED_BOOSTER";
	return (
		<div className="inv-row">
			<Thumb image={isBooster ? undefined : win.card_preview?.image_url} glyph={isBooster ? "📦" : "🃏"} />
			<div className="inv-meta">
				<span className="inv-title">{pendingTitle(win)}</span>
				<span className="inv-sub">
					{fmtExpiresIn(win.expires_at)}
					<span className="inv-sub__dot">·</span>
					<span className="inv-price">{fmtCents(win.resell_price_cents)}</span>
				</span>
			</div>
			<div className="inv-actions">
				<MiniBtn label={isBooster ? "Open" : "Keep"} onClick={isBooster ? onOpen : onKeep} disabled={busy} variant="primary" />
				<MiniBtn label="Resell" onClick={onResell} disabled={busy} variant={undefined} />
				<MiniBtn label="Ship" onClick={onShip} disabled={busy} variant="muted" />
			</div>
		</div>
	);
};

const PendingGroup: React.FC<{
	items: InventoryWin[];
	busyId: string | null;
	onOpen: (id: string) => void;
	onKeep: (id: string) => void;
	onResell: (id: string, kind: PrizeKind) => void;
	onShip: () => void;
}> = ({ items, busyId, onOpen, onKeep, onResell, onShip }) => {
	const [open, setOpen] = useState(false);
	const rep = items[0];
	const isBooster = rep.prize_kind === "OPENED_BOOSTER";
	const soonest = Math.min(...items.map((w) => w.expires_at));

	return (
		<div className="inv-group">
			<button type="button" className="inv-row inv-row--group" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
				<Thumb image={isBooster ? undefined : rep.card_preview?.image_url} glyph={isBooster ? "📦" : "🃏"} />
				<div className="inv-meta">
					<span className="inv-title">{pendingTitle(rep)}<span className="inv-badge">×{items.length}</span></span>
					<span className="inv-sub">
						soonest {fmtExpiresIn(soonest)}
						<span className="inv-sub__dot">·</span>
						<span className="inv-price">{fmtCents(rep.resell_price_cents)}</span>
					</span>
				</div>
				<Chevron open={open} />
			</button>
			<div className="inv-instances-wrap" data-open={open}>
				<div className="inv-instances">
					<div className="inv-instances-inner">
						{items.map((w) => (
							<div className="inv-subrow" key={w.win_id}>
								<span className="inv-subrow__meta inv-sub">
									{fmtExpiresIn(w.expires_at)}
									<span className="inv-sub__dot">·</span>
									<span className="inv-price">{fmtCents(w.resell_price_cents)}</span>
								</span>
								<div className="inv-actions">
									<MiniBtn
										label={isBooster ? "Open" : "Keep"}
										onClick={() => (isBooster ? onOpen(w.win_id) : onKeep(w.win_id))}
										disabled={busyId === w.win_id}
										variant="primary"
									/>
									<MiniBtn label="Resell" onClick={() => onResell(w.win_id, w.prize_kind)} disabled={busyId === w.win_id} variant={undefined} />
									<MiniBtn label="Ship" onClick={onShip} disabled={busyId === w.win_id} variant="muted" />
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
};

// ─── Cards ──────────────────────────────────────────────────────────────

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
			<MiniBtn label="Resell" onClick={onResell} disabled={busy} variant={undefined} />
			<MiniBtn label="Ship" onClick={onShip} disabled={busy} variant="muted" />
		</div>
	</div>
);

const CardGroup: React.FC<{
	items: WinCard[];
	busyId: string | null;
	onResell: (id: string) => void;
	onShip: () => void;
}> = ({ items, busyId, onResell, onShip }) => {
	const [open, setOpen] = useState(false);
	const rep = items[0];

	return (
		<div className="inv-group">
			<button type="button" className="inv-row inv-row--group" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
				<Thumb image={rep.image_url} glyph="🃏" />
				<div className="inv-meta">
					<span className="inv-title">{RARITY_LABEL[rep.rarity] ?? rep.rarity}<span className="inv-badge">×{items.length}</span></span>
					<span className="inv-sub">{rep.set} · #{rep.number}</span>
				</div>
				<Chevron open={open} />
			</button>
			<div className="inv-instances-wrap" data-open={open}>
				<div className="inv-instances">
					<div className="inv-instances-inner">
						{items.map((c, i) => (
							<div className="inv-subrow" key={c.id}>
								<span className="inv-subrow__meta inv-sub">
									Copy {i + 1}{c.condition ? ` · ${c.condition}` : ""}
								</span>
								<div className="inv-actions">
									<MiniBtn label="Resell" onClick={() => onResell(c.id)} disabled={busyId === c.id} variant={undefined} />
									<MiniBtn label="Ship" onClick={onShip} disabled={busyId === c.id} variant="muted" />
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
};

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
