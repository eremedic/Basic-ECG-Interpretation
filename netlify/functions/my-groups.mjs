// GET /api/my-groups  (Authorization: Bearer <access token>)
// The instructor's classes: join link, seats, and each student's progress
// (when they joined, access dates, certificate).
import { getDeps, missing } from '../lib/deps.mjs';
import { bearer, json, safe } from '../lib/http.mjs';
import { groupMembers, groupsOwnedBy, groupView } from '../lib/groups.mjs';
import { verifyToken } from '../lib/tokens.mjs';

export async function handle(req, deps) {
	if (req.method !== 'GET') return json(405, { error: 'Use GET.' });
	const gaps = missing(deps, 'db', 'secret', 'siteUrl');
	if (gaps.length) return json(503, { error: 'Classes are not set up yet.', missing: gaps });
	const email = verifyToken(bearer(req), 'access', deps.secret);
	if (!email) return json(401, { error: 'Please sign in again.' });
	const groups = await groupsOwnedBy(deps.db, email);
	const out = [];
	for (const g of groups) out.push(groupView(g, await groupMembers(deps.db, g.id), deps.siteUrl));
	return json(200, { groups: out, seatCents: deps.seatCents, minSeats: deps.minSeats || 5 });
}

export default safe((req) => handle(req, getDeps()));
