"""KLTN Anywhere data job (runs on GitHub Actions; needs only `requests`).

    python snapshot.py quick OUT      every 15 min: quotes, 1-day intraday sparklines (15-min closes), top news,
                                      movers, per-ticker news for a rotating batch          -> OUT/data/*.json
    python snapshot.py hist OUT       once a day: 1-year daily and 5-year weekly closes per security -> OUT/data/hist/*.json

The phone app (index.html + js/anywhere.js in static mode) reads these files; nothing else runs anywhere.
Symbols: the KLTN security master (data/universe.json, copied from the app) plus the market lists the app shows.
Market data: Yahoo Finance public endpoints, delayed; news: publishers' public RSS feeds.
"""
import calendar
import concurrent.futures as cf
import email.utils
import html
import json
import os
import random
import re
import sys
import time
import xml.etree.ElementTree as ET

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
Q1, Q2 = "https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"
HERE = os.path.dirname(os.path.abspath(__file__))
# the lists the phone app shows outside the security master (indices, futures, FX, rates, commodities, crypto)
EXTRA = ["^GSPC", "^IXIC", "^DJI", "^RUT", "^VIX", "^TNX", "^IRX", "^FVX", "^TYX", "DX-Y.NYB", "EURUSD=X", "JPY=X", "GBPUSD=X", "CHF=X", "AUDUSD=X",
         "CAD=X", "CNY=X", "MXN=X", "CL=F", "BZ=F", "NG=F", "GC=F", "SI=F", "HG=F", "ZC=F", "ZS=F", "ZW=F", "KC=F", "ES=F", "NQ=F", "YM=F", "RTY=F",
         "ZN=F", "ZB=F", "VX=F", "BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "^FTSE", "^GSPTSE", "^BVSP", "^STOXX50E", "^GDAXI", "^FCHI",
         "^N225", "^HSI", "000300.SS", "^KS11", "^AXJO", "^NSEI", "^NDX", "^MXX", "^IBEX", "FTSEMIB.MI", "^AEX", "^SSMI", "000001.SS", "^TWII",
         "^STI", "NZDUSD=X", "EURJPY=X", "EURGBP=X", "GBPJPY=X", "HKD=X", "INR=X", "KRW=X", "BRL=X", "SEK=X", "NOK=X", "ZT=F", "ZF=F", "HO=F", "RB=F",
         "PL=F", "SB=F", "CC=F", "CT=F", "LE=F", "ADA-USD"]
