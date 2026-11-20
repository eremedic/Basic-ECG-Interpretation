// POST /api/create-group-checkout  { name, email, org, seats }
//   or, signed in as the instructor:  { group_id, seats }  to add seats to a class
// Starts a Stripe Checkout for course seats (one year of access per student).
import { getDeps, missing } from '../lib/deps.mjs';
import { bearer, cleanEmail, cleanName, json, readJson, safe, UUID_RE } from '../lib/http.mjs';
import { findGroup, GROUP_PRODUCT, MAX_SEATS } from '../lib/groups.mjs';
import { verifyToken } from '../lib/tokens.mjs';

export async function handle(req, deps) {
	if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
	const gaps = missing(deps, 'stripe', 'db', 'siteUrl', 'secret');
	if (gaps.length) return json(503, { error: 'Group purchases are not set up yet. Missing in Netlify: ' + gaps.join(', ') + ' (then redeploy).', missing: gaps });
	const body = await readJson(req);
	if (!body) return json(400, { error: 'Invalid request.' });
	const seats = Number(body.seats);
	const min = deps.minSeats || 5;
	let email, name, org, groupId = '';

	if (body.group_id) {
		// more seats for an existing class: must be its instructor
		email = verifyToken(bearer(req), 'access', deps.secret);
		if (!email) return json(401, { error: 'Please sign in again.' });
		if (!UUID_RE.test(String(body.group_id))) return json(400, { error: 'Invalid class.' });
		const g = await findGroup(deps.db, { id: body.group_id });
		if (!g || g.owner_email !== email) return json(404, { error: 'That class wasn’t found on your account.' });
		if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS) return json(400, { error: `Add between 1 and ${MAX_SEATS} seats.` });
		name = g.owner_name; org = g.org_name; groupId = g.id;
	} else {
		email = cleanEmail(body.email);
		name = cleanName(body.name, 120);
		org = cleanName(body.org, 120);
		if (!email || !name) return json(400, { error: 'Please enter your name and a valid email address.' });
		if (!org) return json(400, { error: 'Please enter your program or class name. Students see it when they join.' });
		if (!Number.isInteger(seats) || seats < min || seats > MAX_SEATS) return json(400, { error: `Choose between ${min} and ${MAX_SEATS} seats.` });
	}

	const each = (deps.seatCents / 100).toFixed(2);
	const session = await deps.stripe.checkout.sessions.create({
		mode: 'payment',
		customer_email: email,
		customer_creation: 'always',
		line_items: [{
			price_data: {
				currency: 'usd',
				unit_amount: deps.seatCents,
				product_data: {
					name: 'Basic ECG Interpretation Self-Paced Course: group seat',
					description: `Course seats for ${org}. Each student gets one year of access from the day they join.`,
					images: [`${deps.siteUrl}/assets/stripe-course.png`]
				}
			},
			quantity: seats
		}],
		allow_promotion_codes: true,
		invoice_creation: { enabled: true, invoice_data: { description: `${seats} course seats for ${org}`, metadata: { product: GROUP_PRODUCT } } },
		metadata: { product: GROUP_PRODUCT, owner_email: email, owner_name: name, org, seats: String(seats), group_id: groupId },
		payment_intent_data: { description: `Basic ECG Interpretation: ${seats} group seats (${org})`, metadata: { product: GROUP_PRODUCT, owner_email: email } },
		custom_text: {
			submit: { message: `${seats} seats at $${each} each. After paying you'll get a join link to share with your students. Each student gets one year of access from the day they join. [Terms and refund policy](${deps.siteUrl}/#terms)` }
		},
		success_url: `${deps.siteUrl}/#welcome-group?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: groupId ? `${deps.siteUrl}/#group` : `${deps.siteUrl}/#group-buy`
	});
	return json(200, { url: session.url });
}

export default safe((req) => handle(req, getDeps()));
