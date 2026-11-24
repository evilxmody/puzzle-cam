// Unit tests for the pure logic of app.js (the block between /*PURE-START*/ and /*PURE-END*/ + the tunables) and for the HTML/JS contract.
// usage: node tests/unit.mjs [path/to/app.js] [path/to/original/app.js]
// Everything here is SIMULATION: synthetic landmarks and synthetic noise. No camera and no real MediaPipe model are involved.
import fs from 'fs';import path from 'path';import {fileURLToPath} from 'url';import {spawnSync} from 'child_process';
const HERE=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.join(HERE,'..');
const APP=path.resolve(process.argv[2]||path.join(ROOT,'app.js')),ORIG=process.argv[3]&&path.resolve(process.argv[3]);
const src=fs.readFileSync(APP,'utf8');
let pass=0,fail=0;const T=(name,cond,info='')=>{cond?pass++:fail++;console.log((cond?'PASS ':'FAIL ')+name+(info?'  — '+info:''))};
const pure=src.slice(src.indexOf('/*PURE-START*/'),src.indexOf('/*PURE-END*/'));
const CUR=new Function('return '+src.match(/\/\*CUR\*\/(\{.*?\})\/\*CUR\*\//)[1])(),SKF=new Function('return '+src.match(/const SKF=(\{.*?\});/)[1])();
const M=new Function(pure+';return {OE,Cursor,PinchFSM,pinchRatio,pinchValid,palmSize,handAlpha,lostState,HAND_CONN,TIPS,PALM,THUMB_INDEX,mapSkeleton,toScreen,drawHand,solvedBoard,shuffleBoard,boardSolvable,isSolved,nbrs,'+(pure.includes('boxOf')?'boxOf':'boxOf:null')+'}')();
let sd=4242;const rnd=()=>(sd=(sd*1664525+1013904223)>>>0)/4294967296,gau=()=>Math.sqrt(-2*Math.log(rnd()+1e-12))*Math.cos(6.2832*rnd());
const dt=1000/30;

console.log('\n[1] syntax + HTML/JS contract');
{const r=spawnSync(process.execPath,['--check','--input-type=module'],{input:src});T('app.js parses as an ES module (node --check)',r.status===0,(r.stderr||'').toString().split('\n')[0]);
 const html=fs.readFileSync(path.join(path.dirname(APP),'index.html'),'utf8'),ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
 const used=new Set([...src.matchAll(/\$\('#([\w-]+)'\)/g)].map(m=>m[1]));[...src.matchAll(/querySelector\('#([\w-]+)/g)].forEach(m=>used.add(m[1]));
 const missing=[...used].filter(i=>!ids.has(i));T('every #id that app.js looks up exists in index.html',missing.length===0,missing.join(',')||used.size+' ids');
 const css=fs.readFileSync(path.join(path.dirname(APP),'style.css'),'utf8');T('style.css braces balance',css.split('{').length===css.split('}').length);
 if(ORIG&&fs.existsSync(ORIG)){const o=fs.readFileSync(ORIG,'utf8'),names=s=>new Set([...s.matchAll(/(?:^|[;\n}{ ])(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/g)].map(m=>m[1]));
  const gone=[...names(o)].filter(n=>!names(src).has(n));T('no declaration of the original app.js was removed (features preserved)',gone.length===0,gone.join(',')||names(o).size+' declarations kept');
  const keep=['sfx','ambience','shuffleBoard','scramble','grab','release','win','recoverCam','startCapture','doCapture','cancelCapture'];T('puzzle mechanics, sounds, capture and camera-recovery code still present',keep.every(k=>new RegExp('(function|const|let)\\s+'+k+'\\b').test(src)))}}

console.log('\n[2] all 21 landmark connections');
{const OFFICIAL=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
 const key=([a,b])=>a<b?a+'-'+b:b+'-'+a,A=new Set(M.HAND_CONN.map(key)),B=new Set(OFFICIAL.map(key));
 T('exactly 21 distinct bones',M.HAND_CONN.length===21&&A.size===21);
 T('bone list equals the official MediaPipe HAND_CONNECTIONS (undirected)',[...B].every(k=>A.has(k))&&[...A].every(k=>B.has(k)));
 const seen=new Set(M.HAND_CONN.flat());T('every landmark 0..20 belongs to a bone',[...Array(21).keys()].every(i=>seen.has(i)));
 const adj=[...Array(21)].map(()=>[]);M.HAND_CONN.forEach(([a,b])=>{adj[a].push(b);adj[b].push(a)});const vis=new Set([0]),q=[0];while(q.length){const n=q.pop();adj[n].forEach(m=>{if(!vis.has(m)){vis.add(m);q.push(m)}})}
 T('the skeleton is one connected piece (wrist reaches all 20 other joints)',vis.size===21);
 const chains={thumb:[1,2,3,4],index:[5,6,7,8],middle:[9,10,11,12],ring:[13,14,15,16],pinky:[17,18,19,20]};
 T('all five fingers are complete chains from knuckle to tip',Object.values(chains).every(c=>c.slice(1).every((j,i)=>A.has(key([c[i],j])))));
 T('palm outline closed: wrist-thumb, wrist-index, index-middle-ring-pinky knuckles, wrist-pinky',[[0,1],[0,5],[5,9],[9,13],[13,17],[0,17]].every(b=>A.has(key(b))));}

console.log('\n[3] drawing: what is really sent to the canvas');
{const mk=()=>{const ops=[];let path=null,cur=null;const c={globalAlpha:1,strokeStyle:'',fillStyle:'',lineWidth:1,lineCap:'',lineJoin:'',lineDashOffset:0,ops,
   save(){},restore(){},setLineDash(){},beginPath(){path={segs:[],arcs:[]};cur=null},closePath(){},moveTo(x,y){cur=[x,y]},lineTo(x,y){path.segs.push([cur,[x,y]]);cur=[x,y]},arc(x,y,r){path.arcs.push([x,y,r])},
   stroke(){ops.push({t:'stroke',segs:path.segs.slice(),arcs:path.arcs.slice(),style:c.strokeStyle,lw:c.lineWidth,a:c.globalAlpha})},fill(){ops.push({t:'fill',segs:path.segs.slice(),arcs:path.arcs.slice(),style:c.fillStyle,a:c.globalAlpha})}};return c};
 const P=new Float32Array(42);for(let i=0;i<21;i++){P[2*i]=100+i*11;P[2*i+1]=300-(i*i%17)*9}   // distinct coordinates
 const pt=i=>[P[2*i],P[2*i+1]],same=(a,b)=>Math.abs(a[0]-b[0])<1e-3&&Math.abs(a[1]-b[1])<1e-3;
 let c=mk();M.drawHand(c,P,1,0,false,1000,1,false,true);
 const bonePass=c.ops.filter(o=>o.t==='stroke'&&o.segs.length===21);
 T('full style strokes the 21 bones several times (glow, body, core, travelling pulses)',bonePass.length>=3,bonePass.length+' passes');
 T('every one of the 21 bone segments joins the right two joint positions',M.HAND_CONN.every(([a,b])=>bonePass[0].segs.some(([p,q])=>(same(p,pt(a))&&same(q,pt(b)))||(same(p,pt(b))&&same(q,pt(a))))));
 const nodes=c.ops.filter(o=>o.t==='fill'&&o.arcs.length===21);T('21 bright joint nodes are drawn (plus a glow layer of 21)',nodes.length===2,nodes.length+' passes');
 T('node circles sit on the joint coordinates',nodes[1].arcs.every(([x,y],i)=>same([x,y],pt(i))));
 const palm=c.ops.find(o=>o.t==='fill'&&o.segs.length>=5&&o.arcs.length===0);T('palm membrane is filled',!!palm);
 T('colour is cyan/ice-blue',bonePass.some(o=>/#5ee1ff|#22d3ee/i.test(o.style))&&bonePass.some(o=>/#e6fbff/i.test(o.style)));
 T('travelling pulse pass exists on desktop (fx=true) and is skipped with fx=false',c.ops.some(o=>o.t==='stroke'&&o.style==='#fff'&&o.segs.length===21)&&!(()=>{const d=mk();M.drawHand(d,P,1,0,false,1000,1,false,false);return d.ops.some(o=>o.t==='stroke'&&o.style==='#fff'&&o.segs.length===21)})());
 c=mk();M.drawHand(c,P,1,1,false,1000,1,false,true);
 const hi=c.ops.find(o=>o.t==='stroke'&&o.segs.length===6&&o.style==='#fff');T('pinch: thumb + index chains (6 bones) get a white highlight',!!hi&&M.THUMB_INDEX.every(([a,b])=>hi.segs.some(([p,q])=>same(p,pt(a))&&same(q,pt(b)))));
 T('pinch: bridge line joins thumb tip and index tip',c.ops.some(o=>o.t==='stroke'&&o.segs.length===1&&same(o.segs[0][0],pt(4))&&same(o.segs[0][1],pt(8))));
 T('pinch: thumb and index tip nodes are enlarged',c.ops.some(o=>o.t==='fill'&&o.arcs.length===1&&o.arcs[0][2]>6)&&c.ops.filter(o=>o.t==='fill'&&o.arcs.length===1).length>=2);
 const gl=x=>x.ops.find(o=>o.t==='stroke'&&o.segs.length===21&&o.lw>=8);
 const ca=mk();M.drawHand(ca,P,1,0,false,1000,1,false,false);const cb=mk();M.drawHand(cb,P,1,0,true,1000,1,false,false);
 T('dragging highlights the active hand (violet, wider glow)',gl(cb).style==='#8b5cf6'&&gl(cb).lw>gl(ca).lw&&gl(ca).style==='#22d3ee');
 c=mk();M.drawHand(c,P,.01,0,false,1000,1,false,true);T('fully faded hand (alpha<0.02) draws nothing',c.ops.length===0);
 const a1=mk();M.drawHand(a1,P,.5,0,false,1000,1,false,false);T('fade: every pass is scaled by the hand alpha',a1.ops.every(o=>o.a<=.5+1e-9));
 c=mk();M.drawHand(c,P,1,0,false,1000,1,true,false);T('lite style (mini preview / phones) skips the wide glow pass',!c.ops.some(o=>o.t==='stroke'&&o.lw>=8)&&c.ops.some(o=>o.t==='stroke'&&o.segs.length===21));
 T('no shadowBlur anywhere in the hand renderer (cheap on phones)',!/drawHand[\s\S]{0,3200}shadowBlur/.test(src.slice(src.indexOf('function drawHand'),src.indexOf('function drawHand')+3200)));
 if(src.includes('wv(i)')){const r0=mk(),r1=mk();M.drawHand(r0,P,1,0,false,0,1,false,false);M.drawHand(r1,P,1,0,false,700,1,false,false);
  T('holographic pulse: node sizes breathe over time but stay within ±12%',r0.ops.filter(o=>o.t==='fill'&&o.arcs.length===21).some((o,k)=>o.arcs.some(([,,r],i)=>Math.abs(r-r1.ops.filter(q=>q.t==='fill'&&q.arcs.length===21)[k].arcs[i][2])>1e-4))&&r1.ops.filter(o=>o.t==='fill'&&o.arcs.length===21)[1].arcs.every(([,,r],i)=>{const base=(M.TIPS.includes(i)?3.6:2.4);return r>=base*.87&&r<=base*1.13}));
  const ga=mk(),gb=mk();M.drawHand(ga,P,1,0,false,0,1,false,false);M.drawHand(gb,P,1,0,false,820,1,false,false);const A=gl(ga).a,B=gl(gb).a;T('holographic pulse: glow alpha breathes smoothly (15% swing), never flickers',A!==B&&Math.max(A,B)/Math.min(A,B)<1.6,A.toFixed(3)+' vs '+B.toFixed(3))}}

console.log('\n[4] mapping + mirroring');
{const W=1280,H=720,L=M.toScreen(.92,.5,W,H),R=M.toScreen(.08,.5,W,H);
 T('toScreen mirrors: a hand at the RIGHT of the raw camera frame lands on the LEFT of the screen',L.x===0&&R.x===W);
 T('toScreen: raw centre → screen centre',Math.abs(M.toScreen(.5,.5,W,H).x-W/2)<1e-9&&Math.abs(M.toScreen(.5,.5,W,H).y-H/2)<1e-9);
 T('toScreen: y is not flipped; central 84% reaches every screen edge; outside is clamped',M.toScreen(.5,.08,W,H).y===0&&M.toScreen(.5,.92,W,H).y===H&&M.toScreen(-1,2,W,H).x===W&&M.toScreen(-1,2,W,H).y===H);
 const pts=new Float32Array(42);for(let i=0;i<21;i++){pts[2*i]=200+i*7;pts[2*i+1]=150+(i%5)*13}
 const mid={x:(pts[8]+pts[16])/2,y:(pts[9]+pts[17])/2},anchor={x:640,y:360},out=new Float32Array(42);M.mapSkeleton(pts,mid,anchor,1.5,out);
 T('mapSkeleton: thumb/index midpoint lands exactly on the cursor anchor',Math.abs((out[8]+out[16])/2-640)<1e-3&&Math.abs((out[9]+out[17])/2-360)<1e-3);
 T('mapSkeleton: horizontally mirrored (camera x grows → screen x shrinks)',out[2*20]<out[0]===(pts[2*20]>pts[0]));
 T('mapSkeleton: vertical order preserved',(out[3]-out[1])*(pts[3]-pts[1])>0);
 const d=(a,b,P)=>Math.hypot(P[2*a]-P[2*b],P[2*a+1]-P[2*b+1]);T('mapSkeleton: uniform scale (no stretch): every bone length ×1.5',M.HAND_CONN.every(([a,b])=>Math.abs(d(a,b,out)-1.5*d(a,b,pts))<1e-3));
 if(M.boxOf){const P=new Float32Array(42);for(let i=0;i<21;i++){P[2*i]=50+i*17.3;P[2*i+1]=500-i*9.1}const b=M.boxOf(P,20,1.25,1000,1000);
  T('dirty-rect box contains every joint + padding (device px)',[...Array(21).keys()].every(i=>P[2*i]*1.25>=b.x+20*1.25-1&&P[2*i]*1.25<=b.x+b.w-20*1.25+1&&P[2*i+1]*1.25>=b.y+20*1.25-1||b.y===0));
  const e=M.boxOf(P,500,2,300,300);T('dirty-rect box is clamped to the canvas',e.x>=0&&e.y>=0&&e.x+e.w<=300&&e.y+e.h<=300)}}

console.log('\n[5] filters');
{const mkS=()=>new M.OE(SKF.mc,SKF.beta,SKF.dc,SKF.dz);
 let f=mkS(),t=0,o=[];for(let i=0;i<100;i++){t+=dt;o.push(f.f(100,t))}T('constant input → constant output',o.every(v=>Math.abs(v-100)<1e-9));
 f=mkS();t=0;f.f(0,t);let mx=0,mono=true,pv=0;for(let i=0;i<90;i++){t+=dt;const y=f.f(80,t);mx=Math.max(mx,y);if(y<pv-1e-9)mono=false;pv=y}T('step response: monotone and never overshoots (≤ target)',mono&&mx<=80+1e-9,'max '+mx.toFixed(2));
 f=mkS();f.f(5,1000);T('duplicate / out-of-order timestamp never produces NaN',Number.isFinite(f.f(7,1000))&&Number.isFinite(f.f(7,900)));
 f=mkS();f.f(0,0);T('long gap (tracking loss) restarts instead of smearing',f.f(300,2000)===300);
 f=mkS();t=0;let rest=[];for(let i=0;i<300;i++){t+=dt;rest.push(f.f(100+.7*gau(),t))}const rms=Math.sqrt(rest.slice(60).reduce((a,b)=>a+(b-100)**2,0)/240);T('skeleton filter cuts landmark jitter ≥2× at rest',rms<.7/2,'0.70 px in → '+rms.toFixed(2)+' px out');
 const lag=v=>{f=mkS();let t=0,L=[];for(let i=0;i<150;i++){t+=dt;const x=100+v*t/1000,y=f.f(x+.7*gau(),t);if(i>60)L.push((x-y)/v*1000)}return L.reduce((a,b)=>a+b)/L.length};
 const l100=lag(100),l300=lag(300);T('skeleton filter adapts: lag shrinks as the hand speeds up',lag(30)>l100&&l100>l300,`lag ms @30/100/300/600 px/s = ${[30,100,300,600].map(v=>lag(v).toFixed(0)).join('/')}`);
 T('lag during real movement (≥300 px/s) is under 1 camera frame (33 ms)',l300<33,l300.toFixed(0)+' ms')}

console.log('\n[6] cursor: simulated movement, stops, dragging');
{const sim=(v,predict=true,noise=1.2)=>{const c=new M.Cursor(CUR);let tc=0,now=0,fin=0,over=0,stopAt=60;
   for(let i=0;i<stopAt+40;i++){tc+=dt;now+=dt;const x=100+(i<stopAt?v*tc/1000:v*stopAt*dt/1000);if(i===stopAt)fin=x;c.feed(tc,x+noise*gau(),400+noise*gau(),now);for(let r=0;r<4;r++){const p=c.at(now+r*dt/4,predict);if(i>=stopAt)over=Math.max(over,p.x-fin)}}return over};
 for(const v of [200,600,1500,3000])T(`no overshoot when a hand moving ${v} px/s stops dead (≤1.5 px, 120 Hz render, 30 fps camera)`,sim(v)<=1.5,sim(v).toFixed(2)+' px');
 {const c=new M.Cursor(CUR);let tc=0,now=0;for(let i=0;i<60;i++){tc+=dt;now+=dt;c.feed(tc,100+1500*tc/1000,300,now);c.at(now,true)}
  let lead=-9;for(let i=0;i<40;i++){const tt=now+i*4;const p=c.at(tt,false);if(i>30)lead=Math.max(lead,p.x-c.b.x)}
  T('dragging (predict=false): no velocity look-ahead — shown point never ahead of the measured/filtered hand position',lead<=.5,'lead '+lead.toFixed(2)+' px');
  const c2=new M.Cursor(CUR);tc=0;now=0;for(let i=0;i<60;i++){tc+=dt;now+=dt;c2.feed(tc,100+1500*tc/1000,300,now);c2.at(now,true)}
  T('look-ahead is capped at maxPx even for a very fast hand',c2.at(now+16,true).x-c2.b.x<=CUR.maxPx+1e-6)}
 const c=new M.Cursor(CUR);let tc=0,now=0,o=[];for(let i=0;i<300;i++){tc+=dt;now+=dt;c.feed(tc,500+1.2*gau(),400+1.2*gau(),now);const p=c.at(now+dt/2,true);if(i>60)o.push(p.x-500)}
 const r=Math.sqrt(o.reduce((a,b)=>a+b*b,0)/o.length);T('cursor jitter at rest cut ≥2.5× (1.2 px sensor noise)',r<1.2/2.5,r.toFixed(2)+' px RMS');
 // full pipeline: sinusoidal hand motion, landmark noise, toScreen mapping; find the effective latency of the shown cursor
 {const W=1280,H=720,c=new M.Cursor(CUR);let tc=0,now=0,rec=[];for(let i=0;i<300;i++){tc+=dt;now+=dt;const nx=.5+.2*Math.sin(2*Math.PI*.8*tc/1000),s=M.toScreen(nx+.002*gau(),.5+.002*gau(),W,H);c.feed(tc,s.x,s.y,now);for(let r=0;r<4;r++){const tt=now+r*dt/4;rec.push([tt,c.at(tt,true).x])}}
  const truth=t=>M.toScreen(.5+.2*Math.sin(2*Math.PI*.8*t/1000),.5,W,H).x;let best=[1e9,0];for(let sh=0;sh<=120;sh+=2){let e=0,n=0;for(const [t,x] of rec){if(t<1500)continue;e+=(x-truth(t-sh))**2;n++}if(e<best[0])best=[e,sh,Math.sqrt(e/n)]}
  T('simulated 0.8 Hz hand sweep: effective cursor latency ≤ 70 ms (≈ 2 camera frames), tracking error small',best[1]<=70&&best[2]<12,`latency ≈ ${best[1]} ms, residual ${best[2].toFixed(1)} px RMS on a 1280 px screen`)}}

console.log('\n[7] pinch: palm-relative distance, hysteresis, loss');
{const TPL=[[0,0],[-2.6,-1.8],[-4.2,-4.0],[-5.4,-5.9],[-6.4,-7.6],[-2.6,-8.6],[-2.8,-11.6],[-2.9,-13.4],[-3.0,-15.0],[-0.4,-9.0],[-0.4,-12.3],[-0.4,-14.4],[-0.4,-16.0],[1.7,-8.6],[1.9,-11.6],[2.0,-13.5],[2.1,-15.0],[3.6,-7.6],[4.2,-9.9],[4.5,-11.4],[4.8,-12.8]];
 const lerp=(a,b,t)=>a+(b-a)*t,W=640,H=480;
 const hand=(p,sc=12,rot=0,fist=false)=>{const Pp=TPL.map(a=>a.slice());if(fist)for(const [tip,mcp] of [[8,5],[12,9],[16,13],[20,17]]){Pp[tip]=[Pp[mcp][0]*.8,Pp[mcp][1]*.55];Pp[tip-1]=[Pp[mcp][0]*.9,Pp[mcp][1]*.75]}
  const it=Pp[8],tg=[it[0]-.2,it[1]+.8];Pp[4]=[lerp(TPL[4][0],tg[0],p),lerp(TPL[4][1],tg[1],p)];Pp[3]=[lerp(TPL[3][0],(tg[0]+Pp[2][0])/2-.3,p),lerp(TPL[3][1],(tg[1]+Pp[2][1])/2,p)];
  const c=Math.cos(rot),s=Math.sin(rot);return Pp.map(([x,y])=>({x:(320+(x*c-y*s)*sc)/W,y:(300+(x*s+y*c)*sc)/H,z:0}))};
 const rat=h=>M.pinchRatio(h,W,H);
 T('ratio: open hand > 0.85, relaxed half-closed in between, pinched < 0.20 (fast-grab threshold)',rat(hand(0))>.85&&rat(hand(.5))>.3&&rat(hand(.5))<.85&&rat(hand(1))<.2,[0,.5,1].map(p=>rat(hand(p)).toFixed(2)).join(' / '));
 T('ratio is palm-relative: identical for a hand ½× and 2× the size (distance to camera)',[.5,2].every(k=>Math.abs(rat(hand(1,12*k))-rat(hand(1)))<.02&&Math.abs(rat(hand(.5,12*k))-rat(hand(.5)))<.02));
 T('ratio is rotation-invariant in the image plane (30°, 90°, 180°)',[.52,1.57,3.14].every(r=>Math.abs(rat(hand(.5,12,r))-rat(hand(.5)))<.02));
 T('a closed fist is NOT a pinch (index tip too close to the wrist)',M.pinchValid(hand(1),W,H)&&!M.pinchValid(hand(1,12,0,true),W,H));
 // state machine
 const mk=()=>new M.PinchFSM();
 for(const mean of [.28,.33,.4,.5,.55]){const f=mk();let ev=0,t=0,dr=false;for(let i=0;i<150;i++){t+=dt;const e=f.step(mean+.04*gau(),t,dr);if(e==='grab'){dr=true;ev++}if(e==='release'){dr=false;ev++}}T(`hysteresis: ratio noisy around ${mean} (σ .04) causes ≤1 transition in 5 s`,ev<=1,ev+' transitions')}
 {const f=mk();let t=0,lat=null;for(let i=0;i<30;i++){t+=dt;if(f.step(i<5?.9:.12,t,false)==='grab'&&lat===null)lat=(i-5+1)}T('grab fires on the first frame of a clear pinch (≤33 ms)',lat===1,lat+' frame(s)')}
 {const f=mk();let t=0;for(let i=0;i<10;i++){t+=dt;if(f.step(.12,t,false)==='grab')break}let rl=null;for(let i=0;i<30;i++){t+=dt;if(f.step(i<8?.15:.9,t,true)==='release'&&rl===null)rl=(i-8+1)}T('release fires within 3 frames (≤100 ms) of a clear open hand',rl>=1&&rl<=3,rl+' frame(s)')}
 for(const n of [1,2]){const f=mk();let t=0;for(let i=0;i<8;i++){t+=dt;f.step(.12,t,false)}let rel=false;for(let i=0;i<20;i++){t+=dt;if(f.step(i>=5&&i<5+n?.95:.15,t,true)==='release')rel=true}T(`prevent accidental drops: ${n}-frame tracking glitch (ratio .95) while dragging is ignored`,!rel)}
 {const f=mk();let t=0;for(let i=0;i<8;i++){t+=dt;f.step(.12,t,false)}let rel=false;for(let i=0;i<30;i++){t+=dt;if(f.step(.95,t,true)==='release')rel=true}T('a real, sustained open hand does release the tile',rel)}
 {const f=mk();let t=0;for(let i=0;i<8;i++){t+=dt;f.step(.12,t,false)}let rd=false,rn=false;for(let i=0;i<20;i++){t+=dt;if(f.step(.54,t,true)==='release')rd=true}const g=mk();t=0;for(let i=0;i<8;i++){t+=dt;g.step(.12,t,false)}for(let i=0;i<20;i++){t+=dt;if(g.step(.54,t,false)==='release')rn=true}
  T('looser release threshold while a tile is held (0.54 keeps it; the same ratio releases when nothing is held)',!rd&&rn)}
 {const f=mk();let t=0,g=0;for(let i=0;i<40;i++){t+=dt;if(f.step(.4,t,false)==='grab')g++}T('a half-closed relaxed hand (ratio 0.40) never grabs',g===0)}}

console.log('\n[8] tracking loss');
{const al=[0,60,100,200,320,500].map(M.handAlpha);T('hand alpha: full for 60 ms, then fades smoothly and monotonically to 0 by ~320 ms',al[0]===1&&al[1]===1&&al[2]<1&&al[2]>al[3]&&al[3]>al[4]-1e-9&&al[4]<.001&&al[5]===0,al.map(v=>v.toFixed(2)).join(' → '));
 T('loss state machine: live ≤100 ms, hold (cursor frozen, drag kept) ≤300 ms, lost after',M.lostState(50)==='live'&&M.lostState(150)==='hold'&&M.lostState(299)==='hold'&&M.lostState(301)==='lost');}

console.log('\n[9] puzzle engine unchanged + solvable');
{for(const N of [3,4,5]){let ok=true;for(let k=0;k<150;k++){const b=M.shuffleBoard(N);if(M.isSolved(b)||!M.boardSolvable(b,N))ok=false}T(`${N}×${N}: 150 shuffles are never pre-solved and always solvable`,ok)}
 T('neighbour logic: corner 2, edge 3, centre 4',M.nbrs(0,3).length===2&&M.nbrs(1,3).length===3&&M.nbrs(4,3).length===4);T('solved board recognised',M.isSolved(M.solvedBoard(4)))}
console.log(`\n${pass}/${pass+fail} unit checks passed`);process.exit(fail?1:0);
