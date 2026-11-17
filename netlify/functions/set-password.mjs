// POST /api/set-password  (Authorization: Bearer <access token>)
//   { password }                     create the first password (none set yet)
//   { password, current_password }   change it
//   { password, link_token }         reset it, using the token from a sign-in email
import { getDeps, missing } from '../lib/deps.mjs';
import { bearer, json, readJson, safe } from '../lib/http.mjs';
import { findStudent } from '../lib/students.mjs';
import { passwordProblem, savePassword, verifyPassword } from '../lib/passwords.mjs';
import { verifyToken } from '../lib/tokens.mjs';

export async function handle(req, deps) {
	if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
	const gaps = missing(deps, 'db', 'secret');
	if (gaps.length) return json(503, { error: 'Accounts are not set up yet.', missing: gaps });
	const email = verifyToken(bearer(req), 'access', deps.secret);
	if (!email) return json(401, { error: 'Please sign in again.' });
	const body = await readJson(req);
	if (!body) return json(400, { error: 'Invalid request.' });
	const problem = passwordProblem(body.password);
	if (problem) return json(400, { error: problem });
	const student = await findStudent(deps.db, email);
	if (!student) return json(401, { error: 'Please sign in again.' });

	if (student.password_hash) {
		const viaLink = typeof body.link_token === 'string' && verifyToken(body.link_token, 'link', deps.secret) === email;
		const viaCurrent = typeof body.current_password === 'string' && verifyPassword(body.current_password, student.password_hash);
		if (!viaLink && !viaCurrent) {
			return json(403, {
				error: typeof body.current_password === 'string'
					? 'Your current password is incorrect.'
					: 'Enter your current password, or use “Forgot password?” to get a reset link.'
			});
		}
	}
	await savePassword(deps.db, email, body.password);
	return json(200, { ok: true });
}

export default safe((req) => handle(req, getDeps()));
