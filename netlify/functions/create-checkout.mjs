// POST /api/create-checkout  { name, email }
// Starts a Stripe Checkout for the full course and returns its URL.
import { getDeps, missing } from '../lib/deps.mjs';
import { cleanEmail, cleanName, json, readJson } from '../lib/http.mjs';
import { findStudent } from '../lib/students.mjs';

export async function handle(req, deps) {
	if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
	const gaps = missing(deps, 'stripe', 'db', 'siteUrl');
	if (gaps.length) return json(503, { error: 'Enrollment is not set up yet.', missing: gaps });
	const body = await readJson(req);
	const email = cleanEmail(body?.email);
	const name = cleanName(body?.name, 120);
	if (!email || !name) return json(400, { error: 'Please enter your name and a valid email address.' });

	const existing = await findStudent(deps.db, email);
	if (existing?.paid_at) return json(409, { alreadyEnrolled: true, error: 'This email is already enrolled. We can email you a sign-in link.' });

	const lineItem = deps.priceId
		? { price: deps.priceId, quantity: 1 }
		: {
				price_data: {
					currency: 'usd',
					unit_amount: deps.priceCents,
					product_data: {
						name: 'Basic ECG Interpretation — full course',
						description: 'Lifetime access: 9 narrated units, activities, quizzes, final exam and certificate.'
					}
				},
				quantity: 1
			};
	const session = await deps.stripe.checkout.sessions.create({
		mode: 'payment',
		customer_email: email,
		customer_creation: 'always',
		line_items: [lineItem],
		allow_promotion_codes: true,
		metadata: { product: 'ecg-basic-course', student_name: name },
		success_url: `${deps.siteUrl}/#welcome?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${deps.siteUrl}/#enroll`
	});
	return json(200, { url: session.url });
}

export default (req) => handle(req, getDeps());
