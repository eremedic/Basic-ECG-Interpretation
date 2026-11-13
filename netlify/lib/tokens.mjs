import crypto from 'node:crypto';

// Signed tokens (HMAC-SHA256). Two kinds:
//   access: kept by the student's browser; proves they enrolled (1 year)
//   link:   inside a sign-in email; exchanged for an access token (24 hours)

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const LIFETIME = { access: 365 * 24 * 3600, link: 24 * 3600 };

export function signToken(kind, email, secret, now = Date.now()) {
	if (!secret || secret.length < 16) throw new Error('ACCESS_TOKEN_SECRET is missing or too short');
	const body = b64url(JSON.stringify({ k: kind, e: email, x: Math.floor(now / 1000) + LIFETIME[kind] }));
	const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
	return `${body}.${sig}`;
}

/** Returns the email inside a valid, unexpired token of this kind, else null. */
export function verifyToken(token, kind, secret, now = Date.now()) {
	if (typeof token !== 'string' || !secret) return null;
	const [body, sig] = token.split('.');
	if (!body || !sig) return null;
	const expected = crypto.createHmac('sha256', secret).update(body).digest();
	const given = Buffer.from(sig, 'base64url');
	if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
	try {
		const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
		if (p.k !== kind || typeof p.e !== 'string' || p.x * 1000 < now) return null;
		return p.e;
	} catch {
		return null;
	}
}
