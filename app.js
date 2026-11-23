import {HandLandmarker,FaceDetector,FilesetResolver} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";
const $=s=>document.querySelector(s), clamp=(v,a,b)=>Math.max(a,Math.min(b,v)), lerp=(a,b,t)=>a+(b-a)*t;
const CDN='https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14',GS='https://storage.googleapis.com/mediapipe-models/';
const vid=$('#vid'),ov=$('#ov'),octx=ov.getContext('2d'),stage=$('#stage'),chip=$('#chip');
const S={screen:'start',camOn:false,N:3,phase:'idle',shot:null,prog:0,cool:0,dim:false};
const setScreen=s=>{if(S.screen==='cam'&&s!=='cam')cancelCapture();if(s!=='game')cancel();document.body.dataset.s=s;S.screen=s;stage.classList.toggle('on',s==='game'&&S.camOn)};
let stream=null,fs=null,lm=null,fd=null,raf=0,lastVT=-1,hands=[];

/*PURE-START*/
// Smoothing: One Euro filter (adaptive low-pass: steady when still, responsive when moving)
class OE{constructor(mc=1.2,b=3,dc=1){this.mc=mc;this.b=b;this.dc=dc;this.x=null;this.dx=0;this.t=0}
 a(c,dt){const r=2*Math.PI*c*dt;return r/(r+1)}
 f(v,t){if(this.x===null){this.x=v;this.dx=0;this.t=t;return v}
  const dt=Math.max((t-this.t)/1000,1e-3);this.t=t;this.dx+=this.a(this.dc,dt)*((v-this.x)/dt-this.dx);
  this.x+=this.a(this.mc+this.b*Math.abs(this.dx),dt)*(v-this.x);return this.x}
 reset(){this.x=null}}
const clampN=(v,a,b)=>Math.max(a,Math.min(b,v));
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
const err=m=>$('#err').textContent=m||'';
async function startCam(){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera needs a secure page (https or localhost).');
  try{stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},audio:false})}
  catch(e){throw new Error(e.name==='NotAllowedError'?'Camera permission was denied. Allow it in the address bar and try again.':e.name==='NotFoundError'?'No camera was found on this device.':'Camera failed to start: '+e.message)}
  vid.srcObject=stream;await vid.play();
  ov.width=vid.videoWidth;ov.height=vid.videoHeight;stage.style.setProperty('--r',vid.videoWidth/vid.videoHeight);
  try{
    fs=fs||await FilesetResolver.forVisionTasks(CDN+'/wasm');
    if(!lm){const o=d=>({baseOptions:{modelAssetPath:GS+'hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',delegate:d},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.6,minHandPresenceConfidence:.6,minTrackingConfidence:.5});
      try{lm=await HandLandmarker.createFromOptions(fs,o('GPU'))}catch{lm=await HandLandmarker.createFromOptions(fs,o('CPU'))}}
  }catch(e){stopCam();throw new Error('Hand model failed to load (internet is needed to fetch it). '+e.message)}
  if(!fd){ // face guidance is optional: failure here must not block the game
    const o=d=>({baseOptions:{modelAssetPath:GS+'face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',delegate:d},runningMode:'VIDEO',minDetectionConfidence:.5});
    try{fd=await FaceDetector.createFromOptions(fs,o('GPU'))}catch{try{fd=await FaceDetector.createFromOptions(fs,o('CPU'))}catch(e){fd=null;console.warn('Face detector unavailable',e)}}
  }
  S.camOn=true;cancelAnimationFrame(raf);raf=requestAnimationFrame(loop);
}
function stopCam(){cancelAnimationFrame(raf);raf=0;stream?.getTracks().forEach(t=>t.stop());stream=null;vid.srcObject=null;lastVT=-1;S.camOn=false;hands=[];face=null;$('#cur').style.display='none';stage.classList.remove('on')}
addEventListener('pagehide',()=>{stopCam();lm?.close();fd?.close()});

