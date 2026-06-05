import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { initPanel, showCompany, hidePanel } from './panel.js';

// ---------------- config ----------------
const DOMAINS = ["Materials & fab equipment","Semiconductors","Connectivity / telecom infrastructure",
  "Cloud & data infrastructure","AI & foundation models","Cybersecurity & defence",
  "Enterprise / industrial software","Quantum computing","Space & sovereign infrastructure"];
const DOMAIN_COLORS = {
  "Materials & fab equipment":"#38bdf8","Semiconductors":"#818cf8","Connectivity / telecom infrastructure":"#2dd4bf",
  "Cloud & data infrastructure":"#a78bfa","AI & foundation models":"#f472b6","Cybersecurity & defence":"#f87171",
  "Enterprise / industrial software":"#fbbf24","Quantum computing":"#c084fc","Space & sovereign infrastructure":"#4ade80"};
// bottom -> top order for the "stack layers" view (materials at base, AI/space on top)
const STACK_ORDER = ["Materials & fab equipment","Semiconductors","Connectivity / telecom infrastructure",
  "Cloud & data infrastructure","Enterprise / industrial software","Cybersecurity & defence",
  "Quantum computing","AI & foundation models","Space & sovereign infrastructure"];
const EDGE_STYLE = {
  supply_chain:{color:0xc8d4ff,opacity:0.55,dashed:false,flow:false,label:"Supply chain"},
  ownership:   {color:0xfbbf24,opacity:0.6, dashed:false,flow:true, label:"Ownership"},
  customer:    {color:0x38bdf8,opacity:0.5, dashed:false,flow:true, label:"Customer / dependency"},
  partnership: {color:0x94a3b8,opacity:0.34,dashed:true, flow:false,label:"Partnership / JV"}
};
const RING = 270;            // galaxy cluster ring radius (wider = more space between clusters)
const easeInOut = t => t<.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
const mulberry32 = a => ()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
const hash = s => {let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;};

// ---------------- state ----------------
let scene,camera,renderer,labelRenderer,controls,composer,bloom,raycaster;
let nodes=[], nodeMeshes=[], edges=[], clusterLabels=[], byId={}, companies=[], relationships=[];
let hovered=null, selected=null, layerMode=false, idleRotate=false, lastInteract=0;
const domainOn={}, listedOn={listed:true, private:true};
const pointer=new THREE.Vector2(-2,-2);
let camTween=null, clock;
const tmp=new THREE.Vector3();

// ---------------- boot ----------------
(async function boot(){
  if(!hasWebGL()){ document.getElementById("loading").style.display="none"; document.getElementById("webgl-error").style.display="flex"; return; }
  try{
    const [cR,rR] = await Promise.all([fetch("data/companies.json"),fetch("data/relationships.json")]);
    const cJson = await cR.json(); relationships=(await rR.json()).relationships;
    companies = cJson.companies;
    document.getElementById("asof").textContent = "as of "+(cJson.meta?.as_of||"");
    companies.forEach(c=>byId[c.id]=c);
    DOMAINS.forEach(d=>domainOn[d]=true);
    initScene(); buildGalaxy(); buildEdges(); buildUI();
    initPanel({companiesById:byId, relationships, domainColors:DOMAIN_COLORS,
      onNavigate:id=>navigateTo(id), onClose:()=>{ selected=null; }});
    window.addEventListener("resize",onResize);
    document.getElementById("loading").style.opacity="0";
    setTimeout(()=>document.getElementById("loading").style.display="none",400);
    clock=new THREE.Clock(); animate();
  }catch(err){
    console.error(err);
    document.getElementById("loading").innerHTML="<div class='lt'>Failed to load data — see console. Ensure you are serving over http (not file://).</div>";
  }
})();

function hasWebGL(){ try{const c=document.createElement("canvas");return !!(window.WebGLRenderingContext&&(c.getContext("webgl")||c.getContext("experimental-webgl")));}catch(e){return false;} }

