// POST /api/create-monitor-checkout  { name, email }
// Starts a Stripe Checkout for the Live Monitor monthly subscription and
// returns its URL. The Live Monitor is sold on its own: no course purchase needed.
import { getDeps, missing } from '../lib/deps.mjs';
import { cleanEmail, cleanName, json, readJson, safe } from '../lib/http.mjs';
import { findStudent } from '../lib/students.mjs';
import { MONITOR_PRODUCT, monitorActive, monitorUntil } from '../lib/monitor.mjs';

export async function handle(req, deps) {
	if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
	const gaps = missing(deps, 'stripe', 'db', 'siteUrl');
	if (gaps.length) return json(503, { error: 'Subscriptions are not set up yet. Missing in Netlify: ' + gaps.join(', ') + ' (then redeploy).', missing: gaps });
	const body = await readJson(req);
	const email = cleanEmail(body?.email);
	const name = cleanName(body?.name, 120);
	if (!email || !name) return json(400, { error: 'Please enter your name and a valid email address.' });

	const existing = await findStudent(deps.db, email);
	if (monitorActive(existing)) {
		const until = monitorUntil(existing);
		return json(409, { alreadySubscribed: true, error: 'This email already has an active Live Monitor subscription' + (until ? ' (paid through ' + until.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) + ')' : '') + '. We can email you a sign-in link.' });
	}

	const lineItem = deps.monitorPriceId
		? { price: deps.monitorPriceId, quantity: 1 }
		: {
				price_data: {
					currency: 'usd',
					unit_amount: deps.monitorPriceCents,
					recurring: { interval: 'month' },
					product_data: {
						name: 'Live Monitor — monthly subscription',
						description: '300 live ECG rhythms to interpret on a cardiac monitor. Cancel anytime.',
						images: [`${deps.siteUrl}/assets/stripe-course.png`]
					}
				},
				quantity: 1
			};
	const meta = { product: MONITOR_PRODUCT, student_name: name, email };
	const params = (who) => ({
		mode: 'subscription',
		...who,
		line_items: [lineItem],
		allow_promotion_codes: true,
		metadata: meta,
		subscription_data: { metadata: meta, description: 'Basic ECG Interpretation · Live Monitor' },
		custom_text: {
			submit: { message: `Billed monthly. Cancel anytime from "Manage subscription" on the Live Monitor page; you keep access until the end of the month you've paid for. [Terms](${deps.siteUrl}/#terms)` }
		},
		success_url: `${deps.siteUrl}/#welcome-monitor?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${deps.siteUrl}/#monitor`
	});
	let session;
	if (existing?.stripe_customer_id) {
		// reuse the student's Stripe customer (from the course purchase)…
		try {
			session = await deps.stripe.checkout.sessions.create(params({ customer: existing.stripe_customer_id }));
		} catch (e) {
			// …unless Stripe doesn't know it (saved in another mode or account): use the email instead
			if (!(e?.code === 'resource_missing' || /No such customer/i.test(e?.message || ''))) throw e;
		}
	}
	if (!session) session = await deps.stripe.checkout.sessions.create(params({ customer_email: email }));
	return json(200, { url: session.url });
}

export default safe((req) => handle(req, getDeps()));
