'use client';

import React, {
	createContext, useCallback, useContext, useEffect, useState, useRef
} from 'react';
import { useSocket } from '@/components/providers/SocketProvider';
import {
	useAppKitAccount, useAppKitNetwork,
} from '@reown/appkit/react';
import { toaster } from "@/components/ui/toaster"
import { USDCAddress, erc20WithPermitAbi, clawAddress } from '@/lib/crypto/contracts';
import { readContract, signTypedData } from 'wagmi/actions';
import { config } from '@/config';
import { types } from '@/lib/crypto/permit';
import celebrate from '@/components/confetti';

/* bit‑mask helpers */
const KEYMAP: Record<string, number> = {
	ArrowLeft: 0b0001,
	ArrowRight: 0b0010,
	ArrowUp: 0b0100,
	ArrowDown: 0b1000,
	' ': 0b0001_0000,  // Grab
};
const ACTION_TO_KEY = {
	left: 'ArrowLeft',
	right: 'ArrowRight',
	up: 'ArrowUp',
	down: 'ArrowDown',
	grab: ' ',
} as const;

interface GlobalSyncData {
	state: [number, number];
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
}

interface clawConnectionData {
	con: boolean;
}

interface AccountBalanceData {
	balance: number
}

interface ClawCtx {
	queueCount: number;
	position: number;
	isPlaying: boolean;
	loading: boolean;
	betAmount: number;
	gameState: [number, number];
	accountBalance: number;
	clawSocketOn: boolean;
	roundPlayed: number;
	roundWon: number;
	secondsLeft: number;
	setBetAmount: (v: number) => void;
	press: (a: keyof typeof ACTION_TO_KEY) => void;
	release: (a: keyof typeof ACTION_TO_KEY) => void;
	approveAndBet: () => void;
	withdraw: () => void;
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
	const [betAmount, setBetAmount] = useState(1);
	const [, setActiveKeys] = useState(0);
	const [gameState, setGameState] = useState<[number, number]>([0, 0])
	const [accountBalance, setAccountBalance] = useState<number>(0)
	const toastId = useRef<string | null>(null);        // keep the id we get back
	const timerId = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [clawSocketOn, setClawSocketOn] = useState(false);
	const [roundPlayed, setRoundPlayed] = useState(0);
	const [roundWon, setRoundWon] = useState(0);
	const [secondsLeft, updateSeconds] = useCountdown(0);

	/* wallet */
	const { address } = useAppKitAccount();
	const { chainId } = useAppKitNetwork();



