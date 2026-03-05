module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sym, type = 'quote', range = '1y', interval = '1d' } = req.query;

  const H = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.nseindia.com/',
  };

  // ── NEWS ──────────────────────────────────────────────────────────────────
  if (type === 'news') {
    const RSS_FEEDS = [
      { url: 'https://feeds.feedburner.com/ndtvprofit-latest', src: 'NDTV Profit' },
      { url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', src: 'Economic Times' },
      { url: 'https://www.moneycontrol.com/rss/marketreports.xml', src: 'Moneycontrol' },
      { url: 'https://www.business-standard.com/rss/markets-106.rss', src: 'Business Standard' },
    ];

    function extractTag(xml, tag) {
      // Try CDATA first, then plain
      const cdataRe = new RegExp('<' + tag + '><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' + tag + '>', 'i');
      const plainRe = new RegExp('<' + tag + '>([^<]*)<\\/' + tag + '>', 'i');
      const cd = xml.match(cdataRe);
      if (cd) return cd[1].trim();
      const pl = xml.match(plainRe);
      return pl ? pl[1].trim() : null;
    }

    const items = [];
    for (const feed of RSS_FEEDS) {
      try {
        const r = await fetch(feed.url, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
          signal: AbortSignal.timeout(6000)
        });
        if (!r.ok) continue;
        const xml = await r.text();
        const entries = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
        for (const entry of entries.slice(0, 10)) {
          const title   = extractTag(entry, 'title');
          const link    = extractTag(entry, 'link') || extractTag(entry, 'guid');
          const pubDate = extractTag(entry, 'pubDate');
          const desc    = extractTag(entry, 'description')?.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').trim().slice(0, 250);
          if (title && title.length > 8 && !title.startsWith('http')) {
            items.push({ title, link, pubDate, desc: desc || '', src: feed.src });
          }
        }
      } catch(e) {}
    }

    // Deduplicate
    const seen = new Set();
    const unique = items.filter(i => {
      const k = i.title.slice(0, 50).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });

    res.setHeader('Cache-Control', 's-maxage=90, stale-while-revalidate=60');
    return res.status(200).json({ items: unique.slice(0, 35) });
  }

  // ── STOCK QUOTE / CHART ───────────────────────────────────────────────────
  if (!sym) return res.status(400).json({ error: 'sym required' });

  const ticker  = sym.replace('.NS','').replace('.BO','').replace('^','');
  const isIndex = sym.startsWith('^');
  const INDEX_MAP = { '^NSEI':'NIFTY 50','^BSESN':'NIFTY 50','^NSEBANK':'NIFTY BANK','^NSEMDCP50':'NIFTY MIDCAP 50' };

  try {
    if (type === 'batch') {
      const syms = sym.split(',');
      const results = [];
      // Fetch indices from allIndices in one call
      let allIdx = null;
      const hasIdx = syms.some(s => s.startsWith('^'));
      if (hasIdx) {
        try {
          await fetch('https://www.nseindia.com', { headers: H, signal: AbortSignal.timeout(3000) });
          const r = await fetch('https://www.nseindia.com/api/allIndices', { headers: H, signal: AbortSignal.timeout(6000) });
          if (r.ok) allIdx = await r.json();
        } catch(e) {}
      }
      for (const s of syms) {
        try {
          const tk = s.replace('.NS','').replace('.BO','').replace('^','');
          if (s.startsWith('^') && allIdx) {
            const idxName = INDEX_MAP[s];
            const entry = (allIdx.data||[]).find(x => x.index === idxName);
            if (entry) { results.push(toResult(s, entry.last, entry.previousClose, entry.open, entry.dayHigh, entry.dayLow, null, entry.yearHigh, entry.yearLow, idxName)); continue; }
          }
          const r = await fetch(`https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(tk)}`, { headers: H, signal: AbortSignal.timeout(5000) });
          if (r.ok) {
            const d = await r.json(); const pd = d.priceInfo||{};
            results.push(toResult(s, pd.lastPrice, pd.previousClose, pd.open, pd.intraDayHighLow?.max, pd.intraDayHighLow?.min, pd.totalTradedVolume, d.priceInfo?.weekHighLow?.max, d.priceInfo?.weekHighLow?.min, d.info?.companyName||tk));
          }
        } catch(e) {}
      }
      res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
      return res.status(200).json({ quoteResponse: { result: results } });
    }

    if (type === 'chart') {
      await fetch('https://www.nseindia.com', { headers: H, signal: AbortSignal.timeout(3000) });
      const from = getFromDate(range), to = getToDate();
      const url = `https://www.nseindia.com/api/historical/cm/equity?symbol=${encodeURIComponent(ticker)}&series=["EQ"]&from=${from}&to=${to}`;
      const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const d = await r.json();
        const rows = (d.data||[]).reverse();
        return res.status(200).json({ chart: { result: [{ timestamp: rows.map(x=>Math.floor(new Date(x.CH_TIMESTAMP||x.mTIMESTAMP).getTime()/1000)), indicators: { quote: [{ close: rows.map(x=>x.CH_CLOSING_PRICE||x.CH_LAST_TRADED_PRICE) }] } }] } });
      }
      return res.status(404).json({ error: 'Chart not available' });
    }

    // Single quote
    if (isIndex) {
      await fetch('https://www.nseindia.com', { headers: H, signal: AbortSignal.timeout(3000) });
      const r = await fetch('https://www.nseindia.com/api/allIndices', { headers: H, signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error('NSE ' + r.status);
      const d = await r.json();
      const entry = (d.data||[]).find(x => x.index === (INDEX_MAP[sym]||'NIFTY 50'));
      if (!entry) throw new Error('Index not found');
      res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
      return res.status(200).json({ quoteResponse: { result: [toResult(sym, entry.last, entry.previousClose, entry.open, entry.dayHigh, entry.dayLow, null, entry.yearHigh, entry.yearLow, INDEX_MAP[sym]||sym)] } });
    }

    await fetch('https://www.nseindia.com', { headers: H, signal: AbortSignal.timeout(3000) });
    const r = await fetch(`https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(ticker)}`, { headers: H, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('NSE ' + r.status);
    const d = await r.json(); const pd = d.priceInfo||{};
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
    return res.status(200).json({ quoteResponse: { result: [toResult(sym, pd.lastPrice, pd.previousClose, pd.open, pd.intraDayHighLow?.max, pd.intraDayHighLow?.min, pd.totalTradedVolume, d.priceInfo?.weekHighLow?.max, d.priceInfo?.weekHighLow?.min, d.info?.companyName||ticker)] } });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};

function toResult(sym, price, prev, open, high, low, vol, w52h, w52l, name) {
  return { symbol:sym, longName:name, shortName:name, exchange:'NSE',
    regularMarketPrice:price, regularMarketPreviousClose:prev,
    regularMarketOpen:open, regularMarketDayHigh:high, regularMarketDayLow:low,
    regularMarketVolume:vol||null, fiftyTwoWeekHigh:w52h, fiftyTwoWeekLow:w52l,
    marketCap:null, trailingPE:null };
}
function getToDate(){ const d=new Date(); return pad(d.getDate())+'-'+pad(d.getMonth()+1)+'-'+d.getFullYear(); }
function getFromDate(range){ const d=new Date(); const m={
  '1d':()=>d.setDate(d.getDate()-1),'5d':()=>d.setDate(d.getDate()-5),
  '1mo':()=>d.setMonth(d.getMonth()-1),'3mo':()=>d.setMonth(d.getMonth()-3),
  '6mo':()=>d.setMonth(d.getMonth()-6)
}; (m[range]||function(){d.setFullYear(d.getFullYear()-1)})(); return pad(d.getDate())+'-'+pad(d.getMonth()+1)+'-'+d.getFullYear(); }
function pad(n){ return String(n).padStart(2,'0'); }