// ---------------- scene ----------------
function initScene(){
  scene=new THREE.Scene();
  scene.fog=new THREE.FogExp2(0x05060d,0.0008);
  const W=innerWidth,H=innerHeight;
  camera=new THREE.PerspectiveCamera(55,W/H,0.1,5000);
  camera.position.set(0,110,700);

  renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.setSize(W,H); renderer.setClearColor(0x05060d,1);
  document.getElementById("scene").appendChild(renderer.domElement);

  labelRenderer=new CSS2DRenderer();
  labelRenderer.setSize(W,H);
  document.getElementById("css2d").appendChild(labelRenderer.domElement);

  controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true; controls.dampingFactor=0.06;
  controls.minDistance=40; controls.maxDistance=1700; controls.autoRotateSpeed=0.3;
  controls.addEventListener("start",()=>{ lastInteract=performance.now(); controls.autoRotate=false; });

  // post: bloom
  composer=new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene,camera));
  bloom=new UnrealBloomPass(new THREE.Vector2(W,H),0.6,0.5,0.2); // strength,radius,threshold — softer so nodes stay crisp
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  raycaster=new THREE.Raycaster();
  addStarfield(); addNebula();

  renderer.domElement.addEventListener("pointermove",onPointerMove);
  renderer.domElement.addEventListener("click",onClick);
  renderer.domElement.addEventListener("pointerdown",()=>lastInteract=performance.now());
}

function addStarfield(){
  const N=6500, pos=new Float32Array(N*3), col=new Float32Array(N*3);
  for(let i=0;i<N;i++){
    const r=600+Math.random()*1600, t=Math.random()*Math.PI*2, p=Math.acos(2*Math.random()-1);
    pos[i*3]=r*Math.sin(p)*Math.cos(t); pos[i*3+1]=r*Math.cos(p)*0.6; pos[i*3+2]=r*Math.sin(p)*Math.sin(t);
    const b=0.4+Math.random()*0.6; col[i*3]=b*0.8; col[i*3+1]=b*0.85; col[i*3+2]=b;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.BufferAttribute(pos,3));
  g.setAttribute("color",new THREE.BufferAttribute(col,3));
  const m=new THREE.PointsMaterial({size:1.6,sizeAttenuation:true,vertexColors:true,transparent:true,opacity:0.8,depthWrite:false,fog:false});
  scene.add(new THREE.Points(g,m));
}
function addNebula(){
  const tex=softTexture();
  const tints=[0x14213d,0x1b1030,0x07202a];
  tints.forEach((c,i)=>{
    const s=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,color:c,transparent:true,opacity:0.5,blending:THREE.AdditiveBlending,depthWrite:false}));
    s.position.set((i-1)*260,(i%2?-1:1)*80,-180-i*120); s.scale.set(900,900,1); scene.add(s);
  });
}

// textures
function glowTexture(){
  const c=document.createElement("canvas");c.width=c.height=64;const x=c.getContext("2d");
  const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,"rgba(255,255,255,1)");g.addColorStop(.25,"rgba(255,255,255,.85)");
  g.addColorStop(.55,"rgba(255,255,255,.28)");g.addColorStop(1,"rgba(255,255,255,0)");
  x.fillStyle=g;x.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);
}
function ringTexture(){
  const c=document.createElement("canvas");c.width=c.height=64;const x=c.getContext("2d");
  x.strokeStyle="rgba(255,255,255,1)";x.lineWidth=5;x.beginPath();x.arc(32,32,20,0,Math.PI*2);x.stroke();
  x.globalAlpha=.5;x.lineWidth=10;x.stroke();return new THREE.CanvasTexture(c);
}
function softTexture(){
  const c=document.createElement("canvas");c.width=c.height=128;const x=c.getContext("2d");
  const g=x.createRadialGradient(64,64,0,64,64,64);g.addColorStop(0,"rgba(255,255,255,.6)");g.addColorStop(1,"rgba(255,255,255,0)");
  x.fillStyle=g;x.fillRect(0,0,128,128);return new THREE.CanvasTexture(c);
}
const GLOW=null; // lazy below
let _glow,_ring,_flow;
function tex(kind){ if(kind==="glow")return _glow||(_glow=glowTexture()); if(kind==="ring")return _ring||(_ring=ringTexture()); return _flow||(_flow=glowTexture()); }

function sizeRadius(s){ if(!s) return 1.7; const lg=Math.log10(s); return Math.max(1.3,Math.min(7.4, 1.3+(lg-8)/(11.8-8)*6.1)); }

