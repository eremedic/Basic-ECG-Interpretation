// Student records in Supabase (table ecg_course_students; see supabase/migrations).
// `db` is a Supabase client created with the service-role key.

const TABLE = 'ecg_course_students';

/** Each enrollment gives one year of access. */
export const ACCESS_DAYS = 365;
/** Students may renew once fewer than this many days remain. */
export const RENEW_WINDOW_DAYS = 30;
const DAY = 24 * 3600 * 1000;

/** When the student's access ends (null if never paid). */
export function accessUntil(s, now = Date.now()) {
	if (!s?.paid_at) return null;
	if (s.access_expires_at) return new Date(s.access_expires_at);
	return new Date(new Date(s.paid_at).getTime() + ACCESS_DAYS * DAY); // before migration 0002
}
export function hasAccess(s, now = Date.now()) {
	const until = accessUntil(s, now);
	return !!until && until.getTime() > now;
}
export function canRenew(s, now = Date.now()) {
	const until = accessUntil(s, now);
	return !until || until.getTime() - now < RENEW_WINDOW_DAYS * DAY;
}

export async function findStudent(db, email) {
	const { data, error } = await db.from(TABLE).select('*').eq('email', email).maybeSingle();
	if (error) throw new Error(`findStudent: ${error.message}`);
	return data;
}

/**
 * Record a paid Stripe Checkout session (idempotent; safe to call twice).
 * A new payment gives a year of access from now, or from the current end
 * date when renewing before it.
 */
export async function recordPayment(db, session) {
	const email = String(session.customer_details?.email || session.customer_email || '').trim().toLowerCase();
	if (!email) throw new Error('recordPayment: session has no email');
	const name = String(session.metadata?.student_name || session.customer_details?.name || '').trim().slice(0, 120);
	const existing = await findStudent(db, email);
	const payment = {
		amount_paid: session.amount_total ?? null,
		currency: session.currency ?? null,
		stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
		stripe_checkout_session_id: session.id
	};
	const now = Date.now();
	if (existing) {
		if (existing.stripe_checkout_session_id === session.id) {
			// Already recorded (webhook and return page both report the same payment).
			return { ...existing };
		}
		const current = hasAccess(existing, now) ? accessUntil(existing, now).getTime() : now;
		const update = {
			...payment,
			paid_at: new Date(now).toISOString(),
			access_expires_at: new Date(current + ACCESS_DAYS * DAY).toISOString()
		};
		if (!existing.name && name) update.name = name;
		const { data, error } = await db.from(TABLE).update(update).eq('email', email).select().single();
		if (error) throw new Error(`recordPayment update: ${error.message}`);
		return data;
	}
	const { data, error } = await db
		.from(TABLE)
		.insert({
			email,
			name,
			paid_at: new Date(now).toISOString(),
			access_expires_at: new Date(now + ACCESS_DAYS * DAY).toISOString(),
			...payment
		})
		.select()
		.single();
	if (error) throw new Error(`recordPayment insert: ${error.message}`);
	return data;
}

export async function touchSignIn(db, email) {
	await db.from(TABLE).update({ last_sign_in_at: new Date().toISOString() }).eq('email', email);
}

/** Issue the certificate, or update the name/score on one already issued. */
export async function issueCertificate(db, student, name, score, newId) {
	const update = {
		certificate_name: name,
		certificate_score: Math.max(score, student.certificate_score ?? 0),
		certificate_id: student.certificate_id || newId,
		certificate_issued_at: student.certificate_issued_at || new Date().toISOString()
	};
	const { data, error } = await db.from(TABLE).update(update).eq('email', student.email).select().single();
	if (error) throw new Error(`issueCertificate: ${error.message}`);
	return data;
}

export async function findCertificate(db, id) {
	const { data, error } = await db
		.from(TABLE)
		.select('certificate_id,certificate_name,certificate_score,certificate_issued_at')
		.eq('certificate_id', id)
		.maybeSingle();
	if (error) throw new Error(`findCertificate: ${error.message}`);
	return data;
}
