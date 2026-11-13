// GET /api/course-content  (Authorization: Bearer <access token>)
// The full course (all units) for an enrolled student, plus their record:
// name, email and certificate. The public site only contains Unit 1.
import { getDeps, missing } from '../lib/deps.mjs';
import { bearer, json } from '../lib/http.mjs';
import { findStudent } from '../lib/students.mjs';
import { verifyToken } from '../lib/tokens.mjs';
import course from '../data/course-full.json' with { type: 'json' };

export function studentView(s) {
	return {
		name: s.name,
		email: s.email,
		certificate: s.certificate_id
			? { id: s.certificate_id, name: s.certificate_name, score: s.certificate_score, issuedAt: s.certificate_issued_at }
			: null
	};
}

export async function handle(req, deps, data = course) {
	if (req.method !== 'GET') return json(405, { error: 'Use GET.' });
	const gaps = missing(deps, 'db', 'secret');
	if (gaps.length) return json(503, { error: 'The course is not set up yet.', missing: gaps });
	const email = verifyToken(bearer(req), 'access', deps.secret);
	if (!email) return json(401, { error: 'Please sign in again.' });
	const student = await findStudent(deps.db, email);
	if (!student?.paid_at) return json(403, { error: 'No enrollment was found for this account.' });
	return json(200, { course: data, student: studentView(student) });
}

export default (req) => handle(req, getDeps());
