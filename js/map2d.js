// NETWORK MAP — 2D canvas. Companies grouped into 9 domain clusters (soft colored halos),
// edges curved + styled by type. Hover traces links, click selects, wheel/buttons zoom, drag pans.
let C=null, cvs=null, g=null, tip=null;
const pos=new Map();           // id -> {x,y,r,dom,c}
let clusters=[];               // {dom,di,cx,cy,R,n}
let view={scale:1,ox:0,oy:0}, fitted=false, lastW=0,lastH=0, dpr=1;
let hoverId=null, dragging=false, dragMoved=false, lastX=0,lastY=0, anim=0;
const Wd=1240, Hd=840;

export function initMap(ctx,canvas,tipEl){ C=ctx; cvs=canvas; g=cvs.getContext("2d"); tip=tipEl; layout();
  cvs.addEventListener("mousemove",onMove); cvs.addEventListener("mousedown",onDown);
  window.addEventListener("mouseup",onUp); cvs.addEventListener("click",onClick);
  cvs.addEventListener("dblclick",()=>animateTo(computeFit()));
  cvs.addEventListener("wheel",onWheel,{passive:false});
  cvs.addEventListener("mouseleave",()=>{hoverId=null;tip.hidden=true;draw();});
  const ctrls=document.getElementById("map-ctrls");
  if(ctrls) ctrls.addEventListener("click",e=>{ const b=e.target.closest("button"); if(!b)return; const z=b.dataset.z;
    if(z==="fit") animateTo(computeFit());
    else zoomAt(cvs.clientWidth/2, cvs.clientHeight/2, z==="in"?1.35:1/1.35, true); }); }

function nodeR(s){ const lg=Math.log10(s||1e8); return Math.max(3.8,Math.min(18, 4+(lg-8)/3.8*12)); }
function layout(){
  pos.clear(); clusters=[];
  const n=C.DOMAINS.length, cols=Math.max(1,Math.ceil(Math.sqrt(n))), rows=Math.ceil(n/cols);
  const cw=Wd/cols, ch=Hd/rows;
  C.DOMAINS.forEach((dom,di)=>{
    const col=di%cols,row=(di/cols|0), cx=(col+.5)*cw, cy=(row+.5)*ch, R=Math.min(cw,ch)*0.34;
    const list=C.companies.filter(c=>c.domain===dom).sort((a,b)=>(b.size_eur||0)-(a.size_eur||0));
    const n=list.length;
    list.forEach((c,k)=>{ const rr=R*Math.sqrt((k+0.6)/n), a=k*2.39996323;
      pos.set(c.id,{x:cx+Math.cos(a)*rr,y:cy+Math.sin(a)*rr,r:nodeR(c.size_eur),dom,c}); });
    clusters.push({dom,di,cx,cy,R,n});
  });
}
const S=p=>({x:p.x*view.scale+view.ox,y:p.y*view.scale+view.oy});
const W=(sx,sy)=>({x:(sx-view.ox)/view.scale,y:(sy-view.oy)/view.scale});
function ensureSize(){ const cw=cvs.clientWidth,chh=cvs.clientHeight; dpr=Math.min(devicePixelRatio||1,2);
  if(cw!==lastW||chh!==lastH){ cvs.width=cw*dpr; cvs.height=chh*dpr; lastW=cw; lastH=chh; fitted=false; } }
function computeFit(){ const cw=cvs.clientWidth,chh=cvs.clientHeight, pad=64;
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9; pos.forEach(p=>{x0=Math.min(x0,p.x-p.r);y0=Math.min(y0,p.y-p.r);x1=Math.max(x1,p.x+p.r);y1=Math.max(y1,p.y+p.r);});
  const bw=x1-x0,bh=y1-y0, sc=Math.min((cw-pad)/bw,(chh-pad)/bh);
  return {scale:sc, ox:(cw-bw*sc)/2-x0*sc, oy:(chh-bh*sc)/2-y0*sc}; }
function fitView(){ Object.assign(view,computeFit()); fitted=true; }

export function renderMap(){ if(cvs.hidden||!cvs.clientWidth)return; ensureSize(); if(!fitted)fitView(); draw(); }