// ---------------- galaxy layout + nodes ----------------
function clusterCenter(i,n){ // fibonacci sphere -> even 3D spread of domain clusters
  const y=1-(i/(n-1))*2, r=Math.sqrt(1-y*y), th=Math.PI*(3-Math.sqrt(5))*i;
  return new THREE.Vector3(Math.cos(th)*r, y*0.78, Math.sin(th)*r).multiplyScalar(RING);
}
function buildGalaxy(){
  const sphereGeo=new THREE.SphereGeometry(1,20,20);
  const byDomain={}; DOMAINS.forEach(d=>byDomain[d]=[]);
  companies.forEach(c=>{ (byDomain[c.domain]||(byDomain[c.domain]=[])).push(c); });

  DOMAINS.forEach((dom,di)=>{
    const center=clusterCenter(di,DOMAINS.length);
    const list=byDomain[dom]||[]; const spread=34+Math.sqrt(list.length)*16;
    const stratumY=(STACK_ORDER.indexOf(dom)-(STACK_ORDER.length-1)/2)*46;
    const hd=document.createElement("div"); hd.className="cluster-label"; hd.textContent=dom; hd.style.color=DOMAIN_COLORS[dom]||"#fff";
    const headObj=new CSS2DObject(hd);
    const headGalaxy=center.clone().add(new THREE.Vector3(0,spread*0.92+20,0));
    const headLayer=new THREE.Vector3(-300,stratumY,0);
    headObj.position.copy(headGalaxy); scene.add(headObj);
    clusterLabels.push({obj:headObj,div:hd,dom,galaxyPos:headGalaxy,layerPos:headLayer,curPos:headGalaxy.clone()});
    const stackY=(STACK_ORDER.indexOf(dom)-(STACK_ORDER.length-1)/2)*46;
    list.forEach((c,ci)=>{
      const rnd=mulberry32(hash(c.id));
      const u=rnd(),v=rnd(),w=rnd();
      // even angular placement (fibonacci sphere) so companies in a cluster fan out, not clump
      const ny = list.length>1 ? 1-(ci/(list.length-1))*2 : 0;
      const nr = Math.sqrt(Math.max(0,1-ny*ny));
      const nth = Math.PI*(3-Math.sqrt(5))*ci + u*0.5;
      const dir = new THREE.Vector3(Math.cos(nth)*nr, ny, Math.sin(nth)*nr);
      const off = dir.multiplyScalar(spread*(0.66+0.34*v));
      off.x+=(u-.5)*spread*0.12; off.y+=(v-.5)*spread*0.12; off.z+=(w-.5)*spread*0.12;
      const galaxyPos=center.clone().add(off);
      // layered position
      const cols=Math.ceil(Math.sqrt(list.length));
      const layerPos=new THREE.Vector3(((ci%cols)-(cols-1)/2)*42 + (w-.5)*8, stackY+(rnd()-.5)*10, (Math.floor(ci/cols)-(Math.ceil(list.length/cols)-1)/2)*42 + (rnd()-.5)*8);

      const color=new THREE.Color(DOMAIN_COLORS[dom]||"#7c9cff");
      const rad=sizeRadius(c.size_eur);
      const priv=!c.is_listed;
      const mesh=new THREE.Mesh(sphereGeo,new THREE.MeshBasicMaterial({color:color.clone().multiplyScalar(priv?0.72:1),transparent:true,opacity:priv?0.72:1}));
      mesh.scale.setScalar(rad); mesh.position.copy(galaxyPos); mesh.userData.id=c.id;
      scene.add(mesh); nodeMeshes.push(mesh);

      const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:tex(priv?"ring":"glow"),color:color,
        transparent:true,opacity:priv?0.85:0.95,blending:THREE.AdditiveBlending,depthWrite:false}));
      glow.scale.setScalar(rad*(priv?4.5:3.7)); glow.position.copy(galaxyPos); scene.add(glow);

      const div=document.createElement("div"); div.className="label"; div.textContent=c.name;
      const label=new CSS2DObject(div); label.position.set(0,1.5,0); mesh.add(label);

      nodes.push({c,mesh,glow,div,rad,color,galaxyPos,layerPos,
        curPos:galaxyPos.clone(),baseGlow:priv?0.8:0.9,baseMesh:priv?0.72:1,
        alpha:1,scaleMul:1,priv});
    });
  });
}

