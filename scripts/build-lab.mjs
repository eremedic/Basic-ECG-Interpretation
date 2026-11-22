// Build the Cardiac Lab practice strips and Code lab for the Lab (Live Monitor subscription).
//
// Sources (copied from the Cardiac Lab project, see src/lab/README.md):
//   src/lab/<area>.json        practice areas: sinus, atrial, junctional, ventricular, block, paced, field, random, twelve (12-lead ECGs)
//   src/lab/codelab.js         the Code lab (cases + runner)
//   src/lab/defib.js           the monitor / defibrillator / pacer the Code lab runs on
//   src/lab/cardiac-lab.src.css  Cardiac Lab's styles
//   src/lab/twelve-rhythms.json  12-leads printed by the monitor's 12-LEAD key
//
// Output:
//   site/js/cl-free.js           the free preview: the first FREE strips of each area, the free Code lab cases, area info
//   netlify/data/lab-full.json   every strip and every case, served by /api/lab-bank to Live Monitor subscribers
//   site/js/cl-codelab.js        the Code lab runner with the case content taken out (cases arrive as data)
//   site/js/cl-defib.js          the monitor / defibrillator
//   site/css/cardiac-lab.css     Cardiac Lab's styles, scoped under .cl so they don't touch the rest of the site
//   site/data/cl-twelve-rhythms.json
// Run: node scripts/build-lab.mjs   (part of `npm run build`)

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src/lab');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const write = (f, s) => { const p = path.join(ROOT, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); return s.length; };

export const FREE = 5;               // free strips per area
export const FREE_CASES = ['vf1', 'svt1'];  // free Code lab cases

// Practice areas, in the order they're shown.
export const AREAS = [
	{ key: 'sinus', title: 'Sinus rhythms', short: 'Sinus', color: 'var(--band-green)', soft: 'var(--green-soft)', ink: 'var(--green)', blurb: 'Normal sinus, bradycardia, tachycardia, sinus arrhythmia, sinus arrest and SA exit block.' },
	{ key: 'atrial', title: 'Atrial rhythms', short: 'Atrial', color: 'var(--band-blue)', soft: 'var(--blue-soft)', ink: 'var(--blue)', blurb: 'PACs, wandering atrial pacemaker, MAT, SVT, atrial flutter and atrial fibrillation.' },
	{ key: 'junctional', title: 'Junctional rhythms', short: 'Junctional', color: 'var(--band-teal)', soft: 'var(--teal-soft)', ink: 'var(--teal)', blurb: 'Junctional, junctional bradycardia, accelerated junctional, junctional tachycardia, PJCs and escape beats.' },
	{ key: 'ventricular', title: 'Ventricular rhythms', short: 'Ventricular', color: 'var(--band-red)', soft: 'var(--red-soft)', ink: 'var(--brand-red)', blurb: 'PVC patterns, runs of VT, idioventricular and AIVR, VT, torsades, VF, asystole and agonal rhythm.' },
	{ key: 'block', title: 'AV blocks', short: 'AV blocks', color: 'var(--band-orange)', soft: 'var(--orange-soft)', ink: 'var(--orange)', blurb: '1st degree, Wenckebach, Mobitz II, 2:1, high-grade and complete heart block.' },
	{ key: 'paced', title: 'Paced rhythms', short: 'Paced', color: 'var(--band-navy)', soft: 'var(--navy-soft)', ink: 'var(--navy)', blurb: 'Atrial, ventricular and dual-chamber pacing, demand pacing, pacer malfunction and transcutaneous pacing.' },
	{ key: 'field', title: 'Field strips: the back of the ambulance', short: 'Field', wide: true, color: 'linear-gradient(120deg,#3A4148,var(--band-orange) 60%,var(--band-red))', soft: 'var(--orange-soft)', ink: 'var(--orange)', blurb: 'Strips from every rhythm family the way they really look on a moving rig: breathing wander, road vibration, bumps, shivering and the odd loose electrode. Read the rhythm through the mess.' },
	{ key: 'twelve', title: '12-lead ECGs', short: '12-lead', wide: true, unit: 'ECGs', color: 'linear-gradient(120deg,var(--band-navy),var(--band-teal) 55%,var(--band-red))', soft: 'var(--navy-soft)', ink: 'var(--navy)', blurb: 'STEMI territories and equivalents (Wellens, de Winter, aVR), bundle branch blocks, WPW, LVH, Brugada, long QT, potassium problems, pericarditis and early repolarization, on full 12-lead printouts, including 50 recorded on scene. After a STEMI, name the culprit artery. Stuck? Call the cardiologist.' },
	{ key: 'random', title: 'Random ECG Practice Strips', short: 'Random', wide: true, color: 'linear-gradient(120deg,var(--band-blue),var(--band-navy))', soft: 'var(--blue-soft)', ink: 'var(--blue)', blurb: 'A mixed set from every rhythm family, in random order, with a patient scenario for each and a full interpretation after you answer.' }
];

