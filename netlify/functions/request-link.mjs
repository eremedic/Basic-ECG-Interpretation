// POST /api/request-link  { email }
// Emails an enrolled student a sign-in link (for a new device or browser).
// Always answers the same way, so it can't reveal who is enrolled.
import { getDeps, missing } from '../lib/deps.mjs';
import { cleanEmail, json, readJson, safe } from '../lib/http.mjs';
import { findStudent, hasAccess } from '../lib/students.mjs';
import { signToken } from '../lib/tokens.mjs';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function signInEmail(name, link) {
	const hi = name ? `Hi ${esc(name.split(' ')[0])},` : 'Hi,';
	const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f7fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e2e7f0;border-radius:14px;">
<tr><td style="height:6px;background:#1b2a5b;border-radius:14px 14px 0 0;font-size:0;">&nbsp;</td></tr>
<tr><td align="center" style="padding:26px 30px 6px;font-family:Arial,Helvetica,sans-serif;"><span style="font-size:28px;font-weight:900;"><span style="color:#1b2a5b;">CS</span><span style="color:#1b7a8c;">Health</span><span style="color:#e0262b;">ED</span></span><br><span style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#5b6684;">Basic ECG Interpretation</span></td></tr>
<tr><td style="padding:18px 30px 0;font-family:Arial,Helvetica,sans-serif;color:#18213a;font-size:16px;line-height:1.6;"><p style="margin:0 0 12px;">${hi}</p><p style="margin:0 0 20px;">Use the button below to sign in to your course on this device. The link works once and expires in 24 hours.</p></td></tr>
<tr><td align="center" style="padding:0 30px 22px;"><a href="${esc(link)}" style="display:inline-block;padding:14px 30px;background:#e0262b;color:#fff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;text-decoration:none;border-radius:10px;">Sign in to my course</a></td></tr>
<tr><td style="padding:0 30px 26px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5b6684;line-height:1.5;">If you didn’t ask to sign in, you can ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
	const text = `${hi}\n\nSign in to your Basic ECG Interpretation course: ${link}\n\nThe link works once and expires in 24 hours. If you didn't ask to sign in, ignore this email.`;
	return { html, text };
}

export async function handle(req, deps) {
	if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
	const gaps = missing(deps, 'db', 'secret', 'siteUrl');
	if (gaps.length) return json(503, { error: 'Sign-in is not set up yet.', missing: gaps });
	const email = cleanEmail((await readJson(req))?.email);
	if (!email) return json(400, { error: 'Please enter a valid email address.' });
	const student = await findStudent(deps.db, email);
	if (hasAccess(student)) {
		const link = `${deps.siteUrl}/#signin?t=${encodeURIComponent(signToken('link', email, deps.secret))}`;
		const { html, text } = signInEmail(student.name, link);
		try {
			await deps.sendEmail({ to: email, subject: 'Your Basic ECG Interpretation sign-in link', html, text });
		} catch (e) {
			console.error('request-link email failed:', e.message);
			return json(502, { error: 'We could not send the email right now. Please try again shortly.' });
		}
	}
	return json(200, { ok: true });
}

export default safe((req) => handle(req, getDeps()));
