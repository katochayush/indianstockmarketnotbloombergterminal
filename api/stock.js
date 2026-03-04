module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sym, type = 'quote' } = req.query;
  if (!sym) return res.status(400).json({ error: 'sym required' });

  // Convert Yahoo symbol to Stooq symbol
  // RELIANCE.NS -> RELIANCE.IN, ^NSEI -> ^NIF50.IN, etc.
  function toStooq(s) {
    if (s === '^NSEI')    return '^nif50.in';
    if (s === '^BSESN')   return '^bse.in';
    if (s === '^NSEBANK') return '^nifbnk.in';
    if (s === 'BZ=F')     return 'lcox.uk'; // Brent crude
    if (s === 'GC=F')     return 'xauusd';  // Gold
    if (s === 'INR=X')    return 'inrusd';
    if (s.endsWith('.NS')) return s.replace('.NS', '.in').toLowerCase();
    if (s.endsWith('.BO')) return s.replace('.BO', '.in').toLowerCase();
    return s.toLowerCase();
  }

  // Stooq CSV: https://stooq.com/q/d/l/?s=tcs.in&i=d
  // Returns CSV: Date,Open,High,Low,Close,Volume
  const stooqSym = toStooq(sym);
  const csvUrl = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSym)}&i=d`;

  try {
    const r = await fetch(csvUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!r.ok) return res.status(502).json({ error: `Stooq returned ${r.status}` });

    const csv = await r.text();
    if (!csv || csv.includes('No data') || csv.trim().split('\n').length < 3) {
      return res.status(404).json({ error: 'No data from Stooq for ' + sym });
    }

    const lines = csv.trim().split('\n').filter(l => l && !l.startsWith('Date'));
    const rows = lines.map(l => {
      const [date, open, high, low, close, volume] = l.split(',');
      return { date, open: +open, high: +high, low: +low, close: +close, volume: +volume };
    }).filter(r => r.close && !isNaN(r.close));

    if (!rows.length) return res.status(404).json({ error: 'Empty data for ' + sym });

    const latest = rows[rows.length - 1];
    const prev   = rows.length > 1 ? rows[rows.length - 2] : rows[0];
    const high52 = Math.max(...rows.slice(-252).map(r => r.high));
    const low52  = Math.min(...rows.slice(-252).map(r => r.low));

    if (type === 'chart') {
      // Return last 365 days in Yahoo chart format
      const chartRows = rows.slice(-365);
      return res.status(200).json({
        chart: {
          result: [{
            timestamp: chartRows.map(r => Math.floor(new Date(r.date).getTime() / 1000)),
            indicators: { quote: [{ close: chartRows.map(r => r.close) }] }
          }]
        }
      });
    }

    // Return in Yahoo quote format so index.html needs zero changes
    return res.status(200).json({
      quoteResponse: {
        result: [{
          symbol: sym,
          longName: sym.replace('.NS','').replace('.BO','').replace('^',''),
          shortName: sym.replace('.NS','').replace('.BO','').replace('^',''),
          exchange: sym.endsWith('.BO') ? 'BSE' : 'NSE',
          regularMarketPrice:         latest.close,
          regularMarketPreviousClose: prev.close,
          regularMarketOpen:          latest.open,
          regularMarketDayHigh:       latest.high,
          regularMarketDayLow:        latest.low,
          regularMarketVolume:        latest.volume || null,
          fiftyTwoWeekHigh:           high52,
          fiftyTwoWeekLow:            low52,
          marketCap:                  null,
          trailingPE:                 null,
        }]
      }
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
