// EU·SOV Terminal — orchestration: data, universe table, filters, command bar, keyboard, state.
import { initSecurity, showCompany, clearSecurity, fmtEur } from "./security.js";
import { initMap, renderMap } from "./map2d.js";
import { initMatrix, renderMatrix } from "./matrix.js";

// Domains = the four instruments of the EU Tech Sovereignty Package (1:1 with meta.instruments).
export const DOMAINS=["Semiconductors","Cloud & AI","Open source","AI in energy"];
export const DOMAIN_COLORS={"Semiconductors":"#818cf8","Cloud & AI":"#38bdf8","Open source":"#4ade80","AI in energy":"#fbbf24"};
export const DOM_ABBR={"Semiconductors":"SEMI","Cloud & AI":"CLOUD·AI","Open source":"OSS","AI in energy":"ENERGY"};
export const EDGE_TYPES={ supply_chain:{color:"#ff9e3d",label:"Supply",dash:[],arrow:true},
 ownership:{color:"#36d399",label:"Ownership",dash:[],arrow:true},
 customer:{color:"#56b6ff",label:"Customer",dash:[5,4],arrow:true},
 partnership:{color:"#8893a6",label:"Partnership",dash:[2,4],arrow:false} };

const $=id=>document.getElementById(id);
const growth=c=>c.is_listed&&c.financials?c.financials.revenue_growth_pct:null;

let companies=[], rels=[], byId={}, metaAsOf="", instruments=[];
const state={ selectedId:null, filters:{domains:new Set(DOMAINS), listed:true, priv:true}, sort:{k:"size_eur",dir:-1}, tab:"map" };

const ctx={ get companies(){return companies}, byId, get rels(){return rels}, DOMAINS, DOMAIN_COLORS, DOM_ABBR, EDGE_TYPES, state,
  select, visible, neighbors, renderActive, fmtEur, get instruments(){return instruments}, instrumentFor };
function instrumentFor(domain){ return instruments.find(i=>(i.domains||[]).includes(domain))||null; }

function visible(c){ return state.filters.domains.has(c.domain) && ((c.is_listed&&state.filters.listed)||(!c.is_listed&&state.filters.priv)); }
function neighbors(id){ const s=new Set([id]); rels.forEach(e=>{ if(e.source_id===id)s.add(e.target_id); if(e.target_id===id)s.add(e.source_id); }); return s; }
function renderActive(){ if(state.tab==="map")renderMap(); else renderMatrix(); }

function select(id){ state.selectedId=id; try{history.replaceState(null,"","#"+id);}catch(e){} renderTableSel(); renderActive(); const c=byId[id]; if(c)showCompany(c);
  // ensure selected row visible in the table
  const tr=document.querySelector(`#uni-body tr[data-id="${id}"]`); if(tr)tr.scrollIntoView({block:"nearest"}); }

// ---------------- boot ----------------
(async function(){
  try{
    const [cR,rR]=await Promise.all([fetch("data/companies.json"),fetch("data/relationships.json")]);
    const cj=await cR.json(); rels=(await rR.json()).relationships; companies=cj.companies;
    companies.forEach(c=>byId[c.id]=c);
    metaAsOf=cj.meta?.as_of||""; instruments=cj.meta?.instruments||[]; $("asof").textContent="AS OF "+metaAsOf;
    initSecurity(ctx); initMap(ctx,$("map-canvas"),$("tip")); initMatrix(ctx,$("matrix-canvas"),$("tip"));
    buildFilters(); buildTable(); buildDatalist(); buildEdgeLegend(); buildStatus(); buildTabs(); buildPlan(); clock();
    applyLiveSnapshot(true);
    setInterval(()=>applyLiveSnapshot(false),300000);                                  // keep a long-open page fresh
    document.addEventListener("visibilitychange",()=>{ if(!document.hidden) applyLiveSnapshot(false); }); // refresh when you return to the tab
    window.addEventListener("resize",()=>renderActive());
    document.addEventListener("keydown",onKey);
    const params=new URLSearchParams(location.search);
    if(params.get("view")==="matrix") setTab("matrix"); else renderActive();
    const want=location.hash.slice(1)||params.get("id"); if(want&&byId[want]) select(want);
  }catch(e){ console.error(e); document.body.insertAdjacentHTML("beforeend",`<div style="position:fixed;inset:0;display:grid;place-items:center;color:#ff5b5b;font-family:monospace">DATA LOAD FAILED — serve over http:// · ${e.message}</div>`); }
})();

