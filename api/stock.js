module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sym, type = 'quote', range = '1y', interval = '1d' } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym required' });

  const headers = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com/',
    'Origin': 'https://finance.yahoo.com',
    'Cache-Control': 'no-cache',
  };

  const fields = 'regularMarketPrice,regularMarketPreviousClose,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,marketCap,trailingPE,fiftyTwoWeekHigh,fiftyTwoWeekLow,shortName,longName,exchange,symbol';

  // Build URL — batch quote uses comma-separated syms, chart uses single sym
  const url = type === 'chart'
    ? `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`
    : `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=${fields}&formatted=false&lang=en-US&region=US&corsDomain=finance.yahoo.com`;

  // Try query1 first, fall back to query2
  for (const base of ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']) {
    const tryUrl = url.replace('https://query1.finance.yahoo.com', base);
    try {
      const r = await fetch(tryUrl, { headers });
      if (r.ok) {
        const data = await r.json();
        res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
        return res.status(200).json(data);
      }
      console.log(`${base} returned ${r.status}`);
    } catch (e) {
      console.log(`${base} threw: ${e.message}`);
    }
  }

  return res.status(502).json({ error: 'Yahoo Finance unavailable from server' });
};