/* ---------- practice data ---------- */
const random = JSON.parse(read('random.json'));
const CATS = random.cats;
const full = { version: 1, areas: {}, codelab: null };
const free = { free: FREE, areas: [], cats: CATS, data: {}, codelab: null };
// the 12-lead area brings its own interpretations
const TWELVE = JSON.parse(read('twelve.json'));
for (const [k, v] of Object.entries(TWELVE.cats || {})) { if (CATS[k]) throw new Error('12-lead category clashes with a strip category: ' + k); CATS[k] = v; }
for (const a of AREAS) {
	const d = a.key === 'twelve' ? TWELVE : JSON.parse(read(a.key + '.json'));
	for (const q of d.items) for (const c of [q.cat, ...q.options]) if (!CATS[c]) throw new Error(`${a.key}: no explanation for "${c}"`);
	// rhythm strips reference a shared strip table; 12-leads carry their own leads
	const pick = (items) => { const strips = {}; items.forEach((q) => { if (q.leads) { if (!q.leads.rhythm) throw new Error(`${a.key}: 12-lead ${q.n} has no rhythm strip`); return; } strips[q.strip] = d.strips[q.strip]; if (!strips[q.strip]) throw new Error(`${a.key}: missing strip ${q.strip}`); }); return strips; };
	const categories = d.categories || [...new Set(d.items.map((q) => q.cat))];
	full.areas[a.key] = { key: a.key, categories, items: d.items, strips: pick(d.items) };
	const fi = d.items.slice(0, FREE);
	free.data[a.key] = { key: a.key, categories, items: fi, strips: pick(fi), partial: true };
	free.areas.push({ ...a, total: d.items.length });
}

/* ---------- Code lab: run the source once to read its cases, then ship the runner without them ---------- */
const clSrc = read('codelab.js');
const ctx = { window: {}, console, Math, JSON, Date, localStorage: { getItem: () => null, setItem() {} }, document: { addEventListener() {} } };
ctx.window = ctx; ctx.window.addEventListener = () => {};
vm.createContext(ctx);
vm.runInContext(clSrc, ctx, { filename: 'codelab.js' });
const cases = JSON.parse(JSON.stringify(ctx.CodeLab.cases));
if (cases.length < 10) throw new Error('Code lab: expected the full case list, got ' + cases.length);
for (const id of FREE_CASES) if (!cases.some((c) => c.id === id)) throw new Error('Code lab: no free case ' + id);
full.codelab = { cases };
free.codelab = { cases: cases.filter((c) => FREE_CASES.includes(c.id)), total: cases.length,
	list: cases.map((c) => ({ id: c.id, cat: c.cat, title: c.title, text: c.text, steps: c.steps.length, free: FREE_CASES.includes(c.id) })) };

const START = '  /* ------------------------------------------------------------------ rhythms the monitor can show */';
const END = '  var CATS = [';
const a = clSrc.indexOf(START), b = clSrc.indexOf(END);
if (a < 0 || b < a) throw new Error('Code lab: case section markers not found');
let runner = clSrc.slice(0, a) +
	'  /* The cases are data: the free preview (window.CLCodeCases) or, for subscribers, from /api/lab-bank. See scripts/build-lab.mjs. */\n' +
	'  var CASES = (window.CLCodeCases || []).slice();\n' + clSrc.slice(b);
const EXP = '  window.CodeLab = {\n    cases: CASES, cats: CATS, levels: LEVELS,';
if (!runner.includes(EXP)) throw new Error('Code lab: export block not found');
runner = runner.replace(EXP, '  window.CodeLab = {\n    setCases: function (list) { CASES.length = 0; (list || []).forEach(function (c) { CASES.push(c); }); },\n    cases: CASES, cats: CATS, levels: LEVELS,');
// After a case, the Exit button and "All cases" go back to this site's list.
runner = '/* GENERATED by scripts/build-lab.mjs from src/lab/codelab.js. Edit the source, not this file. */\n' + runner;

