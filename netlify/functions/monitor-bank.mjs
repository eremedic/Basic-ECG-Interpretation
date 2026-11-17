// GET /api/monitor-bank  (Authorization: Bearer <access token>)
// All 300 Live Monitor strips, for students with an active subscription. The
// public site only contains the free strips (the first 5 in each category).
import { getDeps, missing } from '../lib/deps.mjs';
import { bearer, json, safe } from '../lib/http.mjs';
import { findStudent } from '../lib/students.mjs';
import { verifyToken } from '../lib/tokens.mjs';
import { monitorActive, monitorView } from '../lib/monitor.mjs';
import bank from '../data/monitor-full.json' with { type: 'json' };

export async function handle(req, deps, data = bank) {
	if (req.method !== 'GET') return json(405, { error: 'Use GET.' });
	const gaps = missing(deps, 'db', 'secret');
	if (gaps.length) return json(503, { error: 'The Live Monitor is not set up yet.', missing: gaps });
	const email = verifyToken(bearer(req), 'access', deps.secret);
	if (!email) return json(401, { error: 'Please sign in again.' });
	const student = await findStudent(deps.db, email);
	if (!monitorActive(student)) return json(403, { monitor: monitorView(student), error: 'A Live Monitor subscription is needed for these strips.' });
	return json(200, { bank: data });
}

export default safe((req) => handle(req, getDeps()));
