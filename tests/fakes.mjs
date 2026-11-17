// In-memory stand-ins for Supabase, Stripe and email, for testing the functions.

export function fakeDb() {
	const rows = [];
	let seq = 0;
	function query(table) {
		let op = 'select', payload = null, filters = [], wantRow = false;
		const run = () => {
			const match = (r) => filters.every(([c, v]) => r[c] === v);
			if (op === 'insert') {
				if (rows.some((r) => r.email === payload.email)) return { data: null, error: { message: 'duplicate email' } };
				const row = { id: `id-${++seq}`, name: '', certificate_id: null, certificate_score: null, certificate_issued_at: null, certificate_name: null, last_sign_in_at: null, ...payload };
				rows.push(row);
				return { data: { ...row }, error: null };
			}
			const hits = rows.filter(match);
			if (op === 'update') hits.forEach((r) => Object.assign(r, payload));
			if (wantRow === 'single' && hits.length !== 1) return { data: null, error: { message: 'not exactly one row' } };
			return { data: wantRow ? (hits[0] ? { ...hits[0] } : null) : hits.map((r) => ({ ...r })), error: null };
		};
		const q = {
			select() { return q; },
			insert(p) { op = 'insert'; payload = p; return q; },
			update(p) { op = 'update'; payload = p; return q; },
			eq(c, v) { filters.push([c, v]); return q; },
			maybeSingle() { wantRow = 'maybe'; return Promise.resolve(run()); },
			single() { wantRow = 'single'; return Promise.resolve(run()); },
			then(res, rej) { return Promise.resolve(run()).then(res, rej); }
		};
		void table;
		return q;
	}
	return { from: query, rows };
}

export function fakeStripe() {
	const sessions = new Map();
	return {
		created: [],
		sessions,
		checkout: {
			sessions: {
				async create(p) {
					const id = `cs_test_${Math.random().toString(36).slice(2, 14)}`;
					const s = { id, url: `https://checkout.stripe.test/${id}`, ...p };
					this._parent.created.push(s);
					sessions.set(id, s);
					return s;
				},
				async retrieve(id) {
					if (!sessions.has(id)) throw new Error('No such checkout.session');
					return sessions.get(id);
				}
			}
		},
		subs: new Map(),
		subscriptions: {
			async retrieve(id) {
				const st = this._parent;
				if (!st.subs.has(id)) throw new Error('No such subscription');
				return st.subs.get(id);
			}
		},
		portals: [],
		billingPortal: {
			sessions: {
				async create(p) { this._parent.portals.push(p); return { url: 'https://billing.stripe.test/p/' + p.customer }; }
			}
		},
		/** Complete a subscription Checkout session, as Stripe would. Returns the subscription. */
		subscribe(id, { status = 'active', days = 30 } = {}) {
			const s = sessions.get(id);
			const sub = { id: 'sub_' + Math.random().toString(36).slice(2, 10), status, customer: s.customer || 'cus_456', cancel_at_period_end: false, current_period_end: Math.floor(Date.now() / 1000) + days * 86400, metadata: { ...(s.subscription_data?.metadata || {}) } };
			this.subs.set(sub.id, sub);
			Object.assign(s, { status: 'complete', payment_status: 'paid', subscription: sub.id, customer: sub.customer, customer_details: { email: s.customer_email || s.subscription_data?.metadata?.email, name: 'Card Name' } });
			return sub;
		},
		webhooks: {
			constructEvent(raw, sig, secret) {
				if (sig !== `good:${secret}`) throw new Error('bad signature');
				return JSON.parse(raw);
			}
		},
		/** Mark a created session as paid, as Stripe would after checkout. */
		pay(id) {
			const s = sessions.get(id);
			Object.assign(s, { payment_status: 'paid', amount_total: 4900, currency: 'usd', customer: 'cus_123', customer_details: { email: s.customer_email, name: 'Card Name' } });
			return s;
		}
	};
}

export function fakeDeps(over = {}) {
	const stripe = fakeStripe();
	stripe.checkout.sessions._parent = stripe;
	stripe.subscriptions._parent = stripe;
	stripe.billingPortal.sessions._parent = stripe;
	const sent = [];
	return {
		stripe,
		db: fakeDb(),
		secret: 'test-secret-0123456789abcdef',
		webhookSecret: 'whsec_test',
		siteUrl: 'https://course.example.com',
		priceId: '',
		priceCents: 4900,
		sent,
		sendEmail: async (m) => { sent.push(m); },
		...over
	};
}

export const post = (url, body, headers = {}) =>
	new Request(`https://course.example.com${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
export const get = (url, headers = {}) => new Request(`https://course.example.com${url}`, { headers });
