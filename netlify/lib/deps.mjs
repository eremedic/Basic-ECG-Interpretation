// Connections to Stripe, Supabase and Resend, built from environment variables
// (set them in Netlify → Site configuration → Environment variables).
// Tests pass their own stand-ins instead.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

let cached = null;

export function getDeps() {
	if (cached) return cached;
	const env = process.env;
	cached = {
		stripe: env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null,
		db: env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
			? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
			: null,
		secret: env.ACCESS_TOKEN_SECRET || '',
		webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
		siteUrl: (env.SITE_URL || env.URL || '').replace(/\/$/, ''),
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
