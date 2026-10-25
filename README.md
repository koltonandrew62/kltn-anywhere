# KLTN Anywhere

The [KLTN Research Terminal](https://kltn-terminal.web.app) on your phone, laid out like the terminal's mobile app: live
market cards, World Equity Indices, index futures, currencies, government bonds, commodities and crypto monitors, the news
wire, a Monitor (your watchlist), and an Overview for any security with a live price, statistics, a price chart with a
touch crosshair, and company news. Every other terminal function (FA, ECO, OMON, IB ...) opens on the full terminal.

**Open it:** https://koltonandrew62.github.io/kltn-anywhere/
On an iPhone, open it in Safari and choose Share › Add to Home Screen for an app icon.

## How it works
- **Live prices and charts:** the app asks CNBC's public quote and chart services directly from your phone (they answer any
  web page). Prices are real time where the exchange allows, otherwise delayed.
- **Names, history, headlines:** a scheduled GitHub Action ([snapshot.yml](.github/workflows/snapshot.yml)) runs
  [job/snapshot.py](job/snapshot.py) every 15 minutes and publishes the app and those files on GitHub Pages. Chart history
  and year-start prices refresh once a day.
- **Every other function:** while the KLTN host PC is on, it runs a copy of the full terminal behind a Cloudflare quick
  tunnel and publishes the tunnel's address in [tunnel.json](tunnel.json). The app checks that address and opens functions
  there; you sign in with your KLTN login. When the PC is off, the app says so and points to the free desktop app.

This repository holds only the phone app and the data job. The full terminal, with all 176 functions, is a free desktop
app for Windows and Mac: https://kltn-terminal.web.app

For research only, not investment advice. The KLTN Prop N font is under the SIL Open Font License (see app/fonts).
