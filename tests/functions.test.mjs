// Tests for the server functions, using in-memory stand-ins for Stripe,
// Supabase and email. Run with `npm test` (after `npm run build`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDeps, get, post } from './fakes.mjs';
import { signToken, verifyToken } from '../netlify/lib/tokens.mjs';
import { handle as createCheckout } from '../netlify/functions/create-checkout.mjs';
import { handle as webhook } from '../netlify/functions/stripe-webhook.mjs';
import { handle as claim } from '../netlify/functions/claim.mjs';
import { handle as requestLink } from '../netlify/functions/request-link.mjs';
import { handle as courseContent } from '../netlify/functions/course-content.mjs';
import { handle as certificate } from '../netlify/functions/certificate.mjs';
import { handle as verifyCert } from '../netlify/functions/verify-certificate.mjs';

const body = async (res) => [res.status, await res.json()];

/** Enroll a student end to end: checkout → pay → return to site. */
async function enroll(deps, name = 'Pat Student', email = 'Pat@Example.com') {
	const [, c] = await body(await createCheckout(post('/api/create-checkout', { name, email }), deps));
	const id = c.url.split('/').pop();
	deps.stripe.pay(id);
	const [status, r] = await body(await claim(post('/api/claim', { session_id: id }), deps));
	assert.equal(status, 200);
	return { id, token: r.token, claim: r };
}

test('tokens: sign, verify, kind, expiry and tampering', () => {
	const s = 'x'.repeat(32);
	const t = signToken('access', 'a@b.co', s);
	assert.equal(verifyToken(t, 'access', s), 'a@b.co');
	assert.equal(verifyToken(t, 'link', s), null, 'wrong kind');
	assert.equal(verifyToken(t, 'access', 'y'.repeat(32)), null, 'wrong secret');
	assert.equal(verifyToken(t.slice(0, -2) + 'AA', 'access', s), null, 'tampered');
	const link = signToken('link', 'a@b.co', s, Date.now() - 25 * 3600 * 1000);
	assert.equal(verifyToken(link, 'link', s), null, 'expired after 24h');
	assert.throws(() => signToken('access', 'a@b.co', 'short'));
});

test('create-checkout: $49 Stripe Checkout with name and email', async () => {
	const deps = fakeDeps();
	const [status, r] = await body(await createCheckout(post('/api/create-checkout', { name: ' Pat  Student ', email: 'PAT@example.com' }), deps));
	assert.equal(status, 200);
	assert.match(r.url, /^https:\/\/checkout\.stripe\.test\/cs_test_/);
	const s = deps.stripe.created[0];
	assert.equal(s.mode, 'payment');
	assert.equal(s.customer_email, 'pat@example.com');
	assert.equal(s.line_items[0].price_data.unit_amount, 4900);
	assert.equal(s.line_items[0].price_data.currency, 'usd');
	assert.deepEqual(s.metadata, { product: 'ecg-basic-course', student_name: 'Pat Student' });
	assert.equal(s.success_url, 'https://course.example.com/#welcome?session_id={CHECKOUT_SESSION_ID}');
	assert.equal(s.cancel_url, 'https://course.example.com/#enroll');
});

test('create-checkout: uses STRIPE_PRICE_ID when set; validates input; blocks double enrollment', async () => {
	const deps = fakeDeps({ priceId: 'price_123' });
	await createCheckout(post('/api/create-checkout', { name: 'A', email: 'a@b.co' }), deps);
	assert.deepEqual(deps.stripe.created[0].line_items[0], { price: 'price_123', quantity: 1 });
	assert.equal((await createCheckout(post('/api/create-checkout', { name: '', email: 'a@b.co' }), deps)).status, 400);
	assert.equal((await createCheckout(post('/api/create-checkout', { name: 'A', email: 'nope' }), deps)).status, 400);
	assert.equal((await createCheckout(get('/api/create-checkout'), deps)).status, 405);
	const d2 = fakeDeps();
	await enroll(d2);
	const [s, r] = await body(await createCheckout(post('/api/create-checkout', { name: 'Pat', email: 'pat@example.com' }), d2));
	assert.equal(s, 409);
	assert.equal(r.alreadyEnrolled, true);
});

test('not configured yet: clear 503 instead of a crash', async () => {
	const deps = fakeDeps({ stripe: null, db: null });
	const [s, r] = await body(await createCheckout(post('/api/create-checkout', { name: 'A', email: 'a@b.co' }), deps));
	assert.equal(s, 503);
	assert.ok(r.missing.includes('STRIPE_SECRET_KEY'));
});

