// MATRIX — adjacency grid (canvas). Rows = source, cols = target, ordered & banded by domain.
// Filled cell = relationship (coloured by type). Hover highlights row+col; click a label selects.
let C=null, cvs=null, g=null, tip=null;
let order=[], idx=new Map(), adj=new Map(), dpr=1, lastW=0,lastH=0;
let leftW=66, topW=66, cs=12, hover=null;

export function initMatrix(ctx,canvas,tipEl){ C=ctx; cvs=canvas; g=cvs.getContext("2d"); tip=tipEl;
  order=[]; C.DOMAINS.forEach(d=>C.companies.filter(c=>c.domain===d).sort((a,b)=>(b.size_eur||0)-(a.size_eur||0)).forEach(c=>order.push(c)));
  order.forEach((c,i)=>idx.set(c.id,i));
  C.rels.forEach(e=>{ const i=idx.get(e.source_id),j=idx.get(e.target_id); if(i!=null&&j!=null)adj.set(i+","+j,e); });
  cvs.addEventListener("mousemove",onMove); cvs.addEventListener("click",onClick);
  cvs.addEventListener("mouseleave",()=>{hover=null;tip.hidden=true;draw();}); }

function ensureSize(){ const cw=cvs.clientWidth,ch=cvs.clientHeight; dpr=Math.min(devicePixelRatio||1,2);
  if(cw!==lastW||ch!==lastH){ cvs.width=cw*dpr; cvs.height=ch*dpr; lastW=cw; lastH=ch; }
  const n=order.length; cs=Math.max(5,Math.floor(Math.min((cw-leftW-8)/n,(ch-topW-8)/n))); }

export function renderMatrix(){ if(cvs.hidden||!cvs.clientWidth)return; ensureSize(); draw(); }

function draw(){
  const cw=cvs.clientWidth,ch=cvs.clientHeight, n=order.length, lab=cs>=11;
  g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,cw,ch);
  const gx=leftW, gy=topW, sel=C.state.selectedId, vis=c=>C.visible(c);

  // domain bands (left + top strips) + separators
  for(let i=0;i<n;i++){ const c=order[i], col=C.DOMAIN_COLORS[c.domain]; g.globalAlpha=vis(c)?0.9:0.25;
    g.fillStyle=col; g.fillRect(gx-5,gy+i*cs,4,cs-1); g.fillRect(gx+i*cs,gy-5,cs-1,4); }
  g.globalAlpha=1; g.strokeStyle="#2b3140"; g.lineWidth=1;
  for(let i=1;i<n;i++){ if(order[i].domain!==order[i-1].domain){ g.beginPath(); g.moveTo(gx,gy+i*cs); g.lineTo(gx+n*cs,gy+i*cs); g.moveTo(gx+i*cs,gy); g.lineTo(gx+i*cs,gy+n*cs); g.stroke(); } }
  g.strokeStyle="#1a1e27"; g.strokeRect(gx,gy,n*cs,n*cs);

  // selected row/col band
  if(sel!=null&&idx.has(sel)){ const s=idx.get(sel); g.fillStyle="rgba(255,158,61,.10)"; g.fillRect(gx,gy+s*cs,n*cs,cs); g.fillRect(gx+s*cs,gy,cs,n*cs); }
  // hover band
  if(hover){ g.fillStyle="rgba(255,158,61,.16)"; if(hover.i>=0)g.fillRect(gx,gy+hover.i*cs,n*cs,cs); if(hover.j>=0)g.fillRect(gx+hover.j*cs,gy,cs,n*cs); }

  // filled cells
  adj.forEach((e,key)=>{ const [i,j]=key.split(",").map(Number); const st=C.EDGE_TYPES[e.type]||C.EDGE_TYPES.partnership;
    const dim=!vis(order[i])||!vis(order[j]); g.globalAlpha=dim?0.18:1; g.fillStyle=st.color;
    g.fillRect(gx+j*cs+1,gy+i*cs+1,cs-2,cs-2); });
  g.globalAlpha=1;

  // labels
  if(lab){ g.font=(cs<13?"8px":"9px")+" ui-monospace,monospace"; g.textBaseline="middle";
    for(let i=0;i<n;i++){ const c=order[i]; const on=sel===c.id||(hover&&hover.i===i); g.fillStyle=on?"#ff9e3d":(vis(c)?"#9aa4b2":"#3a4250");
      g.textAlign="right"; g.fillText(code(c),gx-8,gy+i*cs+cs/2);
      g.save(); g.translate(gx+i*cs+cs/2,gy-8); g.rotate(-Math.PI/2); g.textAlign="left";
      g.fillStyle=sel===c.id||(hover&&hover.j===i)?"#ff9e3d":(vis(c)?"#9aa4b2":"#3a4250"); g.fillText(code(c),0,0); g.restore(); }
    g.textBaseline="alphabetic"; }
}
function code(c){ const t=c.is_listed?(c.ticker||c.name):c.name; return t.length>8?t.slice(0,8):t; }

function cellAt(ev){ const r=cvs.getBoundingClientRect(), mx=ev.clientX-r.left, my=ev.clientY-r.top, n=order.length;
  const j=Math.floor((mx-leftW)/cs), i=Math.floor((my-topW)/cs);
  return {mx,my,i:(my>=topW&&i>=0&&i<n)?i:-1,j:(mx>=leftW&&j>=0&&j<n)?j:-1}; }
function onMove(ev){ const h=cellAt(ev); hover=h; draw();
  if(h.i<0&&h.j<0){ tip.hidden=true; return; }
  const rc=h.i>=0?order[h.i]:null, cc=h.j>=0?order[h.j]:null; let html="";
  if(h.i>=0&&h.j>=0){ const e=adj.get(h.i+","+h.j); html=`<div class="tn">${rc.name} <span style="color:#ff9e3d">→</span> ${cc.name}</div>`
    + (e?`<div class="td">${e.type.replace("_"," ")}</div><div class="tx">${e.note||""}</div>`:`<div class="td" style="color:#586273">no direct link</div>`); }
  else { const c=rc||cc; html=`<div class="tn">${c.name}</div><div class="td">${c.domain}</div>`; }
  tip.hidden=false; tip.innerHTML=html; tip.style.left=Math.min(h.mx+14,cvs.clientWidth-240)+"px"; tip.style.top=(h.my+14)+"px";
  cvs.style.cursor=(h.i>=0||h.j>=0)?"pointer":"default"; }
function onClick(ev){ const h=cellAt(ev); if(h.i>=0)C.select(order[h.i].id); else if(h.j>=0)C.select(order[h.j].id); }
