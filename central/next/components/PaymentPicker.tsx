'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { getStripe, stripeConfigured } from '@/lib/stripe';
import { useClaw, type SavedCard } from '@/components/providers/ClawProvider';
import { toaster } from '@/components/ui/toaster';

const stripePromise = getStripe();

// Inner form — must live inside <Elements> to use the Stripe hooks. Saves the
// card (SetupIntent) then hands control back to charge it.
function CardForm({ onSaved }: { onSaved: () => void }) {
	const stripe = useStripe();
	const elements = useElements();
	const [submitting, setSubmitting] = useState(false);

	const submit = async () => {
		if (!stripe || !elements) return;
		setSubmitting(true);
		const { error } = await stripe.confirmSetup({ elements, redirect: 'if_required' });
		setSubmitting(false);
		if (error) {
			toaster.create({ description: error.message ?? 'Card could not be saved', type: 'error', duration: 3000 });
			return;
		}
		onSaved();
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
			<PaymentElement />
			<button className="motion-perm__btn" onClick={submit} disabled={submitting || !stripe}>
				{submitting ? 'Saving…' : 'Save card & play'}
			</button>
		</div>
	);
}

// Pay-to-play method picker. Opened by the PLAY button (non-bypass); offers the
// crypto rail (direct USDC transfer) and the card rail (Stripe saved card).
export default function PaymentPicker({ containerRef }: { containerRef?: React.RefObject<HTMLElement | null> }) {
	const { paymentPickerOpen, closePaymentPicker, approveAndBet, cardSetup, payCard } = useClaw();
	const [saved, setSaved] = useState<SavedCard | null>(null);
	const [clientSecret, setClientSecret] = useState<string | null>(null);
	const [mode, setMode] = useState<'choose' | 'add-card'>('choose');
	const [cardBackendOn, setCardBackendOn] = useState(true);

	useEffect(() => {
		if (!paymentPickerOpen) return;
		setMode('choose');
		setSaved(null);
		setClientSecret(null);
		setCardBackendOn(true);
		if (!stripeConfigured) { setCardBackendOn(false); return; }
		cardSetup()
			.then((r) => {
				if (r.status === 'ok') {
					setSaved(r.saved_card ?? null);
					setClientSecret(r.client_secret ?? null);
				} else {
					setCardBackendOn(false);
				}
			})
			.catch(() => setCardBackendOn(false));
	}, [paymentPickerOpen, cardSetup]);

	const portalTarget = containerRef?.current ?? (typeof document !== 'undefined' ? document.body : null);
	if (!paymentPickerOpen || !portalTarget) return null;

	const cardAvailable = stripeConfigured && cardBackendOn;

	const payWithCrypto = () => { approveAndBet(); closePaymentPicker(); };
	const payWithSavedCard = () => { payCard(); closePaymentPicker(); };
	const onCardSaved = () => { payCard(); closePaymentPicker(); };

	return createPortal(
		<>
			<div
				className="lg-drawer-backdrop"
				onClick={closePaymentPicker}
				style={{ position: 'fixed', inset: 0, zIndex: 1000 }}
			/>
			<div
				style={{
					position: 'fixed', inset: 0, display: 'flex', alignItems: 'center',
					justifyContent: 'center', zIndex: 1001, pointerEvents: 'none', padding: 16,
				}}
			>
				<div
					className="glass holo-rim"
					style={{
						width: 'min(90vw, 380px)', borderRadius: '1.5rem', pointerEvents: 'auto',
						background: 'transparent', boxShadow: 'none',
					}}
				>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '2vh', padding: '3.5vh 6vw' }}>
						<div className="rates__tag">Pay to play</div>

						<button className="motion-perm__btn" onClick={payWithCrypto}>
							Pay with crypto (USDC)
						</button>

						{cardAvailable && mode === 'choose' && saved && (
							<button className="motion-perm__btn" onClick={payWithSavedCard}>
								Pay with card •••• {saved.last4 ?? '····'}
							</button>
						)}

						{cardAvailable && mode === 'choose' && !saved && (
							<button className="motion-perm__btn motion-perm__btn--ghost" onClick={() => setMode('add-card')}>
								Pay with a card
							</button>
						)}

						{cardAvailable && mode === 'add-card' && clientSecret && (
							<Elements stripe={stripePromise} options={{ clientSecret }}>
								<CardForm onSaved={onCardSaved} />
							</Elements>
						)}

						<button className="motion-perm__btn motion-perm__btn--ghost" onClick={closePaymentPicker}>
							Cancel
						</button>
					</div>
				</div>
			</div>
		</>,
		portalTarget,
	);
}
