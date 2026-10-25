/* KLTN Anywhere — the terminal on a phone, laid out like the terminal's own mobile app.
   Home (market cards, Need to Know, world indices, movers) · Search (securities and functions) · Monitor (your list, kept on
   this phone) · News · Menu (market monitors and every other terminal function). Any security opens its Overview: live price,
   function buttons, statistics, a navy price chart with a touch crosshair, and company news.
   Prices are live. In the GitHub Pages build (window.KLTN_STATIC) the phone asks CNBC's public quote and chart services
   directly (both answer any web page), on top of the files a scheduled job publishes every 15 minutes (names, fundamentals,
   headlines, history). Served by a KLTN server (/m) it uses that server's own /api.
   Deeper functions (FA, ECO, IB ...) run on the full terminal: from the GitHub build, on the PC that hosts KLTN Anywhere's
   terminal while it is on (deploy/pchost: a public-mode copy behind a Cloudflare quick tunnel whose address is published as
   tunnel.json; the visitor signs in with a KLTN login there); otherwise the sheet points to the free desktop app. From a
   KLTN server they open full screen in a one-panel frame. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ok = v => typeof v === 'number' && isFinite(v);
  const mv = $('mv');
  const STATIC = !!window.KLTN_STATIC, DATA = window.KLTN_DATA || 'data/';
  const TUNNEL = window.KLTN_TUNNEL || 'https://raw.githubusercontent.com/koltonandrew62/kltn-anywhere/main/tunnel.json';
  const DESKTOP = 'https://kltn-terminal.web.app/#get';
  const CHEV = '<svg viewBox="0 0 7 12" aria-hidden="true"><path d="m1 1 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  const BACK = '<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ls = { get: (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };

  // ------------------------------------------------------------------ snapshot files (static build) and the server API
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
      const bar = ([t, c]) => ({ t, o: c, h: c, l: c, c, v: 0 });
      if (p.range === '1d' || p.range === '5d') { const d = await getJ('intra.json'); return { bars: (d[p.s] || []).map(bar) }; }
      const h = await getJ('hist/' + fileOf(p.s) + '.json', 3600e3);
      const now = Date.now() / 1000, cut = { '1mo': now - 31 * 86400, '6mo': now - 183 * 86400, 'ytd': new Date(new Date().getFullYear(), 0, 1) / 1000, '1y': 0 }[p.range];
      return { bars: (p.range === '5y' || p.range === 'max' ? h.w : (h.d || []).filter(x => x[0] >= (cut || 0))).map(bar) };
    }
    if (path === 'topnews') return { items: await getJ('news.json') };
    if (path === 'news') {
      try { return await getJ('news/' + fileOf(p.s) + '.json', 600e3); } catch (e) { }
      // not in this run's ticker feeds: the wire's stories that name the ticker (as written) or the company
      const w = String(p.n || '').replace(/\b(Inc|Corp|Corporation|Company|Co|Ltd|Plc|Group|Holdings?|The|AG|SE|SA|NV)\b\.?/gi, ' ').replace(/[^A-Za-z0-9& ]/g, ' ').trim().split(/\s+/)[0] || '';
      const tk = String(p.s).replace(/[^A-Za-z0-9]/g, ''), all = await getJ('news.json');
      const rt = tk.length > 1 ? new RegExp('\\b' + tk + '\\b') : null, rw = w.length > 3 ? new RegExp('\\b' + w + '\\b', 'i') : null;
      return all.filter(x => (rt && rt.test(x.title)) || (rw && rw.test(x.title))).slice(0, 30);
    }
    if (path === 'screener') { const m = await getJ('movers.json'); return (p.id === 'day_losers' ? m.losers : m.gainers).map(o => longQ(o.s, o)); }
    throw new Error('Not available in KLTN Anywhere');
  }
  let needLogin = false;
  async function api(path, params, body) {
    if (STATIC) return sapi(path, params);
    const qs = params ? '?' + Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&') : '';
    const r = await fetch('/api/' + path + qs, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' } : { credentials: 'same-origin' });
    let d = null; try { d = await r.json(); } catch (e) { }
    if (r.status === 401) { if (!needLogin) { needLogin = true; signIn(); } throw new Error('Sign in with your KLTN login'); }
    if (!r.ok || (d && d.error)) throw new Error((d && d.error) || ('HTTP ' + r.status));
    srvAt = Date.now();
    return d;
  }
  let srvAt = 0;

  // ------------------------------------------------------------------ terminal symbology (Yahoo-style keys throughout; CNBC-only rates keep CNBC's)
  const BB = { '^GSPC': 'SPX', '^DJI': 'INDU', '^IXIC': 'CCMP', '^NDX': 'NDX', '^RUT': 'RTY', '^VIX': 'VIX', '^GSPTSE': 'SPTSX', '^MXX': 'MEXBOL', '^BVSP': 'IBOV',
    '^STOXX50E': 'SX5E', '^FTSE': 'UKX', '^GDAXI': 'DAX', '^FCHI': 'CAC', '^IBEX': 'IBEX', 'FTSEMIB.MI': 'FTSEMIB', '^AEX': 'AEX', '^SSMI': 'SMI',
    '^N225': 'NKY', '^HSI': 'HSI', '000001.SS': 'SHCOMP', '000300.SS': 'SHSZ300', '^KS11': 'KOSPI', '^TWII': 'TWSE', '^AXJO': 'AS51', '^NSEI': 'NIFTY', '^STI': 'FSSTI',
    'DX-Y.NYB': 'DXY', '^IRX': 'USGG3M', '^FVX': 'USGG5YR', '^TNX': 'USGG10YR', '^TYX': 'USGG30YR', US1M: 'USGG1M', US6M: 'USGG6M', US1Y: 'USGG12M', US2Y: 'USGG2YR',
    US7Y: 'USGG7YR', US20Y: 'USGG20YR', DE10Y: 'GDBR10', GB10Y: 'GUKG10', JP10Y: 'GJGB10' };
  const FUTBB = { 'ES=F': ['ES1', 'Index'], 'NQ=F': ['NQ1', 'Index'], 'YM=F': ['DM1', 'Index'], 'RTY=F': ['RTY1', 'Index'], 'VX=F': ['UX1', 'Index'], 'ZT=F': ['TU1', 'Comdty'],
    'ZF=F': ['FV1', 'Comdty'], 'ZN=F': ['TY1', 'Comdty'], 'ZB=F': ['US1', 'Comdty'], 'CL=F': ['CL1', 'Comdty'], 'BZ=F': ['CO1', 'Comdty'], 'NG=F': ['NG1', 'Comdty'],
    'HO=F': ['HO1', 'Comdty'], 'RB=F': ['XB1', 'Comdty'], 'GC=F': ['GC1', 'Comdty'], 'SI=F': ['SI1', 'Comdty'], 'HG=F': ['HG1', 'Comdty'], 'PL=F': ['PL1', 'Comdty'],
    'ZC=F': ['C 1', 'Comdty'], 'ZS=F': ['S 1', 'Comdty'], 'ZW=F': ['W 1', 'Comdty'], 'KC=F': ['KC1', 'Comdty'], 'SB=F': ['SB1', 'Comdty'], 'CC=F': ['CC1', 'Comdty'],
    'CT=F': ['CT1', 'Comdty'], 'LE=F': ['LC1', 'Comdty'] };
  const EXR = { L: 'LN', DE: 'GY', F: 'GF', PA: 'FP', AS: 'NA', SW: 'SW', MI: 'IM', MC: 'SM', ST: 'SS', CO: 'DC', OL: 'NO', HE: 'FH', BR: 'BB', T: 'JT', HK: 'HK', TO: 'CN',
    V: 'CV', AX: 'AU', NS: 'IN', BO: 'IB', KS: 'KS', TW: 'TT', SA: 'BZ', MX: 'MM', SI: 'SP', SS: 'CH', SZ: 'CH', JO: 'SJ' };
  const tkr = s => {   // -> [terminal ticker, yellow key]
    if (BB[s]) return [BB[s], 'Index'];
    if (FUTBB[s]) return FUTBB[s];
    let m;
    if ((m = s.match(/^([A-Z]{3,6})=X$/))) return [m[1].length === 3 ? 'USD' + m[1] : m[1], 'Curncy'];
    if ((m = s.match(/^([A-Z0-9]+)-USD$/))) return [(m[1] === 'BTC' ? 'XBT' : m[1]) + 'USD', 'Curncy'];
    if ((m = s.match(/^([A-Z]+)=F$/))) return [m[1] + '1', 'Comdty'];
    if (s[0] === '^') return [s.slice(1), 'Index'];
    if ((m = s.match(/^(.+)\.([A-Z]{1,2})$/)) && EXR[m[2]]) return [(m[2] === 'HK' ? m[1].replace(/^0+(?=\d)/, '') : m[1]) + ' ' + EXR[m[2]], 'Equity'];
    return [s.replace('-', '/') + ' US', 'Equity'];
  };
  const nameOf = s => tkr(s).join(' ');
  const short = s => tkr(s)[0];
  const BBR = Object.fromEntries(Object.entries(BB).map(([k, v]) => [v, k]));
  const FUTR = Object.fromEntries(Object.entries(FUTBB).map(([k, v]) => [v[0], k]));
  const EXY = Object.assign(Object.fromEntries(Object.entries(EXR).map(([k, v]) => [v, '.' + k])), { US: '', UN: '', UW: '', UQ: '', UA: '', GR: '.DE', JP: '.T', CT: '.TO', LI: '.L', CH: '.SS' });
  const YK = /\s+(EQUITY|INDEX|COMDTY|CURNCY|CORP|GOVT|CRYPTO|MTGE|MUNI|PFD)$/;
  const toY = raw => {   // what the terminal's command line accepts -> the data symbol
    let t = String(raw).trim().toUpperCase(); const yk = (t.match(YK) || [])[1]; t = t.replace(YK, '').trim();
    if (/[=^]|-USD$/.test(t) || /^[A-Z0-9-]+\.[A-Z]{1,2}$/.test(t) && !/^[A-Z]{1,4}\.[AB]$/.test(t)) return t;   // already a data symbol (EURUSD=X, ^GSPC, BTC-USD, VOD.L)
    if (BBR[t] && (!yk || yk === 'INDEX')) return BBR[t];
    if (FUTR[t]) return FUTR[t];
    const cm = t.match(/^(XBT|BTC|ETH|SOL|XRP|DOGE|ADA)(USD)?$/);
    if (cm && (yk === 'CURNCY' || cm[2] || cm[1] === 'XBT')) return (cm[1] === 'XBT' ? 'BTC' : cm[1]) + '-USD';
    if (yk === 'CURNCY' || /^(EUR|GBP|AUD|NZD|USD)[A-Z]{3}$/.test(t)) return (t.length === 6 && t.startsWith('USD') ? t.slice(3) : t) + '=X';
    const p = t.split(/\s+/);
    if (p.length === 2 && EXY[p[1]] != null) return (p[1] === 'HK' ? p[0].padStart(4, '0') : p[0]).replace(/[/.]/, '-') + EXY[p[1]];
    return t.replace(/[/.]/, '-').replace(/\s+/g, '');
  };

  // ------------------------------------------------------------------ live prices: CNBC's public quote and chart services (no key; any web page may ask)
  const CQ = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1&symbols=';
  const CC = 'https://ts-api.cnbc.com/harmony/app/charts/';
  const CIDX = { '^GSPC': '.SPX', '^TNX': 'US10Y', '^FVX': 'US5Y', '^TYX': 'US30Y', '^IRX': 'US3M', 'DX-Y.NYB': '.DXY', 'FTSEMIB.MI': '.FTMIB', '000001.SS': '.SSEC',
    US1M: 'US1M', US6M: 'US6M', US1Y: 'US1Y', US2Y: 'US2Y', US7Y: 'US7Y', US20Y: 'US20Y', DE10Y: 'DE10Y', GB10Y: 'GB10Y', JP10Y: 'JP10Y' };
  const CFUT = { BZ: 'LCO', ES: 'SP', NQ: 'ND', YM: 'DJ', RTY: 'TFS', ZN: 'TY', ZB: 'US', ZF: 'FV', ZT: 'TU', ZC: 'C', ZS: 'S', ZW: 'W', LE: 'LC', HE: 'LH' };
  const CEX = { L: 'GB', DE: 'DE', PA: 'FR', AS: 'NL', SW: 'CH', MI: 'IT', MC: 'ES', ST: 'SE', CO: 'DK', OL: 'NO', HE: 'FI', BR: 'BE', T: 'JP', HK: 'HK', TO: 'CA', AX: 'AU',
    NS: 'IN', TW: 'TW', SA: 'BR', MX: 'MX', SI: 'SG' };
  const cnbcSym = s => {
    if (CIDX[s]) return CIDX[s];
    let m;
    if ((m = s.match(/^([A-Z]+)=F$/))) return '@' + (CFUT[m[1]] || m[1]) + '.1';
    if ((m = s.match(/^([A-Z0-9]+)-USD$/))) return m[1] + '.CM=';
    if ((m = s.match(/^([A-Z]{3})USD=X$/)) || (m = s.match(/^([A-Z]{3})=X$/)) || (m = s.match(/^([A-Z]{6})=X$/))) return m[1] + '=';
    if (s[0] === '^') return '.' + s.slice(1);
    if ((m = s.match(/^([A-Z0-9-]+)\.([A-Z]{1,2})$/))) return CEX[m[2]] ? m[1].replace(/^0+(?=\d)/, '') + '-' + CEX[m[2]] : null;
    if (/^[A-Z]{1,5}(-[A-Z])?$/.test(s)) return s.replace('-', '.');
    return null;
  };
  const h24 = c => /=$|^@|^US\d|^[A-Z]{2}10Y$/.test(c || '');          // FX, crypto, futures, yields: around the clock
  const usEq = c => /^[A-Z]{1,5}(\.[A-Z])?$/.test(c || '');               // a US stock or fund (pre / post market in CNBC's 1-day bars)
  const num = v => { if (v == null || v === '') return null; if (v === 'UNCH') return 0; const x = parseFloat(String(v).replace(/[,%+]/g, '')); return isFinite(x) ? x : null; };
  const unit = v => { const m = String(v || '').replace(/,/g, '').match(/^(-?[\d.]+)([KMBT])?$/); return m ? parseFloat(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2]] || 1) : null; };
  const tparse = s => { s = String(s || ''); if (s.length <= 10) return null; const d = Date.parse(s.replace(/([+-]\d\d)(\d\d)$/, '$1:$2')); return isFinite(d) ? d / 1000 : null; };
  const mdyParse = s => { const m = String(s || '').match(/^(\d\d)\/(\d\d)\/(\d{2,4})$/); return m ? new Date(+m[3] < 100 ? 2000 + +m[3] : +m[3], m[1] - 1, +m[2]) / 1000 : null; };
  const LQ = {};
  let liveAt = 0;
  const fromC = c => {
    const p = num(c.last), ch = num(c.change), pcl = num(c.previous_day_closing);
    // CNBC's own change and percent, unless they disagree with each other (US30Y) or the previous close is really today's (.RUT at the weekend)
    const fits = ok(pcl) && pcl && ok(p) && (!ok(ch) || Math.abs(p - ch - pcl) <= Math.max(.02, Math.abs(p) * 5e-4));
    const prev = fits ? pcl : ok(p) && ok(ch) ? p - ch : null, chg = ok(ch) ? ch : ok(p) && ok(prev) ? p - prev : null;
    let cp = num(c.change_pct); if (!ok(cp) || ok(chg) && chg * cp < 0 || chg === 0 && cp !== 0) cp = ok(chg) && ok(prev) && prev ? chg / prev * 100 : null;
    const t = tparse(c.last_time), dOnly = !t && /^\d{4}-\d\d-\d\d$/.test(c.last_time || '');
    const ev = c.EventData || {}, x = c.ExtendedMktQuote;
    const o = { regularMarketPrice: p, regularMarketChange: chg, regularMarketChangePercent: cp,
      regularMarketPreviousClose: prev, regularMarketOpen: num(c.open), regularMarketDayHigh: num(c.high), regularMarketDayLow: num(c.low), regularMarketVolume: num(c.volume),
      regularMarketTime: t || (dOnly ? Date.parse(c.last_time + 'T21:00:00Z') / 1000 : null), _dateOnly: dOnly || null,
      marketState: c.curmktstatus === 'REG_MKT' ? 'REGULAR' : c.curmktstatus === 'POST_MKT' ? 'POST' : c.curmktstatus === 'PRE_MKT' ? 'PRE' : 'CLOSED',
      cName: c.name || null, trailingPE: num(c.pe), forwardPE: num(c.fpe), epsTrailingTwelveMonths: num(c.eps), beta: num(c.beta), dividendYield: num(c.dividendyield),
      marketCap: unit(c.mktcapView), sharesOutstanding: unit(c.sharesout), fiftyTwoWeekHigh: num(c.yrhiprice), fiftyTwoWeekLow: num(c.yrloprice), avgVol10: unit(c.tendayavgvol),
      currency: c.currencyCode || null, fullExchangeName: c.exchange || null, nextEarn: mdyParse(ev.next_earnings_date), exDiv: mdyParse(ev.div_ex_date), divAmt: num(ev.div_amount),
      _dp: (String(c.last || '').replace(/[%,]/g, '').split('.')[1] || '').length, _live: Date.now() };
    if (x && num(x.last) != null && x.type && x.type !== 'REG_MKT') o.ext = { type: x.type === 'POST_MKT' ? 'After hours' : 'Pre-market', p: num(x.last), c: num(x.change), cp: num(x.change_pct) };
    Object.keys(o).forEach(k => { if (o[k] == null) delete o[k]; });
    return o;
  };
  async function liveQuotes(syms) {
    const map = {}; syms.forEach(s => { const c = cnbcSym(s); if (c) (map[c] = map[c] || []).push(s); });
    const cs = Object.keys(map), out = {};
    for (let i = 0; i < cs.length; i += 40) {
      const r = await fetch(CQ + encodeURIComponent(cs.slice(i, i + 40).join('|')), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json(); let l = d && d.FormattedQuoteResult && d.FormattedQuoteResult.FormattedQuote; if (!l) continue; if (!Array.isArray(l)) l = [l];
      l.forEach(c => { if (c && String(c.code) === '0' && c.last != null) (map[c.symbol] || []).forEach(s => { out[s] = LQ[s] = fromC(c); }); });
    }
    if (cs.length) liveAt = Date.now();
    return out;
  }
  const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  async function quotes(syms) {
    syms = [...new Set(syms.filter(Boolean))]; const out = {}; if (!syms.length) return out;
    if (!STATIC) { for (let i = 0; i < syms.length; i += 40) { const d = await api('quote', { s: syms.slice(i, i + 40).join(',') }); (d || []).forEach(q => { out[q.symbol] = q; }); } return out; }
    const [snap, live] = await Promise.all([sapi('quote', { s: syms.join(',') }).catch(() => []), within(liveQuotes(syms), 6000).catch(() => ({}))]);
    const sm = {}; snap.forEach(q => { sm[q.symbol] = q; });
    syms.forEach(s => { const a = sm[s], b = live[s] || LQ[s]; if (a || b) out[s] = Object.assign({ symbol: s }, a, b); });
    return out;
  }
  const sparks = syms => api('spark', { s: syms.join(','), range: '1d', interval: '5m' }).catch(() => ({}));
  let YTD = null;
  const ytd = async () => { if (YTD) return YTD; try { YTD = STATIC ? await getJ('hist/_ytd.json', 6 * 3600e3) : {}; } catch (e) { YTD = {}; } return YTD; };

  // ------------------------------------------------------------------ formatting (the terminal's: no thousands separators, +.34%, MM/DD/YY)
  const p2 = n => String(n).padStart(2, '0');
  const dz = s => s.replace(/^([+-]?)0\./, '$1.');
  const dpOf = (v, q) => q && q._dp != null && q._dp <= 5 ? q._dp : !ok(v) ? 2 : Math.abs(v) >= 1 ? 2 : 4;
  const px = (v, q) => ok(v) ? v.toFixed(dpOf(v, q)) : '--';
  const sg = (v, d) => !ok(v) ? '--' : v === 0 ? (0).toFixed(d) : dz((v > 0 ? '+' : '-') + Math.abs(v).toFixed(d));
  const pc = v => ok(v) ? sg(v, 2) + '%' : '--';
  const cls = v => !ok(v) || v === 0 ? '' : v > 0 ? 'up' : 'dn';
  const big = v => { if (!ok(v)) return '--'; const a = Math.abs(v); return a >= 1e12 ? (v / 1e12).toFixed(3) + 'TRN' : a >= 1e9 ? (v / 1e9).toFixed(2) + 'BLN' : a >= 1e6 ? (v / 1e6).toFixed(2) + 'MLN' : String(Math.round(v)); };
  const mdy = d => p2(d.getMonth() + 1) + '/' + p2(d.getDate()) + '/' + p2(d.getFullYear() % 100);
  const md = d => p2(d.getMonth() + 1) + '/' + p2(d.getDate());
  const hm = d => p2(d.getHours()) + ':' + p2(d.getMinutes());
  const today = d => d.toDateString() === new Date().toDateString();
  const tcell = q => { const t = q && q.regularMarketTime; if (!t) return '--'; const d = new Date(t * 1000); return today(d) && !q._dateOnly ? hm(d) : md(d); };
  const sfx = q => {   // y: yesterday's close, c: today's close (nothing while it trades, or around the clock)
    if (!q || !q.regularMarketTime || h24(cnbcSym(q.symbol || ''))) return '';
    const d = new Date(q.regularMarketTime * 1000);
    if (!today(d)) return 'y';
    return q._dateOnly || q.marketState === 'POST' || q.marketState === 'CLOSED' ? 'c' : '';
  };
  const ago = t => { const s = Date.now() / 1000 - t; return s < 3600 ? Math.max(1, Math.round(s / 60)) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago' : md(new Date(t * 1000)); };
  const nice = r => { const e = Math.pow(10, Math.floor(Math.log10(r))), f = r / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; };
  const toast = msg => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); };
  const spark = (pts, ref) => {
    if (!pts || pts.length < 2) return '';
    const v = pts.map(p => p[1]).concat(ok(ref) ? [ref] : []), lo = Math.min(...v), hi = Math.max(...v), W = 120, H = 30;
    const y = x => (H - 2 - (x - lo) / ((hi - lo) || 1) * (H - 4)).toFixed(1), last = pts[pts.length - 1][1], col = ok(ref) && last < ref ? '#ff5470' : '#64e57d';
    const line = pts.map((p, i) => (i / (pts.length - 1) * W).toFixed(1) + ',' + y(p[1])).join(' ');
    return `${ok(ref) ? `<line x1="0" x2="${W}" y1="${y(ref)}" y2="${y(ref)}" stroke="#6a5435" stroke-dasharray="3 3" stroke-width="1" vector-effect="non-scaling-stroke"/>` : ''}<polygon points="0,${H} ${line} ${W},${H}" fill="#0b2643"/><polyline points="${line}" fill="none" stroke="${col}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
  };

  // ------------------------------------------------------------------ the KLTN terminal on the host PC (static build)
  const PC = { url: '', on: !STATIC, at: 0, busy: null };
  async function pcCheck(force) {
    if (!STATIC) return PC;
    if (PC.busy) return PC.busy;
    if (!force && Date.now() - PC.at < 60e3) return PC;
    PC.busy = (async () => {
      try {
        const r = await within(fetch(TUNNEL + (TUNNEL.includes('?') ? '&' : '?') + 't=' + Math.floor(Date.now() / 30e3), { cache: 'no-store' }), 6000);
        const t = r.ok ? await r.json() : null, u = t && t.url;
        if (!u || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$|^http:\/\/127\.0\.0\.1:\d+$/.test(u)) { PC.on = false; PC.url = ''; }
        else { const d = await within(fetch(u + '/api/ping', { cache: 'no-store' }).then(x => x.json()), 7000); PC.on = !!(d && d.ok); PC.url = PC.on ? u : ''; }
      } catch (e) { PC.on = false; }
      PC.at = Date.now(); PC.busy = null; paintPC(); return PC;
    })();
    return PC.busy;
  }
  const pcText = () => !STATIC ? ['Full terminal', 'Running on a KLTN server: every function opens full screen.']
    : PC.on ? ['Full terminal online', 'Every KLTN function opens from here (FA, ECO, OMON, IB ...). Sign in with your KLTN login the first time.']
      : ['Full terminal offline', 'Markets, quotes, charts and news here stay live. Deeper functions open while the KLTN host PC is on, or in the free desktop app.'];
  const pcCard = () => { const [b, s] = pcText(); return `<div class="pcc ${PC.on ? 'on' : ''}" data-pcc="1"><span class="d"></span><div><b>${b}</b><span>${s}</span></div></div>`; };
  function paintPC() {
    document.querySelectorAll('[data-pcc]').forEach(el => { const [b, s] = pcText(); el.classList.toggle('on', PC.on); el.querySelector('b').textContent = b; el.querySelector('span:not(.d)').textContent = s; });
    document.querySelectorAll('.fb button.pc').forEach(b => b.classList.toggle('live', PC.on));
    document.querySelectorAll('[data-pcdot]').forEach(b => b.textContent = PC.on ? 'on PC' : 'PC off');
  }
  const openUrl = url => { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove(); };
  function sheet(html) {
    const sh = document.createElement('div'); sh.className = 'sheet';
    sh.innerHTML = `<div class="sh-b"><div class="grab"></div>${html}</div>`;
    sh.onclick = e => { if (e.target === sh || e.target.closest('[data-x]')) sh.remove(); };
    document.body.appendChild(sh); return sh;
  }
  function run(cmd) {   // any terminal function
    const code = cmd.split(/\s+/).pop(), nm = FNNAME[code] || '';
    if (!STATIC) return frame(cmd);
    if (PC.on && PC.url && Date.now() - PC.at < 120e3) { openUrl(PC.url + '/?pop=' + encodeURIComponent(cmd) + '&m=1'); return; }
    const sh = sheet(`<h3><b>${esc(code)}</b> ${esc(nm)}</h3><p data-msg>Checking the KLTN terminal&hellip;</p><div class="sh-a"><button type="button" class="pri" data-open hidden>Open ${esc(code)}</button><a href="${DESKTOP}" target="_blank" rel="noopener">Get the desktop app (free)</a><button type="button" data-x>Close</button></div>`);
    pcCheck(true).then(() => {
      if (!sh.isConnected) return;
      const b = sh.querySelector('[data-open]'), m = sh.querySelector('[data-msg]');
      if (PC.on) { m.textContent = (cmd !== code ? cmd + ' runs' : 'This function runs') + ' on the full KLTN terminal. Sign in with your KLTN login the first time.'; b.hidden = false; b.onclick = () => { sh.remove(); openUrl(PC.url + '/?pop=' + encodeURIComponent(cmd) + '&m=1'); }; }
      else m.textContent = (cmd !== code ? cmd : code) + ' runs on the full KLTN terminal, and the KLTN host PC is offline right now. It is in the free desktop app for Windows and Mac, with all 176 functions. Markets, quotes, charts and news here stay live.';
    });
  }
  function frame(cmd) {   // KLTN server: the screen full size in a one-panel terminal frame (pop-out mode never writes the saved layout)
    const box = document.createElement('div'); box.className = 'fullv';
    box.innerHTML = `<div class="fv-h"><button type="button" class="back">${BACK}<span>Back</span></button><b>${esc(cmd)}</b></div><iframe src="/?pop=${encodeURIComponent(cmd)}&m=1" title="${esc(cmd)}"></iframe>`;
    box.querySelector('button').onclick = () => box.remove();
    document.body.appendChild(box);
  }

  // ------------------------------------------------------------------ navigation: tab bar roots, a back stack inside each
  const ROOTS = ['home', 'search', 'monitor', 'news', 'menu'];
  let stack = [], gen = 0, timers = [], refresh = null, curSec = null;
  const alive = g => g === gen;
  const every = (g, ms, f) => { refresh = f; timers.push(setInterval(() => { if (!document.hidden && alive(g)) f(); }, ms)); };
  function go(v, arg, push) {
    if (!push || !stack.length) stack = [];
    if (ROOTS.includes(v) && !push) stack = [];
    stack.push({ v, arg, title: '' }); render();
  }
  function back() { if (stack.length > 1) { stack.pop(); render(); } else go('home'); }
  function render() {
    const cur = stack[stack.length - 1]; gen++; timers.forEach(clearInterval); timers = []; refresh = null;
    document.querySelectorAll('#tb button').forEach(b => b.classList.toggle('on', b.dataset.v === stack[0].v));
    const prev = stack[stack.length - 2];
    $('nbl').innerHTML = prev ? `<button class="back" type="button">${BACK}<span>${esc(prev.title || 'Back')}</span></button>` : '<span class="logo"><i>K</i>KLTN</span>';
    if (prev) $('nbl').querySelector('button').onclick = back;
    $('nbr').innerHTML = ''; mv.scrollTop = 0; mv.innerHTML = '<div class="empty">Retrieving data&hellip;</div>';
    try { history.replaceState(null, '', '#' + cur.v + (cur.arg ? '/' + encodeURIComponent(cur.arg) : '')); } catch (e) { }
    const g = gen;
    (VIEWS[cur.v] || VIEWS.home)(cur.arg, g).catch(e => { if (alive(g) && !needLogin) mv.innerHTML = `<div class="empty">${esc(e.message || e)}</div>`; });
  }
  const title = t => { $('nbt').textContent = t; stack[stack.length - 1].title = t; };
  const liveTag = () => `<span class="lv" id="lv"><b></b><span>Live</span></span>`;
  const paintLive = () => { const el = $('lv'); if (!el) return; const on = STATIC ? Date.now() - liveAt < 25e3 : Date.now() - srvAt < 60e3; el.classList.toggle('on', on); el.lastChild.textContent = on ? 'Live' : 'Delayed'; };
  setInterval(paintLive, 2000);
  document.querySelectorAll('#tb button').forEach(b => b.onclick = () => go(b.dataset.v));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && refresh) refresh(); });
  const sh = (t, link, more, sub) => `<div class="sh"><h2>${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ''}</h2>${link ? `<button class="more" type="button" data-go="${esc(link)}">${esc(more || 'More')} ${CHEV}</button>` : ''}</div>`;
  const bind = root => {
    root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { const [v, a] = b.dataset.go.split(':'); go(v, a, !ROOTS.includes(v)); });
    root.querySelectorAll('[data-s]').forEach(el => el.onclick = () => openSec(el.dataset.s));
  };
  const openSec = s => { curSec = s; addRecent(s); go('sec', s, true); };
  const foot = () => `<div class="ft">Prices: CNBC (real time where exchanges allow, otherwise delayed)${STATIC ? '; names, history and headlines refresh every 15 minutes' : ''}. For research only, not investment advice.</div>`;

  // ------------------------------------------------------------------ monitor tables (frozen first column; cells flash green / red on every tick)
  const dpc = q => dpOf(q && q.regularMarketPrice, q);
  const C = {
    p: { h: 'Last', v: q => px(q.regularMarketPrice, q) + (sfx(q) ? `<span class="sx">${sfx(q)}</span>` : ''), c: q => cls(q.regularMarketChange), cl: 'p', tick: 1 },
    y: { h: 'Yield', v: q => px(q.regularMarketPrice, q), c: q => cls(q.regularMarketChange), cl: 'p', tick: 1 },
    c: { h: 'Net Chg', v: q => sg(q.regularMarketChange, dpc(q)), c: q => cls(q.regularMarketChange), tick: 1 },
    bp: { h: 'Chg (bp)', v: q => ok(q.regularMarketChange) ? sg(q.regularMarketChange * 100, 1) : '--', c: q => cls(q.regularMarketChange), tick: 1 },
    cp: { h: '%Chg', v: q => pc(q.regularMarketChangePercent), c: q => cls(q.regularMarketChangePercent), tick: 1 },
    t: { h: 'Time', v: q => tcell(q), cl: 't' },
    ytd: { h: '%Ytd', v: (q, s) => ok(YTD && YTD[s]) && ok(q.regularMarketPrice) ? pc((q.regularMarketPrice / YTD[s] - 1) * 100) : '--', c: (q, s) => ok(YTD && YTD[s]) ? cls(q.regularMarketPrice - YTD[s]) : '' },
    nytd: { h: 'Net YTD', v: (q, s) => ok(YTD && YTD[s]) && ok(q.regularMarketPrice) ? sg(q.regularMarketPrice - YTD[s], dpc(q)) : '--', c: (q, s) => ok(YTD && YTD[s]) ? cls(q.regularMarketPrice - YTD[s]) : '' },
    h: { h: 'High', v: q => px(q.regularMarketDayHigh, q), cl: 'x' },
    l: { h: 'Low', v: q => px(q.regularMarketDayLow, q), cl: 'x' },
    vol: { h: 'Volume', v: q => big(q.regularMarketVolume), cl: 'x' },
  };
  const table = (head, groups, cols, names) => `<div class="tw"><table class="bt"><thead><tr><th>${esc(head)}<i>i</i></th>${cols.map((k, i) => `<th>${C[k].h}${i === 0 ? '<i>i</i>' : ''}</th>`).join('')}</tr></thead><tbody>` +
    groups.map(([g, rows]) => (g ? `<tr class="rg"><td colspan="${cols.length + 1}">${esc(g)}</td></tr>` : '') + rows.map(([s, n]) => `<tr data-s="${esc(s)}"><td>${esc(names ? (n || short(s)) : short(s))}${names && n ? `<small>${esc(short(s))}</small>` : ''}</td>${cols.map(k => `<td data-c="${k}" class="${C[k].cl || ''}">--</td>`).join('')}</tr>`).join('')).join('') + '</tbody></table></div>';
  const paint = (root, Q) => root.querySelectorAll('tr[data-s]').forEach(tr => {
    const s = tr.dataset.s, q = Q[s]; if (!q) return;
    const p = q.regularMarketPrice, was = tr._p, dir = ok(p) && ok(was) && p !== was ? (p > was ? 1 : -1) : 0;
    if (ok(p)) tr._p = p; if (dir) tr._dir = dir;
    tr.querySelectorAll('td[data-c]').forEach(td => {
      const col = C[td.dataset.c]; let h = col.v(q, s);
      if (col.cl === 'p' && tr._dir) h = `<span class="ar">${tr._dir > 0 ? '&uarr;' : '&darr;'}</span>` + h;
      if (td._v === h) return;
      const first = td._v === undefined; td._v = h; td.innerHTML = h;
      td.className = [col.cl || '', col.c ? col.c(q, s) : ''].join(' ').trim();
      if (!first && dir && col.tick) { td.classList.add(dir > 0 ? 'fu' : 'fd'); setTimeout(() => td.classList.remove('fu', 'fd'), 900); }
    });
  });
  const flashEl = (el, txt, dir) => { if (!el || el.textContent === txt) return; const first = !el.textContent || el.textContent === '--'; el.textContent = txt; if (!first && dir) { el.classList.add(dir > 0 ? 'fu' : 'fd'); setTimeout(() => el.classList.remove('fu', 'fd'), 900); } };

  // ------------------------------------------------------------------ views
  const VIEWS = {};
  const CARDS = [['^GSPC', 'S&P 500'], ['^DJI', 'Dow Jones'], ['^IXIC', 'Nasdaq'], ['^TNX', 'US 10Y Yield'], ['CL=F', 'WTI Crude'], ['GC=F', 'Gold'], ['BTC-USD', 'Bitcoin'], ['EURUSD=X', 'EUR/USD'], ['^VIX', 'VIX']];
  const HOME_IDX = ['^DJI', '^GSPC', '^IXIC', '^RUT', '^FTSE', '^GDAXI', '^N225', '^HSI'].map(s => [s]);
  let moverTab = 'g';
  VIEWS.home = async (a, g) => {
    title('Home'); $('nbr').innerHTML = liveTag(); paintLive();
    mv.innerHTML = `<div class="cards">${CARDS.map(([s, n]) => `<div class="card" data-s="${s}"><div class="cn">${esc(n)}</div><div class="cv">--</div><div class="cc">&nbsp;</div><svg viewBox="0 0 120 30" preserveAspectRatio="none"></svg></div>`).join('')}</div>` +
      sh('Need to Know', 'news', 'News') + '<div class="nl" id="hn"><div class="empty">Retrieving headlines&hellip;</div></div>' +
      sh('World Equity Indices', 'mkt:WEI') + `<div id="hw">${table('Index', [['', HOME_IDX]], ['p', 'c', 'cp', 't'])}</div>` +
      sh('Movers', null, null, 'US stocks over $2B') + `<div class="ut in" id="hmt"><button type="button" data-m="g" class="${moverTab === 'g' ? 'on' : ''}">Gainers</button><button type="button" data-m="l" class="${moverTab === 'l' ? 'on' : ''}">Losers</button></div><div id="hm"></div>` +
      pcCard() + foot();
    bind(mv); pcCheck();
    let movers = { g: [], l: [] }, sp = {};
    const syms = () => CARDS.map(c => c[0]).concat(HOME_IDX.map(r => r[0]), movers[moverTab].map(x => x.symbol));
    const drawMovers = () => {
      const l = movers[moverTab]; $('hm').innerHTML = l.length ? table('Security', [['', l.slice(0, 8).map(x => [x.symbol, x.shortName || x.longName])]], ['p', 'c', 'cp', 'vol'], true) : '<div class="empty">No movers right now.</div>';
      bind($('hm'));
    };
    mv.querySelectorAll('#hmt button').forEach(b => b.onclick = () => { moverTab = b.dataset.m; mv.querySelectorAll('#hmt button').forEach(x => x.classList.toggle('on', x === b)); drawMovers(); tick(); });
    const tick = async () => {
      const Q = await quotes(syms()); if (!alive(g)) return;
      CARDS.forEach(([s]) => {
        const q = Q[s], el = mv.querySelector(`.card[data-s="${CSS.escape(s)}"]`); if (!q || !el) return;
        const was = el._p, p = q.regularMarketPrice; flashEl(el.querySelector('.cv'), px(p, q), ok(was) && ok(p) && p !== was ? (p > was ? 1 : -1) : 0); if (ok(p)) el._p = p;
        const cc = el.querySelector('.cc'); cc.className = 'cc ' + cls(q.regularMarketChange); cc.textContent = sg(q.regularMarketChange, dpc(q)) + '  ' + pc(q.regularMarketChangePercent);
        const pts = (sp[s] || []).slice(); if (ok(p) && q._live) pts.push([Date.now() / 1000, p]);
        el.querySelector('svg').innerHTML = spark(pts, q.regularMarketPreviousClose);
      });
      paint($('hw'), Q); paint($('hm'), Q); paintLive();
    };
    const slow = async () => {
      const [s2, nw, gn, lo] = await Promise.all([sparks(CARDS.map(c => c[0])), api('topnews', { since: 0, limit: 12 }).catch(() => ({ items: [] })),
        api('screener', { id: 'day_gainers', count: 8 }).catch(() => []), api('screener', { id: 'day_losers', count: 8 }).catch(() => [])]);
      if (!alive(g)) return;
      sp = s2 || {}; movers = { g: gn || [], l: lo || [] };
      $('hn').innerHTML = newsRows((nw.items || []).slice(0, 6), true); drawMovers();
    };
    await Promise.all([tick(), slow()]); await tick();
    every(g, STATIC ? 5000 : 15000, tick); timers.push(setInterval(() => { if (!document.hidden && alive(g)) slow().catch(() => { }); }, 120e3));
  };

  // market monitors (WEI, WEIF, currencies, government bonds, commodities, crypto)
  const MK = {
    WEI: { t: 'World Equity Indices', head: 'Index', cols: ['p', 'c', 'cp', 't', 'ytd', 'nytd'], tabs: ['Standard', 'Americas', 'EMEA', 'Asia/Pacific'], groups: {
      Americas: ['^DJI', '^GSPC', '^IXIC', '^NDX', '^RUT', '^GSPTSE', '^MXX', '^BVSP'], EMEA: ['^STOXX50E', '^FTSE', '^GDAXI', '^FCHI', '^IBEX', 'FTSEMIB.MI', '^AEX', '^SSMI'],
      'Asia/Pacific': ['^N225', '^HSI', '000001.SS', '000300.SS', '^KS11', '^TWII', '^AXJO', '^NSEI', '^STI'] } },
    WEIF: { t: 'World Index Futures', head: 'Future', cols: ['p', 'c', 'cp', 't', 'h', 'l'], names: true, groups: {
      'Equity Index': [['ES=F', 'S&P 500 E-mini'], ['NQ=F', 'Nasdaq 100 E-mini'], ['YM=F', 'Dow E-mini'], ['RTY=F', 'Russell 2000 E-mini']], Volatility: [['VX=F', 'VIX Futures']],
      'US Rates': [['ZT=F', '2Y T-Note'], ['ZF=F', '5Y T-Note'], ['ZN=F', '10Y T-Note'], ['ZB=F', '30Y T-Bond']] } },
    FX: { t: 'Currencies', head: 'Currency', cols: ['p', 'c', 'cp', 't', 'ytd'], groups: {
      Majors: ['EURUSD=X', 'JPY=X', 'GBPUSD=X', 'CHF=X', 'AUDUSD=X', 'CAD=X', 'NZDUSD=X'], Crosses: ['EURJPY=X', 'EURGBP=X', 'GBPJPY=X'],
      'Emerging & Asia': ['CNY=X', 'HKD=X', 'INR=X', 'KRW=X', 'MXN=X', 'BRL=X'], Nordic: ['SEK=X', 'NOK=X'], Index: ['DX-Y.NYB'] } },
    GOVT: { t: 'Government Bonds', head: 'Security', cols: ['y', 'bp', 't'], names: true, groups: {
      'US Treasuries': [['US1M', 'US 1 Month'], ['^IRX', 'US 3 Month'], ['US6M', 'US 6 Month'], ['US1Y', 'US 1 Year'], ['US2Y', 'US 2 Year'], ['^FVX', 'US 5 Year'], ['US7Y', 'US 7 Year'],
        ['^TNX', 'US 10 Year'], ['US20Y', 'US 20 Year'], ['^TYX', 'US 30 Year']], 'International 10 Year': [['DE10Y', 'Germany 10 Year'], ['GB10Y', 'UK 10 Year'], ['JP10Y', 'Japan 10 Year']] } },
    CMDTY: { t: 'Commodities', head: 'Commodity', cols: ['p', 'c', 'cp', 't', 'h', 'l'], names: true, groups: {
      Energy: [['CL=F', 'WTI Crude'], ['BZ=F', 'Brent Crude'], ['NG=F', 'Natural Gas'], ['HO=F', 'Heating Oil'], ['RB=F', 'RBOB Gasoline']],
      Metals: [['GC=F', 'Gold'], ['SI=F', 'Silver'], ['HG=F', 'Copper'], ['PL=F', 'Platinum']],
      Agriculture: [['ZC=F', 'Corn'], ['ZS=F', 'Soybeans'], ['ZW=F', 'Wheat'], ['KC=F', 'Coffee'], ['SB=F', 'Sugar'], ['CC=F', 'Cocoa'], ['CT=F', 'Cotton'], ['LE=F', 'Live Cattle']] } },
    CRYPTO: { t: 'Crypto Currencies', head: 'Currency', cols: ['p', 'c', 'cp', 't'], names: true, groups: {
      '': [['BTC-USD', 'Bitcoin'], ['ETH-USD', 'Ether'], ['SOL-USD', 'Solana'], ['XRP-USD', 'XRP'], ['DOGE-USD', 'Dogecoin'], ['ADA-USD', 'Cardano']] } },
  };
  const mkTab = {};
  VIEWS.mkt = async (k, g) => {
    const m = MK[k] || MK.WEI; k = MK[k] ? k : 'WEI'; title(m.t); $('nbr').innerHTML = liveTag(); paintLive();
    const tabs = m.tabs || (Object.keys(m.groups).length > 1 ? ['All'].concat(Object.keys(m.groups)) : null);
    const cur = mkTab[k] || (tabs ? tabs[0] : '');
    const gs = Object.entries(m.groups).filter(([n]) => !tabs || cur === tabs[0] || n === cur).map(([n, rows]) => [n, rows.map(r => Array.isArray(r) ? r : [r])]);
    if (m.cols.includes('ytd') || m.cols.includes('nytd')) await ytd();
    if (!alive(g)) return;
    mv.innerHTML = (tabs ? `<div class="ut">${tabs.map(t => `<button type="button" data-t="${esc(t)}" class="${t === cur ? 'on' : ''}">${esc(t)}</button>`).join('')}</div>` : '') + table(m.head, gs, m.cols, m.names) + foot();
    mv.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { mkTab[k] = b.dataset.t; render(); });
    bind(mv);
    const syms = gs.flatMap(([, rows]) => rows.map(r => r[0]));
    const tick = async () => { const Q = await quotes(syms); if (alive(g)) { paint(mv, Q); paintLive(); } };
    await tick(); every(g, STATIC ? 5000 : 15000, tick);
  };

  // monitor (watchlist kept on this phone)
  const WKEY = 'kltnAnywhereWatch', WDEF = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'SPY', 'QQQ', 'BTC-USD'];
  const wl = () => { const v = ls.get(WKEY, null); return Array.isArray(v) && v.length ? v : WDEF.slice(); };
  const wsave = v => ls.set(WKEY, v);
  let wEdit = false;
  VIEWS.monitor = async (a, g) => {
    title('Monitor');
    $('nbr').innerHTML = `<button class="ib" type="button" data-a="add" aria-label="Add a security"><svg viewBox="0 0 22 22"><path d="M11 4v14M4 11h14" stroke="currentColor" stroke-width="1.8"/></svg></button><button class="ib" type="button" data-a="edit" style="width:auto;padding:0 8px;font-size:16px">${wEdit ? 'Done' : 'Edit'}</button>`;
    $('nbr').querySelector('[data-a=add]').onclick = () => addSec();
    $('nbr').querySelector('[data-a=edit]').onclick = () => { wEdit = !wEdit; render(); };
    const syms = wl();
    if (wEdit) {
      mv.innerHTML = `<div class="tw"><table class="bt"><thead><tr><th>Security</th><th></th></tr></thead><tbody>${syms.map((s, i) => `<tr><td>${esc(short(s))}<small>${esc(nameOf(s).split(' ').pop())}</small></td><td><button class="ed" type="button" data-up="${i}" ${i ? '' : 'disabled'}>&uarr;</button> <button class="ed" type="button" data-x="${esc(s)}">Remove</button></td></tr>`).join('')}</tbody></table></div>`;
      mv.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { wsave(wl().filter(x => x !== b.dataset.x)); render(); });
      mv.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const l = wl(), i = +b.dataset.up; if (i > 0) { [l[i - 1], l[i]] = [l[i], l[i - 1]]; wsave(l); render(); } });
      return;
    }
    mv.innerHTML = table('Security', [['', syms.map(s => [s, (LQ[s] && LQ[s].cName) || ''])]], ['p', 'c', 'cp', 't', 'vol', 'h', 'l'], true) + `<div class="empty">Tap <b>+</b> to add a security, <b>Edit</b> to remove or reorder. Your list stays on this phone.</div>` + foot();
    bind(mv);
    const tick = async () => {
      const Q = await quotes(syms); if (!alive(g)) return;
      mv.querySelectorAll('tr[data-s]').forEach(tr => { const q = Q[tr.dataset.s], sm = tr.querySelector('td small'); if (q && !sm) { const n = q.shortName || q.longName || q.cName; if (n) { tr.firstChild.innerHTML = `${esc(n)}<small>${esc(short(tr.dataset.s))}</small>`; } } });
      paint(mv, Q); paintLive();
    };
    await tick(); every(g, STATIC ? 5000 : 15000, tick);
  };
  function addSec() {
    const s = sheet(`<h3>Add to Monitor</h3><p>Ticker, e.g. NFLX, VOD LN, EURUSD, CL1, XBT</p><form><input type="text" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="Ticker"><div class="sh-a"><button type="submit" class="pri">Add</button><button type="button" data-x>Cancel</button></div></form>`);
    const f = s.querySelector('form'), inp = f.querySelector('input'); setTimeout(() => inp.focus(), 60);
    f.onsubmit = e => { e.preventDefault(); const v = inp.value.trim(); if (!v) return; const y = toY(v), l = wl(); if (!l.includes(y)) { l.push(y); wsave(l); } s.remove(); toast(short(y) + ' added'); if (stack[stack.length - 1].v === 'monitor') render(); };
  }

  // news
  const CATS = ['Top', 'Markets', 'Economy', 'Business', 'Politics', 'World', 'National', 'Tech'];
  let newsCat = 'Top';
  const newsRows = (items, lead) => items.map((x, i) => `<a href="${esc(x.link || '#')}" target="_blank" rel="noopener" class="${lead && i === 0 ? 'top' : ''}"><div class="nt">${esc(x.title)}</div><div class="nm">${x.ts ? `<span>${esc(ago(x.ts))}</span>` : ''}<b>${esc(x.code || '')}</b><span>${esc(x.source || x.feed || '')}</span></div></a>`).join('');
  VIEWS.news = async (a, g) => {
    title('News');
    const draw = async () => {
      const d = await api('topnews', { since: 0, limit: 300 }); if (!alive(g)) return;
      const items = (d.items || []).filter(x => newsCat === 'Top' || (x.cat || '').toLowerCase() === newsCat.toLowerCase()).slice(0, 120);
      const y = mv.scrollTop;
      mv.innerHTML = `<div class="ut">${CATS.map(c => `<button type="button" data-c="${c}" class="${c === newsCat ? 'on' : ''}">${c}</button>`).join('')}</div><div class="nl">${newsRows(items) || '<div class="empty">No stories in this category right now.</div>'}</div>`;
      mv.scrollTop = y;
      mv.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { newsCat = b.dataset.c; mv.scrollTop = 0; draw(); });
    };
    await draw(); every(g, 120e3, () => draw().catch(() => { }));
  };

  // menu: market monitors here, every other function on the full terminal
  const FN = [
    ['Markets', [['WEI', 'World Equity Indices'], ['WEIF', 'World Index Futures'], ['FXC', 'Currencies'], ['WB', 'Government Bonds'], ['GLCO', 'Commodities'], ['CRYP', 'Crypto Currencies'],
      ['GMM', 'Global Macro Movers'], ['FIT', 'Government Bond Monitor'], ['MOST', 'Most Active Securities'], ['OMST', 'Most Active Options'], ['MOV', 'Index Movers'], ['IMAP', 'Intraday Market Map'],
      ['WIRP', 'Rate Probabilities'], ['BTMM', 'Treasury & Money Markets'], ['SWPM', 'Swap Manager'], ['OVML', 'FX Option Valuation'], ['CDS', 'Credit Default Swaps']]],
    ['News & Economy', [['TOP', 'Top News'], ['NI', 'News by Topic'], ['NSE', 'News Search'], ['READ', 'Most Read News'], ['RATC', 'Rating Changes'], ['ECO', 'Economic Calendar'], ['ECST', 'World Economic Statistics'], ['ECSU', 'Economic Surprises'],
      ['CENB', 'Central Bank Monitor'], ['EVTS', 'Events Calendar'], ['BRIEF', 'Morning Brief']]],
    ['Equity (after a ticker)', [['DES', 'Description'], ['GP', 'Price Chart'], ['GIP', 'Intraday Chart'], ['CN', 'Company News'], ['FA', 'Financial Analysis'], ['ANR', 'Analyst Recommendations'],
      ['EE', 'Earnings & Estimates'], ['HDS', 'Holders'], ['OMON', 'Option Monitor'], ['DVD', 'Dividends'], ['RV', 'Relative Valuation'], ['BETA', 'Historical Beta'], ['SI', 'Short Interest'],
      ['CAST', 'Capital Structure'], ['QR', 'Quote Recap'], ['SPLC', 'Supply Chain'], ['ERN', 'Earnings History'], ['COMP', 'Comparative Returns'], ['DCF', 'Discounted Cash Flow'],
      ['WACC', 'Cost of Capital'], ['INSD', 'Insider Transactions'], ['ALLQ', 'All Quotes'], ['RVC', 'Relative Value Chart'], ['EQRV', 'Equity Relative Valuation']]],
    ['Screening & Research', [['EQS', 'Equity Screening'], ['SECF', 'Security Finder'], ['BMAP', 'Maps'], ['CORR', 'Correlation Matrix'], ['MA', 'Mergers & Acquisitions'], ['IPO', 'IPO Monitor'],
      ['KQNT', 'KLTN Quant'], ['LTOP', 'League Tables'], ['LEGI', 'Legislation'], ['COT', 'Commitments of Traders'], ['AGRI', 'Agriculture'], ['SHIP', 'Ships'], ['CHOKE', 'Chokepoints']]],
    ['Workspace', [['PORT', 'Portfolio & Risk'], ['ALRT', 'Alerts'], ['IB', 'Instant Chat'], ['MSG', 'Mail'], ['PEOP', 'People'], ['NOTE', 'Notes'], ['HELP', 'Help']]],
  ];
  const FNNAME = Object.fromEntries(FN.flatMap(g => g[1]));
  const LOCAL = { HOME: ['home'], N: ['news'], TOP: ['news'], NEWS: ['news'], W: ['monitor'], MON: ['monitor'], MONITOR: ['monitor'], MENU: ['menu'], MAIN: ['menu'], SEARCH: ['search'],
    WEI: ['mkt', 'WEI'], WEIF: ['mkt', 'WEIF'], FXC: ['mkt', 'FX'], WCRS: ['mkt', 'FX'], WCR: ['mkt', 'FX'], WB: ['mkt', 'GOVT'], GLCO: ['mkt', 'CMDTY'], CMDTY: ['mkt', 'CMDTY'], CRYP: ['mkt', 'CRYPTO'] };
  const SECFN = { DES: ['sec'], Q: ['sec'], GP: ['gp', '1Y'], GIP: ['gp', '1D'], CN: ['cn'] };
  VIEWS.menu = async () => {
    title('Menu'); pcCheck();
    mv.innerHTML = pcCard() + FN.map(([gname, list]) => sh(gname) + `<div class="ml">${list.map(([c, l]) => `<button type="button" class="mi" data-f="${c}" style="width:100%;text-align:left"><b>${c}</b><span>${esc(l)}</span>${LOCAL[c] || SECFN[c] ? '' : `<i data-pcdot>${PC.on ? 'on PC' : 'PC off'}</i>`}${CHEV}</button>`).join('')}</div>`).join('') +
      `<div class="empty">Search any ticker or function from <b>Search</b>, e.g. <b>VOD LN</b>, <b>AAPL FA</b>, <b>ECO</b>.</div>` + foot();
    mv.querySelectorAll('[data-f]').forEach(el => el.onclick = () => { const c = el.dataset.f; exec(SECFN[c] || FN[2][1].some(x => x[0] === c) ? nameOf(curSec || 'AAPL') + ' ' + c : c); });
  };

  // search: securities and functions
  const RKEY = 'kltnAnywhereRecent';
  const addRecent = s => { const l = ls.get(RKEY, []).filter(x => x !== s); l.unshift(s); ls.set(RKEY, l.slice(0, 12)); };
  let U = null;
  const loadU = async () => { if (U) return U; try { const r = await fetch(STATIC ? DATA + 'universe.json' : '/data/universe.json'); const d = await r.json(); U = d.securities || []; } catch (e) { U = []; } return U; };
  const KIND = { Equity: 'Equity', ETF: 'ETF', International: 'Equity', Index: 'Index', Crypto: 'Curncy', Future: 'Comdty', Currency: 'Curncy', Fund: 'Fund' };
  VIEWS.search = async (a, g) => {
    title('Search');
    mv.innerHTML = `<form class="sf" id="sff"><label><svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m13 13 5 5" stroke="currentColor" stroke-width="1.7"/></svg><input id="sq" type="search" placeholder="Securities, functions, e.g. AAPL, WEI" autocapitalize="characters" autocorrect="off" autocomplete="off" spellcheck="false" enterkeyhint="go"><button type="button" class="x" id="sqx">Clear</button></label></form><div id="sres"></div>`;
    const inp = $('sq'), res = $('sres');
    if (a) inp.value = a;
    const row = (cmd, b, s2, k, fn) => `<div class="sr ${fn ? 'fn' : ''}" ${fn ? 'data-cmd' : 'data-sec'}="${esc(cmd)}"><div class="a"><b>${esc(b)}</b><span>${esc(s2 || '')}</span></div>${k ? `<span class="${fn ? 'go' : 'k'}">${esc(k)}</span>` : ''}</div>`;
    const draw = async () => {
      const v = inp.value.trim().toUpperCase();
      if (!v) {
        const rec = ls.get(RKEY, []);
        res.innerHTML = (rec.length ? '<div class="sg">Recent</div>' + rec.map(s => /\s/.test(s) || FNNAME[s] || LOCAL[s] ? row(s, s, FNNAME[s.split(' ').pop()] || '', 'GO', true) : row(s, nameOf(s), (LQ[s] && LQ[s].cName) || '', '', false)).join('') : '') +
          '<div class="sg">Popular functions</div>' + ['WEI', 'TOP', 'GLCO', 'FXC', 'WB', 'ECO', 'MOST', 'CRYP'].map(c => row(c, c, FNNAME[c], 'GO', true)).join('');
      } else {
        const toks = v.split(/\s+/), last = toks[toks.length - 1];
        const fr = c => c === last ? 0 : c.startsWith(last) ? 1 : 2;   // exact code, then codes that start with it, then names
        const fhit = Object.keys(FNNAME).filter(c => c.startsWith(last) || (toks.length === 1 && v.length > 1 && FNNAME[c].toUpperCase().includes(v))).sort((x, y) => fr(x) - fr(y)).slice(0, 6);
        const u = await loadU(); const lv = v.toLowerCase();
        const shit = toks.length === 1 ? u.filter(x => x.s.startsWith(v) || short(x.s).startsWith(v) || (x.n || '').toLowerCase().includes(lv)).sort((a2, b) => (b.s === v) - (a2.s === v) || (b.s.startsWith(v)) - (a2.s.startsWith(v)) || (b.mcu || 0) - (a2.mcu || 0)).slice(0, 8) : [];
        const y = toY(v.replace(/\s+[A-Z]{1,5}$/, m => FNNAME[m.trim()] || SECFN[m.trim()] ? '' : m));
        res.innerHTML = (toks.length > 1 ? row(v, v, (FNNAME[last] || 'Open') + ' · ' + nameOf(y), 'GO', true) : '') +
          (shit.length ? '<div class="sg">Securities</div>' + shit.map(x => row(x.s, nameOf(x.s), x.n, KIND[x.c] || x.c || '', false)).join('') : (toks.length === 1 && !FNNAME[v] && !LOCAL[v] ? '<div class="sg">Securities</div>' + row(v, nameOf(toY(v)), 'Open quote', '', false) : '')) +
          (fhit.length ? '<div class="sg">Functions</div>' + fhit.map(c => row(toks.length > 1 ? toks.slice(0, -1).join(' ') + ' ' + c : c, c, FNNAME[c], 'GO', true)).join('') : '');
      }
      res.querySelectorAll('[data-cmd]').forEach(r => r.onclick = () => { inp.blur(); exec(r.dataset.cmd); });
      res.querySelectorAll('[data-sec]').forEach(r => r.onclick = () => { inp.blur(); openSec(toY(r.dataset.sec)); });   // MA is Mastercard here, not the MA function
    };
    inp.addEventListener('input', () => { if (alive(g)) draw(); });
    $('sff').onsubmit = e => { e.preventDefault(); const v = inp.value; inp.blur(); if (v.trim()) exec(v); };
    $('sqx').onclick = () => { inp.value = ''; draw(); inp.focus(); };
    await draw(); try { inp.focus(); } catch (e) { }
  };
  function exec(raw) {
    const t = String(raw).trim().toUpperCase().replace(/<GO>$/, '').trim(); if (!t) return;
    const toks = t.split(/\s+/), last = toks[toks.length - 1];
    if (toks.length === 1 && LOCAL[t]) { addRecent(t); const [v, a] = LOCAL[t]; return go(v, a, !ROOTS.includes(v)); }
    if (toks.length > 1 && (SECFN[last] || FNNAME[last])) {
      addRecent(t); const s = toY(toks.slice(0, -1).join(' ')); curSec = s;
      if (SECFN[last]) { const [v, r] = SECFN[last]; return go(v, r ? s + '|' + r : s, true); }
      return run(nameOf(s) + ' ' + last);
    }
    if (toks.length === 1 && FNNAME[t]) { addRecent(t); return run(t); }
    openSec(toY(t));
  }

  // ------------------------------------------------------------------ one security: Overview
  const RNGS = ['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'Max'];
  const RNAME = { '1D': '1 Day', '5D': '5 Days', '1M': '1 Month', '6M': '6 Months', YTD: 'Year to Date', '1Y': '1 Year', '5Y': '5 Years', Max: 'Max' };
  let secRng = ls.get('kltnAnywhereRng', '1D');
  const SECBTN = [['DES', 'Description'], ['GP', 'Price Chart'], ['GIP', 'Intraday'], ['CN', 'News'], ['FA', ''], ['ANR', ''], ['EE', ''], ['HDS', ''], ['OMON', ''], ['DVD', ''], ['RV', ''], ['BETA', ''], ['SI', ''], ['CAST', ''], ['QR', ''], ['SPLC', '']];
  VIEWS.sec = async (s, g) => {
    curSec = s; title('Overview');
    const isW = () => wl().includes(s);
    const star = () => `<button class="ib ${isW() ? 'on' : ''}" type="button" data-w="1" aria-label="Monitor"><svg viewBox="0 0 22 22"><path d="m11 2.8 2.5 5.1 5.6.8-4 4 .9 5.6L11 15.7l-5 2.6.9-5.6-4-4 5.6-.8z" fill="${isW() ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></button>`;
    const drawStar = () => { $('nbr').innerHTML = liveTag() + star(); paintLive(); $('nbr').querySelector('[data-w]').onclick = () => { const l = wl(); wsave(isW() ? l.filter(x => x !== s) : l.concat([s])); toast(isW() ? short(s) + ' added to Monitor' : short(s) + ' removed from Monitor'); drawStar(); }; };
    drawStar();
    let q = (await quotes([s]))[s]; if (!alive(g)) return;
    if (!q) { mv.innerHTML = `<div class="empty">No quote for <b>${esc(nameOf(s))}</b>. Check the ticker (e.g. AAPL, VOD LN, EURUSD, CL1).</div>`; return; }
    mv.innerHTML = `<div class="ov"><div class="ov-1"><span class="ov-tk">${esc(nameOf(s))}</span><span class="ov-tm" id="otm"></span></div><div class="ov-nm" id="onm"></div>` +
      `<div class="ov-px"><span class="p" id="opx"></span><span class="c" id="oc"></span><span class="c" id="ocp"></span></div><div class="ov-st" id="ost"></div></div>` +
      `<div class="fb">${SECBTN.map(([c]) => `<button type="button" data-f="${c}" class="${SECFN[c] ? '' : 'pc' + (PC.on ? ' live' : '')}">${c}</button>`).join('')}</div>` +
      `<div class="kv" id="okv"></div>` +
      sh('Price Chart', 'gp:' + s + '|' + secRng, 'More', RNAME[secRng]) + '<div class="ch" id="och"></div>' +
      `<div class="rgb">${RNGS.map(r => `<button type="button" data-r="${r}" class="${r === secRng ? 'on' : ''}">${r}</button>`).join('')}</div>` +
      sh('Key Statistics') + '<div class="kv" id="oks"></div>' +
      sh('Company News', 'cn:' + s) + '<div class="nl" id="onw"><div class="empty">Retrieving headlines&hellip;</div></div>' + foot();
    bind(mv); pcCheck();
    mv.querySelectorAll('.fb [data-f]').forEach(b => b.onclick = () => b.dataset.f === 'DES' ? $('oks').scrollIntoView({ behavior: 'smooth', block: 'center' }) : exec(nameOf(s) + ' ' + b.dataset.f));
    const head = () => {
      const c = q.regularMarketChange, t = q.regularMarketTime ? new Date(q.regularMarketTime * 1000) : null;
      $('onm').textContent = q.longName || q.shortName || q.cName || '';
      const pe = $('opx'), was = pe._p, p = q.regularMarketPrice, dir = ok(was) && ok(p) && p !== was ? (p > was ? 1 : -1) : 0;
      pe.innerHTML = `${px(p, q)}<small>${esc(q.currency || '')}</small>`; if (ok(p)) pe._p = p;
      if (dir) { pe.classList.add(dir > 0 ? 'fu' : 'fd'); setTimeout(() => pe.classList.remove('fu', 'fd'), 900); }
      $('oc').className = 'c ' + cls(c); $('oc').textContent = sg(c, dpc(q)); $('ocp').className = 'c ' + cls(c); $('ocp').textContent = pc(q.regularMarketChangePercent);
      $('otm').textContent = t ? (today(t) && !q._dateOnly ? hm(t) + ':' + p2(t.getSeconds()) : mdy(t)) : '';
      const st = q.marketState === 'REGULAR' && t && today(t) && !q._dateOnly ? 'Open' : h24(cnbcSym(s)) ? 'Trading' : 'Closed';
      $('ost').innerHTML = esc(st) + (q.fullExchangeName ? ` <span>· ${esc(q.fullExchangeName)}</span>` : '') + (q.ext && ok(q.ext.p) ? ` <span>· ${esc(q.ext.type)} ${px(q.ext.p, q)} <span class="${cls(q.ext.c)}">${sg(q.ext.c, dpc(q))} (${pc(q.ext.cp)})</span></span>` : '');
      const kv = [['Open', px(q.regularMarketOpen, q)], ['Prev Close', px(q.regularMarketPreviousClose, q)], ['High', px(q.regularMarketDayHigh, q)], ['Low', px(q.regularMarketDayLow, q)],
        ['Volume', big(q.regularMarketVolume)], ['Avg Vol', big(q.avgVol10 || q.averageDailyVolume3Month)], ['Mkt Cap', big(q.marketCap)], ['P/E', ok(q.trailingPE) ? q.trailingPE.toFixed(2) : '--']];
      $('okv').innerHTML = kv.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('');
      const d = v => v ? mdy(new Date(v * 1000)) : '--';
      const ks = [['52W High', px(q.fiftyTwoWeekHigh, q)], ['52W Low', px(q.fiftyTwoWeekLow, q)], ['EPS', ok(q.epsTrailingTwelveMonths) ? q.epsTrailingTwelveMonths.toFixed(2) : '--'], ['Fwd P/E', ok(q.forwardPE) ? q.forwardPE.toFixed(2) : '--'],
        ['Div Yld', ok(q.dividendYield) ? q.dividendYield.toFixed(2) + '%' : '--'], ['Beta', ok(q.beta) ? q.beta.toFixed(2) : '--'], ['Shares Out', big(q.sharesOutstanding)], ['P/B', ok(q.priceToBook) ? q.priceToBook.toFixed(2) : '--'],
        ['Next Earnings', d(q.nextEarn || q.earningsTimestampStart)], ['Ex-Dividend', d(q.exDiv)], ['50D Avg', px(q.fiftyDayAverage, q)], ['200D Avg', px(q.twoHundredDayAverage, q)]];
      $('oks').innerHTML = ks.filter(([, v]) => v !== '--').map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('') || '<div><span>No statistics for this security</span><span></span></div>';
    };
    head();
    const drawChart = async () => { const host = $('och'); if (!host) return; const d = await chartData(s, secRng, q).catch(() => null); if (!alive(g)) return; chart(host, d, { name: nameOf(s), q }); };
    mv.querySelectorAll('.rgb [data-r]').forEach(b => b.onclick = () => {
      secRng = b.dataset.r; ls.set('kltnAnywhereRng', secRng); mv.querySelectorAll('.rgb button').forEach(x => x.classList.toggle('on', x === b));
      const m = mv.querySelector('.sh [data-go^="gp:"]'); if (m) { m.dataset.go = 'gp:' + s + '|' + secRng; m.closest('.sh').querySelector('small').textContent = RNAME[secRng]; }
      drawChart();
    });
    api('news', { s, n: q.longName || q.shortName || q.cName || '' }).then(items => { if (!alive(g)) return; const l = Array.isArray(items) ? items : (items && items.items) || []; $('onw').innerHTML = newsRows(l.slice(0, 6)) || '<div class="empty">No recent stories.</div>'; }).catch(() => { if (alive(g)) $('onw').innerHTML = '<div class="empty">No recent stories.</div>'; });
    await drawChart();
    let n = 0;
    every(g, STATIC ? 5000 : 15000, async () => { const r = (await quotes([s]))[s]; if (!alive(g) || !r) return; q = r; head(); paintLive(); if (++n % 6 === 0 && (secRng === '1D' || secRng === '5D')) drawChart(); });
  };
  // full-screen price chart (GP / GIP)
  VIEWS.gp = async (arg, g) => {
    const [s, r0] = String(arg || '').split('|'); let rng = RNGS.includes(r0) ? r0 : '1Y'; curSec = s;
    title('Price Chart'); $('nbr').innerHTML = liveTag(); paintLive();
    let q = (await quotes([s]))[s] || { symbol: s }; if (!alive(g)) return;
    mv.innerHTML = `<div class="gp"><div class="gp-h" id="gph"></div><div class="ch" id="gch"></div><div class="rgb">${RNGS.map(r => `<button type="button" data-r="${r}" class="${r === rng ? 'on' : ''}">${r}</button>`).join('')}</div></div>`;
    mv.querySelector('.gp').style.height = (mv.clientHeight - 6) + 'px';
    const draw = async () => {
      const d = await chartData(s, rng, q).catch(() => null); if (!alive(g)) return;
      const b = d && d.bars, per = d && d.intraday ? (d.step || '1') + 'm' : rng === '5Y' ? '1W' : rng === 'Max' ? '1M' : '1D';
      $('gph').innerHTML = `<b>Price Chart</b><span class="dim">${rng}</span>${b && b.length ? `<span>${mdy(new Date(b[0].t * 1000))} - ${mdy(new Date(b[b.length - 1].t * 1000))}</span><span>Period: ${per}</span>` : ''}<span class="dim">${esc(nameOf(s))}</span>`;
      chart($('gch'), d, { name: nameOf(s), q, vol: true, full: true });
    };
    mv.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { rng = b.dataset.r; stack[stack.length - 1].arg = s + '|' + rng; mv.querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
    await draw();
    let n = 0;
    every(g, 5000, async () => { if (++n % 6 === 0 && (rng === '1D' || rng === '5D')) { q = (await quotes([s]))[s] || q; draw(); } });
  };
  // company news (CN)
  VIEWS.cn = async (s, g) => {
    title('Company News');
    const items = await api('news', { s, n: (LQ[s] && LQ[s].cName) || '' }).catch(() => []); if (!alive(g)) return;
    const l = Array.isArray(items) ? items : (items && items.items) || [];
    mv.innerHTML = sh(nameOf(s), null) + `<div class="nl">${newsRows(l.slice(0, 60)) || '<div class="empty">No recent stories.</div>'}</div>`;
  };

  // ------------------------------------------------------------------ chart data: CNBC bars (live), falling back to the snapshot history / server
  const CRNG = { '1D': '1D', '5D': '5D', '1M': '1M', '6M': '1Y', YTD: '1Y', '1Y': '1Y', '5Y': '5Y', Max: 'ALL' };
  const SRNG = { '1D': ['1d', '1m'], '5D': ['5d', '15m'], '1M': ['1mo', '1d'], '6M': ['6mo', '1d'], YTD: ['ytd', '1d'], '1Y': ['1y', '1d'], '5Y': ['5y', '1wk'], Max: ['max', '1mo'] };
  const chc = {};
  async function cnbcBars(c, r) {
    const k = c + '|' + r, h = chc[k], ttl = r === '1D' || r === '5D' ? 25e3 : 900e3;
    if (h && Date.now() - h.t < ttl) return h.v;
    const res = await within(fetch(CC + r + '.json?symbol=' + encodeURIComponent(c), { cache: 'no-store' }), 9000);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json(), pb = d && d.barData && d.barData.priceBars;
    if (!pb || !pb.length) throw new Error('no chart');
    // daily and longer bars are stamped midnight New York: keep their calendar date (noon UTC) so no time zone shows the day before
    const day = !['1D', '5D'].includes(r), dt = k => Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), 12) / 1000;
    const v = pb.map(b => { const k = String(b.tradeTime || ''); return { t: day && k.length >= 8 ? dt(k) : b.tradeTimeinMills / 1000, k, o: +b.open, h: +b.high, l: +b.low, c: +b.close, v: +b.volume || 0 }; }).filter(b => isFinite(b.c) && isFinite(b.t));
    chc[k] = { t: Date.now(), v }; return v;
  }
  async function chartData(s, rng, q) {
    const c = cnbcSym(s), intraday = rng === '1D' || rng === '5D';
    let bars = null, span = null;
    if (STATIC && c) {
      try {
        let b = await cnbcBars(c, CRNG[rng]);
        if (intraday) {
          if (usEq(c)) { const reg = b.filter(x => { const t = +x.k.slice(8, 12); return t >= 930 && t < 1600; }); if (reg.length > 10) b = reg; }
          if (h24(c) && /\.CM=$/.test(c)) { const tl = b[b.length - 1].t; b = b.filter(x => x.t > tl - (rng === '1D' ? 1 : 5) * 86400); }
          else { const days = [...new Set(b.map(x => x.k.slice(0, 8)))].slice(rng === '1D' ? -1 : -5); b = b.filter(x => days.includes(x.k.slice(0, 8))); }
          if (rng === '1D' && b.length && (usEq(c) || /^\.(SPX|DJI|IXIC|NDX|RUT|VIX|NYA|SOX|TRAN|SPXEW)$/.test(c)) && +b[0].k.slice(8, 12) <= 935) span = [b[0].t, b[0].t + 6.5 * 3600];
        } else {
          const tl = b[b.length - 1].t, ly = new Date(tl * 1000).getFullYear();
          const cut = { '1M': tl - 31 * 86400, '6M': tl - 183 * 86400, YTD: new Date(ly, 0, 1) / 1000, '1Y': tl - 366 * 86400, '5Y': tl - 5 * 366 * 86400, Max: -Infinity }[rng];
          b = b.filter(x => x.t >= cut);
        }
        if (b.length > 1) bars = b;
      } catch (e) { }
    }
    if (!bars) {
      const [range, interval] = SRNG[rng];
      const d = await (STATIC ? sapi('chart', { s, range: rng === 'Max' ? '5y' : range }) : api('chart', { s, range, interval })).catch(() => null);
      bars = d && d.bars && d.bars.length > 1 ? d.bars.filter(x => ok(x.c)) : null;
      if (bars && !STATIC && intraday) { const days = [...new Set(bars.map(x => new Date(x.t * 1000).toDateString()))].slice(rng === '1D' ? -1 : -5); bars = bars.filter(x => days.includes(new Date(x.t * 1000).toDateString())); }
    }
    if (!bars) return null;
    const step = intraday && bars.length > 2 ? Math.max(1, Math.round((bars[bars.length - 1].t - bars[bars.length - 2].t) / 60)) : null;
    const ref = rng === '1D' && q && ok(q.regularMarketPreviousClose) ? q.regularMarketPreviousClose : bars[0].c;
    return { bars, intraday, span, ref, step, rng };
  }

  // ------------------------------------------------------------------ the chart: navy area, white line, orange start line, legend, last-price tag, touch crosshair
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function chart(host, d, o) {
    if (!host) return;
    host._chart = { d, o };
    const bars = d && d.bars;
    if (!bars || bars.length < 2) { host.innerHTML = '<div class="chm">No chart data for this range</div>'; return; }
    host.innerHTML = '';
    const cv = document.createElement('canvas'), ov = document.createElement('canvas'); host.append(cv, ov);
    const W = host.clientWidth, H = host.clientHeight, R = Math.min(3, window.devicePixelRatio || 1);
    [cv, ov].forEach(c => { c.width = Math.round(W * R); c.height = Math.round(H * R); c.style.width = W + 'px'; c.style.height = H + 'px'; });
    const g = cv.getContext('2d'); g.scale(R, R);
    const FF = getComputedStyle(document.body).fontFamily, F = s => s + 'px ' + FF;
    const q = o.q || {}, fmt = v => px(v, q), n = bars.length, last = bars[n - 1].c, ref = ok(d.ref) ? d.ref : bars[0].c;
    let hi = -Infinity, lo = Infinity, hiI = 0, loI = 0;
    bars.forEach((b, i) => { if (b.c > hi) { hi = b.c; hiI = i; } if (b.c < lo) { lo = b.c; loI = i; } });
    const dfmt = t => { const x = new Date(t * 1000); return d.intraday ? md(x) + ' ' + hm(x) : md(x); };
    // legend
    g.font = F(11); g.textBaseline = 'middle';
    const chs = sg(last - ref, dpOf(last, q)) + ' (' + pc(ref ? (last / ref - 1) * 100 : null) + ')';
    const items = o.full ? [['#f0f0f0', (o.name || '') + ' ' + fmt(last)], ['#e8a256', (d.rng === '1D' ? 'Prev ' : 'Start ') + fmt(ref)], ['#f0f0f0', 'High on ' + dfmt(bars[hiI].t) + ' ' + fmt(hi)],
      ['#f0f0f0', 'Low on ' + dfmt(bars[loI].t) + ' ' + fmt(lo)], ['#f0f0f0', 'Change ' + chs]]
      : [['#f0f0f0', 'High ' + fmt(hi)], ['#f0f0f0', 'Low ' + fmt(lo)], ['#e8a256', (d.rng === '1D' ? 'Prev ' : 'Start ') + fmt(ref)], ['#f0f0f0', 'Chg ' + chs]];
    let lx = 10, ly = 10;
    items.forEach(([c, t]) => { const w = g.measureText(t).width + 18; if (lx > 10 && lx + w > W - 6) { lx = 10; ly += 15; } g.fillStyle = c; g.fillRect(lx, ly - 3, 6, 6); g.fillStyle = '#d8d8d8'; g.fillText(t, lx + 10, ly); lx += w; });
    const AX = 54, XB = d.intraday ? 20 : 32, VOL = o.vol ? Math.max(48, Math.round((H - ly - 14 - XB) * .2)) : 0;
    const x0 = 8, x1 = W - AX, y0 = ly + 14, y1 = H - XB - (VOL ? VOL + 22 : 0);
    let mn = Math.min(lo, ref), mx = Math.max(hi, ref); const pad = (mx - mn) * .08 || Math.abs(mx) * .005 || 1; mn -= pad; mx += pad;
    const step = nice((mx - mn) / Math.max(3, Math.round((y1 - y0) / 42))), tk = [];
    for (let v = Math.ceil(mn / step) * step; v <= mx + step * 1e-9; v += step) tk.push(+v.toFixed(10));
    const ad = Math.max(0, Math.min(4, -Math.floor(Math.log10(step) + 1e-9))), axf = v => Math.abs(mx) >= 1e4 ? (v / 1e3).toFixed(Math.max(0, Math.min(3, -Math.floor(Math.log10(step / 1e3) + 1e-9)))) + 'k' : v.toFixed(ad);
    const Y = v => y1 - (v - mn) / (mx - mn) * (y1 - y0);
    const span = d.span && d.span[1] > bars[n - 1].t ? d.span : null;
    const X = span ? (i => x0 + (bars[i].t - span[0]) / (span[1] - span[0]) * (x1 - x0)) : (i => x0 + i / (n - 1) * (x1 - x0));
    // grid + axis
    g.strokeStyle = '#2b2b2b'; g.lineWidth = 1; g.setLineDash([2, 3]);
    tk.forEach(v => { const y = Math.round(Y(v)) + .5; g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); });
    g.setLineDash([]); g.fillStyle = '#8a8a8a'; g.textAlign = 'left';
    tk.forEach(v => { const y = Y(v); if (y > y0 + 4 && y < y1 - 2) g.fillText(axf(v), x1 + 6, y); });
    g.strokeStyle = '#3a3a3a'; g.beginPath(); g.moveTo(x1 + .5, y0); g.lineTo(x1 + .5, H - XB); g.moveTo(x0, Math.round(y1) + .5); g.lineTo(x1, Math.round(y1) + .5); g.stroke();
    // x labels: hours (1 day), days (5 days), weeks (1 month), months (to 1 year), years
    const lab = [], yrs = [];
    const key = t => { const x = new Date(t * 1000); return d.rng === '1D' ? x.getHours() : d.rng === '5D' ? x.toDateString() : d.rng === '1M' ? Math.floor((Math.floor(t / 86400) + 3) / 7) : ['5Y', 'Max'].includes(d.rng) ? x.getFullYear() : x.getMonth() + '/' + x.getFullYear(); };
    const txt = t => { const x = new Date(t * 1000); return d.rng === '1D' ? p2(x.getHours()) + ':00' : d.rng === '5D' ? md(x) : d.rng === '1M' ? md(x) : ['5Y', 'Max'].includes(d.rng) ? String(x.getFullYear()) : MON[x.getMonth()]; };
    let pk = null;
    bars.forEach((b, i) => { const k = key(b.t); if (k !== pk) { if (pk !== null || i === 0) lab.push({ i, s: txt(b.t), t: b.t }); pk = k; } });
    if (d.rng === '1D' && lab.length && new Date(lab[0].t * 1000).getMinutes() > 0) lab.shift();
    const gap = d.rng === '1D' ? 40 : 30; let keep = [], lastX = -1e9;
    lab.forEach(l => { const x = X(l.i); if (x - lastX >= gap && x < x1 - 12) { keep.push(l); lastX = x; } });
    g.font = F(10.5); g.fillStyle = '#8a8a8a'; g.strokeStyle = '#3a3a3a'; g.textAlign = 'center';
    const yl = H - XB + (d.intraday ? 10 : 9);
    keep.forEach((l, j) => {
      const x = Math.round(X(l.i)) + .5; g.beginPath(); g.moveTo(x, y1); g.lineTo(x, y1 + 5); g.stroke();
      const nx = j + 1 < keep.length ? X(keep[j + 1].i) : x1, mid = ['1D', '5D', '1M'].includes(d.rng) ? x : Math.min((x + nx) / 2, x1 - 14);
      g.fillText(l.s, mid, yl);
    });
    if (!d.intraday && !['5Y', 'Max'].includes(d.rng)) {   // the year under the months: at the start and at every new year
      let py = null; bars.forEach((b, i) => { const yv = new Date(b.t * 1000).getFullYear(); if (yv !== py) { const x = Math.round(X(i)) + .5; if (!yrs.length || x - yrs[yrs.length - 1].x > 34) yrs.push({ x, s: String(yv) }); py = yv; } });
    }
    yrs.forEach(y => { g.beginPath(); g.moveTo(y.x, y1); g.lineTo(y.x, H - 4); g.stroke(); g.textAlign = 'left'; g.fillText(y.s, y.x + 4, H - 8); });
    // area + line
    const path = new Path2D(); for (let i = 0; i < n; i++) { const x = X(i), y = Y(bars[i].c); i ? path.lineTo(x, y) : path.moveTo(x, y); }
    const area = new Path2D(path); area.lineTo(X(n - 1), y1); area.lineTo(X(0), y1); area.closePath();
    const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, '#0d2c4d'); gr.addColorStop(1, '#0a2138');
    g.fillStyle = gr; g.fill(area);
    g.setLineDash([4, 3]); g.strokeStyle = '#e8a256'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, Math.round(Y(ref)) + .5); g.lineTo(x1, Math.round(Y(ref)) + .5); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#e4e4ea'; g.lineWidth = 1.3; g.lineJoin = 'round'; g.stroke(path);
    // last-price tag on the axis
    const tag = (y, s, bg, fg) => { g.font = 'bold ' + F(11); const w = Math.min(AX - 6, g.measureText(s).width + 8); g.fillStyle = bg; g.beginPath(); g.moveTo(x1 + 1, y); g.lineTo(x1 + 6, y - 8); g.lineTo(x1 + 6 + w, y - 8); g.lineTo(x1 + 6 + w, y + 8); g.lineTo(x1 + 6, y + 8); g.closePath(); g.fill(); g.fillStyle = fg; g.textAlign = 'left'; g.fillText(s, x1 + 9, y + .5); };
    tag(Math.max(y0 + 8, Math.min(y1 - 8, Y(last))), fmt(last), '#dadada', '#111');
    // volume panel
    let vY = null;
    if (VOL) {
      const vy0 = y1 + 22, vy1 = vy0 + VOL, vols = bars.map(b => b.v || 0), vmax = Math.max(...vols);
      if (vmax > 0) {
        const sma = vols.map((_, i) => i < 14 ? null : vols.slice(i - 14, i + 1).reduce((a, b) => a + b, 0) / 15);
        g.font = F(11); g.textAlign = 'left'; g.fillStyle = '#627288'; g.fillRect(10, y1 + 8, 6, 6); g.fillStyle = '#d8d8d8'; const vt = 'Volume ' + big(vols[n - 1]); g.fillText(vt, 20, y1 + 11);
        const sx = 20 + g.measureText(vt).width + 12; g.fillStyle = '#f0f0f0'; g.fillRect(sx, y1 + 8, 6, 6); g.fillStyle = '#d8d8d8'; g.fillText('SMA(15) ' + big(sma[n - 1]), sx + 10, y1 + 11);
        const bw = Math.max(1, (x1 - x0) / n * .7), VYf = v => vy1 - v / vmax * (VOL - 4);
        g.fillStyle = '#627288'; bars.forEach((b, i) => { if (b.v) g.fillRect(X(i) - bw / 2, VYf(b.v), bw, vy1 - VYf(b.v)); });
        g.strokeStyle = '#f0f0f0'; g.lineWidth = 1; g.beginPath(); let st = false; sma.forEach((v, i) => { if (v == null) return; const x = X(i), y = VYf(v); st ? g.lineTo(x, y) : g.moveTo(x, y); st = true; }); g.stroke();
        const axv = v => v >= 1e9 ? +(v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? Math.round(v / 1e6) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : String(Math.round(v));
        g.fillStyle = '#8a8a8a'; g.fillText(axv(vmax), x1 + 6, vy0 + 6); g.fillText(axv(vmax / 2), x1 + 6, VYf(vmax / 2));
        const ly2 = Math.max(vy0 + 16, Math.min(vy1 - 6, VYf(vols[n - 1]))), lt = axv(vols[n - 1]); g.font = 'bold ' + F(10.5); const lw = Math.min(AX - 6, g.measureText(lt).width + 8);
        g.fillStyle = '#627288'; g.fillRect(x1 + 6, ly2 - 7, lw, 14); g.fillStyle = '#fff'; g.fillText(lt, x1 + 10, ly2 + .5); g.font = F(11);
        g.strokeStyle = '#3a3a3a'; g.beginPath(); g.moveTo(x0, vy1 + .5); g.lineTo(x1, vy1 + .5); g.stroke();
        vY = [vy0, vy1];
      }
    }
    // touch crosshair
    const og = ov.getContext('2d'); og.scale(R, R);
    let on = false, tmo = null;
    const pick = e => { const r = ov.getBoundingClientRect(), x = e.clientX - r.left; let best = 0, bd = 1e9; if (span) { for (let i = 0; i < n; i++) { const dd = Math.abs(X(i) - x); if (dd < bd) { bd = dd; best = i; } } return best; } return Math.max(0, Math.min(n - 1, Math.round((x - x0) / (x1 - x0) * (n - 1)))); };
    const drawX = i => {
      og.clearRect(0, 0, W, H); const b = bars[i], x = Math.round(X(i)) + .5, y = Y(b.c);
      og.strokeStyle = '#9a9a9a'; og.lineWidth = 1; og.setLineDash([3, 3]); og.beginPath(); og.moveTo(x, y0); og.lineTo(x, vY ? vY[1] : y1); og.moveTo(x0, Math.round(y) + .5); og.lineTo(x1, Math.round(y) + .5); og.stroke(); og.setLineDash([]);
      og.fillStyle = '#f0a54e'; og.beginPath(); og.arc(x, y, 3.5, 0, 7); og.fill();
      og.font = 'bold ' + F(11); og.textBaseline = 'middle';
      const vs = fmt(b.c), vw = og.measureText(vs).width + 8; og.fillStyle = '#f0a54e'; og.fillRect(x1 + 4, y - 8, Math.min(AX - 6, vw), 16); og.fillStyle = '#141414'; og.textAlign = 'left'; og.fillText(vs, x1 + 7, y + .5);
      const dt = new Date(b.t * 1000), ds = d.intraday ? md(dt) + ' ' + hm(dt) : mdy(dt), dw = og.measureText(ds).width + 10, dx = Math.max(x0, Math.min(x1 - dw, x - dw / 2));
      og.fillStyle = '#dadada'; og.fillRect(dx, y1 + 1, dw, 16); og.fillStyle = '#111'; og.textAlign = 'center'; og.fillText(ds, dx + dw / 2, y1 + 9.5);
      const ch = b.c - ref, info = `${ds}   ${vs}   ${sg(ch, dpOf(b.c, q))} (${pc(ref ? (b.c / ref - 1) * 100 : null)})${b.v ? '   Vol ' + big(b.v) : ''}`;
      og.font = F(11.5); og.fillStyle = '#141414'; og.fillRect(0, 0, W, y0 - 3); og.fillStyle = ch > 0 ? '#64e57d' : ch < 0 ? '#ff5470' : '#f0f0f0'; og.textAlign = 'left'; og.fillText(info, 10, 10);
    };
    const end = () => { on = false; clearTimeout(tmo); tmo = setTimeout(() => og.clearRect(0, 0, W, H), 1400); };
    ov.addEventListener('pointerdown', e => { on = true; clearTimeout(tmo); drawX(pick(e)); });
    ov.addEventListener('pointermove', e => { if (on || e.pointerType === 'mouse') { clearTimeout(tmo); drawX(pick(e)); } });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(k => ov.addEventListener(k, end));
  }
  let rz = null;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => {
    const gp = mv.querySelector('.gp'); if (gp) gp.style.height = (mv.clientHeight - 6) + 'px';
    document.querySelectorAll('.ch').forEach(h => { if (h._chart && h.clientWidth) chart(h, h._chart.d, h._chart.o); });
  }, 200); });

  // ------------------------------------------------------------------ KLTN server: sign in when the server asks
  function signIn() {
    const s = sheet('<h3>KLTN Login</h3><p>Sign in with your KLTN login to use this terminal.</p><form><input class="nc" name="u" autocomplete="username" autocapitalize="none" placeholder="Login name"><input class="nc" name="p" type="password" autocomplete="current-password" placeholder="Password" style="margin-top:8px"><p class="err" style="color:var(--dn);margin:8px 0 0;min-height:1.2em"></p><div class="sh-a"><button type="submit" class="pri">Log In</button><button type="button" data-r="1">Create Login</button></div></form>');
    const f = s.querySelector('form'), err = s.querySelector('.err');
    s.onclick = null;
    const goIn = async mode => {
      err.textContent = '';
      try { await api('social/' + mode, null, { username: f.u.value.trim(), password: f.p.value, display: f.u.value.trim() }); needLogin = false; s.remove(); render(); }
      catch (e) { err.textContent = e.message || String(e); }
    };
    f.onsubmit = e => { e.preventDefault(); goIn('login'); };
    s.querySelector('[data-r]').onclick = () => goIn('register');
  }

  // ------------------------------------------------------------------ start
  const h0 = decodeURIComponent((location.hash || '').slice(1)).split('/'), v0 = h0[0], a0 = h0.slice(1).join('/');
  if (VIEWS[v0] && !ROOTS.includes(v0) && a0) { stack = [{ v: v0 === 'mkt' ? 'menu' : 'home', arg: null, title: v0 === 'mkt' ? 'Menu' : 'Home' }, { v: v0, arg: a0, title: '' }]; if (v0 === 'sec') curSec = a0; render(); }
  else go(ROOTS.includes(v0) ? v0 : 'home');
  pcCheck();
  setInterval(() => { if (!document.hidden) pcCheck(); }, 90e3);
})();