let face=null,faceT=0,lastFaceRun=0;
function runFace(t){
  if(!fd||t-lastFaceRun<110)return;lastFaceRun=t;
  const ds=fd.detectForVideo(vid,t).detections||[],W=vid.videoWidth,H=vid.videoHeight;
  let best=null;for(const d of ds){const b=d.boundingBox;if(!best||b.width*b.height>best.width*best.height)best=b}
  if(best){const n={x0:best.originX/W,x1:(best.originX+best.width)/W,y0:best.originY/H,y1:(best.originY+best.height)/H};
    face=face?{x0:lerp(face.x0,n.x0,.5),x1:lerp(face.x1,n.x1,.5),y0:lerp(face.y0,n.y0,.5),y1:lerp(face.y1,n.y1,.5)}:n;faceT=t}
  else if(t-faceT>700)face=null;
}
function loop(){
  raf=requestAnimationFrame(loop);
  if(!stream||vid.readyState<2||vid.currentTime===lastVT)return;
  if(S.screen!=='cam'&&S.screen!=='game')return;
  lastVT=vid.currentTime;const t=performance.now();
  hands=lm.detectForVideo(vid,t).landmarks||[];
  if(S.screen==='cam'){runFace(t);camStep(t)}else gameStep(t);
  draw(t);
}

