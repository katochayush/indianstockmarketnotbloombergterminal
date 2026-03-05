# 🇮🇳 Bharat Terminal

> A Bloomberg-style Indian stock market intelligence dashboard — built for NSE/BSE, running live in the browser. No subscriptions. No paywalls.

![Bharat Terminal](https://img.shields.io/badge/Market-NSE%20%7C%20BSE%20%7C%20MCX-orange?style=flat-square) ![Live](https://img.shields.io/badge/Data-Live%20%26%20Real--Time-green?style=flat-square) ![Deploy](https://img.shields.io/badge/Deploy-Vercel-black?style=flat-square)

---

## 🔴 Live Demo

👉 **[indianstockmarketnotbloombergtermin.vercel.app](https://indianstockmarketnotbloombergtermin.vercel.app)**

---

## 📸 What It Looks Like

| Markets Overview | Stock Search | Intelligence Feed |
|---|---|---|
| Live Nifty/Sensex, top gainers & losers, sector heatmap | Full chart, technicals, fundamentals for any NSE stock | Real news, impact analysis, smart alerts |

---

## ✨ Features

### 📊 Markets Tab
- **Live Nifty 50, Sensex, Bank Nifty, Nifty Midcap** — updates every 10 seconds
- **Top Volume & Top Value tables** — real traded data, sortable
- **Gainers & Losers** — top 5 movers by % change, live
- **Sector Heatmap** — IT, Banking, Energy, Auto, Pharma and more — colour-coded by real price movement
- **FII / DII flow indicators**
- **Scrolling ticker tape** — all tracked stocks with live prices, every item clickable

### 🔍 Stock Search & Analysis
- Search **any NSE stock** by name or symbol (e.g. `RELIANCE`, `TCS`, `HDFCBANK`)
- **Live price, change, open/high/low, 52-week range, volume**
- **Interactive price chart** with range selector: 1D · 5D · 1M · 3M · 6M · 1Y
- **Technical Analysis** — RSI, MACD, Bollinger Bands, EMA 20/50
- **Fundamentals** — P/E, EPS, Beta, ROE, Dividend Yield, Market Cap
- **Stock Intel** — analyst commentary and key catalysts per stock
- Click **any stock name anywhere** on the dashboard to open its analysis instantly

### 🐋 Whale Trades Tab
- Live top movers of the day
- Biggest gainers and losers updated in real time
- Latest market headlines from live RSS feeds

### 📱 Social Buzz Tab
- Live market news feed
- Market breadth sentiment gauge (advancing vs declining stocks)
- Top movers with % change

### 🔍 Insider Intel Tab
- Policy & regulatory news (RBI, SEBI, Budget, oil)
- Stocks in focus — ranked by biggest intraday move
- Clickable — opens full analysis for any stock

### 📅 Earnings Tab
- Q3 FY26 results: TCS, Infosys, HDFC Bank, Reliance, Wipro
- Q4 FY26 upcoming calendar with estimates
- Watchpoints and trade conclusions

### 🛢️ Oil & Trade Tab
- Brent crude, macro context
- India trade deal analysis
- Sector impact breakdowns

### 🧠 Intelligence Feed Tab
- **Live Alerts** — real alerts fired when Nifty crosses key levels (22K, 23K, 24K…), big daily moves >1.5%
- **News + Impact** — every headline gets a BULLISH / BEARISH / WATCH badge with affected stocks
- **Trade Ideas** — curated high-conviction setups
- **Macro panel** — GDP, Capex, inflation context
- **Flows** — FII/DII net flow tracker

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — zero frameworks |
| Charts | Chart.js |
| API / Proxy | Vercel Serverless Function (`/api/stock.js`) |
| Market Data | NSE India official API (via server-side proxy) |
| News | RSS feeds — NDTV Profit, Economic Times, Moneycontrol, Business Standard |
| Forex / Gold | open.er-api.com (free, no key required) |
| Deployment | Vercel |

---

## 🚀 Deploy Your Own

### 1. Clone the repo
```bash
git clone https://github.com/YOUR_USERNAME/bharat-terminal.git
cd bharat-terminal
```

### 2. Project structure
```
bharat-terminal/
├── index.html          # Entire frontend (single file)
└── api/
    └── stock.js        # Vercel serverless proxy for NSE + news + commodities
```

### 3. Deploy to Vercel
```bash
npm i -g vercel
vercel
```

That's it. No API keys. No environment variables. No database. It just works.

### 4. Local development
```bash
vercel dev
```
Then open `http://localhost:3000`

---

## 📡 API Endpoints

All proxied through `/api/stock` to avoid CORS:

| Endpoint | Description |
|---|---|
| `?sym=TCS.NS&type=quote` | Live quote for any NSE stock |
| `?sym=^NSEI&type=quote` | Index quote (Nifty, Sensex, Bank Nifty) |
| `?sym=TCS.NS&type=chart&range=1y` | Historical OHLC data |
| `?sym=^NSEI,^BSESN&type=batch` | Multiple quotes in one call |
| `?type=news` | Live RSS headlines from 4 sources |
| `?type=commodities` | USD/INR and Gold spot price |
| `?type=market` | Bulk market data (NSE pre-open) |

---

## ⚡ Data Refresh Rates

| Data | Frequency |
|---|---|
| Nifty / Sensex / Bank Nifty | Every 10 seconds |
| All tracked stocks (30 stocks) | Every 10 seconds (rotating batches) |
| Sector Heatmap | Recalculated on every stock update |
| News & Intel Feed | Every 3 minutes |
| Gold / USD-INR | Every 5 minutes |
| Trending stocks (ticker tape) | Every 2 minutes |

---

## 📈 Tracked Stocks

Reliance · TCS · HDFC Bank · Infosys · ICICI Bank · SBI · Airtel · L&T · Bajaj Finance · Adani Ent · Tata Motors · Wipro · HCL Tech · Sun Pharma · NTPC · ONGC · JSW Steel · Titan · Maruti · ITC · Suzlon · Yes Bank · Waaree · Coforge · Paytm · Zomato · Kotak Bank · Axis Bank · Adani Ports · Tata Steel

---

## ⚠️ Limitations

- **Market hours only** — NSE data is live 9:15 AM – 3:30 PM IST (Mon–Fri). Outside hours, prices show last close.
- **No WebSocket** — prices poll every 10s, not true tick-by-tick streaming (requires paid data subscription)
- **NSE rate limits** — if you make too many requests, the NSE API may throttle temporarily
- **No historical intraday** — chart data is daily OHLC from NSE historical API

---

## 🤝 Contributing

PRs welcome. Ideas for improvement:

- [ ] Add MCX commodity live prices (Gold, Silver, Crude)
- [ ] F&O (futures & options) data — PCR, OI, max pain
- [ ] Portfolio tracker — add your holdings, see live P&L
- [ ] Price alerts — notify when a stock hits your target
- [ ] Dark/light theme toggle
- [ ] Mobile app (PWA)

---

## 📄 License

MIT — free to use, fork, and deploy.

---

## 🙏 Acknowledgements

- [NSE India](https://www.nseindia.com) — market data
- [NDTV Profit](https://www.ndtvprofit.com), [Economic Times](https://economictimes.com), [Moneycontrol](https://www.moneycontrol.com), [Business Standard](https://www.business-standard.com) — news feeds
- [Chart.js](https://www.chartjs.org) — charting library
- [Vercel](https://vercel.com) — hosting

---

<p align="center">Built with ❤️ for Indian retail investors 🇮🇳</p>
