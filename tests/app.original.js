import {HandLandmarker,FaceDetector,FilesetResolver} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
const $=s=>document.querySelector(s), clamp=(v,a,b)=>Math.max(a,Math.min(b,v)), lerp=(a,b,t)=>a+(b-a)*t;
const CDN='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14',GS='https://storage.googleapis.com/mediapipe-models/';
const vid=$('#vid'),ov=$('#ov'),octx=ov.getContext('2d'),stage=$('#stage'),chip=$('#chip');
const S={screen:'start',camOn:false,N:3,phase:'idle',shot:null,prog:0,cool:0,dim:false,dirty:true,newSample:false,wantCam:false};
const setScreen=s=>{if(S.screen==='cam'&&s!=='cam')cancelCapture();if(s!=='game')cancel();document.body.dataset.s=s;S.screen=s;S.dirty=true;stage.classList.toggle('on',s==='game'&&S.camOn);try{lm?.setOptions({numHands:s==='cam'?2:1})}catch{}}; // game needs one hand: halves detector work
let stream=null,fs=null,lm=null,fd=null,hands=[];

/*PURE-START*/
// Smoothing: One Euro filter (adaptive low-pass) + soft dead-zone: movement smaller than ~dz px barely moves the output, larger moves pass through at full speed.
class OE{constructor(mc=1.2,b=3,dc=1,dz=0,s0=0){this.mc=mc;this.b=b;this.dc=dc;this.dz=dz;this.s0=s0;this.x=null;this.dx=0;this.t=0}
 a(c,dt){const r=2*Math.PI*c*dt;return r/(r+1)}
 f(v,t){if(this.x===null){this.x=v;this.dx=0;this.t=t;return v}
  if(t<=this.t)return this.x;                                   // duplicate/out-of-order timestamp: never divide by ~0
  const dt=(t-this.t)/1000;this.t=t;
  if(dt>.25){this.x=v;this.dx=0;return v}                       // long gap (tab hidden, tracking loss): restart instead of smearing
  const e=v-this.x,w=this.dz>0?Math.min(1,(e/this.dz)**2):1;
  this.dx+=this.a(this.dc,dt)*(e/dt-this.dx);
  this.x+=this.a(this.mc+this.b*Math.max(0,Math.abs(this.dx)-this.s0),dt)*e*w;return this.x}   // s0: speed dead-band, slow motion keeps the strong low-speed smoothing; only real movement opens the filter
 reset(){this.x=null}}
const clampN=(v,a,b)=>Math.max(a,Math.min(b,v));
// Cursor model: filtered position + OPTIONAL look-ahead. The look-ahead is capped in pixels (maxPx), only active at speed, collapses
// instantly when the hand decelerates, and is faded out (predict=false) while dragging so a held tile is always at the measured position.
// tc = camera capture time (filter clock), now = arrival/display clock.
class Cursor{constructor(p){this.p=Object.assign({dz:0,s0:0,maxPx:12,v0:150,v1:250,lead:30,cap:40,tau:25},p);const q=this.p;
  this.fx=new OE(q.mc,q.beta,q.dc,q.dz,q.s0);this.fy=new OE(q.mc,q.beta,q.dc,q.dz,q.s0);this.b=null;this.off={x:0,y:0};this.shown=null;this.pk=1;this.lt=0}
 base(now){const b=this.b,q=this.p,sp=Math.hypot(b.vx,b.vy);if(sp<1e-6||this.pk<.001)return{x:b.x,y:b.y};
  const k=clampN((sp-q.v0)/q.v1,0,1),pa=Math.min(Math.max(0,now-b.t)+q.lead,q.cap)/1000*k,d=Math.min(sp*pa,q.maxPx)*this.pk;
  return{x:b.x+b.vx/sp*d,y:b.y+b.vy/sp*d}}
 at(now,predict=true){const b=this.b;if(!b)return null;const dt=this.lt?clampN(now-this.lt,0,100):16;this.lt=now;
  this.pk+=((predict?1:0)-this.pk)*(1-Math.exp(-dt/70));
  const q=this.base(now),a=Math.exp(-Math.max(0,now-b.t)/this.p.tau);return this.shown={x:q.x+this.off.x*a,y:q.y+this.off.y*a}}
 feed(tc,x,y,now){const prev=this.shown,pb=this.b,X=this.fx.f(x,tc),Y=this.fy.f(y,tc),dt=pb?(tc-pb.tc)/1000:0;let vx=0,vy=0;
  if(pb&&dt>0&&dt<.25){ // velocity from FILTERED positions: rises smoothly, collapses fast when the hand slows => no overshoot at stops
   const rx=(X-pb.x)/dt,ry=(Y-pb.y)/dt,sp=Math.hypot(rx,ry),sq=Math.hypot(pb.vx,pb.vy),a=sp<sq?.9:.5;vx=pb.vx+a*(rx-pb.vx);vy=pb.vy+a*(ry-pb.vy)}
  else if(pb&&dt<=0){vx=pb.vx;vy=pb.vy}
  this.b={x:X,y:Y,vx,vy,t:now,tc};const q=this.base(now);this.off=prev?{x:prev.x-q.x,y:prev.y-q.y}:{x:0,y:0}}
 reset(){this.fx.reset();this.fy.reset();this.b=null;this.shown=null;this.off={x:0,y:0};this.pk=1;this.lt=0}}
// Pinch maths in PIXEL space (normalised x/y have different pixel scales). Depth counts at half weight (z is the noisiest landmark axis);
// the yardstick (palm size) is 2D so depth noise cannot change it.
const d3=(a,b,W,H,zw=1)=>Math.hypot((a.x-b.x)*W,(a.y-b.y)*H,((a.z||0)-(b.z||0))*W*zw);
const palmSize=(h,W,H)=>Math.max(1,(d3(h[0],h[9],W,H,0)+d3(h[5],h[17],W,H,0))/2);
const pinchRatio=(h,W,H)=>d3(h[4],h[8],W,H,.5)/palmSize(h,W,H);
const pinchValid=(h,W,H)=>d3(h[0],h[8],W,H,0)/Math.max(1,d3(h[0],h[9],W,H,0))>.8;   // index tip must be away from the wrist: a fist is not a pinch
// Pinch state machine: hysteresis band (on<off), time debounce independent of frame rate, fast paths for unmistakable pinch/open,
// and a looser release threshold while a tile is being dragged so finger noise cannot drop it.
class PinchFSM{constructor(c={}){Object.assign(this,{on:.30,off:.50,offDrag:.58,onMs:30,offMs:90,fastOn:.20,fastOff:.85,fastOffMs:40},c);this.reset();this.relT=0}
 reset(){this.pinched=false;this.t0=0;this.offT=0}
 step(r,now,dragging){
  if(!this.pinched){
   if(r<this.fastOn){this.pinched=true;this.t0=this.offT=0;return'grab'}
   if(r<this.on){this.t0=this.t0||now;if(now-this.t0>=this.onMs){this.pinched=true;this.t0=this.offT=0;return'grab'}}else this.t0=0;
   return''}
  const thr=dragging?this.offDrag:this.off;
  if(r>thr){this.offT=this.offT||now;if(now-this.offT>=(r>this.fastOff?this.fastOffMs:this.offMs)){this.pinched=false;this.relT=this.offT;this.offT=0;return'release'}}else this.offT=0;
  return''}}
