// Group seats: an instructor buys course seats for a class (migration 0005).
// Students join with the class's code and each get a year of course access.

import { randomInt } from 'node:crypto';
import { ACCESS_DAYS, accessUntil, findStudent, hasAccess } from './students.mjs';

const STUDENTS = 'ecg_course_students';
const GROUPS = 'ecg_course_groups';
const PURCHASES = 'ecg_course_group_purchases';
export const GROUP_PRODUCT = 'ecg-group-seats';
export const MAX_SEATS = 500;
const DAY = 24 * 3600 * 1000;
/** Seats can be used for this long after the latest seat purchase. */
export const JOIN_DAYS = 365;

// No look-alike characters (0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newCode() {
	let c = '';
	for (let i = 0; i < 8; i++) c += ALPHABET[randomInt(ALPHABET.length)];
	return c.slice(0, 4) + '-' + c.slice(4);
}
/** Normalize what a student typed or pasted: "k7qm 3rxp" → "K7QM-3RXP". */
export function cleanCode(v) {
	const c = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
	return c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : null;
}

export function seatsLeft(g) {
	return Math.max(0, (g?.seats || 0) - (g?.seats_used || 0));
}
export function groupOpen(g, now = Date.now()) {
	return !!g && seatsLeft(g) > 0 && (!g.join_until || new Date(g.join_until).getTime() > now);
}
export function groupComplete(s) {
	return s?.metadata?.product === GROUP_PRODUCT && s.mode === 'payment' && s.payment_status === 'paid';
}

