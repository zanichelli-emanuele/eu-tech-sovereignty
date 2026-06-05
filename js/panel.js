// Detail panel: company facts, financials (or private valuation), price chart, connections.
// Pure DOM + Chart.js (loaded globally as window.Chart). No three.js here.

const FLAGS = {
  "Netherlands":"🇳🇱","Germany":"🇩🇪","France":"🇫🇷","Italy":"🇮🇹","Sweden":"🇸🇪","Finland":"🇫🇮",
  "Norway":"🇳🇴","United Kingdom":"🇬🇧","Belgium":"🇧🇪","Spain":"🇪🇸","Luxembourg":"🇱🇺",
  "France/Italy":"🇪🇺","Switzerland":"🇨🇭"
};
function flag(c){ if(!c) return "🇪🇺"; return FLAGS[c] || FLAGS[c.split("/")[0]] || "🇪🇺"; }

export function fmtEur(n){
  if(n==null||isNaN(n)) return "—";
  const a=Math.abs(n);
  if(a>=1e9) return "€"+(n/1e9).toFixed(a/1e9>=100?0:1)+"B";
  if(a>=1e6) return "€"+(n/1e6).toFixed(0)+"M";
  if(a>=1e3) return "€"+(n/1e3).toFixed(0)+"k";
  return "€"+n.toFixed(0);
}
function fmtPct(n){ return (n==null||isNaN(n)) ? "—" : (n>0?"+":"")+n.toFixed(1)+"%"; }
function fmtNum(n){ return (n==null||isNaN(n)) ? "—" : n.toLocaleString("en-US"); }

let ctx=null, chart=null, pricesCache={}, current=null, range="1Y";

export function initPanel(context){
  ctx=context;
  document.getElementById("panel-close").onclick = hidePanel;
  document.querySelectorAll('#chart-head .btn').forEach(b=>{
    b.onclick=()=>{
      range=b.dataset.range;
      document.querySelectorAll('#chart-head .btn').forEach(x=>x.classList.toggle('active',x===b));
      if(current) drawChart(current);
    };
  });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') hidePanel(); });
}

export function hidePanel(){
  document.getElementById("panel").classList.remove("open");
  current=null;
  if(ctx&&ctx.onClose) ctx.onClose();
}

async function loadPrices(id){
  if(pricesCache[id]!==undefined) return pricesCache[id];
  try{
    const r=await fetch(`data/prices/${id}.json`,{cache:"no-store"});
    if(!r.ok){ pricesCache[id]=null; return null; }
    pricesCache[id]=await r.json();
  }catch(e){ pricesCache[id]=null; }
  return pricesCache[id];
}

export async function showCompany(c){
  current=c;
  const color = ctx.domainColors[c.domain] || "#7c9cff";
  document.getElementById("p-flag").textContent = flag(c.hq_country);
  document.getElementById("p-name").textContent = c.name;

  // chips
  const chips=document.getElementById("p-chips"); chips.innerHTML="";
  const dom=document.createElement("span"); dom.className="chip dom";
  dom.textContent=c.domain; dom.style.borderColor=color; dom.style.color=color; chips.appendChild(dom);
  const lp=document.createElement("span");
  lp.className="chip "+(c.is_listed?"listed":"private");
  lp.textContent=c.is_listed?("Listed · "+(c.ticker||"")):"Private"; chips.appendChild(lp);
  if(c.hq_country){ const f=document.createElement("span"); f.className="chip"; f.textContent=c.hq_country; chips.appendChild(f); }
  if(c.founded){ const y=document.createElement("span"); y.className="chip"; y.textContent="est. "+c.founded; chips.appendChild(y); }
  // distress / status warnings surfaced from uncertain notes
  const warn=(c.uncertain||[]).find(u=>/distress|delist|restructur|taken private|pending/i.test(u));
  if(warn){ const w=document.createElement("span"); w.className="chip flag-warn"; w.textContent="⚠ status"; w.title=warn; chips.appendChild(w); }

  document.getElementById("p-desc").textContent=c.description||"—";
  document.getElementById("p-role").textContent=c.sovereignty_role||"—";

  buildFinancials(c);
  buildConnections(c);

  // uncertainties
  const us=document.getElementById("p-uncert-sec"), ut=document.getElementById("p-uncert");
  if(c.uncertain && c.uncertain.length){ ut.innerHTML="<b>Notes &amp; caveats:</b> "+c.uncertain.join(" · "); us.style.display=""; }
  else us.style.display="none";

  document.getElementById("panel").classList.add("open");

  // chart
  await drawChart(c);
}

function row(k,v,cls){ return `<div><div class="k">${k}</div><div class="v ${cls||''}">${v}</div></div>`; }

