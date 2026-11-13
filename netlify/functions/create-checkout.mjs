// POST /api/create-checkout  { name, email }
// Starts a Stripe Checkout for the full course and returns its URL.
import { getDeps, missing } from '../lib/deps.mjs';
import { cleanEmail, cleanName, json, readJson, safe } from '../lib/http.mjs';
import { accessUntil, canRenew, findStudent, hasAccess } from '../lib/students.mjs';

export async function handle(req, deps) {
	if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
	const gaps = missing(deps, 'stripe', 'db', 'siteUrl');
	if (gaps.length) return json(503, { error: 'Enrollment is not set up yet. Missing in Netlify: ' + gaps.join(', ') + ' (then redeploy).', missing: gaps });
	const body = await readJson(req);
	const email = cleanEmail(body?.email);
	const name = cleanName(body?.name, 120);
	if (!email || !name) return json(400, { error: 'Please enter your name and a valid email address.' });

	const existing = await findStudent(deps.db, email);
	if (hasAccess(existing) && !canRenew(existing)) {
		const until = accessUntil(existing).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
		return json(409, { alreadyEnrolled: true, error: `This email is already enrolled, with access until ${until}. We can email you a sign-in link.` });
	}

	const lineItem = deps.priceId
		? { price: deps.priceId, quantity: 1 }
		: {
				price_data: {
					currency: 'usd',
					unit_amount: deps.priceCents,
					product_data: {
						name: 'Basic ECG Interpretation — full course',
						description: 'One year of access: 9 narrated units, activities, quizzes, final exam and certificate.',
						images: [`${deps.siteUrl}/assets/stripe-course.png`]
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
		payment_intent_data: { description: 'Basic ECG Interpretation — full course', metadata: { product: 'ecg-basic-course', student_name: name } },
		custom_text: checkoutText(deps),
		// Requires a Terms of Service URL in Stripe → Settings → Business → Public details.
		...(deps.requireTerms ? { consent_collection: { terms_of_service: 'required' } } : {}),
		success_url: `${deps.siteUrl}/#welcome?session_id={CHECKOUT_SESSION_ID}`,
		cancel_url: `${deps.siteUrl}/#enroll`
	});
	return json(200, { url: session.url });
}

/** Words shown on Stripe's payment page (Markdown links are allowed). */
export function checkoutText(deps) {
	const terms = `${deps.siteUrl}/#terms`;
	const text = {
		submit: {
			message: `One payment for one year of access to all 9 units, the final exam and your certificate. After paying you'll return to the course with everything unlocked. [Terms and refund policy](${terms})`
		},
		after_submit: {
			message: 'Thank you for enrolling! Taking you back to your course…'
		}
	};
	if (deps.requireTerms)
		text.terms_of_service_acceptance = { message: `I agree to the [Terms of Use and Refund Policy](${terms}).` };
	return text;
}

export default safe((req) => handle(req, getDeps()));
