// End-to-end test: runs the REAL index.html/app.js/style.css in headless Chromium with
//   * a fake camera device (Chromium's built-in test pattern)  * a STUB of the MediaPipe bundle that returns SYNTHETIC 21-point hands.
// It exercises UI flow, rendering, mirroring, pinch/drag, tracking loss, orientation change and camera interruption.
// It is NOT a test with a real camera or the real MediaPipe model.
// usage: node tests/e2e.mjs [projectDir] [tag]
import {createRequire} from 'module';import http from 'http';import fs from 'fs';import path from 'path';import {fileURLToPath} from 'url';
const require=createRequire('/opt/npm-tools/node_modules/');const {chromium}=require('playwright');
const HERE=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.resolve(process.argv[2]||path.join(HERE,'..')),TAG=process.argv[3]||'run',SHOTS=path.join(HERE,'shots');
fs.mkdirSync(SHOTS,{recursive:true});
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((q,r)=>{const f=path.join(ROOT,q.url.split('?')[0]==='/'?'index.html':q.url.split('?')[0]);fs.readFile(f,(e,d)=>{if(e){r.writeHead(404);r.end()}else{r.writeHead(200,{'content-type':MIME[path.extname(f)]||'text/plain'});r.end(d)}})});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));const URL='http://127.0.0.1:'+srv.address().port+'/';
const OFFICIAL=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
const STUB=`export class FilesetResolver{static async forVisionTasks(){return{}}}
export class HandLandmarker{static HAND_CONNECTIONS=${JSON.stringify(OFFICIAL.map(([start,end])=>({start,end})))};
 static async createFromOptions(f,o){const h=new HandLandmarker();h.o={...o};window.__lmOpts=h.o;return h}
 setOptions(o){Object.assign(this.o,o);window.__numHands=this.o.numHands} detectForVideo(v,ts){window.__infer=(window.__infer||0)+1;return window.__feed(ts,this.o.numHands)} close(){}}
export class FaceDetector{static async createFromOptions(){return new FaceDetector()} detectForVideo(){return{detections:[]}} close(){}}`;
const INIT=()=>{ // page-side synthetic hand + scripted motion
  const T=[[0,0],[-2.6,-1.8],[-4.2,-4.0],[-5.4,-5.9],[-6.4,-7.6],[-2.6,-8.6],[-2.8,-11.6],[-2.9,-13.4],[-3.0,-15.0],[-0.4,-9.0],[-0.4,-12.3],[-0.4,-14.4],[-0.4,-16.0],[1.7,-8.6],[1.9,-11.6],[2.0,-13.5],[2.1,-15.0],[3.6,-7.6],[4.2,-9.9],[4.5,-11.4],[4.8,-12.8]];
  let sd=7;const rnd=()=>(sd=(sd*1664525+1013904223)>>>0)/4294967296,gau=()=>Math.sqrt(-2*Math.log(rnd()+1e-9))*Math.cos(6.2832*rnd());
  window.__noise=0.6;window.__pxcm=12;
  const lerp=(a,b,t)=>a+(b-a)*t;
  window.__build=(ax,ay,p,mode,W,H,k)=>{ // anchor (ax,ay) normalised; mode 'mid' pins the tip midpoint, 'palm' pins the open-hand tip midpoint (realistic: palm stays, fingers close)
    const P=T.map(a=>a.slice()),it=P[8],tgt=[it[0]-.2,it[1]+.8],tgt3=[(tgt[0]+P[2][0])/2-.3,(tgt[1]+P[2][1])/2],tgt2=[P[2][0]+.4,P[2][1]-.2];
    const open=[(T[4][0]+T[8][0])/2,(T[4][1]+T[8][1])/2];
    P[4]=[lerp(T[4][0],tgt[0],p),lerp(T[4][1],tgt[1],p)];P[3]=[lerp(T[3][0],tgt3[0],p),lerp(T[3][1],tgt3[1],p)];P[2]=[lerp(T[2][0],tgt2[0],p*.5),lerp(T[2][1],tgt2[1],p*.5)];
    const cur=[(P[4][0]+P[8][0])/2,(P[4][1]+P[8][1])/2],pin=mode==='mid'?cur:open,s=window.__pxcm*(k||1);
    return P.map(([x,y])=>({x:(ax*W+(x-pin[0])*s+window.__noise*gau())/W,y:(ay*H+(y-pin[1])*s+window.__noise*gau())/H,z:0}));
  };
  window.__K=null;window.__MODE='path';window.__FR=null;window.__anchorMode='palm';
  window.__setPath=k=>{window.__K={t0:performance.now(),k}};
  window.__pathAt=now=>{const K=window.__K;if(!K)return null;const t=now-K.t0,a=K.k;if(t<a[0].t)return a[0];if(t>=a[a.length-1].t)return a[a.length-1];
    for(let i=1;i<a.length;i++)if(t<a[i].t){const u=(t-a[i-1].t)/(a[i].t-a[i-1].t),A=a[i-1],B=a[i];return{x:lerp(A.x,B.x,u),y:lerp(A.y,B.y,u),p:lerp(A.p,B.p,u),v:u<.5?A.v:B.v}}};
  window.__feed=(ts,numHands)=>{const vd=document.querySelector('#vid'),W=vd.videoWidth||640,H=vd.videoHeight||480,now=performance.now();
    if(window.__MODE==='frame'&&window.__FR){const f=window.__FR;const L=[window.__build(f.ax,f.ay,.3,'mid',W,H),window.__build(f.bx,f.by,.3,'mid',W,H)];return{landmarks:L.slice(0,numHands||2),handedness:L.slice(0,numHands||2).map(()=>[{score:.96}])}}
    const q=window.__pathAt(now);if(!q||q.v===false||q.v===0)return{landmarks:[],handedness:[]};
    return{landmarks:[window.__build(q.x,q.y,q.p,window.__anchorMode,W,H)],handedness:[[{score:.96}]]}};
  window.__skelPx=()=>{const c=document.querySelector('#hand'),x=c.getContext('2d'),d=x.getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>8)n++;return n};
};
const R=[],ok=(name,pass,info='')=>{R.push({name,pass:!!pass,info});console.log((pass?'PASS ':'FAIL ')+name+(info?'  — '+info:''))};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function boot(browser,opts={}){
  const ctx=await browser.newContext({viewport:{width:1280,height:720},permissions:['camera'],...opts}),page=await ctx.newPage(),errs=[],warns=[];
  page.on('pageerror',e=>errs.push(String(e)));page.on('console',m=>{const t=m.text();if(m.type()==='error')errs.push(t);if(m.type()==='warning')warns.push(t)});
  await page.route('**/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',r=>r.fulfill({contentType:'text/javascript',body:STUB}));
  await page.addInitScript(INIT);await page.goto(URL);return{ctx,page,errs,warns};
}
const scr=(page)=>page.evaluate(()=>document.body.dataset.s);
// screen px -> raw normalised camera coords (inverse of toScreen: mirrored, central 84% maps to the viewport)
const cam=(sx,sy,vw,vh)=>({x:1-.08-.84*sx/vw,y:.08+.84*sy/vh});
async function toGame(page,viewport){
  await page.click('#go');await page.waitForFunction(()=>document.body.dataset.s==='cam',null,{timeout:10000});
  await page.evaluate(()=>{window.__MODE='frame';window.__FR={ax:.33,ay:.30,bx:.67,by:.74}});
  await page.waitForFunction(()=>document.body.dataset.s==='preview',null,{timeout:15000});
  await page.evaluate(()=>{window.__MODE='path';window.__K=null});await page.click('#begin');await page.waitForFunction(()=>document.body.dataset.s==='game');
  await page.waitForFunction(()=>document.querySelectorAll('#board .tile').length>0);await sleep(1300); // scramble animation + lock
}
const tiles=page=>page.evaluate(()=>{const b=document.querySelector('#board').getBoundingClientRect(),N=Math.round(Math.sqrt(document.querySelectorAll('#board .tile').length+1)),occ=new Set(),cells={};
  document.querySelectorAll('#board .tile').forEach(t=>{const r=t.getBoundingClientRect(),c=Math.floor((r.left+r.width/2-b.left)/(b.width/N)),w=Math.floor((r.top+r.height/2-b.top)/(b.height/N));occ.add(w*N+c);cells[w*N+c]=t.className});
  let gap=-1;for(let i=0;i<N*N;i++)if(!occ.has(i))gap=i;return{N,gap,b:{l:b.left,t:b.top,w:b.width,h:b.height}}});
