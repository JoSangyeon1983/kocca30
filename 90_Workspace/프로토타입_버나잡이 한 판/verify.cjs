const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const {Simulation,Q}=require('./physics.js');
const qa=path.join(__dirname,'qa');fs.mkdirSync(qa,{recursive:true});
function run(input={},seconds=60,params={}) {
 const s=new Simulation(params);s.setInput(input);const trace=[];let maxTilt=0,maxNormal=0,firstGround=null;
 for(let i=0;i<Math.round(seconds/s.p.step);i++){
  s.step();if(i%36===0){const t=s.snapshot();trace.push(t);maxTilt=Math.max(maxTilt,t.tilt);maxNormal=Math.max(maxNormal,t.normalForce);assert(t.position.every(Number.isFinite)&&Number.isFinite(t.rpm),'State must remain finite');assert(Math.abs(Math.hypot(...t.q)-1)<1e-9,'Quaternion normalization');}
  if(s.grounded&&firstGround===null)firstGround=s.time;
 }
 return {final:s.snapshot(),trace,maxTilt,maxNormal,firstGround};
}
const shape=new Simulation();
assert.equal(shape.p.rimHeight,.10,'Hoop height follows the supplied description');
assert.equal(shape.p.leatherRadius*2,.15,'Central leather diameter follows the supplied description');
for(const r of [0,.015,.035,.075,.13,shape.p.radius])assert.equal(shape.profile(r),-.05,'Undeformed support must be flat, including the center');
assert(shape.inertia.every(v=>Number.isFinite(v)&&v>0),'Material distribution must yield positive finite inertia');
const initial=run({},.5);assert.equal(initial.firstGround,null,'Initially spinning flat wheel must support a short observation');assert(initial.final.rpm>150,'Initial spinning state');
// Measure stability after removing the groove. Do not reuse its 60-second support expectations.
const baseline=run(),stopped=run({speed:0});
const smallTilt=run({tilt:3},20),smallShift=run({x:.02},20),fast=run({speed:4},8);
assert(Math.abs(smallTilt.trace[5].position[0]-baseline.trace[5].position[0])>.001,'Tilt must affect wheel position');
assert(Math.abs(smallShift.trace[5].position[0]-baseline.trace[5].position[0])>.001,'Translation must affect wheel position');
const lost=new Simulation({gestureScale:0,initialTilt:0});lost.setInput({x:.42});lost.advance(3);assert(lost.grounded,'Moving the rod outside the wheel must allow a fall');
const airborneA=new Simulation(),airborneB=new Simulation();for(const s of [airborneA,airborneB])s.position[1]=100;airborneA.setInput({speed:0});airborneB.setInput({speed:5});airborneA.advance(.5);airborneB.advance(.5);
assert(!airborneA.contact&&!airborneB.contact,'Airborne test must be out of contact');assert(Math.abs(airborneA.snapshot().rpm-airborneB.snapshot().rpm)<1e-10,'Hand speed must not drive wheel without contact');
const fine=run({},.5,{step:1/720}),coarse=run({},.5);assert(Math.abs(fine.final.rpm-coarse.final.rpm)<1,'Supported short-run convergence of rotation');assert(Math.abs(fine.final.tilt-coarse.final.tilt)<1,'Supported short-run convergence of tilt');
const laterFine=run({},1,{step:1/720}),laterCoarse=run({},1);
const laterDifference={rpm:Math.abs(laterFine.final.rpm-laterCoarse.final.rpm),tilt:Math.abs(laterFine.final.tilt-laterCoarse.final.tilt)};
const tosses=[];
for(const delay of [0,.1,.2,.4,.6]){
 const s=new Simulation();s.advance(delay);const launch=s.snapshot();assert(s.throwWheel(),'Supported wheel must be throwable');
 assert.deepEqual(s.position,launch.position,'Throw must not teleport the wheel');assert(!s.throwWheel(),'Airborne wheel cannot be thrown again');
 let maxY=s.position[1],airTime=0,firstGround=null,catchState=null;const trace=[];
 for(let i=0;i<360*5;i++){
  s.step();maxY=Math.max(maxY,s.position[1]);if(s.throwAirborne)airTime+=s.p.step;
  if(s.grounded&&firstGround===null)firstGround=s.time;
  if(s.catchCount===1&&catchState===null)catchState=s.snapshot();
  if(i%18===0)trace.push(s.snapshot());
 }
 assert(maxY>launch.position[1]+.20,'Throw must visibly lift the wheel');assert(airTime>.35,'Throw must have a free-flight interval');
 assert(catchState&&!catchState.grounded&&catchState.rpm>100,'Toss must regain spinning contact; later stability is measured separately');
 tosses.push({delay,maxY,airTime,catchState,firstGround,final:s.snapshot(),trace});
}
const missed=new Simulation();missed.advance(.1);assert(missed.throwWheel());missed.setInput({x:.42});missed.advance(3);assert(missed.grounded&&missed.catchCount===0,'Moving away from the landing point must allow a miss');assert(!missed.throwWheel(),'A grounded wheel cannot be launched');
const freeA=new Simulation(),freeB=new Simulation();for(const s of [freeA,freeB]){s.advance(.1);s.throwWheel();s.advance(.14);}freeB.setInput({x:.42,tilt:28,speed:5});
for(let i=0;i<22;i++){freeA.step();freeB.step();assert(!freeA.contact&&!freeB.contact,'Flight comparison must exclude an actual rod collision');}
assert(freeA.throwAirborne&&freeB.throwAirborne&&!freeA.contact&&!freeB.contact,'Free flight test must be airborne');
for(let i=0;i<3;i++)assert(Math.abs(freeA.position[i]-freeB.position[i])<1e-10,'Moving the rod must not pull the airborne wheel');
assert(Math.abs(freeA.snapshot().rpm-freeB.snapshot().rpm)<1e-10,'Airborne spin must remain independent of rod inputs');
require('./build.cjs');
for(const name of ['physics.js','app.js'])new vm.Script(fs.readFileSync(path.join(__dirname,name),'utf8'),{filename:name});
const html=fs.readFileSync(path.join(__dirname,'버나잡이 한 판.html'),'utf8');assert(!/src="[^"#]+"|href="style\.css"/.test(html),'Portable file must contain scripts and styles');
const summary={shape:{rimHeight:shape.p.rimHeight,leatherDiameter:shape.p.leatherRadius*2,supportHeights:[0,.035,.075,.235].map(r=>shape.profile(r)),inertia:shape.inertia},initial,baseline,stopped,smallTilt,smallShift,fast,tosses,missed:missed.snapshot(),convergence:{coarse:coarse.final,fine:fine.final,laterWindow:{coarse:laterCoarse.final,fine:laterFine.final,difference:laterDifference}},limitations:['Flat contact with the existing preset gesture loses baseline support; sustained balance is not validated.','Step-size agreement is checked at 0.5 seconds; the 1-second differences are measurements, not a passed stability check.'],checks:['flat-support-surface','hoop-leather-dimensions','initial-spinning-support','input-response','loss-by-translation','no-airborne-drive','finite-state','quaternion','short-step-convergence','five-early-toss-phases','spinning-recontact','no-teleport','no-air-rethrow','miss-by-movement','independent-free-flight','portable-build','syntax']};
fs.writeFileSync(path.join(qa,'physics-result.json'),JSON.stringify(summary,null,2));
console.log('PASS physics: '+summary.checks.join(', '));
for(const [name,r] of Object.entries({baseline,stopped,smallTilt,smallShift,fast}))console.log(name,{rpm:+r.final.rpm.toFixed(1),tilt:+r.final.tilt.toFixed(1),firstGround:r.firstGround,contactFraction:+r.final.contactFraction.toFixed(3)});
console.log('tosses',tosses.map(t=>({delay:t.delay,maxY:+t.maxY.toFixed(3),catchRpm:+t.catchState.rpm.toFixed(1),firstGround:t.firstGround,catchCount:t.final.catchCount})));
console.log('1s step-size differences',laterDifference);
if(process.argv.includes('--browser')){const r=spawnSync(process.execPath,[path.join(__dirname,'browser-verify.cjs')],{stdio:'inherit',windowsHide:true});if(r.status!==0)process.exitCode=r.status||1;}