const handAlpha=age=>age<=60?1:clampN(1-(age-60)/260,0,1);          // skeleton fade-out after tracking loss
const lostState=age=>age<=100?'live':age<=300?'hold':'lost';       // live: normal | hold: freeze cursor, keep drag | lost: cancel drag
// MediaPipe hand topology: 21 landmarks, 21 bones (same list as HandLandmarker.HAND_CONNECTIONS; verified against the library at runtime when available)
const HAND_CONN=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
const TIPS=[4,8,12,16,20],PALM=[0,1,5,9,13,17],THUMB_INDEX=[[1,2],[2,3],[3,4],[5,6],[6,7],[7,8]];
// camera px -> screen px, mirrored (raw x grows => screen x shrinks), anchored so the pinch midpoint lands exactly on the cursor; uniform scale keeps the hand undistorted
const mapSkeleton=(pts,mid,anchor,k,out)=>{for(let i=0;i<21;i++){out[2*i]=anchor.x-(pts[2*i]-mid.x)*k;out[2*i+1]=anchor.y+(pts[2*i+1]-mid.y)*k}return out};
// Holographic skeleton. No shadowBlur: glow = one wide translucent pass + crisp passes, every pass is ONE batched path.
function drawHand(c,P,al,pv,act,t,u,lite,fx){
  if(al<.02)return;
  c.save();c.lineCap='round';c.lineJoin='round';
  c.beginPath();for(let i=0;i<PALM.length;i++){const k=PALM[i];i?c.lineTo(P[2*k],P[2*k+1]):c.moveTo(P[2*k],P[2*k+1])}c.closePath();   // palm membrane
  c.globalAlpha=al*.12;c.fillStyle='#22d3ee';c.fill();
  const bones=()=>{c.beginPath();for(const [a,b] of HAND_CONN){c.moveTo(P[2*a],P[2*a+1]);c.lineTo(P[2*b],P[2*b+1])}};
  bones();
  if(!lite){c.globalAlpha=al*(act?.38:.2);c.strokeStyle=act?'#8b5cf6':'#22d3ee';c.lineWidth=(act?13:9)*u;c.stroke()}
  c.globalAlpha=al*.85;c.strokeStyle='#5ee1ff';c.lineWidth=(lite?2:3.2)*u;c.stroke();
  c.globalAlpha=al;c.strokeStyle='#e6fbff';c.lineWidth=(lite?.8:1.2)*u;c.stroke();
  if(fx&&!lite){c.setLineDash([4*u,30*u]);c.lineDashOffset=-t*.04*u;c.globalAlpha=al*.9;c.strokeStyle='#fff';c.lineWidth=2.2*u;c.stroke();c.setLineDash([])}  // travelling pulses
  if(pv>.02){ // thumb + index highlight, scaled by pinch closeness
    c.beginPath();for(const [a,b] of THUMB_INDEX){c.moveTo(P[2*a],P[2*a+1]);c.lineTo(P[2*b],P[2*b+1])}
    c.globalAlpha=al*pv*.45;c.strokeStyle='#8b5cf6';c.lineWidth=12*u;c.stroke();
    c.globalAlpha=al*pv;c.strokeStyle='#fff';c.lineWidth=2.6*u;c.stroke();
    c.beginPath();c.moveTo(P[8],P[9]);c.lineTo(P[16],P[17]);c.strokeStyle='#c4b5fd';c.lineWidth=1.6*u;c.stroke()}
  const m=act?1.15:1;
  if(!lite){c.globalAlpha=al*.25;c.fillStyle='#22d3ee';c.beginPath();for(let i=0;i<21;i++){const r=(TIPS.includes(i)?3.6:2.4)*u*2.4*m;c.moveTo(P[2*i]+r,P[2*i+1]);c.arc(P[2*i],P[2*i+1],r,0,6.2832)}c.fill()}
  c.globalAlpha=al;c.fillStyle='#bff6ff';c.beginPath();for(let i=0;i<21;i++){const r=(TIPS.includes(i)?3.6:2.4)*u*m;c.moveTo(P[2*i]+r,P[2*i+1]);c.arc(P[2*i],P[2*i+1],r,0,6.2832)}c.fill();
  c.beginPath();c.arc(P[0],P[1],5.5*u,0,6.2832);c.strokeStyle='#5ee1ff';c.lineWidth=1.2*u;c.stroke();                      // wrist ring
  if(pv>.02){c.fillStyle='#fff';c.strokeStyle='#8b5cf6';c.lineWidth=1.6*u;c.globalAlpha=al*pv;for(const i of [4,8]){c.beginPath();c.arc(P[2*i],P[2*i+1],(4+3*pv)*u,0,6.2832);c.fill();c.stroke()}}
  c.restore();
}
// All frame/face coordinates are normalised RAW (un-mirrored) video coords; video+canvas are mirrored only by CSS.
const frameFromHands=hs=>{const p=[];for(const h of hs)p.push(h[4],h[8]);const xs=p.map(q=>q.x),ys=p.map(q=>q.y);return{x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)}};
const dev=(a,b)=>Math.max(Math.abs(a.x0-b.x0),Math.abs(a.x1-b.x1),Math.abs(a.y0-b.y0),Math.abs(a.y1-b.y1));
const faceInside=(f,r,tol=.015)=>f.x0>=r.x0-tol&&f.x1<=r.x1+tol&&f.y0>=r.y0-tol&&f.y1<=r.y1+tol;
const rectProblem=(r,W,H)=>{const w=(r.x1-r.x0)*W,h=(r.y1-r.y0)*H;if(w<H*.15||h<H*.15)return'small';const a=w/h;return a<.4||a>2.5?'aspect':''};
const cropRect=(r,W,H)=>{const x0=clampN(Math.round(r.x0*W),0,W-1),y0=clampN(Math.round(r.y0*H),0,H-1),x1=clampN(Math.round(r.x1*W),x0+1,W),y1=clampN(Math.round(r.y1*H),y0+1,H);return{sx:x0,sy:y0,sw:x1-x0,sh:y1-y0}};
const faceFit=f=>{const w=f.x1-f.x0,h=f.y1-f.y0;return{x0:clampN(f.x0-.45*w,0,1),x1:clampN(f.x1+.45*w,0,1),y0:clampN(f.y0-.55*h,0,1),y1:clampN(f.y1+.35*h,0,1)}};
// raw normalised hand point -> viewport px (mirrored; central 84% of camera view spans the whole screen)
const toScreen=(nx,ny,W,H)=>({x:clampN((1-nx-.08)/.84,0,1)*W,y:clampN((ny-.08)/.84,0,1)*H});
// Puzzle engine (any N). Empty cell value = N*N-1.
const solvedBoard=N=>[...Array(N*N).keys()];
const nbrs=(i,N)=>{const c=i%N,r=i/N|0,o=[];if(c>0)o.push(i-1);if(c<N-1)o.push(i+1);if(r>0)o.push(i-N);if(r<N-1)o.push(i+N);return o};
const isSolved=b=>b.every((v,i)=>v===i);
const boardSolvable=(b,N)=>{const E=N*N-1,a=b.filter(v=>v!==E);let inv=0;for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)if(a[i]>a[j])inv++;
 return N%2?inv%2===0:(inv+N-(b.indexOf(E)/N|0))%2===1};
