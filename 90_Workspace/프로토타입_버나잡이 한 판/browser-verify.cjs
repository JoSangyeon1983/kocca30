// Browser QA with an isolated temporary profile; no packages or downloads.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
const candidates=[path.join(process.env.ProgramFiles||'C:/Program Files','Google/Chrome/Application/chrome.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe')];
const browser=candidates.find(p=>fs.existsSync(p));if(!browser)throw Error('Chrome or Edge not found');
const artifacts=path.join(__dirname,'qa');fs.mkdirSync(artifacts,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'berna-hand-qa-'));
const handle=spawn(browser,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-allow-origins=*','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let ws,session,seq=0;const pending=new Map(),errors=[];
function call(method,params={},sessionId=session){const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},12000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
async function click(id,hold=0){const p=await evaluate(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});if(hold)await delay(hold);await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p});}
async function key(code,key,ms=500){await call('Input.dispatchKeyEvent',{type:'keyDown',key,code});await delay(ms);await call('Input.dispatchKeyEvent',{type:'keyUp',key,code});}
async function screenshot(name){const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(artifacts,name),Buffer.from(r.data,'base64'));}
async function until(expression){for(let i=0;i<80;i++){if(await evaluate(expression))return;await delay(50);}throw Error('Timed out: '+expression);}
(async()=>{
 try{
  const url=await new Promise((resolve,reject)=>{let data='';const timer=setTimeout(()=>reject(Error('Browser start timed out')),15000);handle.stderr.on('data',chunk=>{data+=chunk;const m=data.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});handle.on('error',reject);});
  ws=new WebSocket(url);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id&&pending.has(r.id)){const p=pending.get(r.id);pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(r.error.message)):p.resolve(r.result);}if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails.exception?.description||r.params.exceptionDetails.text);};
  const target=await call('Target.createTarget',{url:'about:blank'},null);session=(await call('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
  await call('Page.enable');await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1360,height:940,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:pathToFileURL(path.join(__dirname,'버나잡이 한 판.html')).href});
  await until("typeof window.bernaDiagnostics==='function'");
  await delay(350);let baseline=await evaluate('bernaDiagnostics()');assert(!baseline.grounded&&baseline.rpm>150,'Wheel must start supported and spinning');
  assert(baseline.params.rimHeight===.10&&baseline.params.leatherRadius===.075,'Browser must use the regenerated hoop and leather dimensions');
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Desktop has horizontal overflow');await screenshot('desktop.png');
  await click('pause');let d=await evaluate('bernaDiagnostics()');assert(d.paused);const frozen=d.time;await delay(200);assert.equal((await evaluate('bernaDiagnostics()')).time,frozen,'Paused simulation advanced');
  await evaluate("(()=>{const original=HTMLAnchorElement.prototype.click;window.__qaCSV=null;HTMLAnchorElement.prototype.click=function(){window.__qaCSV=fetch(this.href).then(r=>r.text());};try{document.getElementById('export').click();}finally{HTMLAnchorElement.prototype.click=original;}})()");
  const csv=await evaluate('window.__qaCSV');assert(csv.includes('hand_speed_hz')&&csv.split('\r\n').length>3,'CSV must contain collected samples');await evaluate('delete window.__qaCSV');
  await click('reset');assert((await evaluate('bernaDiagnostics()')).paused,'Reset should preserve pause');
  await click('pause');await evaluate("document.getElementById('speed').focus()");await key('KeyW','w',480);let fast=await evaluate('bernaDiagnostics()');assert(fast.input.speed>3.15,'W must change hand movement speed with a focused slider');
  await key('KeyS','s',480);assert((await evaluate('bernaDiagnostics()')).input.speed<fast.input.speed-.25,'S must slow hand movement');
  await key('ArrowRight','ArrowRight',240);d=await evaluate('bernaDiagnostics()');assert(d.input.x>.02,'Right arrow must move the hand');
  await key('KeyD','d',240);d=await evaluate('bernaDiagnostics()');assert(d.input.tilt>2,'D must change rod tilt');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA'});await delay(70);await evaluate("window.dispatchEvent(new Event('blur'))");assert.equal((await evaluate('bernaDiagnostics()')).held,0,'Blur must release held keys');
  await key('KeyR','r',0);await click('pause');d=await evaluate('bernaDiagnostics()');assert(d.input.x===0&&d.input.tilt===0&&Math.abs(d.input.speed-2.9)<.001,'Reset must restore inputs');
  const point=await evaluate("(()=>{const r=document.getElementById('scene').getBoundingClientRect();return {x:r.x+r.width*.5,y:r.y+r.height*.55};})()");
  await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:point.x+20,y:point.y});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:point.x+20,y:point.y});
  assert((await evaluate('bernaDiagnostics()')).input.x>.01,'Mouse drag must move the hand');
  await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,modifiers:8,...point});await call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,modifiers:8,x:point.x+30,y:point.y});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,modifiers:8,x:point.x+30,y:point.y});
  assert((await evaluate('bernaDiagnostics()')).input.tilt>2,'Shift-drag must change tilt');
  await click('reset');
  for(const v of ['front','top','perspective']){await evaluate(`document.querySelector('[data-view="${v}"]').click()`);await screenshot(v+'.png');}
  await click('pause');
  const held=await evaluate("(()=>{const r=document.querySelector('[data-action=faster]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
  await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...held});await delay(430);await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...held});assert((await evaluate('bernaDiagnostics()')).input.speed>3.1,'Holding screen W button must increase hand speed');
  await key('KeyR','r',0);const launch=await evaluate('bernaDiagnostics()');
  const scrollBefore=await evaluate('scrollY');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space'});
  await delay(180);d=await evaluate('bernaDiagnostics()');assert(d.throwCount===1&&!d.paused&&d.throwAirborne,'Space must throw rather than pause');assert(d.position[1]>launch.position[1]+.15&&d.rpm>100,'Throw must be airborne and spinning');assert.equal(await evaluate('scrollY'),scrollBefore,'Space must not scroll the page');await screenshot('throw-flight.png');
  await until('bernaDiagnostics().catchCount===1&&bernaDiagnostics().canThrow');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',autoRepeat:true});assert.equal((await evaluate('bernaDiagnostics()')).throwCount,1,'Holding Space must not keep throwing');await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space'});await screenshot('throw-caught.png');
  await key('KeyR','r',0);await click('pause');assert((await evaluate('bernaDiagnostics()')).paused);await click('throw');assert((await evaluate('bernaDiagnostics()')).throwCount===1&&!(await evaluate('bernaDiagnostics()')).paused,'Throw button must launch and resume');await until('bernaDiagnostics().catchCount===1');
  await key('KeyP','p',0);assert((await evaluate('bernaDiagnostics()')).paused,'P must pause');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(150);assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Mobile has horizontal overflow');await screenshot('mobile.png');
  const touch=await evaluate("(()=>{const r=document.getElementById('scene').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height*.55};})()");
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...touch,id:1}]});await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x+15,y:touch.y,id:1}]});await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert((await evaluate('bernaDiagnostics()')).input.x>.01,'Touch drag must move hand');
  assert.equal(errors.length,0,'Browser runtime errors');
  const result={browser:path.basename(browser),baseline,checks:['portable-file','WS-hand-speed','AD-tilt','arrow-position','focused-slider-keys','pause','reset','blur-release','mouse-drag','shift-drag','held-button','space-throw','spinning-recatch','space-repeat-guard','space-no-scroll','throw-button','P-pause','touch-drag','csv-export','three-views','desktop-mobile-layout'],errors};
  fs.writeFileSync(path.join(artifacts,'browser-result.json'),JSON.stringify(result,null,2));console.log('PASS browser: '+result.checks.join(', '));
 }finally{if(ws&&ws.readyState===1){try{await call('Browser.close',{},null);}catch{}}handle.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
