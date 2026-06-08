// NETWORK MAP — 2D canvas. Companies grouped into 9 domain regions; edges styled by type.
// Hover traces links, click selects, wheel zooms, drag pans. Static (draws on demand).
let C=null, cvs=null, g=null, tip=null;
const pos=new Map();           // id -> {x,y,r,dom,c}
let view={scale:1,ox:0,oy:0}, fitted=false, lastW=0,lastH=0, dpr=1;
let hoverId=null, dragging=false, dragMoved=false, lastX=0,lastY=0;
const Wd=1240, Hd=840;

export function initMap(ctx,canvas,tipEl){ C=ctx; cvs=canvas; g=cvs.getContext("2d"); tip=tipEl; layout();
  cvs.addEventListener("mousemove",onMove); cvs.addEventListener("mousedown",onDown);
  window.addEventListener("mouseup",onUp); cvs.addEventListener("click",onClick);
  cvs.addEventListener("wheel",onWheel,{passive:false}); cvs.addEventListener("mouseleave",()=>{hoverId=null;tip.hidden=true;draw();}); }

function nodeR(s){ const lg=Math.log10(s||1e8); return Math.max(3.5,Math.min(17, 4+(lg-8)/3.8*12)); }
function layout(){
  pos.clear(); const cw=Wd/3, ch=Hd/3;
  C.DOMAINS.forEach((dom,di)=>{
    const col=di%3,row=(di/3|0), cx=(col+.5)*cw, cy=(row+.5)*ch, R=Math.min(cw,ch)*0.34;
    const list=C.companies.filter(c=>c.domain===dom).sort((a,b)=>(b.size_eur||0)-(a.size_eur||0));
    const n=list.length;
    list.forEach((c,k)=>{ const rr=R*Math.sqrt((k+0.6)/n), a=k*2.39996323;
      pos.set(c.id,{x:cx+Math.cos(a)*rr,y:cy+Math.sin(a)*rr,r:nodeR(c.size_eur),dom,c}); });
  });
}
const S=p=>({x:p.x*view.scale+view.ox,y:p.y*view.scale+view.oy});
const W=(sx,sy)=>({x:(sx-view.ox)/view.scale,y:(sy-view.oy)/view.scale});
function ensureSize(){ const cw=cvs.clientWidth,chh=cvs.clientHeight; dpr=Math.min(devicePixelRatio||1,2);
  if(cw!==lastW||chh!==lastH){ cvs.width=cw*dpr; cvs.height=chh*dpr; lastW=cw; lastH=chh; fitted=false; } }
function fitView(){ const cw=cvs.clientWidth,chh=cvs.clientHeight, pad=54;
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; pos.forEach(p=>{x0=Math.min(x0,p.x-p.r);y0=Math.min(y0,p.y-p.r);x1=Math.max(x1,p.x+p.r);y1=Math.max(y1,p.y+p.r);});
  const bw=x1-x0,bh=y1-y0; view.scale=Math.min((cw-pad)/bw,(chh-pad)/bh); view.ox=(cw-bw*view.scale)/2-x0*view.scale; view.oy=(chh-bh*view.scale)/2-y0*view.scale; fitted=true; }

export function renderMap(){ if(cvs.hidden||!cvs.clientWidth)return; ensureSize(); if(!fitted)fitView(); draw(); }