export async function findGroup(db, { id, code }) {
	const q = db.from(GROUPS).select('*');
	const { data, error } = await (id ? q.eq('id', id) : q.eq('code', code)).maybeSingle();
	if (error) throw new Error(`findGroup: ${error.message}`);
	return data;
}
export async function groupsOwnedBy(db, email) {
	const { data, error } = await db.from(GROUPS).select('*').eq('owner_email', email);
	if (error) throw new Error(`findGroup owner: ${error.message}`);
	return (data || []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}
export async function groupMembers(db, groupId) {
	const { data, error } = await db.from(STUDENTS).select('*').eq('group_id', groupId);
	if (error) throw new Error(`findStudent group: ${error.message}`);
	return (data || []).sort((a, b) => String(a.group_joined_at).localeCompare(String(b.group_joined_at)));
}

/** Mark the buyer as an instructor, creating their row if they're new. */
async function ensureInstructor(db, email, name) {
	const existing = await findStudent(db, email);
	if (existing) {
		if (existing.is_instructor && existing.name) return existing;
		const update = { is_instructor: true };
		if (!existing.name && name) update.name = name;
		const { data, error } = await db.from(STUDENTS).update(update).eq('email', email).select().single();
		if (error) throw new Error(`recordGroup instructor: ${error.message}`);
		return data;
	}
	const { data, error } = await db.from(STUDENTS).insert({ email, name: name || '', is_instructor: true }).select().single();
	if (error) throw new Error(`recordGroup instructor: ${error.message}`);
	return data;
}

/** Add seats to a group, safely when two requests race. */
async function addSeats(db, group, seats, joinUntil) {
	let g = group;
	for (let i = 0; i < 6; i++) {
		const until = !g.join_until || new Date(g.join_until) < joinUntil ? joinUntil.toISOString() : g.join_until;
		const { data, error } = await db.from(GROUPS).update({ seats: g.seats + seats, join_until: until }).eq('id', g.id).eq('seats', g.seats).select();
		if (error) throw new Error(`recordGroup seats: ${error.message}`);
		if (data && data.length) return data[0];
		g = await findGroup(db, { id: g.id });
	}
	throw new Error('recordGroup seats: busy, please retry');
}

/**
 * Record a paid seat purchase (new class, or more seats for an existing one).
 * Idempotent: the webhook and the return page can both call it.
 * Returns { group, owner }.
 */
export async function recordGroupPurchase(db, session) {
	const email = String(session.metadata?.owner_email || session.customer_details?.email || session.customer_email || '').trim().toLowerCase();
	if (!email) throw new Error('recordGroup: session has no email');
	const name = String(session.metadata?.owner_name || session.customer_details?.name || '').trim().slice(0, 120);
	const seats = Math.max(1, Math.min(MAX_SEATS, parseInt(session.metadata?.seats, 10) || 0));
	const owner = await ensureInstructor(db, email, name);

	// Claim this payment: the unique session id means only one caller adds the seats.
	const ins = await db.from(PURCHASES).insert({
		stripe_checkout_session_id: session.id, seats, amount_paid: session.amount_total ?? null, currency: session.currency ?? null
	}).select().single();
	if (ins.error) {
		if (!/duplicate|unique/i.test(ins.error.message)) throw new Error(`recordGroup purchase: ${ins.error.message}`);
		// Already being recorded by the other caller: wait for its group.
		for (let i = 0; i < 10; i++) {
			const { data } = await db.from(PURCHASES).select('*').eq('stripe_checkout_session_id', session.id).maybeSingle();
			if (data?.group_id) return { group: await findGroup(db, { id: data.group_id }), owner };
			await new Promise((r) => setTimeout(r, 300));
		}
		throw new Error('recordGroup purchase: still being recorded, please retry');
	}

	const joinUntil = new Date(Date.now() + JOIN_DAYS * DAY);
	let group = null;
	const addTo = session.metadata?.group_id;
	if (addTo) {
		const g = await findGroup(db, { id: addTo });
		if (g && g.owner_email === email) group = await addSeats(db, g, seats, joinUntil);
	}
	if (!group) {
		for (let i = 0; i < 5 && !group; i++) {
			const { data, error } = await db.from(GROUPS).insert({
				code: newCode(), org_name: String(session.metadata?.org || '').slice(0, 120), owner_email: email, owner_name: name,
				seats, seats_used: 0, join_until: joinUntil.toISOString()
			}).select().single();
			if (data) group = data;
			else if (!/duplicate|unique/i.test(error?.message || '')) throw new Error(`recordGroup create: ${error?.message}`);
		}
		if (!group) throw new Error('recordGroup create: could not make a unique code');
	}
	const { error } = await db.from(PURCHASES).update({ group_id: group.id }).eq('stripe_checkout_session_id', session.id);
	if (error) throw new Error(`recordGroup purchase link: ${error.message}`);
	return { group, owner };
}

/**
 * Put a student in a class. Uses a seat only when they need access:
 * already in this class, or already enrolled, uses none.
 * Returns { student, seatUsed } or { error, status }.
 */
export async function joinGroup(db, group, email, name, now = Date.now()) {
	const existing = await findStudent(db, email);
	if (existing && existing.group_id === group.id && hasAccess(existing, now)) return { student: existing, seatUsed: false };
	if (existing && hasAccess(existing, now)) {
		const { data, error } = await db.from(STUDENTS).update({ group_id: group.id, group_joined_at: new Date(now).toISOString() }).eq('email', email).select().single();
		if (error) throw new Error(`joinGroup: ${error.message}`);
		return { student: data, seatUsed: false };
	}
	// take a seat
	let g = group, took = false;
	for (let i = 0; i < 6 && !took; i++) {
		if (!groupOpen(g, now)) return { status: 410, error: seatsLeft(g) ? 'This class code has expired. Ask your instructor for a new one.' : 'This class has no seats left. Ask your instructor to add more.' };
		const { data, error } = await db.from(GROUPS).update({ seats_used: g.seats_used + 1 }).eq('id', g.id).eq('seats_used', g.seats_used).select();
		if (error) throw new Error(`joinGroup seat: ${error.message}`);
		if (data && data.length) took = true;
		else g = await findGroup(db, { id: g.id });
	}
	if (!took) throw new Error('joinGroup seat: busy, please retry');
	const access = {
		paid_at: new Date(now).toISOString(),
		access_expires_at: new Date(now + ACCESS_DAYS * DAY).toISOString(),
		group_id: group.id,
		group_joined_at: new Date(now).toISOString()
	};
	if (existing) {
		const update = { ...access };
		if (!existing.name && name) update.name = name;
		const { data, error } = await db.from(STUDENTS).update(update).eq('email', email).select().single();
		if (error) throw new Error(`joinGroup: ${error.message}`);
		return { student: data, seatUsed: true };
	}
	const { data, error } = await db.from(STUDENTS).insert({ email, name: name || '', ...access }).select().single();
	if (error) throw new Error(`joinGroup: ${error.message}`);
	return { student: data, seatUsed: true };
}

/** What the instructor dashboard shows for one class. */
export function groupView(g, members, siteUrl) {
	return {
		id: g.id,
		code: g.code,
		org: g.org_name,
		seats: g.seats,
		seatsUsed: g.seats_used,
		seatsLeft: seatsLeft(g),
		joinUntil: g.join_until,
		createdAt: g.created_at,
		open: groupOpen(g),
		joinUrl: `${siteUrl}/#join?code=${g.code}`,
		members: members.map((s) => ({
			name: s.name,
			email: s.email,
			joinedAt: s.group_joined_at,
			accessUntil: accessUntil(s)?.toISOString() ?? null,
			certificate: s.certificate_id ? { id: s.certificate_id, score: s.certificate_score, issuedAt: s.certificate_issued_at } : null
		}))
	};
}
