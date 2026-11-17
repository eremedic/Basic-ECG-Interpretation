// POST /api/monitor-portal  (Authorization: Bearer <access token>)
// Opens Stripe's customer portal, where a subscriber can cancel, update their
// card or see invoices. Needs the portal turned on in Stripe (Settings →
// Billing → Customer portal → Save).
import { getDeps, missing } from '../lib/deps.mjs';
import { bearer, json, safe } from '../lib/http.mjs';
import { findStudent } from '../lib/students.mjs';
import { verifyToken } from '../lib/tokens.mjs';

export async function handle(req, deps) {
	if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
	const gaps = missing(deps, 'stripe', 'db', 'secret', 'siteUrl');
	if (gaps.length) return json(503, { error: 'Subscriptions are not set up yet.', missing: gaps });
	const email = verifyToken(bearer(req), 'access', deps.secret);
	if (!email) return json(401, { error: 'Please sign in again.' });
	const student = await findStudent(deps.db, email);
	if (!student?.monitor_subscription_id) return json(404, { error: 'No Live Monitor subscription was found for this account.' });
	// Use the customer that owns the subscription. The customer saved on the
	// student's row can be from another purchase (or another Stripe mode).
	let customer = student.stripe_customer_id;
	try {
		const sub = await deps.stripe.subscriptions.retrieve(student.monitor_subscription_id);
		customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || customer;
	} catch {
		/* fall back to the saved customer */
	}
	if (!customer) return json(404, { error: 'No Live Monitor subscription was found for this account.' });
	const portal = await deps.stripe.billingPortal.sessions.create({ customer, return_url: `${deps.siteUrl}/#monitor` });
	return json(200, { url: portal.url });
}

export default safe((req) => handle(req, getDeps()));
