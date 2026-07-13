'use client';

import React, {
	createContext, useCallback, useContext, useEffect, useState, useRef, useMemo
} from 'react';
import { useSocket } from '@/components/providers/SocketProvider';
import {
	useAppKitAccount, useAppKitNetwork,
} from '@reown/appkit/react';

// Demo / public-session toggle — see central/fastapi/app/config.py for the
// matching server flag. When on, the play flow skips wallet connect, permit
// signing, and on-chain settlement; identity is a per-session synthetic
// "guest" address stored in sessionStorage so the backend can still room
// targeted events properly.
export const BYPASS_PAYMENT = process.env.NEXT_PUBLIC_BYPASS_PAYMENT === 'true';

const GUEST_ADDRESS_KEY = 'garra:guest-address';

function getOrCreateGuestAddress(): `0x${string}` {
	if (typeof window === 'undefined') return '0x0000000000000000000000000000000000000000';
	const existing = window.sessionStorage.getItem(GUEST_ADDRESS_KEY);
	if (existing) return existing as `0x${string}`;
	const bytes = new Uint8Array(20);
	window.crypto.getRandomValues(bytes);
	const addr = ('0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')) as `0x${string}`;
	window.sessionStorage.setItem(GUEST_ADDRESS_KEY, addr);
	return addr;
}
import { toaster } from "@/components/ui/toaster"
import { erc20Abi } from 'viem';
import { USDCAddress, treasuryAddress, ticketUsdcBaseUnits } from '@/lib/crypto/contracts';
import { writeContract, waitForTransactionReceipt } from 'wagmi/actions';
import { config } from '@/config';
import celebrate from '@/components/confetti';

/* bit‑mask helpers */
export const KEYMAP: Record<string, number> = {
	ArrowLeft: 0b0001,
	ArrowRight: 0b0010,
	ArrowUp: 0b0100,
	ArrowDown: 0b1000,
	' ': 0b0001_0000,  // Grab
};
export const ACTION_TO_KEY = {
	left: 'ArrowLeft',
	right: 'ArrowRight',
	up: 'ArrowUp',
	down: 'ArrowDown',
	grab: ' ',
} as const;

interface PlayedRound {
	bet: number,
	win: boolean,
	multiplier: number,
	played_at: number,
}

interface Withdrawal {
	amount: number,
	timestamp: number,
}

interface GlobalSyncData {
	state: [number, number]; // [Played, Won]
	round_info: [number, number]; // [MaxFee, FeeGrowth]
	queue_length: number;
	con: boolean;
	seconds_left: number;
}

interface PersonalSyncData {
	position: number;
}

interface WalletConnectedData {
	position: number;
	balance: number;
	played: number;
	won: number;
	bets: PlayedRound[],
	withdrawals: Withdrawal[]
}

interface clawConnectionData {
	con: boolean;
}

interface AccountBalanceData {
	balance: number,
	bets: PlayedRound[],
	withdrawals: Withdrawal[]
}

interface RoundStartData {
	round_info: [number, number]; // [MaxFee, FeeGrowth]
}

export type PrizeKind = 'BOOSTER_PAIR' | 'SINGLE_CARD';

export interface PendingWin {
	win_id: string;
	prize_kind: PrizeKind;
	expires_at: number;          // unix seconds
	resell_price_cents: number;
}

export interface WinCard {
	id: string;
	set: string;
	number: string;
	rarity: string;
	image_url: string;
	condition: string | null;
	status: string;
	acquired_at: number | null;
}

export interface SettleResult<T = Record<string, unknown>> {
	ok: boolean;
	error?: string;
	code?: string;
	data?: T;
}

// Richer pending-win shape returned by get_inventory. Extends PendingWin
// with prize details so the inventory tile can render context (sku,
// card preview) without an extra round-trip.
export interface InventoryWin extends PendingWin {
	created_at: number;
	ball_serial: string | null;
	closed_booster?: { id: string; sku: string };
	opened_booster?: { id: string; sku: string; video_url: string; video_hash: string };
	card_preview?: WinCard;
}

export interface SavedCard {
	id: string;
	brand: string | null;
	last4: string | null;
}