FEEDS = [  # (source, url, category) - publishers' own public RSS
    ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html", "Markets"), ("CNBC Markets", "https://www.cnbc.com/id/20409666/device/rss/rss.html", "Markets"),
    ("CNBC Earnings", "https://www.cnbc.com/id/15839135/device/rss/rss.html", "Markets"), ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories", "Markets"),
    ("WSJ Markets", "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain", "Markets"), ("Yahoo Finance", "https://finance.yahoo.com/news/rssindex", "Markets"),
    ("Investing.com", "https://www.investing.com/rss/news.rss", "Markets"), ("FT Markets", "https://www.ft.com/markets?format=rss", "Markets"),
    ("Business Insider", "https://markets.businessinsider.com/rss/news", "Markets"), ("Nasdaq", "https://www.nasdaq.com/feed/rssoutbound?category=Markets", "Markets"),
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/", "Markets"), ("Oilprice", "https://oilprice.com/rss/main", "Markets"),
    ("CNBC Tech", "https://www.cnbc.com/id/19854910/device/rss/rss.html", "Tech"), ("TechCrunch", "https://techcrunch.com/feed/", "Tech"),
    ("WSJ Business", "https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness", "Business"), ("NYT Business", "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", "Business"),
    ("BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml", "Business"), ("Guardian Business", "https://www.theguardian.com/business/rss", "Business"),
    ("Fortune", "https://fortune.com/feed/", "Business"), ("Fox Business", "https://moxie.foxbusiness.com/google-publisher/latest.xml", "Business"),
    ("CNBC Economy", "https://www.cnbc.com/id/20910258/device/rss/rss.html", "Economy"), ("WSJ Economy", "https://feeds.content.dowjones.io/public/rss/socialeconomyfeed", "Economy"),
    ("FT Economy", "https://www.ft.com/global-economy?format=rss", "Economy"), ("Economist Finance", "https://www.economist.com/finance-and-economics/rss.xml", "Economy"),
    ("Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml", "Economy"), ("ECB", "https://www.ecb.europa.eu/rss/press.html", "Economy"),
    ("CNBC Politics", "https://www.cnbc.com/id/10000113/device/rss/rss.html", "Politics"), ("NYT Politics", "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml", "Politics"),
    ("Politico", "https://rss.politico.com/politics-news.xml", "Politics"), ("The Hill", "https://thehill.com/homenews/feed/", "Politics"),
    ("NPR Politics", "https://feeds.npr.org/1014/rss.xml", "Politics"), ("CNBC World", "https://www.cnbc.com/id/100727362/device/rss/rss.html", "World"),
    ("WSJ World", "https://feeds.content.dowjones.io/public/rss/RSSWorldNews", "World"), ("NYT World", "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", "World"),
    ("BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml", "World"), ("Guardian World", "https://www.theguardian.com/world/rss", "World"),
    ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml", "World"), ("NPR News", "https://feeds.npr.org/1001/rss.xml", "National"),
    ("NYT US", "https://rss.nytimes.com/services/xml/rss/nyt/US.xml", "National"), ("CBS News", "https://www.cbsnews.com/latest/rss/main", "National"),
]
CODE = {"CNBC": "CNB", "MarketWatch": "MWT", "WSJ": "WSJ", "Yahoo Finance": "YHO", "Investing.com": "INV", "FT": "FT", "Business Insider": "BI", "Nasdaq": "NDQ",
        "CoinDesk": "CDK", "Oilprice": "OIL", "TechCrunch": "TCR", "NYT": "NYT", "BBC": "BBC", "Guardian": "GUA", "Fortune": "FTN", "Fox Business": "FXB",
        "Economist": "ECO", "Federal Reserve": "FED", "ECB": "ECB", "Politico": "POL", "The Hill": "HIL", "NPR": "NPR", "Al Jazeera": "AJZ", "CBS News": "CBS"}

S = requests.Session()
S.headers.update({"User-Agent": UA, "Accept": "application/json,text/html,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9"})
CRUMB = [None]


def crumb():
    if CRUMB[0] is None:
        CRUMB[0] = ""
        try:
            S.get("https://fc.yahoo.com", timeout=10)
        except Exception:
            pass
        for host in (Q1, Q2):
            try:
                c = S.get(host + "/v1/test/getcrumb", timeout=10).text.strip()
                if c and "<" not in c and len(c) <= 40:
                    CRUMB[0] = c
                    break
            except Exception:
                pass
    return CRUMB[0]


def yget(path, params, use_crumb=False, tries=4):
    for a in range(tries):
        p = dict(params)
        if use_crumb and crumb():
            p["crumb"] = crumb()
        host = Q1 if a % 2 == 0 else Q2
        try:
            r = S.get(host + path, params=p, timeout=(8, 25))
            if r.status_code == 200:
                return r.json()
            if r.status_code in (401, 403) and use_crumb:
                CRUMB[0] = None
        except Exception:
            pass
        time.sleep(0.8 * (a + 1) + random.random())
    return None


def chunks(a, n):
    return [a[i:i + n] for i in range(0, len(a), n)]


def symbols(out):
    uni = json.load(open(os.path.join(out, "data", "universe.json"), encoding="utf-8"))["securities"]
    seen, syms = set(), []
    for s in EXTRA + [u["s"] for u in uni]:
        if s not in seen:
            seen.add(s)
            syms.append(s)
    return syms, uni


def r2(v, d=4):
    return round(v, d) if isinstance(v, (int, float)) else None


