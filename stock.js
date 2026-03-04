// Vercel serverless function — proxies Yahoo Finance with no CORS issues
// Deployed at /api/stock?sym=TCS.NS&type=quote|chart&range=1y&interval=1d

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { sym, type = 'quote', range = '1y', interval = '1d' } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym required' });

  const YF = 'https://query1.finance.yahoo.com';
  let url;

  if (type === 'chart') {
    url = `${YF}/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=false`;
  } else if (type === 'batch') {
    // sym is comma-separated list of symbols
    url = `${YF}/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=regularMarketPrice,regularMarketPreviousClose,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,marketCap,trailingPE,fiftyTwoWeekHigh,fiftyTwoWeekLow,shortName,longName,exchange`;
  } else {
    url = `${YF}/v7/finance/quote?symbols=${encodeURIComponent(sym)}&fields=regularMarketPrice,regularMarketPreviousClose,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,regularMarketVolume,marketCap,trailingPE,fiftyTwoWeekHigh,fiftyTwoWeekLow,shortName,longName,exchange`;
  }

  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!r.ok) return res.status(r.status).json({ error: `Yahoo returned ${r.status}` });
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