// ---------------- filters ----------------
function buildFilters(){
  const box=$("uni-filters"); box.innerHTML="";
  const all=chip("ALL","all on",()=>{ const allOn=DOMAINS.every(d=>state.filters.domains.has(d));
    if(allOn)state.filters.domains.clear(); else DOMAINS.forEach(d=>state.filters.domains.add(d)); syncFilters(); });
  box.appendChild(all);
  DOMAINS.forEach(d=>{ const c=chip(DOM_ABBR[d],"on",()=>{ state.filters.domains.has(d)?state.filters.domains.delete(d):state.filters.domains.add(d); syncFilters(); },DOMAIN_COLORS[d]);
    c.dataset.dom=d; box.appendChild(c); });
  const lp=document.createElement("div"); lp.style.cssText="flex-basis:100%;height:0";
  box.appendChild(lp);
  box.appendChild(chip("◼ LISTED","on",()=>{ state.filters.listed=!state.filters.listed; syncFilters(); },null,"f-listed"));
  box.appendChild(chip("◻ PRIVATE","on",()=>{ state.filters.priv=!state.filters.priv; syncFilters(); },null,"f-priv"));
  syncFilters();
}
function chip(label,cls,onclick,color,id){ const el=document.createElement("div"); el.className="chip "+(cls.includes("all")?"all ":"")+(cls.includes("on")?"on":"off");
  if(id)el.id=id; el.innerHTML=(color?`<span class="sq" style="background:${color}"></span>`:"")+label; el.onclick=onclick; return el; }
function syncFilters(){
  document.querySelectorAll("#uni-filters .chip[data-dom]").forEach(c=>{ const on=state.filters.domains.has(c.dataset.dom); c.classList.toggle("on",on); c.classList.toggle("off",!on); });
  const allOn=DOMAINS.every(d=>state.filters.domains.has(d)); const ac=$("uni-filters").querySelector(".all"); if(ac)ac.classList.toggle("on",allOn);
  const fl=$("f-listed"); if(fl){fl.classList.toggle("on",state.filters.listed);fl.classList.toggle("off",!state.filters.listed);}
  const fp=$("f-priv"); if(fp){fp.classList.toggle("on",state.filters.priv);fp.classList.toggle("off",!state.filters.priv);}
  applyTableFilter(); renderActive(); updateCounts();
}

// ---------------- table ----------------
function sortedCompanies(){
  const {k,dir}=state.sort; const arr=companies.slice();
  arr.sort((a,b)=>{ let va,vb;
    if(k==="size_eur"){ va=a.size_eur||0; vb=b.size_eur||0; }
    else if(k==="growth"){ va=growth(a)??-999; vb=growth(b)??-999; }
    else if(k==="ticker"){ va=(a.ticker||"ZZZ").toUpperCase(); vb=(b.ticker||"ZZZ").toUpperCase(); }
    else { va=(a[k]||"").toString().toUpperCase(); vb=(b[k]||"").toString().toUpperCase(); }
    return va<vb?-1*dir:va>vb?1*dir:0; });
  return arr;
}
function buildTable(){
  const body=$("uni-body"); body.innerHTML="";
  sortedCompanies().forEach(c=>{ const g=growth(c);
    const tr=document.createElement("tr"); tr.dataset.id=c.id;
    tr.innerHTML=`<td class="c-dom"><span class="bar" style="background:${DOMAIN_COLORS[c.domain]}"></span></td>`
      +`<td class="c-code">${c.is_listed?(c.ticker||""):'<span class="pvt">PVT</span>'}</td>`
      +`<td class="c-name" title="${c.name}">${c.name}</td>`
      +`<td class="c-mkt num">${fmtEur(c.size_eur)}</td>`
      +`<td class="num ${g>0?'pos':g<0?'neg':'muted'}">${g==null?"·":(g>0?"+":"")+g.toFixed(1)}</td>`;
    tr.onclick=()=>select(c.id); body.appendChild(tr); });
  document.querySelectorAll("#uni-table thead th[data-k]").forEach(th=>{ th.onclick=()=>{ const k=th.dataset.k;
    if(state.sort.k===k)state.sort.dir*=-1; else { state.sort.k=k; state.sort.dir=(k==="name"||k==="ticker")?1:-1; }
    buildTable(); }; th.classList.toggle("sorted",state.sort.k===th.dataset.k); th.classList.toggle("asc",state.sort.dir>0); });
  applyTableFilter(); renderTableSel(); updateCounts();
}
function applyTableFilter(){ document.querySelectorAll("#uni-body tr").forEach(tr=>tr.classList.toggle("hid",!visible(byId[tr.dataset.id]))); }
function renderTableSel(){ document.querySelectorAll("#uni-body tr").forEach(tr=>tr.classList.toggle("sel",tr.dataset.id===state.selectedId)); }
function updateCounts(){ const vis=companies.filter(visible).length; $("uni-count").textContent=`${vis}/${companies.length}`; }