QF = {"p": "regularMarketPrice", "c": "regularMarketChange", "cp": "regularMarketChangePercent", "pc": "regularMarketPreviousClose", "o": "regularMarketOpen",
      "h": "regularMarketDayHigh", "l": "regularMarketDayLow", "v": "regularMarketVolume", "t": "regularMarketTime", "b": "bid", "a": "ask",
      "av": "averageDailyVolume3Month", "mc": "marketCap", "so": "sharesOutstanding", "pe": "trailingPE", "fpe": "forwardPE", "eps": "epsTrailingTwelveMonths",
      "dy": "dividendYield", "pb": "priceToBook", "h52": "fiftyTwoWeekHigh", "l52": "fiftyTwoWeekLow", "m50": "fiftyDayAverage", "m200": "twoHundredDayAverage",
      "er": "earningsTimestampStart"}


def quotes(syms):
    """v7 quote (needs Yahoo's cookie + crumb); fields as short keys; strings kept: name, exchange, currency, market state, rating"""
    out = {}

    def one(ch):
        d = yget("/v7/finance/quote", {"symbols": ",".join(ch)}, use_crumb=True)
        return ((d or {}).get("quoteResponse") or {}).get("result") or []
    with cf.ThreadPoolExecutor(6) as ex:
        for res in ex.map(one, chunks(syms, 50)):
            for q in res:
                o = {k: r2(q.get(f)) for k, f in QF.items() if isinstance(q.get(f), (int, float))}
                o.update({"n": q.get("longName") or q.get("shortName") or "", "sn": q.get("shortName") or "", "x": q.get("fullExchangeName") or q.get("exchange") or "",
                          "cur": q.get("currency") or "", "ms": q.get("marketState") or "", "ar": q.get("averageAnalystRating") or ""})
                out[q["symbol"]] = o
    return out


def sparks(syms, rng="1d", interval="15m"):
    """v7 spark (no crumb): closes per symbol, plus price / previous close from the chart meta for anything the quote call missed"""
    out, meta = {}, {}

    def one(ch):
        d = yget("/v7/finance/spark", {"symbols": ",".join(ch), "range": rng, "interval": interval})
        return ((d or {}).get("spark") or {}).get("result") or []
    with cf.ThreadPoolExecutor(6) as ex:
        for res in ex.map(one, chunks(syms, 20)):
            for it in res:
                try:
                    resp = it["response"][0]
                    pts = [[t, r2(v)] for t, v in zip(resp["timestamp"], resp["indicators"]["quote"][0]["close"]) if v is not None]
                    out[it["symbol"]] = pts
                    m = resp.get("meta") or {}
                    meta[it["symbol"]] = {"p": m.get("regularMarketPrice"), "pc": m.get("chartPreviousClose") or m.get("previousClose"), "t": m.get("regularMarketTime")}
                except Exception:
                    pass
    return out, meta


