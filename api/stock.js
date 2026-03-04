module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sym, type = 'quote' } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym required' });

  const ticker = sym.replace('.NS','').replace('.BO','').replace('^','');

  // NSE India official data API - no auth needed
  const NSE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.nseindia.com/',
    'Connection': 'keep-alive',
  };

  // NSE index symbols
  const INDEX_MAP = {
    '^NSEI':    'NIFTY 50',
    '^BSESN':   null, // BSE not on NSE API
    '^NSEBANK': 'NIFTY BANK',
  };

  try {
    // First get session cookies (NSE requires this)
    await fetch('https://www.nseindia.com', { headers: NSE_HEADERS });

    let quoteUrl;
    const isIndex = sym.startsWith('^');

    if (isIndex && INDEX_MAP[sym]) {
      quoteUrl = `https://www.nseindia.com/api/allIndices`;
    } else if (isIndex) {
      // BSE Sensex fallback - use BSE API
      quoteUrl = `https://api.bseindia.com/BseIndiaAPI/api/GetSensexData/w`;
    } else {
      quoteUrl = `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(ticker)}`;
    }

    const r = await fetch(quoteUrl, { headers: NSE_HEADERS });
    if (!r.ok) throw new Error(`NSE returned ${r.status}`);
    const data = await r.json();

    let price, prev, open, high, low, vol, name;

    if (isIndex && INDEX_MAP[sym]) {
      const indexName = INDEX_MAP[sym];
      const entry = (data.data || []).find(d => d.index === indexName);
      if (!entry) throw new Error(`Index ${indexName} not found`);
      price = entry.last;
      prev  = entry.previousClose || entry.last * 0.99;
      open  = entry.open || price;
      high  = entry.dayHigh || price;
      low   = entry.dayLow  || price;
      name  = indexName;
    } else {
      const pd = data.priceInfo || data;
      price = pd.lastPrice || pd.last;
      prev  = pd.previousClose || pd.close;
      open  = pd.open;
      high  = pd.intraDayHighLow?.max || pd.high;
      low   = pd.intraDayHighLow?.min || pd.low;
      vol   = pd.totalTradedVolume || pd.volume;
      name  = data.info?.companyName || ticker;
    }

    const w52h = data.priceInfo?.weekHighLow?.max || high * 1.2;
    const w52l = data.priceInfo?.weekHighLow?.min || low  * 0.8;

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({
      quoteResponse: {
        result: [{
          symbol: sym,
          longName: name,
          shortName: name,
          exchange: 'NSE',
          regularMarketPrice:         price,
          regularMarketPreviousClose: prev,
          regularMarketOpen:          open,
          regularMarketDayHigh:       high,
          regularMarketDayLow:        low,
          regularMarketVolume:        vol || null,
          fiftyTwoWeekHigh:           w52h,
          fiftyTwoWeekLow:            w52l,
          marketCap:                  null,
          trailingPE:                 null,
        }]
      }
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
