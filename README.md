# KLTN Anywhere

The [KLTN Research Terminal](https://kltn-terminal.web.app) on your phone: market tiles, indices, futures, FX, rates, commodities
and crypto, the news wire, a watchlist, and a quote, chart, overview and news for about 1,300 securities.

**Open it:** https://koltonandrew62.github.io/kltn-anywhere/
On an iPhone, open it in Safari and choose Share › Add to Home Screen for an app icon.

## How it works
There is no server. A scheduled GitHub Action ([snapshot.yml](.github/workflows/snapshot.yml)) runs
[job/snapshot.py](job/snapshot.py) every 15 minutes. The job collects delayed quotes, intraday sparklines, movers and headlines
from public sources, then publishes the app and the data on GitHub Pages. Chart history refreshes once a day.

This repository holds only the phone app and that job. The full terminal, with live data and all 176 functions, is a free
desktop app for Windows and Mac: https://kltn-terminal.web.app

Market data is delayed (refreshed about every 15 minutes) and comes from public sources. It is for research only and is not
investment advice. The KLTN Prop N font is under the SIL Open Font License (see app/fonts).