// ---------------- edges ----------------
function nodeById(id){ return nodes.find(n=>n.c.id===id); }
function buildEdges(){
  relationships.forEach(e=>{
    const a=nodeById(e.source_id), b=nodeById(e.target_id); if(!a||!b) return;
    const st=EDGE_STYLE[e.type]||EDGE_STYLE.partnership;
    const curve=makeCurve(a.curPos,b.curPos);
    const geo=new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
    const mat = st.dashed
      ? new THREE.LineDashedMaterial({color:st.color,transparent:true,opacity:st.opacity,dashSize:2.4,gapSize:3.2})
      : new THREE.LineBasicMaterial({color:st.color,transparent:true,opacity:st.opacity});
    const line=new THREE.Line(geo,mat); if(st.dashed) line.computeLineDistances();
    scene.add(line);
    const flows=[];
    if(st.flow){ for(let k=0;k<2;k++){ const fs=new THREE.Sprite(new THREE.SpriteMaterial({map:tex("flow"),color:st.color,transparent:true,opacity:0.95,blending:THREE.AdditiveBlending,depthWrite:false})); fs.scale.setScalar(3.4); scene.add(fs); flows.push({sp:fs,off:k*0.5}); } }
    edges.push({e,a,b,line,mat,curve,style:st,flows,baseOpacity:st.opacity,alpha:1});
  });
}
function makeCurve(a,b){
  const mid=a.clone().add(b).multiplyScalar(0.5);
  const lift=a.distanceTo(b)*0.18+6;
  const ctrl=mid.clone().add(mid.clone().normalize().multiplyScalar(lift));
  return new THREE.QuadraticBezierCurve3(a.clone(),ctrl,b.clone());
}
function refreshEdgeGeometry(){
  edges.forEach(ed=>{ ed.curve=makeCurve(ed.a.curPos,ed.b.curPos);
    ed.line.geometry.setFromPoints(ed.curve.getPoints(50)); if(ed.style.dashed) ed.line.computeLineDistances(); ed.line.geometry.attributes.position.needsUpdate=true; });
}

// ---------------- UI ----------------
function buildUI(){
  const counts={}; companies.forEach(c=>counts[c.domain]=(counts[c.domain]||0)+1);
  const legend=document.getElementById("legend");
  DOMAINS.forEach(d=>{
    const row=document.createElement("div"); row.className="legend-row"; row.dataset.dom=d;
    row.innerHTML=`<span class="dot" style="color:${DOMAIN_COLORS[d]};background:${DOMAIN_COLORS[d]}"></span><span>${d.replace(" / ","/").replace(" & "," & ")}</span><span class="cnt">${counts[d]||0}</span>`;
    row.onclick=()=>{ domainOn[d]=!domainOn[d]; row.classList.toggle("off",!domainOn[d]); applyFilters(); };
    legend.appendChild(row);
  });
  // edge key
  const ek=document.getElementById("edgekey");
  Object.values(EDGE_STYLE).forEach(s=>{
    const hex="#"+s.color.toString(16).padStart(6,"0");
    ek.innerHTML+=`<div class="edgekey"><span class="edgeline" style="border-top:${s.dashed?"2px dashed":"2px solid"} ${hex};opacity:${s.flow?1:.9}"></span>${s.label}${s.flow?" ▸":""}</div>`;
  });
  // listed/private filter
  const fl=document.getElementById("filter-listed");
  [["listed","Listed companies","dot"],["private","Private (valuation/funding)","dot ring"]].forEach(([k,lbl,cls])=>{
    const row=document.createElement("div"); row.className="filter-row";
    row.innerHTML=`<span class="${cls}" style="color:#9fb0d0"></span><span>${lbl}</span>`;
    row.onclick=()=>{ listedOn[k]=!listedOn[k]; row.classList.toggle("off",!listedOn[k]); applyFilters(); };
    fl.appendChild(row);
  });
  // search datalist
  const dl=document.getElementById("company-list");
  companies.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(c=>{ const o=document.createElement("option"); o.value=c.name; dl.appendChild(o); });
  const si=document.getElementById("search");
  const go=()=>{ const v=si.value.trim().toLowerCase(); const m=companies.find(c=>c.name.toLowerCase()===v)||companies.find(c=>c.name.toLowerCase().includes(v)&&v.length>1); if(m){ navigateTo(m.id); si.blur(); } };
  si.addEventListener("change",go); si.addEventListener("keydown",e=>{ if(e.key==="Enter") go(); });

  document.getElementById("btn-layout").onclick=e=>{ layerMode=!layerMode; e.target.classList.toggle("active",layerMode); e.target.textContent=layerMode?"✦ Free cosmos":"⬚ Stack layers"; startLayout(); };
  const rb=document.getElementById("btn-rotate"); rb.classList.toggle("active",idleRotate);
  rb.onclick=()=>{ idleRotate=!idleRotate; rb.classList.toggle("active",idleRotate); if(!idleRotate) controls.autoRotate=false; lastInteract=performance.now(); };
  document.getElementById("btn-reset").onclick=()=>{ selected=null; hidePanel(); flyTo(new THREE.Vector3(0,110,700),new THREE.Vector3(0,0,0)); };
}

