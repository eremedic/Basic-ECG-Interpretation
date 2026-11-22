// GET /api/lab-bank?part=<area|codelab>  (Authorization: Bearer <access token>)
// The Cardiac Lab practice strips (one area at a time) and the Code lab cases, for students
// with an active Live Monitor subscription. The public site only has the free preview
// (the first strips of each area and the free Code lab cases). Built by scripts/build-lab.mjs.
import { getDeps, missing } from '../lib/deps.mjs';
import { bearer, json, safe } from '../lib/http.mjs';
import { findStudent } from '../lib/students.mjs';
import { verifyToken } from '../lib/tokens.mjs';
import { monitorActive, monitorView } from '../lib/monitor.mjs';
import bank from '../data/lab-full.json' with { type: 'json' };

export async function handle(req, deps, data = bank) {
	if (req.method !== 'GET') return json(405, { error: 'Use GET.' });
	const part = new URL(req.url).searchParams.get('part') || '';
	const found = part === 'codelab' ? data.codelab : (/^[a-z]{2,20}$/.test(part) && Object.hasOwn(data.areas || {}, part) ? data.areas[part] : null);
	if (!found) return json(404, { error: 'No such part of the Lab.' });
	const gaps = missing(deps, 'db', 'secret');
	if (gaps.length) return json(503, { error: 'The Lab is not set up yet.', missing: gaps });
	const email = verifyToken(bearer(req), 'access', deps.secret);
	if (!email) return json(401, { error: 'Please sign in again.' });
	const student = await findStudent(deps.db, email);
	if (!monitorActive(student)) return json(403, { monitor: monitorView(student), error: 'A Live Monitor subscription is needed for the full Lab.' });
	return json(200, { part, data: found });
}

export default safe((req) => handle(req, getDeps()));
