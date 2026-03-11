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
  };

  function pad(n) { return String(n).padStart(2,'0'); }
  function toNSETicker(s) { return (s||'').replace(/\.NS$/i,'').replace(/\.BO$/i,'').replace(/^\^/,'').toUpperCase().trim(); }
  function getToDate() { const d=new Date(); return pad(d.getDate())+'-'+pad(d.getMonth()+1)+'-'+d.getFullYear(); }
  function getFromDate(r) {
    const d=new Date();
    ({'1d':()=>d.setDate(d.getDate()-2),'5d':()=>d.setDate(d.getDate()-7),'1mo':()=>d.setMonth(d.getMonth()-1),'3mo':()=>d.setMonth(d.getMonth()-3),'6mo':()=>d.setMonth(d.getMonth()-6)}[r]||function(){d.setFullYear(d.getFullYear()-1)})();
    return pad(d.getDate())+'-'+pad(d.getMonth()+1)+'-'+d.getFullYear();
  }

  async function nseSession() {
    const r = await fetch('https://www.nseindia.com/', {
      headers: {'User-Agent':H['User-Agent'],'Accept':'text/html,*/*','Accept-Language':'en-US,en;q=0.9','Upgrade-Insecure-Requests':'1'},
      signal: AbortSignal.timeout(6000), redirect: 'follow',
    });
    const raw = r.headers.get('set-cookie')||'';
    return raw.split(/,(?=\s*[a-zA-Z0-9_-]+=)/).map(c=>c.split(';')[0].trim()).filter(c=>c.includes('=')).join('; ');
  }
  async function nseGet(path, timeout) {
    const cookie = await nseSession().catch(()=>'');
    const r = await fetch('https://www.nseindia.com'+path, {
      headers:{...H,'Referer':'https://www.nseindia.com/',...(cookie?{Cookie:cookie}:{})},
      signal: AbortSignal.timeout(timeout||8000),
    });
    if(!r.ok) throw new Error('NSE '+r.status+' '+path);
    return r.json();
  }
  function toResult(symbol,p,prev,open,high,low,vol,w52h,w52l,name) {
    return {symbol,longName:name||symbol,shortName:name||symbol,exchange:'NSE',
      regularMarketPrice:p,regularMarketPreviousClose:prev,
      regularMarketOpen:open||p,regularMarketDayHigh:high||p,regularMarketDayLow:low||p,
      regularMarketVolume:vol||null,fiftyTwoWeekHigh:w52h||null,fiftyTwoWeekLow:w52l||null};
  }
  const INDEX_MAP = {'^NSEI':'NIFTY 50','^BSESN':'NIFTY 50','^NSEBANK':'NIFTY BANK','^NSEMDCP50':'NIFTY MIDCAP 50'};

  // NEWS
  if (type === 'news') {
    const feeds = ['https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms','https://www.business-standard.com/rss/markets-106.rss','https://www.moneycontrol.com/rss/marketsnews.xml'];
    const items = [];
    await Promise.allSettled(feeds.map(async url => {
      try {
        const r = await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(5000)});
        if(!r.ok) return;
        const txt = await r.text();
        const matches = txt.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);
        for(const m of matches) {
          const b=m[1];
          const title=(b.match(/<title[^>]*><!\[CDATA\[(.*?)\]\]>/s)||b.match(/<title[^>]*>(.*?)<\/title>/s)||[])[1]?.trim();
          const link=(b.match(/<link[^>]*>(.*?)<\/link>/s)||[])[1]?.trim();
          const pub=(b.match(/<pubDate[^>]*>(.*?)<\/pubDate>/s)||[])[1]?.trim();
          const desc=(b.match(/<description[^>]*><!\[CDATA\[(.*?)\]\]>/s)||b.match(/<description[^>]*>(.*?)<\/description>/s)||[])[1]?.trim();
          if(title&&link) items.push({title,link,pub,desc:desc?.replace(/<[^>]+>/g,'').slice(0,150)});
          if(items.length>=40) break;
        }
      } catch(e){}
    }));
    res.setHeader('Cache-Control','s-maxage=300,stale-while-revalidate=60');
    return res.status(200).json({items:items.slice(0,40)});
  }

  // COMMODITIES
  if (type === 'commodities') {
    const syms=['GC=F','SI=F','CL=F','BZ=F','NG=F','HG=F','ZW=F','ZC=F'];
    const results = await Promise.all(syms.map(async s => {
      try {
        const r=await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=5d`,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(6000)});
        if(!r.ok) return null;
        const d=await r.json(); const q=d?.chart?.result?.[0]?.meta;
        return q?{symbol:s,price:q.regularMarketPrice,prev:q.chartPreviousClose||q.previousClose,name:q.shortName||s}:null;
      } catch(e){return null;}
    }));
    res.setHeader('Cache-Control','s-maxage=60,stale-while-revalidate=30');
    return res.status(200).json({data:results.filter(Boolean)});
  }

  // ANNOUNCEMENTS
  if (type === 'announcements') {
    try {
      const d=await nseGet('/api/home-corporate-announcements',6000);
      res.setHeader('Cache-Control','s-maxage=300,stale-while-revalidate=60');
      return res.status(200).json(d);
    } catch(e){return res.status(200).json({data:[],error:e.message});}
  }

  // FNO
  if (type === 'fno') {
    const fnoSym=(sym||'NIFTY').toUpperCase();
    try {
      const yhSym=fnoSym==='NIFTY'?'^NSEI':fnoSym==='BANKNIFTY'?'^NSEBANK':fnoSym+'.NS';
      let d=null;
      for(const ver of ['v8','v7']) {
        try {
          const rr=await fetch(`https://query2.finance.yahoo.com/${ver}/finance/options/${encodeURIComponent(yhSym)}`,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'},signal:AbortSignal.timeout(8000)});
          if(!rr.ok) continue;
          const dd=await rr.json();
          if(dd?.optionChain?.result?.[0]){d=dd;break;}
        } catch(_){}
      }
      if(!d) throw new Error('YH options unavailable');
      const result=d.optionChain.result[0];
      const spot=result.quote?.regularMarketPrice||0;
      const expiries=result.expirationDates||[];
      const opts=result.options?.[0]||{};
      const strikeMap={};
      (opts.calls||[]).forEach(c=>{if(!strikeMap[c.strike])strikeMap[c.strike]={strikePrice:c.strike};strikeMap[c.strike].CE={openInterest:c.openInterest||0,changeinOpenInterest:c.change||0,totalTradedVolume:c.volume||0,impliedVolatility:c.impliedVolatility||0,lastPrice:c.lastPrice||0,change:c.change||0,pChange:c.percentChange||0,strikePrice:c.strike};});
      (opts.puts||[]).forEach(p=>{if(!strikeMap[p.strike])strikeMap[p.strike]={strikePrice:p.strike};strikeMap[p.strike].PE={openInterest:p.openInterest||0,changeinOpenInterest:p.change||0,totalTradedVolume:p.volume||0,impliedVolatility:p.impliedVolatility||0,lastPrice:p.lastPrice||0,change:p.change||0,pChange:p.percentChange||0,strikePrice:p.strike};});
      const data=Object.values(strikeMap).sort((a,b)=>a.strikePrice-b.strikePrice).map(s=>({strikePrice:s.strikePrice,CE:s.CE||{},PE:s.PE||{}}));
      res.setHeader('Cache-Control','s-maxage=30,stale-while-revalidate=15');
      return res.status(200).json({records:{underlyingValue:spot,expiryDates:expiries.map(ts=>new Date(ts*1000).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})),data},source:'yahoo'});
    } catch(yhErr) {
      try {
        const ep=['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY'].includes(fnoSym)?`/api/option-chain-indices?symbol=${encodeURIComponent(fnoSym)}`:`/api/option-chain-equities?symbol=${encodeURIComponent(fnoSym)}`;
        const d=await nseGet(ep,10000);
        if(!d?.records?.data?.length) throw new Error('NSE empty');
        res.setHeader('Cache-Control','s-maxage=30,stale-while-revalidate=15');
        return res.status(200).json({...d,source:'nse'});
      } catch(nseErr){return res.status(200).json({fallback:true,error:'Yahoo: '+yhErr.message+' | NSE: '+nseErr.message});}
    }
  }

  // SCREENER
  if (type === 'screener') {
    try {
      const d=await nseGet('/api/live-analysis-variations?index=gainers',8000);
      const rows=(d?.data||[]).slice(0,50).map(item=>({symbol:item.symbol,lastPrice:item.metadata?.lastPrice,previousClose:item.metadata?.previousClose||item.metadata?.prevClose,tradedVolume:item.metadata?.totalTradedVolume,dayHigh:item.metadata?.high,dayLow:item.metadata?.low,companyName:item.metadata?.companyName})).filter(r=>r.symbol&&r.lastPrice);
      res.setHeader('Cache-Control','s-maxage=15,stale-while-revalidate=10');
      return res.status(200).json({data:rows});
    } catch(e){return res.status(200).json({data:[],error:e.message});}
  }

  // MARKET
  if (type === 'market') {
    try {
      const d=await nseGet('/api/allIndices',6000);
      res.setHeader('Cache-Control','s-maxage=15,stale-while-revalidate=5');
      return res.status(200).json({data:d.data||[]});
    } catch(e){return res.status(500).json({data:[],error:e.message});}
  }

  // SECTORS — real NSE sector index performance
  if (type === 'sectors') {
    try {
      const SECTOR_INDICES = [
        {name:'Banking',   idx:'NIFTY BANK'},
        {name:'IT',        idx:'NIFTY IT'},
        {name:'Energy',    idx:'NIFTY ENERGY'},
        {name:'FMCG',      idx:'NIFTY FMCG'},
        {name:'Auto',      idx:'NIFTY AUTO'},
        {name:'Pharma',    idx:'NIFTY PHARMA'},
        {name:'Metals',    idx:'NIFTY METAL'},
        {name:'Infra',     idx:'NIFTY INFRA'},
        {name:'Realty',    idx:'NIFTY REALTY'},
        {name:'Telecom',   idx:'NIFTY MEDIA'},
        {name:'PSU Banks', idx:'NIFTY PSU BANK'},
        {name:'MidCap',    idx:'NIFTY MIDCAP 50'},
      ];
      const d = await nseGet('/api/allIndices', 7000);
      const all = d.data || [];
      const rows = SECTOR_INDICES.map(s => {
        const e = all.find(x => x.index === s.idx);
        if (!e) return null;
        const chg = e.last - (e.previousClose || e.last);
        const pct = e.previousClose ? (chg / e.previousClose * 100) : 0;
        return { name: s.name, last: e.last, prev: e.previousClose, chg: +chg.toFixed(2), pct: +pct.toFixed(2) };
      }).filter(Boolean);
      res.setHeader('Cache-Control','s-maxage=60,stale-while-revalidate=30');
      return res.status(200).json({ rows, ts: Date.now() });
    } catch(e) { return res.status(200).json({ rows: [], error: e.message }); }
  }

  // FII/DII
  if (type === 'fiidii') {
    const pn = s => { const n=parseFloat(String(s||'').replace(/,/g,'')); return isNaN(n)?0:n; };

    const tryNSE = async () => {
      const cookie=await nseSession().catch(()=>'');
      const hdrs={...H,'Referer':'https://www.nseindia.com/',...(cookie?{Cookie:cookie}:{})};
      const r=await fetch('https://www.nseindia.com/api/fiidiiTradeReact',{headers:hdrs,signal:AbortSignal.timeout(7000)});
      if(!r.ok) throw new Error('NSE '+r.status);
      const arr=await r.json().then(j=>Array.isArray(j)?j:(j.data||[]));
      const byDate={};
      arr.forEach(r=>{
        const dt=r.date||r.Date||''; if(!dt) return;
        if(!byDate[dt]) byDate[dt]={date:dt,fiiBuy:0,fiiSell:0,fiiNet:0,diiBuy:0,diiSell:0,diiNet:0};
        const cat=(r.category||'').toUpperCase();
        const buy=pn(r.buyValue||0),sell=pn(r.sellValue||0),net=pn(r.netValue||0);
        if(cat.includes('FII')||cat.includes('FPI')){byDate[dt].fiiBuy=buy;byDate[dt].fiiSell=sell;byDate[dt].fiiNet=net;}
        else{byDate[dt].diiBuy=buy;byDate[dt].diiSell=sell;byDate[dt].diiNet=net;}
      });
      const rows=Object.values(byDate);
      console.log('[FII] NSE today:', rows.length, JSON.stringify(rows[0]||{}));
      if(!rows.length) throw new Error('NSE 0 rows');
      return rows;
    };

    const tryNSERange = async () => {
      const cookie=await nseSession().catch(()=>'');
      const hdrs={...H,'Referer':'https://www.nseindia.com/',...(cookie?{Cookie:cookie}:{})};
      const fmt=d=>pad(d.getDate())+'-'+pad(d.getMonth()+1)+'-'+d.getFullYear();
      const endD=new Date(),startD=new Date(); startD.setDate(startD.getDate()-45);
      const urls=[
        'https://www.nseindia.com/api/fiidiiTradeReact?startDate='+fmt(startD)+'&endDate='+fmt(endD),
        'https://www.nseindia.com/api/fiidiiTradeReact?from='+fmt(startD)+'&to='+fmt(endD),
        'https://www.nseindia.com/api/historical/fii-dii-data?startDate='+fmt(startD)+'&endDate='+fmt(endD),
      ];
      for(const url of urls) {
        try {
          const r=await fetch(url,{headers:hdrs,signal:AbortSignal.timeout(6000)});
          console.log('[FII] NSERange',r.status,url.slice(50));
          if(!r.ok) continue;
          const j=await r.json(); const arr=Array.isArray(j)?j:(j.data||[]);
          if(arr.length<=2) continue;
          const byDate={};
          arr.forEach(r=>{
            const dt=r.date||r.Date||''; if(!dt) return;
            if(!byDate[dt]) byDate[dt]={date:dt,fiiBuy:0,fiiSell:0,fiiNet:0,diiBuy:0,diiSell:0,diiNet:0};
            const cat=(r.category||'').toUpperCase();
            const buy=pn(r.buyValue||0),sell=pn(r.sellValue||0),net=pn(r.netValue||0);
            if(cat.includes('FII')||cat.includes('FPI')){byDate[dt].fiiBuy=buy;byDate[dt].fiiSell=sell;byDate[dt].fiiNet=net;}
            else{byDate[dt].diiBuy=buy;byDate[dt].diiSell=sell;byDate[dt].diiNet=net;}
          });
          const rows=Object.values(byDate);
          console.log('[FII] NSERange got:',rows.length);
          if(rows.length>2) return rows;
        } catch(e){console.log('[FII] NSERange err:',e.message);}
      }
      throw new Error('NSERange no multi-day data');
    };

    const tryNSEArchive = async () => {
      const rows=[];
      const mo=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const today=new Date();
      for(let back=0; back<45&&rows.length<25; back++) {
        const d=new Date(today); d.setDate(d.getDate()-back);
        if(d.getDay()===0||d.getDay()===6) continue;
        const dd=pad(d.getDate()),mm=pad(d.getMonth()+1),yyyy=d.getFullYear();
        const dateStr=dd+'-'+mo[d.getMonth()]+'-'+yyyy;
        try {
          const url='https://archives.nseindia.com/content/equities/FIIDII_'+yyyy+mm+dd+'.csv';
          const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(3000)});
          if(!r.ok) continue;
          const text=await r.text();
          if(text.length<50||text.includes('<html')) continue;
          let fb=0,fs=0,db=0,ds=0;
          for(const line of text.trim().split('\n').filter(l=>l.includes(','))) {
            const c=line.split(',').map(s=>s.trim().replace(/"/g,''));
            const nm=(c[0]||'').toUpperCase();
            if(nm.includes('FII')||nm.includes('FPI')){fb=pn(c[1]||0);fs=pn(c[2]||0);}
            if(nm.includes('DII')||nm.includes('DOMESTIC')){db=pn(c[1]||0);ds=pn(c[2]||0);}
          }
          if(fb||fs) rows.push({date:dateStr,fiiBuy:fb,fiiSell:fs,fiiNet:+(fb-fs).toFixed(2),diiBuy:db,diiSell:ds,diiNet:+(db-ds).toFixed(2)});
        } catch(_){}
      }
      console.log('[FII] Archive rows:',rows.length);
      if(!rows.length) throw new Error('Archive 0 rows');
      return rows.reverse();
    };

    try {
      const [nseToday,nseRange,archive]=await Promise.allSettled([tryNSE(),tryNSERange(),tryNSEArchive()]);
      let rows=[];
      if(nseRange.status==='fulfilled') rows=nseRange.value;
      else if(archive.status==='fulfilled') rows=archive.value;
      if(nseToday.status==='fulfilled') {
        nseToday.value.forEach(nr=>{
          const i=rows.findIndex(r=>r.date===nr.date);
          if(i>=0) rows[i]=nr; else rows.push(nr);
        });
        const parseD=s=>{const m=String(s).match(/(\d+)-(\w+)-(\d+)/);if(!m)return 0;const mo2={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};return new Date(+m[3],mo2[m[2]]||0,+m[1]).getTime();};
        rows.sort((a,b)=>parseD(a.date)-parseD(b.date));
      } else if(!rows.length) throw new Error('NSE: '+(nseToday.reason?.message||'failed'));
      console.log('[FII] FINAL rows:',rows.length,'first:',rows[0]?.date,'last:',rows[rows.length-1]?.date);
      res.setHeader('Cache-Control','s-maxage=60,stale-while-revalidate=30');
      return res.status(200).json({rows,ts:Date.now(),source:'live'});
    } catch(e) {
      const errs=(e?.errors||[]).map(x=>x.message).join(' | ')||e.message;
      console.log('[FII] ALL FAILED:',errs);
      res.setHeader('Cache-Control','s-maxage=60');
      return res.status(200).json({rows:[],ts:Date.now(),source:'none',error:errs});
    }
  }

  if(!sym&&!['fiidii','news','commodities','announcements'].includes(type))
    return res.status(400).json({error:'sym required'});

  try {
    // BATCH
    if(type==='batch') {
      const syms=sym.split(','),results=[];
      let allIdx=null;
      if(syms.some(s=>s.startsWith('^'))) { try{allIdx=await nseGet('/api/allIndices',6000);}catch(e){} }
      await Promise.all(syms.map(async s=>{
        try {
          if(s.startsWith('^')&&allIdx){const name=INDEX_MAP[s]||'NIFTY 50';const e=(allIdx.data||[]).find(x=>x.index===name);if(e){results.push(toResult(s,e.last,e.previousClose,e.open||e.last,e.dayHigh||e.last,e.dayLow||e.last,null,e.yearHigh,e.yearLow,name));return;}}
          const tk=toNSETicker(s);const d=await nseGet('/api/quote-equity?symbol='+encodeURIComponent(tk),5000);const pd=d.priceInfo||{};
          results.push(toResult(s,pd.lastPrice,pd.previousClose,pd.open,pd.intraDayHighLow?.max,pd.intraDayHighLow?.min,pd.totalTradedVolume,d.priceInfo?.weekHighLow?.max,d.priceInfo?.weekHighLow?.min,d.info?.companyName||tk));
        } catch(e){}
      }));
      res.setHeader('Cache-Control','s-maxage=10,stale-while-revalidate=5');
      return res.status(200).json({quoteResponse:{result:results}});
    }

    // CHART
    if(type==='chart') {
      const tk=toNSETicker(sym);const interval=req.query.interval||'1d';
      const isIntraday=['1m','5m','15m','30m','60m'].includes(interval);
      if(isIntraday) {
        const yhRange=interval==='5m'?'1d':interval==='15m'?'5d':'1d';
        try {
          const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(tk+'.NS')+'?interval='+interval+'&range='+yhRange,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(8000)});
          if(!r.ok) throw new Error('YH '+r.status);
          const d=await r.json();const result=d?.chart?.result?.[0];if(!result) throw new Error('no result');
          const q0=result.indicators?.quote?.[0]||{};
          res.setHeader('Cache-Control','s-maxage=30,stale-while-revalidate=15');
          return res.status(200).json({chart:{result:[{timestamp:result.timestamp||[],indicators:{quote:[{open:q0.open||[],high:q0.high||[],low:q0.low||[],close:q0.close||[],volume:q0.volume||[]}]}}]}});
        } catch(e){}
      }
      try {
        const d=await nseGet('/api/historical/cm/equity?symbol='+encodeURIComponent(tk)+'&series=["EQ"]&from='+getFromDate(range)+'&to='+getToDate(),9000);
        const rows=(d.data||[]).reverse();
        res.setHeader('Cache-Control','s-maxage=60,stale-while-revalidate=30');
        return res.status(200).json({chart:{result:[{timestamp:rows.map(x=>Math.floor(new Date(x.CH_TIMESTAMP||x.mTIMESTAMP).getTime()/1000)),indicators:{quote:[{open:rows.map(x=>x.CH_OPENING_PRICE||x.CH_LAST_TRADED_PRICE),high:rows.map(x=>x.CH_TRADE_HIGH_PRICE||x.CH_LAST_TRADED_PRICE),low:rows.map(x=>x.CH_TRADE_LOW_PRICE||x.CH_LAST_TRADED_PRICE),close:rows.map(x=>x.CH_CLOSING_PRICE||x.CH_LAST_TRADED_PRICE),volume:rows.map(x=>x.CH_TOT_TRADED_QTY||0)}]}}]}});
      } catch(e) {
        const r=await fetch('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(tk+'.NS')+'?interval=1d&range='+(range||'1y'),{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(8000)});
        if(!r.ok) throw new Error('chart fallback failed');
        const d=await r.json();res.setHeader('Cache-Control','s-maxage=60,stale-while-revalidate=30');return res.status(200).json(d);
      }
    }

    // SINGLE QUOTE
    if(sym.startsWith('^')) {
      const d=await nseGet('/api/allIndices',5000);const name=INDEX_MAP[sym]||'NIFTY 50';
      const e=(d.data||[]).find(x=>x.index===name);if(!e) throw new Error('Index not found: '+name);
      res.setHeader('Cache-Control','s-maxage=10,stale-while-revalidate=5');
      return res.status(200).json({quoteResponse:{result:[toResult(sym,e.last,e.previousClose,e.open||e.last,e.dayHigh||e.last,e.dayLow||e.last,null,e.yearHigh,e.yearLow,name)]}});
    }
    const tk=toNSETicker(sym);const d=await nseGet('/api/quote-equity?symbol='+encodeURIComponent(tk),6000);const pd=d.priceInfo||{};
    res.setHeader('Cache-Control','s-maxage=10,stale-while-revalidate=5');
    return res.status(200).json({quoteResponse:{result:[toResult(sym,pd.lastPrice,pd.previousClose,pd.open,pd.intraDayHighLow?.max,pd.intraDayHighLow?.min,pd.totalTradedVolume,d.priceInfo?.weekHighLow?.max,d.priceInfo?.weekHighLow?.min,d.info?.companyName||tk)]}});

  } catch(e) { return res.status(500).json({error:e.message}); }
};
