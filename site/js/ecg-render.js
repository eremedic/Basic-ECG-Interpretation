/*
 * CSHealthED ECG Trainer — strip renderer
 * Draws signals on standard ECG paper (25 mm/s, 10 mm/mV) or as an animated
 * cardiac-monitor sweep, with an on-strip caliper tool.
 */
(function (global) {
  'use strict';

  var MM_PER_S = 25;
  var MM_PER_MV = 10;
  var BAND_MM = 30; // height of each lead band

  var THEMES = {
    paper: { bg: '#fff7f6', minor: 'rgba(232, 120, 120, 0.22)', major: 'rgba(214, 72, 72, 0.5)', trace: '#16161d', label: '#7a2b2b', tick: '#7a2b2b', spike: '#16161d' },
    monitor: { bg: '#04100b', minor: 'rgba(40, 200, 120, 0.06)', major: 'rgba(40, 200, 120, 0.16)', trace: '#3dff8f', label: '#7dffb8', tick: 'rgba(125,255,184,.6)', spike: '#ffffff' }
  };

  var PAPER_DARK = { bg: '#161a22', minor: 'rgba(255, 128, 128, 0.10)', major: 'rgba(255, 120, 120, 0.30)', trace: '#eef1f7', label: '#ffb8b8', tick: '#ffb8b8', spike: '#ffffff', ink: '#e6ecff' };
  THEMES.paper.ink = '#1b2a5b';
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function paper() { return isDark() ? PAPER_DARK : THEMES.paper; }

  function sampleAt(sig, lead, t) {
    var s = sig.leads[lead];
    var x = t * sig.fs;
    if (x < 0 || x >= s.length - 1) return null;
    var i = Math.floor(x), f = x - i;
    return s[i] * (1 - f) + s[i + 1] * f;
  }

  function setup(canvas, cssW, cssH) {
    var dpr = Math.min(global.devicePixelRatio || 1, 2.5);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function geometry(cssW, seconds, nLeads, compact, bandMM) {
    var pxmm = cssW / (seconds * MM_PER_S);
    var band = (bandMM || (compact ? 22 : BAND_MM)) * pxmm;
    var top = Math.min(6 * pxmm, 34); // header for the time marks
    if (compact) top = 2 * pxmm;
    return { pxmm: pxmm, band: band, top: top, h: Math.round(top + band * nLeads + (compact ? 1 : 3) * pxmm) };
  }

  function drawGrid(ctx, w, h, pxmm, th, mode) {
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, w, h);
    if (mode === 'paper' && pxmm >= 2.2) {
      ctx.beginPath();
      ctx.strokeStyle = th.minor;
      ctx.lineWidth = 0.6;
      for (var x = 0; x <= w; x += pxmm) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
      for (var y = 0; y <= h; y += pxmm) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
      ctx.stroke();
    } else if (mode === 'monitor') {
      ctx.beginPath();
      ctx.strokeStyle = th.minor;
      ctx.lineWidth = 0.5;
      for (var x1 = 0; x1 <= w; x1 += pxmm) { ctx.moveTo(Math.round(x1) + 0.5, 0); ctx.lineTo(Math.round(x1) + 0.5, h); }
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.strokeStyle = th.major;
    ctx.lineWidth = mode === 'paper' ? 1 : 0.7;
    for (var X = 0; X <= w + 1; X += pxmm * 5) { ctx.moveTo(Math.round(X) + 0.5, 0); ctx.lineTo(Math.round(X) + 0.5, h); }
    for (var Y = 0; Y <= h + 1; Y += pxmm * 5) { ctx.moveTo(0, Math.round(Y) + 0.5); ctx.lineTo(w, Math.round(Y) + 0.5); }
    ctx.stroke();
  }

  function drawTimeMarks(ctx, g, seconds, th, w) {
    ctx.strokeStyle = th.tick;
    ctx.fillStyle = th.tick;
    ctx.lineWidth = 1.5;
    ctx.font = '600 ' + Math.min(13, Math.max(9, Math.round(g.pxmm * 2.6))) + 'px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    for (var s = 0; s <= seconds + 1e-6; s++) {
      var x = Math.min(w - 1, s * MM_PER_S * g.pxmm);
      var big = s % 3 === 0;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, big ? g.top * 0.62 : g.top * 0.3);
      ctx.stroke();
      if (big && s > 0 && s < seconds) ctx.fillText(s + ' s', x + 4, 1);
    }
  }

  function traceBand(ctx, sig, lead, t0, seconds, g, bandTop, th, x0, x1) {
    var base = bandTop + g.band * 0.56;
    var ppmv = MM_PER_MV * g.pxmm;
    var pps = MM_PER_S * g.pxmm;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bandTop, 99999, g.band);
    ctx.clip();
    ctx.beginPath();
    var started = false;
    var step = 0.5; // px
    for (var x = x0; x <= x1; x += step) {
      var v = sampleAt(sig, lead, t0 + x / pps);
      if (v === null) { started = false; continue; }
      var y = base - v * ppmv;
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // pacemaker spikes
    sig.spikes.forEach(function (sp) {
      var x = (sp.t - t0) * pps;
      if (x < x0 || x > x1) return;
      var v = sampleAt(sig, lead, sp.t) || 0;
      ctx.save();
      ctx.strokeStyle = th.spike;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, base - v * ppmv);
      ctx.lineTo(x, base - (v + sp[lead]) * ppmv);
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  }

  function labelBand(ctx, lead, g, bandTop, th) {
    ctx.fillStyle = th.label;
    ctx.font = '700 ' + Math.min(17, Math.max(11, Math.round(g.pxmm * 3.4))) + 'px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(lead, 6, bandTop + 4);
  }

  /* Static strip -------------------------------------------------------- */
  function drawStrip(canvas, sig, opts) {
    opts = opts || {};
    var mode = opts.mode || 'paper';
    var th = mode === 'paper' ? paper() : THEMES.monitor;
    var leads = opts.leads || ['II'];
    var seconds = opts.seconds || 6;
    var t0 = opts.start || 0;
    var cssW = opts.width || canvas.parentElement.clientWidth || 800;
    var g = geometry(cssW, seconds, leads.length, opts.compact, opts.bandMM);
    var ctx = setup(canvas, cssW, g.h);
    drawGrid(ctx, cssW, g.h, g.pxmm, th, mode);
    if (!opts.compact) drawTimeMarks(ctx, g, seconds, th, cssW);
    ctx.strokeStyle = th.trace;
    ctx.lineWidth = opts.compact ? 1.1 : Math.min(2.4, Math.max(1.2, g.pxmm * 0.32));
    ctx.lineJoin = 'round';
    leads.forEach(function (lead, i) {
      var top = g.top + i * g.band;
      ctx.strokeStyle = th.trace;
      ctx.lineWidth = opts.compact ? 1.1 : Math.min(2.4, Math.max(1.2, g.pxmm * 0.32));
      traceBand(ctx, sig, lead, t0, seconds, g, top, th, 0, cssW);
      if (!opts.compact || leads.length > 1) labelBand(ctx, lead, g, top, th);
    });
    if (!opts.compact) {
      ctx.fillStyle = th.label;
      ctx.globalAlpha = 0.7;
      ctx.font = '500 ' + Math.min(12, Math.max(9, Math.round(g.pxmm * 2.3))) + 'px Inter, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('25 mm/s · 10 mm/mV', cssW - 6, g.h - 3);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
    var bands = leads.map(function (lead, i) { var top = g.top + i * g.band; return { lead: lead, top: top, base: top + g.band * 0.56 }; });
    return { pxmm: g.pxmm, pps: MM_PER_S * g.pxmm, ppmv: MM_PER_MV * g.pxmm, height: g.h, width: cssW, seconds: seconds, bands: bands, ctx: ctx };
  }

  /* Animated monitor ---------------------------------------------------- */
  function Monitor(canvas, sig, opts) {
    this.canvas = canvas;
    this.sig = sig;
    this.opts = opts || {};
    this.running = false;
    this.t = 0;
    this.lastBeep = -1;
    this.onBeat = this.opts.onBeat || null;
  }
  Monitor.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.prev = performance.now();
    var self = this;
    function frame(now) {
      if (!self.running) return;
      var dt = Math.min(0.1, (now - self.prev) / 1000);
      self.prev = now;
      var before = self.t;
      self.t += dt;
      self.checkBeats(before, self.t);
      self.draw();
      self.raf = requestAnimationFrame(frame);
    }
    this.raf = requestAnimationFrame(frame);
  };
  Monitor.prototype.stop = function () {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
  };
  Monitor.prototype.checkBeats = function (a, b) {
    if (!this.onBeat) return;
    var D = this.sig.duration - 0.6;
    var qa = a % D, qb = b % D;
    var self = this;
    this.sig.qrsTimes.forEach(function (q) {
      var hit = qa <= qb ? q + 0.04 > qa && q + 0.04 <= qb : q + 0.04 > qa || q + 0.04 <= qb;
      if (hit) self.onBeat(q);
    });
  };
  Monitor.prototype.draw = function () {
    var o = this.opts, sig = this.sig;
    var th = THEMES.monitor;
    var leads = o.leads || ['II'];
    var seconds = o.seconds || 6;
    var cssW = this.canvas.parentElement.clientWidth || 800;
    var g = geometry(cssW, seconds, leads.length, false);
    if (!this.ctx || this.cssW !== cssW || this.nLeads !== leads.length) {
      this.ctx = setup(this.canvas, cssW, g.h);
      this.cssW = cssW;
      this.nLeads = leads.length;
    }
    var ctx = this.ctx;
    drawGrid(ctx, cssW, g.h, g.pxmm, th, 'monitor');
    var D = sig.duration - 0.6; // usable loop length
    var now = this.t % D;
    var pps = MM_PER_S * g.pxmm;
    var cyc = now - (now % seconds);
    var sweepX = (now % seconds) * pps;
    var gap = 14;
    ctx.lineJoin = 'round';
    leads.forEach(function (lead, i) {
      var top = g.top + i * g.band;
      ctx.strokeStyle = th.trace;
      ctx.lineWidth = Math.min(2.6, Math.max(1.6, g.pxmm * 0.4));
      ctx.shadowColor = 'rgba(61,255,143,0.55)';
      ctx.shadowBlur = 6;
      traceBand(ctx, sig, lead, cyc, seconds, g, top, th, 0, sweepX);
      if (cyc - seconds >= 0) traceBand(ctx, sig, lead, cyc - seconds, seconds, g, top, th, sweepX + gap, cssW);
      ctx.shadowBlur = 0;
      labelBand(ctx, lead, g, top, th);
    });
    // sweep head
    ctx.fillStyle = 'rgba(61,255,143,0.9)';
    ctx.fillRect(sweepX - 1, g.top, 2, g.h - g.top);
  };

  /* Calipers ------------------------------------------------------------ */
  // Realistic steel calipers, as in the CSHealthED Cardiac Lab: two tapered legs on a
  // hinge with an adjustment knob, in a band that opens above the tracing, with the
  // needle points at the top of the ECG and faint guide lines down through it.
  // Drag a leg or the hinge, or focus one and use the arrow keys (one small box =
  // 0.04 s; Shift = 0.01 s; Page Up/Down = one large box; Home/End; Escape closes).
  // March repeats the interval across the strip. Positions are kept between strips.
  //
  // attachCalipers(wrap, canvas, getInfo): the calipers show while `wrap` has the
  // class calipers-on and getInfo() returns the strip's drawing info. Closing them
  // removes the class and fires a 'calipers:close' event on wrap.
  var CAL = { a: 0.2, b: 0.2 + 800 / 6000, march: false }, CAL_SEQ = 0, CAL_BAND = 80, CAL_DIP = 30;
  try { var sv = JSON.parse(localStorage.getItem('cshealthed-calipers') || 'null'); if (sv) { CAL.march = !!sv.march; if (sv.a >= 0 && sv.a <= 1) CAL.a = sv.a; if (sv.b >= 0 && sv.b <= 1) CAL.b = sv.b; } } catch (e) { /* storage blocked */ }
  function calSave() { try { localStorage.setItem('cshealthed-calipers', JSON.stringify(CAL)); } catch (e) { /* ignore */ } }
  var calHosts = [];
  function calClamp(x) { return Math.max(0, Math.min(1, x)); }
  function fmtS(ms) { return (ms / 1000).toFixed(2) + ' s'; }
  function calUpdateAll() { calHosts = calHosts.filter(function (h) { return document.body.contains(h.wrap); }); calHosts.forEach(function (h) { h.update(); }); }

  function attachCalipers(wrap, canvas, getInfo) {
    var ov = null, host = { wrap: wrap };
    function ms() { var i = getInfo(); return i ? i.seconds * 1000 : 6000; }
    function close() {
      wrap.classList.remove('calipers-on');
      wrap.dispatchEvent(new CustomEvent('calipers:close', { bubbles: true }));
    }
    function render() {
      if (ov) { ov.remove(); ov = null; }
      var on = wrap.classList.contains('calipers-on') && !!getInfo();
      wrap.classList.toggle('cal-on', on);
      if (!on) return;
      ov = document.createElement('div'); ov.className = 'cal-ov';
      var gid = 'calg' + (++CAL_SEQ);
      ov.innerHTML = '<svg class="cal-svg" aria-hidden="true" focusable="false"><defs>' +
        '<linearGradient id="' + gid + 'm" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7C8790"/><stop offset=".35" stop-color="#F4F7F9"/><stop offset=".6" stop-color="#C3CBD1"/><stop offset="1" stop-color="#6A757E"/></linearGradient>' +
        '<radialGradient id="' + gid + 'h" cx=".35" cy=".35" r=".8"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#C9D1D7"/><stop offset="1" stop-color="#5E6972"/></radialGradient>' +
        '<filter id="' + gid + 's" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="1.5" dy="2" stdDeviation="1.6" flood-color="#000" flood-opacity=".35"/></filter></defs>' +
        '<g class="cal-guides"></g><g class="cal-ticks"></g><g class="cal-body" filter="url(#' + gid + 's)"></g></svg>' +
        '<div class="cal-hinge" role="slider" tabindex="0" aria-label="Calipers hinge: move both legs"></div>' +
        '<div class="cal-leg" data-k="a" role="slider" tabindex="0" aria-label="Caliper leg 1"><i></i></div>' +
        '<div class="cal-leg" data-k="b" role="slider" tabindex="0" aria-label="Caliper leg 2"><i></i></div>' +
        '<div class="cal-read"><output class="cal-val" aria-live="polite"></output>' +
        '<button type="button" class="cal-march" title="March the interval across the strip">March</button>' +
        '<button type="button" class="cal-x" aria-label="Close calipers" title="Close calipers">×</button></div>';
      wrap.appendChild(ov);
      ov.querySelector('.cal-x').onclick = close;
      ov.querySelector('.cal-march').onclick = function () { CAL.march = !CAL.march; calSave(); calUpdateAll(); };
      Array.prototype.forEach.call(ov.querySelectorAll('.cal-leg, .cal-hinge'), function (el) {
        var k = el.getAttribute('data-k');
        el.addEventListener('pointerdown', function (e) {
          e.preventDefault(); el.setPointerCapture(e.pointerId); el.focus({ preventScroll: true });
          var r = ov.getBoundingClientRect(), x0 = e.clientX, a0 = CAL.a, b0 = CAL.b;
          var move = function (ev) {
            if (k) CAL[k] = calClamp((ev.clientX - r.left) / r.width);
            else { var d = (ev.clientX - x0) / r.width, lo = Math.min(a0, b0), hi = Math.max(a0, b0); d = Math.max(-lo, Math.min(1 - hi, d)); CAL.a = a0 + d; CAL.b = b0 + d; }
            calUpdateAll();
          };
          var up = function () { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); calSave(); };
          el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
        });
        el.addEventListener('keydown', function (e) {
          var M = ms(), step = (e.shiftKey ? 10 : 40) / M, d = 0;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = step; else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -step;
          else if (e.key === 'PageUp') d = 200 / M; else if (e.key === 'PageDown') d = -200 / M;
          else if (e.key === 'Home' && k) { CAL[k] = 0; } else if (e.key === 'End' && k) { CAL[k] = 1; }
          else if (e.key === 'Escape') { close(); return; }
          else return;
          e.preventDefault(); e.stopPropagation();
          if (k) CAL[k] = calClamp(CAL[k] + d);
          else { var lo = Math.min(CAL.a, CAL.b), hi = Math.max(CAL.a, CAL.b); d = Math.max(-lo, Math.min(1 - hi, d)); CAL.a += d; CAL.b += d; }
          calSave(); calUpdateAll();
        });
      });
      update();
    }
    function update() {
      if (!ov) return;
      var M = ms(), lo = Math.min(CAL.a, CAL.b), hi = Math.max(CAL.a, CAL.b), d = (hi - lo) * M;
      var legs = ov.querySelectorAll('.cal-leg');
      [['a', legs[0]], ['b', legs[1]]].forEach(function (x) {
        var v = CAL[x[0]] * M; x[1].style.left = (CAL[x[0]] * 100) + '%';
        x[1].setAttribute('aria-valuemin', '0'); x[1].setAttribute('aria-valuemax', String(Math.round(M))); x[1].setAttribute('aria-valuenow', String(Math.round(v)));
        x[1].setAttribute('aria-valuetext', 'at ' + fmtS(v) + '; interval ' + fmtS(d));
      });
      var W = ov.clientWidth || 720, Hh = ov.clientHeight || 170;
      var hingeY = 48, tipY = CAL_BAND + CAL_DIP;  // hinge in the band above the ECG; the legs end in fine points at the top of the tracing
      var xa = CAL.a * W, xb = CAL.b * W, hx = (xa + xb) / 2, gid = ov.querySelector('linearGradient').id.slice(0, -1);
      var leg = function (tx) {
        var dx = tx - hx, dy = tipY - hingeY, L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
        var nl = Math.min(7, L * 0.12), px = tx - ux * nl, py = tipY - uy * nl, w0 = 3.4, w1 = 1.15;
        var poly = [[hx + nx * w0, hingeY + ny * w0], [px + nx * w1, py + ny * w1], [px - nx * w1, py - ny * w1], [hx - nx * w0, hingeY - ny * w0]].map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ');
        return '<polygon points="' + poly + '" fill="url(#' + gid + 'm)" stroke="#3A434A" stroke-width=".6" stroke-linejoin="round"/>' +
          '<line x1="' + px.toFixed(1) + '" y1="' + py.toFixed(1) + '" x2="' + tx.toFixed(1) + '" y2="' + tipY + '" stroke="#2B3238" stroke-width=".8" stroke-linecap="round"/>';
      };
      var body = leg(xa) + leg(xb) +
        '<rect x="' + (hx - 6).toFixed(1) + '" y="' + (hingeY - 22) + '" width="12" height="13" rx="2.5" fill="url(#' + gid + 'm)" stroke="#3A434A" stroke-width=".8"/>' +
        [-3, 0, 3].map(function (o) { return '<line x1="' + (hx + o).toFixed(1) + '" y1="' + (hingeY - 20) + '" x2="' + (hx + o).toFixed(1) + '" y2="' + (hingeY - 11) + '" stroke="#4A545B" stroke-width=".7"/>'; }).join('') +
        '<circle cx="' + hx.toFixed(1) + '" cy="' + hingeY + '" r="9.5" fill="url(#' + gid + 'h)" stroke="#3A434A" stroke-width=".9"/>' +
        '<circle cx="' + hx.toFixed(1) + '" cy="' + hingeY + '" r="3.6" fill="#59636B" stroke="#2B3238" stroke-width=".6"/>' +
        '<line x1="' + (hx - 2.6).toFixed(1) + '" y1="' + (hingeY + 1.2) + '" x2="' + (hx + 2.6).toFixed(1) + '" y2="' + (hingeY - 1.2) + '" stroke="#D5DBDF" stroke-width=".9" stroke-linecap="round"/>';
      var gd = function (x) { return '<line x1="' + x.toFixed(1) + '" y1="' + tipY + '" x2="' + x.toFixed(1) + '" y2="' + Hh + '"/><circle cx="' + x.toFixed(1) + '" cy="' + tipY + '" r="1.3"/>'; };
      var svg = ov.querySelector('.cal-svg'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh);
      ov.querySelector('.cal-body').innerHTML = body; ov.querySelector('.cal-guides').innerHTML = gd(xa) + gd(xb);
      Array.prototype.forEach.call(legs, function (el) { el.style.top = (tipY - 28) + 'px'; el.querySelector('i').style.top = '19px'; });
      var hinge = ov.querySelector('.cal-hinge'); hinge.style.left = (hx / W * 100) + '%'; hinge.style.top = (hingeY - 24) + 'px';
      hinge.setAttribute('aria-valuemin', '0'); hinge.setAttribute('aria-valuemax', String(Math.round(M))); hinge.setAttribute('aria-valuenow', String(Math.round(lo * M)));
      hinge.setAttribute('aria-valuetext', 'interval ' + fmtS(d) + ' starting at ' + fmtS(lo * M));
      var boxes = d / 40, rate = d >= 200 ? Math.round(60000 / d) : null, narrow = W < 480;
      var txt = fmtS(d) + (narrow ? '' : ' · ' + (Math.round(boxes * 10) / 10) + ' small boxes') + (rate ? ' · ' + rate + '/min' : '');
      var out = ov.querySelector('.cal-val'); if (out.textContent !== txt) out.textContent = txt;
      if (narrow) out.setAttribute('aria-label', fmtS(d) + ', ' + (Math.round(boxes * 10) / 10) + ' small boxes' + (rate ? ', ' + rate + ' per minute' : ''));
      var rd = ov.querySelector('.cal-read'), rw = rd.offsetWidth || 300, cx = (lo + hi) / 2 * W;
      rd.style.left = (rw >= W - 4 ? W / 2 : Math.max(rw / 2 + 2, Math.min(W - rw / 2 - 2, cx))) + 'px';  // keep the readout inside the strip
      var mb = ov.querySelector('.cal-march'); mb.setAttribute('aria-pressed', CAL.march ? 'true' : 'false'); mb.classList.toggle('on', CAL.march);
      var tk = ov.querySelector('.cal-ticks'), h = '', tick = function (f) { var x = (f * W).toFixed(1); return '<line x1="' + x + '" y1="' + tipY + '" x2="' + x + '" y2="' + Hh + '"/><path d="M' + x + ' ' + tipY + 'l-4 -8h8z"/>'; };
      if (CAL.march && hi - lo > 0.004) { var w = hi - lo; for (var x = lo - w; x > -0.0001; x -= w) h += tick(x); for (var y = hi + w; y < 1.0001; y += w) h += tick(y); }
      if (tk.innerHTML !== h) tk.innerHTML = h;
    }
    host.update = update;
    calHosts.push(host);
    // follow the calipers-on class that the page's Calipers button toggles
    new MutationObserver(function () { var want = wrap.classList.contains('calipers-on') && !!getInfo(); if (want !== !!ov) render(); }).observe(wrap, { attributes: true, attributeFilter: ['class'] });
    render();
    function sync() { var want = wrap.classList.contains('calipers-on') && !!getInfo(); if (want !== !!ov) render(); else update(); }
    return { clear: sync, update: sync };
  }
  global.addEventListener('resize', function () { calUpdateAll(); });

  global.ECGRender = { isDark: isDark, paper: paper, drawStrip: drawStrip, Monitor: Monitor, attachCalipers: attachCalipers, MM_PER_S: MM_PER_S };
})(window);
