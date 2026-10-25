/* KLTN Anywhere — the terminal on a phone. Same server, same data (/api/*), phone-first screens:
   Home (market tiles, top news, movers) · Markets (indices, futures, FX, rates, commodities, crypto) · News (the live wire)
   · Watch (your list, kept on this device) · Functions (every terminal function; any of them opens full screen in a
   one-panel terminal frame). Typing a security opens its quote, chart, statistics and news; "AAPL GP", "AAPL CN" go to that
   part; any other "<security> <function>" or function opens the full terminal screen for it.
   On a hosted KLTN (KLTN_PUBLIC=1) every call needs a KLTN login: the sign-in sheet appears when the server asks. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id), esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ok = v => typeof v === 'number' && isFinite(v);
  const mv = $('mv');
  // ------------------------------------------------------------------ data
  /* Static mode (window.KLTN_STATIC, the GitHub Pages build): no server; the same calls are answered from data files a
     scheduled job refreshes every 15 minutes (quotes.json, intra.json, news.json, movers.json, hist/<sym>.json …). */
  const STATIC = !!window.KLTN_STATIC, DATA = window.KLTN_DATA || 'data/';
  const LONG = { p: 'regularMarketPrice', c: 'regularMarketChange', cp: 'regularMarketChangePercent', pc: 'regularMarketPreviousClose', o: 'regularMarketOpen', h: 'regularMarketDayHigh',
    l: 'regularMarketDayLow', v: 'regularMarketVolume', t: 'regularMarketTime', b: 'bid', a: 'ask', av: 'averageDailyVolume3Month', mc: 'marketCap', so: 'sharesOutstanding',
    pe: 'trailingPE', fpe: 'forwardPE', eps: 'epsTrailingTwelveMonths', dy: 'dividendYield', pb: 'priceToBook', h52: 'fiftyTwoWeekHigh', l52: 'fiftyTwoWeekLow', m50: 'fiftyDayAverage',
    m200: 'twoHundredDayAverage', er: 'earningsTimestampStart', n: 'longName', sn: 'shortName', x: 'fullExchangeName', cur: 'currency', ms: 'marketState', ar: 'averageAnalystRating' };
  const longQ = (s, o) => { const q = { symbol: s }; Object.entries(o || {}).forEach(([k, v]) => { if (LONG[k]) q[LONG[k]] = v; }); return q; };
  const jc = {};
  const getJ = async (f, ttl = 60e3) => {
    const c = jc[f]; if (c && Date.now() - c.t < ttl) return c.v;
    const r = await fetch(DATA + f + '?v=' + Math.floor(Date.now() / 60e3), { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status === 404 ? 'not in KLTN Anywhere data' : 'HTTP ' + r.status);
    const v = await r.json(); jc[f] = { t: Date.now(), v }; return v;
  };
  const fileOf = s => String(s).replace(/[^A-Za-z0-9._=^-]/g, '_');
  async function sapi(path, p) {
    p = p || {};
    if (path === 'quote') { const q = await getJ('quotes.json'); return String(p.s || '').split(',').filter(s => q[s]).map(s => longQ(s, q[s])); }
    if (path === 'spark') { const d = await getJ('intra.json'); const out = {}; String(p.s || '').split(',').forEach(s => { if (d[s]) out[s] = d[s]; }); return out; }
    if (path === 'chart') {
      const bar = ([t, c]) => ({ t, o: c, h: c, l: c, c });
      if (p.range === '1d') { const d = await getJ('intra.json'); return { bars: (d[p.s] || []).map(bar) }; }
      const h = await getJ('hist/' + fileOf(p.s) + '.json', 3600e3);
      const now = Date.now() / 1000, cut = { '1mo': now - 31 * 86400, '6mo': now - 183 * 86400, 'ytd': new Date(new Date().getFullYear(), 0, 1) / 1000, '1y': 0 }[p.range];
      return { bars: (p.range === '5y' ? h.w : (h.d || []).filter(x => x[0] >= (cut || 0))).map(bar) };
    }
    if (path === 'topnews') return { items: await getJ('news.json') };
    if (path === 'news') { try { return await getJ('news/' + fileOf(p.s) + '.json', 600e3); } catch (e) { const all = await getJ('news.json'), rx = new RegExp('\\b' + String(p.s).replace(/[^A-Za-z0-9]/g, '') + '\\b', 'i'); return all.filter(x => rx.test(x.title)).slice(0, 30); } }
    if (path === 'screener') { const m = await getJ('movers.json'); return (p.id === 'day_losers' ? m.losers : m.gainers).map(o => longQ(o.s, o)); }
    if (path === 'social/session') return { user: null };
    throw new Error('Not available in KLTN Anywhere');
  }
  let needLogin = false;
  async function api(path, params, body) {
    if (STATIC) return sapi(path, params);
    const qs = params ? '?' + Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&') : '';
    const r = await fetch('/api/' + path + qs, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin' });
    let d = null; try { d = await r.json(); } catch (e) { }
    if (r.status === 401) { if (!needLogin) { needLogin = true; signIn(); } throw new Error('sign in required'); }
    if (!r.ok || (d && d.error)) throw new Error((d && d.error) || ('HTTP ' + r.status));
    return d;
  }
  const quotes = async syms => { const out = {}; if (!syms.length) return out; for (let i = 0; i < syms.length; i += 40) { const d = await api('quote', { s: syms.slice(i, i + 40).join(',') }); (d || []).forEach(q => { out[q.symbol] = q; }); } return out; };
  const sparks = syms => api('spark', { s: syms.join(','), range: '1d', interval: '5m' }).catch(() => ({}));
  // ------------------------------------------------------------------ terminal symbology (what the desktop command line accepts)
  const IDX = { SPX: '^GSPC', INDU: '^DJI', CCMP: '^IXIC', NDX: '^NDX', RTY: '^RUT', VIX: '^VIX', UKX: '^FTSE', DAX: '^GDAXI', CAC: '^FCHI', SX5E: '^STOXX50E', NKY: '^N225', HSI: '^HSI', AS51: '^AXJO', SPTSX: '^GSPTSE', IBOV: '^BVSP', DXY: 'DX-Y.NYB', USGG10YR: '^TNX' };
  const EXCH = { US: '', UN: '', UW: '', LN: '.L', GY: '.DE', GR: '.DE', FP: '.PA', NA: '.AS', IM: '.MI', SM: '.MC', SW: '.SW', SS: '.ST', JT: '.T', JP: '.T', HK: '.HK', CN: '.TO', AU: '.AX', IN: '.NS', KS: '.KS', TT: '.TW', BZ: '.SA' };
  const FUT = { CL1: 'CL=F', CO1: 'BZ=F', NG1: 'NG=F', GC1: 'GC=F', SI1: 'SI=F', HG1: 'HG=F', ES1: 'ES=F', NQ1: 'NQ=F', DM1: 'YM=F', TY1: 'ZN=F', 'C 1': 'ZC=F', 'S 1': 'ZS=F', 'W 1': 'ZW=F' };
  const YK = /\s+(EQUITY|INDEX|COMDTY|CURNCY|CORP|GOVT|CRYPTO)$/;
  const toY = raw => {
    let t = raw.trim().toUpperCase(); const yk = (t.match(YK) || [])[1]; t = t.replace(YK, '').trim();
    if (IDX[t] && (!yk || yk === 'INDEX')) return IDX[t];
    if (FUT[t]) return FUT[t];
    if (yk === 'CURNCY' || /^(EUR|USD|GBP|AUD|NZD|CAD|CHF|JPY|CNH|XBT|ETH)[A-Z]{3}$/.test(t)) { const m = t.replace(/^XBT/, 'BTC').match(/^(BTC|ETH|SOL|XRP)(USD)?$/); if (m) return m[1] + '-USD'; return (t.length === 3 ? 'USD' + t : t) + '=X'; }
    const p = t.split(/\s+/); if (p.length === 2 && EXCH[p[1]] != null) return p[0].replace('/', '-') + EXCH[p[1]];
    return t.replace('/', '-');
  };
  const IDXR = Object.fromEntries(Object.entries(IDX).map(([k, v]) => [v, k]));
  const nameOf = s => IDXR[s] ? IDXR[s] + ' Index' : /=F$/.test(s) ? s.replace('=F', '1') + ' Comdty' : /=X$/.test(s) ? (s.length === 5 ? 'USD' + s.slice(0, 3) : s.replace('=X', '')) + ' Curncy' : /-USD$/.test(s) ? s.replace('BTC', 'XBT').replace('-', '') + ' Curncy' : /\.L$/.test(s) ? s.replace('.L', '') + ' LN Equity' : s.replace('-', '/') + ' US Equity';
  const short = s => nameOf(s).replace(/ (Equity|Index|Comdty|Curncy)$/, '');
  // ------------------------------------------------------------------ formatting
  const n = (v, d = 2) => ok(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '--';
  const px = v => ok(v) ? n(v, Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 2 : 4) : '--';
  const pct = v => ok(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) + '%' : '--';
  const sgn = (v, d = 2) => ok(v) ? (v >= 0 ? '+' : '') + n(v, d) : '--';
  const big = v => { if (!ok(v)) return '--'; const a = Math.abs(v); return a >= 1e12 ? (v / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(v); };
  const cls = v => !ok(v) || v === 0 ? '' : v > 0 ? 'up' : 'dn';
  const hm = t => { const d = new Date(t * 1000); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const ago = t => { const s = Date.now() / 1000 - t; return s < 3600 ? Math.max(1, Math.round(s / 60)) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : new Date(t * 1000).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }); };
  const spark = (pts, prev) => {
    if (!pts || pts.length < 2) return '<svg class="spk"></svg>';
    const v = pts.map(p => p[1]).concat(ok(prev) ? [prev] : []), lo = Math.min(...v), hi = Math.max(...v), W = 64, H = 26;
    const y = x => (H - 2 - (x - lo) / ((hi - lo) || 1) * (H - 4)).toFixed(1), last = pts[pts.length - 1][1], col = ok(prev) && last < prev ? '#ff3b55' : '#30d254';
    return `<svg class="spk" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${ok(prev) ? `<line x1="0" x2="${W}" y1="${y(prev)}" y2="${y(prev)}" stroke="#555" stroke-dasharray="2 2" stroke-width="1"/>` : ''}<polyline points="${pts.map((p, i) => (i / (pts.length - 1) * W).toFixed(1) + ',' + y(p[1])).join(' ')}" fill="none" stroke="${col}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
  };
  const toast = msg => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); };
  // ------------------------------------------------------------------ navigation
  let view = 'home', timer = null, gen = 0;
  const every = (ms, f) => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) f(); }, ms); };
  const show = (v, arg) => {
    view = v; gen++; clearInterval(timer); closeAc();
    document.querySelectorAll('#mtab button').forEach(b => b.classList.toggle('on', b.dataset.v === v || (v === 'sec' && b.dataset.v === 'watch' && false)));
    mv.scrollTop = 0; mv.innerHTML = '<div class="empty">Retrieving data&hellip;</div>';
    try { history.replaceState(null, '', '#' + v + (arg ? '/' + encodeURIComponent(arg) : '')); } catch (e) { }
    (VIEWS[v] || VIEWS.home)(arg, gen).catch(e => { if (!needLogin) mv.innerHTML = `<div class="empty">${esc(e.message || e)}</div>`; });
  };
  document.querySelectorAll('#mtab button').forEach(b => b.onclick = () => show(b.dataset.v));
  const alive = g => g === gen;
  // ------------------------------------------------------------------ views
  const TILES = [['^GSPC', 'S&P 500'], ['^IXIC', 'Nasdaq'], ['^DJI', 'Dow Jones'], ['^RUT', 'Russell 2000'], ['^VIX', 'VIX'], ['^TNX', 'US 10Y Yield'], ['DX-Y.NYB', 'Dollar Index'], ['EURUSD=X', 'EUR/USD'], ['CL=F', 'WTI Crude'], ['GC=F', 'Gold'], ['BTC-USD', 'Bitcoin'], ['^FTSE', 'FTSE 100']];
  const tileHtml = (s, label, q, sp) => { const c = q && q.regularMarketChangePercent; return `<div class="tile ${ok(c) ? (c >= 0 ? 'u' : 'd') : ''}" data-s="${esc(s)}"><div class="t-n">${esc(label)}</div><div class="t-v">${q ? px(q.regularMarketPrice) : '--'}</div><div class="t-c ${cls(c)}">${q ? sgn(q.regularMarketChange) + ' ' + pct(c) : ''}</div>${spark(sp, q && q.regularMarketPreviousClose)}</div>`; };
  const rowHtml = (s, label, sub, q, sp) => { const c = q && q.regularMarketChangePercent; return `<div class="row" data-s="${esc(s)}"><div class="r-n"><b>${esc(label)}</b><span>${esc(sub || '')}</span></div>${spark(sp, q && q.regularMarketPreviousClose)}<div class="r-v"><b>${q ? px(q.regularMarketPrice) : '--'}</b><span class="pill ${ok(c) ? (c > 0 ? 'u' : c < 0 ? 'd' : 'z') : 'z'}">${pct(c)}</span></div></div>`; };
  const bindSec = root => root.querySelectorAll('[data-s]').forEach(el => el.onclick = () => openSec(el.dataset.s));
  const newsHtml = items => items.map(x => `<a class="nrow" href="${esc(x.link || '#')}" target="_blank" rel="noopener"><div class="n-t">${esc(x.title)}</div><div class="n-m"><b>${esc(x.code || x.source || '')}</b><span>${esc(x.source || x.feed || '')}</span><span>${x.ts ? ago(x.ts) : ''}</span>${x.cat ? `<span>${esc(x.cat)}</span>` : ''}</div></a>`).join('');
  const VIEWS = {};
  VIEWS.home = async (a, g) => {
    const syms = TILES.map(t => t[0]);
    const draw = async () => {
      const [q, sp, nw, gn, ls] = await Promise.all([quotes(syms), sparks(syms), api('topnews', { since: 0, limit: 12 }).catch(() => ({ items: [] })), api('screener', { id: 'day_gainers', count: 5 }).catch(() => []), api('screener', { id: 'day_losers', count: 5 }).catch(() => [])]);
      if (!alive(g)) return;
      const d = new Date();
      mv.innerHTML = `<div class="redbar"><button class="on">Markets Now</button><span class="rb-t">${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span></div>` +
        `<div class="tiles">${TILES.map(([s, l]) => tileHtml(s, l, q[s], sp[s])).join('')}</div>` +
        `<div class="sec-h"><span>Top News</span><button class="more" data-go="news">More &rsaquo;</button></div><div class="news">${newsHtml((nw.items || []).slice(0, 8))}</div>` +
        `<div class="sec-h"><span>Top Gainers</span><button class="more" data-go="markets">Markets &rsaquo;</button></div><div class="list">${(gn || []).slice(0, 5).map(x => rowHtml(x.symbol, short(x.symbol), x.shortName, x, null)).join('')}</div>` +
        `<div class="sec-h"><span>Top Losers</span></div><div class="list">${(ls || []).slice(0, 5).map(x => rowHtml(x.symbol, short(x.symbol), x.shortName, x, null)).join('')}</div>`;
      bindSec(mv); mv.querySelectorAll('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
    };
    await draw(); every(20000, () => draw().catch(() => { }));
  };
  const MKT = {
    Equity: [['^GSPC', 'S&P 500'], ['^IXIC', 'Nasdaq Composite'], ['^DJI', 'Dow Jones'], ['^RUT', 'Russell 2000'], ['^GSPTSE', 'S&P/TSX'], ['^BVSP', 'Ibovespa'], ['^STOXX50E', 'Euro Stoxx 50'], ['^FTSE', 'FTSE 100'], ['^GDAXI', 'DAX'], ['^FCHI', 'CAC 40'], ['^N225', 'Nikkei 225'], ['^HSI', 'Hang Seng'], ['000300.SS', 'CSI 300'], ['^KS11', 'KOSPI'], ['^AXJO', 'S&P/ASX 200'], ['^NSEI', 'Nifty 50']],
    Futures: [['ES=F', 'S&P 500 E-mini'], ['NQ=F', 'Nasdaq 100 E-mini'], ['YM=F', 'Dow E-mini'], ['RTY=F', 'Russell 2000 E-mini'], ['ZN=F', '10Y T-Note'], ['ZB=F', '30Y T-Bond'], ['VX=F', 'VIX Futures']],
    FX: [['EURUSD=X', 'EUR/USD'], ['JPY=X', 'USD/JPY'], ['GBPUSD=X', 'GBP/USD'], ['CHF=X', 'USD/CHF'], ['AUDUSD=X', 'AUD/USD'], ['CAD=X', 'USD/CAD'], ['CNY=X', 'USD/CNY'], ['MXN=X', 'USD/MXN'], ['DX-Y.NYB', 'Dollar Index']],
    Rates: [['^IRX', 'US 13-Week Bill'], ['^FVX', 'US 5Y Yield'], ['^TNX', 'US 10Y Yield'], ['^TYX', 'US 30Y Yield']],
    Commodities: [['CL=F', 'WTI Crude'], ['BZ=F', 'Brent Crude'], ['NG=F', 'Natural Gas'], ['GC=F', 'Gold'], ['SI=F', 'Silver'], ['HG=F', 'Copper'], ['ZC=F', 'Corn'], ['ZS=F', 'Soybeans'], ['ZW=F', 'Wheat'], ['KC=F', 'Coffee']],
    Crypto: [['BTC-USD', 'Bitcoin'], ['ETH-USD', 'Ethereum'], ['SOL-USD', 'Solana'], ['XRP-USD', 'XRP'], ['DOGE-USD', 'Dogecoin']],
  };
  let mktTab = 'Equity';
  VIEWS.markets = async (a, g) => {
    if (a && MKT[a]) mktTab = a;
    const draw = async () => {
      const list = MKT[mktTab], syms = list.map(x => x[0]); const [q, sp] = await Promise.all([quotes(syms), sparks(syms)]); if (!alive(g)) return;
      mv.innerHTML = `<div class="redbar">${Object.keys(MKT).map(k => `<button data-k="${k}" class="${k === mktTab ? 'on' : ''}">${k}</button>`).join('')}</div>` +
        `<div class="list">${list.map(([s, l]) => rowHtml(s, l, short(s), q[s], sp[s])).join('')}</div>`;
      mv.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { mktTab = b.dataset.k; show('markets', mktTab); });
      bindSec(mv);
    };
    await draw(); every(15000, () => draw().catch(() => { }));
  };
  const CATS = ['All', 'Markets', 'Economy', 'Business', 'Politics', 'World', 'National', 'Tech'];
  let newsCat = 'All';
  VIEWS.news = async (a, g) => {
    const d = await api('topnews', { since: 0, limit: 300 }); if (!alive(g)) return;
    const draw = () => {
      const items = (d.items || []).filter(x => newsCat === 'All' || (x.cat || '').toLowerCase() === newsCat.toLowerCase()).slice(0, 120);
      mv.innerHTML = `<div class="chips">${CATS.map(c => `<button data-c="${c}" class="${c === newsCat ? 'on' : ''}">${c}</button>`).join('')}</div><div class="news">${newsHtml(items) || '<div class="empty">No stories in this category right now.</div>'}</div>`;
      mv.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { newsCat = b.dataset.c; draw(); });
    };
    draw();
  };
  const WKEY = 'kltnAnywhereWatch', WDEF = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'SPY', 'QQQ', 'BTC-USD'];
  const wl = () => { try { const v = JSON.parse(localStorage.getItem(WKEY) || 'null'); return Array.isArray(v) && v.length ? v : WDEF.slice(); } catch (e) { return WDEF.slice(); } };
  const wsave = v => { try { localStorage.setItem(WKEY, JSON.stringify(v)); } catch (e) { } };
  let wEdit = false;
  VIEWS.watch = async (a, g) => {
    const draw = async () => {
      const syms = wl(); const [q, sp] = await Promise.all([quotes(syms), sparks(syms)]); if (!alive(g)) return;
      mv.innerHTML = `<div class="redbar"><button class="on">Watchlist</button><button data-a="add">Add</button><button data-a="edit" class="${wEdit ? 'on' : ''}">${wEdit ? 'Done' : 'Edit'}</button><span class="rb-t">${syms.length} securities</span></div>` +
        `<div class="list">${syms.map(s => wEdit ? `<div class="row"><div class="r-n"><b>${esc(short(s))}</b><span>${esc((q[s] && (q[s].shortName || q[s].longName)) || '')}</span></div><span></span><button class="pill d" data-x="${esc(s)}">Remove</button></div>` : rowHtml(s, short(s), q[s] && (q[s].shortName || q[s].longName), q[s], sp[s])).join('')}</div>`;
      mv.querySelector('[data-a=add]').onclick = () => { const v = prompt('Add a security (e.g. NFLX, VOD LN, EURUSD)'); if (!v) return; const s = toY(v); const l = wl(); if (!l.includes(s)) { l.push(s); wsave(l); } draw(); };
      mv.querySelector('[data-a=edit]').onclick = () => { wEdit = !wEdit; draw(); };
      mv.querySelectorAll('[data-x]').forEach(b => b.onclick = e => { e.stopPropagation(); wsave(wl().filter(x => x !== b.dataset.x)); draw(); });
      if (!wEdit) bindSec(mv);
    };
    await draw(); every(15000, () => { if (!wEdit) draw().catch(() => { }); });
  };
  const FNS = [
    ['Markets', [['WEI', 'World Equity Indices'], ['WEIF', 'World Index Futures'], ['MOST', 'Most Active Securities'], ['MOV', 'Index Movers'], ['IMAP', 'Intraday Market Map'], ['WCRS', 'World Currency Ranker'], ['GLCO', 'Global Commodities'], ['CRYP', 'Crypto Currency Monitor'], ['BTMM', 'Treasury & Money Markets'], ['WIRP', 'Rate Probabilities']]],
    ['Economy & News', [['TOP', 'Top News'], ['NSE', 'News Search'], ['READ', 'Most Read News'], ['ECO', 'Economic Calendar'], ['ECST', 'World Economic Statistics'], ['ECSU', 'Economic Surprises'], ['CENB', 'Central Bank Monitor'], ['EVTS', 'Events Calendar']]],
    ['Security (type a ticker first)', [['DES', 'Description'], ['GP', 'Price Graph'], ['GIP', 'Intraday Graph'], ['FA', 'Financial Analysis'], ['ANR', 'Analyst Recommendations'], ['EE', 'Earnings & Estimates'], ['HDS', 'Holders'], ['OMON', 'Option Monitor'], ['DVD', 'Dividends'], ['RV', 'Relative Valuation'], ['BETA', 'Historical Beta'], ['SI', 'Short Interest'], ['CAST', 'Capital Structure'], ['QR', 'Quote Recap']]],
    ['Workspace', [['W', 'Watchlist (full)'], ['PORT', 'Portfolio & Risk'], ['ALRT', 'Alerts'], ['IB', 'Instant Chat'], ['MSG', 'Mail'], ['HELP', 'Help & Function Directory']]],
  ];
  let curSec = null;
  VIEWS.fns = async () => {
    mv.innerHTML = '<div class="redbar"><button class="on">Main Menu</button><span class="rb-t">' + (STATIC ? 'Deep functions: desktop app' : 'Every function opens full screen') + '</span></div>' +
      FNS.map(([g, list]) => `<div class="sec-h"><span>${esc(g)}</span></div><div class="fgrid">${list.map(([c, l]) => `<div class="fg" data-f="${c}"><b>${c}</b><span>${esc(l)}</span></div>`).join('')}</div>`).join('') +
      '<div class="empty">Type any terminal function in the orange box (e.g. <b class="amb">FA</b>, <b class="amb">VOD LN DES</b>, <b class="amb">ECO</b>) and press GO.</div>';
    mv.querySelectorAll('[data-f]').forEach(el => el.onclick = () => { const c = el.dataset.f; const secFn = ['DES', 'GP', 'GIP', 'FA', 'ANR', 'EE', 'HDS', 'OMON', 'DVD', 'RV', 'BETA', 'SI', 'CAST', 'QR'].includes(c); run(secFn ? (nameOf(curSec || 'AAPL') + ' ' + c) : c); });
  };
  // ------------------------------------------------------------------ one security: quote, chart, statistics, news
  const RNG0 = [['1D', '1d', '5m'], ['5D', '5d', '15m'], ['1M', '1mo', '1d'], ['6M', '6mo', '1d'], ['YTD', 'ytd', '1d'], ['1Y', '1y', '1d'], ['5Y', '5y', '1wk']];
  const RNG = STATIC ? RNG0.filter(r => r[0] !== '5D') : RNG0;
  let secTab = 'chart', secRng = '1D';
  const openSec = (s, tab) => { curSec = s; if (tab) secTab = tab; show('sec', s); };
  VIEWS.sec = async (s, g) => {
    curSec = s;
    const q = (await quotes([s]))[s]; if (!alive(g)) return;
    if (!q) { mv.innerHTML = `<div class="empty">No quote for ${esc(nameOf(s))}. Check the ticker (e.g. AAPL, VOD LN, EURUSD).</div>`; return; }
    const head = () => {
      const c = q.regularMarketChangePercent, t = q.regularMarketTime ? new Date(q.regularMarketTime * 1000) : null;
      return `<button class="back" data-back="1"><svg viewBox="0 0 8 12"><path d="M6.5 1 1.5 6l5 5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>Back</button>` +
        `<div class="sq"><div class="sq-top"><span class="sq-blk"></span><span class="sq-tk">${esc(short(s))}</span><span class="sq-yk">${esc(nameOf(s).split(' ').pop())}</span><span class="grow"></span><button class="pill ${wl().includes(s) ? 'u' : 'z'}" data-w="1">${wl().includes(s) ? '&#9733; Watching' : '+ Watch'}</button></div>` +
        `<div class="sq-nm">${esc(q.longName || q.shortName || '')}</div>` +
        `<div class="sq-px"><span class="p ${cls(c)}">${px(q.regularMarketPrice)}</span><span class="c ${cls(c)}">${sgn(q.regularMarketChange)} ${pct(c)}</span></div>` +
        `<div class="sq-at">${t ? (t.toDateString() === new Date().toDateString() ? 'At ' + hm(q.regularMarketTime) : 'On ' + t.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })) : ''} · ${esc(q.fullExchangeName || q.exchange || '')} · ${esc(q.currency || '')}${q.marketState && q.marketState !== 'REGULAR' ? ' · closed' : ''}</div>` +
        `<div class="sq-ql"><div><span>O</span>${px(q.regularMarketOpen)}</div><div><span>H</span>${px(q.regularMarketDayHigh)}</div><div><span>L</span>${px(q.regularMarketDayLow)}</div><div><span>Vol</span>${big(q.regularMarketVolume)}</div>${q.bid > 0 ? `<div><span>Bid/Ask</span>${px(q.bid)} / ${px(q.ask)}</div>` : ''}</div></div>` +
        `<div class="redbar">${[['chart', 'Chart'], ['stats', 'Overview'], ['news', 'News'], ['fns', 'Functions']].map(([k, l]) => `<button data-t="${k}" class="${k === secTab ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    };
    const body = async () => {
      if (secTab === 'chart') {
        mv.insertAdjacentHTML('beforeend', `<div class="chips">${RNG.map(([k]) => `<button data-r="${k}" class="${k === secRng ? 'on' : ''}">${k}</button>`).join('')}</div><div class="mch" id="mch"></div>`);
        mv.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { secRng = b.dataset.r; render(); });
        const [, range, interval] = RNG.find(r => r[0] === secRng);
        const d = await api('chart', { s, range, interval }).catch(() => null); if (!alive(g)) return;
        const host = $('mch'); if (!host || !d || !d.bars || !d.bars.length) { if (host) host.innerHTML = '<div class="empty">No chart data.</div>'; return; }
        const ch = new AtlasChart.PriceChart(host, { type: 'area', sma: [], ema: [], vol: false }); ch.name = short(s); ch.setData(d.bars, /m$/.test(interval));
      } else if (secTab === 'stats') {
        const kv = [['Prev Close', px(q.regularMarketPreviousClose)], ['Open', px(q.regularMarketOpen)], ['Day Range', px(q.regularMarketDayLow) + ' - ' + px(q.regularMarketDayHigh)], ['52W Range', px(q.fiftyTwoWeekLow) + ' - ' + px(q.fiftyTwoWeekHigh)],
          ['Volume', big(q.regularMarketVolume)], ['Avg Vol 3M', big(q.averageDailyVolume3Month)], ['Mkt Cap', big(q.marketCap)], ['Shares Out', big(q.sharesOutstanding)], ['P/E', ok(q.trailingPE) ? q.trailingPE.toFixed(2) : '--'], ['Fwd P/E', ok(q.forwardPE) ? q.forwardPE.toFixed(2) : '--'],
          ['EPS (TTM)', ok(q.epsTrailingTwelveMonths) ? q.epsTrailingTwelveMonths.toFixed(2) : '--'], ['Div Yld', ok(q.dividendYield) ? q.dividendYield.toFixed(2) + '%' : '--'], ['P/B', ok(q.priceToBook) ? q.priceToBook.toFixed(2) : '--'], ['50D Avg', px(q.fiftyDayAverage)], ['200D Avg', px(q.twoHundredDayAverage)],
          ['Earnings', q.earningsTimestampStart ? new Date(q.earningsTimestampStart * 1000).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }) : '--'], ['Analysts', esc(q.averageAnalystRating || '--')], ['Exchange', esc(q.fullExchangeName || '--')]];
        mv.insertAdjacentHTML('beforeend', `<div class="kv2">${kv.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('')}</div>`);
      } else if (secTab === 'news') {
        const items = await api('news', { s }).catch(() => []); if (!alive(g)) return;
        mv.insertAdjacentHTML('beforeend', `<div class="news">${newsHtml(Array.isArray(items) ? items : []) || '<div class="empty">No recent stories.</div>'}</div>`);
      } else {
        const L = [['DES', 'Description'], ['GP', 'Price Graph'], ['GIP', 'Intraday Graph'], ['FA', 'Financial Analysis'], ['ANR', 'Analyst Recs'], ['EE', 'Earnings'], ['HDS', 'Holders'], ['OMON', 'Options'], ['DVD', 'Dividends'], ['RV', 'Relative Value'], ['BETA', 'Beta'], ['SI', 'Short Interest'], ['CAST', 'Capital Structure'], ['QR', 'Quote Recap'], ['CN', 'Company News'], ['SPLC', 'Supply Chain']];
        mv.insertAdjacentHTML('beforeend', `<div class="fnrow">${L.map(([c, l]) => `<button data-f="${c}"><b>${c}</b>${l}</button>`).join('')}</div>`);
        mv.querySelectorAll('[data-f]').forEach(b => b.onclick = () => run(nameOf(s) + ' ' + b.dataset.f));
      }
    };
    const render = async () => {
      mv.innerHTML = head();
      mv.querySelector('[data-back]').onclick = () => history.length > 1 && lastView ? show(lastView) : show('home');
      mv.querySelector('[data-w]').onclick = () => { const l = wl(); wsave(l.includes(s) ? l.filter(x => x !== s) : l.concat([s])); render(); };
      mv.querySelectorAll('.redbar [data-t]').forEach(b => b.onclick = () => { secTab = b.dataset.t; render(); });
      await body();
    };
    await render();
  };
  // ------------------------------------------------------------------ the command line
  let lastView = 'home';
  const LOCAL = { HOME: 'home', MAIN: 'fns', MENU: 'fns', N: 'news', TOP: 'news', NEWS: 'news', W: 'watch', WATCH: 'watch', WEI: ['markets', 'Equity'], WEIF: ['markets', 'Futures'], FXC: ['markets', 'FX'], WCR: ['markets', 'FX'], GLCO: ['markets', 'Commodities'], CRYP: ['markets', 'Crypto'] };
  const SECTAB = { GP: 'chart', GIP: 'chart', CN: 'news', DES: 'stats', Q: 'stats', QUOTE: 'stats' };
  let FNSET = null;
  const fnSet = async () => { if (FNSET) return FNSET; FNSET = new Set(FNS.flatMap(g => g[1].map(x => x[0])).concat(Object.keys(LOCAL), ['FA', 'EQS', 'SECF', 'BMAP', 'SPLC', 'ERN', 'EEO', 'COMP', 'CORR', 'HP', 'DDIS', 'DRSK', 'WACC', 'DCF', 'MA', 'IPO', 'INS', 'INSD', 'CACS', 'GC', 'YAS', 'CDS', 'CDSW', 'OVDV', 'GF', 'PORT', 'LEGI', 'FEC', 'COT', 'ENRG', 'AGRI', 'SHIP', 'CHOKE', 'KQNT'])); return FNSET; };
  const DESKTOP = 'https://kltn-terminal.web.app/#get';
  const run = cmd => {
    if (STATIC) {   // the deep functions run in the desktop app (free); the phone shows where to get it
      const sh = document.createElement('div'); sh.className = 'sheet';
      sh.innerHTML = `<div class="sh-b"><h2>${esc(cmd)}</h2><p>This function runs in the KLTN desktop app, free for Windows and Mac, with live data and all 176 functions. KLTN Anywhere covers markets, quotes, charts and news.</p><div class="sh-a"><button type="button" data-g="1">Get the desktop app</button><button type="button" class="alt" data-x="1">Close</button></div></div>`;
      sh.querySelector('[data-g]').onclick = () => { location.href = DESKTOP; };
      sh.querySelector('[data-x]').onclick = () => sh.remove(); sh.onclick = e => { if (e.target === sh) sh.remove(); };
      document.body.appendChild(sh); return;
    }
    // any terminal screen, full size, in a one-panel terminal frame (pop-out mode: never writes the desktop's saved layout)
    const box = document.createElement('div'); box.className = 'fullv';
    box.innerHTML = `<div class="fv-h"><b>${esc(cmd.split(' ').pop())}</b><span>${esc(cmd)}</span><button>Done</button></div><iframe src="/?pop=${encodeURIComponent(cmd)}&m=1" title="${esc(cmd)}"></iframe>`;
    box.querySelector('button').onclick = () => box.remove();
    // phone mode inside the frame: the screen alone, phone-sized type (bb/exact.css body.mphone); kept on while it boots
    const fr = box.querySelector('iframe'), mark = () => { try { const b = fr.contentDocument && fr.contentDocument.body; if (b && !b.classList.contains('mphone')) b.classList.add('mphone'); } catch (e) { } };
    fr.addEventListener('load', () => { mark(); let k = 0; const t = setInterval(() => { mark(); if (++k > 20 || !box.isConnected) clearInterval(t); }, 500); });
    document.body.appendChild(box);
  };
  const exec = async raw => {
    const t = raw.trim().toUpperCase().replace(/<GO>$/, '').trim(); if (!t) return;
    const toks = t.split(/\s+/), fns = await fnSet(), last = toks[toks.length - 1];
    if (toks.length === 1 && LOCAL[t]) { const v = LOCAL[t]; lastView = view; Array.isArray(v) ? (mktTab = v[1], show(v[0], v[1])) : show(v); return; }
    if (toks.length === 1 && fns.has(t)) { run(t); return; }
    if (toks.length > 1 && fns.has(last)) {
      const s = toY(toks.slice(0, -1).join(' '));
      if (SECTAB[last]) { lastView = view; openSec(s, SECTAB[last]); return; }
      run(nameOf(s) + ' ' + last); return;
    }
    if (toks.length === 1 && /^[A-Z]{2,6}$/.test(t) && fns.has(t)) { run(t); return; }
    lastView = view === 'sec' ? lastView : view; openSec(toY(t), 'chart');
  };
  const inp = $('min'), ac = $('mac');
  let U = null;
  const loadU = async () => { if (U) return U; try { const r = await fetch(STATIC ? DATA + 'universe.json' : '/data/universe.json'); const d = await r.json(); U = d.securities || []; } catch (e) { U = []; } return U; };
  const closeAc = () => ac.classList.remove('on');
  inp.addEventListener('input', async () => {
    const v = inp.value.trim().toUpperCase(); if (!v) { closeAc(); return; }
    const u = await loadU(), fns = await fnSet();
    const fhit = [...fns].filter(c => c.startsWith(v)).slice(0, 4);
    const lv = v.toLowerCase(), shit = u.filter(x => x.s.startsWith(v) || (x.n || '').toLowerCase().includes(lv)).sort((a, b) => (b.s === v) - (a.s === v) || (b.s.startsWith(v)) - (a.s.startsWith(v)) || (b.mcu || 0) - (a.mcu || 0)).slice(0, 7);
    ac.innerHTML = (fhit.length ? '<div class="mac-h">Functions</div>' + fhit.map(c => `<div class="mac-r" data-v="${c}"><b>${c}</b><span>${esc((FNS.flatMap(g => g[1]).find(x => x[0] === c) || [, ''])[1])}</span></div>`).join('') : '') +
      (shit.length ? '<div class="mac-h">Securities</div>' + shit.map(x => `<div class="mac-r" data-v="${esc(x.s)}"><b>${esc(short(x.s))}</b><span>${esc(x.n || '')}</span></div>`).join('') : '');
    ac.classList.toggle('on', !!(fhit.length || shit.length));
    ac.querySelectorAll('[data-v]').forEach(r => r.onclick = () => { inp.value = ''; closeAc(); inp.blur(); exec(r.dataset.v); });
  });
  $('mcmd').addEventListener('submit', e => { e.preventDefault(); const v = inp.value; inp.value = ''; closeAc(); inp.blur(); exec(v); });
  document.addEventListener('click', e => { if (!e.target.closest('#mcmd')) closeAc(); });
  // ------------------------------------------------------------------ account
  async function signIn() {
    const sh = document.createElement('div'); sh.className = 'sheet';
    sh.innerHTML = '<form class="sh-b"><h2>KLTN Login</h2><p>Sign in with your KLTN user name to use KLTN Anywhere.</p><label>Login Name</label><input name="u" autocomplete="username" autocapitalize="none">' +
      '<label>Password</label><input name="p" type="password" autocomplete="current-password"><div class="sh-err"></div><div class="sh-a"><button type="submit">Log In</button><button type="button" class="alt" data-r="1">Create Login</button></div></form>';
    document.body.appendChild(sh);
    const f = sh.querySelector('form'), err = sh.querySelector('.sh-err');
    const go = async mode => {
      err.textContent = '';
      try { await api('social/' + mode, null, { username: f.u.value.trim(), password: f.p.value, display: f.u.value.trim() }); needLogin = false; sh.remove(); account(); show(view === 'sec' ? 'home' : view); }
      catch (e) { err.textContent = e.message || String(e); }
    };
    f.onsubmit = e => { e.preventDefault(); go('login'); };
    sh.querySelector('[data-r]').onclick = () => go('register');
  }
  async function account() {
    try { const d = await api('social/session'); const me = $('mme'); me.classList.toggle('on', !!(d && d.user)); me.title = d && d.user ? 'Signed in as ' + (d.user.display || d.user.handle || '') : 'Not signed in';
      me.onclick = () => { if (d && d.user) { if (confirm('Signed in as ' + (d.user.display || d.user.handle) + '. Log out?')) api('social/logout', null, {}).then(() => location.reload()).catch(() => { }); } else signIn(); }; } catch (e) { }
  }
  const clock = () => { const d = new Date(), ny = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }); const wd = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short' }); const h = +ny.slice(0, 2), m = +ny.slice(3); const open = !/Sat|Sun/.test(wd) && (h * 60 + m) >= 570 && (h * 60 + m) < 960; $('mst').innerHTML = (open ? '<b>&#9679;</b> ' : '') + ($('mst').dataset.asof ? esc($('mst').dataset.asof) + ' · ' : '') + 'NY ' + ny; };
  clock(); setInterval(clock, 15000);
  if (STATIC) {   // no accounts here; the header says how fresh the data is
    $('mme').style.display = 'none';
    const age = async () => { try { const m = await getJ('meta.json', 50e3); const d = new Date(m.asof * 1000); $('mst').title = 'Market data refreshes about every 15 minutes'; $('mst').dataset.asof = 'Data ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); clock(); } catch (e) { } };
    age(); setInterval(age, 60000);
  } else account();
  const h0 = decodeURIComponent((location.hash || '').slice(1)).split('/');
  if (h0[0] === 'sec' && h0[1]) openSec(h0[1]); else show(VIEWS[h0[0]] ? h0[0] : 'home', h0[1]);
})();
