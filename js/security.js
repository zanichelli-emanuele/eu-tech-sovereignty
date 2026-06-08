// SECURITY panel — company detail, financials/private valuation, price chart, connections.
// DOM + Chart.js (window.Chart). Ported & restyled from the previous panel.js.
const FLAGS={"Netherlands":"🇳🇱","Germany":"🇩🇪","France":"🇫🇷","Italy":"🇮🇹","Sweden":"🇸🇪","Finland":"🇫🇮",
 "Norway":"🇳🇴","United Kingdom":"🇬🇧","Belgium":"🇧🇪","Spain":"🇪🇸","Luxembourg":"🇱🇺","France/Italy":"🇪🇺","Switzerland":"🇨🇭"};
const flag=c=>!c?"🇪🇺":(FLAGS[c]||FLAGS[c.split("/")[0]]||"🇪🇺");
export const fmtEur=n=>{ if(n==null||isNaN(n))return"—"; const a=Math.abs(n);
 if(a>=1e9)return"€"+(n/1e9).toFixed(a/1e9>=100?0:1)+"B"; if(a>=1e6)return"€"+(n/1e6).toFixed(0)+"M";
 if(a>=1e3)return"€"+(n/1e3).toFixed(0)+"k"; return"€"+n.toFixed(0); };
const fmtPct=n=>(n==null||isNaN(n))?"—":(n>0?"+":"")+n.toFixed(1)+"%";
const fmtNum=n=>(n==null||isNaN(n))?"—":n.toLocaleString("en-US");

let ctx=null, chart=null, pricesCache={}, current=null, range="1Y";
const $=id=>document.getElementById(id);

export function initSecurity(context){ ctx=context; }
export function clearSecurity(){ current=null; $("sec-content").hidden=true; $("sec-empty").hidden=false; $("sec-id").textContent=""; if(chart){chart.destroy();chart=null;} }