export interface CardSetupResult {
	status: string;
	client_secret?: string;
	saved_card?: SavedCard | null;
	error?: string;
}

interface ClawCtx {
	queueCount: number;
	position: number;
	isPlaying: boolean;
	loading: boolean;
	withdrawing: boolean;
	betAmount: number;
	gameState: [number, number];
	roundInfo: [number, number];
	accountBalance: number;
	accountBets: PlayedRound[] | null;
	accountWithdrawals: Withdrawal[] | null;
	clawSocketOn: boolean;
	roundPlayed: number;
	roundWon: number;
	secondsLeft: number;
	pendingWin: PendingWin | null;
	setBetAmount: (v: number) => void;
	press: (a: keyof typeof ACTION_TO_KEY) => void;
	release: (a: keyof typeof ACTION_TO_KEY) => void;
	approveAndBet: () => void;
	// Payment method picker (crypto vs card) + card rail.
	paymentPickerOpen: boolean;
	openPaymentPicker: () => void;
	closePaymentPicker: () => void;
	cardSetup: () => Promise<CardSetupResult>;
	payCard: () => void;
	withdraw: () => void;
	openBoosterWin: () => Promise<SettleResult<{ cards: WinCard[] }>>;
	resellPendingWin: () => Promise<SettleResult<{ credited_cents: number }>>;
	keepCardWin: () => Promise<SettleResult<{ card: WinCard }>>;
	dismissPendingWin: () => void;
	// Inventory — works on any Win/Card the user owns, not just pendingWin.
	getInventory: () => Promise<SettleResult<{ pendingWins: InventoryWin[]; cards: WinCard[] }>>;
	openBoosterByWinId: (winId: string) => Promise<SettleResult<{ cards: WinCard[] }>>;
	resellWinByWinId: (winId: string, prizeKind: PrizeKind) => Promise<SettleResult<{ credited_cents: number }>>;
	keepCardByWinId: (winId: string) => Promise<SettleResult<{ card: WinCard }>>;
	resellCardFromCollection: (cardId: string) => Promise<SettleResult<{ credited_cents: number }>>;
}

function useCountdown(initialSeconds: number): [number, (s: number) => void] {
	const [secondsLeft, setSecondsLeft] = useState(initialSeconds);
	const secondsRef = useRef(initialSeconds); // holds latest value without triggering re-renders

	useEffect(() => {
		const interval = setInterval(() => {
			if (secondsRef.current > 0) {
				secondsRef.current -= 1;
				setSecondsLeft(secondsRef.current);
			}
		}, 1000);

		return () => clearInterval(interval);
	}, []);

	const updateSeconds = (newSeconds: number) => {
		secondsRef.current = newSeconds;
		setSecondsLeft(newSeconds); // update state so UI re-renders
	};

	return [secondsLeft, updateSeconds];
}

const ClawContext = createContext<ClawCtx | null>(null);
export const useClaw = () => {
	const ctx = useContext(ClawContext);
	if (!ctx) throw new Error('useClaw must be inside <ClawProvider>');
	return ctx;
};

