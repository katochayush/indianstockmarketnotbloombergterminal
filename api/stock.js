// Vercel serverless proxy for Yahoo Finance
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sym, type = 'quote', range = '1y', interval = '1d' } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym required' });

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Origin': 'https://finance.yahoo.com',
    'Referer': 'https://finance.yahoo.com/',
  };

  const fields = [
    'regularMarketPrice','regularMarketPreviousClose','regularMarketOpen',
    'regularMarketDayHigh','regularMarketDayLow','regularMarketVolume',
    'marketCap','trailingPE','fiftyTwoWeekHigh','fiftyTwoWeekLow',
    'shortName','longName','exchange','symbol'
  ].join(',');

  let url;
  if (type === 'chart') {
    url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`;
  } else {
    // quote or batch — v7 handles multiple comma-separated symbols
    url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=${fields}&formatted=false&lang=en-US&region=US`;
  }

  try {
    const r = await fetch(url, { headers });
    
    if (!r.ok) {
      // Try query2 as fallback
      const url2 = url.replace('query1.finance.yahoo.com', 'query2.finance.yahoo.com');
      const r2 = await fetch(url2, { headers });
      if (!r2.ok) return res.status(r2.status).json({ error: `Yahoo returned ${r2.status}` });
      const data2 = await r2.json();
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.status(200).json(data2);
    }

    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