export async function showCompany(c){
  current=c; const color=ctx.DOMAIN_COLORS[c.domain]||"#ff9e3d";
  $("sec-empty").hidden=true; $("sec-content").hidden=false;
  $("sec-id").textContent = c.is_listed ? (c.ticker||"") : "PRIVATE";
  const warn=(c.uncertain||[]).find(u=>/distress|delist|restructur|taken private|pending|thin free float/i.test(u));
  const el=$("sec-content");
  el.innerHTML=`
    <div class="sec-head">
      <span class="sbar" style="background:${color}"></span>
      <span class="flag">${flag(c.hq_country)}</span>
      <div style="min-width:0">
        <div class="sh-code">${c.is_listed?(c.ticker||c.name):c.name}</div>
        <div class="sh-name">${c.name}</div>
        <div class="sh-meta">
          <span class="tag ${c.is_listed?'listed':'private'}">${c.is_listed?'LISTED':'PRIVATE'}</span>
          ${warn?`<span class="tag warn" title="${warn.replace(/"/g,'&quot;')}">⚠ STATUS</span>`:''}
          <span style="color:${color}">${c.domain}</span> · ${c.hq_country||'—'} ${c.founded?'· EST '+c.founded:''}
        </div>
      </div>
    </div>
    <div class="sec-sec"><h4>${c.is_listed?'Financials':'Private company'}</h4><div class="fin" id="sec-fin"></div><div class="src" id="sec-fin-src"></div></div>
    <div class="sec-sec">
      <div class="chart-head"><h4 style="margin:0">Share price · EUR</h4>
        <div class="rbtns"><button data-r="1Y" class="on">1Y</button><button data-r="5Y">5Y</button></div></div>
      <div id="chart-box"><canvas id="sec-chart"></canvas></div>
      <div id="chart-empty" class="chart-empty" hidden></div>
    </div>
    <div class="sec-sec"><h4>What they do</h4><p class="prose">${c.description||'—'}</p></div>
    <div class="sec-sec"><h4>Role in the EU stack</h4><p class="prose role">${c.sovereignty_role||'—'}</p></div>
    <div class="sec-sec"><h4>Connections</h4><div id="sec-conn"></div></div>
    ${(c.uncertain&&c.uncertain.length)?`<div class="uncert"><b>Notes &amp; caveats:</b> ${c.uncertain.join(' · ')}</div>`:''}`;
  buildFin(c); buildConns(c);
  el.querySelectorAll(".rbtns button").forEach(b=>b.onclick=()=>{ range=b.dataset.r;
    el.querySelectorAll(".rbtns button").forEach(x=>x.classList.toggle("on",x===b)); drawChart(c); });
  await drawChart(c);
}

function cell(k,v,cls){ return `<div class="cell"><div class="k">${k}</div><div class="v ${cls||''}">${v}</div></div>`; }
function buildFin(c){
  const box=$("sec-fin"), src=$("sec-fin-src");
  if(c.is_listed&&c.financials){ const f=c.financials;
    box.innerHTML=cell("Market cap",fmtEur(f.market_cap_eur))+cell("Revenue FY",fmtEur(f.revenue_eur))
      +cell("Rev growth",fmtPct(f.revenue_growth_pct),f.revenue_growth_pct>0?"pos":(f.revenue_growth_pct<0?"neg":""))
      +cell("Gross margin",fmtPct(f.gross_margin_pct))
      +cell("Net margin",fmtPct(f.net_margin_pct),f.net_margin_pct>0?"pos":(f.net_margin_pct<0?"neg":""))
      +cell("P / E",f.pe_ratio!=null?f.pe_ratio.toFixed(1):"—")
      +cell("Net "+((f.net_debt_eur||0)<0?"cash":"debt"),f.net_debt_eur!=null?fmtEur(Math.abs(f.net_debt_eur)):"—",(f.net_debt_eur||0)<0?"pos":"")
      +cell("Employees",fmtNum(f.employees));
    src.innerHTML=`as of ${f.as_of_date||"—"} · ${f.source_url?`<a href="${f.source_url}" target="_blank" rel="noopener">source ↗</a>`:""} · mkt data via yfinance`;
  } else if(c.private_data){ const p=c.private_data;
    box.innerHTML=cell("Last valuation",fmtEur(p.last_valuation_eur))+cell("Total funding",fmtEur(p.total_funding_eur))
      +(p.key_investors&&p.key_investors.length?`<div class="cell" style="grid-column:1/3"><div class="k">Key investors / owners</div><div class="v" style="font-size:11px;font-weight:500">${p.key_investors.join(" · ")}</div></div>`:"");
    src.innerHTML=`as of ${p.as_of_date||"—"} · ${p.source_url?`<a href="${p.source_url}" target="_blank" rel="noopener">source ↗</a>`:""}`;
  } else { box.innerHTML=`<div class="cell" style="grid-column:1/3"><div class="k">No financial data</div></div>`; src.innerHTML=""; }
}
function buildConns(c){
  const box=$("sec-conn"); const es=ctx.rels.filter(e=>e.source_id===c.id||e.target_id===c.id);
  if(!es.length){ box.innerHTML=`<div class="muted" style="font-size:11px">No documented connections.</div>`; return; }
  box.innerHTML="";
  es.forEach(e=>{ const oid=e.source_id===c.id?e.target_id:e.source_id; const o=ctx.byId[oid]; if(!o)return;
    const dir=e.source_id===c.id?"→":"←", col=ctx.DOMAIN_COLORS[o.domain]||"#888";
    const d=document.createElement("div"); d.className="conn"; d.title=e.note||"";
    d.innerHTML=`<span class="cdot" style="background:${col}"></span><span class="cdir">${dir}</span><span>${o.name}</span><span class="ct">${e.type.replace("_"," ")}</span>`;
    d.onclick=()=>ctx.select(oid); box.appendChild(d); });
}

async function loadPrices(id){ if(pricesCache[id]!==undefined)return pricesCache[id];
  try{ const r=await fetch(`data/prices/${id}.json`,{cache:"no-store"}); pricesCache[id]=r.ok?await r.json():null; }
  catch(e){ pricesCache[id]=null; } return pricesCache[id]; }

async function drawChart(c){
  const box=$("chart-box"), empty=$("chart-empty");
  const data=c.is_listed?await loadPrices(c.id):null;
  if(current!==c) return; // selection changed while awaiting
  if(!data||!data.prices||!data.prices.length){ box.style.display="none"; empty.hidden=false;
    empty.innerHTML=c.is_listed?"No cached price data — run fetch_data.py":"PRIVATE — NO PUBLIC MARKET DATA";
    if(chart){chart.destroy();chart=null;} return; }
  box.style.display=""; empty.hidden=true;
  let pts=data.prices; if(range==="1Y")pts=pts.slice(-252);
  if(pts.length>320){ const s=Math.ceil(pts.length/320); pts=pts.filter((_,i)=>i%s===0||i===pts.length-1); }
  const labels=pts.map(p=>p.date), vals=pts.map(p=>p.close), color=ctx.DOMAIN_COLORS[c.domain]||"#ff9e3d";
  const up=vals[vals.length-1]>=vals[0], pct=(vals[vals.length-1]/vals[0]-1)*100;
  const cv=$("sec-chart"), g=cv.getContext("2d").createLinearGradient(0,0,0,150);
  g.addColorStop(0,color+"44"); g.addColorStop(1,color+"00");
  if(chart)chart.destroy();
  chart=new window.Chart(cv,{type:"line",data:{labels,datasets:[{data:vals,borderColor:color,backgroundColor:g,borderWidth:1.6,pointRadius:0,pointHoverRadius:3,tension:.2,fill:true}]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:250},interaction:{mode:"index",intersect:false},
      plugins:{legend:{display:false},tooltip:{displayColors:false,backgroundColor:"#0a0c12",borderColor:"#2b3140",borderWidth:1,
        callbacks:{title:i=>i[0].label,label:i=>"€"+i.raw.toFixed(2)}}},
      scales:{x:{grid:{display:false},ticks:{color:"#5b6573",maxTicksLimit:6,maxRotation:0,font:{size:9,family:"monospace"}}},
        y:{position:"right",grid:{color:"rgba(255,255,255,.05)"},ticks:{color:"#5b6573",maxTicksLimit:5,font:{size:9,family:"monospace"},
          callback:v=>"€"+(v>=1000?(v/1000).toFixed(1)+"k":v.toFixed(0))}}}}});
  const h=document.querySelector(".chart-head h4"); if(h) h.innerHTML=`Share price · EUR · ${range} <span class="pe ${up?'pos':'neg'}">${up?"▲":"▼"} ${fmtPct(pct)}</span>`;
}