/* ---------- two-hand frame (corners = extremes of both thumb tips + both index tips) ---------- */
const fx=[0,1,2,3].map(()=>new OE(1.2,3,1));
let rect=null,anchor=null,holdT=0,seen=0,locked=null,cdTimer=0;
const setChip=(txt,ok)=>{chip.textContent=txt;chip.classList.toggle('ok',!!ok)};
const setHint=m=>$('#hintTxt').textContent=m;
function camStep(t){
  const counting=S.phase==='counting',W=vid.videoWidth,H=vid.videoHeight;
  if(hands.length>=2){
    seen=t;S.dim=false;
    const g=frameFromHands(hands.slice(0,2)),v=[g.x0,g.x1,g.y0,g.y1].map((x,i)=>fx[i].f(x,t));
    rect={x0:v[0],x1:v[1],y0:v[2],y1:v[3]};
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

/* ---------- overlay (raw coords; canvas is CSS-mirrored like the video) ---------- */
function draw(t){
  const W=ov.width,H=ov.height;octx.clearRect(0,0,W,H);
  const mini=S.screen==='game',u=H/360;
  for(const h of hands){octx.fillStyle='#22d3ee';octx.strokeStyle='rgba(34,211,238,.6)';octx.lineWidth=2*u;
    if(!mini){octx.beginPath();octx.moveTo(h[4].x*W,h[4].y*H);octx.lineTo(h[8].x*W,h[8].y*H);octx.stroke()}
    for(const i of [4,8]){octx.beginPath();octx.arc(h[i].x*W,h[i].y*H,(mini?3:6)*u,0,7);octx.fill()}}
  if(S.screen!=='cam')return;
  const r=locked||rect;
  if(face){const ok=r&&faceInside(face,r);octx.save();octx.setLineDash([6*u,5*u]);octx.lineWidth=1.5*u;octx.strokeStyle=ok?'rgba(80,255,170,.8)':'rgba(255,190,80,.85)';octx.strokeRect(face.x0*W,face.y0*H,(face.x1-face.x0)*W,(face.y1-face.y0)*H);octx.restore()}
  if(!r)return;
  const x0=r.x0*W,x1=r.x1*W,y0=r.y0*H,y1=r.y1*H,cnt=S.phase==='counting';
  octx.save();if(S.dim&&!cnt)octx.globalAlpha=.5;
  octx.fillStyle='rgba(0,0,0,.5)';octx.beginPath();octx.rect(0,0,W,H);octx.rect(x0,y0,x1-x0,y1-y0);octx.fill('evenodd');
  const L=Math.min(x1-x0,y1-y0)*.2+Math.sin(t/260)*2*u;
  octx.strokeStyle=cnt?'#fff':'#8b5cf6';octx.lineWidth=4*u;octx.shadowColor='#8b5cf6';octx.shadowBlur=14*u;octx.lineCap='round';
  for(const [x,y,dx,dy] of [[x0,y0,1,1],[x1,y0,-1,1],[x0,y1,1,-1],[x1,y1,-1,-1]]){octx.beginPath();octx.moveTo(x,y+dy*L);octx.lineTo(x,y);octx.lineTo(x+dx*L,y);octx.stroke();octx.fillStyle='#22d3ee';octx.beginPath();octx.arc(x,y,3*u,0,7);octx.fill()}
  octx.shadowBlur=0;octx.strokeStyle='rgba(34,211,238,.35)';octx.lineWidth=1*u;octx.strokeRect(x0,y0,x1-x0,y1-y0);
  const cx=(x0+x1)/2,cy=(y0+y1)/2;
  for(const [a,b] of [[cx,y0],[cx,y1]]){octx.beginPath();octx.moveTo(a,b);octx.lineTo(a,b+(b===y0?1:-1)*8*u);octx.stroke()}
  for(const [a,b] of [[x0,cy],[x1,cy]]){octx.beginPath();octx.moveTo(a,b);octx.lineTo(a+(a===x0?1:-1)*8*u,b);octx.stroke()}
  octx.beginPath();octx.moveTo(cx-8*u,cy);octx.lineTo(cx+8*u,cy);octx.moveTo(cx,cy-8*u);octx.lineTo(cx,cy+8*u);octx.stroke();
  if(S.prog>0){octx.strokeStyle='#22d3ee';octx.lineWidth=5*u;octx.beginPath();octx.arc(cx,cy,26*u,-Math.PI/2,-Math.PI/2+S.prog*Math.PI*2);octx.stroke()}
  octx.restore();
}

/* ---------- puzzle (rectangular board keeps the captured aspect ratio) ---------- */
let B=[],B0=[],E=0,N=3,els={},moves=0,secs=0,timer=0,sct=0,paused=false,won=false,lock=true,img='',AR=1;
const boardEl=$('#board'),dims=()=>({bw:boardEl.clientWidth,bh:boardEl.clientHeight});
function layout(){const mw=Math.min(innerWidth-28,640),mh=Math.max(innerHeight-250,160);const w=Math.max(120,Math.min(mw,mh*AR));
  boardEl.style.width=w+'px';boardEl.style.height=w/AR+'px';render()}
addEventListener('resize',()=>S.screen==='game'&&layout());
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
const tileAt=(x,y)=>{const r=boardEl.getBoundingClientRect(),c=Math.floor((x-r.left)/(r.width/N)),w=Math.floor((y-r.top)/(r.height/N));return c<0||w<0||c>=N||w>=N?-1:w*N+c};
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
  if(!drag)return;const d=drag;d.dist=Math.max(d.dist,Math.hypot(x-d.sx,y-d.sy));
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
const cfx=new OE(1.5,4,1),cfy=new OE(1.5,4,1);
let cx=0,cy=0,pinched=false,pc=0,lostT=0,last=null;
function gameStep(t){
  const cur=$('#cur');
  if(!hands.length){
    if(t-lostT>300){if(pinched){pinched=false;pc=0;cur.classList.remove('pinch');cancel()}cur.style.display='none';cfx.reset();cfy.reset();last=null;setHover(-1)}
    return;                                                    // brief loss (<300ms): keep state, ignore frame
  }
  lostT=t;let h=hands[0];
  if(hands.length>1&&last){let bd=9;for(const q of hands){const d=Math.hypot(q[8].x-last.x,q[8].y-last.y);if(d<bd){bd=d;h=q}}}
  last={x:h[8].x,y:h[8].y};
  const size=Math.hypot(h[0].x-h[9].x,h[0].y-h[9].y)||1,ratio=Math.hypot(h[4].x-h[8].x,h[4].y-h[8].y)/size;
  const s=toScreen(cfx.f((h[4].x+h[8].x)/2,t),cfy.f((h[4].y+h[8].y)/2,t),innerWidth,innerHeight);cx=s.x;cy=s.y;
  cur.style.display='block';cur.style.transform=`translate(${cx}px,${cy}px)`;
  if(!pinched){
    setHover(tileAt(cx,cy));
    pc=ratio<.3?pc+1:0;                                         // 2 consecutive frames to engage
    if(pc>=2){pinched=true;pc=0;cur.classList.add('pinch');grab(cx,cy,'hand')}
  }else{
    pc=ratio>.5?pc+1:0;                                         // 3 consecutive open frames to release
    if(pc>=3){pinched=false;pc=0;cur.classList.remove('pinch');release()}else drag_(cx,cy);
  }
}

/* ---------- flow + controls ---------- */
$('#go').onclick=async()=>{
  err('');S.N=+$('#lvl').value;ac=ac||new AudioContext();ac.resume();
  $('#go').disabled=true;$('#go').textContent='LOADING…';
  try{setScreen('cam');setChip('LOADING HAND MODEL…');await startCam();ambience(snd)}
  catch(e){stopCam();setScreen('start');err(e.message)}
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
  if(S.camOn){cancel();pinched=false;stopCam();e.target.textContent='Camera off';e.target.classList.remove('on')}
  else{try{await startCam();stage.classList.add('on');e.target.textContent='Camera on';e.target.classList.add('on')}catch(er){alert(er.message)}}
};