function draw(){
  const cw=cvs.clientWidth,chh=cvs.clientHeight; g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,cw,chh);
  const focusId=hoverId||C.state.selectedId, focus=focusId?C.neighbors(focusId):null;
  const on=dom=>C.state.filters.domains.has(dom);

  // ── domain cluster halos ──
  clusters.forEach(cl=>{ const ctr=S({x:cl.cx,y:cl.cy}), R=cl.R*1.22*view.scale, col=C.DOMAIN_COLORS[cl.dom], lit=on(cl.dom);
    const grad=g.createRadialGradient(ctr.x,ctr.y,R*0.15,ctr.x,ctr.y,R);
    grad.addColorStop(0,col+(lit?"22":"0c")); grad.addColorStop(0.7,col+(lit?"10":"06")); grad.addColorStop(1,col+"00");
    g.fillStyle=grad; g.beginPath(); g.arc(ctr.x,ctr.y,R,0,7); g.fill();
    g.globalAlpha=lit?0.5:0.18; g.strokeStyle=col; g.lineWidth=1; g.setLineDash([2,5]); g.beginPath(); g.arc(ctr.x,ctr.y,R,0,7); g.stroke(); g.setLineDash([]); g.globalAlpha=1; });

  // ── edges (curved) ──
  C.rels.forEach(e=>{ const a=pos.get(e.source_id),b=pos.get(e.target_id); if(!a||!b)return;
    if(!C.visible(a.c)||!C.visible(b.c))return; const st=C.EDGE_TYPES[e.type]||C.EDGE_TYPES.partnership;
    let al = e.type==="partnership"?0.22:0.4;
    if(focus){ const t=e.source_id===focusId||e.target_id===focusId; al=t?0.95:0.05; }
    const A=S(a),B=S(b), traced=focus&&al>0.5;
    const mx=(A.x+B.x)/2, my=(A.y+B.y)/2, dx=B.x-A.x, dy=B.y-A.y, len=Math.hypot(dx,dy)||1;
    const off=Math.min(46,len*0.14), cxp=mx-dy/len*off, cyp=my+dx/len*off;     // bowed control point
    g.globalAlpha=al; g.strokeStyle=st.color; g.lineWidth=traced?2.2:1; g.setLineDash(st.dash);
    g.beginPath(); g.moveTo(A.x,A.y); g.quadraticCurveTo(cxp,cyp,B.x,B.y); g.stroke(); g.setLineDash([]);
    if(st.arrow&&traced){ const rb=b.r*view.scale+3, ang=Math.atan2(B.y-cyp,B.x-cxp), tx=B.x-Math.cos(ang)*rb, ty=B.y-Math.sin(ang)*rb;
      g.fillStyle=st.color; g.beginPath(); g.moveTo(tx,ty); g.lineTo(tx-Math.cos(ang-0.42)*8,ty-Math.sin(ang-0.42)*8); g.lineTo(tx-Math.cos(ang+0.42)*8,ty-Math.sin(ang+0.42)*8); g.closePath(); g.fill(); } });
  g.globalAlpha=1;

  // ── nodes ──
  pos.forEach((p,id)=>{ const c=p.c, vis=C.visible(c), P=S(p), rpx=Math.max(2.6,p.r*view.scale);
    let al=vis?1:0.05; if(vis&&focus)al=focus.has(id)?1:0.14;
    g.globalAlpha=al; const col=C.DOMAIN_COLORS[c.domain];
    if(vis&&!dragging){ g.shadowColor=col; g.shadowBlur=(focus&&focus.has(id))?12:5; } else g.shadowBlur=0;
    if(!c.is_listed){ g.fillStyle="#0a0d13"; g.beginPath(); g.arc(P.x,P.y,rpx,0,7); g.fill(); g.shadowBlur=0;
      g.lineWidth=1.8; g.strokeStyle=col; g.beginPath(); g.arc(P.x,P.y,rpx,0,7); g.stroke();
      g.globalAlpha=al*0.4; g.fillStyle=col; g.beginPath(); g.arc(P.x,P.y,rpx,0,7); g.fill(); }
    else { g.fillStyle=col; g.beginPath(); g.arc(P.x,P.y,rpx,0,7); g.fill(); g.shadowBlur=0;
      g.globalAlpha=Math.min(1,al+0.2); g.strokeStyle="#05070b"; g.lineWidth=1; g.stroke(); }
    if(c.band==="candidate"&&vis){ g.globalAlpha=al; g.strokeStyle="#ffb020"; g.lineWidth=1.4; g.setLineDash([2,2]); g.beginPath(); g.arc(P.x,P.y,rpx+2,0,7); g.stroke(); g.setLineDash([]); }
    if(id===C.state.selectedId){ g.globalAlpha=1; g.strokeStyle="#ff9e3d"; g.lineWidth=2.2; g.beginPath(); g.arc(P.x,P.y,rpx+4,0,7); g.stroke(); }
  });
  g.shadowBlur=0; g.globalAlpha=1;

  // ── ticker labels on big caps (+ hover/selected names) ──
  g.textAlign="left"; g.font="600 10.5px ui-monospace,monospace";
  pos.forEach((p,id)=>{ const c=p.c, P=S(p), rpx=Math.max(2.6,p.r*view.scale);
    if(rpx<10||!C.visible(c)) return; if(focus&&!focus.has(id)) return; if(id===C.state.selectedId||id===hoverId) return;
    g.globalAlpha=0.72; g.fillStyle="#aeb6c4"; g.fillText(c.is_listed?(c.ticker||c.name):c.name.split(" ")[0], P.x+rpx+4, P.y+3.5); });
  [C.state.selectedId,hoverId].filter(Boolean).forEach(id=>{ const p=pos.get(id); if(!p||!C.visible(p.c))return; const P=S(p), rpx=Math.max(2.6,p.r*view.scale);
    g.globalAlpha=1; g.font="700 11.5px ui-monospace,monospace"; g.fillStyle=id===C.state.selectedId?"#ffb866":"#eef3fc";
    g.fillText(p.c.name, P.x+rpx+5, P.y+3.5); });
  g.globalAlpha=1;

  // ── cluster labels (abbr + count) on top ──
  g.textAlign="center"; g.font="700 11px ui-monospace,monospace";
  clusters.forEach(cl=>{ const ctr=S({x:cl.cx,y:cl.cy-cl.R*1.22-12}), lit=on(cl.dom);
    g.globalAlpha=lit?1:0.32; g.fillStyle=C.DOMAIN_COLORS[cl.dom]; g.fillText(C.DOM_ABBR[cl.dom],ctr.x,ctr.y);
    g.font="500 8.5px ui-monospace,monospace"; g.fillStyle="#6b7585"; g.fillText(cl.n+" cos",ctr.x,ctr.y+11);
    g.font="700 11px ui-monospace,monospace"; });
  g.globalAlpha=1;
}

