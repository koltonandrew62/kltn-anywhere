/* KLTN Research Terminal charting engine — dependency-free canvas charts.
 * PriceChart : index-based OHLC/candle/line/area with overlays, sub-panes, zoom/pan, crosshair.
 * SeriesChart: multi-line time or category charts (macro series, yield curves, comparisons).
 * Look (D13): Bloomberg GP — black plot, dashed dark grid, right-side price axis with a notched last-price tag,
 * legend boxes above the plot, a crosshair readout bar on top, blue mountain fill, detailed candles that glide and
 * glow on live moves (FX below). Public API unchanged.
 */
(function (G) {
  'use strict';
  /* palette = refdata/design DESIGN.md tokens. Series order follows GP: white last price, then orange, blue, green, red, … */
  const PAL = ['#f2f2f2', '#fc9c24', '#4ea8fc', '#30d254', '#fc1e3c', '#f5d142', '#ba68c8', '#ff9ad5', '#a3c2ff', '#9be27a', '#ffb870', '#8f9bb3'];
  /* plot field: black on the terminal (GP, GC …); the dark navy sampled from the Cranfield GP is the mountain fill under the
     price line, which the chart already draws. AtlasChart.PLOTBG = '#031d38' would tint the whole plot area. */
  const PLOTBG = null, PGRID = '#173252';
  const UP = '#30d254', DN = '#fc1e3c', GRID0 = '#3a3a3a', GRID = GRID0, GD = [2, 3], AXL = '#555555', AXIS = '#c8c8c8', DIM = '#9c9c9c', TXT = '#f2f2f2', CROSS = '#808080',
    AMBER = '#fc9c24', CHROME = '#181818', LINE = '#333333', BOXBG = '#0b0b0b', BOXLN = '#3c3c3c';
  const FS = 15, FS_S = 14, FS_XS = 12;
  /* canvas text follows the terminal font (var(--mono): "KLTN Sans" by default, or whatever the user picked) */
  let famC = '', famAt = 0;
  function fam() {
    const now = Date.now();
    if (!famC || now - famAt > 3000) { famAt = now; let f = ''; try { f = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim(); } catch (e) { } famC = f || '"KLTN Sans", "Arial Narrow", Arial, sans-serif'; }
    return famC;
  }
  // TEXT <GO> text-size setting; bb/fontboost.js adds it to every canvas font when loaded (Atlas.canvasFontBoost)
  const boost = () => (window.Atlas && !Atlas.canvasFontBoost && Atlas.fontBoost ? Atlas.fontBoost() : 0);
  /* the "crisp" KLTN Sans / Inter / Roboto Condensed files (static/fonts/*-crisp.woff2, the real-weight replacement for the
     old fake-bold text stroke) draw every CSS weight ~110 units heavier; canvas text asks for 110 less so charts keep their
     exact previous stroke weight (600 -> 490). Other families (Bergoom, KLTN 9x19 …) are unchanged. */
  const CRISPF = /^\s*["']?(KLTN Sans|Inter|Roboto Condensed)["']?\s*(,|$)/i;
  /* KLTN Prop N (tools/build_propn.py) has static weights on the same heavier scale: 100 less lands on the face with the
     stroke the crisp files gave (600 -> its 500 face) */
  const PROPN = /^\s*["']?KLTN Prop N["']?\s*(,|$)/i;
  const wt = (w, f) => CRISPF.test(f) ? Math.max(100, w - 110) : PROPN.test(f) ? Math.max(300, w - 100) : w;
  const font = (px, w) => { const f = fam(); return wt(w || 600, f) + ' ' + (px + boost()) + 'px ' + f; };
  // legacy constants (kept for anything that reads them)
  const FONT = '600 ' + FS + 'px "KLTN Sans", Arial, sans-serif', LFONT = FONT;
  const hexRGB = col => { const r = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(col || ''); if (r) return [+r[1], +r[2], +r[3]]; const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(col || ''); if (!m) return null; let h = m[1]; if (h.length === 3) h = h.split('').map(x => x + x).join(''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16)); };
  const ink = col => { const c = hexRGB(col); if (!c) return '#000'; return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) > 140 ? '#000' : '#fff'; };
  const rgba = (col, a) => { const c = hexRGB(col); return c ? 'rgba(' + c.join(',') + ',' + a + ')' : null; };
  const valCol = col => { const c = hexRGB(col); return c && c[0] > 200 && c[1] > 200 && c[2] > 200 ? TXT : col; };

  // ---------------- motion + detailed series drawing (shared with the LaunchPad mini charts)
  /* MTN is a blue mountain. The one motion is the live move: a new price slides the end of the line (or the newest candle)
     straight up or down to it. No flash, glow, ring or draw-in (the user asked for just the straight move; candle colours
     unchanged). Motion is on by default (the Windows "animation effects" flag is not used); ANIM OFF <GO> stores
     settings.chartAnim = false. flash / column / ripple / intro stay as no-ops for callers. */
  const MTN = '#3d9cff', MOVE = 480;
  const nowMs = () => performance.now();
  const ease = t => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
  const lerp = (a, b, t) => a + (b - a) * t;
  const shade = (col, f) => { const c = hexRGB(col); if (!c) return col; const to = f < 0 ? 0 : 255, p = Math.abs(f); return 'rgb(' + c.map(v => Math.round(v + (to - v) * p)).join(',') + ')'; };
  const mix = (a, b, t) => { const x = hexRGB(a), y = hexRGB(b); return x && y ? 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',') + ')' : a; };
  const TONE = {}, tone = col => TONE[col] || (TONE[col] = { hi: shade(col, 0.2), lo: shade(col, -0.22), edge: shade(col, 0.42) });
  const FX = {
    MTN, ease, lerp, mix, shade,
    still() { const s = window.Atlas && Atlas.store && Atlas.store.settings; return !!(s && s.chartAnim === false); },
    /* redraw every frame while a move / flash / draw-in runs, then stop (no idle animation loop) */
    loop(o) {
      if (o._raf || FX.still()) return;
      const step = () => { o._raf = 0; if (o.dead || !o.cv || !o.cv.isConnected) return; o.draw(); if (FX.busy(o)) o._raf = requestAnimationFrame(step); };
      o._raf = requestAnimationFrame(step);
    },
    busy(o) { return !!(o._mv && nowMs() - o._mv.t0 < MOVE); },
    /* no draw-in: a new security, range or chart type simply appears (kept as a no-op for callers) */
    intro(o) { o._intro = 0; o._mv = null; },
    introP() { return 1; },
    /* draw-in progress of bar k of n: bars rise from their mid-point, left to right */
    grow(p, k, n) { return p >= 1 ? 1 : ease(p * 1.5 - 0.5 * k / Math.max(1, n - 1)); },
    /* the newest bar changed (live tick or refresh): glide from what is on screen now to the new values */
    move(o, ob, nb) {
      if (FX.still() || !ob || !ob.length || !nb || !nb.length) return;
      const a = FX.disp(o, ob, ob.length - 1), b = nb[nb.length - 1];
      if (!a || !b || b.t < a.t || (b.t === a.t && b.c === a.c && b.h === a.h && b.l === a.l)) return;
      const o0 = b.t === a.t ? null : (b.o != null ? b.o : a.c);           // a new bar grows out of its open
      o._mv = { t: b.t, from: o0 == null ? { c: a.c, h: a.h, l: a.l } : { c: o0, h: o0, l: o0 }, t0: nowMs(), dir: b.c > a.c ? 1 : b.c < a.c ? -1 : 0 };
      FX.loop(o);
    },
    /* bar i as it should be drawn right now (the newest bar is interpolated while it moves) */
    disp(o, arr, i) {
      const b = arr[i], m = o._mv;
      if (!b || !m || i !== arr.length - 1 || m.t !== b.t) return b;
      const k = (nowMs() - m.t0) / MOVE; if (k >= 1) return b;
      const e = ease(k), c = lerp(m.from.c, b.c, e);
      return Object.assign({}, b, { c, h: Math.max(lerp(m.from.h, b.h, e), c, b.o), l: Math.min(lerp(m.from.l, b.l, e), c, b.o) });
    },
    /* no glow after a live move (strength always 0: no green / red flash, column, ring or tag tint) */
    flash() { return 0; },
    flashCol(o) { return o._mv && o._mv.dir < 0 ? DN : UP; },
    /* green / red column behind the newest bar while it flashes (visible even when the bar is a thin doji) */
    column(c, x, bw, T, h, f, col) { if (!(f > 0)) return; const w = Math.max(6, bw); c.fillStyle = rgba(col, 0.2 * f); c.fillRect(Math.round(x - w / 2), T, Math.round(w), h); },
    /* one detailed candle at pixel coordinates: wick (2 px on wide bars), body with a vertical gradient, a lighter
       edge and a soft sheen, flat doji tick when open ≈ close; hot = under the crosshair; glow = live-move flash */
    /* device-pixel scale of a context (charts draw in CSS px on a dpr-scaled canvas) */
    dp(c) { try { const a = c.getTransform ? c.getTransform().a : 1; return a > 0 ? a : 1; } catch (e) { return 1; } },
    /* one detailed candle at pixel coordinates: wick, body with a vertical gradient, a lighter 1-device-px edge and a soft
       sheen, flat doji tick when open ≈ close; hot = under the crosshair; glow = live-move flash. Geometry is snapped to
       whole device pixels (odd/even matched so the wick sits exactly in the middle) so candles stay tack-sharp at any scale */
    candle(c, x, w, yo, yh, yl, yc, up, hot, glow, glowCol) {
      const col = up ? UP : DN, tn = tone(col), d = FX.dp(c), px = 1 / d;
      let wd = Math.max(1, Math.round(w * d)), kd = w >= 15 ? Math.max(2, Math.round(1.5 * d)) : Math.max(1, Math.round(0.75 * d));
      if (wd > kd && (wd - kd) % 2) wd -= 1;
      const cxD = Math.round(x * d), bL = (cxD - Math.floor(wd / 2)) / d, bW = wd / d, kL = (cxD - Math.floor(kd / 2)) / d, kW = kd / d;
      if (glow > 0) { c.save(); c.shadowColor = rgba(glowCol || col, Math.min(1, glow)); c.shadowBlur = 6 + 16 * glow; }
      const tD = Math.round(Math.min(yo, yc) * d), bD = Math.max(tD + 1, Math.round(Math.max(yo, yc) * d)), top = tD / d, bh = (bD - tD) / d;
      const hD = Math.round(yh * d), lD = Math.max(hD + 1, Math.round(yl * d));
      c.fillStyle = hot ? '#ffffff' : col; c.fillRect(kL, hD / d, kW, (lD - hD) / d);
      if (w < 4 || bh < 3) {
        c.fillStyle = col; c.fillRect(bL, top, bW, bh);
        if (hot && w >= 3) { c.fillStyle = '#ffffff'; c.fillRect(bL - px, top - px, bW + 2 * px, px); c.fillRect(bL - px, top + bh, bW + 2 * px, px); c.fillRect(bL - px, top, px, bh); c.fillRect(bL + bW, top, px, bh); }
      } else {
        const g = c.createLinearGradient(0, top, 0, top + bh); g.addColorStop(0, tn.hi); g.addColorStop(1, tn.lo);
        c.fillStyle = g; c.fillRect(bL, top, bW, bh);
        if (w >= 9 && bh >= 8) { c.fillStyle = 'rgba(255,255,255,.10)'; c.fillRect(bL + px, top + px, Math.max(px, Math.round(wd * 0.3) / d), bh - 2 * px); }
        c.fillStyle = hot ? '#ffffff' : tn.edge; c.fillRect(bL, top, bW, px); c.fillRect(bL, top + bh - px, bW, px); c.fillRect(bL, top, px, bh); c.fillRect(bL + bW - px, top, px, bh);
      }
      if (glow > 0) c.restore();
    },
    /* OHLC bar: high-low line, open tick left, close tick right (thicker on wide bars), snapped to device pixels */
    ohlc(c, x, w, yo, yh, yl, yc, up, hot, glow, glowCol) {
      const col = hot ? '#ffffff' : up ? UP : DN, d = FX.dp(c), kd = w >= 12 ? Math.max(2, Math.round(1.5 * d)) : Math.max(1, Math.round(0.75 * d)), k = kd / d;
      const cxD = Math.round(x * d), kL = (cxD - Math.floor(kd / 2)) / d, t = Math.max(2, Math.floor(w / 2)), S = v => Math.round(v * d) / d;
      if (glow > 0) { c.save(); c.shadowColor = rgba(glowCol || col, Math.min(1, glow)); c.shadowBlur = 6 + 16 * glow; }
      const hD = S(yh), lD = Math.max(hD + 1 / d, S(yl)), ro = S(yo) - k / 2, rc = S(yc) - k / 2;
      c.fillStyle = col; c.fillRect(kL, hD, k, lD - hD); c.fillRect(S(kL - t), S(ro), S(kL) - S(kL - t), k); c.fillRect(kL + k, S(rc), S(t), k);
      if (glow > 0) c.restore();
    },
    /* mountain (Bloomberg GP "Mountain"): blue gradient fill that settles into navy at the base, under a crisp near-white
       price line; the blue halo is kept tight (4 px) so the line edge stays sharp instead of smeared */
    mountain(c, xs, ys, base, col, lw) {
      const n = xs.length; if (!n) return;
      let top = base; for (const y of ys) if (y < top) top = y;
      const g = c.createLinearGradient(0, top, 0, base);
      g.addColorStop(0, rgba(col, 0.6)); g.addColorStop(0.45, rgba(col, 0.3)); g.addColorStop(1, rgba(col, 0.08));
      c.beginPath(); c.moveTo(xs[0], base); for (let k = 0; k < n; k++) c.lineTo(xs[k], ys[k]); c.lineTo(xs[n - 1], base); c.closePath(); c.fillStyle = g; c.fill();
      c.save(); c.shadowColor = rgba(col, 0.6); c.shadowBlur = 4; c.strokeStyle = shade(col, 0.72); c.lineWidth = lw; c.lineJoin = 'round'; c.lineCap = 'round';
      c.beginPath(); for (let k = 0; k < n; k++) k ? c.lineTo(xs[k], ys[k]) : c.moveTo(xs[k], ys[k]); if (n === 1) c.lineTo(xs[0] + 2, ys[0]);
      c.stroke(); c.restore(); c.lineWidth = 1;
    },
    /* point marker on a line (black ring keeps it readable over the fill) */
    dot(c, x, y, col) { c.fillStyle = '#000'; c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill(); c.fillStyle = col; c.beginPath(); c.arc(x, y, 3.2, 0, 7); c.fill(); },
    /* live-move ring expanding from the last point while the flash fades */
    ripple(c, x, y, f, col) {
      if (!(f > 0)) return; const r = 5 + (1 - f) * 20;
      c.save(); c.strokeStyle = rgba(col, 0.9 * f); c.lineWidth = 2; c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke(); c.fillStyle = rgba(col, 0.2 * f); c.fill(); c.restore(); c.lineWidth = 1;
    },
  };

  // ---------------- indicators
  const Ind = {
    sma(a, n) { const o = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; },
    ema(a, n) { const o = new Array(a.length).fill(null); const k = 2 / (n + 1); let e = null; for (let i = 0; i < a.length; i++) { if (i === n - 1) { let s = 0; for (let j = 0; j < n; j++) s += a[j]; e = s / n; } else if (i >= n) e = a[i] * k + e * (1 - k); if (i >= n - 1) o[i] = e; } return o; },
    bb(a, n = 20, m = 2) { const mid = Ind.sma(a, n), up = [], lo = []; for (let i = 0; i < a.length; i++) { if (mid[i] == null) { up.push(null); lo.push(null); continue; } let v = 0; for (let j = i - n + 1; j <= i; j++) v += (a[j] - mid[i]) ** 2; const sd = Math.sqrt(v / n); up.push(mid[i] + m * sd); lo.push(mid[i] - m * sd); } return { mid, up, lo }; },
    rsi(a, n = 14) { const o = new Array(a.length).fill(null); let g = 0, l = 0; for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1]; const gu = Math.max(d, 0), lo = Math.max(-d, 0); if (i <= n) { g += gu; l += lo; if (i === n) { g /= n; l /= n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (n - 1) + gu) / n; l = (l * (n - 1) + lo) / n; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; },
    macd(a, f = 12, s = 26, sig = 9) { const ef = Ind.ema(a, f), es = Ind.ema(a, s); const m = a.map((_, i) => ef[i] != null && es[i] != null ? ef[i] - es[i] : null); const first = m.findIndex(v => v != null); const sg = new Array(a.length).fill(null); if (first >= 0) { const e = Ind.ema(m.slice(first), sig); e.forEach((v, i) => sg[first + i] = v); } return { m, sg, h: m.map((v, i) => v != null && sg[i] != null ? v - sg[i] : null) }; },
    stdev(a) { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); },
  };

  function niceTicks(lo, hi, n) {
    if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
    const span = hi - lo, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => span / x <= n) || mag * 10;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(12));
    return { ticks: out, step };
  }
  function fmtAxis(v, step) {
    const a = Math.abs(v);
    if (a >= 1e12) return (v / 1e12).toFixed(1) + 'T'; if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M'; if (a >= 1e5) return (v / 1e3).toFixed(0) + 'K';
    const d = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)) + (step * Math.pow(10, Math.ceil(-Math.log10(step))) % 1 ? 1 : 0));
    return v.toFixed(d);
  }
  function fmtPx(v) { if (v == null || isNaN(v)) return '--'; const a = Math.abs(v); return a >= 1000 ? v.toFixed(2) : a >= 1 ? v.toFixed(2) : a >= 0.01 ? v.toFixed(4) : v.toPrecision(4); }
  function fmtVol(v) { if (!v) return '0'; if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'; return '' + v; }
  const fmtPct = v => v == null || isNaN(v) ? '--' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(t, intraday, full) {
    const d = new Date(t * 1000);
    if (intraday) { const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); return full ? (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm : hm; }
    return full ? String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getFullYear()).slice(2) : MON[d.getMonth()];
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class Base {
    constructor(host) {
      this.host = host; host.classList.add('chart-host'); host.classList.add('ch-loading'); this._born = Date.now();
      this.cv = document.createElement('canvas'); host.appendChild(this.cv);
      this.ctx = this.cv.getContext('2d'); if ('letterSpacing' in this.ctx) this.ctx.letterSpacing = "0px"; this.mouse = null;
      this.ro = new ResizeObserver(() => { cancelAnimationFrame(this.rf); this.rf = requestAnimationFrame(() => this.resize()); }); this.ro.observe(host);
      this.cv.addEventListener('mousemove', e => { const r = this.cv.getBoundingClientRect(); this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top }; this.onMove && this.onMove(e); this.draw(); });
      this.cv.addEventListener('mouseleave', () => { this.mouse = null; this.drag = null; this.draw(); });
      this.resize();
      // moving the window to a monitor with another scale factor changes devicePixelRatio without resizing the host
      const watchDpr = () => { try { const mq = matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)'), on = () => { mq.removeEventListener('change', on); if (!this.dead) { this.resize(); watchDpr(); } }; mq.addEventListener('change', on); } catch (e) { } };
      watchDpr();
      if (Base.onCreate) Base.onCreate(this);
      try { document.fonts && document.fonts.ready.then(() => { famC = ''; this.cv.isConnected && this.draw(); }); } catch (e) { }
      this._lt = setTimeout(() => { if (!this._loaded && this.cv.isConnected) { this.host.classList.remove('ch-loading'); this.draw(); } }, 20500);
    }
    /* tack-sharp at any scale factor: the backing store is a whole number of device pixels, the CSS size is exactly
       backing / devicePixelRatio (a fractional host width is floored to the device pixel, so the browser never resamples
       the bitmap by a fraction of a pixel) and the transform is exactly dpr; hairlines are snapped to device pixels */
    resize() {
      // layout size: the bounding rect keeps the fractional width, but while a panel animates with a CSS scale() it reports
      // the transformed size (the canvas then stayed a few px short after the animation); fall back to offsetWidth then
      const r = this.host.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, ow = this.host.offsetWidth, oh = this.host.offsetHeight;
      const rw = Math.abs(r.width - ow) <= 1 ? r.width : ow, rh = Math.abs(r.height - oh) <= 1 ? r.height : oh;
      const bw = Math.max(1, Math.floor(Math.max(50, rw) * dpr + 0.01)), bh = Math.max(1, Math.floor(Math.max(50, rh) * dpr + 0.01));
      this.W = bw / dpr; this.H = bh / dpr;
      if (this.cv.width !== bw) this.cv.width = bw; if (this.cv.height !== bh) this.cv.height = bh;
      this.cv.style.width = this.W + 'px'; this.cv.style.height = this.H + 'px';
      this.dpr = dpr; this.hk = Math.max(1, Math.round(0.75 * this.dpr)); this.hw = this.hk / this.dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); if ('letterSpacing' in this.ctx) this.ctx.letterSpacing = "0px"; this._fz = {}; this.draw();
      this.sideFit();
    }
    /* small cells: a scrolling details column beside the chart (HOPT, WETR, GOVC, CENB …) collapses into a "Details" chip
       on the chart; the chip opens the column as an overlay on the right and closes it again */
    sideFit() {
      const row = this.host.parentElement; if (!row || this.dead || this.host.classList.contains('no-sidefit')) return;
      let cs; try { cs = getComputedStyle(row); } catch (e) { return; }
      if (cs.display !== 'flex' || /column/.test(cs.flexDirection)) return;
      const sides = [...row.children].filter(x => x !== this.host && x.tagName === 'DIV' && !x.classList.contains('chart-host') && (x.classList.contains('ch-side') || /auto|scroll/.test(getComputedStyle(x).overflowY)));
      if (!sides.length) return;
      const rw = row.getBoundingClientRect().width; if (!rw) return;
      const small = rw < 900;
      if (small === !!this._sideMin) return;
      this._sideMin = small; row.classList.toggle('ch-siderow', small); row.classList.remove('ch-side-open'); sides.forEach(x => x.classList.toggle('ch-side', small));
      if (small) {
        const b = this._sideChip = document.createElement('button'); b.className = 'ch-sidechip'; b.textContent = 'Details ▸'; b.title = 'Show / hide the details column';
        b.onclick = e => { e.stopPropagation(); const o = row.classList.toggle('ch-side-open'); b.classList.toggle('on', o); b.textContent = o ? 'Details ◂' : 'Details ▸'; };
        this.host.appendChild(b);
      } else if (this._sideChip) { this._sideChip.remove(); this._sideChip = null; }
    }
    /* centre of a crisp hairline at CSS coordinate v (use with lineWidth = this.hw) */
    hx(v) { const d = this.dpr || 1; return (Math.floor(v * d) + (this.hk || 1) / 2) / d; }
    /* snap a CSS coordinate to the device-pixel grid (edges of filled bars and boxes) */
    sp(v) { const d = this.dpr || 1; return Math.round(v * d) / d; }
    /* rendered font size in px for a design size (the TEXT boost is added inside the canvas font setter by bb/fontboost.js) */
    fz(px) { const k = px + '|' + (window.Atlas && Atlas.fontBoost ? Atlas.fontBoost() : 0) + '|' + fam(); this._fz = this._fz || {}; if (this._fz[k]) return this._fz[k]; const c = this.ctx; const was = c.font; c.font = font(px); const m = /(\d+(?:\.\d+)?)px/.exec(c.font); c.font = was; return (this._fz[k] = m ? +m[1] : px); }
    boxH() { return Math.max(22, Math.round(this.fz(FS_S) + 7)); }
    destroy() { this.dead = true; this.ro.disconnect(); cancelAnimationFrame(this.rf); cancelAnimationFrame(this._raf); clearTimeout(this._lt); this.cv.remove(); }
    loaded() { if (!this._loaded) { this._loaded = true; this.host.classList.remove('ch-loading'); } }
    /* publish the plot top so the drawing toolbar (charts.css) sits under the legend, not on it */
    setTop(T) { if (this._T !== T) { this._T = T; try { this.host.style.setProperty('--ch-t', T + 'px'); } catch (e) { } } }
    /* empty / loading frame: grid skeleton + a short status line (never a lone sentence on black) */
    empty() {
      const c = this.ctx, W = this.W, H = this.H, RA = 64, BA = 30, bh = this.boxH(), T = bh + 8, L = 6;
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      c.strokeStyle = GRID; c.setLineDash(GD); c.lineWidth = this.hw || 1;
      const rows = Math.max(2, Math.floor((H - T - BA) / 50));
      for (let k = 0; k <= rows; k++) { const y = this.hx(T + (H - T - BA) * k / rows); c.beginPath(); c.moveTo(L, y); c.lineTo(W - RA, y); c.stroke(); }
      const cols = Math.max(2, Math.floor((W - RA - L) / 110));
      for (let k = 1; k < cols; k++) { const x = this.hx(L + (W - RA - L) * k / cols); c.beginPath(); c.moveTo(x, T); c.lineTo(x, H - BA); c.stroke(); }
      c.setLineDash([]); c.strokeStyle = AXL; c.beginPath(); c.moveTo(this.hx(W - RA), T); c.lineTo(this.hx(W - RA), H - BA); c.moveTo(L, this.hx(H - BA)); c.lineTo(W - RA, this.hx(H - BA)); c.stroke(); c.lineWidth = 1;
      const loading = !this._loaded && Date.now() - (this._born || 0) < 20000;
      c.font = font(FS_S); c.textBaseline = 'middle';
      const s = loading ? 'Loading…' : this._loaded ? '--  No data available for this range' : '--  No data';
      const w = c.measureText(s).width + 16;
      c.fillStyle = BOXBG; c.fillRect(L + 2, 4, w, bh); c.fillStyle = BOXLN; const hw = this.hw || 1; c.fillRect(L + 2, 4, w, hw); c.fillRect(L + 2, 4 + bh - hw, w, hw); c.fillRect(L + 2, 4, hw, bh); c.fillRect(L + 2 + w - hw, 4, hw, bh);
      c.font = font(FS_S); c.textBaseline = 'middle'; c.fillStyle = loading ? AMBER : DIM; c.fillText(s, L + 10, 4 + bh / 2 + 0.5);
    }
    label(x, y, text, bg, fg = '#000', align = 'left') {
      const c = this.ctx, h = Math.max(20, Math.round(this.fz(FS) + 6)); c.font = font(FS); const w = Math.round(c.measureText(text).width + 12); const x0 = this.sp(align === 'right' ? x - w : align === 'center' ? x - w / 2 : x), y0 = this.sp(y - h / 2);
      c.fillStyle = bg; c.fillRect(x0, y0, w, h); c.fillStyle = fg; c.textBaseline = 'middle'; c.fillText(text, x0 + 6, y0 + h / 2 + 0.5);
    }
    /* right-axis price tag with a notch pointing at the plot (Bloomberg last-price / crosshair tag); height follows the font */
    tag(x, y, text, bg, fg) {
      const c = this.ctx, h = Math.max(20, Math.round(this.fz(FS) + 6)); c.font = font(FS); const w = Math.round(c.measureText(text).width + 12), y0 = this.sp(clamp(y, h / 2, this.H - h / 2)), n = Math.round(h * 0.32);
      c.fillStyle = bg; c.beginPath(); c.moveTo(x, y0); c.lineTo(x + n, y0 - h / 2); c.lineTo(x + n + w, y0 - h / 2); c.lineTo(x + n + w, y0 + h / 2); c.lineTo(x + n, y0 + h / 2); c.closePath(); c.fill();
      c.fillStyle = fg || ink(bg); c.textBaseline = 'middle'; c.fillText(text, x + n + 6, y0 + 0.5);
    }
    /* legend boxes (one box per series: line swatch, gray label, value in the series colour), wrapped onto maxLines rows */
    layoutBoxes(rows, maxW, maxLines) {
      const c = this.ctx; c.font = font(FS_S); const items = []; let cx = 0, line = 0;
      for (const r of rows) {
        const [t, , v] = r, w = 30 + c.measureText(t).width + (v != null && v !== '' ? 10 + c.measureText(String(v)).width : 0) + 8;
        if (cx > 0 && cx + w > maxW) { line++; cx = 0; }
        if (line >= maxLines) break;
        items.push({ r, x: cx, w, line }); cx += w + 4;
      }
      return { items, lines: items.length ? items[items.length - 1].line + 1 : 0 };
    }
    drawBoxes(lay, x, y, lh) {
      const c = this.ctx; lh = Math.max(lh || 0, this.boxH() - (lh && lh < 22 ? 3 : 0)); c.font = font(FS_S); c.textBaseline = 'middle';
      for (const it of lay.items) {
        const [t, col, v] = it.r, bx = this.sp(x + it.x), by = this.sp(y + it.line * (lh + 3)), my = by + lh / 2 + 0.5, bw = this.sp(it.w);
        c.fillStyle = BOXBG; c.fillRect(bx, by, bw, lh);
        c.fillStyle = BOXLN; const hw = this.hw || 1; c.fillRect(bx, by, bw, hw); c.fillRect(bx, by + lh - hw, bw, hw); c.fillRect(bx, by, hw, lh); c.fillRect(bx + bw - hw, by, hw, lh);   // 1-device-px frame
        c.fillStyle = col; c.fillRect(bx + 7, this.sp(my - 1.5), 15, 3);
        c.fillStyle = AXIS; c.fillText(t, bx + 30, my);
        if (v != null && v !== '') { const s = String(v); c.fillStyle = valCol(col); c.fillText(s, Math.round(bx + it.w - 8 - c.measureText(s).width), my); }
      }
    }
    /* multi-row legend box (kept for callers) */
    legend(rows, x, y) {
      const c = this.ctx; c.font = font(FS_S); c.textBaseline = 'middle';
      const w = Math.max(...rows.map(r => c.measureText(r[0]).width + (r[2] ? c.measureText(r[2]).width + 14 : 0))) + 32;
      c.fillStyle = 'rgba(11,11,11,.9)'; c.fillRect(x, y, w, rows.length * 22 + 6); c.strokeStyle = BOXLN; c.strokeRect(x + 0.5, y + 0.5, w - 1, rows.length * 22 + 5);
      rows.forEach(([t, col, v], k) => { const yy = y + 14 + k * 22; c.fillStyle = col; c.fillRect(x + 7, yy - 1.5, 15, 3); c.fillStyle = AXIS; c.fillText(t, x + 27, yy); if (v) { c.fillStyle = valCol(col); c.fillText(v, x + w - 7 - c.measureText(v).width, yy); } });
    }
    /* single-row legend above the plot, clipped to the available width (kept for callers) */
    legendStrip(rows, x, y, maxW) { this.drawBoxes(this.layoutBoxes(rows, maxW, 1), x, y, 22); }
    /* crosshair readout bar: date then label/value pairs */
    readout(parts, y, h, W) {
      const c = this.ctx, hw = this.hw || 1; c.fillStyle = CHROME; c.fillRect(0, y, W, h); c.fillStyle = LINE; c.fillRect(0, this.sp(y + h) - hw, W, hw);
      c.font = font(FS_S); c.textBaseline = 'middle'; let x = 8; const my = y + h / 2 + 0.5;
      const right = this._tog && this._tog.isConnected && this._tog.style.display !== 'none' ? (this._togW || (this._togW = this._tog.offsetWidth) || 70) + 14 : 12;     // keep clear of the Draw button (width read once, no layout per frame)
      for (const [lab, v, col] of parts) {
        const lw = lab ? c.measureText(lab).width + 5 : 0, vw = c.measureText(v).width;
        if (x + lw + vw > W - right) break;
        if (lab) { c.fillStyle = DIM; c.fillText(lab, Math.round(x), my); }
        c.fillStyle = col || TXT; c.fillText(v, Math.round(x + lw), my); x += lw + vw + 14;
      }
    }
    /* two-tier time axis: months (or times) on the first row, the year (or day) under the first label of each */
    timeAxis(ts, X, y, intraday, every) {
      const c = this.ctx; c.font = font(FS); c.textBaseline = 'top'; c.fillStyle = AXIS; let lastY = null;
      for (let k = 0; k < ts.length; k += every) {
        const t = ts[k], d = new Date(t * 1000), x = X(k);
        const top = intraday ? String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : MON[d.getMonth()];
        c.fillStyle = AXIS; c.fillText(top, x - c.measureText(top).width / 2, y);
        const yr = intraday ? (d.getMonth() + 1) + '/' + d.getDate() : '' + d.getFullYear();
        if (yr !== lastY) { c.fillStyle = DIM; c.fillText(yr, x - c.measureText(yr).width / 2, y + 19); lastY = yr; }
      }
    }
  }

  // ===================================================== PriceChart
  class PriceChart extends Base {
    constructor(host, opts = {}) {
      super(host);
      this.o = Object.assign({ type: 'candle', sma: [50, 200], ema: [], bb: false, vol: true, rsi: false, macd: false, log: false, compare: [] }, opts);
      this.bars = []; this.intraday = false; this.yman = null;          // yman: a price range set by hand on the price axis
      /* zoom the way charting platforms do: the mouse wheel zooms time (anchored at the mouse) or, over the price axis, prices;
         dragging the price axis (side) stretches / squeezes prices, dragging the time axis (bottom) shows more / fewer bars
         (newest edge fixed), dragging the plot pans (and moves prices too once they are scaled by hand); double-click an axis
         to reset it, the plot to reset both; AUTO (bottom-right corner) returns to automatic price scaling */
      this.cv.addEventListener('wheel', e => { e.preventDefault(); const f = e.deltaY > 0 ? 1.15 : 1 / 1.15; if (this.zone(e) === 'py') this.yZoom(f); else this.zoom(f); }, { passive: false });
      this.cv.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        const z = this.zone(e);
        if (z === 'auto') { this.yman = null; this.draw(); return; }
        this.drag = { z: z || 'plot', x: e.clientX, y: e.clientY, i0: this.i0, i1: this.i1, lo: this._lo, hi: this._hi };
        if (z === 'py' || z === 'tx') e.preventDefault();
      });
      window.addEventListener('mouseup', () => this.drag = null);
      this.cv.addEventListener('dblclick', e => {
        const z = this.zone(e);
        if (z !== 'tx') this.yman = null;
        if (z !== 'py' && z !== 'auto') { this.i0 = 0; this.i1 = this.bars.length - 1; }
        this.draw();
      });
      // resize cursors over the axes (registered after the drawing tools' hover handler, which resets the cursor)
      this.cv.addEventListener('mousemove', e => {
        const z = this.drag ? this.drag.z : this.zone(e), cur = z === 'py' ? 'ns-resize' : z === 'tx' ? 'ew-resize' : z === 'auto' ? 'pointer' : '';
        if (cur) this.cv.style.cursor = cur; else if (/resize|pointer/.test(this.cv.style.cursor)) this.cv.style.cursor = '';
      });
    }
    /* which part of the chart a mouse event is over: py = price axis, tx = time axis, auto = the AUTO box, plot */
    zone(e) {
      const m = this.map; if (!m || m.kind !== 'price') return null;
      const r = this.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (this.yman && x >= m.W - m.RA && y >= m.H - m.BA) return 'auto';
      if (x >= m.W - m.RA && y >= m.T && y <= m.T + m.PH && !m.cmp) return 'py';
      if (y >= m.H - m.BA && x < m.W - m.RA) return 'tx';
      if (x >= m.L && x <= m.L + m.PW && y >= m.T && y <= m.T + m.PH) return 'plot';
      return null;
    }
    onMove(e) {
      const d = this.drag; if (!d || !this.bars.length) return;
      if (d.z === 'py') {                                   // price axis: drag up = zoom in (stretch), down = zoom out
        if (d.lo == null) return;
        const f = Math.exp((e.clientY - d.y) * 0.006), c = (d.lo + d.hi) / 2, h = (d.hi - d.lo) / 2 * f;
        this.yman = { lo: c - h, hi: c + h }; return;
      }
      if (d.z === 'tx') {                                   // time axis: drag right = zoom in, left = zoom out; newest edge fixed
        const n0 = d.i1 - d.i0 + 1, nn = clamp(Math.round(n0 * Math.exp(-(e.clientX - d.x) * 0.006)), Math.min(10, this.bars.length), this.bars.length);
        this.i1 = d.i1; this.i0 = Math.max(0, d.i1 - nn + 1);
        if (this.i1 - this.i0 + 1 < nn) this.i1 = Math.min(this.bars.length - 1, this.i0 + nn - 1);
        return;
      }
      if (d.z !== 'plot') return;
      const n = d.i1 - d.i0 + 1, bw = this.plotW / n;
      let sh = Math.round((d.x - e.clientX) / bw);
      sh = Math.max(-d.i0, Math.min(this.bars.length - 1 - d.i1, sh));
      this.i0 = d.i0 + sh; this.i1 = d.i1 + sh;
      if (this.yman && d.lo != null && this.map) { const dv = (e.clientY - d.y) / this.map.PH * (d.hi - d.lo); this.yman = { lo: d.lo + dv, hi: d.hi + dv }; }
    }
    /* empty slots after the newest bar: drawing room (futurePad) or, on a day chart (dayEnd / dayStep), the rest of the session */
    fpad() {
      const B = this.bars;
      if (this.dayEnd && B.length && this.i1 >= B.length - 1) return Math.max(0, Math.round((this.dayEnd - B[B.length - 1].t) / (this.dayStep || 60)));
      return this.futurePad || 0;
    }
    /* price-axis wheel zoom about the middle of the visible range */
    yZoom(f) { if (this._lo == null) return; const c = (this._lo + this._hi) / 2, h = (this._hi - this._lo) / 2 * f; this.yman = { lo: c - h, hi: c + h }; this.draw(); }
    zoom(f) {
      if (!this.bars.length) return;
      const n = this.i1 - this.i0 + 1; let nn = Math.round(n * f); nn = Math.max(10, Math.min(this.bars.length, nn));
      let anchor = this.i1;
      if (this.mouse && this.plotW) { anchor = this.i0 + Math.round((this.mouse.x - 6) / this.plotW * n); }
      const frac = (anchor - this.i0) / n;
      let i0 = Math.round(anchor - frac * nn); i0 = Math.max(0, Math.min(this.bars.length - nn, i0));
      this.i0 = i0; this.i1 = i0 + nn - 1; this.draw();
    }
    setData(bars, intraday) {
      const ob = this.bars || [], nb = bars || [];
      // a different security / range draws in; the same series reloaded only moves its newest bar
      const fresh = !ob.length || !nb.length || nb[0].t !== ob[0].t || !!intraday !== this.intraday || Math.abs(nb.length - ob.length) > 3;
      this.loaded(); this.bars = nb; this.intraday = !!intraday; this.i0 = 0; this.i1 = this.bars.length - 1;
      if (fresh) { this.yman = null; if (nb.length) FX.intro(this); } else FX.move(this, ob, nb);
      this.calc(); this.draw();
    }
    setOpts(o) { const ty = o && o.type && o.type !== this.o.type; Object.assign(this.o, o); if (ty && this.bars.length) FX.intro(this); this.calc(); this.draw(); }
    /* live update: replace bars, keep the visible window; if the view was at the right edge, follow new bars */
    update(bars, intraday) {
      if (!bars || !bars.length) return;
      if (this.replay) { this.replay.all = bars; return; }
      if (!this.bars.length) return this.setData(bars, intraday);
      const follow = this.i1 >= this.bars.length - 1, span = this.i1 - this.i0, ob = this.bars;
      this.bars = bars; this.intraday = !!intraday;
      if (follow) { this.i1 = bars.length - 1; this.i0 = Math.max(0, this.i1 - span); }
      else { this.i1 = Math.min(this.i1, bars.length - 1); this.i0 = Math.min(this.i0, this.i1); }
      FX.move(this, ob, bars);
      this.calc(); this.draw();
    }
    /* live update of the newest bar from a last-trade print (daily / weekly / monthly candles) */
    tick(price, hi, lo, vol, t, newBar) {
      if (!this.bars.length || price == null || this.replay) return;
      if (newBar) { this.update(this.bars.concat([{ t, o: newBar.o != null ? newBar.o : price, h: hi != null ? hi : price, l: lo != null ? lo : price, c: price, v: vol || 0, a: price }]), this.intraday); return; }
      const ob = this.bars, b = Object.assign({}, ob[ob.length - 1]);
      b.c = price; b.a = price; b.h = Math.max(b.h, hi != null ? hi : price, price); b.l = Math.min(b.l, lo != null ? lo : price, price); if (vol) b.v = Math.max(b.v || 0, vol);
      this.bars = ob.slice(0, -1).concat([b]); FX.move(this, ob, this.bars); this.calc(); this.draw();
    }
    calc() {
      const c = this.bars.map(b => b.c); this.ind = { sma: {}, ema: {} };
      this.o.sma.forEach(n => this.ind.sma[n] = Ind.sma(c, n));
      this.o.ema.forEach(n => this.ind.ema[n] = Ind.ema(c, n));
      if (this.o.bb) this.ind.bb = Ind.bb(c);
      if (this.o.rsi) this.ind.rsi = Ind.rsi(c);
      if (this.o.macd) this.ind.macd = Ind.macd(c);
      // comparison series aligned by timestamp (nearest prior)
      this.cmp = (this.o.compare || []).map(s => {
        const out = new Array(this.bars.length).fill(null); let j = 0;
        for (let i = 0; i < this.bars.length; i++) { while (j + 1 < s.bars.length && s.bars[j + 1].t <= this.bars[i].t) j++; if (s.bars[j] && s.bars[j].t <= this.bars[i].t + 86400) out[i] = s.bars[j].c; }
        return { name: s.name, vals: out };
      });
    }
    draw() {
      const c = this.ctx, W = this.W, H = this.H; if (!c || !this.bars || !this.o) return;
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      if (!this.bars.length || !this.ind) { this.setTop(30); return this.empty(); }
      const i0 = Math.max(0, Math.min(this.i0, this.bars.length - 1)), i1 = Math.max(i0, Math.min(this.i1, this.bars.length - 1));
      this.i0 = i0; this.i1 = i1;
      const fp = this.fpad(), nVis = i1 - i0 + 1, n = nVis + fp;
      const cmpMode = this.cmp.length > 0, big = H > 220, lineType = this.o.type === 'line' || this.o.type === 'area';
      const ip = FX.introP(this), fl = FX.flash(this), flc = FX.flashCol(this), nLast = this.bars.length - 1;
      const base = this.bars[i0].c;
      const val = v => cmpMode ? (v / base - 1) * 100 : v;
      const AF = font(FS);
      // metrics follow the rendered font (TEXT boost), so axes, tags and legend rows never clip; small cells (16-panel) go compact
      const fzA = this.fz(FS), fzS = this.fz(FS_S), boxH = this.boxH(), compact = H < 240 || W < 430, hw = this.hw || 1;
      // ---- value range of the visible window
      let lo = Infinity, hi = -Infinity;
      for (let i = i0; i <= i1; i++) {
        const b = this.bars[i];
        if (cmpMode) { const v = val(b.c); lo = Math.min(lo, v); hi = Math.max(hi, v); }
        else { lo = Math.min(lo, lineType ? b.c : b.l); hi = Math.max(hi, lineType ? b.c : b.h); }
        if (!cmpMode) {
          for (const k in this.ind.sma) { const v = this.ind.sma[k][i]; if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
          for (const k in this.ind.ema) { const v = this.ind.ema[k][i]; if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
          if (this.ind.bb && this.ind.bb.up[i] != null) { lo = Math.min(lo, this.ind.bb.lo[i]); hi = Math.max(hi, this.ind.bb.up[i]); }
        }
      }
      this.cmp.forEach(s => { const ref = s.vals.slice(i0, i1 + 1).find(v => v != null); for (let i = i0; i <= i1; i++) if (s.vals[i] != null && ref) { const v = (s.vals[i] / ref - 1) * 100; lo = Math.min(lo, v); hi = Math.max(hi, v); } s.ref = ref; });
      if (!isFinite(lo) || !isFinite(hi)) { this.setTop(30); return this.empty(); }
      const pad = (hi - lo) * 0.06 || Math.abs(hi) * 0.01 || 1; lo -= pad; hi += pad;
      if (this.yman && !cmpMode && this.yman.hi > this.yman.lo) { lo = this.yman.lo; hi = this.yman.hi; }       // scaled by hand
      this._lo = lo; this._hi = hi;
      // ---- series list (colours fixed before drawing so the legend can be laid out first)
      const mainCol = cmpMode ? PAL[0] : this.o.type === 'area' ? MTN : TXT;
      const inds = []; let k = 1;
      if (!cmpMode) {
        for (const n2 in this.ind.sma) inds.push({ nm: 'SMA (' + n2 + ')', col: PAL[k++ % PAL.length], arr: this.ind.sma[n2] });
        for (const n2 in this.ind.ema) inds.push({ nm: 'EMA (' + n2 + ')', col: PAL[k++ % PAL.length], arr: this.ind.ema[n2], dash: [4, 3] });
        if (this.ind.bb) inds.push({ nm: 'Bollinger (20,2)', col: '#ba68c8', arr: this.ind.bb.mid, bb: true });
      }
      this.legendInd = inds.map(x => [x.nm, x.col, x.arr]);
      let hiI = i0, loI = i0, sum = 0;
      for (let i = i0; i <= i1; i++) { if (this.bars[i].c > this.bars[hiI].c) hiI = i; if (this.bars[i].c < this.bars[loI].c) loI = i; sum += this.bars[i].c; }
      // ---- top: readout bar (big charts) + legend boxes, both kept off the plot
      const RB = big ? Math.max(22, Math.round(fzS + 8)) : 0, L = 6, BA = compact ? Math.round(fzA + 11) : Math.round(2 * fzA + 12);
      let legRows = [];
      if (big) {
        if (cmpMode) {
          legRows.push([this.name || 'Main', PAL[0], fmtPct(val(this.bars[i1].c))]);
          this.cmp.forEach((s, j) => { let lv = null; for (let i = i1; i >= i0; i--) if (s.vals[i] != null) { lv = s.vals[i]; break; } legRows.push([s.name, PAL[(j + 1) % PAL.length], s.ref && lv != null ? fmtPct((lv / s.ref - 1) * 100) : '--']); });
        } else {
          legRows = [['Last Price', mainCol, fmtPx(this.bars[i1].c)], ['High on ' + fmtDate(this.bars[hiI].t, this.intraday, true), UP, fmtPx(this.bars[hiI].c)],
            ['Average', AMBER, fmtPx(sum / nVis)], ['Low on ' + fmtDate(this.bars[loI].t, this.intraday, true), DN, fmtPx(this.bars[loI].c)]];
          inds.forEach(x => legRows.push([x.nm, x.col, x.arr[i1] != null ? fmtPx(x.arr[i1]) : '--']));
        }
      }
      const lay = big ? this.layoutBoxes(legRows, W - L - 8, H > 420 ? 2 : 1) : { items: [], lines: 0 };
      const T = big ? RB + 4 + lay.lines * (boxH + 3) + 4 : 8;
      this.setTop(T);
      const lower = []; if (this.o.vol) lower.push('vol'); if (this.o.rsi) lower.push('rsi'); if (this.o.macd) lower.push('macd');
      if (lower.length > 1) lower.length = Math.min(lower.length, H < 300 ? 1 : H < 460 ? 2 : 3);       // small cells keep the price plot readable
      const lowH = lower.length ? Math.min(0.22, 0.5 / lower.length) * (H - T - BA) : 0;
      const mainH = H - T - BA - lowH * lower.length;
      const useLog = this.o.log && !cmpMode && lo > 0;
      const tf = v => useLog ? Math.log(v) : v;
      const Y = v => T + (tf(hi) - tf(v)) / (tf(hi) - tf(lo)) * mainH;
      const Yinv = y => { const f = tf(hi) - (y - T) / mainH * (tf(hi) - tf(lo)); return useLog ? Math.exp(f) : f; };
      const { ticks, step } = niceTicks(lo, hi, Math.max(compact ? 2 : 3, Math.floor(mainH / Math.max(45, fzA * 2.6))));
      const tickTxt = v => cmpMode ? v.toFixed(1) + '%' : fmtAxis(v, step);
      // ---- right axis width from the widest label
      c.font = AF; let maxLab = 0;
      ticks.forEach(v => maxLab = Math.max(maxLab, c.measureText(tickTxt(v)).width));
      const lastV = val(FX.disp(this, this.bars, i1).c);             // the newest price as drawn (glides on live moves)
      maxLab = Math.max(maxLab, c.measureText(cmpMode ? fmtPct(lastV) : fmtPx(lastV)).width, c.measureText(cmpMode ? fmtPct(hi) : fmtPx(hi)).width);
      if (this.o.vol && !compact) { let mv = 0; for (let i = i0; i <= i1; i++) mv = Math.max(mv, this.bars[i].v || 0); maxLab = Math.max(maxLab, c.measureText(fmtVol(mv)).width); }
      const RA = Math.round(clamp(maxLab + 24, 64, 160));
      this.plotW = W - RA - L;
      const bw = this.plotW / n;
      const X = i => L + (i - i0 + 0.5) * bw;
      this.map = { kind: 'price', L, T, PW: this.plotW, PH: mainH, X, Y, Yinv, bw, i0, i1, cmp: cmpMode, W, H, RA, BA };
      const PB = AtlasChart.PLOTBG, GRID = PB ? PGRID : GRID0;
      if (PB) { c.fillStyle = PB; c.fillRect(L, T, this.plotW, H - BA - T); }
      // ---- grid + axes
      c.strokeStyle = GRID; c.setLineDash(GD); c.lineWidth = hw; c.textBaseline = 'middle'; c.font = AF;
      const tagY0 = clamp(Y(lastV), T + 10, T + mainH - 10), tagGap = Math.max(15, (fzA + 6) * 0.8);
      ticks.forEach(v => { const y = this.hx(Y(v)); if (y < T || y > T + mainH) return; c.strokeStyle = cmpMode && v === 0 ? '#5a5a5a' : GRID; c.setLineDash(cmpMode && v === 0 ? [] : GD); c.beginPath(); c.moveTo(L, y); c.lineTo(L + this.plotW, y); c.stroke(); if (Math.abs(y - tagY0) < tagGap) return; c.fillStyle = AXIS; c.fillText(tickTxt(v), W - RA + 9, y); });   // labels under the last-price tag are hidden
      const marks = this.timeMarks(i0, i1 + (this.dayEnd ? fp : 0), X, bw, compact ? 1.25 : 1);
      c.strokeStyle = GRID; c.setLineDash(GD);
      marks.forEach(mk => { const x = this.hx(X(mk.i)); c.beginPath(); c.moveTo(x, T); c.lineTo(x, H - BA); c.stroke(); });
      const ax = this.hx(W - RA), ay = this.hx(H - BA);
      c.setLineDash([]); c.strokeStyle = AXL; c.beginPath(); c.moveTo(ax, T); c.lineTo(ax, H - BA); c.moveTo(L, ay); c.lineTo(W - RA, ay); c.stroke();
      // tick marks on the price and time axes
      ticks.forEach(v => { const y = this.hx(Y(v)); if (y < T || y > T + mainH) return; c.beginPath(); c.moveTo(W - RA, y); c.lineTo(W - RA + 4, y); c.stroke(); });
      marks.forEach(mk => { const x = this.hx(X(mk.i)); c.beginPath(); c.moveTo(x, H - BA); c.lineTo(x, H - BA + 4); c.stroke(); });
      c.font = AF; c.textBaseline = 'top';
      marks.forEach(mk => {
        // compact cells: one label row ("Jan 2026", "09:30 10/5"); otherwise the year / day goes on a second, dimmer row
        const top = compact && mk.sub ? mk.top + ' ' + mk.sub : mk.top;
        const x = X(mk.i), tw = c.measureText(top).width, lx = clamp(x - tw / 2, L, W - RA - tw - 2);
        c.fillStyle = AXIS; c.fillText(top, Math.round(lx), H - BA + 5);
        if (mk.sub && !compact) { const sw = c.measureText(mk.sub).width; c.fillStyle = DIM; c.fillText(mk.sub, Math.round(clamp(x - sw / 2, L, W - RA - sw - 2)), H - BA + 7 + fzA); }
      });
      // ---- hover position (shared by panes, crosshair and readout)
      const m = this.mouse; let hi_i = i1, hovering = false;
      if (m && m.x > L && m.x < L + this.plotW && m.y > T && m.y < H - BA) { hovering = true; hi_i = Math.max(i0, Math.min(i1, i0 + Math.floor((m.x - L) / bw))); }
      // ---- main series
      c.save(); c.beginPath(); c.rect(L, T, this.plotW, mainH); c.clip();
      // extended-hours sessions shaded behind the price (pre-market / after-hours / overnight futures)
      if (this.intraday && this.sessions && this.sessions.length && !cmpMode) {
        const idx = t => { let lo2 = 0, hi2 = this.bars.length; while (lo2 < hi2) { const md = (lo2 + hi2) >> 1; if (this.bars[md].t < t) lo2 = md + 1; else hi2 = md; } return lo2; };
        const SC = { pre: ['rgba(78,168,252,.10)', '#7fb4ff', 'PRE-MARKET'], post: ['rgba(186,104,200,.12)', '#d29be0', 'AFTER HOURS'], night: ['rgba(120,120,160,.10)', '#a9a9c9', 'OVERNIGHT'] };
        c.font = font(FS_XS); c.textBaseline = 'top';
        this.sessions.forEach(ss => {
          const a = idx(ss.from), z = idx(ss.to) - 1; if (z < a || z < i0 || a > i1) return;
          const x0 = this.sp(Math.max(L, X(a) - bw / 2)), x1 = this.sp(Math.min(L + this.plotW, X(z) + bw / 2)), sc = SC[ss.kind] || SC.night;
          c.fillStyle = sc[0]; c.fillRect(x0, T, x1 - x0, mainH);
          c.fillStyle = rgba(sc[1], 0.45); c.fillRect(x0, T, hw, mainH); c.fillRect(x1 - hw, T, hw, mainH);           // thin session borders
          if (x1 - x0 > c.measureText(sc[2]).width + 12) { c.fillStyle = sc[1]; c.fillText(sc[2], x0 + 5, T + 4); }
        });
      }
      if (cmpMode) {
        // relative performance: compare lines first, the main security on top in white with a faint glow
        this.cmp.forEach((s, j) => s.ref && this.line(i => s.vals[i] == null ? null : (s.vals[i] / s.ref - 1) * 100, Y, X, PAL[(j + 1) % PAL.length], 1.6));
        c.save(); c.shadowColor = 'rgba(255,255,255,.35)'; c.shadowBlur = 4; this.line(i => val(this.bars[i].c), Y, X, PAL[0], 1.9); c.restore();
      } else if (this.o.type === 'candle' || this.o.type === 'ohlc') {
        // detailed candles: gradient bodies with a lighter edge, doji ticks, the bar under the crosshair highlighted,
        // the newest bar gliding to each live price and glowing green (up-tick) or red (down-tick)
        const w = Math.max(1, Math.floor(bw * 0.72)), one = this.o.type === 'candle' ? FX.candle : FX.ohlc;
        if (hovering && bw >= 3) { c.fillStyle = 'rgba(255,255,255,.07)'; c.fillRect(Math.round(X(hi_i) - bw / 2), T, Math.max(1, Math.round(bw)), mainH); }
        if (i1 === nLast) FX.column(c, X(nLast), bw, T, mainH, fl, flc);
        for (let i = i0; i <= i1; i++) {
          const b = FX.disp(this, this.bars, i); let yo = Y(b.o), yh = Y(b.h), yl = Y(b.l), yc = Y(b.c);
          if (ip < 1) { const k = FX.grow(ip, i - i0, nVis); if (k <= 0) continue; const ym = (yo + yc) / 2; yo = lerp(ym, yo, k); yc = lerp(ym, yc, k); yh = lerp(ym, yh, k); yl = lerp(ym, yl, k); c.globalAlpha = Math.min(1, k * 1.5); }
          one(c, X(i), w, yo, yh, yl, yc, b.c >= b.o, hovering && i === hi_i, i === nLast ? fl : 0, flc);
          c.globalAlpha = 1;
        }
      } else {
        // MTN: blue mountain (gradient fill + glowing blue line); Line: white last-price line. Both draw in from the
        // left on a new range, and the end of the line glides to each live price
        const cl = i => FX.disp(this, this.bars, i).c;
        if (ip < 1) { c.save(); c.beginPath(); c.rect(L, T, this.plotW * ease(ip) + bw, mainH); c.clip(); }
        if (this.o.type === 'area') { const xs = [], ys = []; for (let i = i0; i <= i1; i++) { xs.push(X(i)); ys.push(Y(cl(i))); } FX.mountain(c, xs, ys, T + mainH, MTN, 2); }
        else this.line(cl, Y, X, mainCol, 1.6);
        if (ip < 1) c.restore();
      }
      if (!cmpMode) {
        inds.forEach(x => { if (x.bb) ['up', 'mid', 'lo'].forEach(q => this.line(i => this.ind.bb[q][i], Y, X, x.col, 1, q === 'mid' ? [3, 3] : null)); else this.line(i => x.arr[i], Y, X, x.col, 1.2, x.dash); });
        (this.refLines || []).forEach(r => { if (r.v == null) return; const y = this.hx(Y(r.v)); c.lineWidth = hw; if (y < T || y > T + mainH) return; c.strokeStyle = r.color || '#999'; c.setLineDash(r.dash || [5, 4]); c.beginPath(); c.moveTo(L, y); c.lineTo(L + this.plotW, y); c.stroke(); c.setLineDash([]); c.font = font(FS_XS); c.textBaseline = 'middle'; const tw = Math.ceil(c.measureText(r.label).width), lh = Math.round(this.fz(FS_XS) + 3), bx = this.sp(L + this.plotW - tw - 10), by = this.sp(y - 1 - lh); c.fillStyle = 'rgba(0,0,0,.8)'; c.fillRect(bx, by, tw + 8, lh); c.fillStyle = r.color || '#999'; c.fillText(r.label, bx + 4, by + lh / 2 + 0.5); });   // label box as tall as the rendered font, on whole pixels
        this.overlay && this.overlay(c);
        // event markers (E / D / S …): square box sized to the rendered font, snapped to device pixels with a 1-device-px frame
        (this.markers || []).forEach(mk => { const i = this.bars.findIndex(b => b.t >= mk.t); if (i < i0 || i > i1 || i < 0) return; c.font = font(FS_XS, 700); const bh = Math.round(this.fz(FS_XS) + 3), bwm = Math.max(bh, Math.ceil(c.measureText(mk.label).width) + 6), x0 = this.sp(X(i) - bwm / 2), y0 = this.sp(T + mainH - 4 - bh); c.fillStyle = BOXBG; c.fillRect(x0, y0, bwm, bh); c.strokeStyle = mk.color; c.lineWidth = hw; c.strokeRect(x0 + hw / 2, y0 + hw / 2, bwm - hw, bh - hw); c.lineWidth = 1; c.fillStyle = mk.color; c.textBaseline = 'middle'; c.fillText(mk.label, x0 + (bwm - c.measureText(mk.label).width) / 2, y0 + bh / 2 + 0.5); });
        // high / low dots on the series (line charts; candles get price labels below)
        if (big && lineType && ip >= 1) [[hiI, UP], [loI, DN]].forEach(([i, col]) => { const x = X(i), y = Y(this.bars[i].c); c.fillStyle = col; c.beginPath(); c.arc(x, y, 3, 0, 7); c.fill(); });
        if (lineType && hovering && ip >= 1) FX.dot(c, X(hi_i), Y(FX.disp(this, this.bars, hi_i).c), '#ffffff');
      }
      c.restore();
      // ---- line end: live-move ring + dot on the newest price (drawn unclipped so the ring is never cut in half)
      if (!cmpMode && lineType && ip >= 1 && i1 === nLast) { const x = X(i1), y = Y(lastV); if (y >= T && y <= T + mainH) { FX.ripple(c, x, y, fl, flc); FX.dot(c, x, y, mainCol); } }
      // ---- candles: highest high / lowest low of the visible range, labelled next to the wick tip
      if (big && !cmpMode && !lineType && ip >= 1) {
        let hI = i0, lI = i0;
        for (let i = i0; i <= i1; i++) { if (this.bars[i].h > this.bars[hI].h) hI = i; if (this.bars[i].l < this.bars[lI].l) lI = i; }
        c.font = font(FS_XS); c.textBaseline = 'middle'; c.lineWidth = 1;
        [[hI, this.bars[hI].h], [lI, this.bars[lI].l]].forEach(([i, v]) => {
          const x = X(i), y = Math.round(clamp(Y(v), T + 8, T + mainH - 8)) + 0.5, s = fmtPx(v), tw = c.measureText(s).width, right = x + 20 + tw < L + this.plotW - 2;
          const x1 = right ? x + 4 : x - 4, x2 = right ? x + 14 : x - 14;
          c.strokeStyle = '#8a8a8a'; c.beginPath(); c.moveTo(x1, y); c.lineTo(x2, y); c.stroke();
          c.fillStyle = '#e6e6e6'; c.fillText(s, Math.round(right ? x2 + 3 : x2 - 3 - tw), y);
        });
      }
      // ---- last price tag (notched, series colour) + faint last-price guide; it flashes green / red on a live move
      const last = this.bars[i1], lvY = Y(lastV);
      let tagBg = cmpMode ? PAL[0] : lineType ? mainCol : last.c >= (this.bars[i1 - 1] || last).c ? UP : DN;
      if (!cmpMode && i1 === nLast && fl > 0) tagBg = mix(tagBg, shade(flc, 0.3), fl);
      if (lvY >= T && lvY <= T + mainH) { const gy = this.hx(lvY); c.lineWidth = hw; c.strokeStyle = rgba(tagBg, 0.5) || tagBg; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(L, gy); c.lineTo(L + this.plotW, gy); c.stroke(); c.setLineDash([]); c.lineWidth = 1; }
      if (!cmpMode) this.tag(W - RA, clamp(lvY, T + 10, T + mainH - 10), fmtPx(lastV), tagBg);
      else {
        // compare mode: one tag per series at its latest % change, stacked so tags never cover each other
        const th = Math.max(20, Math.round(fzA + 6)) + 1;
        const tg = [{ y: lvY, s: fmtPct(lastV), col: PAL[0] }].concat(this.cmp.map((s, j) => { if (!s.ref) return null; let lv = null; for (let i = i1; i >= i0; i--) if (s.vals[i] != null) { lv = s.vals[i]; break; } if (lv == null) return null; const v = (lv / s.ref - 1) * 100; return { y: Y(v), s: fmtPct(v), col: PAL[(j + 1) % PAL.length] }; }))
          .filter(Boolean).map(t => Object.assign(t, { y: clamp(t.y, T + th / 2, T + mainH - th / 2) })).sort((a, z) => a.y - z.y);
        for (let q = 1; q < tg.length; q++) if (tg[q].y < tg[q - 1].y + th) tg[q].y = tg[q - 1].y + th;
        const over = tg.length ? tg[tg.length - 1].y - (T + mainH - th / 2) : 0;
        if (over > 0) { tg[tg.length - 1].y -= over; for (let q = tg.length - 2; q >= 0; q--) if (tg[q].y > tg[q + 1].y - th) tg[q].y = tg[q + 1].y - th; }
        tg.forEach(t => this.tag(W - RA, t.y, t.s, t.col));
      }
      // ---- bad prints the server filtered out of this range (badprints.py), said faintly in the plot corner
      let nfx = 0; for (let i = i0; i <= i1; i++) if (this.bars[i].fixed) nfx++;
      if (nfx && big && !cmpMode) { c.font = font(FS_XS); c.textBaseline = 'bottom'; c.fillStyle = DIM; c.fillText(nfx + ' bad print' + (nfx > 1 ? 's' : '') + ' filtered · hover a bar for what was reported', L + 8, T + mainH - 4); }
      // ---- AUTO: prices were scaled by hand on the axis; click to return to automatic scaling
      if (this.yman && !cmpMode) {
        const bx = this.sp(W - RA + 4), by = this.sp(H - BA + 4), bwA = RA - 8, bhA = Math.min(BA - 8, Math.round(this.fz(FS_XS) + 8));
        c.fillStyle = BOXBG; c.fillRect(bx, by, bwA, bhA); c.strokeStyle = AMBER; c.lineWidth = hw; c.strokeRect(bx + hw / 2, by + hw / 2, bwA - hw, bhA - hw); c.lineWidth = 1;
        c.font = font(FS_XS, 700); c.textBaseline = 'middle'; c.fillStyle = AMBER; const at = 'AUTO'; c.fillText(at, bx + (bwA - c.measureText(at).width) / 2, by + bhA / 2 + 0.5);
      }
      // ---- lower panes
      let top = T + mainH; this._ipE = ip >= 1 ? 1 : ease(ip);
      lower.forEach(p => { this.pane(p, top, lowH, X, i0, i1, L, W, RA, hi_i); top += lowH; });
      // ---- crosshair
      if (hovering) {
        const cx = this.hx(X(hi_i)), cy = this.hx(m.y);
        c.strokeStyle = CROSS; c.lineWidth = hw; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(cx, T); c.lineTo(cx, H - BA); c.moveTo(L, cy); c.lineTo(L + this.plotW, cy); c.stroke(); c.setLineDash([]); c.lineWidth = 1;
        if (m.y < T + mainH) { const pv = Yinv(m.y); this.tag(W - RA, m.y, cmpMode ? pv.toFixed(2) + '%' : fmtPx(pv), AMBER, '#000'); }
        this.label(clamp(X(hi_i), L + 50, L + this.plotW - 50), H - BA / 2, fmtDate(this.bars[hi_i].t, this.intraday, true), AMBER, '#000', 'center');
      }
      // ---- legend boxes
      if (big && lay.items.length) this.drawBoxes(lay, L + 2, RB + 4, boxH);
      // ---- readout bar: always on big charts (last bar, or the bar under the crosshair); on hover only for small charts
      if (!big && !hovering) return;
      const b = this.bars[hi_i], pb = this.bars[hi_i - 1], parts = [['', fmtDate(b.t, this.intraday, true), TXT]];
      if (cmpMode) {
        parts.push([(this.name || 'Main'), fmtPct(val(b.c)), PAL[0]]);
        this.cmp.forEach((s, j) => s.vals[hi_i] != null && s.ref && parts.push([s.name, fmtPct((s.vals[hi_i] / s.ref - 1) * 100), PAL[(j + 1) % PAL.length]]));
      } else {
        parts.push(['O', fmtPx(b.o)], ['H', fmtPx(b.h)], ['L', fmtPx(b.l)], ['C', fmtPx(b.c)]);
        if (pb) { const ch = b.c - pb.c, chs = Math.abs(pb.c) >= 1 ? Math.abs(ch).toFixed(2) : fmtPx(Math.abs(ch)); parts.push(['Chg', (ch >= 0 ? '+' : '-') + chs + ' (' + fmtPct(ch / pb.c * 100) + ')', ch >= 0 ? UP : DN]); }   // change in the price's own decimals
        if (b.v) parts.push(['Vol', fmtVol(b.v), AXIS]);
        if (b.fixed && b.raw) parts.push(['Filtered bad print · reported', 'O ' + fmtPx(b.raw[0]) + ' H ' + fmtPx(b.raw[1]) + ' L ' + fmtPx(b.raw[2]) + ' C ' + fmtPx(b.raw[3]), AMBER]);
        if (hovering) inds.forEach(x => x.arr[hi_i] != null && parts.push([x.nm, fmtPx(x.arr[hi_i]), valCol(x.col)]));
      }
      this.readout(parts, 0, big ? RB : Math.max(21, Math.round(fzS + 7)), W);
    }
    /* time-axis marks at calendar boundaries (Bloomberg style): months / quarters / years for daily+ bars,
       evenly spaced times (with the day under each new day) for intraday bars */
    timeMarks(i0, i1, X, bw, k = 1) {
      const B0 = this.bars, out = [], minPx = Math.max(72, this.fz(FS) * 4.2) * k;     // label spacing grows with the TEXT boost
      // slots past the newest bar (a day chart's rest of the session) get the times they will have
      const last = B0.length ? B0[B0.length - 1].t : 0, step = this.dayStep || 60;
      const B = i1 >= B0.length ? B0.concat(Array.from({ length: i1 - B0.length + 1 }, (_, q) => ({ t: last + (q + 1) * step }))) : B0;
      if (!this.intraday) {
        const ms = [];
        for (let i = Math.max(i0, 1); i <= i1; i++) { const d = new Date(B[i].t * 1000), p = new Date(B[i - 1].t * 1000); if (d.getMonth() !== p.getMonth() || d.getFullYear() !== p.getFullYear()) ms.push({ i, m: d.getMonth(), y: d.getFullYear() }); }
        if (ms.length >= 2) {
          const px = (X(ms[ms.length - 1].i) - X(ms[0].i)) / (ms.length - 1);
          const st = [1, 2, 3, 6, 12].find(s => px * s >= minPx) || 12 * Math.ceil(minPx / (px * 12));
          let lastY = null;
          ms.forEach(mk => {
            if (st < 12) { if (mk.m % st) return; out.push({ i: mk.i, top: MON[mk.m], sub: mk.y !== lastY ? '' + mk.y : '' }); lastY = mk.y; }
            else if (mk.m === 0 && mk.y % (st / 12) === 0) out.push({ i: mk.i, top: '' + mk.y, sub: '' });
          });
          if (out.length >= 2) return out;
          out.length = 0;
        }
      }
      if (this.intraday && i1 - i0 >= 2) {
        // round clock times (every 5 / 15 / 30 min, 1 h …); the day goes under the first mark of each day
        const st = []; for (let i = Math.max(i0 + 1, i1 - 30); i <= i1; i++) st.push(B[i].t - B[i - 1].t); st.sort((a, z) => a - z);
        const stepMin = Math.max(1, (st[st.length >> 1] || 60) / 60), pxMin = bw / stepMin;
        const iv = [1, 2, 5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440].find(m => m * pxMin >= minPx) || 1440;
        const key = t => { const d = new Date(t * 1000); return d.toDateString() + '|' + Math.floor((d.getHours() * 60 + d.getMinutes()) / iv); };
        let lastD = null;
        for (let i = Math.max(i0, 1); i <= i1; i++) {
          if (key(B[i].t) === key(B[i - 1].t)) continue;
          const d = new Date(B[i].t * 1000), day = (d.getMonth() + 1) + '/' + d.getDate(), xPrev = out.length ? X(out[out.length - 1].i) : -1e9;
          if (X(i) - xPrev < minPx * 0.8) continue;
          out.push({ i, top: iv >= 1440 ? day : String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'), sub: iv < 1440 && day !== lastD ? day : '' }); lastD = day;
        }
        if (out.length >= 2) return out;
        out.length = 0;
      }
      const every = Math.max(1, Math.ceil(minPx / bw)); let lastD = null;
      for (let i = i0; i <= i1; i += every) {
        const d = new Date(B[i].t * 1000), day = (d.getMonth() + 1) + '/' + d.getDate();
        if (this.intraday) { out.push({ i, top: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'), sub: day !== lastD ? day : '' }); lastD = day; }
        else { const yr = '' + d.getFullYear(); out.push({ i, top: day, sub: yr !== lastD ? yr : '' }); lastD = yr; }
      }
      return out;
    }
    line(fn, Y, X, col, w, dash) {
      const c = this.ctx; c.strokeStyle = col; c.lineWidth = w; c.lineJoin = 'round'; c.setLineDash(dash || []); c.beginPath(); let pen = false;
      for (let i = this.i0; i <= this.i1; i++) { const v = fn(i); if (v == null || isNaN(v)) { pen = false; continue; } const x = X(i), y = Y(v); pen ? c.lineTo(x, y) : c.moveTo(x, y); pen = true; }
      c.stroke(); c.setLineDash([]); c.lineWidth = 1;
    }
    pane(p, top, h, X, i0, i1, L, W, RA, hi_i) {
      const c = this.ctx, hw = this.hw || 1; if (hi_i == null) hi_i = i1;
      c.fillStyle = LINE; c.fillRect(0, this.sp(top), W, hw);
      c.lineWidth = hw; c.setLineDash([]); c.strokeStyle = AXL; c.beginPath(); c.moveTo(this.hx(W - RA), top); c.lineTo(this.hx(W - RA), top + h); c.stroke();
      const bw = this.plotW / (i1 - i0 + 1 + this.fpad()), bh = this.boxH() - 3, tiny = h < bh * 2 + 12, head = tiny ? 3 : bh + 6;   // pane title box height follows the font; tiny panes (16-panel) drop it
      const box = rows => { if (tiny) return; const lay = this.layoutBoxes(rows, this.plotW - 8, 1); lay.items.forEach(it => it.w = Math.min(it.w, this.plotW - 8)); this.drawBoxes(lay, L + 2, top + 3, bh); };
      const grow = this._ipE == null ? 1 : this._ipE;
      // crisp bar: whole device pixels, at least one pixel wide
      const col = (x, y0, y1, w, fill) => { const a = this.sp(x - w / 2), b = this.sp(x + w / 2), t0 = this.sp(Math.min(y0, y1)), t1 = this.sp(Math.max(y0, y1)); c.fillStyle = fill; c.fillRect(a, t0, Math.max(hw, b - a), Math.max(hw, t1 - t0)); };
      c.font = font(FS); c.textBaseline = 'middle';
      if (p === 'vol') {
        let mx = 0; for (let i = i0; i <= i1; i++) mx = Math.max(mx, this.bars[i].v || 0);
        if (!mx) { box([['Volume', DIM, '--']]); return; } const w = Math.max(1, bw * 0.7);
        // volume bars: up / down colours with a brighter cap, the bar under the crosshair in white
        for (let i = i0; i <= i1; i++) {
          const b = this.bars[i], hh = (b.v || 0) / mx * (h - head - 2) * grow; if (hh <= 0) continue;
          const up = b.c >= b.o, x = X(i), y0 = top + h - hh;
          col(x, top + h, y0, w, i === hi_i && this.mouse ? 'rgba(255,255,255,.75)' : up ? 'rgba(48,210,84,.5)' : 'rgba(252,30,60,.5)');
          if (w >= 3 && hh >= 3) col(x, y0, y0 + hw * 2, w, up ? 'rgba(120,240,150,.9)' : 'rgba(255,110,130,.9)');
        }
        c.fillStyle = AXIS; c.font = font(FS); c.textBaseline = 'middle'; const vs = fmtVol(mx); if (!tiny && c.measureText(vs).width <= RA - 12) c.fillText(vs, W - RA + 9, top + head / 2 + 2);
        const bv = this.bars[hi_i]; box([[(this.name ? this.name + ' - ' : '') + 'Volume', '#4ea8fc', fmtVol(bv && bv.v)]]);
      } else if (p === 'rsi') {
        const Yr = v => top + head + (100 - v) / 100 * (h - head - 4);
        // 30-70 band shaded, overbought / oversold guides in red / green
        c.fillStyle = 'rgba(255,255,255,.035)'; c.fillRect(L, this.sp(Yr(70)), this.plotW, this.sp(Yr(30)) - this.sp(Yr(70)));
        c.setLineDash([3, 3]); [[70, 'rgba(252,30,60,.55)'], [30, 'rgba(48,210,84,.55)'], [50, '#333']].forEach(([v, s]) => { const y = this.hx(Yr(v)); c.strokeStyle = s; c.beginPath(); c.moveTo(L, y); c.lineTo(L + this.plotW, y); c.stroke(); if (v !== 50 && Yr(30) - Yr(70) > this.fz(FS) + 2) { c.fillStyle = AXIS; c.textBaseline = 'middle'; c.fillText(v, W - RA + 9, Yr(v)); } }); c.setLineDash([]);
        this.line(i => this.ind.rsi[i], Yr, X, '#c9a0ff', 1.4);
        const r = this.ind.rsi[hi_i]; box([['RSI (14)', '#c9a0ff', r == null ? '--' : r.toFixed(2)]]);
      } else if (p === 'macd') {
        const d = this.ind.macd; let mx = 0; for (let i = i0; i <= i1; i++) [d.m[i], d.sg[i], d.h[i]].forEach(v => v != null && (mx = Math.max(mx, Math.abs(v))));
        if (!mx) { box([['MACD (12,26,9)', TXT, '--']]); return; } const mid = top + head / 2 + h / 2, Ym = v => mid - v / mx * (h / 2 - head / 2 - 4); const w = Math.max(1, bw * 0.6);
        c.strokeStyle = '#444'; c.beginPath(); c.moveTo(L, this.hx(Ym(0))); c.lineTo(L + this.plotW, this.hx(Ym(0))); c.stroke();
        // histogram: brighter while momentum grows, dimmer while it fades (the usual 4-colour MACD histogram)
        for (let i = i0; i <= i1; i++) if (d.h[i] != null) { const pv = d.h[i - 1], grows = pv == null || Math.abs(d.h[i]) >= Math.abs(pv); col(X(i), Ym(0), Ym(d.h[i]), w, d.h[i] >= 0 ? (grows ? 'rgba(48,210,84,.75)' : 'rgba(48,210,84,.38)') : (grows ? 'rgba(252,30,60,.75)' : 'rgba(252,30,60,.38)')); }
        this.line(i => d.m[i], Ym, X, '#4ea8fc', 1.4); this.line(i => d.sg[i], Ym, X, AMBER, 1.3);
        c.fillStyle = AXIS; c.textBaseline = 'middle'; c.fillText('0', W - RA + 9, Ym(0));
        box([['MACD', '#4ea8fc', d.m[hi_i] == null ? '--' : d.m[hi_i].toFixed(3)], ['Signal', AMBER, d.sg[hi_i] == null ? '--' : d.sg[hi_i].toFixed(3)], ['Hist', d.h[hi_i] >= 0 ? UP : DN, d.h[hi_i] == null ? '--' : d.h[hi_i].toFixed(3)]]);
      }
      c.lineWidth = 1;
    }
  }

  // ===================================================== SeriesChart
  class SeriesChart extends Base {
    constructor(host, opts = {}) {
      super(host); this.o = Object.assign({ xtype: 'time', categories: null, yfmt: v => v.toFixed(2), zero: false, bars: false }, opts); this.series = [];
      // small charts: the legend collapses to one row plus a "+N ▾" chip; clicking the chip opens / closes the full legend
      this.cv.addEventListener('click', e => { const r = this._chipR; if (!r || !this.mouse) return; const m = this.mouse; if (m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h) { this._legOpen = !this._legOpen; e.stopPropagation(); this.draw(); } });
    }
    setData(series) { this.loaded(); this.series = (series || []).map((s, k) => Object.assign({ color: PAL[k % PAL.length] }, s, { pts: (s.pts || []).filter(p => p && p[0] != null && p[1] != null && isFinite(p[1])) })); this.draw(); }
    draw() {
      const c = this.ctx, W = this.W, H = this.H; if (!c || !this.series || !this.o) return;
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
      let pn = 0, x0 = Infinity, x1 = -Infinity, lo = Infinity, hi = -Infinity;
      this.series.forEach(s => s.pts.forEach(p => { pn++; if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }));
      if (!pn) { this.setTop(30); return this.empty(); }
      const yf = v => { try { const s = this.o.yfmt(v); return s == null || s === 'NaN' || s === 'undefined' ? '--' : String(s); } catch (e) { return '--'; } };
      const fzA = this.fz(FS), boxH = this.boxH(), compact = H < 240 || W < 430, hw = this.hw || 1;
      const named = this.series.filter(s => s.name), BA = compact || this.o.xtype === 'cat' ? Math.round(fzA + 11) : Math.round(2 * fzA + 12), L = 8;
      // legend boxes above the plot (never on it), up to 2 rows; box widths come from the widest value of each series so the
      // layout does not jump while the crosshair readout changes the values
      const widest = s => { let mn = Infinity, mx = -Infinity; s.pts.forEach(p => { if (p[1] < mn) mn = p[1]; if (p[1] > mx) mx = p[1]; }); const c2 = this.ctx; c2.font = font(FS_S); return [yf(mn), yf(mx), s.pts.length ? yf(s.pts[s.pts.length - 1][1]) : '--'].sort((a, z) => c2.measureText(z).width - c2.measureText(a).width)[0]; };
      const small = H < 380 || W < 600;           // quadrant / 16-panel cells: one legend row + chip, fewer axis tags
      const legRows = named.map(s => [s.name, s.color, widest(s)]);
      const lay = named.length ? this.layoutBoxes(legRows, W - L - 6 - 86 - (small ? 70 : 0), small ? 1 : H > 360 ? 2 : 1) : { items: [], lines: 0 };
      const hiddenLeg = named.length - lay.items.length;
      const T = named.length ? 5 + lay.lines * (boxH + 3) + 2 : 10, PH = H - T - BA;
      this.setTop(T);
      if (this.o.xtype === 'cat') { x0 = -0.5; x1 = (this.o.categories || []).length - 0.5; }
      if (this.o.zero || this.o.bars) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
      const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1; lo -= pad; hi += pad;
      const { ticks } = niceTicks(lo, hi, Math.max(compact ? 2 : 3, Math.floor(PH / Math.max(45, fzA * 2.6))));
      c.font = font(FS); let maxLab = 0;
      ticks.forEach(v => maxLab = Math.max(maxLab, c.measureText(yf(v)).width));
      if (!this.o.bars) this.series.forEach(s => { const p = s.pts[s.pts.length - 1]; if (p) maxLab = Math.max(maxLab, c.measureText(yf(p[1])).width); });
      const RA = Math.round(clamp(maxLab + 24, 60, 170)), PW = W - RA - L;
      const X = x => L + (x - x0) / ((x1 - x0) || 1) * PW, Y = v => T + (hi - v) / (hi - lo) * PH;
      this.map = { kind: 'series', L, T, PW, PH, X, Y, Xinv: px => x0 + (px - L) / PW * ((x1 - x0) || 1), Yinv: py => hi - (py - T) / PH * (hi - lo), W, H, RA, BA };
      const PB = AtlasChart.PLOTBG, GRID = PB ? PGRID : GRID0;
      if (PB) { c.fillStyle = PB; c.fillRect(L, T, PW, PH); }
      c.textBaseline = 'middle'; c.lineWidth = hw;
      const tagGap = Math.max(15, (fzA + 6) * 0.8);
      const tagYs = this.o.bars ? [] : this.series.map(s => s.pts.length ? clamp(Y(s.pts[s.pts.length - 1][1]), T + 10, T + PH - 10) : -99);
      ticks.forEach(v => { const y = this.hx(Y(v)); if (y < T - 1 || y > T + PH + 1) return; c.strokeStyle = v === 0 ? '#5a5a5a' : GRID; c.setLineDash(v === 0 ? [] : GD); c.beginPath(); c.moveTo(L, y); c.lineTo(L + PW, y); c.stroke(); if (tagYs.some(ty => Math.abs(y - ty) < tagGap)) return; c.fillStyle = AXIS; c.fillText(yf(v), W - RA + 9, y); });
      c.font = font(FS); c.textBaseline = 'top';
      if (this.o.xtype === 'cat') {
        // category axis: vertical grid only between groups of bars (bars) or at each point (lines); labels thinned to fit
        const cats = this.o.categories || [], maxW = Math.max(1, ...cats.map(t => c.measureText(String(t)).width)) + 12, step = Math.max(1, Math.ceil(cats.length * maxW / PW));
        cats.forEach((cat, i) => { if (i % step) return; const x = this.hx(X(i)); if (!this.o.bars) { c.strokeStyle = GRID; c.setLineDash(GD); c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + PH); c.stroke(); } c.fillStyle = AXIS; const s = String(cat), tw = c.measureText(s).width; c.fillText(s, Math.round(Math.min(Math.max(L, X(i) - tw / 2), L + PW - tw)), H - BA + 5); });
      } else if ((() => {
        // calendar marks: days / months / quarters / years, spaced at least ~72px apart
        const dayMs = 86400000, pxDay = PW / Math.max(1e-9, (x1 - x0) / dayMs), mPx = pxDay * 30.44, marks = [], minPx = Math.max(72, fzA * 4.2) * (compact ? 1.35 : 1);
        if (!(x1 - x0 > 2 * dayMs) || x0 < 0) return false;
        let lastS = null, guard = 0;
        if (mPx >= 180) {
          const ds = [1, 2, 5, 7, 14].find(s => pxDay * s >= minPx) || 14; const s0 = new Date(x0); let d = new Date(s0.getFullYear(), s0.getMonth(), s0.getDate() + 1);
          while (d.getTime() <= x1 && guard++ < 400) { const sub = MON[d.getMonth()] + ' ' + d.getFullYear(); marks.push({ x: d.getTime(), top: '' + d.getDate(), sub: sub !== lastS ? sub : '' }); lastS = sub; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + ds); }
        } else {
          const st = [1, 2, 3, 6, 12, 24, 60, 120].find(s => mPx * s >= minPx) || 240; const s0 = new Date(x0); let d = new Date(s0.getFullYear(), s0.getMonth() + 1, 1);
          while (d.getTime() <= x1 && guard++ < 3000) {
            const m = d.getMonth(), y = d.getFullYear();
            if (st < 12 ? m % st === 0 : m === 0 && y % (st / 12) === 0) { marks.push({ x: d.getTime(), top: st < 12 ? MON[m] : '' + y, sub: st < 12 && '' + y !== lastS ? '' + y : '' }); if (st < 12) lastS = '' + y; }
            d = new Date(y, m + 1, 1);
          }
        }
        if (marks.length < 2) return false;
        marks.forEach(mk => {
          const x = this.hx(X(mk.x)); c.strokeStyle = GRID; c.setLineDash(GD); c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + PH); c.stroke(); c.setLineDash([]); c.strokeStyle = AXL; c.beginPath(); c.moveTo(x, T + PH); c.lineTo(x, T + PH + 4); c.stroke();
          const top = compact && mk.sub ? (/^\d+$/.test(mk.top) ? mk.sub.slice(0, 3) + ' ' + mk.top : mk.top + ' ' + mk.sub) : mk.top;
          const tw = c.measureText(top).width; c.fillStyle = AXIS; c.fillText(top, Math.round(clamp(x - tw / 2, L, L + PW - tw)), H - BA + 5);
          if (mk.sub && !compact) { const sw = c.measureText(mk.sub).width; c.fillStyle = DIM; c.fillText(mk.sub, Math.round(clamp(x - sw / 2, L, L + PW - sw)), H - BA + 7 + fzA); }
        });
        return true;
      })()) {
        /* calendar marks drawn */
      } else {
        const span = (x1 - x0) / 1000 / 86400; const nT = Math.max(2, Math.floor(PW / 100)); let lastY = null;
        for (let k = 0; k <= nT; k++) {
          const xv = x0 + (x1 - x0) * k / nT, d = new Date(xv), xx = Math.min(Math.max(L, X(xv)), L + PW - 24);
          if (k > 0 && k < nT) { c.strokeStyle = GRID; c.setLineDash(GD); c.beginPath(); c.moveTo(this.hx(X(xv)), T); c.lineTo(this.hx(X(xv)), T + PH); c.stroke(); }
          const top = span > 1500 ? '' + d.getFullYear() : span > 60 ? MON[d.getMonth()] : (d.getMonth() + 1) + '/' + d.getDate(), yr = '' + d.getFullYear();
          c.fillStyle = AXIS; c.fillText(top, Math.round(xx - c.measureText(top).width / 2), H - BA + 5);
          if (!compact && span <= 1500 && yr !== lastY) { c.fillStyle = DIM; c.fillText(yr, Math.round(xx - c.measureText(yr).width / 2), H - BA + 7 + fzA); lastY = yr; }
        }
      }
      c.setLineDash([]); c.strokeStyle = AXL; c.beginPath(); c.moveTo(this.hx(W - RA), T); c.lineTo(this.hx(W - RA), H - BA); c.moveTo(L, this.hx(H - BA)); c.lineTo(W - RA, this.hx(H - BA)); c.stroke(); c.lineWidth = 1;
      // single time series: Bloomberg mountain fill under the line (opt out with {fill:false}; per series {fill:true})
      const autoFill = this.o.fill !== false && !this.o.bars && this.o.xtype !== 'cat' && this.series.length === 1;
      c.save(); c.beginPath(); c.rect(L, T - 1, PW, PH + 2); c.clip();
      this.series.forEach((s, k) => {
        if (this.o.bars) {
          // bars: crisp device-pixel edges, a vertical gradient with a bright cap (Bloomberg GF look); s.pcolors colours
          // single points (e.g. estimates dimmer); values printed above the bars when they fit
          const nS = this.series.length, slot = PW / Math.max(1, (this.o.categories || []).length), bw = slot * 0.78 / nS, gap = Math.min(2, bw * 0.12), y0 = Y(0);
          c.font = font(FS_XS); c.textBaseline = 'bottom';
          s.pts.forEach((p, q) => {
            const col = (s.pcolors && s.pcolors[q]) || s.color, y = Y(p[1]), xa = this.sp(X(p[0]) - bw * nS / 2 + k * bw + gap / 2), xb = this.sp(X(p[0]) - bw * nS / 2 + (k + 1) * bw - gap / 2);
            const ya = this.sp(Math.min(y, y0)), yb = this.sp(Math.max(y, y0)), w = Math.max(hw, xb - xa), h = Math.max(hw, yb - ya);
            const g = c.createLinearGradient(0, ya, 0, yb), pos = p[1] >= 0; g.addColorStop(0, shade(col, pos ? 0.12 : -0.25)); g.addColorStop(1, shade(col, pos ? -0.25 : 0.12));
            c.fillStyle = g; c.fillRect(xa, ya, w, h);
            if (h > 3 * hw) { c.fillStyle = shade(col, 0.4); c.fillRect(xa, pos ? ya : yb - 2 * hw, w, 2 * hw); }
            if (this.o.barLabels !== false && nS === 1 && h > 0) { const sv = yf(p[1]), tw = c.measureText(sv).width; if (tw + 4 <= slot && ya - fzA > T) { c.fillStyle = valCol(col) === TXT ? AXIS : shade(col, 0.25); c.fillText(sv, X(p[0]) - tw / 2, (pos ? ya : yb + fzA + 2) - 2); } }
          });
          return;
        }
        if ((autoFill || s.fill === true) && s.pts.length > 1 && s.fill !== false) {
          const top = rgba(s.color, 0.32), bot = rgba(s.color, 0.02);
          if (top) { const g = c.createLinearGradient(0, T, 0, T + PH); g.addColorStop(0, top); g.addColorStop(1, bot); c.beginPath(); c.moveTo(X(s.pts[0][0]), T + PH); s.pts.forEach(p => c.lineTo(X(p[0]), Y(p[1]))); c.lineTo(X(s.pts[s.pts.length - 1][0]), T + PH); c.closePath(); c.fillStyle = g; c.fill(); }
        }
        c.strokeStyle = s.color; c.lineWidth = s.width || 1.5; c.lineJoin = 'round'; c.setLineDash(s.dash || []); c.beginPath();
        s.pts.forEach((p, i) => i ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))); c.stroke(); c.setLineDash([]); c.lineWidth = 1;
        if (this.o.xtype === 'cat' && this.o.dots !== false) s.pts.forEach(p => { c.fillStyle = s.color; c.beginPath(); c.arc(X(p[0]), Y(p[1]), 2.8, 0, 7); c.fill(); });
      });
      c.restore();
      if (this.overlay) { c.save(); c.beginPath(); c.rect(L, T, PW, PH); c.clip(); this.overlay(c); c.restore(); }
      // last-value tags on the right axis (notched, series colour)
      if (!this.o.bars) {
        // stacked so tags never cover each other (sorted by value, pushed apart by one tag height)
        const th = Math.max(20, Math.round(fzA + 6)) + 1;
        // a stack of tags must not cover the axis: small charts keep tags for the first series that fit in ~60% of the plot
        const maxT = small ? Math.max(1, Math.floor(PH * 0.6 / th)) : this.series.length;
        const tg = this.series.slice(0, maxT).map(s => { const p = s.pts[s.pts.length - 1]; return p ? { y: clamp(Y(p[1]), T + th / 2, T + PH - th / 2), s: yf(p[1]), col: s.color } : null; }).filter(Boolean).sort((a, z) => a.y - z.y);
        for (let k = 1; k < tg.length; k++) if (tg[k].y < tg[k - 1].y + th) tg[k].y = tg[k - 1].y + th;
        const over = tg.length ? tg[tg.length - 1].y - (T + PH - th / 2) : 0;
        if (over > 0) { tg[tg.length - 1].y -= over; for (let k = tg.length - 2; k >= 0; k--) if (tg[k].y > tg[k + 1].y - th) tg[k].y = tg[k + 1].y - th; }
        tg.forEach(t => this.tag(W - RA, t.y, t.s, t.col));
      }
      // crosshair
      const m = this.mouse; let xv = null;
      if (m && m.x > L && m.x < L + PW && m.y > T - 2 && m.y < H) {
        xv = x0 + (m.x - L) / PW * (x1 - x0); if (this.o.xtype === 'cat') xv = clamp(Math.round(xv), 0, (this.o.categories || []).length - 1);
        c.strokeStyle = CROSS; c.lineWidth = hw; c.setLineDash([4, 3]); c.beginPath(); c.moveTo(this.hx(X(xv)), T); c.lineTo(this.hx(X(xv)), T + PH);
        if (m.y >= T && m.y <= T + PH) { c.moveTo(L, this.hx(m.y)); c.lineTo(L + PW, this.hx(m.y)); }
        c.stroke(); c.setLineDash([]); c.lineWidth = 1;
        // the hovered points get a ringed dot on each line
        if (!this.o.bars) this.series.forEach(s => { let best = null, bd = Infinity; for (const q of s.pts) { const dd = Math.abs(q[0] - xv); if (dd < bd) { bd = dd; best = q; } } if (best && Y(best[1]) >= T && Y(best[1]) <= T + PH) FX.dot(c, X(best[0]), Y(best[1]), s.color); });
        if (m.y >= T && m.y <= T + PH) this.tag(W - RA, m.y, yf((hi - (m.y - T) / PH * (hi - lo))), AMBER, '#000');
        const d = new Date(xv); const lab = this.o.xtype === 'cat' ? String((this.o.categories || [])[xv] == null ? '' : this.o.categories[xv]) : String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0') + '/' + String(d.getFullYear()).slice(2);
        if (lab) this.label(clamp(X(xv), L + 45, L + PW - 45), H - BA / 2, lab, AMBER, '#000', 'center');
      }
      // legend boxes (values follow the crosshair = readout)
      const rows = named.map(s => {
        let p = s.pts[s.pts.length - 1];
        if (xv != null) { let best = null, bd = Infinity; for (const q of s.pts) { const dd = Math.abs(q[0] - xv); if (dd < bd) { bd = dd; best = q; } } p = best; }
        return [s.name, s.color, p ? yf(p[1]) : '--'];
      });
      if (rows.length) { lay.items.forEach((it, k) => { if (rows[k]) it.r = rows[k]; }); this.drawBoxes(lay, L, 5, boxH); }
      // legend chip: "+N ▾" for series that do not fit; open = the full legend over the top of the plot
      this._chipR = null;
      if (hiddenLeg > 0 || (this._legOpen && small && rows.length > 1)) {
        c.font = font(FS_S); const s = this._legOpen ? '▴ less' : '+' + hiddenLeg + ' ▾', w = Math.round(c.measureText(s).width + 14), last = lay.items[lay.items.length - 1];
        const x = this.sp(L + (last ? last.x + last.w + 4 : 0)), y = 5;
        c.fillStyle = AMBER; c.fillRect(x, y, w, boxH); c.fillStyle = '#000'; c.textBaseline = 'middle'; c.fillText(s, x + 7, y + boxH / 2 + 0.5);
        this._chipR = { x, y, w, h: boxH };
        if (this._legOpen) {
          const full = this.layoutBoxes(rows, PW - 8, 6), hgt = full.lines * (boxH + 3) + 6;
          c.fillStyle = 'rgba(0,0,0,.88)'; c.fillRect(L, T + 2, PW, hgt); this.drawBoxes(full, L + 4, T + 5, boxH);
        }
      }
    }
  }

  /* canvas labels without collisions: items = [{x, y, text, color, font, pri}] anchored at (x, y); each label tries eight
     spots around its anchor (never over another anchor or label, never outside box {L, T, R, B}); labels that find no
     free spot are dropped, lowest priority first */
  function placeLabels(c, items, box) {
    const placed = items.map(it => ({ x: it.x - 4, y: it.y - 4, w: 8, h: 8 }));
    const hit = r => placed.some(p => r.x < p.x + p.w && r.x + r.w > p.x && r.y < p.y + p.h && r.y + r.h > p.y);
    items.slice().sort((a, z) => (z.pri || 0) - (a.pri || 0)).forEach(it => {
      c.font = it.font || font(FS_XS); const m = /(\d+(?:\.\d+)?)px/.exec(c.font), h = (m ? +m[1] : 12) + 2, w = c.measureText(it.text).width + 2;
      const cand = [[6, -h - 2], [6, 2], [-w - 6, -h - 2], [-w - 6, 2], [-w / 2, -h - 7], [-w / 2, 7], [9, -h / 2], [-w - 9, -h / 2]];
      for (const [dx, dy] of cand) {
        const r = { x: it.x + dx, y: it.y + dy, w, h };
        if (r.x < box.L || r.x + w > box.R || r.y < box.T || r.y + h > box.B || hit(r)) continue;
        placed.push(r); c.fillStyle = it.color || TXT; c.textBaseline = 'top'; c.fillText(it.text, r.x + 1, r.y + 1); return;
      }
    });
  }
  /* DOM labels (map tags): hide the lower-priority ones (data-p) that overlap a label already kept */
  function declutter(root, sel) {
    if (!root) return; const els = [...root.querySelectorAll(sel)]; els.forEach(e => e.style.visibility = '');
    const items = els.map(e => ({ e, r: e.getBoundingClientRect(), p: +(e.dataset.p || 0) })).filter(x => x.r.width).sort((a, z) => z.p - a.p), kept = [];
    items.forEach(it => { const r = it.r; if (kept.some(k => r.left < k.right + 2 && r.right > k.left - 2 && r.top < k.bottom + 1 && r.bottom > k.top - 1)) it.e.style.visibility = 'hidden'; else kept.push(r); });
  }
  G.AtlasChart = { PLOTBG, Base, PriceChart, SeriesChart, Ind, PAL, fmtPx, fmtVol, fmtDate, fmtPct, FONT, LFONT, font, wt, FX, placeLabels, declutter };
})(window);
