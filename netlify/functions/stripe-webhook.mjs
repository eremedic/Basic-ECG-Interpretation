// POST /api/stripe-webhook  (called by Stripe)
// Records the student when a Checkout payment completes, even if they close
// the browser before returning to the site. Point a Stripe webhook endpoint at
// https://<your site>/api/stripe-webhook for the event checkout.session.completed.
import { getDeps } from '../lib/deps.mjs';
import { json, safe } from '../lib/http.mjs';
import { recordPayment } from '../lib/students.mjs';

export async function handle(req, deps) {
	if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
	if (!deps.stripe || !deps.db || !deps.webhookSecret) return json(503, { error: 'Webhook is not set up yet.' });
	const raw = await req.text();
	let event;
	try {
		event = deps.stripe.webhooks.constructEvent(raw, req.headers.get('stripe-signature') || '', deps.webhookSecret);
	} catch {
		return json(400, { error: 'Invalid signature.' });
	}
	if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
		const s = event.data.object;
		if (s.metadata?.product === 'ecg-basic-course' && s.payment_status === 'paid') await recordPayment(deps.db, s);
	}
	return json(200, { received: true });
}

export default safe((req) => handle(req, getDeps()));
