// Password hashing with scrypt (built into Node), plus the rules for a valid
// password and the wrong-password lockout. Only the hash is ever stored.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const TABLE = 'ecg_course_students';
const N = 16384, R = 8, P = 1, LEN = 64, MAXMEM = 64 * 1024 * 1024;
export const MIN_LEN = 8, MAX_LEN = 128;
export const MAX_FAILS = 10, LOCK_MINUTES = 15;

/** Why a new password isn't acceptable, or null if it's fine. */
export function passwordProblem(pw) {
	if (typeof pw !== 'string' || pw.length < MIN_LEN) return `Use at least ${MIN_LEN} characters.`;
	if (pw.length > MAX_LEN) return `Use at most ${MAX_LEN} characters.`;
	if (!pw.trim()) return 'The password can’t be only spaces.';
	return null;
}

export function hashPassword(pw) {
	const salt = randomBytes(16);
	const hash = scryptSync(pw.normalize('NFKC'), salt, LEN, { N, r: R, p: P, maxmem: MAXMEM });
	return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

// Checked against when there's no stored hash, so an unknown email takes as long as a wrong password.
const DUMMY = hashPassword('not-a-real-password');

export function verifyPassword(pw, stored) {
	const parts = String(stored || DUMMY).split('$');
	if (parts.length !== 6 || parts[0] !== 'scrypt' || typeof pw !== 'string' || pw.length > MAX_LEN) return false;
	const [, n, r, p, salt, hash] = parts;
	const want = Buffer.from(hash, 'base64');
	const got = scryptSync(pw.normalize('NFKC'), Buffer.from(salt, 'base64'), want.length, { N: +n, r: +r, p: +p, maxmem: MAXMEM });
	return !!stored && got.length === want.length && timingSafeEqual(got, want);
}

export function lockedOut(s, now = Date.now()) {
	return !!(s?.password_locked_until && new Date(s.password_locked_until).getTime() > now);
}

export async function savePassword(db, email, pw) {
	const { error } = await db.from(TABLE)
		.update({ password_hash: hashPassword(pw), password_set_at: new Date().toISOString(), password_failed_count: 0, password_locked_until: null })
		.eq('email', email);
	if (error) throw new Error(`savePassword: ${error.message}`);
}

export async function recordFailedPassword(db, s) {
	const count = (s.password_failed_count || 0) + 1;
	const update = count >= MAX_FAILS
		? { password_failed_count: 0, password_locked_until: new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() }
		: { password_failed_count: count };
	await db.from(TABLE).update(update).eq('email', s.email);
}

export async function clearFailedPasswords(db, s) {
	if (s.password_failed_count || s.password_locked_until) {
		await db.from(TABLE).update({ password_failed_count: 0, password_locked_until: null }).eq('email', s.email);
	}
}