let layoutTween=null;
function startLayout(){ layoutTween={t:0,dur:1.3}; }

function applyFilters(){ /* handled per-frame via filteredIn() */ }
function filteredIn(n){ return domainOn[n.c.domain] && ((n.priv&&listedOn.private)||(!n.priv&&listedOn.listed)); }

// ---------------- interaction ----------------
function onPointerMove(ev){
  pointer.x=(ev.clientX/innerWidth)*2-1; pointer.y=-(ev.clientY/innerHeight)*2+1;
  lastInteract=performance.now();
  const hit=pick();
  const tip=document.getElementById("tooltip");
  if(hit){ hovered=hit.c.id;
    tip.style.opacity="1"; tip.style.left=(ev.clientX+14)+"px"; tip.style.top=(ev.clientY+14)+"px";
    tip.querySelector(".tt-name").textContent=hit.c.name;
    tip.querySelector(".tt-dom").textContent=hit.c.domain+(hit.c.is_listed?"":" · private");
    document.body.style.cursor="pointer";
  } else { hovered=null; tip.style.opacity="0"; document.body.style.cursor="default"; }
}
function onClick(){ const hit=pick(); if(hit){ navigateTo(hit.c.id); } else { selected=null; hidePanel(); } }
function pick(){
  raycaster.setFromCamera(pointer,camera);
  const hits=raycaster.intersectObjects(nodeMeshes,false);
  for(const h of hits){ const n=nodeById(h.object.userData.id); if(n&&filteredIn(n)) return n; }
  return null;
}
function navigateTo(id){
  const n=nodeById(id); if(!n) return;
  selected=id;
  // ensure visible if filtered out
  if(!filteredIn(n)){ domainOn[n.c.domain]=true; listedOn[n.priv?"private":"listed"]=true; syncFilterUI(); }
  const dir=camera.position.clone().sub(n.curPos); if(dir.lengthSq()<1) dir.set(0,0.4,1);
  dir.normalize(); const dist=Math.max(36,n.rad*7+22);
  flyTo(n.curPos.clone().add(dir.multiplyScalar(dist)), n.curPos.clone());
  showCompany(n.c);
}
function syncFilterUI(){
  document.querySelectorAll("#legend .legend-row").forEach(r=>r.classList.toggle("off",!domainOn[r.dataset.dom]));
}
function flyTo(pos,target){ camTween={fromP:camera.position.clone(),toP:pos,fromT:controls.target.clone(),toT:target,t:0,dur:1.1}; controls.autoRotate=false; }