function buildDatalist(){ const dl=$("cmd-list"); companies.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(c=>{ const o=document.createElement("option"); o.value=c.name; dl.appendChild(o); }); }

// ---------------- tabs ----------------
function buildTabs(){ document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>setTab(t.dataset.tab)); }
function setTab(tab){ state.tab=tab; document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===tab));
  $("map-canvas").hidden=tab!=="map"; $("matrix-canvas").hidden=tab!=="matrix";
  $("map-hint").style.display=tab==="map"?"":"none";
  const mc=$("map-ctrls"); if(mc)mc.style.display=tab==="map"?"":"none"; renderActive(); }

// ---------------- command bar ----------------
const cmd=$("cmd");
cmd.addEventListener("keydown",e=>{ if(e.key==="Enter"){ const v=cmd.value.trim().toLowerCase(); if(!v)return;
  const m=companies.find(c=>c.name.toLowerCase()===v)||companies.find(c=>(c.ticker||"").toLowerCase()===v)
    ||companies.find(c=>c.name.toLowerCase().includes(v))||companies.find(c=>DOM_ABBR[c.domain].toLowerCase()===v);
  if(m){ select(m.id); cmd.blur(); } } if(e.key==="Escape"){ cmd.value=""; cmd.blur(); } });

// ---------------- keyboard ----------------
function onKey(e){
  if(e.target===cmd) return;
  if(e.key==="/"){ e.preventDefault(); cmd.focus(); return; }
  if(e.key==="Escape"){ return; }
  if(e.key==="m"||e.key==="M"){ setTab("map"); return; }
  if(e.key==="x"||e.key==="X"){ setTab("matrix"); return; }
  if(e.key>="1"&&e.key<="9"){ const d=DOMAINS[+e.key-1]; if(d){ state.filters.domains.has(d)?state.filters.domains.delete(d):state.filters.domains.add(d); syncFilters(); } return; }
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){ e.preventDefault();
    const rows=[...document.querySelectorAll("#uni-body tr:not(.hid)")]; if(!rows.length)return;
    let i=rows.findIndex(r=>r.dataset.id===state.selectedId);
    i = e.key==="ArrowDown" ? Math.min(rows.length-1,i+1) : Math.max(0,i<0?0:i-1);
    select(rows[i].dataset.id); }
}

// ---------------- status + clock ----------------
function buildEdgeLegend(){ $("edge-legend").innerHTML=Object.values(EDGE_TYPES).map(t=>
  `<span class="ek"><span class="el" style="border-top:2px ${t.dash.length?'dashed':'solid'} ${t.color}"></span>${t.label}</span>`).join(""); }
