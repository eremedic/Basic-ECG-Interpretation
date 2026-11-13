// POST /api/claim  { session_id }  or  { link_token }
// Exchanges proof of enrollment for the browser's access token:
//   session_id  the Stripe Checkout session the student just paid with
//   link_token  the token from a sign-in email
import { getDeps, missing } from '../lib/deps.mjs';
import { json, readJson, safe } from '../lib/http.mjs';
import { findStudent, recordPayment, touchSignIn } from '../lib/students.mjs';
import { signToken, verifyToken } from '../lib/tokens.mjs';

export async function handle(req, deps) {
	if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
	const body = await readJson(req);
	if (!body) return json(400, { error: 'Invalid request.' });

	if (typeof body.session_id === 'string') {
		const gaps = missing(deps, 'stripe', 'db', 'secret');
		if (gaps.length) return json(503, { error: 'Enrollment is not set up yet.', missing: gaps });
		if (!/^cs_[A-Za-z0-9_]{10,250}$/.test(body.session_id)) return json(400, { error: 'Invalid checkout session.' });
		let session;
		try {
			session = await deps.stripe.checkout.sessions.retrieve(body.session_id);
		} catch {
			return json(404, { error: 'We could not find that payment.' });
		}
		if (session.metadata?.product !== 'ecg-basic-course' || session.payment_status !== 'paid') {
			return json(402, { error: 'This payment has not completed.' });
		}
		const student = await recordPayment(deps.db, session);
		await touchSignIn(deps.db, student.email);
		return json(200, { token: signToken('access', student.email, deps.secret), name: student.name, email: student.email });
	}

	if (typeof body.link_token === 'string') {
		const gaps = missing(deps, 'db', 'secret');
		if (gaps.length) return json(503, { error: 'Sign-in is not set up yet.', missing: gaps });
		const email = verifyToken(body.link_token, 'link', deps.secret);
		if (!email) return json(401, { error: 'This sign-in link has expired. Request a new one.' });
		const student = await findStudent(deps.db, email);
		if (!student?.paid_at) return json(403, { error: 'No enrollment was found for this email.' });
		await touchSignIn(deps.db, email);
		return json(200, { token: signToken('access', email, deps.secret), name: student.name, email });
	}

	return json(400, { error: 'Invalid request.' });
}

export default safe((req) => handle(req, getDeps()));