def rss(url, src, cat, limit=40):
    try:
        r = S.get(url, timeout=(8, 20))
        if r.status_code != 200:
            return []
        root = ET.fromstring(r.content)
    except Exception:
        return []
    items = []
    for it in root.iter():
        tag = it.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        g = lambda n: next((c for c in it if c.tag.split("}")[-1] == n), None)
        t = g("title"); ln = g("link"); d = g("pubDate") or g("published") or g("updated") or g("date")
        title = html.unescape(re.sub(r"<[^>]+>", "", (t.text or "") if t is not None else "")).strip()
        link = (ln.text or ln.get("href") or "").strip() if ln is not None else ""
        ts = None
        if d is not None and d.text:
            try:
                ts = email.utils.parsedate_to_datetime(d.text.strip()).timestamp()
            except Exception:
                try:
                    ts = time.mktime(time.strptime(d.text.strip()[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
                except Exception:
                    ts = None
        if title and link:
            items.append({"title": title, "link": link, "ts": ts or time.time(), "source": src, "cat": cat,
                          "code": next((v for k, v in CODE.items() if src.startswith(k)), src[:3].upper())})
        if len(items) >= limit:
            break
    return items


def news():
    with cf.ThreadPoolExecutor(12) as ex:
        lists = list(ex.map(lambda f: rss(f[1], f[0], f[2]), FEEDS))
    now, seen, out = time.time(), set(), []
    for it in sorted([x for l in lists for x in l], key=lambda x: -x["ts"]):
        k = re.sub(r"\W+", " ", it["title"].lower()).strip()[:90]
        if k in seen or it["ts"] > now + 600 or now - it["ts"] > 3 * 86400:
            continue
        seen.add(k)
        out.append(it)
    return out[:600]


def write(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, separators=(",", ":"))


def safe(s):
    return re.sub(r"[^A-Za-z0-9._=^-]", "_", s)


def quick(out):
    t0 = time.time()
    syms, uni = symbols(out)
    q = quotes(syms)
    intra, meta = sparks(syms, "1d", "15m")
    for s, m in meta.items():                        # the quote call can fail from cloud runners: keep price / change from the chart
        if s not in q and isinstance(m.get("p"), (int, float)):
            pc = m.get("pc")
            q[s] = {"p": r2(m["p"]), "pc": r2(pc), "c": r2(m["p"] - pc) if pc else None, "cp": r2((m["p"] / pc - 1) * 100) if pc else None, "t": m.get("t")}
    names = {u["s"]: u.get("n") for u in uni}
    for s, o in q.items():
        if not o.get("n") and names.get(s):
            o["n"] = names[s]
    write(os.path.join(out, "data", "quotes.json"), q)
    write(os.path.join(out, "data", "intra.json"), intra)
    # movers among US equities over $2B
    cap = {u["s"]: u.get("mcu") or 0 for u in uni if u.get("c") == "Equity"}
    eq = [(s, o) for s, o in q.items() if s in cap and (o.get("mc") or cap[s]) > 2e9 and isinstance(o.get("cp"), (int, float))]
    eq.sort(key=lambda x: x[1]["cp"])
    mv = lambda l: [dict(o, s=s) for s, o in l]
    write(os.path.join(out, "data", "movers.json"), {"gainers": mv(eq[::-1][:10]), "losers": mv(eq[:10])})
    nw = news()
    write(os.path.join(out, "data", "news.json"), nw)
    # per-ticker news (Yahoo's public headline feed): the 300 largest securities, 40 per run in rotation (~2 h cycle)
    big = [u["s"] for u in sorted(uni, key=lambda u: -(u.get("mcu") or 0)) if u.get("c") in ("Equity", "ETF", "International")][:300]
    k = int(time.time() // 900) % max(1, len(big) // 40 + 1)
    batch = big[k * 40:(k + 1) * 40]
    with cf.ThreadPoolExecutor(8) as ex:
        for s, items in zip(batch, ex.map(lambda s: rss("https://feeds.finance.yahoo.com/rss/2.0/headline?s=%s&region=US&lang=en-US" % s, "Yahoo Finance", "Markets", 25), batch)):
            if items:
                write(os.path.join(out, "data", "news", safe(s) + ".json"), items)
    write(os.path.join(out, "data", "meta.json"), {"asof": time.time(), "quotes": len(q), "intraday": len(intra), "news": len(nw), "every": 900,
                                                   "sec": round(time.time() - t0, 1)})
    print("quick: %d quotes, %d intraday, %d stories, %d ticker feeds in %.0f s" % (len(q), len(intra), len(nw), len(batch), time.time() - t0))


def hist(out):
    t0 = time.time()
    syms, _ = symbols(out)
    d1, _ = sparks(syms, "1y", "1d")
    w5, _ = sparks(syms, "5y", "1wk")
    n = 0
    for s in syms:
        if s in d1 or s in w5:
            write(os.path.join(out, "data", "hist", safe(s) + ".json"), {"d": d1.get(s) or [], "w": w5.get(s) or []})
            n += 1
    # last close of the previous year per security: the app's %Ytd / Net YTD columns
    jan1 = calendar.timegm((time.gmtime().tm_year, 1, 1, 0, 0, 0))
    base = {}
    for s, pts in d1.items():
        prev = [c for t, c in pts if t < jan1 and isinstance(c, (int, float))]
        if prev:
            base[s] = prev[-1]
    write(os.path.join(out, "data", "hist", "_ytd.json"), base)
    write(os.path.join(out, "data", "hist", "_meta.json"), {"asof": time.time(), "n": n})
    print("hist: %d securities in %.0f s" % (n, time.time() - t0))


if __name__ == "__main__":
    mode, out = sys.argv[1], sys.argv[2]
    {"quick": quick, "hist": hist}[mode](out)
