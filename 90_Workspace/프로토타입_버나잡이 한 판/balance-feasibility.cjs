// Isolated feasibility experiments. This does not edit the application or its physics engine.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Simulation,V,Q,clamp}=require('./physics.js');
const output=path.join(__dirname,'qa','balance-feasibility.json');
const engineHash=()=>crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'physics.js'))).digest('hex');
const result=fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8')):{};
result.engineSha256=engineHash();
const metrics=s=>{
 const local=Q.rotate(Q.conj(s.q),V.sub(s.tip,s.position)),snap=s.snapshot();
 return {...snap,supportRadius:Math.hypot(local[0],local[2]),gap:local[1]-s.profile(),
  relativeHorizontal:Math.hypot(s.position[0]-s.tip[0],s.position[2]-s.tip[2])};
};
function observe(s,seconds=30,policy=null,record=false) {
 let firstGround=null,firstGap=null,maxTilt=0,maxRadius=0,maxHorizontal=0,finite=true;
 const trace=[],commands=[];let next=0;
 for(let i=0;i<Math.round(seconds/s.p.step);i++){
  if(policy)policy(s);
  s.step();
  const m=metrics(s);maxTilt=Math.max(maxTilt,m.tilt);maxRadius=Math.max(maxRadius,m.supportRadius);
  maxHorizontal=Math.max(maxHorizontal,m.relativeHorizontal);
  finite=finite&&m.position.every(Number.isFinite)&&m.q.every(Number.isFinite)&&Number.isFinite(m.rpm);
  if(firstGap===null&&s.time>.02&&!s.contact)firstGap=s.time;
  if(record&&s.time>=next){trace.push(m);commands.push({time:s.time,input:{...s.input}});next+=.05;}
  if(s.grounded){firstGround=s.time;break;}
  if(!finite)break;
 }
 const final=metrics(s),contactFraction=s.contactSeconds/(s.time||1);
 // Engineering observation criteria, not thresholds measured from a real Berna.
 const supported=finite&&firstGround===null&&s.time>=seconds-s.p.step/2&&contactFraction>=.95&&maxTilt<=20&&final.rpm>=50;
 return {duration:s.time,requestedDuration:seconds,firstGround,firstGap,contactFraction,maxTilt,maxRadius,maxHorizontal,finite,supported,final,...(record?{trace,commands}:{})};
}
function write(){result.updatedUtc=new Date().toISOString();result.criteria={durationSeconds:30,noFloorContact:true,contactFractionMin:.95,maxTiltDegrees:20,minFinalRpm:50};result.applicationModified=false;fs.writeFileSync(output,JSON.stringify(result,null,2));}
function fixed(input={},params={},seconds=30,record=false){const s=new Simulation(params);s.setInput(input);return observe(s,seconds,null,record);}
const mode=process.argv[2]||'fixed';
if(mode==='fixed'){
 result.idealChecks=[];
 for(const [name,input,params] of [
  ['default',{},{}],['stop-command-from-default',{speed:0},{}],
  ['exact-centered-flat-stationary',{}, {gestureScale:0,initialTilt:0,initialSpeed:0}],
  ['stationary-rod-with-2.5deg-tilt',{}, {gestureScale:0,initialTilt:2.5,initialSpeed:0}],
  ['preset-gesture-starts-stopped',{}, {initialSpeed:0}],
  ['preset-gesture-starts-stopped-flat',{}, {initialSpeed:0,initialTilt:0}]
 ]){
  const r=fixed(input,params,30,true);result.idealChecks.push({name,input,params,...r});
  console.log(name,JSON.stringify({duration:r.duration,ground:r.firstGround,supported:r.supported,rpm:r.final.rpm,tilt:r.maxTilt,contact:r.contactFraction}));
 }
 const xs=[-.42,-.2,-.1,-.05,-.02,0,.02,.05,.1,.2,.42];
 const tilts=[-28,-20,-10,-5,0,5,10,20,28];
 const speeds=[0,.25,.5,1,1.5,2,2.5,2.9,3.5,4,5];
 const runs=[];
 for(const x of xs)for(const tilt of tilts)for(const speed of speeds){
  const input={x,tilt,speed},r=fixed(input,{},10);
  runs.push({input,duration:r.duration,ground:r.firstGround,supported:r.supported,contactFraction:r.contactFraction,maxTilt:r.maxTilt,finalRpm:r.final.rpm,finalPosition:r.final.position});
 }
 runs.sort((a,b)=>b.duration-a.duration||b.contactFraction-a.contactFraction);
 result.fixedGrid={count:runs.length,xs,tilts,speeds,horizonSeconds:10,noFloorCount:runs.filter(r=>r.ground===null).length,runs};
 result.bestFixed=runs.slice(0,8).map(r=>({input:r.input,...fixed(r.input,{},30,true)}));
 console.log('fixed-grid',JSON.stringify({count:runs.length,noFloorCount:result.fixedGrid.noFloorCount,best:runs.slice(0,8)}));
 write();
}
function controlled(inputController={},params={},seconds=30,record=false) {
 const s=new Simulation({gestureScale:0,initialSpeed:0,...params});
 const {gain=1,lag=.14,maxSpeed=.12,offsetLimit=.05,interval=1/60,positionGain=0,velocityGain=0}=inputController;
 if(params.initialTiltAzimuth!==undefined){
  const az=params.initialTiltAzimuth*Math.PI/180;
  s.q=Q.axis([Math.sin(az),0,Math.cos(az)],s.p.initialTilt*Math.PI/180);
  const axis=Q.rotate(s.q,[0,1,0]);
  s.position=[0,(V.dot(s.tip,axis)-s.profile())/axis[1],0];
  s.momentum=Q.rotate(s.q,[0,s.inertia[1]*s.p.initialRpm*Math.PI/30,0]);
 }
 const tip=s.tip.slice(),height=tip[1];let nextControl=0,target=tip.slice(),maxTipSpeed=0,maxTipRadius=0;
 const disturbance=params.disturbance;let disturbanceApplied=false;
 // Experimental 2D hand input, with fixed height and bounded horizontal speed.
 // Only rod position is controlled; the wheel receives the engine's contact forces.
 s.rodPose=()=>({base:[tip[0],height-s.p.length,tip[2]],direction:[0,1,0],tip:tip.slice()});
 const policy=()=>{
  if(disturbance&&!disturbanceApplied&&s.time+1e-10>=disturbance.time){
   // An explicitly recorded external test impulse, not a stabilizing force.
   s.impulse(disturbance.impulse,disturbance.lever||[0,0,0]);disturbanceApplied=true;
  }
  if(s.time+1e-10>=nextControl){
   const axis=Q.rotate(s.q,[0,1,0]),axial=V.dot(s.momentum,axis);
   const desiredX=clamp((-positionGain*s.position[0]-velocityGain*s.velocity[0])/9.81,-.10,.10);
   const desiredZ=clamp((-positionGain*s.position[2]-velocityGain*s.velocity[2])/9.81,-.10,.10);
   const dx=clamp(-gain*(s.momentum[2]-axial*desiredZ)/(s.p.mass*9.81),-offsetLimit,offsetLimit);
   const dz=clamp(gain*(s.momentum[0]-axial*desiredX)/(s.p.mass*9.81),-offsetLimit,offsetLimit);
   target=[clamp(s.position[0]+dx,-.42,.42),height,clamp(s.position[2]+dz,-.42,.42)];
   nextControl+=interval;
  }
  const delta=V.sub(target,tip);delta[1]=0;
  let move=V.mul(delta,1-Math.exp(-s.p.step/lag));
  const limit=maxSpeed*s.p.step;
  if(V.len(move)>limit)move=V.mul(move,limit/V.len(move));
  maxTipSpeed=Math.max(maxTipSpeed,V.len(move)/s.p.step);
  for(const i of [0,2])tip[i]+=move[i];
  maxTipRadius=Math.max(maxTipRadius,Math.hypot(tip[0],tip[2]));
 };
 const r=observe(s,seconds,policy,record);
 return {...r,controller:inputController,params,maxTipSpeed,maxTipRadius,disturbanceApplied,constantTipHeight:height};
}
if(mode==='two-axis'){
 const sweep=[];
 for(const gain of [.25,.5,1,2,4,8])for(const lag of [.02,.05,.10,.14])for(const maxSpeed of [.12,.25,.5]){
  const controller={gain,lag,maxSpeed},r=controlled(controller,{},10);
  sweep.push({controller,duration:r.duration,ground:r.firstGround,contactFraction:r.contactFraction,maxTilt:r.maxTilt,finalRpm:r.final.rpm,supported:r.supported,finalPosition:r.final.position});
 }
 sweep.sort((a,b)=>Number(b.supported)-Number(a.supported)||b.duration-a.duration||a.maxTilt-b.maxTilt);
 result.twoAxisSweep={count:sweep.length,horizonSeconds:10,runs:sweep};
 result.bestTwoAxis=sweep.slice(0,4).map(r=>controlled(r.controller,{},30,true));
 console.log('two-axis-sweep',JSON.stringify({count:sweep.length,supported:sweep.filter(r=>r.supported).length,best:sweep.slice(0,8)}));
 console.log('two-axis-30s',JSON.stringify(result.bestTwoAxis.map(r=>({controller:r.controller,duration:r.duration,supported:r.supported,maxTilt:r.maxTilt,rpm:r.final.rpm,maxTipSpeed:r.maxTipSpeed,position:r.final.position}))));
 write();
}
if(mode==='full-feedback'){
 const sweep=[];
 for(const gain of [.25,.5,1,2,4])for(const positionGain of [.5,2,8])for(const velocityGain of [.5,2,6])for(const maxSpeed of [.12,.25]){
  const controller={gain,positionGain,velocityGain,maxSpeed,lag:.02},r=controlled(controller,{},30);
  sweep.push({controller,duration:r.duration,ground:r.firstGround,contactFraction:r.contactFraction,maxTilt:r.maxTilt,finalRpm:r.final.rpm,supported:r.supported,finalPosition:r.final.position});
 }
 sweep.sort((a,b)=>Number(b.supported)-Number(a.supported)||b.duration-a.duration||a.maxTilt-b.maxTilt);
 result.fullFeedbackSweep={count:sweep.length,horizonSeconds:30,runs:sweep};
 result.bestFullFeedback=sweep.slice(0,4).map(r=>controlled(r.controller,{},30,true));
 console.log('full-feedback',JSON.stringify({count:sweep.length,supported:sweep.filter(r=>r.supported).length,best:sweep.slice(0,8)}));
 write();
}
if(mode==='robustness'){
 const base={gain:2,positionGain:2,velocityGain:6,maxSpeed:.12};
 const response=[];
 for(const lag of [.02,.05,.10,.14])for(const interval of [1/60,.05,.10]){
  const controller={...base,lag,interval};
  for(const step of [1/360,1/720,1/1440]){
   const r=controlled(controller,{step},30);
   response.push(r);
   console.log('response',JSON.stringify({lag,interval,step,duration:r.duration,supported:r.supported,tilt:r.maxTilt,rpm:r.final.rpm,maxTipRadius:r.maxTipRadius,position:r.final.position}));
  }
 }
 result.feedbackResponseChecks=response;
 const candidates=response.filter(r=>r.params.step===1/1440&&r.supported&&response.filter(t=>t.controller.lag===r.controller.lag&&t.controller.interval===r.controller.interval).every(t=>t.supported)).sort((a,b)=>b.controller.lag-a.controller.lag||b.controller.interval-a.controller.interval);
 const chosen=candidates[0]?.controller||{...base,lag:.02,interval:1/60};
 result.selectedFeedbackController=chosen;
 const perturb=[];
 for(const initialTilt of [2.5,5,8])for(const initialTiltAzimuth of [0,90,180,270]){
  const r=controlled(chosen,{step:1/1440,initialTilt,initialTiltAzimuth},30);
  perturb.push(r);
  console.log('initial-tilt',JSON.stringify({initialTilt,initialTiltAzimuth,duration:r.duration,supported:r.supported,tilt:r.maxTilt,rpm:r.final.rpm,maxTipRadius:r.maxTipRadius}));
 }
 for(const impulse of [[.032,0,0],[0,0,.032],[-.032,0,0],[0,0,-.032]]){
  const r=controlled(chosen,{step:1/1440,disturbance:{time:10,impulse}},30,true);perturb.push(r);
  console.log('disturbance',JSON.stringify({impulse,duration:r.duration,supported:r.supported,tilt:r.maxTilt,rpm:r.final.rpm,maxTipRadius:r.maxTipRadius}));
 }
 result.feedbackPerturbationChecks=perturb;
 result.feedbackWitness=controlled(chosen,{step:1/1440},30,true);
 write();
}
if(mode==='cross-check'){
 const chosen=result.selectedFeedbackController;
 if(!chosen)throw Error('Run robustness mode before cross-check.');
 const cases=[];
 for(const initialTilt of [2.5,5,8])for(const initialTiltAzimuth of [0,90])cases.push({initialTilt,initialTiltAzimuth});
 for(const impulse of [[.032,0,0],[0,0,.032],[-.032,0,0],[0,0,-.032]])cases.push({disturbance:{time:10,impulse}});
 const runs=[];
 for(const params of cases)for(const step of [1/360,1/720,1/1440]){
  const r=controlled(chosen,{...params,step},30);runs.push(r);
  console.log('cross-check',JSON.stringify({params:{...params,step},duration:r.duration,supported:r.supported,tilt:r.maxTilt,rpm:r.final.rpm,maxTipSpeed:r.maxTipSpeed,maxTipRadius:r.maxTipRadius,contact:r.contactFraction}));
 }
 result.feedbackCrossChecks={count:runs.length,runs};
 result.feedbackExtended=controlled(chosen,{step:1/1440},60,true);
 console.log('extended',JSON.stringify({duration:result.feedbackExtended.duration,ground:result.feedbackExtended.firstGround,supported:result.feedbackExtended.supported,tilt:result.feedbackExtended.maxTilt,rpm:result.feedbackExtended.final.rpm,contact:result.feedbackExtended.contactFraction}));
 write();
}
function clone(s){const out=Object.create(Simulation.prototype);for(const [k,v] of Object.entries(s))out[k]=Array.isArray(v)?v.slice():v&&typeof v==='object'?{...v}:v;return out;}
function loss(s){
 const m=metrics(s);
 return 80*m.relativeHorizontal**2+8*(m.tilt*Math.PI/180)**2+2*(s.velocity[0]**2+s.velocity[2]**2)+
  5*(s.position[1]-1.19)**2+(s.contact?0:2)+(s.grounded?10000:0);
}
function stepInput(s,input,seconds){s.setInput(input);for(let i=0;i<Math.round(seconds/s.p.step);i++){s.step();if(s.grounded)break;}return s;}
function beamTrial(rateLimited=false,width=20,seconds=10){
 const period=.1;
 let beam=[{s:new Simulation(),cost:0,path:[]}];
 let survived=0;
 for(let frame=0;frame<Math.round(seconds/period);frame++){
  const candidates=[];
  for(const b of beam){
   const m=metrics(b.s),s=b.s;
   const desired=s.position[0]+s.velocity[0]*.08;
   const positions=rateLimited?[s.input.x-.012,s.input.x,s.input.x+.012]:[s.input.x-.04,s.input.x,s.input.x+.04,desired];
   const tilts=rateLimited?[s.input.tilt-1.2,s.input.tilt,s.input.tilt+1.2]:[s.input.tilt-6,s.input.tilt,s.input.tilt+6,0];
   const speeds=rateLimited?[s.input.speed-.06,s.input.speed,s.input.speed+.06]:[0,1,2.9,5];
   for(const x of positions)for(const tilt of tilts)for(const speed of speeds){
    const input={x:clamp(x,-.42,.42),tilt:clamp(tilt,-28,28),speed:clamp(speed,0,5)};
    const c=stepInput(clone(s),input,period);
    if(c.grounded)continue;
    const cost=b.cost+loss(c);
    candidates.push({s:c,cost,path:[...b.path,{time:s.time,input}]});
   }
  }
  if(!candidates.length)break;
  candidates.sort((a,b)=>a.cost-b.cost);
  // Keep diverse end states rather than 20 near-identical variants.
  const unique=new Set();beam=[];
  for(const c of candidates){const k=[...c.s.position.map(v=>Math.round(v/.004)),...c.s.momentum.map(v=>Math.round(v/.001)),Math.round(c.s.input.speed/.25)].join(',');if(unique.has(k))continue;unique.add(k);beam.push(c);if(beam.length===width)break;}
  survived=(frame+1)*period;
 }
 const best=beam.sort((a,b)=>a.cost-b.cost)[0];
 if(!best)return {rateLimited,width,period,survived,successful:false};
 const path=best.path;
 const replay=(step)=>{const s=new Simulation({step});let index=0;return observe(s,seconds,()=>{while(index<path.length&&s.time+1e-10>=path[index].time){s.setInput(path[index].input);index++;}},true);};
 return {rateLimited,width,period,survived,successful:survived>=seconds,bestState:metrics(best.s),path,replay:replay(1/360),fineReplay:replay(1/720)};
}
if(mode==='dynamic'){
 result.dynamicTrials=[];
 for(const rateLimited of [true,false]){
  const r=beamTrial(rateLimited,20,10);result.dynamicTrials.push(r);
  console.log('dynamic-beam',JSON.stringify({rateLimited,survived:r.survived,successful:r.successful,replay:r.replay&&{duration:r.replay.duration,supported:r.replay.supported,ground:r.replay.firstGround,tilt:r.replay.maxTilt},fine:r.fineReplay&&{duration:r.fineReplay.duration,supported:r.fineReplay.supported,ground:r.fineReplay.firstGround,tilt:r.fineReplay.maxTilt},bestInput:r.path?.at(-1)?.input}));
  write();
 }
}
if(mode==='report'){
 const runs=result.feedbackCrossChecks?.runs||[];
 console.log(JSON.stringify({engineHashMatches:result.engineSha256===engineHash(),applicationModified:result.applicationModified,
  fixedCount:result.fixedGrid?.count,fixedNoFloorCount:result.fixedGrid?.noFloorCount,bestFixed:result.fixedGrid?.runs[0],
  dynamic:result.dynamicTrials?.map(r=>({rateLimited:r.rateLimited,duration:r.replay.duration,ground:r.replay.firstGround,supported:r.replay.supported,fineDuration:r.fineReplay.duration,fineSupported:r.fineReplay.supported})),
  fullFeedbackCount:result.fullFeedbackSweep?.count,fullFeedbackSupported:result.fullFeedbackSweep?.runs.filter(r=>r.supported).length,
  selectedController:result.selectedFeedbackController,crossCheckCount:runs.length,crossCheckSupported:runs.filter(r=>r.supported).length,
  crossCheckAllFinite:runs.every(r=>r.finite),crossCheckMinContact:Math.min(...runs.map(r=>r.contactFraction)),
  crossCheckMaxTilt:Math.max(...runs.map(r=>r.maxTilt)),crossCheckMaxTipRadius:Math.max(...runs.map(r=>r.maxTipRadius)),
  crossCheckMaxTipSpeed:Math.max(...runs.map(r=>r.maxTipSpeed)),
  extended:result.feedbackExtended&&{duration:result.feedbackExtended.duration,ground:result.feedbackExtended.firstGround,supported:result.feedbackExtended.supported,rpm:result.feedbackExtended.final.rpm}
 },null,2));
}
module.exports={observe,metrics,fixed,controlled,result,write,Simulation,V,Q,clamp};
