'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname,'../..');
const file = path.join(root,'08_산출물/덜미/행동 안내 HTML 시안/행동 안내 시안.html');
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'puppet-guide-'));
const portableFile = path.join(profile,'시안.html');
fs.copyFileSync(file,portableFile);
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
  '--headless=new','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+path.join(profile,'browser'),
  '--no-first-run','--no-default-browser-check','--disable-background-networking',
  '--disable-background-timer-throttling','--disable-renderer-backgrounding','about:blank'
],{windowsHide:true,stdio:'ignore'});
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const pending = new Map(), errors = [], externalRequests = [], checks = [];
let socket, sessionId, nextId = 0;
function send(method,params={},rootCommand=false) {
  return new Promise((resolve,reject)=>{
    const id=++nextId, timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},15000);
    pending.set(id,{resolve,reject,timer});
    socket.send(JSON.stringify({id,method,params,...(!rootCommand&&sessionId?{sessionId}:{})}));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function until(expression,timeout=10000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) {if(await evaluate(expression)) return; await sleep(35);}
  throw new Error('Condition timeout: '+expression);
}
async function screenshot(name) {
  const shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(__dirname,name),Buffer.from(shot.data,'base64'));
}
async function geometry() {
  return evaluate(`(()=>{const get=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};return {screen:get('screen'),dialogue:get('dialogue-protected'),hint:get('hint-frame'),overflow:document.documentElement.scrollWidth>innerWidth,viewport:[innerWidth,innerHeight]}})()`);
}
async function main() {
  try {
    const portFile=path.join(profile,'browser','DevToolsActivePort');
    for(let i=0;i<120&&!fs.existsSync(portFile);i++) await sleep(80);
    if(!fs.existsSync(portFile)) throw new Error('Edge did not start');
    const [port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);
    socket=new WebSocket('ws://127.0.0.1:'+port+endpoint);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
    socket.addEventListener('message',event=>{
      const msg=JSON.parse(event.data);
      if(msg.method==='Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
      if(msg.method==='Network.requestWillBeSent'&&/^https?:/i.test(msg.params.request.url)) externalRequests.push(msg.params.request.url);
      const item=pending.get(msg.id);if(!item)return;
      clearTimeout(item.timer);pending.delete(msg.id);
      if(msg.error)item.reject(new Error(JSON.stringify(msg.error)));else item.resolve(msg.result);
    });
    const version=await send('Browser.getVersion',{},true);
    const {targetId}=await send('Target.createTarget',{url:'about:blank'},true);
    sessionId=(await send('Target.attachToTarget',{targetId,flatten:true},true)).sessionId;
    await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
    await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:pathToFileURL(portableFile).href});
    await until(`document.getElementById('screen')?.dataset.ready==='true'`);
    assert.equal(await evaluate(`document.images.length===1 && document.images[0].src.startsWith('data:image/png;base64,') && document.images[0].naturalWidth===1671`),true);
    assert.equal(await evaluate(`document.getElementById('avatar-correction').getAttribute('href').startsWith('data:image/png;base64,') && document.getElementById('avatar-correction').getAttribute('mask')==='url(#avatar-correction-mask)'`),true);
    assert.equal(await evaluate(`document.querySelectorAll('audio,video,button').length`),0);
    checks.push('one copied HTML loads offline with one original background, one masked arm correction and automatic playback');
    const desktop=await geometry();
    assert.ok(desktop.hint.x>desktop.dialogue.right);
    assert.ok(desktop.hint.right<=desktop.screen.right+1);
    assert.equal(desktop.overflow,false);
    await until(`document.getElementById('screen').dataset.mode==='give' && +document.getElementById('screen').dataset.phase>.03 && +document.getElementById('screen').dataset.phase<.10`);
    const giveStart=await evaluate(`(()=>{const p=document.getElementById('give-prop').getBoundingClientRect(),h=document.getElementById('give-hand').getBoundingClientRect();return {propX:p.x,propY:p.y,handX:h.x,handY:h.y}})()`);
    await until(`document.getElementById('screen').dataset.mode==='give' && +document.getElementById('screen').dataset.phase>.50 && +document.getElementById('screen').dataset.phase<.58`);
    const giveEnd=await evaluate(`(()=>{const p=document.getElementById('give-prop').getBoundingClientRect(),h=document.getElementById('give-hand').getBoundingClientRect();return {propX:p.x,propY:p.y,handX:h.x,handY:h.y}})()`);
    assert.ok(giveStart.propX-giveEnd.propX>70);
    assert.ok(Math.abs((giveStart.propX-giveEnd.propX)-(giveStart.handX-giveEnd.handX))<.2);
    assert.ok(Math.abs(giveEnd.propY-giveStart.propY)<.2&&Math.abs(giveEnd.handY-giveStart.handY)<.2);
    assert.ok(Math.abs((giveStart.handX-giveStart.propX)-(giveEnd.handX-giveEnd.propX))<.2);
    assert.equal(await evaluate(`document.getElementById('hint-title').textContent`),'건네기');
    await screenshot('건네기 검증.png');
    checks.push('giving hand supports the prop and moves horizontally with exactly the same displacement to the left target; no instructions under title');
    await until(`document.getElementById('screen').dataset.mode==='throw' && +document.getElementById('screen').dataset.phase>.35 && +document.getElementById('screen').dataset.phase<.42`,10000);
    const raised=await evaluate(`({held:+document.getElementById('held-prop').getAttribute('opacity'),arm:document.getElementById('throw-arm').getAttribute('transform'),title:document.getElementById('hint-title').textContent})`);
    assert.equal(raised.title,'던지기');assert.ok(raised.held>.99);
    await screenshot('던지기 준비 검증.png');
    await until(`document.getElementById('screen').dataset.mode==='throw' && +document.getElementById('screen').dataset.phase>.65 && +document.getElementById('screen').dataset.phase<.72`);
    const released=await evaluate(`({held:+document.getElementById('held-prop').getAttribute('opacity'),flying:+document.getElementById('flying-prop').getAttribute('opacity'),open:+document.getElementById('open-hand').getAttribute('opacity'),closed:+document.getElementById('closed-hand').getAttribute('opacity'),arm:document.getElementById('throw-arm').getAttribute('transform')})`);
    assert.equal(released.held,0);assert.ok(released.flying>.99);assert.equal(released.open,1);assert.equal(released.closed,0);assert.notEqual(released.arm,raised.arm);
    await screenshot('던지기 검증.png');
    checks.push('throwing raises a held prop, swings the arm down, opens the hand and releases a separately flying prop');
    const duringThrow=await geometry();assert.deepEqual(duringThrow.dialogue,desktop.dialogue);assert.deepEqual(duringThrow.hint,desktop.hint);
    assert.equal(await evaluate(`document.querySelectorAll('.instruction-title').length===1 && document.querySelectorAll('#hint text').length===1`),true);
    await until(`document.getElementById('screen').dataset.mode==='give' && +document.getElementById('screen').dataset.elapsed>12000`,9000);
    assert.equal(await evaluate(`document.getElementById('hint-title').textContent`),'건네기');
    checks.push('giving and throwing automatically alternate after two 3-second loops, then return to giving with stable geometry');
    const sizes=[];
    for(const [width,height,mobile] of [[390,844,true],[844,390,true]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});
      await sleep(80);const g=await geometry();
      assert.equal(g.overflow,false);assert.ok(g.screen.right<=width+1&&g.screen.bottom<=height+1);assert.ok(g.hint.x>g.dialogue.right);assert.ok(g.hint.right<=g.screen.right+1);
      sizes.push(g);
    }
    checks.push('portrait and landscape viewport scaling keeps full screenshot and gap beside dialogue with no overflow');
    assert.deepEqual(errors,[]);assert.deepEqual(externalRequests,[]);
    checks.push('no JavaScript exceptions or network requests');
    const result={verifiedAt:new Date().toISOString(),browser:version.product,mode:'file URL in a separate directory, browser offline',checks,desktop,smallViewports:sizes,errors,externalRequests};
    fs.writeFileSync(path.join(__dirname,'브라우저 검증.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
  } finally {
    if(socket?.readyState===1){await send('Browser.close',{},true).catch(()=>{});socket.close();}
    browser.kill();for(const item of pending.values())clearTimeout(item.timer);
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});