function shuffleBoard(N){let b,e,prev;do{b=solvedBoard(N);e=N*N-1;prev=-1;
  for(let k=0;k<N*N*N*12;k++){const o=nbrs(e,N).filter(x=>x!==prev),n=o[Math.random()*o.length|0];[b[e],b[n]]=[b[n],b[e]];prev=e;e=n}
 }while(isSolved(b)||!boardSolvable(b,N));return b}
/*PURE-END*/

/* ---------- audio (synthesised, starts only after a click) ---------- */
let ac,snd=true,amb=null;
const tone=(f,d=.1,type='sine',v=.07,at=0)=>{if(!snd||!ac)return;const t=ac.currentTime+at,o=ac.createOscillator(),g=ac.createGain();o.type=type;o.frequency.value=f;g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g).connect(ac.destination);o.start(t);o.stop(t+d)};
const sfx={
 beep:()=>tone(660,.12,'square',.04),
 shutter:()=>{if(!snd||!ac)return;const b=ac.createBuffer(1,ac.sampleRate*.14,ac.sampleRate),d=b.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*(1-i/d.length)**2;const s=ac.createBufferSource(),g=ac.createGain();g.gain.value=.25;s.buffer=b;s.connect(g).connect(ac.destination);s.start();tone(180,.08,'square',.05)},
 pick:()=>tone(520,.08,'triangle'),place:()=>{tone(300,.1,'triangle',.09);tone(450,.08,'triangle',.05,.05)},
 bad:()=>tone(140,.18,'sawtooth',.05),
 win:()=>[523,659,784,1047].forEach((f,i)=>tone(f,.4,'triangle',.08,i*.14))};
const ambience=on=>{if(!ac)return;if(on&&!amb&&snd){const g=ac.createGain();g.gain.value=.018;g.connect(ac.destination);amb=[55,82.4].map(f=>{const o=ac.createOscillator();o.frequency.value=f;o.connect(g);o.start();return o});amb.g=g}
 else if(!on&&amb){amb.forEach(o=>o.stop());amb.g.disconnect();amb=null}};

/* ---------- camera + models ---------- */
// Mobile gets a lighter stream: the hand model works on a ~224px crop anyway, so extra camera pixels only cost upload time.
const MOBILE=matchMedia('(pointer:coarse)').matches||Math.min(innerWidth,innerHeight)<700;
const CAMRES=MOBILE?{w:640,h:480}:{w:960,h:540},MIN_DT=MOBILE?1000/30:1000/60,FX=!MOBILE;   // FX: travelling pulses (desktop only)
const perf={n:0,rn:0,skip:0,drop:0,err:0,ms:0,last:0,face:0,lat:0,conf:0,lastPres:0};
const err=m=>$('#err').textContent=m||'';
function sizeOverlay(){if(!vid.videoWidth)return;const ow=Math.min(vid.videoWidth,640);ov.width=ow;ov.height=Math.round(ow*vid.videoHeight/vid.videoWidth);stage.style.setProperty('--r',vid.videoWidth/vid.videoHeight);S.dirty=true}
vid.addEventListener('resize',sizeOverlay);   // fires when the stream's dimensions change (phone rotated)
async function startCam(){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera needs a secure page (https or localhost).');
  try{stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:CAMRES.w},height:{ideal:CAMRES.h},frameRate:{ideal:30,max:30},facingMode:'user'},audio:false})}
  catch(e){throw new Error(e.name==='NotAllowedError'?'Camera permission was denied. Allow it in the address bar and try again.':e.name==='NotFoundError'?'No camera was found on this device.':'Camera failed to start: '+e.message)}
  vid.srcObject=stream;await vid.play();sizeOverlay();
  const vt=stream.getVideoTracks()[0];   // interruptions: unplugged camera, another app took it, iOS call/background
  if(vt){vt.onended=()=>{if(S.wantCam)recoverCam('CAMERA DISCONNECTED')};vt.onmute=()=>{if(S.screen==='cam')setChip('CAMERA PAUSED',false)};vt.onunmute=()=>{vid.play().catch(()=>{});skReset();S.dirty=true}}
  try{
    fs=fs||await FilesetResolver.forVisionTasks(CDN+'/wasm');
    if(!lm){const o=d=>({baseOptions:{modelAssetPath:GS+'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',delegate:d},runningMode:'VIDEO',numHands:S.screen==='cam'?2:1,minHandDetectionConfidence:.6,minHandPresenceConfidence:.6,minTrackingConfidence:.5});
      try{lm=await HandLandmarker.createFromOptions(fs,o('GPU'))}catch{lm=await HandLandmarker.createFromOptions(fs,o('CPU'))}
      try{const oc=HandLandmarker.HAND_CONNECTIONS;if(oc&&(oc.length!==HAND_CONN.length||!oc.every(c=>HAND_CONN.some(([a,b])=>a===(c.start??c[0])&&b===(c.end??c[1])))))console.warn('HAND_CONN differs from HandLandmarker.HAND_CONNECTIONS')}catch{}}
  }catch(e){stopCam();throw new Error('Hand model failed to load (internet is needed to fetch it). '+e.message)}
  if(!fd){ // face guidance is optional: failure here must not block the game
    const o=d=>({baseOptions:{modelAssetPath:GS+'face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',delegate:d},runningMode:'VIDEO',minDetectionConfidence:.5});
    try{fd=await FaceDetector.createFromOptions(fs,o('GPU'))}catch{try{fd=await FaceDetector.createFromOptions(fs,o('CPU'))}catch(e){fd=null;console.warn('Face detector unavailable',e)}}
  }
  perf.lastPres=0;S.camOn=true;S.wantCam=true;S.dirty=true;startLoops();
}
function stopCam(){stopLoops();stream?.getTracks().forEach(t=>{t.onended=t.onmute=t.onunmute=null;t.stop()});stream=null;vid.srcObject=null;S.camOn=false;hands=[];face=null;curEl.style.display='none';stage.classList.remove('on');skReset()}
let recovering=false;
async function recoverCam(msg){ // camera lost while it should be on: release, then retry 3 times with back-off
  if(recovering||!S.wantCam)return;recovering=true;stopCam();const cb=$('#bCam');
  if(S.screen==='cam')setChip(msg+' · RECONNECTING',false);else cb.textContent='Reconnecting…';
  for(let i=0;i<3&&S.wantCam;i++){
    await new Promise(r=>setTimeout(r,800*(i+1)));
    try{await startCam();if(S.screen==='game')stage.classList.add('on');cb.textContent='Camera on';recovering=false;return}catch{}
  }
  recovering=false;S.wantCam=false;cb.textContent='Camera off';cb.classList.remove('on');if(S.screen==='cam')setChip('CAMERA UNAVAILABLE',false);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)return;const vt=stream?.getVideoTracks()[0];
  if(S.wantCam&&(!stream||!vt||vt.readyState==='ended'))recoverCam('CAMERA STOPPED');else{lastInfer=0;skReset();S.dirty=true}});