const cellCenter=(g,i)=>({x:g.b.l+((i%g.N)+.5)*g.b.w/g.N,y:g.b.t+((Math.floor(i/g.N))+.5)*g.b.h/g.N});
async function dragTest(page,vp,label,{closeMs=150,holdMs=450,moveMs=700}={}){
  const g=await tiles(page),nb=[];const c=g.gap%g.N,r=Math.floor(g.gap/g.N);if(c>0)nb.push(g.gap-1);if(c<g.N-1)nb.push(g.gap+1);if(r>0)nb.push(g.gap-g.N);if(r<g.N-1)nb.push(g.gap+g.N);
  const src=nb[0],a=cellCenter(g,src),b=cellCenter(g,g.gap),A=cam(a.x,a.y,vp.w,vp.h),Bc=cam(b.x,b.y,vp.w,vp.h);
  const before=+await page.textContent('#hm');
  const t=[];let T=0;const add=(dt,x,y,p,v=true)=>{T+=dt;t.push({t:T,x,y,p,v})};
  add(0,A.x+.15,A.y+.1,0);add(500,A.x,A.y,0);add(holdMs,A.x,A.y,0);add(closeMs,A.x,A.y,1);add(150,A.x,A.y,1);add(moveMs,Bc.x,Bc.y,1);add(250,Bc.x,Bc.y,1);add(closeMs,Bc.x,Bc.y,0);add(500,Bc.x,Bc.y,0);
  await page.evaluate(k=>window.__setPath(k),t);
  const probes={};
  await sleep(500+holdMs+closeMs+120);probes.held=await page.evaluate(()=>!!document.querySelector('.tile.held'));probes.pinchCls=await page.evaluate(()=>document.querySelector('#cur').classList.contains('pinch'));
  await sleep(500);await page.screenshot({path:path.join(SHOTS,`${TAG}-${label}-dragging.png`)});
  await sleep(moveMs+250+closeMs+900);
  const after=+await page.textContent('#hm');
  ok(`${label}: pinch over the intended tile grabs it`,probes.held,'');
  ok(`${label}: cursor shows pinch state while grabbed`,probes.pinchCls);
  ok(`${label}: dragging the tile into the gap and releasing counts exactly one move`,after===before+1,`moves ${before}→${after}`);
  return after===before+1;
}
const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
try{
// ---------- A. desktop flow ----------
{const {ctx,page,errs,warns}=await boot(browser);
 ok('start screen loads',await scr(page)==='start');
 await page.click('#go');await page.waitForFunction(()=>document.body.dataset.s==='cam',null,{timeout:10000});
 await page.evaluate(()=>{window.__MODE='frame';window.__FR={ax:.33,ay:.30,bx:.67,by:.74}});await sleep(700);
 await page.screenshot({path:path.join(SHOTS,`${TAG}-cam-skeleton.png`)});
 ok('two synthetic hands give a frame (chip says FRAME READY)',/FRAME READY/.test(await page.textContent('#chip')),await page.textContent('#chip'));
 const nm=await page.evaluate(()=>window.__numHands??window.__lmOpts?.numHands);ok('cam screen asks the detector for 2 hands',nm===2,'numHands='+nm);
 await page.waitForFunction(()=>document.body.dataset.s==='preview',null,{timeout:15000});ok('hold-still countdown captures and reaches preview',true);
 await page.evaluate(()=>{window.__MODE='path';window.__K=null});await page.click('#begin');await page.waitForFunction(()=>document.body.dataset.s==='game');await sleep(1300);
 const nm1=await page.evaluate(()=>window.__numHands);ok('game screen drops to 1 hand',nm1===1,'numHands='+nm1);
 const vp={w:1280,h:720};
 // hand present: skeleton is drawn, then fades after tracking loss
 const g=await tiles(page),cc=cellCenter(g,g.gap),C=cam(cc.x,cc.y,vp.w,vp.h);
 await page.evaluate(k=>window.__setPath(k),[{t:0,x:C.x,y:C.y,p:0,v:true},{t:900,x:C.x,y:C.y,p:0,v:true},{t:901,x:C.x,y:C.y,p:0,v:false},{t:5000,x:C.x,y:C.y,p:0,v:false}]);
 await sleep(600);const n0=await page.evaluate(()=>window.__skelPx());await page.screenshot({path:path.join(SHOTS,`${TAG}-game-skeleton.png`)});
 const curOn=await page.evaluate(()=>getComputedStyle(document.querySelector('#cur')).display);
 ok('game: skeleton canvas has pixels while the hand is tracked',n0>2000,n0+' px');ok('game: cursor visible while tracked',curOn==='block');
 await sleep(560);const n1=await page.evaluate(()=>window.__skelPx());await sleep(500);const n2=await page.evaluate(()=>window.__skelPx());
 ok('tracking loss: skeleton fades out smoothly then clears',n2===0&&n1<n0,`px ${n0} → ${n1} → ${n2}`);
 ok('tracking loss: cursor hidden',await page.evaluate(()=>getComputedStyle(document.querySelector('#cur')).display)==='none');
 await dragTest(page,vp,'desktop');
 // tracking loss mid-drag must snap back, never move a tile
 {const g2=await tiles(page),nb=[g2.gap%g2.N>0?g2.gap-1:g2.gap+1][0],a=cellCenter(g2,nb),b=cellCenter(g2,g2.gap),A=cam(a.x,a.y,vp.w,vp.h),Bc=cam(b.x,b.y,vp.w,vp.h),mv=+await page.textContent('#hm');
  await page.evaluate(k=>window.__setPath(k),[{t:0,x:A.x,y:A.y,p:0,v:true},{t:600,x:A.x,y:A.y,p:0,v:true},{t:750,x:A.x,y:A.y,p:1,v:true},{t:1000,x:A.x,y:A.y,p:1,v:true},{t:1300,x:(A.x+Bc.x)/2,y:(A.y+Bc.y)/2,p:1,v:true},{t:1301,x:0,y:0,p:1,v:false},{t:4000,x:0,y:0,p:1,v:false}]);
  await sleep(1250);const h=await page.evaluate(()=>!!document.querySelector('.tile.held'));await sleep(1000);
  const h2=await page.evaluate(()=>!!document.querySelector('.tile.held')),mv2=+await page.textContent('#hm');
  ok('tracking lost mid-drag: tile was held, then released back with NO move counted',h&&!h2&&mv2===mv,`held ${h}→${h2}, moves ${mv}→${mv2}`);}
 // camera interruption: track ends -> app must reconnect without errors
 {const before=await page.evaluate(()=>document.querySelector('#vid').srcObject?.id);
  await page.evaluate(()=>{const t=document.querySelector('#vid').srcObject.getVideoTracks()[0];t.stop();t.dispatchEvent(new Event('ended'));t.onended&&t.onended()});
  await sleep(2600);const after=await page.evaluate(()=>({id:document.querySelector('#vid').srcObject?.id,live:document.querySelector('#vid').srcObject?.getVideoTracks()[0]?.readyState,btn:document.querySelector('#bCam').textContent}));
  ok('camera interruption: stream is re-acquired automatically',after.live==='live'&&after.id!==before,JSON.stringify(after));}
 // hide / show tab
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));Object.defineProperty(document,'hidden',{value:false,configurable:true});document.dispatchEvent(new Event('visibilitychange'))});await sleep(300);
 // perf text from the app's own monitor
 await sleep(800);const perf=await page.textContent('#perf');console.log('   app perf monitor (headless software rendering, NOT a phone):\n   '+perf.split('\n').join('\n   '));
 ok('no page errors in desktop run',errs.length===0,errs.slice(0,3).join(' | '));
 ok('no HAND_CONN mismatch warning against HandLandmarker.HAND_CONNECTIONS',!warns.some(w=>/HAND_CONN differs/.test(w)));
 await ctx.close();}
