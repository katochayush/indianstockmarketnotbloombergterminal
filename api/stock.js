module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sym, type = 'quote', range = '1y' } = req.query;

  const H = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.nseindia.com/',
    'X-Requested-With': 'XMLHttpRequest',
  };

  async function nseGet(path, timeout = 7000) {
    // NSE requires a session cookie — prime it first
    await fetch('https://www.nseindia.com', {
      headers: { ...H, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(4000)
    });
    const r = await fetch('https://www.nseindia.com' + path, { headers: H, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error('NSE ' + r.status + ' ' + path);
    return r.json();
  }

  // ── NEWS ──────────────────────────────────────────────────────────────────
  if (type === 'news') {
    const feeds = [
      { url: 'https://feeds.feedburner.com/ndtvprofit-latest', src: 'NDTV Profit' },
      { url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', src: 'Economic Times' },
      { url: 'https://www.moneycontrol.com/rss/marketreports.xml', src: 'Moneycontrol' },
      { url: 'https://www.business-standard.com/rss/markets-106.rss', src: 'Business Standard' },
    ];
    function xt(xml, tag) {
      const cd = xml.match(new RegExp('<'+tag+'><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></'+tag+'>', 'i'));
      if (cd) return cd[1].trim();
      const pl = xml.match(new RegExp('<'+tag+'>([^<]*)</'+tag+'>', 'i'));
      return pl ? pl[1].trim() : null;
    }
    const items = [], seen = new Set();
    for (const feed of feeds) {
      try {
        const r = await fetch(feed.url, { headers: {'User-Agent':'Mozilla/5.0','Accept':'application/rss+xml,*/*'}, signal: AbortSignal.timeout(6000) });
        if (!r.ok) continue;
        const xml = await r.text();
        for (const entry of (xml.match(/<item[\s>][\s\S]*?<\/item>/gi)||[]).slice(0,10)) {
          const title = xt(entry,'title'), link = xt(entry,'link')||xt(entry,'guid'), pubDate = xt(entry,'pubDate');
          const desc = xt(entry,'description')?.replace(/<[^>]+>/g,'').replace(/&[a-z#0-9]+;/g,' ').trim().slice(0,250);
          if (title && title.length > 8 && !title.startsWith('http')) {
            const key = title.slice(0,50).toLowerCase();
            if (!seen.has(key)) { seen.add(key); items.push({ title, link, pubDate, desc: desc||'', src: feed.src }); }
          }
        }
      } catch(e) {}
    }
    res.setHeader('Cache-Control', 's-maxage=90, stale-while-revalidate=60');
    return res.status(200).json({ items: items.slice(0,35) });
  }

  // ── MARKET BULK ─────────────────────────────────────────────────────────
  if (type === 'market') {
    try {
      // NSE equity market data — returns all active equities
      const d = await nseGet('/api/market-data-pre-open?key=NIFTY', 8000);
      const rows = (d.data||[]).map(item => {
        const q = item.detail?.preOpenMarket || item.metadata || item;
        return {
          symbol: item.metadata?.symbol || item.symbol,
          lastPrice: item.metadata?.lastPrice || item.detail?.preOpenMarket?.IEP,
          previousClose: item.metadata?.previousClose || item.metadata?.prevClose,
          tradedVolume: item.metadata?.totalTradedVolume,
          dayHigh: item.metadata?.high || item.metadata?.dayHigh,
          dayLow: item.metadata?.low || item.metadata?.dayLow,
          companyName: item.metadata?.companyName,
        };
      }).filter(r => r.symbol && r.lastPrice);
      res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=10');
      return res.status(200).json({ data: rows });
    } catch(e) {
      return res.status(500).json({ data: [], error: e.message });
    }
  }

  // ── COMMODITIES (Gold, Brent, USD/INR) ──────────────────────────────────
  if (type === 'commodities') {
    const result = {};
    try {
      // USD/INR from exchangerate-api (free, no key needed)
      const fx = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(5000) });
      if (fx.ok) { const d = await fx.json(); result.inrusd = d.rates?.INR; }
    } catch(e) {}
    try {
      // Gold spot in USD per troy oz from metals API
      const xau = await fetch('https://open.er-api.com/v6/latest/XAU', { signal: AbortSignal.timeout(5000) });
      if (xau.ok) {
        const d = await xau.json();
        const inrPerOz = d.rates?.INR;
        if (inrPerOz) result.goldPerGram = Math.round(inrPerOz / 31.1035); // INR per gram
      }
    } catch(e) {}
    try {
      // Brent crude — use NSE commodity or fallback
      const brent = await fetch('https://open.er-api.com/v6/latest/BRN', { signal: AbortSignal.timeout(3000) });
      // BRN not available in this API — skip, will show last known
    } catch(e) {}
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=120');
    return res.status(200).json(result);
  }

  // ── SINGLE / BATCH QUOTE ─────────────────────────────────────────────────
  if (!sym) return res.status(400).json({ error: 'sym required' });

  const INDEX_MAP = { '^NSEI':'NIFTY 50', '^BSESN':'NIFTY 50', '^NSEBANK':'NIFTY BANK', '^NSEMDCP50':'NIFTY MIDCAP 50' };

  function toResult(sym, p, prev, open, high, low, vol, w52h, w52l, name) {
    return { symbol:sym, longName:name||sym, shortName:name||sym, exchange:'NSE',
      regularMarketPrice:p, regularMarketPreviousClose:prev,
      regularMarketOpen:open||p, regularMarketDayHigh:high||p, regularMarketDayLow:low||p,
      regularMarketVolume:vol||null, fiftyTwoWeekHigh:w52h, fiftyTwoWeekLow:w52l };
  }

  try {
    if (type === 'batch') {
      const syms = sym.split(','), results = [];
      let allIdx = null;
      if (syms.some(s => s.startsWith('^'))) {
        try { allIdx = await nseGet('/api/allIndices', 6000); } catch(e) {}
      }
      await Promise.all(syms.map(async s => {
        try {
          const tk = s.replace(/[^A-Z0-9]/g,'');
          if (s.startsWith('^') && allIdx) {
            const name = INDEX_MAP[s]||'NIFTY 50';
            const e = (allIdx.data||[]).find(x=>x.index===name);
            if (e) { results.push(toResult(s,e.last,e.previousClose,e.open||e.last,e.dayHigh||e.last,e.dayLow||e.last,null,e.yearHigh,e.yearLow,name)); return; }
          }
          const d = await nseGet(`/api/quote-equity?symbol=${encodeURIComponent(tk)}`, 5000);
          const pd = d.priceInfo||{};
          results.push(toResult(s,pd.lastPrice,pd.previousClose,pd.open,pd.intraDayHighLow?.max,pd.intraDayHighLow?.min,pd.totalTradedVolume,d.priceInfo?.weekHighLow?.max,d.priceInfo?.weekHighLow?.min,d.info?.companyName||tk));
        } catch(e) {}
      }));
      res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
      return res.status(200).json({ quoteResponse: { result: results } });
    }

    if (type === 'chart') {
      const tk = sym.replace(/[^A-Z0-9]/g,'');
      const d = await nseGet(`/api/historical/cm/equity?symbol=${encodeURIComponent(tk)}&series=["EQ"]&from=${getFromDate(range)}&to=${getToDate()}`, 9000);
      const rows = (d.data||[]).reverse();
      return res.status(200).json({ chart: { result: [{ timestamp: rows.map(x=>Math.floor(new Date(x.CH_TIMESTAMP||x.mTIMESTAMP).getTime()/1000)), indicators: { quote: [{ close: rows.map(x=>x.CH_CLOSING_PRICE||x.CH_LAST_TRADED_PRICE) }] } }] } });
    }

    // Single quote
    const tk = sym.replace(/[^A-Z0-9]/g,'');
    if (sym.startsWith('^')) {
      const d = await nseGet('/api/allIndices', 5000);
      const name = INDEX_MAP[sym]||'NIFTY 50';
      const e = (d.data||[]).find(x=>x.index===name);
      if (!e) throw new Error('Index not found: '+name);
      res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
      return res.status(200).json({ quoteResponse: { result: [toResult(sym,e.last,e.previousClose,e.open||e.last,e.dayHigh||e.last,e.dayLow||e.last,null,e.yearHigh,e.yearLow,name)] } });
    }
    const d = await nseGet(`/api/quote-equity?symbol=${encodeURIComponent(tk)}`, 6000);
    const pd = d.priceInfo||{};
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
    return res.status(200).json({ quoteResponse: { result: [toResult(sym,pd.lastPrice,pd.previousClose,pd.open,pd.intraDayHighLow?.max,pd.intraDayHighLow?.min,pd.totalTradedVolume,d.priceInfo?.weekHighLow?.max,d.priceInfo?.weekHighLow?.min,d.info?.companyName||tk)] } });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};

function getToDate(){ const d=new Date(); return pad(d.getDate())+'-'+pad(d.getMonth()+1)+'-'+d.getFullYear(); }
function getFromDate(r){ const d=new Date(),m={'1d':()=>d.setDate(d.getDate()-2),'5d':()=>d.setDate(d.getDate()-5),'1mo':()=>d.setMonth(d.getMonth()-1),'3mo':()=>d.setMonth(d.getMonth()-3),'6mo':()=>d.setMonth(d.getMonth()-6)}; (m[r]||function(){d.setFullYear(d.getFullYear()-1)})(); return pad(d.getDate())+'-'+pad(d.getMonth()+1)+'-'+d.getFullYear(); }
function pad(n){ return String(n).padStart(2,'0'); }