test('claim: paid session records the student (name, email, payment) and returns an access token', async () => {
	const deps = fakeDeps();
	const { id, token, claim: r } = await enroll(deps);
	assert.equal(r.email, 'pat@example.com');
	assert.equal(r.name, 'Pat Student', 'name from the enroll form, not the card');
	assert.equal(verifyToken(token, 'access', deps.secret), 'pat@example.com');
	const row = deps.db.rows[0];
	assert.equal(deps.db.rows.length, 1);
	assert.ok(row.paid_at);
	assert.equal(row.amount_paid, 4900);
	assert.equal(row.stripe_checkout_session_id, id);
	assert.equal(row.stripe_customer_id, 'cus_123');
	assert.ok(row.last_sign_in_at);
	// Claiming again (page refresh) is fine and doesn't duplicate the record.
	assert.equal((await claim(post('/api/claim', { session_id: id }), deps)).status, 200);
	assert.equal(deps.db.rows.length, 1);
});

test('claim: unpaid, unknown or foreign sessions are refused', async () => {
	const deps = fakeDeps();
	const [, c] = await body(await createCheckout(post('/api/create-checkout', { name: 'A', email: 'a@b.co' }), deps));
	const id = c.url.split('/').pop();
	assert.equal((await claim(post('/api/claim', { session_id: id }), deps)).status, 402, 'not paid yet');
	assert.equal((await claim(post('/api/claim', { session_id: 'cs_test_doesnotexist123' }), deps)).status, 404);
	assert.equal((await claim(post('/api/claim', { session_id: 'not-a-session' }), deps)).status, 400);
	deps.stripe.pay(id);
	deps.stripe.sessions.get(id).metadata = { product: 'something-else' };
	assert.equal((await claim(post('/api/claim', { session_id: id }), deps)).status, 402, 'other product');
	assert.equal(deps.db.rows.length, 0);
});

test('webhook: verified checkout.session.completed records the student; bad signatures rejected', async () => {
	const deps = fakeDeps();
	const [, c] = await body(await createCheckout(post('/api/create-checkout', { name: 'Webhook Wendy', email: 'w@b.co' }), deps));
	const session = deps.stripe.pay(c.url.split('/').pop());
	const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: session } });
	assert.equal((await webhook(post('/api/stripe-webhook', event, { 'stripe-signature': 'forged' }), deps)).status, 400);
	assert.equal(deps.db.rows.length, 0);
	assert.equal((await webhook(post('/api/stripe-webhook', event, { 'stripe-signature': 'good:whsec_test' }), deps)).status, 200);
	assert.equal(deps.db.rows[0].name, 'Webhook Wendy');
	// The student then returns to the site: same record, no duplicate.
	assert.equal((await claim(post('/api/claim', { session_id: session.id }), deps)).status, 200);
	assert.equal(deps.db.rows.length, 1);
});