addEventListener('pagehide',()=>{stopCam();lm?.close();fd?.close()});

let face=null,faceT=0,lastFaceRun=0,lastFts=0;
function runFace(t){
  if(!fd||t-lastFaceRun<200||perf.ms>35||S.phase==='counting')return;lastFaceRun=t;  // low rate, and never when hand inference is already slow
  const ts=Math.max(lastFts+1,Math.round(t)),t0=performance.now();lastFts=ts;let ds;
  try{ds=fd.detectForVideo(vid,ts).detections||[]}catch{perf.err++;return}
  perf.face=lerp(perf.face,performance.now()-t0,.3);
  const W=vid.videoWidth,H=vid.videoHeight;let best=null;for(const d of ds){const b=d.boundingBox;if(!best||b.width*b.height>best.width*best.height)best=b}
  if(best){const n={x0:best.originX/W,x1:(best.originX+best.width)/W,y0:best.originY/H,y1:(best.originY+best.height)/H};
    face=face?{x0:lerp(face.x0,n.x0,.5),x1:lerp(face.x1,n.x1,.5),y0:lerp(face.y0,n.y0,.5),y1:lerp(face.y1,n.y1,.5)}:n;faceT=t}
  else if(t-faceT>700)face=null;
}

/* ---------- skeleton tracker: 21 landmarks per hand, up to 2 hands, filtered in camera-pixel space ---------- */
const SKF={mc:1.2,beta:.03,dc:1,dz:.6};
const mkSlot=()=>({f:Array.from({length:21},()=>[new OE(SKF.mc,SKF.beta,SKF.dc,SKF.dz),new OE(SKF.mc,SKF.beta,SKF.dc,SKF.dz)]),pts:new Float32Array(42),P:new Float32Array(42),Q:new Float32Array(42),has:false,seen:0,born:0,wrist:null,ratio:1,pv:0});
const SK=[mkSlot(),mkSlot()];let sg=0;
const skFree=(i,now)=>!SK[i].has||now-SK[i].seen>400;
function skReset(){for(const s of SK){s.has=false;s.wrist=null;s.pv=0}}
function trackSkel(tc,now){ // MediaPipe returns hands in arbitrary order: keep identity by nearest wrist so each hand keeps its own filters
  const W=vid.videoWidth,H=vid.videoHeight,used=[false,false],map=[];
  hands.forEach((h,hi)=>{
    let best=-1,bd=.3,matched=false;
    for(let i=0;i<2;i++)if(!used[i]&&SK[i].has&&now-SK[i].seen<=400){const d=Math.hypot(SK[i].wrist.x-h[0].x,SK[i].wrist.y-h[0].y);if(d<bd){bd=d;best=i;matched=true}}
    if(best<0)best=[0,1].find(i=>!used[i]&&skFree(i,now))??[0,1].find(i=>!used[i])??-1;
    map[hi]=best;if(best<0)return;used[best]=true;const s=SK[best];
    if(!matched){for(const p of s.f){p[0].reset();p[1].reset()}s.born=now;s.pv=0}
    for(let i=0;i<21;i++){s.pts[2*i]=s.f[i][0].f(h[i].x*W,tc);s.pts[2*i+1]=s.f[i][1].f(h[i].y*H,tc)}
    s.has=true;s.seen=now;s.wrist={x:h[0].x,y:h[0].y};s.ratio=pinchRatio(h,W,H);
  });
  return map;
}
const skAlpha=(s,now)=>s.has?Math.min(handAlpha(now-s.seen),clampN((now-s.born)/140,0,1)):0;
const skVisible=t=>(SK[0].has&&skAlpha(SK[0],t)>.01)||(SK[1].has&&skAlpha(SK[1],t)>.01);
let lastAnim=0;
function skAnim(t){const dt=Math.min(t-(lastAnim||t),100);lastAnim=t;
  for(let i=0;i<2;i++){const s=SK[i];if(!s.has)continue;const tg=(S.screen==='game'&&i===sg&&fsm.pinched)?1:clampN((.55-s.ratio)/.25,0,1);s.pv+=(tg-s.pv)*(1-Math.exp(-dt/70))}}

/* Three decoupled stages:
   1 inference  - pump(): driven by requestVideoFrameCallback (one callback per NEW camera frame, fallback: rAF polling). Re-armed only after the
                  previous detect call returns, so frames can never queue; late frames are skipped and counted.
   2 tracking   - trackSkel()/handFeed()/camStep(): consume ONLY the newest result, synchronously (sub-ms): filters, hand identity, pinch machine.
   3 rendering  - renderLoop(): one rAF loop at display rate that only reads tracker state. */