// ---------- B. phone emulation (Chromium, touch, DPR 3; NOT Safari/WebKit) ----------
for(const [name,vp] of [['iphone-portrait',{width:390,height:844}],['android-portrait',{width:412,height:915}]]){
 const {ctx,page,errs}=await boot(browser,{viewport:vp,deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36'});
 await toGame(page,{w:vp.width,h:vp.height});
 const ov=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,iw:innerWidth,sh:document.documentElement.scrollHeight,ih:innerHeight}));
 ok(`${name}: no page overflow`,ov.sw<=ov.iw&&ov.sh<=ov.ih,JSON.stringify(ov));
 const bb=await page.evaluate(()=>{const r=e=>document.querySelector(e).getBoundingClientRect();const b=r('#board'),rw=document.querySelector('#game .row').getBoundingClientRect();return{boardR:b.right,boardL:b.left,rowB:rw.bottom,ih:innerHeight,iw:innerWidth}});
 ok(`${name}: board and control row fit the viewport`,bb.boardL>=0&&bb.boardR<=bb.iw&&bb.rowB<=bb.ih,JSON.stringify(bb));
 await dragTest(page,{w:vp.width,h:vp.height},name);
 await page.screenshot({path:path.join(SHOTS,`${TAG}-${name}-end.png`)});
 // orientation change while playing
 await page.setViewportSize({width:vp.height,height:vp.width});await sleep(700);
 const land=await page.evaluate(()=>({hc:document.querySelector('#hand').width,iw:innerWidth,cursor:getComputedStyle(document.querySelector('#cur')).display,s:document.body.dataset.s,held:!!document.querySelector('.tile.held')}));
 ok(`${name}: after rotation the game continues, skeleton canvas resized, nothing held`,land.s==='game'&&!land.held&&land.hc>=land.iw,JSON.stringify(land));
 await page.screenshot({path:path.join(SHOTS,`${TAG}-${name}-landscape.png`)});
 ok(`${name}: no page errors`,errs.length===0,errs.slice(0,3).join(' | '));await ctx.close();}