export const ClawProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const socket = useSocket();

	/* gameplay state */
	const [queueCount, setQueueCount] = useState(0);
	const [position, setPosition] = useState(-1);
	const positionRef = useRef(position);
	useEffect(() => { positionRef.current = position }, [position]);
	const [isPlaying, setIsPlaying] = useState(false);
	const isPlayingRef = useRef(isPlaying);
	useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying]);
	const [loading, setLoading] = useState(false);
	const [withdrawing, setWithdrawing] = useState(false);
	const [betAmount, setBetAmount] = useState(1);
	const [, setActiveKeys] = useState(0);
	const [gameState, setGameState] = useState<[number, number]>([0, 0])
	const [roundInfo, setRoundInfo] = useState<[number, number]>([0, 0])
	const [accountBalance, setAccountBalance] = useState<number>(0)
	const [accountBets, setAccountBets] = useState<PlayedRound[] | null>(null)
	const [accountWithdrawals, setAccountWithdrawals] = useState<Withdrawal[] | null>(null)
	const toastId = useRef<string | null>(null);        // keep the id we get back
	const timerId = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [clawSocketOn, setClawSocketOn] = useState(false);
	const [roundPlayed, setRoundPlayed] = useState(0);
	const [roundWon, setRoundWon] = useState(0);
	const [pendingWin, setPendingWin] = useState<PendingWin | null>(null);
	const [paymentPickerOpen, setPaymentPickerOpen] = useState(false);
	const [secondsLeft, updateSeconds] = useCountdown(0);

	/* wallet — in bypass mode, identity is a per-session synthetic guest
	 * address; the AppKit hook still runs (cheap, harmless) but we ignore its
	 * output so disconnected guests can play.
	 */
	const { address: walletAddress } = useAppKitAccount();
	const { chainId } = useAppKitNetwork();
	const guestAddress = useMemo(
		() => (BYPASS_PAYMENT ? getOrCreateGuestAddress() : undefined),
		[],
	);
	const address = BYPASS_PAYMENT ? guestAddress : walletAddress;

	/* tell backend who we are */
	useEffect(() => {
		const linkWallet = () => {
			if (!address) return;

			socket.emit('wallet_connected', { address }, (res: { status: string, data: WalletConnectedData }) => {
				if (res.status === "ok") {
					setPosition(res.data.position);
					setAccountBalance(res.data.balance);
					setAccountBets(res.data.bets);
					setAccountWithdrawals(res.data.withdrawals);
					setRoundPlayed(res.data.played);
					setRoundWon(res.data.won);
				}
			});
		}

		linkWallet();
		socket.off('connect')
		socket.on('connect', linkWallet);
	}, [address, socket]);

	/* server events */
	useEffect(() => {
		const onPlayerQueued = () => setQueueCount((q) => q + 1);
		// const onTurnStart = () => {
		// 	setQueueCount((q) => Math.max(q - 1, 0));
		// 	setPosition((p) => (p >= 0 ? p - 1 : p));
		// 	setIsPlaying(false);
		// 	setActiveKeys(0);
		// };
		// const onYourTurn = () => {
		// 	setIsPlaying(true);
		// };
		const onTurnStart = () => {
			console.log('[claw] turn_start', { position: positionRef.current });
			setIsPlaying(positionRef.current === 0);
			if (toastId.current) {
				toaster.update(toastId.current, {
					description: "Better luck next time!",
					type: "error",
					duration: 1000
				})

				toastId.current = null;
			}
		}
		const onTurnEnd = () => {
			console.log('[claw] turn_end', { isPlaying: isPlayingRef.current });
			if (isPlayingRef.current) {
				setRoundPlayed((p) => p + 1);

				toastId.current = toaster.create({
					description: "Checking result…",
					type: "loading",      // shows spinner & neutral colour
				});

				// Fallback — go red if no player_win arrives. The always-on
				// player_win listener below cancels this timer if the win
				// event lands first.
				timerId.current = setTimeout(() => {
					if (!toastId.current) return;
					toaster.update(toastId.current, {
						description: "Better luck next time...",
						type: "error",
						duration: 6000,
						closable: true,
					});
					toastId.current = null;
				}, 6000);
			}
			setQueueCount((q) => Math.max(q - 1, 0));
			setIsPlaying(false);
			setPosition((p) => (p >= 0 ? p - 1 : p));
			setActiveKeys(0);
		};
		const onGlobalSync = (data: GlobalSyncData) => {
			setGameState(data.state);
			setRoundInfo(data.round_info);
			setQueueCount(data.queue_length);
			setClawSocketOn(data.con);
			updateSeconds(data.seconds_left);
		}
		const onPersonalSync = (data: PersonalSyncData) => {
			setPosition(data.position);
		}
		const onClawSocketConnectionChange = (data: clawConnectionData) => {
			setClawSocketOn(data.con);
		}
		const onRoundStart = (data: RoundStartData) => {
			setGameState([0, 0]);
			setRoundPlayed(0);
			setRoundWon(0);
			setRoundInfo(data.round_info);
			socket.emit(
				'check_balance',
				(r: { status: string; balance: number, bets: PlayedRound[], withdrawals: Withdrawal[] }) => {
					if (r.status === 'ok') {
						setAccountBalance(r.balance);
						setAccountBets(r.bets);
						setAccountWithdrawals(r.withdrawals);
					}
				},
			);
		}
		const onAccountBalance = (data: AccountBalanceData) => {
			setAccountBalance(data.balance);
			setAccountBets(data.bets);
			setAccountWithdrawals(data.withdrawals);
		}

		// Backend emits player_win room-targeted to the winning player only,
		// with payload = PendingWin (or null in legacy fallback). This single
		// listener captures the payload, morphs the loading toast set up in
		// onTurnEnd, and increments roundWon to trigger the win modal.
		const onPlayerWin = (payload: PendingWin | null) => {
			console.log('[claw] player_win', payload);
			if (timerId.current) clearTimeout(timerId.current);
			if (payload?.win_id) setPendingWin(payload);

			if (toastId.current) {
				toaster.update(toastId.current, {
					description: "🎉 You won!",
					type: "success",
					duration: 1000,
					closable: true,
				});
				toastId.current = null;
			}

			setRoundWon((w) => w + 1);
			celebrate();
		};

		// Card rail: when a charge confirms via the Stripe webhook rather than
		// synchronously (processing status / 3DS), the backend targets these to
		// the player's room. The synchronous pay_card ack handles the fast path.
		const onPaymentConfirmed = (data: { position: number }) => {
			setPosition(data.position);
			setLoading(false);
		};
		const onPaymentFailed = (data: { error?: string }) => {
			toaster.create({
				description: `Card payment failed${data?.error ? `: ${data.error}` : ''}`,
				type: 'error',
				duration: 2500,
			});
			setLoading(false);
		};

		socket.on('player_win', onPlayerWin);
		socket.on('player_queued', onPlayerQueued);
		socket.on('turn_start', onTurnStart);
		socket.on('claw_connection_change', onClawSocketConnectionChange);
		socket.on('turn_end', onTurnEnd);
		socket.on('global_sync', onGlobalSync)
		socket.on('personal_sync', onPersonalSync);
		socket.on('balance', onAccountBalance);
		socket.on('round_start', onRoundStart);
		socket.on('payment_confirmed', onPaymentConfirmed);
		socket.on('payment_failed', onPaymentFailed);

		return () => {
			socket.off('player_win', onPlayerWin);
			socket.off('player_queued', onPlayerQueued);
			socket.off('turn_start', onTurnStart);
			socket.off('claw_connection_change', onClawSocketConnectionChange);
			socket.off('turn_end', onTurnEnd);
			socket.off('global_sync', onGlobalSync);
			socket.off('personal_sync', onPersonalSync);
			socket.off('balance', onAccountBalance);
			socket.off('round_start', onRoundStart);
			socket.off('payment_confirmed', onPaymentConfirmed);
			socket.off('payment_failed', onPaymentFailed);
		};
	}, [socket, updateSeconds]);

	/* emit bit‑mask */
	const emitMovement = useCallback((mask: number) => {
		socket.emit('move', { bitmask: mask });
	}, [socket]);

	/* press / release helpers (UI + keyboard share the same funcs) */
	const press = useCallback((action: keyof typeof ACTION_TO_KEY) => {
		const bit = KEYMAP[ACTION_TO_KEY[action]];
		setActiveKeys((prev) => {
			if (prev & bit) return prev;
			const next = prev | bit;
			emitMovement(next);
			return next;
		});
	}, [emitMovement]);

	const release = useCallback((action: keyof typeof ACTION_TO_KEY) => {
		const bit = KEYMAP[ACTION_TO_KEY[action]];
		setActiveKeys((prev) => {
			if (!(prev & bit)) return prev;
			const next = prev & ~bit;
			emitMovement(next);
			return next;
		});
	}, [emitMovement]);

	/* pay-to-play (crypto rail) */
	const onPayAck = useCallback((r: { status: string; position: number; error?: string }) => {
		if (r.status === 'ok') {
			setPosition(r.position);
		} else {
			toaster.create({ description: `Error: ${r.error}`, type: 'error', duration: 2500 });
		}
		setLoading(false);
	}, []);

	const approveAndBet = useCallback(async () => {
		if (!address) return;
		setLoading(true);

		if (BYPASS_PAYMENT) {
			// No wallet/transfer in bypass mode — the backend mints a synthetic
			// key and skips payment verification.
			socket.emit('pay_crypto', { address }, onPayAck);
			return;
		}

		if (!chainId) {
			setLoading(false);
			return;
		}
		try {
			// Pay-to-play is a direct USDC transfer to the treasury — no escrow
			// permit/bet. The backend verifies the tx receipt in `pay_crypto`.
			const hash = await writeContract(config, {
				address: USDCAddress as `0x${string}`,
				abi: erc20Abi,
				functionName: 'transfer',
				args: [treasuryAddress, ticketUsdcBaseUnits],
			});
			await waitForTransactionReceipt(config, { hash });

			socket.emit('pay_crypto', { address, tx_hash: hash }, onPayAck);
		} catch (err) {
			console.error(err);
			toaster.create({ description: `Error: ${err}`, type: 'error', duration: 2500 });
			setLoading(false);
		}
	}, [address, chainId, socket, onPayAck]);

	/* pay-to-play (card rail) */
	const openPaymentPicker = useCallback(() => setPaymentPickerOpen(true), []);
	const closePaymentPicker = useCallback(() => setPaymentPickerOpen(false), []);

	// Ask the backend for a SetupIntent client_secret (to add a card) and the
	// existing saved card, if any. See stripe_rail.card_setup.
	const cardSetup = useCallback((): Promise<CardSetupResult> => {
		return new Promise((resolve) => {
			socket.emit('card_setup', {}, (r: CardSetupResult) => resolve(r));
		});
	}, [socket]);

	// Charge the saved card for one play. Fast path: ack carries the position.
	// Slow path: ack is {status:'processing'} and payment_confirmed/_failed
	// (room events, wired in the effect above) resolve it.
	const payCard = useCallback(() => {
		setLoading(true);
		socket.emit('pay_card', {}, (r: { status: string; position?: number; error?: string }) => {
			if (r.status === 'ok' && typeof r.position === 'number') {
				setPosition(r.position);
				setLoading(false);
			} else if (r.status === 'processing') {
				// leave loading; a room event will resolve it.
			} else {
				toaster.create({
					description: `Error: ${r.error ?? 'card payment failed'}`,
					type: 'error',
					duration: 2500,
				});
				setLoading(false);
			}
		});
	}, [socket]);

	/* win actions — param-based primitives + modal-bound wrappers */

	type AckResolver<T> = (r: { status: string } & Record<string, unknown>, resolve: (v: SettleResult<T>) => void) => void;

	const emitAck = useCallback(<T,>(event: string, data: object, parse: AckResolver<T>): Promise<SettleResult<T>> => {
		return new Promise((resolve) => {
			socket.emit(event, data, (r: { status: string } & Record<string, unknown>) => parse(r, resolve));
		});
	}, [socket]);

	const openBoosterByWinId = useCallback(
		(winId: string) => emitAck<{ cards: WinCard[] }>('open_booster_win', { win_id: winId }, (r, resolve) => {
			if (r.status === 'ok') resolve({ ok: true, data: { cards: (r.cards as WinCard[] | undefined) ?? [] } });
			else resolve({ ok: false, error: r.error as string | undefined, code: r.code as string | undefined });
		}),
		[emitAck],
	);

	const resellWinByWinId = useCallback(
		(winId: string, prizeKind: PrizeKind) => {
			const event = prizeKind === 'BOOSTER_PAIR' ? 'resell_booster_win' : 'resell_card_win';
			return emitAck<{ credited_cents: number }>(event, { win_id: winId }, (r, resolve) => {
				if (r.status === 'ok') resolve({ ok: true, data: { credited_cents: (r.credited_cents as number | undefined) ?? 0 } });
				else resolve({ ok: false, error: r.error as string | undefined, code: r.code as string | undefined });
			});
		},
		[emitAck],
	);

	const keepCardByWinId = useCallback(
		(winId: string) => emitAck<{ card: WinCard }>('keep_card_win', { win_id: winId }, (r, resolve) => {
			if (r.status === 'ok' && r.card) resolve({ ok: true, data: { card: r.card as WinCard } });
			else resolve({ ok: false, error: r.error as string | undefined, code: r.code as string | undefined });
		}),
		[emitAck],
	);

	const resellCardFromCollection = useCallback(
		(cardId: string) => emitAck<{ credited_cents: number }>('resell_card_from_collection', { card_id: cardId }, (r, resolve) => {
			if (r.status === 'ok') resolve({ ok: true, data: { credited_cents: (r.credited_cents as number | undefined) ?? 0 } });
			else resolve({ ok: false, error: r.error as string | undefined, code: r.code as string | undefined });
		}),
		[emitAck],
	);

	const getInventory = useCallback(
		() => emitAck<{ pendingWins: InventoryWin[]; cards: WinCard[] }>('get_inventory', {}, (r, resolve) => {
			if (r.status === 'ok') {
				resolve({
					ok: true,
					data: {
						pendingWins: (r.pending_wins as InventoryWin[] | undefined) ?? [],
						cards: (r.cards as WinCard[] | undefined) ?? [],
					},
				});
			} else resolve({ ok: false, error: r.error as string | undefined, code: r.code as string | undefined });
		}),
		[emitAck],
	);

	// Modal-bound wrappers — clear pendingWin on success since the modal
	// represents that one notification.
	const openBoosterWin = useCallback(async (): Promise<SettleResult<{ cards: WinCard[] }>> => {
		if (!pendingWin?.win_id) return { ok: false, error: "no pending win" };
		const r = await openBoosterByWinId(pendingWin.win_id);
		if (r.ok) setPendingWin(null);
		return r;
	}, [pendingWin, openBoosterByWinId]);

	const resellPendingWin = useCallback(async (): Promise<SettleResult<{ credited_cents: number }>> => {
		if (!pendingWin?.win_id) return { ok: false, error: "no pending win" };
		const r = await resellWinByWinId(pendingWin.win_id, pendingWin.prize_kind);
		if (r.ok) setPendingWin(null);
		return r;
	}, [pendingWin, resellWinByWinId]);

	const keepCardWin = useCallback(async (): Promise<SettleResult<{ card: WinCard }>> => {
		if (!pendingWin?.win_id) return { ok: false, error: "no pending win" };
		if (pendingWin.prize_kind !== 'SINGLE_CARD') return { ok: false, error: "not a single-card win" };
		const r = await keepCardByWinId(pendingWin.win_id);
		if (r.ok) setPendingWin(null);
		return r;
	}, [pendingWin, keepCardByWinId]);

	const dismissPendingWin = useCallback(() => {
		setPendingWin(null);
	}, []);

	const withdraw = useCallback(async () => {
		if (!address || !chainId) {
			toaster.create({
				description: "Error while withdrawing funds: no connected wallet",
				type: "error",
				duration: 3000
			})
			return;
		}
		setWithdrawing(true);
		try {
			socket.emit('withdraw', (r: { status: string, data?: string, error?: string }) => {
				if (r.status === 'ok') {
					setAccountBalance(0);
					toaster.create({
						description: "Funds withdrawn successfully...",
						type: "success",
						duration: 3000
					})
				} else {
					toaster.create({
						description: "Unexpected error while withdrawing funds...",
						type: "error",
						duration: 3000
					})
				}
				setWithdrawing(false);
			})
		} catch {
			setWithdrawing(false);
			toaster.create({
				description: "Unexpected error withdrawing funds...",
				type: "error",
				duration: 3000
			})
		}
	}, [socket, address, chainId])

	const value: ClawCtx = {
		queueCount,
		position,
		isPlaying,
		loading,
		withdrawing,
		betAmount,
		gameState,
		roundInfo,
		accountBalance,
		accountBets,
		accountWithdrawals,
		clawSocketOn,
		roundPlayed,
		roundWon,
		secondsLeft,
		pendingWin,
		setBetAmount,
		press,
		release,
		approveAndBet,
		paymentPickerOpen,
		openPaymentPicker,
		closePaymentPicker,
		cardSetup,
		payCard,
		withdraw,
		openBoosterWin,
		resellPendingWin,
		keepCardWin,
		dismissPendingWin,
		getInventory,
		openBoosterByWinId,
		resellWinByWinId,
		keepCardByWinId,
		resellCardFromCollection,
	};

	return <ClawContext.Provider value={value}>{children}</ClawContext.Provider>;
};
