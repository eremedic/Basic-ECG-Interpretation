// Connections to Stripe, Supabase and Resend, built from environment variables
// (set them in Netlify → Site configuration → Environment variables).
// Tests pass their own stand-ins instead.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

let cached = null;

/**
 * SUPABASE_URL should be just the project address (https://<ref>.supabase.co).
 * Accept common paste mistakes: a trailing /rest/v1/, any other path, a missing
 * https://, or the dashboard link (supabase.com/dashboard/project/<ref>).
 */
export function supabaseOrigin(raw) {
	let v = String(raw || '').trim();
	const dash = /supabase\.com\/dashboard\/project\/([a-z0-9]{10,40})/i.exec(v);
	if (dash) return `https://${dash[1].toLowerCase()}.supabase.co`;
	if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
	try {
		return new URL(v).origin;
	} catch {
		return v;
	}
}

/** SITE_URL as https://host (adds a missing https://, drops a trailing slash, path or #). */
export function siteOrigin(raw) {
	let v = String(raw || '').trim();
	if (!v) return '';
	if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
	try {
		const u = new URL(v);
		return u.hostname.includes('.') || u.hostname === 'localhost' ? u.origin : '';
	} catch {
		return '';
	}
}

function timedFetch(ms) {
	return (url, opts = {}) => {
		const t = AbortSignal.timeout(ms);
		return fetch(url, { ...opts, signal: opts.signal ? AbortSignal.any([opts.signal, t]) : t });
	};
}

export function getDeps() {
	if (cached) return cached;
	const env = process.env;
	cached = {
		// Answer within Netlify's 10-second function limit, so a slow service gives a
		// readable error instead of a bare 502.
		stripe: env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY.trim(), { timeout: 7000, maxNetworkRetries: 0 }) : null,
		db: env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
			? createClient(supabaseOrigin(env.SUPABASE_URL), env.SUPABASE_SERVICE_ROLE_KEY.trim(), {
					auth: { persistSession: false },
					global: { fetch: timedFetch(6000) }
				})
			: null,
		secret: env.ACCESS_TOKEN_SECRET || '',
		webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
		siteUrl: siteOrigin(env.SITE_URL) || siteOrigin(env.URL),
		priceId: env.STRIPE_PRICE_ID || '',
		priceCents: Number(env.COURSE_PRICE_CENTS) || 4900,
		emailFrom: env.EMAIL_FROM || 'CSHealthED <no-reply@cshealthed.com>',
		sendEmail: async ({ to, subject, html, text }) => {
			if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
			const res = await fetch('https://api.resend.com/emails', {
				method: 'POST',
				headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
				body: JSON.stringify({ from: env.EMAIL_FROM || 'CSHealthED <no-reply@cshealthed.com>', to, subject, html, text })
			});
			if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
		}
	};
	return cached;
}

/** A clear 503 when the site isn't configured yet, instead of a crash. */
export function missing(deps, ...keys) {
	const names = { stripe: 'STRIPE_SECRET_KEY', db: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY', secret: 'ACCESS_TOKEN_SECRET', siteUrl: 'SITE_URL' };
	return keys.filter((k) => !deps[k]).map((k) => names[k] || k);
}