// ---------- C. START button reachable on short / small phones ----------
for(const [n,vp] of [['phone landscape 844x390',{width:844,height:390}],['phone landscape 667x375',{width:667,height:375}],['small phone portrait 320x568',{width:320,height:568}]]){
 const ctx=await browser.newContext({viewport:vp,isMobile:true,hasTouch:true}),page=await ctx.newPage();await page.goto(URL);
 const r=await page.evaluate(()=>{const b=document.querySelector('#go');b.scrollIntoView({block:'nearest'});const q=b.getBoundingClientRect();return{top:Math.round(q.top),bottom:Math.round(q.bottom),ih:innerHeight}});
 ok(`start screen on ${n}: START CAMERA can be brought fully into view`,r.top>=0&&r.bottom<=r.ih,JSON.stringify(r));await ctx.close();}
// ---------- D. phone in landscape during the game ----------
{const vp={width:844,height:390},{ctx,page,errs}=await boot(browser,{viewport:vp,deviceScaleFactor:2,isMobile:true,hasTouch:true});
 try{await page.evaluate(()=>document.querySelector('#go').scrollIntoView({block:'nearest'}));await toGame(page,{w:vp.width,h:vp.height})}catch(e){ok('landscape: reach the game screen',false,e.message.split('\n')[0])}
 if(await scr(page)==='game'){
  const r=await page.evaluate(()=>{const R=s=>document.querySelector(s).getBoundingClientRect(),row=R('#game .row'),st=R('#stage'),pa=R('#bPause'),bd=R('#board'),cx=pa.left+pa.width/2,cy=pa.top+pa.height/2,hit=document.elementFromPoint(cx,cy);
   const inter=(a,b)=>!(a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom);
   return{rowBottom:Math.round(row.bottom),ih:innerHeight,boardH:Math.round(bd.height),previewOverButtons:inter(st,row),pauseHit:hit?.id||hit?.tagName,perf:getComputedStyle(document.querySelector('#perf')).display}});
  ok('landscape game: every button is inside the viewport',r.rowBottom<=r.ih,JSON.stringify(r));
  ok('landscape game: the mini camera preview does not cover the buttons',!r.previewOverButtons&&r.pauseHit==='bPause',`pause hit-test → ${r.pauseHit}`);
  ok('landscape game: board is usable (>=150px tall)',r.boardH>=150,r.boardH+'px');
  ok('phone: debug perf overlay hidden by default',r.perf==='none',r.perf);
  await page.screenshot({path:path.join(SHOTS,`${TAG}-phone-landscape-game.png`)});
 }
 ok('landscape run: no page errors',errs.length===0,errs.slice(0,3).join(' | '));await ctx.close();}