// ---------------- animate ----------------
function animate(){
  requestAnimationFrame(animate);
  const dt=clock.getDelta(), now=performance.now();

  if(camTween){ camTween.t=Math.min(1,camTween.t+dt/camTween.dur); const k=easeInOut(camTween.t);
    camera.position.lerpVectors(camTween.fromP,camTween.toP,k); controls.target.lerpVectors(camTween.fromT,camTween.toT,k);
    if(camTween.t>=1) camTween=null; }

  if(layoutTween){ layoutTween.t=Math.min(1,layoutTween.t+dt/layoutTween.dur); const k=easeInOut(layoutTween.t);
    nodes.forEach(n=>{ const a=layerMode?n.galaxyPos:n.layerPos, b=layerMode?n.layerPos:n.galaxyPos; n.curPos.lerpVectors(a,b,k); n.mesh.position.copy(n.curPos); n.glow.position.copy(n.curPos); });
    clusterLabels.forEach(cl=>{ const a=layerMode?cl.galaxyPos:cl.layerPos, b=layerMode?cl.layerPos:cl.galaxyPos; cl.curPos.lerpVectors(a,b,k); cl.obj.position.copy(cl.curPos); });
    refreshEdgeGeometry(); if(layoutTween.t>=1) layoutTween=null; }

  // static by default — rotation only when the user enables the Auto-rotate button
  controls.autoRotate = idleRotate && !camTween;
  controls.update();

  // focus / filter visuals
  const focusId = hovered || selected;
  const focusSet = focusId ? neighborSet(focusId) : null;
  nodes.forEach(n=>{
    const fin=filteredIn(n);
    let aTarget = fin?1:0.045;
    if(fin && focusSet) aTarget = focusSet.has(n.c.id)?1:0.12;
    let sTarget = (focusId===n.c.id)?1.4:1;
    n.alpha += (aTarget-n.alpha)*Math.min(1,dt*8);
    n.scaleMul += (sTarget-n.scaleMul)*Math.min(1,dt*8);
    n.mesh.material.opacity=n.baseMesh*n.alpha;
    n.glow.material.opacity=n.baseGlow*n.alpha;
    n.mesh.scale.setScalar(n.rad*n.scaleMul);
    n.glow.scale.setScalar(n.rad*(n.priv?4.5:3.7)*n.scaleMul);
    // label visibility
    const dist=camera.position.distanceTo(n.curPos);
    const show = fin && (focusId===n.c.id || (focusSet&&focusSet.has(n.c.id)));
    let lop = show ? Math.max(0,Math.min(1,(900-dist)/520)) : 0;
    if(focusId===n.c.id) lop=1;
    n.div.style.opacity=lop.toFixed(2);
    n.div.style.display=lop<0.04?"none":"block";
    n.div.classList.toggle("sel",selected===n.c.id);
  });
  // edges
  edges.forEach(ed=>{
    const vis=filteredIn(ed.a)&&filteredIn(ed.b);
    let aT = vis?1:0;
    if(vis&&focusSet){ const touch=ed.e.source_id===focusId||ed.e.target_id===focusId; aT=touch?1.25:0.07; }
    ed.alpha += (aT-ed.alpha)*Math.min(1,dt*8);
    ed.mat.opacity=ed.baseOpacity*ed.alpha;
    ed.line.visible=ed.alpha>0.01;
    ed.flows.forEach(f=>{
      f.off=(f.off+dt*0.18)%1; const p=ed.curve.getPointAt(f.off); f.sp.position.copy(p);
      f.sp.material.opacity=Math.min(1,ed.alpha)* (vis?0.95:0); f.sp.visible=ed.alpha>0.05;
    });
  });

  // in-space domain headings: always-on orientation, fade slightly with distance, hide if domain filtered out
  clusterLabels.forEach(cl=>{ const vis=domainOn[cl.dom]; cl.div.style.display=vis?"block":"none";
    if(vis){ const d=camera.position.distanceTo(cl.curPos); cl.div.style.opacity=Math.max(0.2,Math.min(0.95,(1550-d)/980)).toFixed(2); } });

  composer.render();
  labelRenderer.render(scene,camera);
}
function neighborSet(id){ const s=new Set([id]); relationships.forEach(e=>{ if(e.source_id===id)s.add(e.target_id); if(e.target_id===id)s.add(e.source_id); }); return s; }

function onResize(){ const W=innerWidth,H=innerHeight; camera.aspect=W/H; camera.updateProjectionMatrix();
  renderer.setSize(W,H); composer.setSize(W,H); bloom.setSize(W,H); labelRenderer.setSize(W,H); }