test('sign-in link: emailed only to enrolled students; same reply either way; link exchanges for access', async () => {
	const deps = fakeDeps();
	await enroll(deps);
	const [s1, r1] = await body(await requestLink(post('/api/request-link', { email: 'nobody@x.com' }), deps));
	assert.deepEqual([s1, r1], [200, { ok: true }]);
	assert.equal(deps.sent.length, 0, 'no email for unknown address');
	const [s2, r2] = await body(await requestLink(post('/api/request-link', { email: ' PAT@example.com ' }), deps));
	assert.deepEqual([s2, r2], [200, { ok: true }]);
	assert.equal(deps.sent.length, 1);
	assert.equal(deps.sent[0].to, 'pat@example.com');
	const link = deps.sent[0].text.match(/https:\/\/course\.example\.com\/#signin\?t=(\S+)/);
	assert.ok(link, 'email contains the sign-in link');
	assert.ok(deps.sent[0].html.includes('Hi Pat,'));
	const [s3, r3] = await body(await claim(post('/api/claim', { link_token: decodeURIComponent(link[1]) }), deps));
	assert.equal(s3, 200);
	assert.equal(verifyToken(r3.token, 'access', deps.secret), 'pat@example.com');
	// An access token can't be used as a link token, and vice versa.
	assert.equal((await claim(post('/api/claim', { link_token: r3.token }), deps)).status, 401);
});

test('course-content: full course for enrolled students only', async () => {
	const deps = fakeDeps();
	const data = { UNITS: [{ id: 'u1' }, { id: 'u2' }], version: 'v' };
	assert.equal((await courseContent(get('/api/course-content'), deps, data)).status, 401);
	assert.equal((await courseContent(get('/api/course-content', { authorization: 'Bearer junk' }), deps, data)).status, 401);
	const forged = signToken('access', 'pat@example.com', deps.secret);
	assert.equal((await courseContent(get('/api/course-content', { authorization: `Bearer ${forged}` }), deps, data)).status, 403, 'valid token but no payment on record');
	const { token } = await enroll(deps);
	const [s, r] = await body(await courseContent(get('/api/course-content', { authorization: `Bearer ${token}` }), deps, data));
	assert.equal(s, 200);
	assert.equal(r.course.UNITS.length, 2);
	assert.deepEqual(r.student, { name: 'Pat Student', email: 'pat@example.com', certificate: null });
});

test('course-content: the real build serves all 9 units', async () => {
	const deps = fakeDeps();
	const { token } = await enroll(deps);
	const [s, r] = await body(await courseContent(get('/api/course-content', { authorization: `Bearer ${token}` }), deps));
	assert.equal(s, 200);
	assert.equal(r.course.UNITS.length, 9);
	assert.ok(r.course.UNITS.every((u) => u.lessons.every((l) => l.blocks.length > 0)), 'every lesson has content');
});

test('certificate: tracks name, score and issue date; keeps first issue date; verification is public', async () => {
	const deps = fakeDeps();
	const { token } = await enroll(deps);
	const auth = { authorization: `Bearer ${token}` };
	assert.equal((await certificate(post('/api/certificate', { name: 'Pat Student', score: 76 }, auth), deps)).status, 400, 'below 80%');
	assert.equal((await certificate(post('/api/certificate', { name: '', score: 90 }, auth), deps)).status, 400);
	assert.equal((await certificate(post('/api/certificate', { name: 'Pat', score: 90 }), deps)).status, 401);
	const [s, r] = await body(await certificate(post('/api/certificate', { name: 'Pat Q. Student', score: 88 }, auth), deps));
	assert.equal(s, 200);
	const cert = r.student.certificate;
	assert.match(cert.id, /^[0-9a-f-]{36}$/);
	assert.equal(cert.name, 'Pat Q. Student');
	assert.equal(cert.score, 88);
	const row = deps.db.rows[0];
	assert.equal(row.certificate_name, 'Pat Q. Student');
	assert.ok(row.certificate_issued_at);
	const firstIssued = row.certificate_issued_at;
	await new Promise((res) => setTimeout(res, 5));
	const [, r2] = await body(await certificate(post('/api/certificate', { name: 'Pat Student', score: 84 }, auth), deps));
	assert.equal(r2.student.certificate.id, cert.id, 'same certificate ID');
	assert.equal(r2.student.certificate.score, 88, 'best score kept');
	assert.equal(r2.student.certificate.name, 'Pat Student', 'name can be corrected');
	assert.equal(deps.db.rows[0].certificate_issued_at, firstIssued, 'original issue date kept');

	const [vs, v] = await body(await verifyCert(get(`/api/verify-certificate?id=${cert.id}`), deps));
	assert.equal(vs, 200);
	assert.deepEqual({ ...v, issuedAt: !!v.issuedAt }, { valid: true, course: 'Basic ECG Interpretation', name: 'Pat Student', score: 88, issuedAt: true });
	assert.ok(!('email' in v), 'verification never reveals the email');
	assert.equal((await verifyCert(get('/api/verify-certificate?id=00000000-0000-0000-0000-000000000000'), deps)).status, 404);
	assert.equal((await verifyCert(get('/api/verify-certificate?id=bad'), deps)).status, 400);
});

import { explainError, safe } from '../netlify/lib/http.mjs';
test('setup errors come back as readable JSON', async () => {
	const res = await safe(async () => { const e = new Error('Invalid API Key provided: sk_test_****1234'); e.type = 'StripeAuthenticationError'; throw e; })(new Request('http://x/'));
	assert.equal(res.status, 500);
	const body = await res.json();
	assert.equal(body.code, 'stripe_key');
	assert.ok(!body.error.includes('1234'));
	assert.equal(explainError(new Error('findStudent: relation "public.ecg_course_students" does not exist')).code, 'db_table');
	assert.equal(explainError(new Error('findStudent: Invalid API key')).code, 'db_key');
	assert.equal(explainError(new Error('findStudent: TypeError: fetch failed')).code, 'db_url');
});

import { supabaseOrigin } from '../netlify/lib/deps.mjs';
test('SUPABASE_URL paste mistakes are corrected', () => {
	const want = 'https://abcdefghijklmnop.supabase.co';
	for (const v of [want, want + '/', want + '/rest/v1/', ' ' + want + '/rest/v1 ', 'abcdefghijklmnop.supabase.co', want + '/auth/v1',
		'https://supabase.com/dashboard/project/abcdefghijklmnop/settings/api'])
		assert.equal(supabaseOrigin(v), want, v);
	assert.equal(explainError(new Error('findStudent: Invalid path specified in request URL')).code, 'db_url');
});
