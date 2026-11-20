// POST /api/login  { email, password }
// Signs a student in with their password and returns the browser's access
// token. A wrong email and a wrong password get the same answer.
import { getDeps, missing } from '../lib/deps.mjs';
import { cleanEmail, json, readJson, safe } from '../lib/http.mjs';
import { accessUntil, findStudent, hasAccess, touchSignIn } from '../lib/students.mjs';
import { monitorActive } from '../lib/monitor.mjs';
import { clearFailedPasswords, LOCK_MINUTES, lockedOut, recordFailedPassword, verifyPassword } from '../lib/passwords.mjs';
import { signToken } from '../lib/tokens.mjs';

const WRONG = 'Email or password is incorrect. Haven’t set a password yet, or forgot it? Use “Email me a link” below.';

export async function handle(req, deps) {
	if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
	const gaps = missing(deps, 'db', 'secret');
	if (gaps.length) return json(503, { error: 'Sign-in is not set up yet.', missing: gaps });
	const body = await readJson(req);
	const email = cleanEmail(body?.email);
	const password = typeof body?.password === 'string' ? body.password : '';
	if (!email || !password) return json(400, { error: 'Enter your email and password.' });

	const student = await findStudent(deps.db, email);
	if (student && lockedOut(student)) {
		return json(429, { error: `Too many wrong passwords. Try again in ${LOCK_MINUTES} minutes, or use “Email me a link” below to reset it.` });
	}
	const ok = verifyPassword(password, student?.password_hash); // always runs, for even timing
	if (!student || !ok) {
		if (student?.password_hash) await recordFailedPassword(deps.db, student);
		return json(401, { error: WRONG });
	}
	await clearFailedPasswords(deps.db, student);
	if (!hasAccess(student) && !monitorActive(student) && !student.is_instructor) {
		if (student.paid_at) return json(403, { expired: true, accessUntil: accessUntil(student).toISOString(), error: 'Your one-year access has ended. Enroll again to renew it.' });
		return json(403, { error: 'Your Lab subscription has ended. Subscribe again to continue.' });
	}
	await touchSignIn(deps.db, email);
	return json(200, { token: signToken('access', email, deps.secret), name: student.name, email });
}

export default safe((req) => handle(req, getDeps()));
