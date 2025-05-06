'use client';

import React, {
	createContext, useCallback, useContext, useEffect, useState,
} from 'react';
import { useSocket } from '@/app/components/providers/SocketProvider';
import {
	useAppKitAccount, useAppKitNetwork,
} from '@reown/appkit/react';
import { USDCAddress, erc20WithPermitAbi, clawAddress } from '@/lib/crypto/contracts';
import { readContract, signTypedData } from 'wagmi/actions';
import { config } from '@/config';
import { types } from '@/lib/crypto/permit';

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
}

interface PersonalSyncData {
	position: number;
	balance: number;
}

interface PersonalSyncData {
	position: number;
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
	setBetAmount: (v: number) => void;
	press: (a: keyof typeof ACTION_TO_KEY) => void;
	release: (a: keyof typeof ACTION_TO_KEY) => void;
	approveAndBet: () => void;
	withdraw: () => void;
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
	const [isPlaying, setIsPlaying] = useState(false);
	const [loading, setLoading] = useState(false);
	const [betAmount, setBetAmount] = useState(1);
	const [, setActiveKeys] = useState(0);
	const [gameState, setGameState] = useState<[number, number]>([0, 0])
	const [accountBalance, setAccountBalance] = useState<number>(0)

	/* wallet */
	const { address } = useAppKitAccount();
	const { chainId } = useAppKitNetwork();

	/* tell backend who we are */
	useEffect(() => {
		if (!address) return;
		socket.emit('wallet_connected', { address }, (res: { status: string, data: PersonalSyncData }) => {
			if (res.status === "ok") {
				setPosition(res.data.position);
			}
		});
	}, [address, socket]);

	/* server events */
	useEffect(() => {
		const onPlayerQueued = () => setQueueCount((q) => q + 1);
		const onTurnStart = () => {
			setQueueCount((q) => Math.max(q - 1, 0));
			setPosition((p) => (p >= 0 ? p - 1 : p));
			setIsPlaying(false);
			setActiveKeys(0);
		};
		const onYourTurn = () => {
			setIsPlaying(true);
		};
		const onTurnEnd = () => {
			setIsPlaying(false);
			setPosition((p) => (p >= 0 ? p - 1 : p));
			setActiveKeys(0);
		};
		const onGlobalSync = (data: GlobalSyncData) => {
			setGameState(data.state);
			setQueueCount(data.queue_length);
		}
		const onPersonalSync = (data: PersonalSyncData) => {
			setPosition(data.position);
		}
		const onAccountBalance = (data: AccountBalanceData) => {
			setAccountBalance(data.balance);
		}

		socket.on('player_queued', onPlayerQueued);
		socket.on('turn_start', onTurnStart);
		socket.on('your_turn', onYourTurn);
		socket.on('turn_end', onTurnEnd);
		socket.on('global_sync', onGlobalSync)
		socket.on('personal_sync', onPersonalSync);
		socket.on('balance', onAccountBalance)

		return () => {
			socket.off('player_queued', onPlayerQueued);
			socket.off('turn_start', onTurnStart);
			socket.off('your_turn', onYourTurn);
			socket.off('turn_end', onTurnEnd);
			socket.off('global_sync', onGlobalSync);
			socket.off('personal_sync', onPersonalSync);
			socket.off('balance', onAccountBalance);
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
				(r: { status: string; position: number }) => {
					if (r.status === 'ok') setPosition(r.position);
					setLoading(false);
				},
			);
		} catch (err) {
			console.error(err);
			setLoading(false);
		}
	}, [address, chainId, betAmount, socket]);

	const withdraw = useCallback(async () => {
		if (!address || !chainId) return;
		socket.emit('withdraw', (r: { status: string; balance: number }) => {
			if (r.status === 'ok') setAccountBalance(r.balance);
		})
	}, [socket])

	const value: ClawCtx = {
		queueCount,
		position,
		isPlaying,
		loading,
		betAmount,
		gameState,
		accountBalance,
		setBetAmount,
		press,
		release,
		approveAndBet,
		withdraw,
	};

	return <ClawContext.Provider value={value}>{children}</ClawContext.Provider>;
};