const hasRVFC='requestVideoFrameCallback' in HTMLVideoElement.prototype;
let runGen=0,rvfcId=0,pollId=0,renderId=0,lastInfer=0,lastTs=0,lastPoll=-1,sampleCap=0;
function startLoops(){
  stopLoops();const gen=++runGen;
  if(hasRVFC){const cb=(now,meta)=>{if(gen!==runGen)return;pump(now,meta);if(gen===runGen)rvfcId=vid.requestVideoFrameCallback(cb)};rvfcId=vid.requestVideoFrameCallback(cb)}
  else{const poll=()=>{if(gen!==runGen)return;pollId=requestAnimationFrame(poll);if(vid.currentTime!==lastPoll){lastPoll=vid.currentTime;pump(performance.now(),{})}};pollId=requestAnimationFrame(poll)}
  renderId=requestAnimationFrame(renderLoop);
}
function stopLoops(){runGen++;if(hasRVFC&&rvfcId){try{vid.cancelVideoFrameCallback(rvfcId)}catch{}}rvfcId=0;cancelAnimationFrame(pollId);cancelAnimationFrame(renderId)}
function pump(now,meta){
  if(meta.presentedFrames){perf.drop+=Math.max(0,meta.presentedFrames-perf.lastPres-1);perf.lastPres=meta.presentedFrames}
  if(document.hidden||(S.screen!=='cam'&&S.screen!=='game'))return;
  if(now-lastInfer<MIN_DT-2){perf.skip++;return}                    // FPS cap: skip frames instead of queueing them
  lastInfer=now;
  const tc=meta.captureTime||meta.presentationTime||now,t0=performance.now(),ts=Math.max(lastTs+1,Math.round(t0));lastTs=ts; // strictly increasing, as MediaPipe requires
  let r;try{r=lm.detectForVideo(vid,ts)}catch{perf.err++;return}
  const t1=performance.now();perf.ms=perf.n?lerp(perf.ms,t1-t0,.2):t1-t0;perf.last=t1-t0;perf.n++;
  hands=r.landmarks||[];
  const hs=r.handedness||r.handednesses||[];let cs=0;for(const x of hs)cs+=x[0]?.score||0;perf.conf=hs.length?cs/hs.length:0;
  sampleCap=meta.captureTime||0;S.newSample=true;S.dirty=true;
  const map=trackSkel(tc,t1);
  if(S.screen==='cam'){camStep(tc);runFace(t1)}else handFeed(tc,t1,map);   // frame logic first, optional face pass after it
}
let blank=false;
function renderLoop(t){
  renderId=requestAnimationFrame(renderLoop);perf.rn++;
  if(S.newSample){S.newSample=false;if(sampleCap){const l=performance.now()-sampleCap;perf.lat=perf.lat?lerp(perf.lat,l,.2):l}}
  skAnim(t);
  if(S.screen==='game')gameRender(t);
  const vis=skVisible(t);
  if(S.screen==='cam'?(S.dirty||rect||locked||vis||!blank):(S.screen==='game'&&(S.dirty||vis||!blank))){draw(t);blank=!(hands.length||rect||locked||face||vis)}
  S.dirty=false;perfUpdate(t);
}

/* ---------- temporary performance monitor (tap it or press P to hide) ---------- */
const perfEl=$('#perf');let perfOn=true,pt=0,pn=0,prn=0;
perfEl.onclick=()=>{perfOn=false;perfEl.classList.add('off')};
addEventListener('keydown',e=>{if(e.key==='p'||e.key==='P'){perfOn=!perfOn;perfEl.classList.toggle('off',!perfOn)}});
function perfUpdate(t){
  if(!perfOn||t-pt<250)return;const s=(t-pt)/1000,tf=(perf.n-pn)/s,rf=(perf.rn-prn)/s;pn=perf.n;prn=perf.rn;pt=t;
  perfEl.textContent=[`track  ${tf.toFixed(0)} fps · render ${rf.toFixed(0)} fps`,`infer  ${perf.ms.toFixed(1)} ms avg · ${perf.last.toFixed(0)} last`,
   `face   ${perf.face.toFixed(1)} ms`,`conf   ${perf.conf?(perf.conf*100).toFixed(0)+'%':'-'} · hands ${hands.length}`,
   `lat    ${perf.lat?perf.lat.toFixed(0)+' ms capture→now':'n/a (no captureTime)'}`,
   `frames ${perf.skip} capped · ${perf.drop} unprocessed · ${perf.err} errors`,`cam    ${vid.videoWidth}×${vid.videoHeight} · ${hasRVFC?'rVFC':'rAF poll'}`].join('\n');
}

/* ---------- two-hand frame (corners = extremes of both thumb tips + both index tips) ---------- */
const FR={mc:.8,beta:.02,dc:2,dz:2};const fx=[0,1,2,3].map(()=>new OE(FR.mc,FR.beta,FR.dc,FR.dz));   // frame edges filtered in pixel units
let rect=null,anchor=null,holdT=0,seen=0,locked=null,cdTimer=0;
let chipTxt='',chipOk=null,hintTxt='';const hintEl=$('#hintTxt');   // write to the DOM only when the value really changes
const setChip=(txt,ok)=>{if(txt!==chipTxt){chipTxt=txt;chip.textContent=txt}if(!!ok!==chipOk){chipOk=!!ok;chip.classList.toggle('ok',chipOk)}};
const setHint=m=>{if(m!==hintTxt){hintTxt=m;hintEl.textContent=m}};
function camStep(t){
  const counting=S.phase==='counting',W=vid.videoWidth,H=vid.videoHeight;
  if(hands.length>=2){
    seen=t;S.dim=false;
    const g=frameFromHands(hands.slice(0,2)),v=[g.x0*W,g.x1*W,g.y0*H,g.y1*H].map((x,i)=>fx[i].f(x,t));
    rect={x0:v[0]/W,x1:v[1]/W,y0:v[2]/H,y1:v[3]/H};
    if(counting){if(dev(rect,locked)>.06)cancelCapture('FRAME MOVED');return}
    const p=rectProblem(rect,W,H);
    if(p){anchor=null;holdT=t;S.prog=0;setChip(p==='small'?'TWO HANDS DETECTED':'FRAME TOO NARROW',false);setHint(p==='small'?'Spread your hands apart to open the frame.':'Make the frame less tall or less wide.');return}
    if(t<S.cool){anchor=null;holdT=t;S.prog=0;setChip('FRAME READY',true);return}
    if(face&&!faceInside(face,rect)){anchor=null;holdT=t;S.prog=0;setChip('FACE OUTSIDE FRAME',false);setHint('Move the frame so your whole face is inside.');return}
    if(!anchor||dev(rect,anchor)>.03){anchor={...rect};holdT=t}
    S.prog=clamp((t-holdT)/1000,0,1);setChip('FRAME READY',true);setHint(face?'Face framed. Hold still…':'Hold still…');
    if(S.prog>=1)startCapture({...rect},'hand frame');
  }else{
    S.dim=true;anchor=null;holdT=t;S.prog=0;
    if(counting){if(t-seen>800)cancelCapture('HANDS LOST');return}
    if(rect&&t-seen>1500){rect=null;fx.forEach(f=>f.reset())}
    setChip(hands.length===1?'SHOW BOTH HANDS':'WAITING FOR HANDS',false);
    setHint('Raise both hands. Thumb and index of each hand mark the frame corners.');
  }
}
function startCapture(r,src){
  if(S.phase==='counting')return;S.phase='counting';locked={...r};S.prog=1;setChip('CAPTURING',true);
  const c=$('#count');let n=3;
  const tick=()=>{if(n===0){c.classList.remove('show');return doCapture(r,src)}
    c.innerHTML=`<span>${n}</span>`;c.classList.add('show');sfx.beep();n--;cdTimer=setTimeout(tick,900)};tick();
}
function cancelCapture(msg){
  clearTimeout(cdTimer);$('#count').classList.remove('show');if(S.phase!=='counting')return;
  S.phase='idle';locked=null;anchor=null;S.prog=0;S.cool=performance.now()+800;if(msg)setChip(msg,false);
}
function doCapture(r,src){
  const {sx,sy,sw,sh}=cropRect(r,vid.videoWidth,vid.videoHeight);
  const c=document.createElement('canvas');c.width=sw;c.height=sh;const x=c.getContext('2d');
  x.translate(sw,0);x.scale(-1,1);x.drawImage(vid,sx,sy,sw,sh,0,0,sw,sh); // raw region, flipped once so it matches the mirrored preview
  const cut=face&&!faceInside(face,r,.01);
  S.shot=c;$('#shot').src=c.toDataURL('image/jpeg',.92);
  $('#pinfo').textContent=`${sw}×${sh}px · ${src}${cut?' · face partly outside, retake recommended':''}`;
  const f=$('#flash');f.classList.remove('go');void f.offsetWidth;f.classList.add('go');sfx.shutter();
  S.phase='idle';locked=null;rect=null;anchor=null;S.prog=0;S.cool=performance.now()+2000;fx.forEach(q=>q.reset());setScreen('preview');
}
$('#manual').onclick=()=>{
  ac=ac||new AudioContext();if(S.phase==='counting')return;const W=vid.videoWidth,H=vid.videoHeight;
  if(rect&&hands.length>=2&&!rectProblem(rect,W,H))return startCapture({...rect},'hand frame');
  if(face)return startCapture(faceFit(face),'face fit');
  startCapture({x0:.5-.3*H/W,x1:.5+.3*H/W,y0:.2,y1:.8},'centre region');
};

