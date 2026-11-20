// A simple branded email (same look as the sign-in email).
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** paragraphs are plain text; button = { label, link }. Returns { html, text }. */
export function brandEmail({ greeting, paragraphs, button, footer }) {
	const p = paragraphs.map((x) => `<p style="margin:0 0 14px;">${esc(x)}</p>`).join('');
	const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f7fb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fb;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #e2e7f0;border-radius:14px;">
<tr><td style="height:6px;background:#1b2a5b;border-radius:14px 14px 0 0;font-size:0;">&nbsp;</td></tr>
<tr><td align="center" style="padding:26px 30px 6px;font-family:Arial,Helvetica,sans-serif;"><span style="font-size:28px;font-weight:900;"><span style="color:#1b2a5b;">CS</span><span style="color:#1b7a8c;">Health</span><span style="color:#e0262b;">ED</span></span><br><span style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#5b6684;">Basic ECG Interpretation</span></td></tr>
<tr><td style="padding:18px 30px 6px;font-family:Arial,Helvetica,sans-serif;color:#18213a;font-size:16px;line-height:1.6;"><p style="margin:0 0 12px;">${esc(greeting)}</p>${p}</td></tr>
<tr><td align="center" style="padding:0 30px 22px;"><a href="${esc(button.link)}" style="display:inline-block;padding:14px 30px;background:#e0262b;color:#fff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;text-decoration:none;border-radius:10px;">${esc(button.label)}</a></td></tr>
<tr><td style="padding:0 30px 26px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5b6684;line-height:1.5;">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
	const text = `${greeting}\n\n${paragraphs.join('\n\n')}\n\n${button.label}: ${button.link}\n\n${footer}`;
	return { html, text };
}
