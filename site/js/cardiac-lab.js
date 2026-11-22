/* CSHealthED Cardiac Lab practice areas and Code lab, inside the Basic ECG Interpretation Lab.
   Loaded on demand by app.js for #practice, #practice-<area> and #codelab.

   window.CardiacLab = {
     tilesHTML(),                 the practice-area tiles for the Lab home
     area(el, key, host),         one practice area: rhythm strips with feedback, color-coded corrections, calipers,
                                  a zoomable viewer and cardiologist hints
     codelab(el, host),           the Code lab (live defibrillator + ACLS decisions)
     stop()
   }
   host = { subscribed(): bool, loadPart(part): Promise<data>, subscribeHTML(what): string }

   Free visitors see the first strips of each area (window.CLLabFree, built by scripts/build-lab.mjs);
   Live Monitor subscribers get every strip from /api/lab-bank. Everything renders inside a .cl wrapper,
   whose styles (css/cardiac-lab.css) are Cardiac Lab's, scoped so they don't touch the rest of the site. */
(function () {
  "use strict";
  var FREE = window.CLLabFree, CATS = FREE.cats, META = FREE.areas;
  var KEY = "cshealthed-cl-practice";
  var S = { ar: {}, cl: {} };
  try { var raw = JSON.parse(localStorage.getItem(KEY) || "null"); if (raw && typeof raw === "object") { S.ar = raw.ar || {}; S.cl = raw.cl || {}; S.cmin = !!raw.cmin; } } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function pct(c, t) { return t ? Math.round(100 * c / t) : 0; }
  function meta(key) { for (var i = 0; i < META.length; i++) if (META[i].key === key) return META[i]; return null; }
  var HOST = null, ROOT = null, VIEW_KEY = null;

  /* the ECG grid patterns the strips draw on, and a home for pop-ups that sit above the page */
  (function () {
    if (!document.getElementById("clDefs")) {
      var d = document.createElement("div"); d.id = "clDefs"; d.setAttribute("aria-hidden", "true"); d.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
      d.innerHTML = '<svg width="0" height="0"><defs>' +
        '<pattern id="pMinor" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" style="stroke:var(--grid-minor)" stroke-width="1.2" vector-effect="non-scaling-stroke"/></pattern>' +
        '<pattern id="pMajor" width="200" height="200" patternUnits="userSpaceOnUse"><rect width="200" height="200" fill="url(#pMinor)"/><path d="M200 0H0V200" fill="none" style="stroke:var(--grid-major)" stroke-width="2.2" vector-effect="non-scaling-stroke"/></pattern>' +
        '</defs></svg>';
      d.className = "cl"; d.style.padding = "0";
      document.body.appendChild(d);
    }
    if (!document.querySelector(".cl-portal")) { var p = document.createElement("div"); p.className = "cl-portal"; document.body.appendChild(p); }
  })();
  function portal() { return document.querySelector(".cl-portal"); }

  /* ---------- area data: the free preview, replaced by the full area for subscribers ---------- */
  var AREAS = {}, LOADING = {};
  function freeArea(key) { return FREE.data[key]; }
  function loadArea(key) {
    if (AREAS[key]) return Promise.resolve(AREAS[key]);
    if (!HOST.subscribed()) return Promise.resolve(freeArea(key));
    if (!LOADING[key]) LOADING[key] = HOST.loadPart(key).then(function (d) { AREAS[key] = d; return d; }, function (e) { LOADING[key] = null; throw e; });
    return LOADING[key];
  }

  /* ---------- waveform decoding & drawing (25 mm/s, 500 samples per second) ---------- */
  var H = 960;
  function Y(mv100) { return ((150 - mv100) * 4).toFixed(1); }
  var cache = {};
  function decodeStrip(strips, key) {
    if (cache[key]) return cache[key];
    var d = strips[key].d, v = [], cur = 0, i = 0;
    while (i < d.length) { var ch = d[i]; if (ch === "|") { var j = d.indexOf("|", i + 1); cur = parseInt(d.slice(i + 1, j), 10); v.push(cur); i = j + 1; } else { cur += d.charCodeAt(i) - 80; v.push(cur); i++; } }
    return (cache[key] = v);
  }
  function stripSVG(strips, key) {
    var VW = 6000, v = decodeStrip(strips, key), n = Math.min(v.length, Math.floor(VW / 2) + 1), pts = new Array(n);
    for (var i = 0; i < n; i++) pts[i] = (i * 2) + "," + Y(v[i]);
    var spikes = (strips[key].s || []).filter(function (s) { return s[0] <= VW; }).map(function (s) {
      var idx = Math.min(v.length - 1, Math.round(s[0] / 2)), base = v[idx];
      return '<line x1="' + s[0] + '" x2="' + s[0] + '" y1="' + Y(base) + '" y2="' + Y(base + s[1]) + '" stroke="var(--trace)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>';
    }).join("");
    return '<svg viewBox="0 0 ' + VW + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="ECG strip"><rect width="' + VW + '" height="' + H + '" fill="url(#pMajor)"/>' +
      '<g><polyline pathLength="1" points="' + pts.join(" ") + '" fill="none" stroke="var(--trace)" stroke-width="1.7" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>' + spikes + '</g></svg>';
  }

  var IC = {
    ok: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="8.2"/><path d="M6.2 10.3l2.5 2.5 5-5.2"/></svg>',
    no: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10" cy="10" r="8.2"/><path d="M7 7l6 6M13 7l-6 6"/></svg>',
    bulb: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 15h5M8 17.5h4M10 2.5a5 5 0 0 0-3 9c.6.5 1 1.2 1 2V14h4v-.5c0-.8.4-1.5 1-2a5 5 0 0 0-3-9z"/></svg>',
    expand: '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3h5v5M8 17H3v-5M17 3l-6 6M3 17l6-6"/></svg>',
    phone: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.2 2.8h2.4l1.2 3.4-1.7 1.1a9.6 9.6 0 0 0 5.6 5.6l1.1-1.7 3.4 1.2v2.4a1.6 1.6 0 0 1-1.7 1.6A14.2 14.2 0 0 1 3.6 4.5a1.6 1.6 0 0 1 1.6-1.7z"/></svg>',
    lock: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="9" width="12" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg>',
    ecg: '<svg viewBox="0 0 120 30" aria-hidden="true"><path d="M0 18h22l4-6 4 6h8l4-15 5 26 4-11h14l5-6 5 6h45" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>'
  };
  var REVEALED = "Revealed by the cardiologist";

  /* ---------- on-strip teaching marks (after a wrong answer) ---------- */
  var MKC = { ste: "#D9121A", std: "#0A6FDD", qrs: "#00838F", delta: "#C2185B", p: "#2E8B00", rr: "#02245D", pace: "#3949AB", miss: "#5F6B7A" };
  var MARK_NOTES = {
    "Atrial fibrillation": "No P waves: wavy baseline, and every R–R interval is different",
    "Atrial flutter": "Sawtooth flutter waves instead of P waves",
    "Supraventricular tachycardia (SVT)": "No visible P waves; fast and regular",
    "Multifocal atrial tachycardia (MAT)": "P waves change shape from beat to beat; rate over 100",
    "Wandering atrial pacemaker": "P waves change shape from beat to beat; rate under 100",
    "Ventricular fibrillation (coarse)": "Chaotic: no P, QRS or T anywhere",
    "Ventricular fibrillation (fine)": "Small chaotic waves, not a flat line: no P, QRS or T",
    "Polymorphic VT (torsades de pointes)": "QRS height twists up and down around the baseline",
    "Asystole": "Flat line: no electrical activity (confirm in a second lead)",
    "Agonal rhythm": "Rare, wide, slow complexes",
    "3rd-degree (complete) AV block": "P waves march through on their own; no fixed PR",
    "Junctional rhythm": "No upright P before the QRS", "Junctional bradycardia": "No upright P before the QRS",
    "Accelerated junctional rhythm": "No upright P before the QRS", "Junctional tachycardia": "No upright P before the QRS",
    "Idioventricular rhythm": "Wide QRS, no P waves, rate 20–40", "Accelerated idioventricular rhythm (AIVR)": "Wide QRS, no P waves, rate 40–100",
    "Monomorphic ventricular tachycardia": "Wide, fast, regular, all the same shape",
    "Pacer spikes without capture (asystole)": "Spikes with nothing after them"
  };
  var NO_RR = { "Ventricular fibrillation (coarse)": 1, "Ventricular fibrillation (fine)": 1, "Polymorphic VT (torsades de pointes)": 1, "Asystole": 1 };
  function markStrip(host, strips, key, cat, item) {
    var st = strips[key], m = st && st.m, svg = host && host.querySelector("svg:not(.cal-svg)");
    if (!m || !svg) return;
    var box = svg.parentNode; Array.prototype.slice.call(box.querySelectorAll(":scope > .mk-ov")).forEach(function (o) { o.remove(); });
    var VW = +(svg.getAttribute("viewBox") || "0 0 6000").split(/\s+/)[2] || 6000, v = decodeStrip(strips, key), grp = (CATS[cat] || {}).group, chb = /complete/.test(cat);
    var X = function (ms) { return (ms / VW * 100).toFixed(2) + "%"; };
    var edge = function (ms) { var f = ms / VW; return f < 0.06 ? " L" : (f > 0.94 ? " Rt" : ""); };
    var low = function (ms, win) { var a = Math.max(0, Math.round((ms - win) / 2)), b = Math.min(v.length - 1, Math.round((ms + win) / 2)), lo = 999; for (var i = a; i <= b; i++) if (v[i] < lo) lo = v[i]; return Y(lo) / H * 100; };
    var top = function (ms, win) { var a = Math.max(0, Math.round((ms - (win || 0)) / 2)), b = Math.min(v.length - 1, Math.round((ms + (win || 0)) / 2)), hi = -999; for (var i = a; i <= b; i++) if (v[i] > hi) hi = v[i]; return (Y(hi) / H * 100).toFixed(1) + "%"; };
    var h = "", near = function (list, x, tol) { return list.some(function (y) { return Math.abs(y - x) <= tol; }); };
    var wide = m.w || [], spikes = (st.s || []).map(function (x) { return x[0]; });
    var pairs = m.pr, blocked = m.b;
    if (!pairs) {
      pairs = []; blocked = [];
      m.p.forEach(function (p, i) { var nx = m.p[i + 1] == null ? 1e9 : m.p[i + 1], q = m.q.filter(function (x) { return x > p + 60 && x < p + 450 && x < nx; })[0];
        if (q != null && !near(wide, q, 5)) pairs.push([p, q, q - p]); else if (grp === "block") blocked.push(p); });
    }
    if (chb) { pairs = []; blocked = []; }
    m.p.forEach(function (p) { var bad = near(blocked, p, 6);
      h += '<span class="mk mk-p' + (bad ? ' bad' : '') + edge(p) + '" style="left:' + X(p) + ';top:' + top(p, 30) + '">' + (bad ? 'P · not conducted' : 'P') + '</span>'; });
    if ((grp === "sinus" || grp === "block" || /PACs/.test(cat)) && pairs.length) {
      pairs.forEach(function (x) { var q0 = x[1] - 38, p0 = q0 - x[2];
        h += '<span class="mk-br pr" style="left:' + X(p0) + ';width:' + (x[2] / VW * 100).toFixed(2) + '%"><b>PR ' + (x[2] / 1000).toFixed(2) + '</b></span>'; });
    }
    if (m.q.length >= 2 && !NO_RR[cat]) {
      for (var i = 1; i < m.q.length; i++) { var a = m.q[i - 1], d = m.q[i] - a;
        h += '<span class="mk-br rr" style="left:' + X(a) + ';width:' + (d / VW * 100).toFixed(2) + '%"><b>' + (d / 1000).toFixed(2) + '</b></span>'; }
    }
    var narrowToo = m.q.length > wide.length, paced = grp === "paced" || spikes.length > 0;
    var ront = item && /R-on-T/.test(item.name || ""), noted = item && (item.rows || []).filter(function (r) { return r[0] === "Also noted"; })[0];
    noted = noted ? noted[1] : "";
    wide.forEach(function (q) { var lbl = paced && spikes.some(function (c) { return q >= c - 5 && q - c <= 140; }) ? 'paced QRS' : (ront ? 'R on T · PVC' : (narrowToo && grp === "ventricular" ? 'PVC · wide' : 'wide QRS'));
      var t = parseFloat(top(q + 40, 90)), rc = lbl.indexOf("R on T") === 0 ? " ront" : "";
      if (t > 26) h += '<span class="mk mk-w' + rc + edge(q) + '" style="left:' + X(q) + ';top:' + t.toFixed(1) + '%">' + lbl + '</span>';
      else h += '<span class="mk mk-w under' + rc + edge(q) + '" style="left:' + X(q) + ';top:' + Math.min(low(q + 40, 120), 84).toFixed(1) + '%">' + lbl + '</span>'; });
    if (grp === "paced" || spikes.length) {
      spikes.forEach(function (c) { var cap = m.q.some(function (q) { return q >= c - 5 && q - c <= 140; });
        h += '<span class="mk mk-s' + (cap ? '' : ' bad') + edge(c) + '" style="left:' + X(c) + '">' + (cap ? '✓ capture' : '✗ no capture') + '</span>'; });
    }
    var narrow = m.q.filter(function (q) { return !near(wide, q, 5); });
    if (item && /pre-excitation/.test(item.name || "")) narrow.forEach(function (q) { h += '<span class="mk mk-d' + edge(q) + '" style="left:' + X(q - 55) + ';top:' + top(q - 55, 15) + '">delta</span>'; });
    if (/ST depression/.test(noted)) narrow.forEach(function (q) { h += '<span class="mk-band" style="left:' + X(q + 60) + ';width:' + (90 / VW * 100).toFixed(2) + '%"></span>'; });
    var note = MARK_NOTES[cat];
    if (note) h += '<span class="mk-note">' + esc(note) + '</span>';
    var ov = document.createElement("div"); ov.className = "mk-ov"; ov.setAttribute("aria-hidden", "true"); ov.innerHTML = h;
    box.appendChild(ov);
    var said = [], c = function (sel) { return ov.querySelectorAll(sel).length; };
    if (c(".mk-p")) said.push("P waves" + (c(".mk-p.bad") ? " (red: not conducted)" : ""));
    if (c(".mk-br.pr")) said.push("PR intervals");
    if (c(".mk-br.rr")) said.push("R–R intervals (seconds, across the top)");
    if (c(".mk-w.ront")) said.push("R-on-T PVCs landing on the T wave before them (red)");
    if (c(".mk-w:not(.ront)")) said.push("wide QRS complexes");
    if (c(".mk-s")) said.push("pacer spikes and whether they capture");
    if (c(".mk-d")) said.push("delta waves (slurred QRS start)");
    if (c(".mk-band")) said.push("ST depression (blue)");
    var KEYS = [[".mk-p:not(.bad)", MKC.p, "P waves"], [".mk-br.pr", MKC.p, "PR interval"], [".mk-p.bad", MKC.miss, "P not conducted"], [".mk-br.rr", MKC.rr, "R–R interval (s)"],
      [".mk-w:not(.ront)", MKC.qrs, "wide QRS"], [".mk-w.ront", MKC.ste, "R on T: PVC lands on the T wave"], [".mk-s:not(.bad)", MKC.pace, "pacer spike that captures"], [".mk-s.bad", MKC.miss, "pacer spike that doesn't"], [".mk-d", MKC.delta, "delta wave"], [".mk-band", MKC.std, "ST depression"]];
    var paper = box.closest(".paper"), keyEl = paper && paper.parentNode.querySelector(".mk-legend"); if (keyEl) keyEl.remove();
    if (paper) { var leg = document.createElement("div"); leg.className = "mk-legend";
      leg.innerHTML = '<b>Why it\'s ' + esc(cat) + ':</b>' + KEYS.filter(function (k) { return c(k[0]); }).map(function (k) { return '<span><i style="background:' + k[1] + '"></i>' + k[2] + '</span>'; }).join("") + (note ? '<span>' + esc(note) + '</span>' : '');
      paper.parentNode.insertBefore(leg, paper.nextSibling); }
    var hint = ROOT && ROOT.querySelector(".mk-hint span");
    if (hint) { var nm = cat.replace(/\s*\(.*\)$/, "");
      hint.textContent = "Look back at the strip: it's now marked up to show what makes this " + nm + "." + (said.length ? " Labeled: " + said.join(", ") + "." : "") + (note ? " " + note + "." : ""); }
  }

  /* ---------- 12-lead printout: four columns of three leads + a lead II rhythm strip ---------- */
  var LEAD_COLS = [["I", "II", "III"], ["aVR", "aVL", "aVF"], ["V1", "V2", "V3"], ["V4", "V5", "V6"]];
  function decodeStr(d) { var v = [], cur = 0, i = 0; while (i < d.length) { var ch = d[i]; if (ch === "|") { var j = d.indexOf("|", i + 1); cur = parseInt(d.slice(i + 1, j), 10); v.push(cur); i = j + 1; } else { cur += d.charCodeAt(i) - 80; v.push(cur); i++; } } return v; }
  function ecg12SVG(q) {
    var RH = 1200, BASE = 760, lines = "", labels = "";
    function pts(arr, x0, y0) { var o = new Array(arr.length); for (var i = 0; i < arr.length; i++) { var v = Math.max(-110, Math.min(185, arr[i])); o[i] = (x0 + i * 2) + "," + (y0 - v * 4).toFixed(1); } return o.join(" "); }
    LEAD_COLS.forEach(function (col, ci) { col.forEach(function (ld, ri) {
      var y0 = ri * RH + BASE, x0 = ci * 2500;
      lines += '<polyline points="' + pts(decodeStr(q.leads[ld]), x0, y0) + '"/>';
      labels += '<text x="' + (x0 + 50) + '" y="' + (ri * RH + 190) + '">' + ld + '</text>';
      if (ci > 0) lines += '<polyline points="' + x0 + ',' + (y0 - 170) + ' ' + x0 + ',' + (y0 + 170) + '"/>';
    }); });
    lines += '<polyline points="' + pts(decodeStr(q.leads.rhythm), 0, 3 * RH + BASE) + '"/>';
    labels += '<text x="50" y="' + (3 * RH + 190) + '">II</text>';
    return '<svg class="ecg12" viewBox="0 0 10000 4800" role="img" aria-label="12-lead ECG"><rect width="10000" height="4800" fill="url(#pMajor)"/>' +
      '<g fill="none" stroke="var(--trace)" stroke-width="1.9" stroke-linejoin="round" vector-effect="non-scaling-stroke">' + lines + '</g>' +
      '<g class="ldl" fill="var(--trace)">' + labels + '</g></svg>';
  }
  /* 12-lead teaching marks (after a wrong answer): one color per kind of finding, the same as on the strips */
  var MK12C = { ste: "#D9121A", std: "#0A6FDD", q: "#E05F00", t: "#8E24AA", qrs: "#00838F", delta: "#C2185B", volt: "#8D5B00", p: "#2E8B00", qt: "#B07A00" };
  var MK12_COLOR = { stu: MK12C.ste, j: MK12C.ste, brug: MK12C.ste, rec: MK12C.std, dw: MK12C.std, q: MK12C.q, tpk: MK12C.t, tinv: MK12C.t, tbi: MK12C.t,
    u: MK12C.qt, qt: MK12C.qt, rsr: MK12C.qrs, sw: MK12C.qrs, qs: MK12C.qrs, notch: MK12C.qrs, delta: MK12C.delta, volt: MK12C.volt, tallr: MK12C.volt, pr: MK12C.p };
  var MK12_KEY = [[MK12C.ste, "ST elevation (and its shape)", ["stu", "j", "brug"]], [MK12C.std, "ST depression: reciprocal, diffuse or upsloping", ["rec", "dw"]],
    [MK12C.q, "Q waves", ["q"]], [MK12C.t, "T-wave changes: peaked, inverted, biphasic", ["tpk", "tinv", "tbi"]],
    [MK12C.qrs, "QRS width and bundle branch patterns (rSR′, QS, notched R)", ["rsr", "sw", "qs", "notch"]], [MK12C.delta, "Delta wave (pre-excitation)", ["delta"]],
    [MK12C.volt, "Voltage and tall R waves", ["volt", "tallr"]], [MK12C.p, "PR segment", ["pr"]], [MK12C.qt, "QT interval and U waves", ["u", "qt"]]];
  function svgEl(tag, at) { var e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (var k in at) e.setAttribute(k, at[k]); return e; }
  function markECG12(host, q) {
    var svg = host && host.querySelector("svg.ecg12"), m = q.mk; if (!svg || !m) return;
    var old = svg.querySelector("g.mk12"); if (old) old.remove();
    var g = svgEl("g", { "class": "mk12" }), per = {}, used = {}, sum = {};
    var cell = function (ld) { for (var ci = 0; ci < LEAD_COLS.length; ci++) { var ri = LEAD_COLS[ci].indexOf(ld); if (ri >= 0) return [ri, ci]; } return [3, 0]; };
    m.f.forEach(function (x) {
      var ld = x[0], kind = x[1], label = x[2], v = x[3], col = MK12_COLOR[kind] || "#02245D", rc = cell(ld), ri = rc[0], ci = rc[1], y0 = ri * 1200 + 760;
      var d = (m.ld && m.ld[ld]) || m.d, lo = ci * 2500 + 120, hi = ci * 2500 + 2380;
      used[kind] = 1; var base = label.replace(/\s*[\d.]+\s*mm/g, "").replace(/\s+\(.*\)$/, "").trim(); if ((sum[base] = sum[base] || []).indexOf(ld) < 0) sum[base].push(ld);
      m.b.forEach(function (bt) { var c = bt[0], tp = bt[1]; if (c < lo || c > hi) return;
        var sh;
        if (kind === "stu" || kind === "rec" || kind === "j" || kind === "brug" || kind === "dw") {
          var x1 = c + d / 2, w = kind === "dw" ? 75 : 115, h = Math.max(Math.abs(v * 400), 16), yy = v >= 0 ? y0 - h : y0;
          sh = svgEl("rect", { x: x1, y: yy, width: w, height: h, rx: 8, fill: col, "fill-opacity": .3, stroke: col, "stroke-width": 9 });
        } else if (kind === "tpk" || kind === "tinv" || kind === "tbi" || kind === "u") {
          var cx = kind === "u" ? tp + 170 : tp, ry = Math.max(Math.abs(v * 400) / 2 + 45, 70);
          sh = svgEl("ellipse", { cx: cx, cy: y0 - v * 200, rx: kind === "u" ? 85 : 120, ry: ry, fill: col, "fill-opacity": .14, stroke: col, "stroke-width": 9 });
        } else if (kind === "pr") {
          sh = svgEl("rect", { x: c - d / 2 - 95, y: y0 - 55, width: 85, height: 110, rx: 10, fill: col, "fill-opacity": .2, stroke: col, "stroke-width": 8 });
        } else {
          var a = kind === "delta" ? c - d / 2 - 55 : (kind === "q" ? c - d / 2 - 18 : c - d / 2 - 22), b2 = kind === "delta" ? c - d / 2 + 25 : (kind === "q" ? c - d / 2 + 40 : c + d / 2 + 22);
          var top = y0 - Math.max(v, 0) * 400 - 45, bot = y0 - Math.min(v, 0) * 400 + 45;
          sh = svgEl("rect", { x: a, y: top, width: b2 - a, height: bot - top, rx: 12, fill: col, "fill-opacity": .13, stroke: col, "stroke-width": 9, "stroke-dasharray": "28 16" });
        }
        g.appendChild(sh); });
      var k = per[ld] = (per[ld] || 0) + 1;
      var tx = svgEl("text", { x: ci * 2500 + 330, y: ri * 1200 + 175 + (k - 1) * 125, fill: col, "class": "mk12-t" }); tx.textContent = label; g.appendChild(tx);
    });
    if (m.qt) { var yq = 3 * 1200 + 330, colq = MK12_COLOR.qt; used.qt = 1;
      g.appendChild(svgEl("path", { d: "M" + m.qt[0] + " " + (yq + 60) + "V" + yq + "H" + m.qt[1] + "V" + (yq + 60), fill: "none", stroke: colq, "stroke-width": 14 }));
      var tq = svgEl("text", { x: (m.qt[0] + m.qt[1]) / 2, y: yq - 30, fill: colq, "class": "mk12-t", "text-anchor": "middle" }); tq.textContent = m.qt[2]; g.appendChild(tq); sum[m.qt[2]] = ["II"]; }
    if (m.spr) { var ts = svgEl("text", { x: 330, y: 3 * 1200 + 175, fill: MK12C.delta, "class": "mk12-t" }); ts.textContent = m.spr; g.appendChild(ts); used.delta = 1; sum[m.spr] = ["II"]; }
    svg.appendChild(g);
    var paper = host.closest(".paper") || host, keyEl = paper.parentNode.querySelector(".mk-legend"); if (keyEl) keyEl.remove();
    var chips = MK12_KEY.filter(function (k) { return k[2].some(function (x) { return used[x]; }); }).map(function (k) { return '<span><i style="background:' + k[0] + '"></i>' + esc(k[1]) + '</span>'; }).join("");
    var leg = document.createElement("div"); leg.className = "mk-legend";
    leg.innerHTML = '<b>Why it\'s ' + esc(q.cat) + ':</b>' + (chips || '<span>No ST elevation or depression, normal QRS and intervals: nothing abnormal to mark.</span>');
    paper.parentNode.insertBefore(leg, paper.nextSibling);
    var hint = ROOT && ROOT.querySelector(".mk-hint span");
    if (hint) { var parts = Object.keys(sum).map(function (b) { return sum[b][0] === "II" && /QT|PR/.test(b) ? b + " (rhythm strip)" : b + " in " + sum[b].join(", "); });
      hint.textContent = "Look back at the ECG: the colored marks show why this is " + q.cat + ". " + (parts.length ? parts.join(" · ") + "." : "Nothing abnormal: no ST elevation or depression, normal QRS width and intervals."); }
  }
  /* 12-lead follow-up after a STEMI or STEMI equivalent: which coronary artery? */
  var VESSELS = ["Right coronary artery (RCA)", "Left anterior descending (LAD), mid or distal", "Proximal LAD", "Left circumflex (LCx)", "Left main or multivessel disease"];
  var VESSEL_OF = {
    "Inferior STEMI": [0, "Inferior STEMI is usually the RCA (about 80%); the rest are the circumflex. ST elevation bigger in III than II, with reciprocal depression in I and aVL, points to the RCA. Check V4R for right-ventricular involvement and be careful with nitrates."],
    "Anterior STEMI": [1, "Anterior STEMI (V1–V4) is the left anterior descending artery, which supplies the front of the left ventricle and the septum."],
    "Anterolateral STEMI": [2, "Elevation across the anterior and lateral leads (V2–V6, I, aVL) means a big territory: a proximal LAD occlusion before the diagonal branches. High risk of shock and arrhythmias."],
    "Lateral STEMI": [3, "Lateral STEMI (I, aVL, V5, V6) is usually the left circumflex (sometimes a diagonal branch of the LAD). Reciprocal depression shows up inferiorly."],
    "Posterior MI": [3, "Posterior MI is usually the left circumflex (sometimes the RCA's posterior descending branch). Confirm with posterior leads V7–V9."],
    "Wellens syndrome": [2, "Wellens T waves mean a critical proximal LAD stenosis that has reperfused. It can occlude again at any time: no stress testing, urgent cath."],
    "De Winter T waves": [2, "De Winter T waves are a STEMI equivalent from an acute proximal LAD occlusion: activate the cath lab."],
    "ST elevation in aVR with diffuse ST depression": [4, "ST elevation in aVR with widespread depression suggests left main or severe multivessel (often three-vessel) ischemia, or global subendocardial ischemia from another cause."]
  };
  function vesselHTML(q, st) {
    var v = VESSEL_OF[q.cat]; if (!v || st.p[q.n] == null) return "";
    st.v = st.v || {}; var picked = st.v[q.n], done = picked != null, letters = "ABCDE";
    var opts = VESSELS.map(function (o, i) { var cls = done ? (i === v[0] ? "is-right" : (i === picked ? "is-wrong" : "is-dim")) : "";
      return '<button class="opt ' + cls + '" data-v="' + i + '" ' + (done ? "disabled" : "") + '><span class="k">' + letters[i] + '</span><span>' + esc(o) + '</span></button>'; }).join("");
    var fb = done ? '<div class="fb ' + (picked === v[0] ? 'ok' : 'no') + '"><div class="verdict">' + (picked === v[0] ? IC.ok + 'Correct' : IC.no + 'Not quite: it\'s the ' + esc(VESSELS[v[0]].replace(/ \(.*\)/, "").replace(/, mid or distal/, ""))) + '</div><p class="fb-note">' + esc(v[1]) + '</p></div>' : '';
    return '<div class="card panel vessel-q"><div class="eyebrow">Follow-up question</div><h4>Which coronary artery is most likely involved?</h4><div class="opts" id="arVessel" role="group" aria-label="Culprit artery">' + opts + '</div><div aria-live="polite">' + fb + '</div></div>';
  }
  function vesselScore() { var st = S.ar.twelve, c = 0, a = 0; if (!st || !st.v) return { c: 0, a: 0 };
    Object.keys(st.v).forEach(function (n) { a++; if ((st.vok || {})[n]) c++; }); return { c: c, a: a }; }

  function feedbackHTML(q, chosen) {
    var ok = chosen === q.cat, C = CATS[q.cat], X = CATS[chosen], revealed = chosen === REVEALED;
    var h = '<div class="fb ' + (ok ? "ok" : "no") + '"><div class="verdict">' + (ok ? IC.ok + "Correct" : IC.no + (revealed ? "Answer revealed · counted as wrong" : "Not quite")) + '</div>';
    h += '<div class="answer-name">' + esc(q.name) + '</div>';
    if (!ok) h += '<p class="fb-note mk-hint">' + IC.bulb + '<span>Look back at the ' + (q.leads ? 'ECG' : 'strip') + ': it\'s now marked up to show what makes this ' + esc(q.cat.replace(/\s*\(.*\)$/, "")) + '.</span></p>';
    if (revealed) h += '<p class="fb-note">The cardiologist talked you through this one, so it counts as wrong. Here\'s the full explanation.</p>';
    else if (!ok && X) h += '<div class="why"><div><small>You chose</small><b>' + esc(chosen) + '</b>' + esc(X.key) + '</div><div><small>' + (q.leads ? 'This ECG is' : 'This strip is') + '</small><b>' + esc(q.cat) + '</b>' + esc(C.key) + '</div></div>';
    if (C) h += '<div class="clue">' + IC.bulb + '<p><b>The tell: </b>' + esc(C.clue) + '</p></div>';
    h += '<div class="interp"><table class="itable"><tbody>' + q.rows.map(function (r) { return '<tr><th scope="row">' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join("") + '</tbody></table>';
    h += '<div class="action"><h4>Field action</h4><ul>' + q.action.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join("") + '</ul></div></div></div>';
    return h;
  }

  /* ---------- progress ---------- */
  function areaState(key) { if (!S.ar[key]) S.ar[key] = { pi: 1, p: {}, ok: {} }; if (!S.ar[key].ok) S.ar[key].ok = {}; return S.ar[key]; }
  function areaScore(key) {
    var st = S.ar[key], a = 0, c = 0, m = meta(key);
    if (st) Object.keys(st.p).forEach(function (n) { a++; if (st.ok && st.ok[n]) c++; });
    return { a: a, c: c, t: m ? m.total : 0 };
  }

  /* ---------- Lab home tiles ---------- */
  function tile(href, color, soft, ink, wide, icon, note, title, blurb, p, foot, go) {
    return '<a class="area-tile' + (wide ? ' wide' : '') + '" href="' + href + '" style="--ac:' + color + ';--as:' + soft + ';--ai:' + ink + '">' +
      '<span class="area-band"><span class="area-ecg' + (icon === IC.bolt ? ' area-bolt' : '') + '">' + icon + '</span><span class="area-count num">' + esc(note) + '</span></span>' +
      '<span class="area-body"><b>' + esc(title) + '</b><span class="area-blurb">' + esc(blurb) + '</span><span class="progress"><i style="width:' + p + '%"></i></span>' +
      '<span class="area-foot"><span class="num">' + esc(foot) + '</span><span class="area-go">' + esc(go) + ' →</span></span></span></a>';
  }
  function tilesHTML() {
    var sub = HOST && HOST.subscribed(), n = FREE.free;
    var t = META.map(function (m) {
      var sc = areaScore(m.key), started = sc.a > 0, done = sc.a >= sc.t;
      return tile('#practice-' + m.key, m.color, m.soft, m.ink, m.wide, IC.ecg, m.total + ' ' + (m.unit || 'strips') + (sub ? '' : ' · first ' + n + ' free'), m.title, m.blurb, pct(sc.a, sc.t),
        started ? sc.a + ' of ' + sc.t + ' answered · ' + pct(sc.c, sc.a) + '% correct' : 'Not started', done ? 'Review' : (started ? 'Resume' : 'Start'));
    }).join("");
    var cl = FREE.codelab, run = Object.keys(S.cl).length, passed = Object.keys(S.cl).filter(function (k) { return S.cl[k] && S.cl[k].ok; }).length;
    t += tile('#codelab', 'linear-gradient(120deg,var(--band-navy),var(--band-red) 60%,var(--band-orange))', 'var(--red-soft)', 'var(--brand-red)', true, IC.bolt,
      cl.total + ' cases' + (sub ? '' : ' · ' + cl.cases.length + ' free'), 'Code lab: run a real code',
      'The live defibrillator and ACLS decisions together. Practice one algorithm or a full megacode from pre-arrest to post-arrest care, at Beginner, Intermediate or “I Got This”.',
      pct(run, cl.total), run ? run + ' of ' + cl.total + ' run · ' + passed + ' passed' : 'Not started', run ? 'Resume' : 'Start');
    return '<div class="cl cl-tiles"><div class="area-grid">' + t + '</div></div>';
  }

  /* ---------- one practice area ---------- */
  function area(el, key, host) {
    stop(); HOST = host; VIEW_KEY = key;
    var m = meta(key); if (!m) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="cl"><section class="view" id="v-area" style="--accent:' + m.ink + ';--accent-soft:' + m.soft + '"><div id="arBody"><div class="card panel"><p class="empty">Loading ' + esc(m.title.toLowerCase()) + '…</p></div></div></section></div>';
    ROOT = el.querySelector(".cl");
    loadArea(key).then(function () { if (VIEW_KEY === key) renderArea(key); }, function () {
      if (VIEW_KEY !== key) return;
      ROOT.querySelector("#arBody").innerHTML = '<div class="card panel"><h3>This practice area couldn\'t load</h3><p class="empty">Check your connection and try again.</p><button class="btn btn-primary" id="arRetry">Try again</button></div>';
      ROOT.querySelector("#arRetry").onclick = function () { area(el, key, host); };
    });
  }
  function $(id) { return ROOT && ROOT.querySelector("#" + id); }
  function scrollTop() { window.scrollTo({ top: 0, behavior: "auto" }); }
  function renderArea(key) {
    var m = meta(key), data = AREAS[key] || freeArea(key), body = $("arBody"); if (!body) return;
    var st = areaState(key), total = m.total, avail = data.items.length, partial = avail < total, twelve = !!(data.items[0] && data.items[0].leads), unit = twelve ? "ECG" : "Strip";
    if (st.pi > total + 1) st.pi = 1;
    var sc = areaScore(key);
    var head = '<div class="qhead"><div><div class="eyebrow">Lab · ' + esc(m.title) + '</div><h2>' + (st.pi > total ? 'Results' : unit + ' <span class="num">' + st.pi + '</span><span> / ' + total + '</span>') + '</h2></div>' +
      '<div class="qstats"><span>Answered <b class="num">' + sc.a + '</b></span><span>Correct <b class="num">' + sc.c + '</b></span><span>Score <b class="num">' + (sc.a ? pct(sc.c, sc.a) + '%' : '–') + '</b></span>' + (twelve && vesselScore().a ? '<span>Vessel <b class="num">' + vesselScore().c + '/' + vesselScore().a + '</b></span>' : '') + '<a class="btn btn-ghost" href="#monitor">All of the Lab</a></div></div>' +
      '<div class="progress" style="margin-bottom:16px"><i style="width:' + pct(sc.a, total) + '%"></i></div>';
    renderCardioPop(null);
    if (st.pi > total) { body.innerHTML = head + summaryHTML(key, data); bindSummary(key); return; }
    if (st.pi > avail) {
      body.innerHTML = head + '<div class="card panel area-locked" style="--ac:' + m.color + '"><span class="sv-ic">' + IC.lock + '</span><h3>You\'ve finished the free ' + (twelve ? '12-lead ECGs' : 'strips in ' + esc(m.title.toLowerCase())) + '</h3>' +
        '<p class="empty">The first ' + avail + ' of ' + total + ' ' + (twelve ? 'ECGs' : 'strips') + ' are free. A Live Monitor subscription unlocks all ' + total + ', every other practice area and the whole Code lab.</p>' +
        HOST.subscribeHTML() + '<div class="qnav" style="justify-content:flex-start"><button class="btn btn-ghost" id="arBack">← Back to strip ' + avail + '</button></div></div>';
      $("arBack").onclick = function () { st.pi = avail; save(); renderArea(key); scrollTop(); };
      return;
    }
    var q = data.items[st.pi - 1], chosen = st.p[q.n], done = chosen != null, letters = "ABCD";
    var opts = q.options.map(function (o, i) {
      var cls = done ? (o === q.cat ? "is-right" : (o === chosen ? "is-wrong" : "is-dim")) : "";
      return '<button class="opt ' + cls + '" data-o="' + esc(o) + '" ' + (done ? "disabled" : "") + '><span class="k">' + letters[i] + '</span><span>' + esc(o) + '</span></button>';
    }).join("");
    var dots = "";
    for (var n = 1; n <= total; n++) { var x = st.p[n], c = x == null ? "" : (st.ok[n] ? "r" : "w"), lockd = n > avail;
      dots += '<button class="dot ' + c + (n === st.pi ? " cur" : "") + '" data-n="' + n + '" aria-label="' + unit + ' ' + n + (lockd ? ' (subscribers)' : '') + '"' + (lockd ? ' disabled' : '') + '>' + n + '</button>'; }
    var vq = twelve ? vesselHTML(q, st) : "";
    body.innerHTML = head + '<div class="card qcard"><div class="strip-top"><div class="stem"><span class="tag">' + esc(m.short) + '</span><p>' + esc(q.stem || (twelve ? 'Interpret this 12-lead ECG.' : 'Identify this rhythm.')) + '</p></div>' + (q.hints ? cardioBtnHTML(q, st, done) : '') + '</div>' +
      '<p class="ecg-tip">' + IC.expand + '<span><b>Tip:</b> click the ' + (twelve ? 'ECG' : 'strip') + ' to open it full screen. Zoom with + / −, the mouse wheel or a pinch, double-click to zoom in on a spot, and drag to move around. Use the calipers to measure.</span></p>' +
      '<div><div class="paper">' + (twelve ? ecg12SVG(q) : stripSVG(data.strips, q.strip)) + '</div><div class="paper-meta"><span>' +
        (twelve ? '12-lead · 25 mm/s · 10 mm/mV · bottom row: lead II rhythm strip' + (q.field ? ' · recorded on scene, real patient' : '') + '</span><span><button class="btn btn-ghost ecg-expand" data-expand="1" type="button">' + IC.expand + 'Expand and zoom</button>'
          : 'Lead II · 25 mm/s · 6-second strip' + (key === "field" ? ' · recorded in a moving ambulance' : '')) + '</span><span class="scroll-hint"></span></div></div>' +
      (vq
        ? '<div class="answered-line ' + (chosen === q.cat ? 'ok' : 'no') + '"><span class="eyebrow">Your interpretation</span><b>' + esc(chosen === REVEALED ? 'Revealed by the cardiologist' : chosen) + '</b><span>' + (chosen === q.cat ? '✓ Correct' : '✗ It\'s ' + esc(q.cat)) + '</span><div class="opts" id="arOpts" hidden>' + opts + '</div></div>' + vq
        : '<div><div class="eyebrow" style="margin-bottom:10px">' + (twelve ? 'What does it show?' : 'Identify the rhythm') + '</div><div class="opts" id="arOpts" role="group" aria-label="Answer choices">' + opts + '</div></div>') +
      '<div aria-live="polite">' + (done ? feedbackHTML(q, chosen) : '') + '</div>' +
      '<div class="qnav"><button class="btn btn-ghost" id="arPrev" ' + (st.pi === 1 ? 'disabled' : '') + '>← Previous</button><button class="btn btn-primary" id="arNext">' + (st.pi === total ? 'See area results →' : (done ? 'Next ' + unit.toLowerCase() + ' →' : 'Skip →')) + '</button></div></div>' +
      '<details class="card grid-nav"><summary>All ' + total + ' ' + unit.toLowerCase() + 's in this area' + (partial ? ' (the first ' + avail + ' are free)' : '') + '</summary><div class="dots" id="arDots">' + dots + '</div><div class="legend"><span><i style="background:var(--ok)"></i>Correct</span><span><i style="background:var(--bad)"></i>Incorrect</span><span><i style="background:var(--line-2)"></i>Not answered</span></div></details>';
    if ($("arCardioBtn")) $("arCardioBtn").onclick = function () { callCardiologist(key, q, st); };
    if ($("arCardioShow")) $("arCardioShow").onclick = function () { S.cmin = false; save(); renderCardioPop(q, st, done); };
    renderCardioPop(q.hints ? q : null, st, done);
    $("arOpts").onclick = function (e) { var b = e.target.closest(".opt"); if (!b || b.disabled) return; st.p[q.n] = b.getAttribute("data-o"); st.ok[q.n] = st.p[q.n] === q.cat; save(); renderArea(key);
      if ($("arVessel")) setTimeout(function () { var vqEl = ROOT.querySelector("#v-area .vessel-q"); if (vqEl) vqEl.scrollIntoView({ block: "nearest" }); }, 60); };
    if ($("arVessel")) $("arVessel").onclick = function (e) { var b = e.target.closest(".opt"); if (!b || b.disabled) return; st.v = st.v || {}; st.v[q.n] = +b.getAttribute("data-v"); st.vok = st.vok || {}; st.vok[q.n] = st.v[q.n] === VESSEL_OF[q.cat][0]; save(); renderArea(key);
      var vf = ROOT.querySelector("#v-area .vessel-q .fb"); if (vf) vf.scrollIntoView({ block: "nearest" }); };
    $("arPrev").onclick = function () { if (st.pi > 1) { st.pi--; save(); renderArea(key); scrollTop(); } };
    $("arNext").onclick = function () { st.pi++; save(); renderArea(key); scrollTop(); };
    $("arDots").onclick = function (e) { var b = e.target.closest(".dot"); if (!b || b.disabled) return; st.pi = +b.getAttribute("data-n"); save(); renderArea(key); scrollTop(); };
    if (done && chosen !== q.cat) { if (twelve) markECG12(ROOT.querySelector("#v-area .paper"), q); else markStrip(ROOT.querySelector("#v-area .paper"), data.strips, q.strip, q.cat, q); }
    fitStrip(); setTimeout(fitStrip, 0);
  }
  /* scale the strip to the screen so it's visible without scrolling */
  function fitStrip() {
    var svg = ROOT && ROOT.querySelector("#v-area .paper svg:not(.cal-svg)"); if (!svg) return;
    var paper = svg.closest(".paper"), wrap = svg.closest(".cal-wrap"), card = paper.closest(".qcard") || paper, meta2 = paper.nextElementSibling;
    var hdr = document.querySelector(".site-header"), bar = hdr ? hdr.getBoundingClientRect().height : 0;
    var topOf = function (el2) { return el2.getBoundingClientRect().top + window.scrollY; };
    var band = wrap && wrap.classList.contains("cal-on") ? 80 : 0, metaH = meta2 ? meta2.getBoundingClientRect().height + 10 : 0;
    var availH = window.innerHeight - bar - 20 - (topOf(paper) - topOf(card)) - band - metaH - 4, availW = paper.clientWidth;
    var vb = (svg.getAttribute("viewBox") || "0 0 6000 960").split(/\s+/), aspect = (+vb[2]) / (+vb[3] || 1);
    var w = Math.floor(Math.max(Math.min(300, availW), Math.min(availW, availH * aspect)));
    if (wrap) { svg.style.width = ""; svg.style.minWidth = ""; wrap.style.width = w + "px"; wrap.style.minWidth = "0"; wrap.style.margin = "0 auto"; }
    else { svg.style.width = w + "px"; svg.style.minWidth = "0"; svg.style.margin = "0 auto"; }
    if (window.__clCalUpdate) window.__clCalUpdate();
  }
  function summaryHTML(key, data) {
    var st = areaState(key), sc = areaScore(key), byCat = {};
    data.categories.forEach(function (c) { byCat[c] = [0, 0]; });
    data.items.forEach(function (q) { var b = byCat[q.cat] || (byCat[q.cat] = [0, 0]); var x = st.p[q.n]; if (x != null) { b[1]++; if (st.ok[q.n]) b[0]++; } });
    var rows = Object.keys(byCat).map(function (c) { var b = byCat[c]; return '<div class="barrow"><span>' + esc(c) + '</span><span class="track"><i style="width:' + pct(b[0], b[1]) + '%"></i></span><b>' + (b[1] ? b[0] + '/' + b[1] : '—') + '</b></div>'; }).join("");
    var missed = data.items.filter(function (q) { var x = st.p[q.n]; return x != null && !st.ok[q.n]; });
    return '<div class="card panel area-sum"><div class="area-sum-top"><div><div class="eyebrow">Area score</div><h3 class="num">' + sc.c + ' of ' + sc.a + ' answered correct</h3></div>' +
      '<div class="area-big num">' + (sc.a ? pct(sc.c, sc.a) + '%' : '–') + '</div></div><h4>By rhythm type</h4><div class="bars">' + rows + '</div>' +
      (missed.length ? '<h4>Missed strips</h4><div class="missed" id="arMissed">' + missed.map(function (q) { return '<button data-n="' + q.n + '"><b>#' + q.n + '</b><span style="color:var(--ink)">' + esc(q.name) + '</span></button>'; }).join("") + '</div>' : '') +
      '<div class="qnav" style="justify-content:flex-start"><a class="btn btn-primary" href="#monitor">Back to the Lab</a><button class="btn btn-ghost" id="arReview">Review from strip 1</button><span id="arReset"><button class="btn btn-ghost" id="arAsk">Start this area over</button></span></div></div>';
  }
  function bindSummary(key) {
    var st = areaState(key);
    if ($("arMissed")) $("arMissed").onclick = function (e) { var b = e.target.closest("button"); if (!b) return; st.pi = +b.getAttribute("data-n"); save(); renderArea(key); scrollTop(); };
    $("arReview").onclick = function () { st.pi = 1; save(); renderArea(key); scrollTop(); };
    $("arAsk").onclick = function () {
      $("arReset").innerHTML = '<span class="confirm"><span>Clear your answers in this area?</span><button class="btn btn-primary" id="arYes">Clear</button><button class="btn btn-ghost" id="arNo">Cancel</button></span>';
      $("arYes").onclick = function () { S.ar[key] = { pi: 1, p: {}, ok: {} }; save(); renderArea(key); scrollTop(); };
      $("arNo").onclick = function () { renderArea(key); };
    };
  }
  document.addEventListener("keydown", function (e) {
    if (!VIEW_KEY || !ROOT || !document.body.contains(ROOT) || e.target.closest("input,textarea,select,.cal-ov,.ecgv") || !$("arOpts")) return;
    var idx = "ABCD".indexOf(e.key.toUpperCase());
    if (e.key.toUpperCase() === "H" && $("arCardioBtn")) { $("arCardioBtn").click(); return; }
    if (idx >= 0) { var btn = $("arOpts").children[idx]; if (btn && !btn.disabled) btn.click(); }
    else if (e.key === "ArrowRight") $("arNext").click();
    else if (e.key === "ArrowLeft" && !$("arPrev").disabled) $("arPrev").click();
  });
  window.addEventListener("resize", function () { if (VIEW_KEY && ROOT && document.body.contains(ROOT)) fitStrip(); });

  /* ---------- "Call the cardiologist": three hints, then the answer ---------- */
  function cardioBtnHTML(q, st, done) {
    st.h = st.h || {};
    var used = Math.min(st.h[q.n] || 0, 3);
    if (done) return used ? '<button class="btn cardio-btn ghost" id="arCardioShow">' + IC.phone + '<span>Cardiologist</span><small>' + (st.p[q.n] === REVEALED ? 'answer revealed' : used + ' hint' + (used === 1 ? '' : 's') + ' used') + '</small></button>' : '';
    var tip = 'Each call gives you a hint. The 4th call reveals the answer and counts it as wrong.';
    return used < 3
      ? '<button class="btn cardio-btn" id="arCardioBtn" title="' + tip + '">' + IC.phone + '<span>Call the cardiologist</span><small>hint ' + (used + 1) + ' of 3</small></button>'
      : '<button class="btn cardio-btn reveal" id="arCardioBtn" title="' + tip + '">' + IC.phone + '<span>Call again for the answer</span><small>counts as wrong</small></button>';
  }
  function renderCardioPop(q, st, done, fresh) {
    var pop = portal().querySelector("#cardioPop");
    if (!pop) { pop = document.createElement("aside"); pop.id = "cardioPop"; pop.className = "cardio-pop"; pop.hidden = true; pop.setAttribute("aria-label", "Cardiologist hints"); portal().appendChild(pop); }
    if (!q) { pop.hidden = true; return; }
    st.h = st.h || {};
    var used = Math.min(st.h[q.n] || 0, 3), revealed = st.p[q.n] === REVEALED;
    if (!used) { pop.hidden = true; return; }
    var min = !!S.cmin;
    var sub = revealed ? 'Answer revealed after 3 hints' : (done ? used + ' hint' + (used === 1 ? '' : 's') + ' used' : used + ' of 3 hints' + (used === 3 ? ' · next call reveals the answer' : ''));
    var list = q.hints.slice(0, used).map(function (h, i) { return '<li class="' + (fresh && i === used - 1 ? 'new' : '') + '"><b>Hint ' + (i + 1) + '</b><p>' + esc(h) + '</p></li>'; }).join("");
    pop.className = 'cardio-pop' + (min ? ' min' : '');
    pop.innerHTML = '<button class="cardio-pop-head" id="cardioToggle" aria-expanded="' + (!min) + '" aria-controls="cardioPopBody" title="' + (min ? 'Show hints' : 'Minimize') + '">' +
        '<span class="cardio-av">' + IC.phone + '</span><span class="cardio-pop-t"><b>Cardiologist on the line</b><small>' + sub + '</small></span>' +
        '<span class="cardio-min" aria-hidden="true">' + (min ? '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12l5-5 5 5"/></svg>' : '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 10h10"/></svg>') + '</span></button>' +
      '<div class="cardio-pop-body" id="cardioPopBody" role="status" aria-live="polite"' + (min ? ' hidden' : '') + '><ol class="cardio-hints">' + list + '</ol>' +
        (!done && used < 3 ? '<p class="cardio-pop-note">Still stuck? Call again for hint ' + (used + 1) + ' of 3.</p>' : '') +
        (!done && used === 3 ? '<p class="cardio-pop-note">One more call reveals the answer and counts it as wrong.</p>' : '') + '</div>';
    pop.hidden = false;
    pop.querySelector("#cardioToggle").onclick = function () { S.cmin = !S.cmin; save(); renderCardioPop(q, st, done); };
  }
  function callCardiologist(key, q, st) {
    st.h = st.h || {};
    var used = st.h[q.n] || 0;
    if (st.p[q.n] != null) return;
    if (used < 3) st.h[q.n] = used + 1;
    else { st.h[q.n] = 4; st.p[q.n] = REVEALED; st.ok[q.n] = false; }
    S.cmin = false; save(); renderArea(key);
    if (used < 3) renderCardioPop(q, st, false, true);
    else { var el = ROOT.querySelector("#v-area .fb"); if (el) el.scrollIntoView({ behavior: "auto", block: "center" }); }
  }

  /* ---------- the Code lab (live defibrillator) ---------- */
  var CODE_READY = null;
  function loadScriptOnce(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[src="' + src + '"]')) { res(); return; }
      var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  function codelab(el, host) {
    stop(); HOST = host; VIEW_KEY = null;
    el.innerHTML = '<div class="cl cl-code"><section class="view" id="v-codelab"><div id="clRoot"><div class="card panel"><p class="empty">Loading the Code lab…</p></div></div></section></div>';
    ROOT = el.querySelector(".cl");
    var me = ROOT;
    if (!CODE_READY) CODE_READY = (window.DefibLab ? Promise.resolve() : loadScriptOnce("js/cl-defib.js?v=1")).then(function () {
      window.CLCodeCases = FREE.codelab.cases; return window.CodeLab ? null : loadScriptOnce("js/cl-codelab.js?v=1"); });
    var cases = host.subscribed() ? host.loadPart("codelab").then(function (d) { return d.cases; }, function () { return FREE.codelab.cases; }) : Promise.resolve(FREE.codelab.cases);
    Promise.all([CODE_READY, cases]).then(function (r) {
      if (ROOT !== me || !document.body.contains(me)) return;
      window.CodeLab.setCases(r[1]);
      var rootEl = me.querySelector("#clRoot");
      window.CodeLab.render(rootEl, { esc: esc, load: function (id) { return S.cl[id] || null; }, save: function (id, res) { S.cl[id] = res; save(); } });
      if (!host.subscribed()) {
        var note = document.createElement("div"); note.className = "card panel cl-upsell";
        note.innerHTML = '<p class="empty"><b>Free preview:</b> ' + FREE.codelab.cases.length + ' of ' + FREE.codelab.total + ' cases are open. A Live Monitor subscription unlocks all ' + FREE.codelab.total + ' cases, including the full megacodes.</p>' + host.subscribeHTML();
        rootEl.insertBefore(note, rootEl.children[1] || null);
      }
    }, function () {
      if (ROOT !== me) return;
      me.querySelector("#clRoot").innerHTML = '<div class="card panel"><h3>The Code lab couldn\'t load</h3><p class="empty">Check your connection and try again.</p></div>';
    });
  }

  function stop() {
    VIEW_KEY = null;
    if (window.CodeLab) window.CodeLab.stop();
    var pop = portal().querySelector("#cardioPop"); if (pop) pop.hidden = true;
    var t = portal().querySelector(".t12"); if (t) t.remove();
  }

  /* ================= zoom viewer: click a strip to open it big, then zoom and pan ================= */
  (function () {
    var ECGV = { s: 1, x: 0, y: 0, w: 0, h: 0, ptrs: {}, pinch: null, last: null, opener: null };
    function g(id) { return document.getElementById(id); }
    function open(srcSvg, title) {
      var ov = g("ecgView");
      if (!ov) {
        ov = document.createElement("div"); ov.id = "ecgView"; ov.className = "ecgv"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-labelledby", "ecgvTitle");
        ov.innerHTML = '<div class="ecgv-bar"><b id="ecgvTitle">Rhythm strip</b><span class="ecgv-help">Scroll or pinch to zoom · drag to move · double-click to zoom in</span>' +
          '<div class="ecgv-tools"><button class="btn btn-ghost" id="ecgvOut" aria-label="Zoom out">−</button><output id="ecgvPct" aria-live="polite">100%</output><button class="btn btn-ghost" id="ecgvIn" aria-label="Zoom in">+</button>' +
          '<button class="btn btn-ghost" id="ecgvFit">Fit</button><button class="btn btn-primary" id="ecgvClose" aria-label="Close the viewer">Close ✕</button></div></div>' +
          '<div class="ecgv-stage" id="ecgvStage" tabindex="0" aria-label="ECG. Use plus and minus to zoom and the arrow keys to move."><div class="ecgv-inner" id="ecgvInner"></div></div>';
        portal().appendChild(ov);
        var st = g("ecgvStage");
        g("ecgvClose").onclick = close;
        g("ecgvIn").onclick = function () { zoomAt(1.5); };
        g("ecgvOut").onclick = function () { zoomAt(1 / 1.5); };
        g("ecgvFit").onclick = fit;
        st.addEventListener("wheel", function (e) { e.preventDefault(); var r = st.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0018), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
        st.addEventListener("dblclick", function (e) { var r = st.getBoundingClientRect(); zoomAt(2, e.clientX - r.left, e.clientY - r.top); });
        st.addEventListener("pointerdown", function (e) { st.setPointerCapture(e.pointerId); ECGV.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY }; ECGV.last = { x: e.clientX, y: e.clientY }; st.classList.add("grab"); ECGV.pinch = null; });
        st.addEventListener("pointermove", function (e) {
          var p = ECGV.ptrs[e.pointerId]; if (!p) return;
          p.x = e.clientX; p.y = e.clientY;
          var ids = Object.keys(ECGV.ptrs);
          if (ids.length >= 2) { var a = ECGV.ptrs[ids[0]], b = ECGV.ptrs[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y), r = st.getBoundingClientRect();
            if (ECGV.pinch) zoomAt(d / ECGV.pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); ECGV.pinch = d; return; }
          ECGV.x += e.clientX - ECGV.last.x; ECGV.y += e.clientY - ECGV.last.y; ECGV.last = { x: e.clientX, y: e.clientY }; apply();
        });
        var up = function (e) { delete ECGV.ptrs[e.pointerId]; ECGV.pinch = null; var ids = Object.keys(ECGV.ptrs); if (ids.length) ECGV.last = { x: ECGV.ptrs[ids[0]].x, y: ECGV.ptrs[ids[0]].y }; else st.classList.remove("grab"); };
        st.addEventListener("pointerup", up); st.addEventListener("pointercancel", up);
        ov.addEventListener("keydown", function (e) {
          if (e.key === "Escape") { e.preventDefault(); close(); return; }
          if (e.key === "+" || e.key === "=") zoomAt(1.5); else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.5); else if (e.key === "0") fit();
          else if (e.key === "ArrowLeft") { ECGV.x += 80; apply(); } else if (e.key === "ArrowRight") { ECGV.x -= 80; apply(); }
          else if (e.key === "ArrowUp") { ECGV.y += 80; apply(); } else if (e.key === "ArrowDown") { ECGV.y -= 80; apply(); }
          else if (e.key === "Tab") { var f = [].slice.call(ov.querySelectorAll("button,[tabindex='0']")), i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } return; }
          else return;
          e.preventDefault();
        });
        window.addEventListener("resize", function () { if (!g("ecgView").hidden) fit(); });
      }
      ECGV.opener = document.activeElement;
      var clone = srcSvg.cloneNode(true); clone.removeAttribute("style"); clone.removeAttribute("class"); clone.classList.add("ecgv-svg"); if (srcSvg.classList.contains("ecg12")) clone.classList.add("ecg12");
      g("ecgvInner").innerHTML = ""; g("ecgvInner").appendChild(clone);
      var mk = srcSvg.parentNode.querySelector(":scope > .mk-ov"); if (mk) { var mc = mk.cloneNode(true); mc.style.top = "0"; g("ecgvInner").appendChild(mc); }
      g("ecgvTitle").textContent = title || "Rhythm strip";
      ov.hidden = false; document.documentElement.classList.add("ecgv-open");
      fit(); g("ecgvStage").focus();
    }
    function close() { var ov = g("ecgView"); if (!ov) return; ov.hidden = true; document.documentElement.classList.remove("ecgv-open"); if (ECGV.opener && ECGV.opener.focus) ECGV.opener.focus(); }
    function fit() {
      var st = g("ecgvStage"), r = st.getBoundingClientRect(), svg = g("ecgvInner").querySelector("svg"); if (!svg) return;
      var vb = svg.getAttribute("viewBox").split(/\s+/), asp = (+vb[2]) / (+vb[3]);
      var w = Math.min(r.width - 16, (r.height - 16) * asp); ECGV.w = w; ECGV.h = w / asp;
      g("ecgvInner").style.width = w + "px"; g("ecgvInner").style.height = ECGV.h + "px";
      ECGV.s = 1; ECGV.x = (r.width - w) / 2; ECGV.y = (r.height - ECGV.h) / 2; apply();
    }
    function zoomAt(f, px, py) {
      var st = g("ecgvStage"), r = st.getBoundingClientRect();
      if (px == null) { px = r.width / 2; py = r.height / 2; }
      var ns = Math.max(1, Math.min(14, ECGV.s * f)); f = ns / ECGV.s;
      ECGV.x = px - (px - ECGV.x) * f; ECGV.y = py - (py - ECGV.y) * f; ECGV.s = ns; apply();
    }
    function apply() {
      var st = g("ecgvStage"), r = st.getBoundingClientRect(), W = ECGV.w * ECGV.s, Hh = ECGV.h * ECGV.s;
      ECGV.x = W <= r.width ? (r.width - W) / 2 : Math.min(0, Math.max(r.width - W, ECGV.x));
      ECGV.y = Hh <= r.height ? (r.height - Hh) / 2 : Math.min(0, Math.max(r.height - Hh, ECGV.y));
      g("ecgvInner").style.transform = "translate(" + ECGV.x + "px," + ECGV.y + "px) scale(" + ECGV.s + ")";
      g("ecgvPct").textContent = Math.round(ECGV.s * 100) + "%";
      g("ecgvOut").disabled = ECGV.s <= 1.001; g("ecgvIn").disabled = ECGV.s >= 13.99;
    }
    document.addEventListener("click", function (e) {
      if (!e.target.closest || !e.target.closest(".cl")) return;
      if (e.target.closest(".cal-ov, .cal-toggle")) return;   // calipers keep their own clicks
      var btn = e.target.closest("[data-expand]"), svg = btn ? null : e.target.closest(".paper svg:not(.cal-svg)");
      if (btn) { var v0 = btn.closest(".view"); svg = v0 && v0.querySelector(".paper svg:not(.cal-svg)"); }
      if (!svg) return;
      var view = svg.closest(".view"), h2 = view && view.querySelector(".qhead h2");
      open(svg, (h2 ? h2.textContent.replace(/\s+/g, " ").trim() + " · " : "") + (svg.classList.contains("ecg12") ? "12-lead ECG" : "Rhythm strip"));
    });
  })();

  /* ================= calipers: two legs on a hinge, with a readout of the interval and rate ================= */
  (function () {
    var CAL = { on: false, a: 0.2, b: 0.2 + 800 / 6000, march: false };
    try { var saved = JSON.parse(localStorage.getItem("cl-calipers") || "null"); if (saved) { CAL.on = !!saved.on; CAL.march = !!saved.march; if (saved.a >= 0 && saved.a <= 1) CAL.a = saved.a; if (saved.b >= 0 && saved.b <= 1) CAL.b = saved.b; } } catch (e) {}
    function persist() { try { localStorage.setItem("cl-calipers", JSON.stringify(CAL)); } catch (e) {} }
    var IC_CAL = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 6.2 4.2 18M10 6.2l5.8 11.8"/><circle cx="10" cy="5.2" r="2.2"/><path d="M10 1.4V3"/></svg>';
    var hosts = [], SEQ = 0, BAND = 80, DIP = 40;
    function clamp(x) { return Math.max(0, Math.min(1, x)); }
    function msOf(h) { return +h.getAttribute("data-cal-ms") || 6000; }
    function fmtS(ms) { return (ms / 1000).toFixed(2) + " s"; }
    function attach(host, ms) {
      host.classList.add("cal-host"); host.setAttribute("data-cal-ms", ms);
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "cal-toggle"; btn.setAttribute("aria-pressed", CAL.on ? "true" : "false");
      btn.setAttribute("aria-label", "Calipers"); btn.title = "Calipers: measure intervals and rate";
      btn.innerHTML = IC_CAL + '<span>Calipers</span>';
      btn.addEventListener("click", function () { CAL.on = !CAL.on; persist(); renderAll(); if (CAL.on) { var l = host.querySelector(".cal-leg"); if (l) l.focus(); } });
      host.appendChild(btn); hosts.push(host); render(host);
    }
    function scan() {
      hosts = hosts.filter(function (h) { return document.body.contains(h); });
      document.querySelectorAll(".cl .paper > svg").forEach(function (svg) {
        if (svg.closest(".cal-wrap")) return;
        var vb = (svg.getAttribute("viewBox") || "0 0 6000 1").split(/\s+/), ms = +vb[2] || 6000;
        var wrap = document.createElement("div"); wrap.className = "cal-wrap" + (svg.classList.contains("ecg12") ? " wide" : "");
        svg.parentNode.insertBefore(wrap, svg); wrap.appendChild(svg);
        Array.prototype.slice.call(wrap.parentNode.querySelectorAll(":scope > .mk-ov")).forEach(function (o) { wrap.appendChild(o); });
        attach(wrap, ms);
        fitStrip();
      });
    }
    function render(host) {
      var ov = host.querySelector(".cal-ov"); if (ov) ov.remove();
      var btn = host.querySelector(".cal-toggle"); if (btn) { btn.setAttribute("aria-pressed", CAL.on ? "true" : "false"); btn.classList.toggle("on", CAL.on); }
      host.classList.toggle("cal-on", CAL.on);
      if (!CAL.on) return;
      ov = document.createElement("div"); ov.className = "cal-ov";
      var gid = "clcal" + (++SEQ);
      ov.innerHTML = '<svg class="cal-svg" aria-hidden="true" focusable="false"><defs>' +
          '<linearGradient id="' + gid + 'm" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7C8790"/><stop offset=".35" stop-color="#F4F7F9"/><stop offset=".6" stop-color="#C3CBD1"/><stop offset="1" stop-color="#6A757E"/></linearGradient>' +
          '<radialGradient id="' + gid + 'h" cx=".35" cy=".35" r=".8"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#C9D1D7"/><stop offset="1" stop-color="#5E6972"/></radialGradient>' +
          '<filter id="' + gid + 's" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="1.5" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity=".35"/></filter></defs>' +
          '<g class="cal-guides"></g><g class="cal-ticks"></g><g class="cal-body" filter="url(#' + gid + 's)"></g></svg>' +
        '<div class="cal-bar" role="slider" tabindex="0" aria-label="Calipers hinge: move both legs"></div>' +
        '<div class="cal-leg" data-k="a" role="slider" tabindex="0" aria-label="Caliper leg 1"><i></i></div>' +
        '<div class="cal-leg" data-k="b" role="slider" tabindex="0" aria-label="Caliper leg 2"><i></i></div>' +
        '<div class="cal-read"><output class="cal-val" aria-live="polite"></output>' +
        '<button type="button" class="cal-march" aria-pressed="' + CAL.march + '" title="March the interval across the strip">March</button>' +
        '<button type="button" class="cal-x" aria-label="Close calipers" title="Close calipers">×</button></div>';
      host.appendChild(ov);
      ov.querySelector(".cal-x").onclick = function () { CAL.on = false; persist(); renderAll(); var b = host.querySelector(".cal-toggle"); if (b) b.focus(); };
      ov.querySelector(".cal-march").onclick = function () { CAL.march = !CAL.march; persist(); updateAll(); };
      ov.querySelectorAll(".cal-leg, .cal-bar").forEach(function (el) {
        var k = el.getAttribute("data-k");
        el.addEventListener("pointerdown", function (e) {
          e.preventDefault(); el.setPointerCapture(e.pointerId); el.focus({ preventScroll: true });
          var r = ov.getBoundingClientRect(), x0 = e.clientX, a0 = CAL.a, b0 = CAL.b;
          var move = function (ev) {
            var f = (ev.clientX - r.left) / r.width;
            if (k) CAL[k] = clamp(f);
            else { var d = (ev.clientX - x0) / r.width, lo = Math.min(a0, b0), hi = Math.max(a0, b0); d = Math.max(-lo, Math.min(1 - hi, d)); CAL.a = a0 + d; CAL.b = b0 + d; }
            updateAll();
          };
          var up = function () { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); persist(); };
          el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
        });
        el.addEventListener("keydown", function (e) {
          var ms = msOf(host), step = (e.shiftKey ? 10 : 40) / ms, d = 0;
          if (e.key === "ArrowRight" || e.key === "ArrowUp") d = step; else if (e.key === "ArrowLeft" || e.key === "ArrowDown") d = -step;
          else if (e.key === "PageUp") d = 200 / ms; else if (e.key === "PageDown") d = -200 / ms;
          else if (e.key === "Home" && k) CAL[k] = 0; else if (e.key === "End" && k) CAL[k] = 1;
          else if (e.key === "Escape") { CAL.on = false; persist(); renderAll(); var b = host.querySelector(".cal-toggle"); if (b) b.focus(); return; }
          else return;
          e.preventDefault(); e.stopPropagation();
          if (k) CAL[k] = clamp(CAL[k] + d);
          else { var lo = Math.min(CAL.a, CAL.b), hi = Math.max(CAL.a, CAL.b); d = Math.max(-lo, Math.min(1 - hi, d)); CAL.a += d; CAL.b += d; }
          persist(); updateAll();
        });
      });
      update(host);
    }
    function update(host) {
      var ov = host.querySelector(".cal-ov"); if (!ov) return;
      var ms = msOf(host), lo = Math.min(CAL.a, CAL.b), hi = Math.max(CAL.a, CAL.b), d = (hi - lo) * ms;
      var legs = ov.querySelectorAll(".cal-leg");
      [["a", legs[0]], ["b", legs[1]]].forEach(function (x) { var v = CAL[x[0]] * ms; x[1].style.left = (CAL[x[0]] * 100) + "%";
        x[1].setAttribute("aria-valuemin", "0"); x[1].setAttribute("aria-valuemax", String(Math.round(ms))); x[1].setAttribute("aria-valuenow", String(Math.round(v)));
        x[1].setAttribute("aria-valuetext", "at " + fmtS(v) + "; interval " + fmtS(d)); });
      var W = ov.clientWidth || 720, Hh = ov.clientHeight || 170, hingeY = 48, tipY = BAND + DIP;
      var xa = CAL.a * W, xb = CAL.b * W, hx = (xa + xb) / 2, gid = ov.querySelector("linearGradient").id.slice(0, -1);
      var leg = function (tx) {
        var dx = tx - hx, dy = tipY - hingeY, L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
        var nl = Math.min(7, L * 0.12), px = tx - ux * nl, py = tipY - uy * nl, w0 = 3.4, w1 = 1.15;
        var poly = [[hx + nx * w0, hingeY + ny * w0], [px + nx * w1, py + ny * w1], [px - nx * w1, py - ny * w1], [hx - nx * w0, hingeY - ny * w0]].map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
        return '<polygon points="' + poly + '" fill="url(#' + gid + 'm)" stroke="#3A434A" stroke-width=".6" stroke-linejoin="round"/>' +
          '<line x1="' + px.toFixed(1) + '" y1="' + py.toFixed(1) + '" x2="' + tx.toFixed(1) + '" y2="' + tipY + '" stroke="#2B3238" stroke-width=".8" stroke-linecap="round"/>';
      };
      var body = leg(xa) + leg(xb) +
        '<rect x="' + (hx - 6).toFixed(1) + '" y="' + (hingeY - 22) + '" width="12" height="13" rx="2.5" fill="url(#' + gid + 'm)" stroke="#3A434A" stroke-width=".8"/>' +
        [-3, 0, 3].map(function (o) { return '<line x1="' + (hx + o).toFixed(1) + '" y1="' + (hingeY - 20) + '" x2="' + (hx + o).toFixed(1) + '" y2="' + (hingeY - 11) + '" stroke="#4A545B" stroke-width=".7"/>'; }).join("") +
        '<circle cx="' + hx.toFixed(1) + '" cy="' + hingeY + '" r="9.5" fill="url(#' + gid + 'h)" stroke="#3A434A" stroke-width=".9"/>' +
        '<circle cx="' + hx.toFixed(1) + '" cy="' + hingeY + '" r="3.6" fill="#59636B" stroke="#2B3238" stroke-width=".6"/>' +
        '<line x1="' + (hx - 2.6).toFixed(1) + '" y1="' + (hingeY + 1.2) + '" x2="' + (hx + 2.6).toFixed(1) + '" y2="' + (hingeY - 1.2) + '" stroke="#D5DBDF" stroke-width=".9" stroke-linecap="round"/>';
      var gd = function (x) { return '<line x1="' + x.toFixed(1) + '" y1="' + tipY + '" x2="' + x.toFixed(1) + '" y2="' + Hh + '"/><circle cx="' + x.toFixed(1) + '" cy="' + tipY + '" r="1.3"/>'; };
      var svg = ov.querySelector(".cal-svg"); svg.setAttribute("viewBox", "0 0 " + W + " " + Hh);
      ov.querySelector(".cal-body").innerHTML = body; ov.querySelector(".cal-guides").innerHTML = gd(xa) + gd(xb);
      [legs[0], legs[1]].forEach(function (el) { el.style.top = (tipY - 28) + "px"; el.querySelector("i").style.top = "19px"; });
      var bar = ov.querySelector(".cal-bar"); bar.style.left = (hx / W * 100) + "%"; bar.style.top = (hingeY - 24) + "px";
      bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", String(Math.round(ms))); bar.setAttribute("aria-valuenow", String(Math.round(lo * ms)));
      bar.setAttribute("aria-valuetext", "interval " + fmtS(d) + " starting at " + fmtS(lo * ms));
      var boxes = d / 40, rate = d >= 200 ? Math.round(60000 / d) : null, narrow = (ov.clientWidth || 720) < 480;
      var txt = fmtS(d) + (narrow ? "" : " · " + (Math.round(boxes * 10) / 10) + " small boxes") + (rate ? " · " + rate + "/min" : "");
      var out = ov.querySelector(".cal-val"); if (out.textContent !== txt) out.textContent = txt;
      var rd = ov.querySelector(".cal-read"), Wl = ov.clientWidth || 720, rw = rd.offsetWidth || 300, cx = (lo + hi) / 2 * Wl;
      rd.style.left = (rw >= Wl - 4 ? Wl / 2 : Math.max(rw / 2 + 2, Math.min(Wl - rw / 2 - 2, cx))) + "px";
      var mb = ov.querySelector(".cal-march"); mb.setAttribute("aria-pressed", CAL.march ? "true" : "false"); mb.classList.toggle("on", CAL.march);
      var tk = ov.querySelector(".cal-ticks"), h = "", tick = function (f) { var x = (f * W).toFixed(1); return '<line x1="' + x + '" y1="' + tipY + '" x2="' + x + '" y2="' + Hh + '"/><path d="M' + x + ' ' + tipY + 'l-4 -8h8z"/>'; };
      if (CAL.march && hi - lo > 0.004) { var w = hi - lo; for (var x = lo - w; x > -0.0001; x -= w) h += tick(x); for (var y = hi + w; y < 1.0001; y += w) h += tick(y); }
      if (tk.innerHTML !== h) tk.innerHTML = h;
    }
    function renderAll() { hosts.forEach(render); fitStrip(); }
    function updateAll() { hosts.forEach(update); }
    window.__clCalUpdate = updateAll;
    var pend = false;
    new MutationObserver(function () { if (pend) return; pend = true; requestAnimationFrame(function () { pend = false; scan(); }); }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", updateAll);
  })();

  window.CardiacLab = { tilesHTML: function (host) { if (host) HOST = host; return tilesHTML(); }, area: area, codelab: codelab, stop: stop };
})();