function draw(){
  const cw=cvs.clientWidth,chh=cvs.clientHeight; g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,cw,chh);
  const focusId=hoverId||C.state.selectedId, focus=focusId?C.neighbors(focusId):null;

  // domain region labels
  g.textAlign="center"; g.font="700 11px ui-monospace,monospace";
  const cwd=Wd/3,chd=Hd/3;
  C.DOMAINS.forEach((dom,di)=>{ const col=di%3,row=(di/3|0); const c=S({x:(col+.5)*cwd,y:(row+.5)*chd-Math.min(cwd,chd)*0.34-14});
    g.fillStyle=C.state.filters.domains.has(dom)?C.DOMAIN_COLORS[dom]:"#333"; g.globalAlpha=C.state.filters.domains.has(dom)?0.92:0.3;
    g.fillText(C.DOM_ABBR[dom],c.x,c.y); });
  g.globalAlpha=1;

  // edges
  C.rels.forEach(e=>{ const a=pos.get(e.source_id),b=pos.get(e.target_id); if(!a||!b)return;
    if(!C.visible(a.c)||!C.visible(b.c))return; const st=C.EDGE_TYPES[e.type]||C.EDGE_TYPES.partnership;
    let al=0.5; if(e.type==="partnership")al=0.32;
    if(focus){ const t=e.source_id===focusId||e.target_id===focusId; al=t?0.95:0.05; }
    const A=S(a),B=S(b); g.globalAlpha=al; g.strokeStyle=st.color; g.lineWidth=focus&&al>0.5?2:1.1;
    g.setLineDash(st.dash.map(d=>d)); g.beginPath(); g.moveTo(A.x,A.y); g.lineTo(B.x,B.y); g.stroke(); g.setLineDash([]);
    if(st.arrow&&al>0.4){ const rb=b.r*view.scale+3, ang=Math.atan2(B.y-A.y,B.x-A.x), tx=B.x-Math.cos(ang)*rb, ty=B.y-Math.sin(ang)*rb;
      g.fillStyle=st.color; g.beginPath(); g.moveTo(tx,ty); g.lineTo(tx-Math.cos(ang-0.4)*7,ty-Math.sin(ang-0.4)*7); g.lineTo(tx-Math.cos(ang+0.4)*7,ty-Math.sin(ang+0.4)*7); g.closePath(); g.fill(); } });
  g.globalAlpha=1;

  // nodes
  pos.forEach((p,id)=>{ const c=p.c, vis=C.visible(c), P=S(p), rpx=Math.max(2.4,p.r*view.scale);
    let al=vis?1:0.05; if(vis&&focus)al=focus.has(id)?1:0.16;
    g.globalAlpha=al; const col=C.DOMAIN_COLORS[c.domain];
    if(!c.is_listed){ g.lineWidth=1.6; g.strokeStyle=col; g.beginPath(); g.arc(P.x,P.y,rpx,0,7); g.stroke();
      g.globalAlpha=al*0.35; g.fillStyle=col; g.fill(); }
    else { g.fillStyle=col; g.beginPath(); g.arc(P.x,P.y,rpx,0,7); g.fill(); }
    if(id===C.state.selectedId){ g.globalAlpha=1; g.strokeStyle="#ff9e3d"; g.lineWidth=2; g.beginPath(); g.arc(P.x,P.y,rpx+3.5,0,7); g.stroke(); }
  });
  g.globalAlpha=1;

  // labels for selected + hovered
  g.textAlign="left"; g.font="600 11px ui-monospace,monospace";
  [C.state.selectedId,hoverId].filter(Boolean).forEach(id=>{ const p=pos.get(id); if(!p)return; const P=S(p);
    g.fillStyle=id===C.state.selectedId?"#ffb866":"#eef3fc"; g.globalAlpha=1;
    g.fillText(p.c.name, P.x+Math.max(2.4,p.r*view.scale)+5, P.y+3.5); });
  g.globalAlpha=1;
}

function pick(mx,my){ let best=null,bd=1e9; pos.forEach((p,id)=>{ if(!C.visible(p.c))return; const P=S(p); const d=Math.hypot(P.x-mx,P.y-my);
  if(d<Math.max(2.4,p.r*view.scale)+6 && d<bd){bd=d;best=id;} }); return best; }
function onMove(ev){ const r=cvs.getBoundingClientRect(), mx=ev.clientX-r.left, my=ev.clientY-r.top;
  if(dragging){ view.ox+=mx-lastX; view.oy+=my-lastY; lastX=mx; lastY=my; dragMoved=true; draw(); return; }
  const id=pick(mx,my); if(id!==hoverId){ hoverId=id; draw(); }
  if(id){ const c=C.byId[id]; tip.hidden=false; tip.style.left=Math.min(mx+14,cvs.clientWidth-230)+"px"; tip.style.top=(my+14)+"px";
    tip.innerHTML=`<div class="tn">${c.name}</div><div class="td">${c.domain}</div><div class="tx">${c.is_listed?"Mkt "+(C.fmtEur?C.fmtEur(c.size_eur):c.size_eur):"Private"}</div>`;
    cvs.style.cursor="pointer"; } else { tip.hidden=true; cvs.style.cursor=dragging?"grabbing":"grab"; } }
function onDown(ev){ dragging=true; dragMoved=false; const r=cvs.getBoundingClientRect(); lastX=ev.clientX-r.left; lastY=ev.clientY-r.top; cvs.style.cursor="grabbing"; }
function onUp(){ dragging=false; cvs.style.cursor="grab"; }
function onClick(){ if(!dragMoved&&hoverId)C.select(hoverId); }
function onWheel(ev){ ev.preventDefault(); const r=cvs.getBoundingClientRect(), mx=ev.clientX-r.left, my=ev.clientY-r.top;
  const w0=W(mx,my), f=ev.deltaY<0?1.12:1/1.12; view.scale=Math.max(0.25,Math.min(6,view.scale*f));
  view.ox=mx-w0.x*view.scale; view.oy=my-w0.y*view.scale; draw(); }