/* ---------- overlay (raw coords; canvas is CSS-mirrored like the video, so landmarks line up with the picture) ---------- */
function drawFrame(t,u){
  const W=ov.width,H=ov.height,r=locked||rect;
  if(face){const ok=r&&faceInside(face,r);octx.save();octx.setLineDash([6*u,5*u]);octx.lineWidth=1.5*u;octx.strokeStyle=ok?'rgba(80,255,170,.8)':'rgba(255,190,80,.85)';octx.strokeRect(face.x0*W,face.y0*H,(face.x1-face.x0)*W,(face.y1-face.y0)*H);octx.restore()}
  if(!r)return;
  const x0=r.x0*W,x1=r.x1*W,y0=r.y0*H,y1=r.y1*H,cnt=S.phase==='counting',A=S.dim&&!cnt?.5:1;
  octx.save();octx.globalAlpha=A;octx.lineCap='round';
  octx.fillStyle='rgba(0,0,0,.5)';octx.beginPath();octx.rect(0,0,W,H);octx.rect(x0,y0,x1-x0,y1-y0);octx.fill('evenodd');
  const L=Math.min(x1-x0,y1-y0)*.2+Math.sin(t/260)*2*u,cs=[[x0,y0,1,1],[x1,y0,-1,1],[x0,y1,1,-1],[x1,y1,-1,-1]];
  octx.strokeStyle=cnt?'#fff':'#8b5cf6';
  for(const [w,al] of [[10*u,.22],[4*u,1]]){octx.globalAlpha=A*al;octx.lineWidth=w;octx.beginPath();for(const [x,y,dx,dy] of cs){octx.moveTo(x,y+dy*L);octx.lineTo(x,y);octx.lineTo(x+dx*L,y)}octx.stroke()}
  octx.globalAlpha=A;octx.fillStyle='#22d3ee';for(const [x,y] of cs){octx.beginPath();octx.arc(x,y,3*u,0,7);octx.fill()}
  octx.strokeStyle='rgba(34,211,238,.35)';octx.lineWidth=1*u;octx.strokeRect(x0,y0,x1-x0,y1-y0);
  const cx=(x0+x1)/2,cy=(y0+y1)/2;octx.beginPath();
  octx.moveTo(cx,y0);octx.lineTo(cx,y0+8*u);octx.moveTo(cx,y1);octx.lineTo(cx,y1-8*u);octx.moveTo(x0,cy);octx.lineTo(x0+8*u,cy);octx.moveTo(x1,cy);octx.lineTo(x1-8*u,cy);
  octx.moveTo(cx-8*u,cy);octx.lineTo(cx+8*u,cy);octx.moveTo(cx,cy-8*u);octx.lineTo(cx,cy+8*u);octx.stroke();
  if(S.prog>0){octx.globalAlpha=1;octx.strokeStyle='#22d3ee';octx.lineWidth=5*u;octx.beginPath();octx.arc(cx,cy,26*u,-Math.PI/2,-Math.PI/2+S.prog*Math.PI*2);octx.stroke()}
  octx.restore();
}
function draw(t){   // stage canvas: camera-aligned skeleton(s) (full style in the capture view, light style in the game's mini preview)
  const W=ov.width,H=ov.height;octx.clearRect(0,0,W,H);
  const mini=S.screen==='game',u=H/360,sc=W/(vid.videoWidth||W);
  if(!mini)drawFrame(t,u);
  for(let i=0;i<2;i++){const s=SK[i];if(!s.has)continue;const al=skAlpha(s,t);if(al<.02)continue;
    for(let k=0;k<42;k++)s.Q[k]=s.pts[k]*sc;
    drawHand(octx,s.Q,al,s.pv,mini&&i===sg&&!!drag,t,u,mini,FX)}
}

/* ---------- puzzle (rectangular board keeps the captured aspect ratio) ---------- */
let B=[],B0=[],E=0,N=3,els={},moves=0,secs=0,timer=0,sct=0,paused=false,won=false,lock=true,img='',AR=1;
const boardEl=$('#board'),dims=()=>({bw:boardEl.clientWidth,bh:boardEl.clientHeight});
let bRect=null;   // cached board rect: avoids a forced layout read on every hover/drag test
function layout(){const mw=Math.min(innerWidth-28,640),mh=Math.max(innerHeight-250,160);const w=Math.max(120,Math.min(mw,mh*AR));
  boardEl.style.width=w+'px';boardEl.style.height=w/AR+'px';render();bRect=boardEl.getBoundingClientRect()}
