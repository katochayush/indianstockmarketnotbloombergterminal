module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { sym, type = 'quote', range = '1y' } = req.query;

  const H = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.nseindia.com/',
    'X-Requested-With': 'XMLHttpRequest',
  };

  function toNSETicker(s) {
    return (s || '').replace(/\.NS$/i,'').replace(/\.BO$/i,'').replace(/^\^/,'').toUpperCase().trim();
  }

  async function nseGet(path, timeout) {
    timeout = timeout || 7000;
    await fetch('https://www.nseindia.com', {
      headers: { ...H, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(4000),
    }).catch(() => {});
    const r = await fetch('https://www.nseindia.com' + path, { headers: H, signal: AbortSignal.timeout(timeout) });
    if (!r.ok) throw new Error('NSE ' + r.status + ' ' + path);
    return r.json();
  }

  function toResult(symbol, p, prev, open, high, low, vol, w52h, w52l, name) {
    return { symbol, longName:name||symbol, shortName:name||symbol, exchange:'NSE',
      regularMarketPrice:p, regularMarketPreviousClose:prev,
      regularMarketOpen:open||p, regularMarketDayHigh:high||p, regularMarketDayLow:low||p,
      regularMarketVolume:vol||null, fiftyTwoWeekHigh:w52h||null, fiftyTwoWeekLow:w52l||null };
  }

  const INDEX_MAP = {
    '^NSEI':'NIFTY 50','^BSESN':'NIFTY 50',
    '^NSEBANK':'NIFTY BANK','^NSEMDCP50':'NIFTY MIDCAP 50',
  };

  // ── NEWS ──────────────────────────────────────────────────────────────────
  if (type === 'news') {
    const feeds = [
      { url:'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', src:'Economic Times' },
      { url:'https://www.business-standard.com/rss/markets-106.rss', src:'Business Standard' },
      { url:'https://www.livemint.com/rss/markets', src:'Livemint' },
      { url:'https://feeds.feedburner.com/ndtvprofit-latest', src:'NDTV Profit' },
      { url:'https://www.financialexpress.com/market/feed/', src:'Financial Express' },
      // Moneycontrol: use latest news feed instead of stale marketreports
      { url:'https://www.moneycontrol.com/rss/latestnews.xml', src:'Moneycontrol' },
    ];
    function xt(xml, tag) {
      const cd = xml.match(new RegExp('<'+tag+'><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></'+tag+'>','i'));
      if (cd) return cd[1].trim();
      const pl = xml.match(new RegExp('<'+tag+'>([^<]*)</'+tag+'>','i'));
      return pl ? pl[1].trim() : null;
    }
    const items=[], seen=new Set();
    const now = Date.now();
    const MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours — drop anything older

    for (const feed of feeds) {
      try {
        const r = await fetch(feed.url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/rss+xml,*/*'},signal:AbortSignal.timeout(6000)});
        if (!r.ok) continue;
        const xml = await r.text();
        for (const entry of (xml.match(/<item[\s>][\s\S]*?<\/item>/gi)||[]).slice(0,15)) {
          const title=xt(entry,'title'), link=xt(entry,'link')||xt(entry,'guid'), pubDate=xt(entry,'pubDate');
          const desc=xt(entry,'description')?.replace(/<[^>]+>/g,'').replace(/&[a-z#0-9]+;/g,' ').trim().slice(0,250);
          if (!title || title.length<=8 || title.startsWith('http')) continue;

          // Age filter — skip articles older than 48 hours
          if (pubDate) {
            const age = now - new Date(pubDate).getTime();
            if (!isNaN(age) && age > MAX_AGE_MS) continue;
          }

          const key=title.slice(0,50).toLowerCase();
          if (!seen.has(key)){
            seen.add(key);
            items.push({ title, link, pubDate, desc:desc||'', src:feed.src, ts: pubDate ? new Date(pubDate).getTime() : 0 });
          }
        }
      } catch(e){}
    }

    // Sort newest first
    items.sort((a,b) => (b.ts||0) - (a.ts||0));

    res.setHeader('Cache-Control','s-maxage=90, stale-while-revalidate=60');
    return res.status(200).json({items:items.slice(0,35)});
  }

  // ── COMMODITIES — Gold (GC=F), Silver (SI=F), Brent (BZ=F), USD/INR ──────
  if (type === 'commodities') {
    const result = {};
    const yhFetch = async (ticker) => {
      const r = await fetch(
        'https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1d&range=1d',
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) }
      );
      if (!r.ok) throw new Error(ticker + ' ' + r.status);
      const d = await r.json();
      return d?.chart?.result?.[0]?.meta?.regularMarketPrice;
    };

    // USD/INR from Yahoo Finance (most reliable)
    try {
      const p = await yhFetch('USDINR=X');
      if (p) result.inrusd = +p.toFixed(4);
    } catch(e) {
      // fallback: open.er-api.com
      try {
        const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(5000) });
        if (r.ok) { const d = await r.json(); if (d.rates?.INR) result.inrusd = +d.rates.INR.toFixed(4); }
      } catch(e2) {}
    }

    // Gold: Yahoo Finance GC=F gives USD/troy oz → convert to INR/gram
    try {
      const goldUSD = await yhFetch('GC=F'); // USD per troy oz
      if (goldUSD && result.inrusd) {
        result.goldPerGram = +(goldUSD / 31.1035 * result.inrusd).toFixed(2); // INR per gram (international)
      } else if (goldUSD) {
        result.goldPerGram = +(goldUSD / 31.1035 * 84).toFixed(2); // assume 84 INR/USD if fetch failed
      }
    } catch(e) {
      // fallback: open.er-api.com XAU
      try {
        const r = await fetch('https://open.er-api.com/v6/latest/XAU', { signal: AbortSignal.timeout(5000) });
        if (r.ok) { const d = await r.json(); if (d.rates?.INR) result.goldPerGram = +(d.rates.INR / 31.1035).toFixed(2); }
      } catch(e2) {}
    }

    // Silver: Yahoo Finance SI=F gives USD/troy oz → INR/gram
    try {
      const silverUSD = await yhFetch('SI=F');
      if (silverUSD && result.inrusd) {
        result.silverPerGram = +(silverUSD / 31.1035 * result.inrusd).toFixed(4);
      } else if (silverUSD) {
        result.silverPerGram = +(silverUSD / 31.1035 * 84).toFixed(4);
      }
    } catch(e) {
      try {
        const r = await fetch('https://open.er-api.com/v6/latest/XAG', { signal: AbortSignal.timeout(5000) });
        if (r.ok) { const d = await r.json(); if (d.rates?.INR) result.silverPerGram = +(d.rates.INR / 31.1035).toFixed(4); }
      } catch(e2) {}
    }

    // Brent crude via Yahoo Finance BZ=F
    try {
      const p = await yhFetch('BZ=F');
      if (p) result.brent = +p.toFixed(2);
    } catch(e) {}

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    return res.status(200).json(result);
  }

  // ── CORPORATE ANNOUNCEMENTS ─────────────────────────────────────────────────
  if (type === 'announcements') {
    const tk = toNSETicker(sym || 'TCS');
    try {
      const d = await nseGet(`/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(tk)}&from_date=&to_date=`, 8000);
      const items = (d.data || []).slice(0, 6).map(a => ({
        sym:     tk,
        subject: (a.subject || a.desc || '').slice(0, 120),
        date:    a.an_dt ? new Date(a.an_dt).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : '',
        desc:    (a.attchmntText || a.subject || '').slice(0, 200),
      }));
      res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
      return res.status(200).json({ items });
    } catch(e) {
      // fallback: NSE board meetings endpoint
      try {
        const d = await nseGet(`/api/upcoming-board-meetings?type=&from_date=&to_date=&symbol=${encodeURIComponent(tk)}`, 6000);
        const items = (d.data || []).slice(0, 4).map(a => ({
          sym:     tk,
          subject: (a.purpose || 'Board Meeting').slice(0, 120),
          date:    a.meeting_date ? new Date(a.meeting_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short'}) : '',
          desc:    (a.purpose || '').slice(0, 200),
        }));
        res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60');
        return res.status(200).json({ items });
      } catch(e2) {
        return res.status(200).json({ items: [] });
      }
    }
  }

  // ── F&O OPTION CHAIN ──────────────────────────────────────────────────────
  if (type === 'fno') {
    const fnoSym = (sym || 'NIFTY').toUpperCase();

    // ── Source 1: Yahoo Finance option chain (most reliable from server) ──
    try {
      const yhSym = fnoSym === 'NIFTY'     ? '^NSEI'
                  : fnoSym === 'BANKNIFTY' ? '^NSEBANK'
                  : fnoSym === 'FINNIFTY'  ? '^NSMIDCP'
                  : fnoSym + '.NS';

      const r = await fetch(
        `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(yhSym)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
      );
      if (!r.ok) throw new Error('YH options ' + r.status);
      const d = await r.json();
      const result  = d?.optionChain?.result?.[0];
      if (!result)  throw new Error('no option chain result');

      const spot    = result.quote?.regularMarketPrice || 0;
      const expiries = result.expirationDates || [];
      const options  = result.options?.[0] || {};
      const calls    = options.calls || [];
      const puts     = options.puts  || [];

      // Normalise to NSE-style records format
      const records = {
        underlyingValue: spot,
        expiryDates: expiries.map(ts => new Date(ts * 1000).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })),
        data: [],
      };

      // Merge calls + puts by strike
      const strikeMap = {};
      calls.forEach(c => {
        const s = c.strike;
        if (!strikeMap[s]) strikeMap[s] = { strikePrice: s };
        strikeMap[s].CE = {
          openInterest:       c.openInterest       || 0,
          changeinOpenInterest: c.change            || 0,
          totalTradedVolume:  c.volume              || 0,
          impliedVolatility:  c.impliedVolatility   || 0,
          lastPrice:          c.lastPrice           || 0,
          change:             c.change              || 0,
          pChange:            c.percentChange       || 0,
          bidQty: c.bid || 0, askQty: c.ask || 0,
          strikePrice: s, expiryDate: c.expiration ? new Date(c.expiration*1000).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '',
        };
      });
      puts.forEach(p => {
        const s = p.strike;
        if (!strikeMap[s]) strikeMap[s] = { strikePrice: s };
        strikeMap[s].PE = {
          openInterest:       p.openInterest       || 0,
          changeinOpenInterest: p.change            || 0,
          totalTradedVolume:  p.volume              || 0,
          impliedVolatility:  p.impliedVolatility   || 0,
          lastPrice:          p.lastPrice           || 0,
          change:             p.change              || 0,
          pChange:            p.percentChange       || 0,
          bidQty: p.bid || 0, askQty: p.ask || 0,
          strikePrice: s, expiryDate: p.expiration ? new Date(p.expiration*1000).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '',
        };
      });

      records.data = Object.values(strikeMap).sort((a,b) => a.strikePrice - b.strikePrice);

      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
      return res.status(200).json({ records, source: 'yahoo' });
    } catch(yhErr) {
      // ── Source 2: NSE (may fail from Vercel IPs due to bot detection) ──
      try {
        const endpoint = ['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY'].includes(fnoSym)
          ? `/api/option-chain-indices?symbol=${encodeURIComponent(fnoSym)}`
          : `/api/option-chain-equities?symbol=${encodeURIComponent(fnoSym)}`;
        const d = await nseGet(endpoint, 12000);
        res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=15');
        return res.status(200).json({ ...d, source: 'nse' });
      } catch(nseErr) {
        // Both failed — return error so frontend uses its model with a clear label
        return res.status(500).json({ error: 'Both Yahoo and NSE unavailable: ' + nseErr.message, fallback: true });
      }
    }
  }

  // ── SCREENER BULK — returns full NSE equity market snapshot in one call ───
  if (type === 'screener') {
    try {
      // NSE equity bhavcopy — full day snapshot for all listed stocks
      // This single call gets price/volume/52W data for every NSE stock
      const d = await nseGet('/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O', 8000);
      const fnoSyms = new Set((d.data||[]).map(r => r.symbol));

      // Get full market data from NSE equity market
      const mkt = await nseGet('/api/equity-stockIndices?index=NIFTY%20TOTAL%20MARKET', 10000);
      const rows = (mkt.data || []).map(r => {
        const sym     = r.symbol;
        const price   = r.lastPrice   || r.last   || 0;
        const prev    = r.previousClose || r.prev  || price;
        const chgPct  = prev ? ((price - prev) / prev * 100) : 0;
        const high52  = r.yearHigh  || r.weekHigh52 || null;
        const low52   = r.yearLow   || r.weekLow52  || null;
        const vol     = r.totalTradedVolume || r.quantityTraded || 0;
        const mcap    = r.ffmc || r.marketCap || null; // free float market cap
        const pe      = r.pe   || null;
        const from52h = high52 && price ? ((price - high52) / high52 * 100) : null;
        const from52l = low52  && price ? ((price - low52)  / low52  * 100) : null;
        return {
          sym, price, prev, chgPct,
          high52, low52, from52h, from52l,
          vol, mcap, pe,
          isFno: fnoSyms.has(sym),
          open:  r.open     || price,
          high:  r.dayHigh  || price,
          low:   r.dayLow   || price,
          name:  r.meta?.companyName || sym,
        };
      }).filter(r => r.sym && r.price > 0);

      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
      return res.status(200).json({ rows, ts: Date.now() });
    } catch(e) {
      // Fallback: try NIFTY 500
      try {
        const d = await nseGet('/api/equity-stockIndices?index=NIFTY%20500', 10000);
        const rows = (d.data || []).map(r => ({
          sym: r.symbol, price: r.lastPrice||0, prev: r.previousClose||r.lastPrice||0,
          chgPct: r.pChange||0, high52: r.yearHigh, low52: r.yearLow,
          from52h: r.yearHigh && r.lastPrice ? ((r.lastPrice-r.yearHigh)/r.yearHigh*100) : null,
          from52l: r.yearLow  && r.lastPrice ? ((r.lastPrice-r.yearLow) /r.yearLow *100) : null,
          vol: r.totalTradedVolume||0, mcap: r.ffmc||null, pe: r.pe||null,
          open: r.open||r.lastPrice, high: r.dayHigh||r.lastPrice, low: r.dayLow||r.lastPrice,
          name: r.meta?.companyName||r.symbol, isFno: false,
        })).filter(r => r.sym && r.price > 0);
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
        return res.status(200).json({ rows, ts: Date.now(), fallback: 'nifty500' });
      } catch(e2) {
        return res.status(500).json({ error: e.message, rows: [] });
      }
    }
  }

  // ── F&O OI DATA for screener ───────────────────────────────────────────────
  if (type === 'fno_bulk') {
    try {
      // NSE F&O participant-wise OI — gives us PCR + OI data per symbol
      const d = await nseGet('/api/equity-stockIndices?index=SECURITIES%20IN%20F%26O', 8000);
      const rows = (d.data || []).map(r => ({
        sym:    r.symbol,
        price:  r.lastPrice || 0,
        chgPct: r.pChange   || 0,
        oi:     r.openInterest      || null,
        oiChg:  r.changeinOpenInterest || null,
        vol:    r.totalTradedVolume  || 0,
      })).filter(r => r.sym && r.price > 0);
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
      return res.status(200).json({ rows });
    } catch(e) {
      return res.status(500).json({ error: e.message, rows: [] });
    }
  }

  // ── MARKET BULK ───────────────────────────────────────────────────────────
  if (type === 'market') {
    try {
      const d = await nseGet('/api/market-data-pre-open?key=NIFTY', 8000);
      const rows=(d.data||[]).map(item=>({
        symbol:item.metadata?.symbol,
        lastPrice:item.metadata?.lastPrice,
        previousClose:item.metadata?.previousClose||item.metadata?.prevClose,
        tradedVolume:item.metadata?.totalTradedVolume,
        dayHigh:item.metadata?.high,dayLow:item.metadata?.low,
        companyName:item.metadata?.companyName,
      })).filter(r=>r.symbol&&r.lastPrice);
      res.setHeader('Cache-Control','s-maxage=15, stale-while-revalidate=10');
      return res.status(200).json({data:rows});
    } catch(e) { return res.status(500).json({data:[],error:e.message}); }
  }

  if (!sym) return res.status(400).json({error:'sym required'});

  try {
    // ── BATCH ─────────────────────────────────────────────────────────────
    if (type === 'batch') {
      const syms=sym.split(','), results=[];
      let allIdx=null;
      if (syms.some(s=>s.startsWith('^'))) {
        try { allIdx=await nseGet('/api/allIndices',6000); } catch(e){}
      }
      await Promise.all(syms.map(async s=>{
        try {
          if (s.startsWith('^') && allIdx) {
            const name=INDEX_MAP[s]||'NIFTY 50';
            const e=(allIdx.data||[]).find(x=>x.index===name);
            if (e){results.push(toResult(s,e.last,e.previousClose,e.open||e.last,e.dayHigh||e.last,e.dayLow||e.last,null,e.yearHigh,e.yearLow,name));return;}
          }
          const tk=toNSETicker(s);
          const d=await nseGet(`/api/quote-equity?symbol=${encodeURIComponent(tk)}`,5000);
          const pd=d.priceInfo||{};
          results.push(toResult(s,pd.lastPrice,pd.previousClose,pd.open,pd.intraDayHighLow?.max,pd.intraDayHighLow?.min,pd.totalTradedVolume,d.priceInfo?.weekHighLow?.max,d.priceInfo?.weekHighLow?.min,d.info?.companyName||tk));
        } catch(e){}
      }));
      res.setHeader('Cache-Control','s-maxage=10, stale-while-revalidate=5');
      return res.status(200).json({quoteResponse:{result:results}});
    }

    // ── CHART ──────────────────────────────────────────────────────────────
    if (type === 'chart') {
      const tk=toNSETicker(sym);
      const interval = req.query.interval || '1d';
      const isIntraday = ['1m','5m','15m','30m','60m'].includes(interval);

      if (isIntraday) {
        // Yahoo Finance for intraday OHLCV — NSE historical doesn't support intraday
        const yhInterval = interval === '60m' ? '60m' : interval;
        const yhRange    = interval === '5m' ? '1d' : interval === '15m' ? '5d' : interval === '60m' ? '1mo' : '1d';
        const yhSym      = tk + '.NS';
        try {
          const r = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yhSym)}?interval=${yhInterval}&range=${yhRange}`,
            { headers:{'User-Agent':'Mozilla/5.0'}, signal:AbortSignal.timeout(8000) }
          );
          if (!r.ok) throw new Error('YH ' + r.status);
          const d = await r.json();
          const result = d?.chart?.result?.[0];
          if (!result) throw new Error('no result');
          const ts  = result.timestamp || [];
          const q0  = result.indicators?.quote?.[0] || {};
          res.setHeader('Cache-Control','s-maxage=30, stale-while-revalidate=15');
          return res.status(200).json({ chart:{ result:[{
            timestamp: ts,
            indicators:{ quote:[{
              open:  q0.open  || [],
              high:  q0.high  || [],
              low:   q0.low   || [],
              close: q0.close || [],
              volume:q0.volume|| [],
            }]}
          }]}});
        } catch(e) {
          // fall through to daily NSE chart below
        }
      }

      // Daily/weekly — NSE historical
      try {
        const d=await nseGet(`/api/historical/cm/equity?symbol=${encodeURIComponent(tk)}&series=["EQ"]&from=${getFromDate(range)}&to=${getToDate()}`,9000);
        const rows=(d.data||[]).reverse();
        res.setHeader('Cache-Control','s-maxage=60, stale-while-revalidate=30');
        return res.status(200).json({chart:{result:[{
          timestamp:rows.map(x=>Math.floor(new Date(x.CH_TIMESTAMP||x.mTIMESTAMP).getTime()/1000)),
          indicators:{quote:[{
            open:  rows.map(x=>x.CH_OPENING_PRICE||x.CH_LAST_TRADED_PRICE),
            high:  rows.map(x=>x.CH_TRADE_HIGH_PRICE||x.CH_LAST_TRADED_PRICE),
            low:   rows.map(x=>x.CH_TRADE_LOW_PRICE||x.CH_LAST_TRADED_PRICE),
            close: rows.map(x=>x.CH_CLOSING_PRICE||x.CH_LAST_TRADED_PRICE),
            volume:rows.map(x=>x.CH_TOT_TRADED_QTY||0),
          }]}
        }]}});
      } catch(e) {
        // Final fallback — Yahoo Finance daily
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk+'.NS')}?interval=1d&range=${range||'1y'}`,
          { headers:{'User-Agent':'Mozilla/5.0'}, signal:AbortSignal.timeout(8000) }
        );
        if (!r.ok) throw new Error('chart fallback failed');
        const d = await r.json();
        res.setHeader('Cache-Control','s-maxage=60, stale-while-revalidate=30');
        return res.status(200).json(d);
      }
    }

    // ── SINGLE QUOTE ───────────────────────────────────────────────────────
    if (sym.startsWith('^')) {
      const d=await nseGet('/api/allIndices',5000);
      const name=INDEX_MAP[sym]||'NIFTY 50';
      const e=(d.data||[]).find(x=>x.index===name);
      if (!e) throw new Error('Index not found: '+name);
      res.setHeader('Cache-Control','s-maxage=10, stale-while-revalidate=5');
      return res.status(200).json({quoteResponse:{result:[toResult(sym,e.last,e.previousClose,e.open||e.last,e.dayHigh||e.last,e.dayLow||e.last,null,e.yearHigh,e.yearLow,name)]}});
    }

    const tk=toNSETicker(sym);
    const d=await nseGet(`/api/quote-equity?symbol=${encodeURIComponent(tk)}`,6000);
    const pd=d.priceInfo||{};
    res.setHeader('Cache-Control','s-maxage=10, stale-while-revalidate=5');
    return res.status(200).json({quoteResponse:{result:[toResult(sym,pd.lastPrice,pd.previousClose,pd.open,pd.intraDayHighLow?.max,pd.intraDayHighLow?.min,pd.totalTradedVolume,d.priceInfo?.weekHighLow?.max,d.priceInfo?.weekHighLow?.min,d.info?.companyName||tk)]}});

  } catch(e) { return res.status(500).json({error:e.message}); }
};

function getToDate(){const d=new Date();return pad(d.getDate())+'-'+pad(d.getMonth()+1)+'-'+d.getFullYear();}
function getFromDate(r){const d=new Date();({'1d':()=>d.setDate(d.getDate()-2),'5d':()=>d.setDate(d.getDate()-5),'1mo':()=>d.setMonth(d.getMonth()-1),'3mo':()=>d.setMonth(d.getMonth()-3),'6mo':()=>d.setMonth(d.getMonth()-6)}[r]||function(){d.setFullYear(d.getFullYear()-1)})();return pad(d.getDate())+'-'+pad(d.getMonth()+1)+'-'+d.getFullYear();}
function pad(n){return String(n).padStart(2,'0');}