	/* tell backend who we are */
	useEffect(() => {
		const linkWallet = () => {
			if (!address) return;

			socket.emit('wallet_connected', { address }, (res: { status: string, data: WalletConnectedData }) => {
				if (res.status === "ok") {
					setPosition(res.data.position);
					setAccountBalance(res.data.balance);
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
			if (isPlayingRef.current) {
				setRoundPlayed((p) => p + 1);

				toastId.current = toaster.create({
					description: "Checking result…",
					type: "loading",      // shows spinner & neutral colour
				});

				// start fallback timer — go red if we hear nothing
				timerId.current = setTimeout(() => {
					if (!toastId.current) return;
					toaster.update(toastId.current, {
						description: "Better luck next time...",
						type: "error",           // red colour scheme
						duration: 6000,
						closable: true,
					});
					toastId.current = null;
				}, 6000);

				/** listen ONCE for the outcome, then morph the same toast */
				socket.once("player_win", () => {
					if (timerId.current) clearTimeout(timerId.current);       // cancel fallback
					if (!toastId.current) return;

					setRoundWon((w) => w + 1);

					celebrate()

					toaster.update(toastId.current, {
						description: "🎉 You won!",
						type: "success",  // green / red skin
						duration: 1000,
						closable: true,
					});

					toastId.current = null;        // optional: clear ref
				});
			}
			setQueueCount((q) => Math.max(q - 1, 0));
			setIsPlaying(false);
			setPosition((p) => (p >= 0 ? p - 1 : p));
			setActiveKeys(0);
		};
		const onGlobalSync = (data: GlobalSyncData) => {
			setGameState(data.state);
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
		const onRoundEnd = () => {
			setGameState([0, 0]);
			setRoundPlayed(0);
			setRoundWon(0);
			socket.emit(
				'check_balance',
				(r: { status: string; balance: number }) => {
					if (r.status === 'ok') setAccountBalance(r.balance);
				},
			);
		}
		const onAccountBalance = (data: AccountBalanceData) => {
			setAccountBalance(data.balance);
		}

		socket.on('player_queued', onPlayerQueued);
		socket.on('turn_start', onTurnStart);
		socket.on('claw_connection_change', onClawSocketConnectionChange);
		socket.on('turn_end', onTurnEnd);
		socket.on('global_sync', onGlobalSync)
		socket.on('personal_sync', onPersonalSync);
		socket.on('balance', onAccountBalance);
		socket.on('round_end', onRoundEnd);

		return () => {
			socket.off('player_queued', onPlayerQueued);
			socket.off('turn_start', onTurnStart);
			socket.off('claw_connection_change', onClawSocketConnectionChange);
			socket.off('turn_end', onTurnEnd);
			socket.off('global_sync', onGlobalSync);
			socket.off('personal_sync', onPersonalSync);
			socket.off('balance', onAccountBalance);
			socket.off('round_end', onRoundEnd);
		};
	}, [socket]);

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

	/* keyboard listeners */
	useEffect(() => {
		if (!isPlaying) return;

		const down = (e: KeyboardEvent) => {
			if (e.key in KEYMAP) {
				const action = Object.entries(ACTION_TO_KEY).find(([, key]) => key === e.key)?.[0];
				if (action) press(action as keyof typeof ACTION_TO_KEY);
			}
		};

		const up = (e: KeyboardEvent) => {
			if (e.key in KEYMAP) {
				const action = Object.entries(ACTION_TO_KEY).find(([, key]) => key === e.key)?.[0];
				if (action) release(action as keyof typeof ACTION_TO_KEY);
			}
		};
		window.addEventListener('keydown', down);
		window.addEventListener('keyup', up);
		return () => {
			window.removeEventListener('keydown', down);
			window.removeEventListener('keyup', up);
		};
	}, [isPlaying, press, release]);

	/* approve + bet */
	const approveAndBet = useCallback(async () => {
		if (!address || !chainId) return;
		setLoading(true);
		try {
			const userAddr = address as `0x${string}`;
			const amount = BigInt(betAmount);
			const USDC = { address: USDCAddress, abi: erc20WithPermitAbi } as const;

			const [name, nonce, version] = await Promise.all([
				readContract(config, { ...USDC, functionName: 'name' }),
				readContract(config, { ...USDC, functionName: 'nonces', args: [userAddr] }),
				readContract(config, { ...USDC, functionName: 'version' }),
			]);

			const deadline = BigInt(Math.floor(Date.now() / 1000 + 86_400));

			const signature = await signTypedData(config, {
				account: userAddr,
				types,
				primaryType: 'Permit',
				domain: { name, chainId: BigInt(chainId), version, verifyingContract: USDCAddress },
				message: { owner: userAddr, spender: clawAddress, value: amount, nonce, deadline },
			});

			socket.emit(
				'join_queue',
				{ address, amount: Number(betAmount), deadline: Number(deadline), signature },
				(r: { status: string; position: number, error?: string }) => {
					if (r.status === 'ok') {
						setPosition(r.position);
					} else {
						toaster.create({
							description: `Error: ${r.error}`,
							type: "error",
							duration: 2500
						})
					}
					setLoading(false);
				},
			);
		} catch (err) {
			console.error(err);
			toaster.create({
				description: `Error: ${err}`,
				type: "error",
				duration: 2500
			})
			setLoading(false);
		}
	}, [address, chainId, betAmount, socket]);

	const withdraw = useCallback(async () => {
		if (!address || !chainId) {
			toaster.create({
				description: "Error while withdrawing funds: no connected wallet",
				type: "error",
				duration: 3000
			})
			return;
		}
		console.log("withdrawing funds...")
		socket.emit('withdraw', (r: { status: string, data?: string, error?: string }) => {
			console.log(r);
			if (r.status === 'ok') {
				setAccountBalance(0);
			} else {
				toaster.create({
					description: "Unexpected error while withdrawing funds...",
					type: "error",
					duration: 3000
				})
			}
		})
	}, [socket, address, chainId])

	const value: ClawCtx = {
		queueCount,
		position,
		isPlaying,
		loading,
		betAmount,
		gameState,
		accountBalance,
		clawSocketOn,
		roundPlayed,
		roundWon,
		secondsLeft,
		setBetAmount,
		press,
		release,
		approveAndBet,
		withdraw,
	};

	return <ClawContext.Provider value={value}>{children}</ClawContext.Provider>;
};
