// POST /api/claim  { session_id }  or  { link_token }
// Exchanges proof of enrollment for the browser's access token:
//   session_id  the Stripe Checkout session the student just paid with
//   link_token  the token from a sign-in email
import { getDeps, missing } from '../lib/deps.mjs';
import { json, readJson, safe } from '../lib/http.mjs';
import { accessUntil, findStudent, hasAccess, recordPayment, touchSignIn } from '../lib/students.mjs';
import { MONITOR_PRODUCT, monitorActive, monitorSessionComplete, recordMonitorCheckout } from '../lib/monitor.mjs';
import { signToken, verifyToken } from '../lib/tokens.mjs';
import { GROUP_PRODUCT, groupComplete, recordGroupPurchase } from '../lib/groups.mjs';

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
		if (session.metadata?.product === MONITOR_PRODUCT) {
			if (!monitorSessionComplete(session)) return json(402, { error: 'This subscription has not started yet.' });
			const sub = await recordMonitorCheckout(deps.stripe, deps.db, session);
			await touchSignIn(deps.db, sub.email);
			return json(200, { token: signToken('access', sub.email, deps.secret), name: sub.name, email: sub.email, product: 'monitor' });
		}
		if (session.metadata?.product === GROUP_PRODUCT) {
			if (!groupComplete(session)) return json(402, { error: 'This payment has not completed.' });
			const { group, owner } = await recordGroupPurchase(deps.db, session);
			await touchSignIn(deps.db, owner.email);
			return json(200, { token: signToken('access', owner.email, deps.secret), name: owner.name, email: owner.email, product: 'group', groupId: group.id });
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
		if (!student || (!student.paid_at && !student.monitor_status && !student.is_instructor)) return json(403, { error: 'No enrollment or subscription was found for this email.' });
		if (!hasAccess(student) && !monitorActive(student) && !student.is_instructor) {
			if (student.paid_at) return json(403, { expired: true, accessUntil: accessUntil(student).toISOString(), error: 'Your one-year access has ended. Enroll again to renew it.' });
			return json(403, { error: 'Your Live Monitor subscription has ended. Subscribe again to continue.' });
		}
		await touchSignIn(deps.db, email);
		return json(200, { token: signToken('access', email, deps.secret), name: student.name, email });
	}

	return json(400, { error: 'Invalid request.' });
}

export default safe((req) => handle(req, getDeps()));
