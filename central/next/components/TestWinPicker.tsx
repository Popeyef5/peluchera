"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { useSocket } from "@/components/providers/SocketProvider";

// Dev-only. Backed by the DEV_TOOLS-gated `dev_loaded_balls` / `dev_win_ball`
// socket events. Confirming forces the mock chute to drop the chosen ball and
// runs a REAL turn — the win animation then fires from the normal player_win.
const DEV_TOOLS = process.env.NEXT_PUBLIC_DEV_TOOLS === "true";

type LoadedBall = { serial: string; prize_kind: string; sku: string | null };

type TestWinCtx = {
	enabled: boolean;
	open: boolean;
	openPicker: () => void;
	closePicker: () => void;
};
const Ctx = createContext<TestWinCtx>({
	enabled: false,
	open: false,
	openPicker: () => {},
	closePicker: () => {},
});

// Consumed by the shared PLAY button (enabled only on /test-win) and by
// <TestWinPicker/>. The provider sits ABOVE the app's SocketProvider, so it
// only holds state here — the picker itself renders inside the providers (next
// to WinChoiceModal) so it can use the socket.
export const useTestWin = () => useContext(Ctx);

export function TestWinProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const openPicker = useCallback(() => setOpen(true), []);
	const closePicker = useCallback(() => setOpen(false), []);
	const value = useMemo(
		() => ({ enabled: DEV_TOOLS, open, openPicker, closePicker }),
		[open, openPicker, closePicker],
	);
	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Rendered inside the app providers (see app/page.tsx, next to WinChoiceModal)
// so useSocket() resolves. Inert unless the TestWinProvider above it is enabled
// and the picker is open — on the normal / page it renders nothing.
export function TestWinPicker() {
	const { enabled, open, closePicker } = useTestWin();
	const socket = useSocket();
	const [balls, setBalls] = useState<LoadedBall[] | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [err, setErr] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) return;
		setBalls(null);
		setErr(null);
		setSelected(null);
		setBusy(false);
		socket.emit(
			"dev_loaded_balls",
			(res: { status: string; balls?: LoadedBall[]; error?: string }) => {
				if (res.status === "ok" && res.balls) {
					setBalls(res.balls);
					setSelected(res.balls[0]?.serial ?? null);
				} else {
					setErr(res.error ?? "failed to load balls");
					setBalls([]);
				}
			},
		);
	}, [open, socket]);

	if (!enabled || !open) return null;

	const confirm = () => {
		if (!selected) return;
		setBusy(true);
		setErr(null);
		socket.emit(
			"dev_win_ball",
			{ serial: selected },
			(res: { status: string; error?: string }) => {
				setBusy(false);
				// On success the modal closes; the real turn runs (queue wait ->
				// mock drops the ball -> player_win) and WinChoiceModal takes over.
				if (res.status === "ok") closePicker();
				else setErr(res.error ?? "failed to start turn");
			},
		);
	};

	return (
		<div className="tw-overlay" onClick={closePicker}>
			<div className="tw-panel holo-rim spec" onClick={(e) => e.stopPropagation()}>
				<div className="tw-tag">Dev · test win</div>
				<h2 className="tw-title">Pick a loaded ball to win</h2>

				{!balls && !err && <p className="tw-muted">Loading loaded balls…</p>}
				{balls && balls.length === 0 && (
					<p className="tw-muted">
						{err ?? "No loaded balls — seed dev inventory first."}
					</p>
				)}

				{balls && balls.length > 0 && (
					<ul className="tw-list">
						{balls.map((b) => (
							<li key={b.serial}>
								<label
									className={`tw-row ${selected === b.serial ? "tw-row--sel" : ""}`}
								>
									<input
										type="radio"
										name="tw-ball"
										checked={selected === b.serial}
										onChange={() => setSelected(b.serial)}
									/>
									<span className="tw-serial">{b.serial}</span>
									<span className="tw-kind">
										{b.prize_kind === "OPENED_BOOSTER"
											? "Booster"
											: b.prize_kind === "CLOSED_BOOSTER"
												? "Sealed"
												: "Card"}
									</span>
									<span className="tw-sku">{b.sku ?? "—"}</span>
								</label>
							</li>
						))}
					</ul>
				)}

				{err && balls && balls.length > 0 && <p className="tw-err">{err}</p>}

				<div className="tw-actions">
					<button className="tw-btn" onClick={closePicker} disabled={busy}>
						Cancel
					</button>
					<button
						className="tw-btn tw-btn--primary"
						onClick={confirm}
						disabled={busy || !selected}
					>
						{busy ? "Starting turn…" : "Win this ball"}
					</button>
				</div>
			</div>

			<style jsx>{`
				.tw-overlay {
					position: fixed;
					inset: 0;
					z-index: 60;
					display: flex;
					align-items: center;
					justify-content: center;
					padding: 1rem;
					background: rgba(0, 0, 0, 0.45);
					backdrop-filter: blur(2px);
				}
				.tw-panel {
					width: 100%;
					max-width: 30rem;
					border-radius: 1rem;
					padding: 1.25rem 1.25rem 1rem;
					background: var(--paper-1, #17151f);
					color: var(--ink, #e9e6f0);
					box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
				}
				.tw-tag {
					font-size: 0.7rem;
					letter-spacing: 0.14em;
					text-transform: uppercase;
					opacity: 0.6;
				}
				.tw-title {
					margin: 0.15rem 0 0.9rem;
					font-size: 1.15rem;
					font-weight: 700;
				}
				.tw-muted {
					opacity: 0.7;
					font-size: 0.9rem;
					padding: 0.5rem 0;
				}
				.tw-err {
					color: #ff8a8a;
					font-size: 0.85rem;
					margin: 0.5rem 0 0;
				}
				.tw-list {
					list-style: none;
					margin: 0;
					padding: 0;
					max-height: 46vh;
					overflow-y: auto;
					display: flex;
					flex-direction: column;
					gap: 0.35rem;
				}
				.tw-row {
					display: grid;
					grid-template-columns: auto 1fr auto auto;
					align-items: center;
					gap: 0.6rem;
					padding: 0.55rem 0.7rem;
					border-radius: 0.6rem;
					border: 1px solid rgba(255, 255, 255, 0.08);
					cursor: pointer;
					font-size: 0.9rem;
				}
				.tw-row--sel {
					border-color: var(--accent, #8b7cff);
					background: rgba(139, 124, 255, 0.12);
				}
				.tw-serial {
					font-family: var(--lg-mono, monospace);
					font-size: 0.85rem;
				}
				.tw-kind {
					font-size: 0.72rem;
					text-transform: uppercase;
					letter-spacing: 0.06em;
					opacity: 0.75;
				}
				.tw-sku {
					font-family: var(--lg-mono, monospace);
					font-size: 0.78rem;
					opacity: 0.85;
				}
				.tw-actions {
					display: flex;
					justify-content: flex-end;
					gap: 0.6rem;
					margin-top: 1rem;
				}
				.tw-btn {
					padding: 0.5rem 1rem;
					border-radius: 0.55rem;
					border: 1px solid rgba(255, 255, 255, 0.14);
					background: transparent;
					color: inherit;
					font-weight: 600;
					font-size: 0.9rem;
					cursor: pointer;
				}
				.tw-btn:disabled {
					opacity: 0.5;
					cursor: default;
				}
				.tw-btn--primary {
					background: var(--accent, #8b7cff);
					border-color: transparent;
					color: #0f0d16;
				}
			`}</style>
		</div>
	);
}