function build(){
  N=S.N;E=N*N-1;boardEl.innerHTML='';els={};
  for(let id=0;id<E;id++){const d=document.createElement('div');d.className='tile';d.style.backgroundImage=`url(${img})`;boardEl.append(d);els[id]=d}
  $('#hl').textContent={3:'Easy 3×3',4:'Medium 4×4',5:'Hard 5×5'}[N];
  B0=shuffleBoard(N);scramble(B0);
}
function scramble(arr){
  cancel();clearInterval(timer);clearTimeout(sct);moves=0;secs=0;won=false;paused=false;lock=true;$('#hm').textContent=0;$('#ht').textContent='0:00';
  B=solvedBoard(N);layout();
  sct=setTimeout(()=>{B=[...arr];render();sct=setTimeout(()=>{lock=false;timer=setInterval(()=>{if(!paused&&!won){secs++;$('#ht').textContent=Math.floor(secs/60)+':'+String(secs%60).padStart(2,'0')}},1000)},350)},450);
}
function render(){
  if(!els[0])return;const {bw,bh}=dims(),Tw=bw/N,Th=bh/N;let ok=0;
  B.forEach((id,i)=>{if(id===E)return;if(id===i)ok++;const el=els[id];el.style.width=Tw+'px';el.style.height=Th+'px';el.style.backgroundSize=`${bw}px ${bh}px`;
    el.style.backgroundPosition=`${-(id%N)*Tw}px ${-(id/N|0)*Th}px`;el.style.transform=`translate(${(i%N)*Tw}px,${(i/N|0)*Th}px)`});
  document.querySelector('#bar i').style.width=(ok/(N*N-1)*100)+'%';
}
const tileAt=(x,y)=>{const r=bRect||boardEl.getBoundingClientRect(),c=Math.floor((x-r.left)/(r.width/N)),w=Math.floor((y-r.top)/(r.height/N));return c<0||w<0||c>=N||w>=N?-1:w*N+c};
let drag=null,hov=null;
function setHover(i){const el=i>=0&&B[i]!==E?els[B[i]]:null;if(el===hov)return;hov?.classList.remove('hover');hov=el;hov?.classList.add('hover')}
function grab(x,y,src){
  if(lock||paused||won||drag)return;const i=tileAt(x,y);if(i<0)return;
  const e=B.indexOf(E);
  if(B[i]===E)return;
  if(!nbrs(e,N).includes(i)){sfx.bad();const el=els[B[i]];el.classList.remove('nope');void el.offsetWidth;el.classList.add('nope');return}
  const {bw,bh}=dims(),ec=e%N,er=e/N|0,c=i%N,r=i/N|0;
  drag={i,e,id:B[i],dx:ec-c,dy:er-r,sx:x,sy:y,Tw:bw/N,Th:bh/N,p:0,dist:0,src};
  els[drag.id].classList.add('held');els[drag.id].style.transition='none';sfx.pick();
}
function drag_(x,y){
  if(!drag)return;const d=drag;if(d.lx===x&&d.ly===y)return;d.lx=x;d.ly=y;d.dist=Math.max(d.dist,Math.hypot(x-d.sx,y-d.sy));
  d.p=clamp(((x-d.sx)*d.dx/d.Tw)+((y-d.sy)*d.dy/d.Th),0,1);
  els[d.id].style.transform=`translate(${(d.i%N+d.dx*d.p)*d.Tw}px,${((d.i/N|0)+d.dy*d.p)*d.Th}px) scale(1.04)`;
}
function endDrag(){const d=drag;drag=null;if(d){const el=els[d.id];el.classList.remove('held');el.style.transition=''}return d}
function cancel(){if(endDrag())render()}                        // snap back, no move
function release(){
  const d=endDrag();if(!d)return;
  // hand: must be dragged more than half-way; mouse/touch: half-way or a plain click
  if(d.src==='hand'?d.p>.5:(d.p>.4||d.dist<8)){[B[d.i],B[d.e]]=[B[d.e],B[d.i]];moves++;$('#hm').textContent=moves;sfx.place();if(isSolved(B))win()}
  else sfx.bad();
  render();
}
function win(){won=true;clearInterval(timer);sfx.win();
  $('#wtxt').textContent=`Time ${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}  ·  ${moves} moves`;
  setTimeout(()=>{$('#win').classList.add('show');
    for(let i=0;i<50;i++){const c=document.createElement('i');c.className='cf';c.style.left=Math.random()*100+'vw';c.style.background=['#8b5cf6','#22d3ee','#fff'][i%3];c.style.animationDelay=Math.random()*.8+'s';document.body.append(c);setTimeout(()=>c.remove(),3600)}},500);
}
boardEl.addEventListener('pointerdown',e=>{boardEl.setPointerCapture(e.pointerId);grab(e.clientX,e.clientY,'ptr')});
boardEl.addEventListener('pointermove',e=>drag_(e.clientX,e.clientY));
boardEl.addEventListener('pointerup',release);boardEl.addEventListener('pointercancel',cancel);

