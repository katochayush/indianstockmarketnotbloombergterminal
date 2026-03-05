module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sym, type = 'quote', range = '1y', interval = '1d' } = req.query;

  const H = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.nseindia.com/',
  };

  // ── NEWS FEED ─────────────────────────────────────────────────────────────
  if (type === 'news') {
    const RSS_FEEDS = [
      'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
      'https://www.moneycontrol.com/rss/marketreports.xml',
      'https://feeds.feedburner.com/ndtvprofit-latest',
      'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms',
    ];
    const items = [];
    for (const url of RSS_FEEDS) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
        const xml = await r.text();
        const entries = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
        entries.slice(0, 8).forEach(entry => {
          const title   = (entry.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || entry.match(/<title>(.*?)<\/title>/))?.[1]?.trim();
          const link    = (entry.match(/<link>(.*?)<\/link>/) || entry.match(/<guid>(.*?)<\/guid>/))?.[1]?.trim();
          const pubDate = entry.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim();
          const desc    = (entry.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || entry.match(/<description>(.*?)<\/description>/))?.[1]
                          ?.replace(/<[^>]+>/g,'')?.trim()?.slice(0,200);
          if (title && title.length > 10) {
            items.push({ title, link, pubDate, desc, src: new URL(url).hostname.replace('www.','').replace('feeds.feedburner.com','ndtv') });
          }
        });
      } catch(e) {}
    }
    // Deduplicate by title
    const seen = new Set();
    const unique = items.filter(i => { const k = i.title.slice(0,40); if(seen.has(k)) return false; seen.add(k); return true; });
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
    return res.status(200).json({ items: unique.slice(0, 30) });
  }

  // ── STOCK QUOTE / CHART ───────────────────────────────────────────────────
  if (!sym) return res.status(400).json({ error: 'sym required' });

  const ticker = sym.replace('.NS','').replace('.BO','').replace('^','');
  const isIndex = sym.startsWith('^');

  const INDEX_MAP = {
    '^NSEI':    'NIFTY 50',
    '^BSESN':   'NIFTY 50',  // fallback
    '^NSEBANK': 'NIFTY BANK',
    '^NSEMDCP50': 'NIFTY MIDCAP 50',
  };

  try {
    if (type === 'batch') {
      // Batch quote for header indices + commodities
      const syms = sym.split(',');
      const results = [];
      for (const s of syms) {
        const tk = s.replace('.NS','').replace('.BO','').replace('^','');
        const isIdx = s.startsWith('^');
        try {
          if (isIdx) {
            await fetch('https://www.nseindia.com', { headers: H, signal: AbortSignal.timeout(3000) });
            const r = await fetch('https://www.nseindia.com/api/allIndices', { headers: H, signal: AbortSignal.timeout(5000) });
            if (r.ok) {
              const d = await r.json();
              const idxName = INDEX_MAP[s];
              const entry = (d.data||[]).find(x => x.index === idxName);
              if (entry) {
                results.push({
                  symbol: s, longName: idxName, shortName: idxName, exchange: 'NSE',
                  regularMarketPrice: entry.last,
                  regularMarketPreviousClose: entry.previousClose || entry.yearLow,
                  regularMarketOpen: entry.open || entry.last,
                  regularMarketDayHigh: entry.dayHigh || entry.last,
                  regularMarketDayLow: entry.dayLow || entry.last,
                  regularMarketVolume: null,
                  fiftyTwoWeekHigh: entry.yearHigh, fiftyTwoWeekLow: entry.yearLow,
                });
                continue;
              }
            }
          }
          // Equity quote
          const r = await fetch(`https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(tk)}`, { headers: H, signal: AbortSignal.timeout(5000) });
          if (r.ok) {
            const d = await r.json();
            const pd = d.priceInfo || {};
            results.push({
              symbol: s, longName: d.info?.companyName || tk, shortName: tk, exchange: 'NSE',
              regularMarketPrice: pd.lastPrice,
              regularMarketPreviousClose: pd.previousClose || pd.close,
              regularMarketOpen: pd.open,
              regularMarketDayHigh: pd.intraDayHighLow?.max || pd.dayHigh,
              regularMarketDayLow: pd.intraDayHighLow?.min || pd.dayLow,
              regularMarketVolume: pd.totalTradedVolume,
              fiftyTwoWeekHigh: d.priceInfo?.weekHighLow?.max,
              fiftyTwoWeekLow: d.priceInfo?.weekHighLow?.min,
            });
          }
        } catch(e) {}
      }
      res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
      return res.status(200).json({ quoteResponse: { result: results } });
    }

    if (type === 'chart') {
      // Historical chart data from NSE
      await fetch('https://www.nseindia.com', { headers: H, signal: AbortSignal.timeout(3000) });
      const chartUrl = `https://www.nseindia.com/api/historical/cm/equity?symbol=${encodeURIComponent(ticker)}&series=["EQ"]&from=${getFromDate(range)}&to=${getToDate()}`;
      const r = await fetch(chartUrl, { headers: H, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const d = await r.json();
        const rows = (d.data || []).reverse();
        return res.status(200).json({
          chart: { result: [{
            timestamp: rows.map(x => Math.floor(new Date(x.CH_TIMESTAMP || x.mTIMESTAMP).getTime()/1000)),
            indicators: { quote: [{ close: rows.map(x => x.CH_CLOSING_PRICE || x.CH_LAST_TRADED_PRICE) }] }
          }]}
        });
      }
      return res.status(404).json({ error: 'Chart not available' });
    }

    // Single quote
    if (isIndex) {
      await fetch('https://www.nseindia.com', { headers: H, signal: AbortSignal.timeout(3000) });
      const r = await fetch('https://www.nseindia.com/api/allIndices', { headers: H, signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error('NSE indices error');
      const d = await r.json();
      const idxName = INDEX_MAP[sym] || 'NIFTY 50';
      const entry = (d.data||[]).find(x => x.index === idxName);
      if (!entry) throw new Error('Index not found: ' + idxName);
      res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
      return res.status(200).json({ quoteResponse: { result: [{
        symbol: sym, longName: idxName, shortName: idxName, exchange: 'NSE',
        regularMarketPrice: entry.last,
        regularMarketPreviousClose: entry.previousClose,
        regularMarketOpen: entry.open || entry.last,
        regularMarketDayHigh: entry.dayHigh || entry.last,
        regularMarketDayLow: entry.dayLow || entry.last,
        regularMarketVolume: null,
        fiftyTwoWeekHigh: entry.yearHigh, fiftyTwoWeekLow: entry.yearLow,
      }]}});
    }

    // Equity
    await fetch('https://www.nseindia.com', { headers: H, signal: AbortSignal.timeout(3000) });
    const r = await fetch(`https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(ticker)}`, { headers: H, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('NSE equity error ' + r.status);
    const d = await r.json();
    const pd = d.priceInfo || {};
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
    return res.status(200).json({ quoteResponse: { result: [{
      symbol: sym,
      longName: d.info?.companyName || ticker,
      shortName: d.info?.companyName || ticker,
      exchange: 'NSE',
      regularMarketPrice: pd.lastPrice,
      regularMarketPreviousClose: pd.previousClose || pd.close,
      regularMarketOpen: pd.open,
      regularMarketDayHigh: pd.intraDayHighLow?.max,
      regularMarketDayLow: pd.intraDayHighLow?.min,
      regularMarketVolume: pd.totalTradedVolume,
      fiftyTwoWeekHigh: d.priceInfo?.weekHighLow?.max,
      fiftyTwoWeekLow: d.priceInfo?.weekHighLow?.min,
      marketCap: null, trailingPE: null,
    }]}});

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};

function getToDate() {
  const d = new Date(); return `${d.getDate().toString().padStart(2,'0')}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getFullYear()}`;
}
function getFromDate(range) {
  const d = new Date();
  if (range === '1d') d.setDate(d.getDate()-1);
  else if (range === '5d') d.setDate(d.getDate()-5);
  else if (range === '1mo') d.setMonth(d.getMonth()-1);
  else if (range === '3mo') d.setMonth(d.getMonth()-3);
  else if (range === '6mo') d.setMonth(d.getMonth()-6);
  else d.setFullYear(d.getFullYear()-1);
  return `${d.getDate().toString().padStart(2,'0')}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getFullYear()}`;
}
