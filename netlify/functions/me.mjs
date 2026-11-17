// GET /api/me  (Authorization: Bearer <access token>)
// The signed-in student's record: name, email, course access, Live Monitor
// subscription and certificate. Works for course students and subscribers.
import { getDeps, missing } from '../lib/deps.mjs';
import { bearer, json, safe } from '../lib/http.mjs';
import { findStudent } from '../lib/students.mjs';
import { verifyToken } from '../lib/tokens.mjs';
import { studentView } from './course-content.mjs';

export async function handle(req, deps) {
	if (req.method !== 'GET') return json(405, { error: 'Use GET.' });
	const gaps = missing(deps, 'db', 'secret');
	if (gaps.length) return json(503, { error: 'Accounts are not set up yet.', missing: gaps });
	const email = verifyToken(bearer(req), 'access', deps.secret);
	if (!email) return json(401, { error: 'Please sign in again.' });
	const student = await findStudent(deps.db, email);
	if (!student) return json(401, { error: 'Please sign in again.' });
	return json(200, { student: studentView(student) });
}

export default safe((req) => handle(req, getDeps()));
