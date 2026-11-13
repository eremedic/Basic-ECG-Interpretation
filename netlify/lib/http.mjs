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
