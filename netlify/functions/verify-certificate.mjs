// GET /api/verify-certificate?id=<certificate id>
// Lets anyone (an employer, an instructor) confirm a certificate is genuine.
// Returns only the name on the certificate, the date and the score.
import { getDeps, missing } from '../lib/deps.mjs';
import { UUID_RE, json, safe } from '../lib/http.mjs';
import { findCertificate } from '../lib/students.mjs';

export async function handle(req, deps) {
	if (req.method !== 'GET') return json(405, { error: 'Use GET.' });
	if (missing(deps, 'db').length) return json(503, { error: 'Verification is not set up yet.' });
	const id = new URL(req.url).searchParams.get('id') || '';
	if (!UUID_RE.test(id)) return json(400, { valid: false, error: 'That is not a valid certificate ID.' });
	const c = await findCertificate(deps.db, id.toLowerCase());
	if (!c) return json(404, { valid: false });
	return json(200, {
		valid: true,
		course: 'Basic ECG Interpretation',
		name: c.certificate_name,
		score: c.certificate_score,
		issuedAt: c.certificate_issued_at
	});
}

export default safe((req) => handle(req, getDeps()));