// ── interaction ──
function pick(mx,my){ let best=null,bd=1e9; pos.forEach((p,id)=>{ if(!C.visible(p.c))return; const P=S(p); const d=Math.hypot(P.x-mx,P.y-my);
  if(d<Math.max(2.6,p.r*view.scale)+6 && d<bd){bd=d;best=id;} }); return best; }
function onMove(ev){ const r=cvs.getBoundingClientRect(), mx=ev.clientX-r.left, my=ev.clientY-r.top;
  if(dragging){ view.ox+=mx-lastX; view.oy+=my-lastY; lastX=mx; lastY=my; dragMoved=true; draw(); return; }
  const id=pick(mx,my); if(id!==hoverId){ hoverId=id; draw(); }
  if(id){ const c=C.byId[id]; tip.hidden=false; tip.style.left=Math.min(mx+14,cvs.clientWidth-230)+"px"; tip.style.top=(my+14)+"px";
    tip.innerHTML=`<div class="tn">${c.name}</div><div class="td">${c.domain}</div><div class="tx">${c.is_listed?"Mkt "+(C.fmtEur?C.fmtEur(c.size_eur):c.size_eur):"Private"}</div>`;
    cvs.style.cursor="pointer"; } else { tip.hidden=true; cvs.style.cursor=dragging?"grabbing":"grab"; } }
function onDown(ev){ dragging=true; dragMoved=false; const r=cvs.getBoundingClientRect(); lastX=ev.clientX-r.left; lastY=ev.clientY-r.top; cvs.style.cursor="grabbing"; }
function onUp(){ if(dragging){dragging=false; draw();} cvs.style.cursor="grab"; }
function onClick(){ if(!dragMoved&&hoverId)C.select(hoverId); }
function onWheel(ev){ ev.preventDefault(); const r=cvs.getBoundingClientRect(); zoomAt(ev.clientX-r.left, ev.clientY-r.top, ev.deltaY<0?1.12:1/1.12, false); }
function zoomAt(mx,my,f,smooth){ const w0=W(mx,my), ns=Math.max(0.22,Math.min(7,view.scale*f));
  const target={scale:ns, ox:mx-w0.x*ns, oy:my-w0.y*ns};
  if(smooth) animateTo(target); else { Object.assign(view,target); draw(); } }
function animateTo(t){ cancelAnimationFrame(anim); const s0={...view}, t0=performance.now(), dur=200;
  const step=now=>{ const k=Math.min(1,(now-t0)/dur), e=k<.5?2*k*k:1-Math.pow(-2*k+2,2)/2;
    view.scale=s0.scale+(t.scale-s0.scale)*e; view.ox=s0.ox+(t.ox-s0.ox)*e; view.oy=s0.oy+(t.oy-s0.oy)*e; draw();
    if(k<1) anim=requestAnimationFrame(step); };
  anim=requestAnimationFrame(step); }