// ---------- E. skeleton canvas: no trails while moving, exact clear afterwards; mirror alignment; reset on video resize ----------
{const {ctx,page,errs}=await boot(browser);await toGame(page,{w:1280,h:720});const vp={w:1280,h:720};
 const A=cam(450,250,vp.w,vp.h),B=cam(850,500,vp.w,vp.h),k=[];let T=0;const add=(dt,x,y,p)=>{T+=dt;k.push({t:T,x,y,p,v:true})};
 add(0,A.x,A.y,0);for(let i=0;i<8;i++){add(250,i%2?A.x:B.x,i%2?A.y:B.y,0)}add(1,0,0,0);k[k.length-1].v=false;add(3000,0,0,0);k[k.length-1].v=false;
 await page.evaluate(k=>window.__setPath(k),k);const counts=[];for(let i=0;i<16;i++){await sleep(110);counts.push(await page.evaluate(()=>window.__skelPx()))}
 const mx=Math.max(...counts),mn=Math.min(...counts.filter(c=>c>0));ok('hand canvas: no ghost trails while the hand sweeps (lit area stays bounded)',mx/mn<2.2,`lit px min ${mn} max ${mx} ratio ${(mx/mn).toFixed(2)}`);
 await sleep(1400);ok('hand canvas: completely blank after the hand leaves',(await page.evaluate(()=>window.__skelPx()))===0);
 // drag cancelled when the video size changes (phone rotated)
 {const g=await tiles(page),nb=g.gap%g.N>0?g.gap-1:g.gap+1,a=cellCenter(g,nb),C=cam(a.x,a.y,vp.w,vp.h),mv=+await page.textContent('#hm');
  await page.evaluate(k=>window.__setPath(k),[{t:0,x:C.x,y:C.y,p:0,v:true},{t:500,x:C.x,y:C.y,p:0,v:true},{t:650,x:C.x,y:C.y,p:1,v:true},{t:4000,x:C.x,y:C.y,p:1,v:true}]);
  await sleep(1000);const h1=await page.evaluate(()=>!!document.querySelector('.tile.held'));
  // sampled in the same task as the event: the (still pinching) synthetic hand legitimately re-grabs a frame later
  const h2=await page.evaluate(()=>{document.querySelector('#vid').dispatchEvent(new Event('resize'));return!!document.querySelector('.tile.held')});await sleep(400);const mv2=+await page.textContent('#hm');
  ok('camera stream resized (rotation) while dragging: drag is cancelled cleanly, no move counted',h1&&!h2&&mv2===mv,`held ${h1}→${h2}, moves ${mv}→${mv2}`);}
 ok('no page errors (canvas / reset run)',errs.length===0,errs.slice(0,3).join(' | '));await ctx.close();}
{const {ctx,page}=await boot(browser);await page.click('#go');await page.waitForFunction(()=>document.body.dataset.s==='cam');
 await page.evaluate(()=>{window.__noise=0;window.__MODE='frame';window.__FR={ax:.33,ay:.30,bx:.67,by:.74}});await sleep(900);
 const r=await page.evaluate(()=>{const vd=document.querySelector('#vid'),ov=document.querySelector('#ov'),W=vd.videoWidth,H=vd.videoHeight,P=window.__build(.33,.30,.3,'mid',W,H),res=[];
  const x=ov.getContext('2d');for(const i of [4,8,0,12,20]){const px=Math.round(P[i].x*ov.width),py=Math.round(P[i].y*ov.height),d=x.getImageData(px-2,py-2,5,5).data;let a=0;for(let j=3;j<d.length;j+=4)a=Math.max(a,d[j]);res.push([i,a])}
  const cs=e=>getComputedStyle(e).transform;return{alpha:res,vt:cs(vd),ot:cs(ov),vr:JSON.stringify(vd.getBoundingClientRect()),or:JSON.stringify(ov.getBoundingClientRect())}});
 ok('cam view: skeleton joints land exactly on their landmark positions (thumb tip, index tip, wrist, middle tip, pinky tip)',r.alpha.every(a=>a[1]>150),JSON.stringify(r.alpha));
 ok('cam view: video and skeleton canvas share the SAME mirror transform and box',r.vt===r.ot&&r.vt.startsWith('matrix(-1')&&r.vr===r.or,r.vt);await ctx.close();}
}finally{await browser.close();srv.close()}
const fail=R.filter(r=>!r.pass);console.log(`\n${R.length-fail.length}/${R.length} e2e checks passed`);fs.writeFileSync(path.join(HERE,`e2e-${TAG}.json`),JSON.stringify(R,null,1));process.exit(fail.length?1:0);