/* ---------- hand control in game ---------- */
// Cursor tunables were chosen with the simulation in the test report, NOT from real camera tests.
const CUR=/*CUR*/{mc:.8,beta:.3,dc:2,dz:1.5,s0:100,v0:150,v1:250,lead:30,cap:40,maxPx:10,tau:25}/*CUR*/;
const curEl=$('#cur'),cursor=new Cursor(CUR),rfil=new OE(4,2,1,0),fsm=new PinchFSM();
let lastHand=null,lastGot=0,lastAnchor=null;const hist=[];
const posAt=t=>{for(let i=hist.length-1;i>=0;i--)if(hist[i].t<=t)return hist[i];return hist[0]||{x:0,y:0}};
const tipMid=q=>({x:(q[4].x+q[8].x)/2,y:(q[4].y+q[8].y)/2});
// full-screen skeleton canvas (game): same mapping as the cursor, uniform scale so the hand is never stretched
const hcv=$('#hand'),hctx=hcv.getContext('2d');let hcW=0,hcH=0,hcDpr=1,hcBlank=true;
function sizeHand(){hcDpr=Math.min(devicePixelRatio||1,MOBILE?1.25:2);hcW=innerWidth;hcH=innerHeight;hcv.width=Math.round(hcW*hcDpr);hcv.height=Math.round(hcH*hcDpr);hcBlank=false}
sizeHand();
function drawGameHand(t,p){
  const s=SK[sg],al=skAlpha(s,t);
  if(al<.01||!(p||lastAnchor)){if(!hcBlank){hctx.setTransform(1,0,0,1,0,0);hctx.clearRect(0,0,hcv.width,hcv.height);hcBlank=true}return}
  if(p)lastAnchor=p;
  const Wc=vid.videoWidth||640,Hc=vid.videoHeight||480,k=Math.sqrt((hcW/(.84*Wc))*(hcH/(.84*Hc)));
  mapSkeleton(s.pts,{x:(s.pts[8]+s.pts[16])/2,y:(s.pts[9]+s.pts[17])/2},lastAnchor,k,s.P);
  hcBlank=false;hctx.setTransform(hcDpr,0,0,hcDpr,0,0);hctx.clearRect(0,0,hcW,hcH);
  drawHand(hctx,s.P,al,s.pv,!!drag,t,Math.max(.8,Math.min(hcW,hcH)/700),false,FX);
}
// stage 2: runs once per NEW camera frame
function handFeed(tc,now,map){
  if(!hands.length)return;
  let hi=0;
  if(hands.length>1&&lastHand){let bd=9;hands.forEach((q,i)=>{const m=tipMid(q),d=Math.hypot(m.x-lastHand.x,m.y-lastHand.y);if(d<bd){bd=d;hi=i}})}
  const h=hands[hi];if(map[hi]>=0)sg=map[hi];
  const W=vid.videoWidth,H=vid.videoHeight,m=tipMid(h);
  if(fsm.pinched&&lastHand&&Math.hypot(m.x-lastHand.x,m.y-lastHand.y)>.3)return;   // impossible jump while holding a tile = tracking glitch, ignore sample
  lastHand=m;lastGot=now;
  const s=toScreen(m.x,m.y,innerWidth,innerHeight);cursor.feed(tc,s.x,s.y,now);
  hist.push({t:now,x:cursor.b.x,y:cursor.b.y});while(hist.length>2&&now-hist[0].t>400)hist.shift();
  const r=rfil.f(pinchRatio(h,W,H),tc),ev=fsm.step(fsm.pinched||pinchValid(h,W,H)?r:1,now,!!drag);
  if(ev==='grab'){curEl.classList.add('pinch');const g=posAt(now-90);grab(g.x,g.y,'hand')}   // closing the fingers drags the midpoint: grab where the hand was aiming ~90ms ago
  else if(ev==='release'){const g=posAt(fsm.relT);drag_(g.x,g.y);curEl.classList.remove('pinch');release()}  // judge the drop where it was when the fingers STARTED opening
}
// stage 3: every display frame. No look-ahead while dragging or when data is stale => the tile always sits at the measured hand position.
function gameRender(t){
  const st=lostState(lastGot?t-lastGot:1e9);
  if(st==='lost'){
    if(lastGot){if(fsm.pinched){fsm.reset();curEl.classList.remove('pinch');cancel()}   // lost mid-drag: snap back, no accidental move
      curEl.style.display='none';setHover(-1);cursor.reset();rfil.reset();lastHand=null;hist.length=0;lastGot=0}
    drawGameHand(t,null);return;
  }
  const p=cursor.at(t,!drag&&st==='live');if(!p){drawGameHand(t,null);return}
  if(curEl.style.display!=='block')curEl.style.display='block';
  curEl.style.transform=`translate3d(${p.x}px,${p.y}px,0)`;
  if(drag)drag_(p.x,p.y);else setHover(tileAt(p.x,p.y));
  drawGameHand(t,p);
}
// viewport / orientation changes: coordinates change meaning, so drop all motion state (small URL-bar resizes only relayout)
let vw0=innerWidth,vh0=innerHeight,vpT=0;
function onViewport(){clearTimeout(vpT);vpT=setTimeout(()=>{
  const big=Math.abs(innerWidth-vw0)>100||Math.abs(innerHeight-vh0)>150;vw0=innerWidth;vh0=innerHeight;sizeHand();if(S.screen==='game')layout();
  if(big){cancel();fsm.reset();curEl.classList.remove('pinch');cursor.reset();rfil.reset();hist.length=0;lastHand=null;lastGot=0;lastAnchor=null;skReset();sizeOverlay()}S.dirty=true},120)}
addEventListener('resize',onViewport);addEventListener('orientationchange',onViewport);

/* ---------- flow + controls ---------- */
$('#go').onclick=async()=>{
  err('');S.N=+$('#lvl').value;ac=ac||new AudioContext();ac.resume();
  $('#go').disabled=true;$('#go').textContent='LOADING…';
  try{setScreen('cam');setChip('LOADING HAND MODEL…');await startCam();ambience(snd)}
  catch(e){S.wantCam=false;stopCam();setScreen('start');err(e.message)}
  $('#go').disabled=false;$('#go').textContent='START CAMERA';
};
$('#retake').onclick=()=>{S.phase='idle';S.cool=performance.now()+1500;rect=null;setScreen('cam')};
$('#begin').onclick=()=>{
  const s=S.shot,k=Math.min(1,1000/Math.max(s.width,s.height)),w=Math.round(s.width*k),h=Math.round(s.height*k),c=document.createElement('canvas');
  c.width=w;c.height=h;c.getContext('2d').drawImage(s,0,0,w,h);img=c.toDataURL('image/jpeg',.9);AR=w/h; // whole selected region, no cropping
  setScreen('game');build();
};
$('#bRestart').onclick=()=>{$('#win').classList.remove('show');scramble(B0)};
$('#bShuffle').onclick=()=>{$('#win').classList.remove('show');B0=shuffleBoard(N);scramble(B0)};
$('#again').onclick=()=>$('#bShuffle').click();
$('#newp').onclick=async()=>{$('#win').classList.remove('show');clearInterval(timer);if(!S.camOn){try{await startCam()}catch(e){alert(e.message);return}}S.phase='idle';S.cool=performance.now()+1500;rect=null;setScreen('cam')};
$('#bPause').onclick=()=>{cancel();paused=true;$('#pause').classList.add('show')};
$('#resume').onclick=()=>{paused=false;$('#pause').classList.remove('show')};
$('#bSnd').onclick=e=>{snd=!snd;ambience(snd);e.target.textContent=snd?'Sound on':'Sound off';e.target.classList.toggle('on',snd)};
$('#bCam').onclick=async e=>{
  if(S.camOn){S.wantCam=false;cancel();fsm.reset();curEl.classList.remove('pinch');stopCam();e.target.textContent='Camera off';e.target.classList.remove('on')}
  else{try{await startCam();stage.classList.add('on');e.target.textContent='Camera on';e.target.classList.add('on')}catch(er){alert(er.message)}}
};
