// POST /api/certificate  { name, score }  (Authorization: Bearer <access token>)
// Records the student's certificate of completion (name and date issued) and
// returns its verification code. Requires a passing final exam score.
import crypto from 'node:crypto';
import { getDeps, missing } from '../lib/deps.mjs';
import { bearer, cleanName, json, readJson, safe } from '../lib/http.mjs';
import { findStudent, hasAccess, issueCertificate } from '../lib/students.mjs';
import { verifyToken } from '../lib/tokens.mjs';
import { studentView } from './course-content.mjs';

const PASS = 80;

export async function handle(req, deps) {
	if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
	const gaps = missing(deps, 'db', 'secret');
	if (gaps.length) return json(503, { error: 'Certificates are not set up yet.', missing: gaps });
	const email = verifyToken(bearer(req), 'access', deps.secret);
	if (!email) return json(401, { error: 'Please sign in again.' });
	const body = await readJson(req);
	const name = cleanName(body?.name, 80);
	const score = Number.isInteger(body?.score) ? body.score : NaN;
	if (!name) return json(400, { error: 'Enter your name as it should appear on the certificate.' });
	if (!(score >= PASS && score <= 100)) return json(400, { error: `A final exam score of ${PASS}% or higher is required.` });
	const student = await findStudent(deps.db, email);
	if (!student?.paid_at) return json(403, { error: 'No enrollment was found for this account.' });
	if (!hasAccess(student)) return json(403, { expired: true, error: 'Your one-year access has ended. Enroll again to renew it.' });
	const updated = await issueCertificate(deps.db, student, name, score, crypto.randomUUID());
	return json(200, { student: studentView(updated) });
}

export default safe((req) => handle(req, getDeps()));
