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
import { handle as login } from '../netlify/functions/login.mjs';
import { handle as setPassword } from '../netlify/functions/set-password.mjs';

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
	const { accessUntil, canRenew, course: crs, monitor, ...rest } = r.student;
	assert.equal(crs.active, true);
	assert.equal(monitor.active, false);
	assert.deepEqual(rest, { name: 'Pat Student', email: 'pat@example.com', hasPassword: false, instructor: false, certificate: null });
	const days = (new Date(accessUntil) - Date.now()) / 86400000;
	assert.ok(days > 364 && days <= 365, 'one year of access');
	assert.equal(canRenew, false);
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

import { siteOrigin } from '../netlify/lib/deps.mjs';
test('SITE_URL gets a scheme and loses extras', () => {
	for (const v of ['ecg.netlify.app', 'https://ecg.netlify.app/', ' ecg.netlify.app/#home', 'http://ecg.netlify.app'.replace('http:', 'https:')])
		assert.equal(siteOrigin(v), 'https://ecg.netlify.app', v);
	assert.equal(siteOrigin(''), '');
	assert.equal(siteOrigin('nonsense'), '');
});

test('create-checkout: branded image, custom text, optional terms consent', async () => {
	const deps = fakeDeps();
	await createCheckout(post('/api/create-checkout', { name: 'A B', email: 'a@b.co' }), deps);
	const s = deps.stripe.created[0];
	assert.deepEqual(s.line_items[0].price_data.product_data.images, ['https://course.example.com/assets/stripe-course.png']);
	assert.match(s.custom_text.submit.message, /\(https:\/\/course\.example\.com\/#terms\)/);
	assert.ok(s.custom_text.submit.message.length <= 1200);
	assert.equal(s.consent_collection, undefined);
	assert.equal(s.custom_text.terms_of_service_acceptance, undefined);
	const d2 = fakeDeps({ requireTerms: true });
	await createCheckout(post('/api/create-checkout', { name: 'A B', email: 'c@d.co' }), d2);
	assert.deepEqual(d2.stripe.created[0].consent_collection, { terms_of_service: 'required' });
	assert.match(d2.stripe.created[0].custom_text.terms_of_service_acceptance.message, /#terms/);
});

test('one-year access: expires, blocks content and sign-in links, and renews', async () => {
	const deps = fakeDeps();
	const { token } = await enroll(deps);
	const row = deps.db.rows[0];
	const auth = { authorization: `Bearer ${token}` };
	// Already enrolled with most of the year left: no second purchase.
	assert.equal((await createCheckout(post('/api/create-checkout', { name: 'Pat', email: 'pat@example.com' }), deps)).status, 409);

	// The year runs out.
	row.access_expires_at = new Date(Date.now() - 1000).toISOString();
	const [s1, r1] = await body(await courseContent(get('/api/course-content', auth), deps, { UNITS: [] }));
	assert.equal(s1, 403);
	assert.equal(r1.expired, true);
	assert.equal((await certificate(post('/api/certificate', { name: 'Pat', score: 90 }, auth), deps)).status, 403);
	const sent = deps.sent.length;
	await requestLink(post('/api/request-link', { email: 'pat@example.com' }), deps);
	assert.equal(deps.sent.length, sent, 'no sign-in email once access has ended');

	// Renew: a new payment gives a fresh year.
	const { token: t2 } = await enroll(deps);
	assert.equal(deps.db.rows.length, 1, 'same student record');
	const days = (new Date(row.access_expires_at) - Date.now()) / 86400000;
	assert.ok(days > 364 && days <= 365);
	assert.equal((await courseContent(get('/api/course-content', { authorization: `Bearer ${t2}` }), deps, { UNITS: [] })).status, 200);

	// Renewing early (within 30 days of the end) adds a year to the end date.
	row.access_expires_at = new Date(Date.now() + 10 * 86400000).toISOString();
	await enroll(deps);
	const days2 = (new Date(row.access_expires_at) - Date.now()) / 86400000;
	assert.ok(days2 > 374 && days2 <= 375, String(days2));
});


import { handle as monitorCheckout } from '../netlify/functions/create-monitor-checkout.mjs';
import { handle as monitorBank } from '../netlify/functions/monitor-bank.mjs';
import { handle as monitorPortal } from '../netlify/functions/monitor-portal.mjs';
import { handle as me } from '../netlify/functions/me.mjs';
import { handle as webhook2 } from '../netlify/functions/stripe-webhook.mjs';

async function subscribeMonitor(deps, name = 'Sam Medic', email = 'Sam@Example.com', opts) {
	const [st, c] = await body(await monitorCheckout(post('/api/create-monitor-checkout', { name, email }), deps));
	assert.equal(st, 200);
	const id = c.url.split('/').pop();
	const sub = deps.stripe.subscribe(id, opts);
	const [s2, r] = await body(await claim(post('/api/claim', { session_id: id }), deps));
	assert.equal(s2, 200);
	return { id, sub, token: r.token, claim: r };
}

test('Live Monitor: $14.99/month subscription checkout, sold on its own', async () => {
	const deps = fakeDeps({ monitorPriceCents: 1499 });
	await monitorCheckout(post('/api/create-monitor-checkout', { name: 'Sam Medic', email: 'SAM@example.com' }), deps);
	const s = deps.stripe.created[0];
	assert.equal(s.mode, 'subscription');
	assert.equal(s.customer_email, 'sam@example.com');
	assert.equal(s.line_items[0].price_data.unit_amount, 1499);
	assert.deepEqual(s.line_items[0].price_data.recurring, { interval: 'month' });
	assert.equal(s.metadata.product, 'ecg-live-monitor');
	assert.equal(s.subscription_data.metadata.email, 'sam@example.com');
	assert.equal(s.success_url, 'https://course.example.com/#welcome-monitor?session_id={CHECKOUT_SESSION_ID}');
	assert.equal(s.customer_creation, undefined, 'not allowed in subscription mode');
	const d2 = fakeDeps({ monitorPriceId: 'price_mon' });
	await monitorCheckout(post('/api/create-monitor-checkout', { name: 'A', email: 'a@b.co' }), d2);
	assert.deepEqual(d2.stripe.created[0].line_items[0], { price: 'price_mon', quantity: 1 });
});

test('Live Monitor: subscribing unlocks the full bank, without course access', async () => {
	const deps = fakeDeps();
	const { token, claim: c } = await subscribeMonitor(deps);
	assert.equal(c.product, 'monitor');
	const row = deps.db.rows[0];
	assert.equal(row.email, 'sam@example.com');
	assert.equal(row.monitor_status, 'active');
	assert.equal(row.paid_at, undefined, 'no course purchase');
	const auth = { authorization: `Bearer ${token}` };
	const [s1, r1] = await body(await monitorBank(get('/api/monitor-bank', auth), deps, { cats: [1, 2] }));
	assert.equal(s1, 200);
	assert.deepEqual(r1.bank, { cats: [1, 2] });
	assert.equal((await courseContent(get('/api/course-content', auth), deps, { UNITS: [] })).status, 403, 'the course is a separate purchase');
	const [s2, r2] = await body(await me(get('/api/me', auth), deps));
	assert.equal(s2, 200);
	assert.equal(r2.student.monitor.active, true);
	assert.equal(r2.student.course.active, false);
	// already subscribed: no second subscription
	assert.equal((await monitorCheckout(post('/api/create-monitor-checkout', { name: 'Sam', email: 'sam@example.com' }), deps)).status, 409);
	// sign-in links work for subscribers
	await requestLink(post('/api/request-link', { email: 'sam@example.com' }), deps);
	assert.equal(deps.sent.length, 1);
});

test('Live Monitor: no subscription, no bank; course students subscribe on the same record', async () => {
	const deps = fakeDeps();
	const { token } = await enroll(deps); // course student
	const auth = { authorization: `Bearer ${token}` };
	assert.equal((await monitorBank(get('/api/monitor-bank', auth), deps, {})).status, 403);
	await subscribeMonitor(deps, 'Pat Student', 'pat@example.com');
	assert.equal(deps.db.rows.length, 1, 'same student record');
	assert.equal(deps.stripe.created[1].customer, 'cus_123', 'reuses the Stripe customer from the course purchase');
	assert.equal((await monitorBank(get('/api/monitor-bank', auth), deps, {})).status, 200);
	assert.equal(deps.db.rows[0].paid_at != null, true, 'course purchase kept');
});

test('Live Monitor: webhook keeps the subscription current (renewal, cancellation)', async () => {
	const deps = fakeDeps();
	const { sub, token } = await subscribeMonitor(deps);
	const auth = { authorization: `Bearer ${token}` };
	const send = (type, obj) => webhook2(new Request('https://course.example.com/api/stripe-webhook', { method: 'POST', headers: { 'stripe-signature': 'good:whsec_test' }, body: JSON.stringify({ type, data: { object: obj } }) }), deps);
	// renewal pushes the paid-through date
	const later = Math.floor(Date.now() / 1000) + 60 * 86400;
	assert.equal((await send('customer.subscription.updated', { ...sub, current_period_end: later })).status, 200);
	assert.equal(deps.db.rows[0].monitor_current_period_end, new Date(later * 1000).toISOString());
	// newer API versions put the period on the subscription item
	const later2 = later + 86400;
	await send('customer.subscription.updated', { ...sub, current_period_end: undefined, items: { data: [{ current_period_end: later2 }] } });
	assert.equal(deps.db.rows[0].monitor_current_period_end, new Date(later2 * 1000).toISOString());
	// cancel at period end: still active until then
	await send('customer.subscription.updated', { ...sub, current_period_end: later, cancel_at_period_end: true });
	assert.equal((await monitorBank(get('/api/monitor-bank', auth), deps, {})).status, 200);
	// canceled: locked
	await send('customer.subscription.deleted', { ...sub, status: 'canceled' });
	assert.equal((await monitorBank(get('/api/monitor-bank', auth), deps, {})).status, 403);
	// a canceled subscriber can subscribe again
	assert.equal((await monitorCheckout(post('/api/create-monitor-checkout', { name: 'Sam', email: 'sam@example.com' }), deps)).status, 200);
	// unrelated subscriptions are ignored
	assert.equal((await send('customer.subscription.updated', { id: 'sub_other', status: 'active', metadata: {} })).status, 200);
});

test('Live Monitor: billing portal for subscribers only', async () => {
	const deps = fakeDeps();
	const { token: t0 } = await enroll(deps);
	assert.equal((await monitorPortal(post('/api/monitor-portal', {}, { authorization: `Bearer ${t0}` }), deps)).status, 404);
	const { token } = await subscribeMonitor(deps, 'Sam', 'sam@example.com');
	const [st, r] = await body(await monitorPortal(post('/api/monitor-portal', {}, { authorization: `Bearer ${token}` }), deps));
	assert.equal(st, 200);
	assert.match(r.url, /^https:\/\/billing\.stripe\.test\//);
	assert.equal(deps.stripe.portals[0].return_url, 'https://course.example.com/#monitor');
	assert.equal((await me(get('/api/me'), deps)).status, 401);
});


test('Live Monitor: a stale saved customer (other mode) does not break checkout or the portal', async () => {
	const deps = fakeDeps();
	const realCreate = deps.stripe.checkout.sessions.create.bind(deps.stripe.checkout.sessions);
	deps.stripe.checkout.sessions.create = async (p) => { if (p.customer === 'cus_live_old') { const e = new Error("No such customer: 'cus_live_old'"); e.code = 'resource_missing'; throw e; } return realCreate(p); };
	deps.db.rows.push({ id: 'x1', email: 'sam@example.com', name: 'Sam', stripe_customer_id: 'cus_live_old' });
	const { token, sub } = await subscribeMonitor(deps, 'Sam', 'sam@example.com');
	assert.equal(deps.stripe.created[0].customer_email, 'sam@example.com', 'fell back to the email');
	assert.equal(deps.db.rows[0].stripe_customer_id, sub.customer, 'row now has the subscription customer');
	deps.db.rows[0].stripe_customer_id = 'cus_live_old'; // even if it is stale again…
	const [st] = await body(await monitorPortal(post('/api/monitor-portal', {}, { authorization: `Bearer ${token}` }), deps));
	assert.equal(st, 200);
	assert.equal(deps.stripe.portals[0].customer, sub.customer, '…the portal uses the subscription customer');
});

test('passwords: create after purchase, sign in, wrong password, change, reset by link', async () => {
	const deps = fakeDeps();
	const { token } = await enroll(deps);
	const auth = { authorization: `Bearer ${token}` };
	const row = () => deps.db.rows.find((r) => r.email === 'pat@example.com');

	// no password yet: login fails generically
	let [st, r] = await body(await login(post('/api/login', { email: 'pat@example.com', password: 'whatever123' }), deps));
	assert.equal(st, 401);
	assert.match(r.error, /incorrect/);
	[, r] = await body(await me(get('/api/me', auth), deps));
	assert.equal(r.student.hasPassword, false);

	// rules
	assert.equal((await setPassword(post('/api/set-password', { password: 'short' }, auth), deps)).status, 400);
	assert.equal((await setPassword(post('/api/set-password', { password: 'long enough 1' }), deps)).status, 401, 'needs sign-in');

	// first password: the access token is enough; only a hash is stored
	assert.equal((await setPassword(post('/api/set-password', { password: 'heart-rhythm-1' }, auth), deps)).status, 200);
	assert.match(row().password_hash, /^scrypt\$/);
	assert.ok(!row().password_hash.includes('heart-rhythm-1'));
	[, r] = await body(await me(get('/api/me', auth), deps));
	assert.equal(r.student.hasPassword, true);

	// sign in (email is case-insensitive)
	[st, r] = await body(await login(post('/api/login', { email: 'PAT@example.com', password: 'heart-rhythm-1' }), deps));
	assert.equal(st, 200);
	assert.equal(verifyToken(r.token, 'access', deps.secret), 'pat@example.com');
	assert.equal((await login(post('/api/login', { email: 'pat@example.com', password: 'nope-nope-1' }), deps)).status, 401);
	assert.equal((await login(post('/api/login', { email: 'nobody@example.com', password: 'heart-rhythm-1' }), deps)).status, 401);

	// changing it needs the current password (or a link)
	assert.equal((await setPassword(post('/api/set-password', { password: 'new-password-2' }, auth), deps)).status, 403);
	assert.equal((await setPassword(post('/api/set-password', { password: 'new-password-2', current_password: 'wrong-one' }, auth), deps)).status, 403);
	assert.equal((await setPassword(post('/api/set-password', { password: 'new-password-2', current_password: 'heart-rhythm-1' }, auth), deps)).status, 200);
	assert.equal((await login(post('/api/login', { email: 'pat@example.com', password: 'heart-rhythm-1' }), deps)).status, 401);
	assert.equal((await login(post('/api/login', { email: 'pat@example.com', password: 'new-password-2' }), deps)).status, 200);

	// forgot it: the emailed link signs in and allows a reset; another person's link doesn't
	await requestLink(post('/api/request-link', { email: 'pat@example.com' }), deps);
	assert.match(deps.sent.at(-1).subject, /reset/i);
	const link = decodeURIComponent(deps.sent.at(-1).text.match(/#signin\?t=([^\s]+)/)[1]);
	const other = signToken('link', 'someone@example.com', deps.secret);
	assert.equal((await setPassword(post('/api/set-password', { password: 'reset-password-3', link_token: other }, auth), deps)).status, 403);
	assert.equal((await setPassword(post('/api/set-password', { password: 'reset-password-3', link_token: link }, auth), deps)).status, 200);
	assert.equal((await login(post('/api/login', { email: 'pat@example.com', password: 'reset-password-3' }), deps)).status, 200);
});

test('passwords: lockout after 10 wrong tries; ended access is refused', async () => {
	const deps = fakeDeps();
	const { token } = await enroll(deps);
	await setPassword(post('/api/set-password', { password: 'heart-rhythm-1' }, { authorization: `Bearer ${token}` }), deps);
	for (let i = 0; i < 10; i++) assert.equal((await login(post('/api/login', { email: 'pat@example.com', password: 'bad-guess-' + i }), deps)).status, 401);
	assert.equal((await login(post('/api/login', { email: 'pat@example.com', password: 'heart-rhythm-1' }), deps)).status, 429, 'locked even with the right password');
	const row = deps.db.rows.find((r) => r.email === 'pat@example.com');
	row.password_locked_until = new Date(Date.now() - 1000).toISOString();
	assert.equal((await login(post('/api/login', { email: 'pat@example.com', password: 'heart-rhythm-1' }), deps)).status, 200, 'unlocks after the wait');
	row.access_expires_at = new Date(Date.now() - 1000).toISOString();
	const [st, r] = await body(await login(post('/api/login', { email: 'pat@example.com', password: 'heart-rhythm-1' }), deps));
	assert.equal(st, 403);
	assert.equal(r.expired, true);
});

import { handle as groupCheckout } from '../netlify/functions/create-group-checkout.mjs';
import { handle as joinGroupFn } from '../netlify/functions/join-group.mjs';
import { handle as myGroups } from '../netlify/functions/my-groups.mjs';
import { cleanCode } from '../netlify/lib/groups.mjs';

/** An instructor buys seats; returns their token and the class. */
async function buySeats(deps, seats = 5, email = 'teach@college.edu') {
	const [st, c] = await body(await groupCheckout(post('/api/create-group-checkout', { name: 'Dana Teach', email, org: 'Medic Class 2027', seats }), deps));
	assert.equal(st, 200);
	const id = c.url.split('/').pop();
	deps.stripe.pay(id);
	const [s2, r] = await body(await claim(post('/api/claim', { session_id: id }), deps));
	assert.equal(s2, 200);
	assert.equal(r.product, 'group');
	const auth = { authorization: `Bearer ${r.token}` };
	const [, mg] = await body(await myGroups(get('/api/my-groups', auth), deps));
	return { id, token: r.token, auth, group: mg.groups[0] };
}
/** A student joins with the code and confirms by email; returns the join response. */
async function joinClass(deps, code, name, email) {
	const [st, r] = await body(await joinGroupFn(post('/api/join-group', { code, name, email }), deps));
	if (st !== 200) return [st, r];
	const t = decodeURIComponent(deps.sent.at(-1).text.match(/#join\?t=([^\s]+)/)[1]);
	return body(await joinGroupFn(post('/api/join-group', { join_token: t }), deps));
}

test('group checkout: seats × $39, minimum seats, validation', async () => {
	const deps = fakeDeps();
	const [st, r] = await body(await groupCheckout(post('/api/create-group-checkout', { name: 'Dana', email: 'D@college.edu', org: 'Medic Class', seats: 12 }), deps));
	assert.equal(st, 200);
	const s = deps.stripe.created[0];
	assert.equal(s.mode, 'payment');
	assert.equal(s.line_items[0].quantity, 12);
	assert.equal(s.line_items[0].price_data.unit_amount, 3900);
	assert.equal(s.metadata.product, 'ecg-group-seats');
	assert.equal(s.metadata.owner_email, 'd@college.edu');
	assert.match(s.success_url, /#welcome-group\?session_id=/);
	assert.ok(r.url);
	assert.equal((await groupCheckout(post('/api/create-group-checkout', { name: 'Dana', email: 'd@college.edu', org: 'X', seats: 4 }), deps)).status, 400, 'below minimum');
	assert.equal((await groupCheckout(post('/api/create-group-checkout', { name: 'Dana', email: 'd@college.edu', org: 'X', seats: 501 }), deps)).status, 400, 'above maximum');
	assert.equal((await groupCheckout(post('/api/create-group-checkout', { name: 'Dana', email: 'd@college.edu', org: '', seats: 10 }), deps)).status, 400, 'needs a class name');
});

test('group purchase: recorded once (claim + webhook), instructor can sign in, dashboard shows the class', async () => {
	const deps = fakeDeps();
	const { id, auth, group } = await buySeats(deps, 6);
	assert.equal(group.seats, 6);
	assert.equal(group.seatsUsed, 0);
	assert.equal(group.org, 'Medic Class 2027');
	assert.match(group.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
	assert.equal(group.joinUrl, `https://course.example.com/#join?code=${group.code}`);
	// webhook for the same payment adds nothing
	const evt = { type: 'checkout.session.completed', data: { object: deps.stripe.sessions.get(id) } };
	assert.equal((await webhook(post('/api/stripe-webhook', JSON.stringify(evt), { 'stripe-signature': 'good:whsec_test' }), deps)).status, 200);
	assert.equal(deps.db.tables.ecg_course_groups.length, 1);
	assert.equal(deps.db.tables.ecg_course_groups[0].seats, 6);
	// the instructor has no course access but is an instructor, and can get a sign-in link
	const [, m] = await body(await me(get('/api/me', auth), deps));
	assert.equal(m.student.instructor, true);
	assert.equal(m.student.course.active, false);
	await requestLink(post('/api/request-link', { email: 'teach@college.edu' }), deps);
	assert.match(deps.sent.at(-1).text, /#signin\?t=/);
	// add seats to the same class
	const [st, c] = await body(await groupCheckout(post('/api/create-group-checkout', { group_id: group.id, seats: 4 }, auth), deps));
	assert.equal(st, 200);
	const id2 = c.url.split('/').pop();
	deps.stripe.pay(id2);
	await claim(post('/api/claim', { session_id: id2 }), deps);
	await claim(post('/api/claim', { session_id: id2 }), deps);
	assert.equal(deps.db.tables.ecg_course_groups.length, 1);
	assert.equal(deps.db.tables.ecg_course_groups[0].seats, 10);
	// only the owner can add seats
	const other = { authorization: `Bearer ${signToken('access', 'x@y.co', deps.secret)}` };
	assert.equal((await groupCheckout(post('/api/create-group-checkout', { group_id: group.id, seats: 4 }, other), deps)).status, 404);
	const [, mg] = await body(await myGroups(get('/api/my-groups', other), deps));
	assert.deepEqual(mg.groups, []);
});

test('join a class: email confirm, seat used once, full access, dashboard lists students; seats run out', async () => {
	const deps = fakeDeps();
	const { auth, group } = await buySeats(deps, 5);
	const [, info] = await body(await joinGroupFn(get(`/api/join-group?code=${group.code.toLowerCase().replace('-', ' ')}`), deps));
	assert.equal(info.org, 'Medic Class 2027');
	assert.equal(info.open, true);
	assert.equal((await joinGroupFn(get('/api/join-group?code=ZZZZ-ZZZZ'), deps)).status, 404);

	// asking to join only sends an email; no seat yet
	await joinGroupFn(post('/api/join-group', { code: group.code, name: 'Sam One', email: 'sam@student.edu' }), deps);
	assert.equal(deps.db.tables.ecg_course_groups[0].seats_used, 0);
	assert.match(deps.sent.at(-1).subject, /Medic Class 2027/);

	let [st, r] = await joinClass(deps, group.code, 'Sam One', 'Sam@Student.edu');
	assert.equal(st, 200);
	assert.equal(r.seatUsed, true);
	assert.equal(r.email, 'sam@student.edu');
	const sam = { authorization: `Bearer ${r.token}` };
	assert.equal((await courseContent(get('/api/course-content', sam), deps)).status, 200, 'full course unlocked');
	// the same link again (or joining again) uses no second seat
	[st, r] = await joinClass(deps, group.code, 'Sam One', 'sam@student.edu');
	assert.equal(r.seatUsed, false);
	assert.equal(deps.db.tables.ecg_course_groups[0].seats_used, 1);

	// someone who already bought the course joins without using a seat
	await enroll(deps, 'Paid Person', 'paid@student.edu');
	[st, r] = await joinClass(deps, group.code, 'Paid Person', 'paid@student.edu');
	assert.equal(r.seatUsed, false);
	assert.equal(deps.db.tables.ecg_course_groups[0].seats_used, 1);

	// fill the remaining 4 seats, then the class is full
	for (let i = 2; i <= 5; i++) assert.equal((await joinClass(deps, group.code, 'S' + i, `s${i}@student.edu`))[0], 200);
	[st, r] = await joinClass(deps, group.code, 'Late', 'late@student.edu');
	assert.equal(st, 410);
	assert.match(r.error, /no seats/);

	const [, mg] = await body(await myGroups(get('/api/my-groups', auth), deps));
	const g = mg.groups[0];
	assert.equal(g.seatsUsed, 5);
	assert.equal(g.seatsLeft, 0);
	assert.equal(g.open, false);
	assert.equal(g.members.length, 6);
	assert.ok(g.members.some((m) => m.email === 'sam@student.edu' && m.accessUntil && m.certificate === null));
});

test('join a class: bad or expired tokens; expired class; code cleanup', async () => {
	const deps = fakeDeps();
	const { group } = await buySeats(deps, 5);
	assert.equal((await joinGroupFn(post('/api/join-group', { join_token: 'nope' }), deps)).status, 401);
	const old = signToken('join', 'a@b.co', deps.secret, Date.now() - 4 * 86400000, { g: group.id, n: 'A' });
	assert.equal((await joinGroupFn(post('/api/join-group', { join_token: old }), deps)).status, 401, 'expires after 3 days');
	assert.equal((await joinGroupFn(post('/api/join-group', { join_token: signToken('link', 'a@b.co', deps.secret) }), deps)).status, 401, 'a sign-in link is not a join link');
	deps.db.tables.ecg_course_groups[0].join_until = new Date(Date.now() - 1000).toISOString();
	assert.equal((await joinGroupFn(post('/api/join-group', { code: group.code, name: 'A', email: 'a@b.co' }), deps)).status, 410);
	assert.equal(cleanCode(' k7qm-3rxp '), 'K7QM-3RXP');
	assert.equal(cleanCode('abc'), null);
});

import { handle as labBank } from '../netlify/functions/lab-bank.mjs';

test('Lab bank: practice areas and Code lab cases for Live Monitor subscribers only', async () => {
	const data = { areas: { sinus: { key: 'sinus', items: [1, 2, 3] }, field: { key: 'field', items: [4] } }, codelab: { cases: ['vf1', 'brady1'] } };
	const deps = fakeDeps();
	const { token: courseToken } = await enroll(deps);                           // course student, no subscription
	const course = { authorization: `Bearer ${courseToken}` };
	assert.equal((await labBank(get('/api/lab-bank?part=sinus', course), deps, data)).status, 403, 'the course alone does not unlock the Lab');
	assert.equal((await labBank(get('/api/lab-bank?part=sinus'), deps, data)).status, 401, 'signed out');
	const { token } = await subscribeMonitor(deps, 'Sam Medic', 'sam@example.com');
	const auth = { authorization: `Bearer ${token}` };
	const [s1, r1] = await body(await labBank(get('/api/lab-bank?part=sinus', auth), deps, data));
	assert.equal(s1, 200);
	assert.deepEqual(r1, { part: 'sinus', data: data.areas.sinus });
	const [s2, r2] = await body(await labBank(get('/api/lab-bank?part=codelab', auth), deps, data));
	assert.equal(s2, 200);
	assert.deepEqual(r2.data, data.codelab);
	assert.equal((await labBank(get('/api/lab-bank?part=twelve', auth), deps, data)).status, 404, 'no 12-leads in the Lab');
	assert.equal((await labBank(get('/api/lab-bank?part=__proto__', auth), deps, data)).status, 404);
	assert.equal((await labBank(get('/api/lab-bank', auth), deps, data)).status, 404);
	assert.equal((await labBank(post('/api/lab-bank?part=sinus', {}), deps, data)).status, 405);
});

test('Lab bank: the built bank has every practice area and all Code lab cases', async () => {
	const { default: built } = await import('../netlify/data/lab-full.json', { with: { type: 'json' } });
	assert.deepEqual(Object.keys(built.areas), ['sinus', 'atrial', 'junctional', 'ventricular', 'block', 'paced', 'field', 'random']);
	for (const [k, a] of Object.entries(built.areas)) {
		assert.ok(a.items.length >= 50, k + ' has its strips');
		for (const q of a.items) assert.ok(a.strips[q.strip], k + ' strip ' + q.strip);
	}
	assert.equal(built.codelab.cases.length, 12);
});
