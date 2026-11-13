// Small helpers shared by the functions.

export function json(status, body) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
	});
}

export async function readJson(req, limit = 4096) {
	const text = await req.text();
	if (text.length > limit) return null;
	try {
		const v = JSON.parse(text);
		return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
	} catch {
		return null;
	}
}

export function bearer(req) {
	const h = req.headers.get('authorization') || '';
	return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

export function cleanEmail(v) {
	if (typeof v !== 'string') return null;
	const e = v.trim().toLowerCase();
	return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function cleanName(v, max = 80) {
	if (typeof v !== 'string') return '';
	return v.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turn an unexpected error into a JSON answer that says which part of the setup
 * failed (Stripe, the database, email), without exposing any secret. The full
 * error goes to the function log (Netlify → Logs → Functions).
 */
export function explainError(err) {
	const msg = String(err?.message || err || '');
	const type = String(err?.type || err?.rawType || '');
	if (type === 'StripeAuthenticationError' || /Invalid API Key provided/.test(msg))
		return { code: 'stripe_key', error: 'Payment setup problem: Stripe rejected the secret key. Check STRIPE_SECRET_KEY in Netlify (it should start with sk_test_ or sk_live_), then redeploy.' };
	if (type === 'StripePermissionError')
		return { code: 'stripe_permission', error: 'Payment setup problem: the Stripe key doesn’t have permission for Checkout. Use the standard Secret key (sk_…), not a restricted key (rk_…).' };
	if (type === 'StripeConnectionError')
		return { code: 'stripe_timeout', error: 'Payment setup problem: Stripe didn’t answer in time. Please try again in a moment.' };
	if (type.startsWith('Stripe'))
		return { code: 'stripe', error: 'Payment setup problem (Stripe): ' + msg };
	if (/access_expires_at/.test(msg))
		return { code: 'db_migration', error: 'Database setup problem: the access_expires_at column is missing. Run supabase/migrations/0002_one_year_access.sql in the Supabase SQL Editor.' };
	if (/does not exist|schema cache|ecg_course_students/i.test(msg) && /relation|table|schema/i.test(msg))
		return { code: 'db_table', error: 'Database setup problem: the ecg_course_students table wasn’t found. Run supabase/migrations/0001_ecg_course_students.sql in the Supabase SQL Editor of the project in SUPABASE_URL.' };
	if (/Invalid API key|JWT|apikey|permission denied|No API key/i.test(msg))
		return { code: 'db_key', error: 'Database setup problem: Supabase rejected the key. SUPABASE_SERVICE_ROLE_KEY must be the secret / service_role key (not the anon or publishable key) from the same project as SUPABASE_URL.' };
	if (/TimeoutError|aborted due to timeout/i.test(msg))
		return { code: 'db_timeout', error: 'Database setup problem: Supabase didn’t answer in time. Check SUPABASE_URL, and that the Supabase project isn’t paused (Supabase pauses free projects after a week without use).' };
	if (/fetch failed|ENOTFOUND|getaddrinfo|Invalid URL|invalid url|Invalid supabaseUrl|supabaseUrl is required|Invalid path specified/i.test(msg))
		return { code: 'db_url', error: 'Database setup problem: couldn’t reach Supabase. Check SUPABASE_URL (it looks like https://abcd1234.supabase.co, no extra path).' };
	if (/find|record|touch|issue/i.test(msg) && /Student|Payment|SignIn|Certificate/.test(msg))
		return { code: 'db', error: 'Database problem: ' + msg.replace(/^\w+( \w+)?: /, '') };
	return { code: 'server', error: 'Server error. Details are in Netlify → Logs → Functions.' };
}

/** Wrap a handler so failures come back as readable JSON instead of a blank 500. */
export function safe(handler) {
	return async (req) => {
		try {
			return await handler(req);
		} catch (err) {
			console.error(err);
			return json(500, explainError(err));
		}
	};
}