function buildFinancials(c){
  const h=document.getElementById("p-fin-h"), box=document.getElementById("p-fin"), src=document.getElementById("p-fin-src");
  if(c.is_listed && c.financials){
    const f=c.financials; h.textContent="Financials";
    box.innerHTML =
      row("Market cap", fmtEur(f.market_cap_eur)) +
      row("Revenue (FY)", fmtEur(f.revenue_eur)) +
      row("Rev. growth", fmtPct(f.revenue_growth_pct), f.revenue_growth_pct>0?"pos":(f.revenue_growth_pct<0?"neg":"")) +
      row("Gross margin", fmtPct(f.gross_margin_pct)) +
      row("Net margin", fmtPct(f.net_margin_pct), f.net_margin_pct>0?"pos":(f.net_margin_pct<0?"neg":"")) +
      row("P/E", f.pe_ratio!=null?f.pe_ratio.toFixed(1):"—") +
      row("Net "+((f.net_debt_eur||0)<0?"cash":"debt"), f.net_debt_eur!=null?fmtEur(Math.abs(f.net_debt_eur)):"—", (f.net_debt_eur||0)<0?"pos":"") +
      row("Employees", fmtNum(f.employees));
    src.innerHTML = `as of ${f.as_of_date||"—"} · ${f.source_url?`<a href="${f.source_url}" target="_blank" rel="noopener">source ↗</a>`:""} · market data via yfinance`;
  } else if(c.private_data){
    const p=c.private_data; h.textContent="Private company";
    box.innerHTML =
      row("Last valuation", fmtEur(p.last_valuation_eur)) +
      row("Total funding", fmtEur(p.total_funding_eur));
    let inv = (p.key_investors&&p.key_investors.length) ? `<div class="invlist" style="grid-column:1/3"><div class="k">Key investors / owners</div>${p.key_investors.join(" · ")}</div>` : "";
    box.innerHTML += inv;
    src.innerHTML = `as of ${p.as_of_date||"—"} · ${p.source_url?`<a href="${p.source_url}" target="_blank" rel="noopener">source ↗</a>`:""}`;
  } else {
    h.textContent="Financials"; box.innerHTML=`<div class="k" style="grid-column:1/3">No financial data available.</div>`; src.innerHTML="";
  }
}

function buildConnections(c){
  const box=document.getElementById("p-connections");
  const edges = ctx.relationships.filter(e=>e.source_id===c.id||e.target_id===c.id);
  if(!edges.length){ box.innerHTML=`<p style="font-size:12px;color:var(--dim);margin:0">No documented connections in this dataset.</p>`; document.getElementById("p-conn-sec").style.display=""; return; }
  box.innerHTML="";
  edges.forEach(e=>{
    const otherId = e.source_id===c.id ? e.target_id : e.source_id;
    const other = ctx.companiesById[otherId]; if(!other) return;
    const dir = e.source_id===c.id ? "→" : "←";
    const col = ctx.domainColors[other.domain]||"#888";
    const d=document.createElement("div"); d.className="conn"; d.title=e.note||"";
    d.innerHTML=`<span class="cdot" style="color:${col}"></span><span>${dir} ${other.name}</span><span class="ctype">${e.type.replace("_"," ")}</span>`;
    d.onclick=()=>ctx.onNavigate(otherId);
    box.appendChild(d);
  });
  document.getElementById("p-conn-sec").style.display="";
}

async function drawChart(c){
  const box=document.getElementById("chart-box"), empty=document.getElementById("chart-empty");
  const data = c.is_listed ? await loadPrices(c.id) : null;
  if(!data || !data.prices || !data.prices.length){
    box.style.display="none"; empty.style.display="";
    empty.innerHTML = c.is_listed
      ? "No cached price data — run <code>fetch_data.py</code> to populate it."
      : "Private company — no public market data.";
    if(chart){ chart.destroy(); chart=null; }
    return;
  }
  box.style.display=""; empty.style.display="none";
  let pts=data.prices;
  if(range==="1Y") pts=pts.slice(-252);
  // downsample for perf (cap ~320 points)
  if(pts.length>320){ const step=Math.ceil(pts.length/320); pts=pts.filter((_,i)=>i%step===0||i===pts.length-1); }
  const labels=pts.map(p=>p.date), vals=pts.map(p=>p.close);
  const color = ctx.domainColors[c.domain]||"#7c9cff";
  const cv=document.getElementById("p-chart"); const cx=cv.getContext("2d");
  const grad=cx.createLinearGradient(0,0,0,170); grad.addColorStop(0,color+"55"); grad.addColorStop(1,color+"00");
  const up = vals[vals.length-1]>=vals[0];
  if(chart) chart.destroy();
  chart=new window.Chart(cv,{type:"line",data:{labels,datasets:[{data:vals,borderColor:color,backgroundColor:grad,
    borderWidth:1.8,pointRadius:0,pointHoverRadius:3,tension:.22,fill:true}]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:350},
      interaction:{mode:"index",intersect:false},
      plugins:{legend:{display:false},tooltip:{displayColors:false,
        callbacks:{title:i=>i[0].label,label:i=>"€"+i.raw.toFixed(2)}}},
      scales:{
        x:{grid:{display:false},ticks:{color:"#5b677e",maxTicksLimit:6,maxRotation:0,autoSkip:true,font:{size:10}}},
        y:{position:"right",grid:{color:"rgba(255,255,255,.05)"},ticks:{color:"#5b677e",maxTicksLimit:5,font:{size:10},
          callback:v=>"€"+(v>=1000?(v/1000).toFixed(1)+"k":v.toFixed(0))}}
      }}});
  // tiny perf note: change over range
  const pct=((vals[vals.length-1]/vals[0]-1)*100);
  document.querySelector('#chart-head h3').textContent = `Share price (EUR) · ${range} ${up?"▲":"▼"} ${fmtPct(pct)}`;
}
