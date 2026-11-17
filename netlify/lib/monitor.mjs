// The Live Monitor subscription: a monthly Stripe subscription, separate from
// the course. Its state lives on the student's row (migration 0003).

import { findStudent } from './students.mjs';

const TABLE = 'ecg_course_students';
export const MONITOR_PRODUCT = 'ecg-live-monitor';
const DAY = 24 * 3600 * 1000;
const PAST_DUE_GRACE_DAYS = 3; // keep access briefly while Stripe retries a failed renewal

export function monitorUntil(s) {
	return s?.monitor_current_period_end ? new Date(s.monitor_current_period_end) : null;
}

/** Whether the student can use the full Live Monitor right now. */
export function monitorActive(s, now = Date.now()) {
	if (!s?.monitor_status) return false;
	const until = monitorUntil(s), end = until ? until.getTime() : Infinity;
	if (s.monitor_status === 'active' || s.monitor_status === 'trialing') return end > now;
	if (s.monitor_status === 'past_due') return end + PAST_DUE_GRACE_DAYS * DAY > now;
	return false;
}

/** What the site shows the student about their subscription. */
export function monitorView(s) {
	if (!s?.monitor_status) return { active: false, status: null, until: null, cancelAtPeriodEnd: false };
	const until = monitorUntil(s);
	return { active: monitorActive(s), status: s.monitor_status, until: until ? until.toISOString() : null, cancelAtPeriodEnd: !!s.monitor_cancel_at_period_end };
}

/** Columns for a Stripe subscription object (works with old and new API versions). */
export function subscriptionFields(sub) {
	const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
	return {
		monitor_status: sub.status,
		monitor_subscription_id: sub.id,
		monitor_current_period_end: end ? new Date(end * 1000).toISOString() : null,
		monitor_cancel_at_period_end: !!(sub.cancel_at_period_end || sub.cancel_at)
	};
}

/**
 * Record a Live Monitor subscription for a student (by email), creating their
 * row if they haven't bought the course. Safe to call more than once.
 */
export async function recordMonitor(db, { email, name, customer, sub }) {
	email = String(email || '').trim().toLowerCase();
	if (!email) throw new Error('recordMonitor: no email');
	name = String(name || '').trim().slice(0, 120);
	const fields = subscriptionFields(sub);
	const existing = await findStudent(db, email);
	if (existing) {
		const update = { ...fields };
		// the subscription's customer is the one Stripe knows in this mode: keep it
		if (customer && existing.stripe_customer_id !== customer) update.stripe_customer_id = customer;
		if (!existing.name && name) update.name = name;
		if (!existing.monitor_started_at) update.monitor_started_at = new Date().toISOString();
		const { data, error } = await db.from(TABLE).update(update).eq('email', email).select().single();
		if (error) throw new Error(`recordMonitor update: ${error.message}`);
		return data;
	}
	const { data, error } = await db
		.from(TABLE)
		.insert({ email, name, stripe_customer_id: customer || null, monitor_started_at: new Date().toISOString(), ...fields })
		.select()
		.single();
	if (error) throw new Error(`recordMonitor insert: ${error.message}`);
	return data;
}

/** Apply a subscription change from Stripe (renewal, failed payment, cancellation). */
export async function updateMonitorSubscription(db, sub) {
	const { data, error } = await db.from(TABLE).update(subscriptionFields(sub)).eq('monitor_subscription_id', sub.id).select();
	if (error) throw new Error(`updateMonitorSubscription: ${error.message}`);
	if (data && data.length) return data[0];
	// not linked yet (the subscription event can arrive before checkout completes)
	if (sub.metadata?.product === MONITOR_PRODUCT && sub.metadata?.email) {
		return recordMonitor(db, { email: sub.metadata.email, name: sub.metadata.student_name, customer: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id, sub });
	}
	return null;
}

/** Record the subscription from a completed Live Monitor Checkout session. */
export async function recordMonitorCheckout(stripe, db, session) {
	const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
	if (!subId) throw new Error('recordMonitorCheckout: session has no subscription');
	const sub = typeof session.subscription === 'object' && session.subscription?.status ? session.subscription : await stripe.subscriptions.retrieve(subId);
	return recordMonitor(db, {
		email: session.customer_details?.email || session.customer_email || sub.metadata?.email,
		name: session.metadata?.student_name || session.customer_details?.name,
		customer: typeof session.customer === 'string' ? session.customer : session.customer?.id,
		sub
	});
}

/** A Live Monitor Checkout session that has finished successfully. */
export function monitorSessionComplete(s) {
	return s?.metadata?.product === MONITOR_PRODUCT && s.mode === 'subscription' && s.status === 'complete' && (s.payment_status === 'paid' || s.payment_status === 'no_payment_required');
}