/* ---------- the monitor / defibrillator ---------- */
let defib = read('defib.js');
const T12_URL = 'fetch("/twelve-rhythms.json?v=1")';
if (!defib.includes(T12_URL)) throw new Error('defib.js: 12-lead URL not found');
defib = defib.replace(T12_URL, 'fetch("data/cl-twelve-rhythms.json?v=1")');
// the 12-lead printout opens inside the scoped styles
const T12_APPEND = '    document.body.appendChild(wrap);';
if (!defib.includes(T12_APPEND)) throw new Error('defib.js: 12-lead dialog not found');
defib = defib.replace(T12_APPEND, '    (document.querySelector(".cl-portal") || document.body).appendChild(wrap);');
defib = '/* GENERATED by scripts/build-lab.mjs from src/lab/defib.js. Edit the source, not this file. */\n' + defib;

/* ---------- styles, scoped under .cl ---------- */
// Cardiac Lab's whole-page rules (page background, header, body resets) don't apply here.
const DROP_SEL = /^(html|body)(\s|$|::before|:has)|^body\{|^\.bar\b|^\.foot\b/;
const KEEP_GLOBAL = /^(html\.ecgv-open|body\.cl-full|html\.ecgv-open body)\b/;
function splitTop(s, ch) { const out = []; let depth = 0, cur = ''; for (const c of s) { if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--; if (c === ch && depth === 0) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out; }
function scopeSel(sel) {
	sel = sel.trim();
	if (!sel) return null;
	if (KEEP_GLOBAL.test(sel)) return sel;
	if (/^:root$/.test(sel)) return '.cl, .cl-portal';
	const m = /^:root((?::not\([^)]*\)|\[[^\]]*\])+)(.*)$/.exec(sel);          // :root[data-theme=dark] …, :root:not([data-theme=light]) …
	if (m) return m[2].trim() ? `:root${m[1]} .cl ${m[2].trim()}, :root${m[1]} .cl-portal ${m[2].trim()}` : `:root${m[1]} .cl, :root${m[1]} .cl-portal`;
	if (DROP_SEL.test(sel)) return null;
	return `.cl ${sel}, .cl-portal ${sel}`;
}
function scopeCss(css) {
	let out = '', i = 0;
	while (i < css.length) {
		const open = css.indexOf('{', i);
		if (open < 0) break;
		const head = css.slice(i, open).trim();
		// find the matching close brace
		let depth = 1, j = open + 1;
		while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
		const body = css.slice(open + 1, j - 1);
		const cleanHead = head.replace(/\/\*[\s\S]*?\*\//g, '').trim();
		if (/^@(media|supports)/.test(cleanHead)) { const inner = scopeCss(body); if (inner.trim()) out += cleanHead + '{' + inner + '}\n'; }
		else if (/^@/.test(cleanHead)) out += cleanHead + '{' + body + '}\n';      // @keyframes, @font-face: unchanged
		else {
			const sels = splitTop(cleanHead, ',').map(scopeSel).filter(Boolean);
			if (sels.length) out += sels.join(',') + '{' + body + '}\n';
		}
		i = j;
	}
	return out;
}
const css = '/* GENERATED by scripts/build-lab.mjs from src/lab/cardiac-lab.src.css: Cardiac Lab styles, scoped under .cl */\n' +
	scopeCss(read('cardiac-lab.src.css')) +
	// fit this site: its fonts, and a plain base inside the lab
	'.cl, .cl-portal{--f-display:"Montserrat",system-ui,sans-serif;--f-body:"Inter",system-ui,sans-serif;--f-vital:"Inter",system-ui,sans-serif;--f-mono:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace;color:var(--ink);font-family:var(--f-body);font-size:15px;line-height:1.55}\n' +
	'.cl{background:var(--bg);border-radius:18px;padding:18px}\n@media (max-width:600px){.cl{padding:8px 4px;border-radius:12px}}\n.cl *, .cl-portal *{box-sizing:border-box}\n';

/* ---------- write ---------- */
const freeJs = '/* GENERATED by scripts/build-lab.mjs: the free Lab preview (first ' + FREE + ' strips of each practice area, free Code lab cases). */\nwindow.CLLabFree=' + JSON.stringify(free) + ';\n';
const sizes = {
	free: write('site/js/cl-free.js', freeJs),
	full: write('netlify/data/lab-full.json', JSON.stringify(full)),
	runner: write('site/js/cl-codelab.js', runner),
	defib: write('site/js/cl-defib.js', defib),
	css: write('site/css/cardiac-lab.css', css),
	t12: write('site/data/cl-twelve-rhythms.json', read('twelve-rhythms.json'))
};
const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`Built the Cardiac Lab practice and Code lab: ${AREAS.length} areas (${AREAS.map((x) => x.key + ' ' + full.areas[x.key].items.length).join(', ')}), ${cases.length} Code lab cases. ` +
	`Free preview ${kb(sizes.free)} (site/js/cl-free.js), full bank ${kb(sizes.full)} (netlify/data/lab-full.json), styles ${kb(sizes.css)}.`);