function buildStatus(){
  $("stat-counts").textContent=`${companies.length} COS · ${DOMAINS.length} DOMAINS · ${rels.length} LINKS · ${companies.filter(c=>c.is_listed).length} LISTED`;
  $("legend").innerHTML=DOMAINS.map(d=>`<span class="lg"><span class="sq" style="background:${DOMAIN_COLORS[d]}"></span>${DOM_ABBR[d]}</span>`).join("");
  $("keys").innerHTML=`<span class="k"><b>/</b> search</span><span class="k"><b>↑↓</b> nav</span><span class="k"><b>M/X</b> view</span><span class="k"><b>1-9</b> domain</span>`;
}
// ---------------- the plan (instrument explainer overlay) ----------------
function buildPlan(){
  const btn=$("plan-btn"), ov=$("plan-overlay"), box=$("plan-content"), close=$("plan-close");
  if(!btn||!ov||!box) return;
  const umb=instruments.find(i=>i.id==="communication"), comps=instruments.filter(i=>i.id!=="communication");
  const card=i=>{ const col=DOMAIN_COLORS[(i.domains||[])[0]]||"#ff9e3d", cnt=companies.filter(c=>(i.domains||[]).includes(c.domain)).length;
    return `<div class="inst-card" style="border-top:3px solid ${col}">
      <div class="inst-top"><span class="inst-name">${i.name}</span><span class="inst-type">${i.type}</span></div>
      <div class="inst-status">${i.status}${i.domains&&i.domains.length?` · <b style="color:${col}">${cnt} cos in universe</b>`:""}</div>
      <p class="inst-sum">${i.summary}</p>
      <ul class="inst-prop">${(i.proposes||[]).map(p=>`<li>${p}</li>`).join("")}</ul>
      <div class="inst-foot"><span>Funding: ${i.funding}</span><a href="${i.source_url}" target="_blank" rel="noopener">EC source ↗</a></div></div>`; };
  box.innerHTML=`<div class="plan-head">
      <h2>The European Technological Sovereignty Package</h2>
      <div class="plan-sub">Proposed <b>3 June 2026</b> · <span class="warnlaw">a proposal — Chips Act 2.0 &amp; CADA still require adoption by the European Parliament and Council</span></div>
      ${umb?`<p class="plan-umb">${umb.summary} <a href="${umb.source_url}" target="_blank" rel="noopener">EC source ↗</a></p>`:""}
    </div>
    <div class="plan-grid">${comps.map(card).join("")}</div>
    <div class="plan-note">This terminal is scoped to these four instruments only. A company is mapped to the instrument that targets its domain — inclusion means it operates in a targeted area, <b>not</b> confirmed beneficiary status unless its own notes cite a specific instrument.</div>`;
  const open=()=>{ov.hidden=false;}, hide=()=>{ov.hidden=true;};
  btn.onclick=open; close.onclick=hide; ov.addEventListener("click",e=>{ if(e.target===ov) hide(); });
  document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&!ov.hidden) hide(); });
  if(new URLSearchParams(location.search).get("plan")) open();   // deep-link: ?plan=1 opens the explainer
}
function clock(){ const t=()=>{ const d=new Date(); $("clock").textContent=d.toLocaleTimeString("en-GB",{hour12:false}); }; t(); setInterval(t,1000); }
// Pull the server's live snapshot (price + market cap, EUR) and overlay it on the universe.
// Reject a glitchy market cap (>4× / <0.25× the vetted static value); fall back to static when absent.
function liveMktCap(c,x){ const stat=c.financials?c.financials.market_cap_eur:null; const mc=x.market_cap_eur;
  if(mc==null||mc<=0) return null; if(stat&&(mc<stat*0.25||mc>stat*4)) return stat; return mc; }
async function applyLiveSnapshot(initial){ const ind=$("live-ind");
  try{
    let j=null;
    try{ const r=await fetch("api/snapshot",{cache:"no-store"}); if(r.ok) j=await r.json(); }catch(e){}            // local serve.py = true live
    if(!j||!j.quotes){ const r=await fetch("data/live_snapshot.json",{cache:"no-store"}); if(!r.ok) throw 0; j=await r.json(); } // GitHub Pages: Action-refreshed snapshot
    const q=j.quotes||{}; let n=0;
    companies.forEach(c=>{ if(!c.is_listed) return;
      if(c.size_eur_static===undefined) c.size_eur_static=c.size_eur;          // remember the vetted snapshot value once
      const x=q[c.id]; if(!x) return;
      if(x.change_pct!=null) c._liveChange=x.change_pct;
      const mc=liveMktCap(c,x); if(mc!=null){ c._liveMktCap=mc; c.size_eur=mc; } // drives table value + node size
      n++; });
    if(j.ts){ const d=new Date(j.ts*1000);
      const upd=d.toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",hour12:false});
      if(ind){ ind.innerHTML='<span class="live-dot"></span>LIVE'; ind.classList.add("on");
        ind.title=`Live market data — ${n} listed cos · auto-refreshed · Yahoo ~15-min delayed`; }
      $("asof").innerHTML='<span class="asof-lbl">UPDATED</span> '+upd;
      $("asof").title="Data last updated "+d.toLocaleString()+" (your local time) · Yahoo ~15-min delayed · auto-refreshes ~every 15 min"; }
    const sel=state.selectedId; buildTable(); renderActive();                  // re-sort/redraw with fresh caps
    if(sel){ const tr=document.querySelector(`#uni-body tr[data-id="${sel}"]`); if(tr)tr.scrollIntoView({block:"nearest"}); }
  }catch(e){
    if(initial){ if(ind){ ind.textContent="◌ SNAPSHOT"; ind.classList.remove("on"); ind.title="Static snapshot — start serve.py for live data"; }
      $("asof").innerHTML='<span class="asof-lbl">AS OF</span> '+metaAsOf; $("asof").title="Static snapshot — start serve.py (python3 serve.py 8000) for live data"; }
  }
}
