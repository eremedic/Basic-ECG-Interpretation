// Students join an instructor's class.
//   GET  /api/join-group?code=K7QM-3RXP       the class name and whether it has seats
//   POST /api/join-group { code, name, email } emails a link to confirm their email
//   POST /api/join-group { join_token }        (from that email) takes a seat and signs them in
import { getDeps, missing } from '../lib/deps.mjs';
import { cleanEmail, cleanName, json, readJson, safe } from '../lib/http.mjs';
import { cleanCode, findGroup, groupOpen, joinGroup } from '../lib/groups.mjs';
import { accessUntil, touchSignIn } from '../lib/students.mjs';
import { signToken, verifyTokenData } from '../lib/tokens.mjs';
import { brandEmail } from '../lib/email.mjs';

const NOT_FOUND = 'We couldn’t find that class code. Check it with your instructor.';

export function joinEmail(name, org, link) {
	return brandEmail({
		greeting: name ? `Hi ${name.split(' ')[0]},` : 'Hi,',
		paragraphs: [
			`You’re joining ${org || 'your class'} in the Basic ECG Interpretation course.`,
			'Use the button below to confirm your email and unlock the full course: one year of access, all 9 units, the final exam and the certificate. The link expires in 3 days.'
		],
		button: { label: 'Join the class', link },
		footer: 'If you didn’t ask to join this class, you can ignore this email.'
	});
}

export async function handle(req, deps) {
	const gaps = missing(deps, 'db', 'secret', 'siteUrl');
	if (gaps.length) return json(503, { error: 'Classes are not set up yet.', missing: gaps });

	if (req.method === 'GET') {
		const code = cleanCode(new URL(req.url).searchParams.get('code'));
		const g = code && (await findGroup(deps.db, { code }));
		if (!g) return json(404, { error: NOT_FOUND });
		return json(200, { org: g.org_name, instructor: g.owner_name, open: groupOpen(g), code: g.code });
	}
	if (req.method !== 'POST') return json(405, { error: 'Use GET or POST.' });
	const body = await readJson(req);
	if (!body) return json(400, { error: 'Invalid request.' });

	if (typeof body.join_token === 'string') {
		const t = verifyTokenData(body.join_token, 'join', deps.secret);
		if (!t || !t.data?.g) return json(401, { error: 'This join link has expired. Open your class link again to get a new one.' });
		const g = await findGroup(deps.db, { id: t.data.g });
		if (!g) return json(404, { error: NOT_FOUND });
		const r = await joinGroup(deps.db, g, t.email, String(t.data.n || '').slice(0, 120));
		if (r.error) return json(r.status, { error: r.error });
		await touchSignIn(deps.db, t.email);
		return json(200, {
			token: signToken('access', t.email, deps.secret), name: r.student.name, email: t.email,
			org: g.org_name, seatUsed: r.seatUsed, accessUntil: accessUntil(r.student)?.toISOString() ?? null
		});
	}

	const code = cleanCode(body.code);
	const email = cleanEmail(body.email);
	const name = cleanName(body.name, 120);
	if (!code) return json(400, { error: 'Enter the class code from your instructor (8 letters and numbers).' });
	if (!email || !name) return json(400, { error: 'Please enter your name and a valid email address.' });
	const g = await findGroup(deps.db, { code });
	if (!g) return json(404, { error: NOT_FOUND });
	if (!groupOpen(g)) return json(410, { error: 'This class has no seats available right now. Ask your instructor to add more.' });
	const link = `${deps.siteUrl}/#join?t=${encodeURIComponent(signToken('join', email, deps.secret, Date.now(), { g: g.id, n: name }))}`;
	const { html, text } = joinEmail(name, g.org_name, link);
	try {
		await deps.sendEmail({ to: email, subject: `Join ${g.org_name || 'your class'}: Basic ECG Interpretation`, html, text });
	} catch (e) {
		console.error('join-group email failed:', e.message);
		return json(502, { error: 'We could not send the email right now. Please try again shortly.' });
	}
	return json(200, { ok: true });
}

export default safe((req) => handle(req, getDeps()));
