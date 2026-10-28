'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'극 진행 데이터.js'),'utf8'),context);
const data = JSON.parse(JSON.stringify(context.window.PLAY_DATA));
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'kkok-play-'));
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
  '--headless=new','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check',
  '--disable-background-networking','--disable-background-timer-throttling','--disable-renderer-backgrounding','about:blank'
],{windowsHide:true,stdio:'ignore'});
const pending = new Map(),errors = [],checks = [];
let socket,sessionId,nextId=0;
function send(method,params={},root=false) {
  return new Promise((resolve,reject) => {
    const id=++nextId;
    const timer=setTimeout(() => {pending.delete(id);reject(new Error(method+' timeout'));},15000);
    pending.set(id,{resolve,reject,timer});
    socket.send(JSON.stringify({id,method,params,...(!root&&sessionId?{sessionId}:{})}));
  });
}
async function evaluate(expression) {
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function click(id) {return evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);}
async function select(id,value) {return evaluate(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change',{bubbles:true}))`);}
async function screenshot(name) {
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(300);
  const shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(__dirname,name),Buffer.from(shot.data,'base64'));
}
async function goToSpeech(ordinal) {
  await click('restart');
  await evaluate(`for(let i=0;i<350;i++){const count=document.getElementById('speech-count').textContent;const hidden=document.getElementById('dialogue').classList.contains('is-hidden');if(!hidden&&parseInt(count)===${ordinal})break;document.getElementById('next').click();}`);
}
async function main() {
  try {
    const portFile=path.join(profile,'DevToolsActivePort');
    for(let i=0;i<100&&!fs.existsSync(portFile);i++) await sleep(100);
    const [port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);
    socket=new WebSocket('ws://127.0.0.1:'+port+endpoint);
    await new Promise((resolve,reject) => {socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    socket.addEventListener('message',event => {
      const message=JSON.parse(event.data);
      if(message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
      const item=pending.get(message.id);if(!item)return;
      clearTimeout(item.timer);pending.delete(message.id);
      if(message.error)item.reject(new Error(JSON.stringify(message.error)));else item.resolve(message.result);
    });
    const version=await send('Browser.getVersion',{},true);
    const {targetId}=await send('Target.createTarget',{url:'about:blank'},true);
    sessionId=(await send('Target.attachToTarget',{targetId,flatten:true},true)).sessionId;
    await send('Runtime.enable');await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:960,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:pathToFileURL(path.join(__dirname,'극 진행 보기.html')).href});
    for(let i=0;i<80;i++){if(await evaluate('document.readyState==="complete" && document.querySelectorAll("#chapter-select option").length===5'))break;await sleep(100);}
    assert.equal(await evaluate('document.getElementById("load-error").hidden'),true);
    assert.equal(await evaluate('document.querySelectorAll("audio,video").length'),0);
    checks.push('file URL loads five chapters and all supplied images without audio');
    await click('start');await sleep(2000);
    const count1=await evaluate('document.getElementById("speech-text").textContent.length');
    await sleep(160);
    const count2=await evaluate('document.getElementById("speech-text").textContent.length');
    assert.ok(count1>0&&count2>count1&&count2<data.events.find(e=>e.kind==='speech').text.length);
    checks.push('speech reveals characters progressively over elapsed time');
    await click('next');
    assert.equal(await evaluate('document.getElementById("speech-text").textContent'),data.events.find(e=>e.kind==='speech').text);
    await screenshot('검증 화면.png');
    await click('next');await sleep(80);await click('previous');await click('next');
    assert.equal(await evaluate('parseInt(document.getElementById("speech-count").textContent)'),1);
    checks.push('complete-current-speech, advance and previous controls');
    const longest=data.events.filter(e=>e.kind==='speech').sort((a,b)=>b.text.length-a.text.length)[0];
    await goToSpeech(longest.ordinal);await select('speed','20');await sleep(2200);
    for(let i=0;i<100;i++){if(await evaluate('document.getElementById("text-scroll").scrollTop>0'))break;await sleep(40);}
    const scrollState=await evaluate('({top:document.getElementById("text-scroll").scrollTop,height:document.getElementById("text-scroll").clientHeight,total:document.getElementById("text-scroll").scrollHeight,chars:document.getElementById("speech-text").textContent.length,state:document.getElementById("speech-state").textContent})');
    assert.ok(scrollState.chars>20&&scrollState.chars<longest.text.length);assert.ok(scrollState.top>0&&scrollState.total>scrollState.height);
    await click('next');
    const finishedScroll=await evaluate('({top:document.getElementById("text-scroll").scrollTop,height:document.getElementById("text-scroll").clientHeight,total:document.getElementById("text-scroll").scrollHeight,text:document.getElementById("speech-text").textContent})');
    assert.equal(finishedScroll.text,longest.text);assert.ok(finishedScroll.total>finishedScroll.height);assert.ok(finishedScroll.top>0);
    await screenshot('긴 대사 검증 화면.png');
    const rect=await evaluate('(()=>{const r=document.getElementById("text-scroll").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:rect.x,y:rect.y,deltaX:0,deltaY:-300});await sleep(150);
    assert.equal(await evaluate('document.getElementById("follow").hidden'),false);
    await click('follow');await sleep(100);
    assert.ok(await evaluate('document.getElementById("text-scroll").scrollTop>0'));
    checks.push('long speech remains complete in a scrolling panel; upward scroll and return-to-latest work');
    await select('chapter-select','fight');
    assert.equal(await evaluate('document.getElementById("deol").classList.contains("fight-left")'),true);
    await select('chapter-select','travel');await click('auto');await click('next');await sleep(1600);
    assert.equal(await evaluate('parseInt(document.getElementById("speech-count").textContent)'),71);
    await click('auto');checks.push('chapter changes and automatic progression');
    await click('restart');
    const traversal=await evaluate(`(()=>{const out=[];for(let i=0;i<350;i++){if(document.getElementById('next').disabled)break;const d=document.getElementById('dialogue');if(!d.classList.contains('is-hidden')){if(document.getElementById('speech-state').textContent==='대사 중')document.getElementById('next').click();out.push({speaker:document.getElementById('speaker').textContent,text:document.getElementById('speech-text').textContent,ordinal:parseInt(document.getElementById('speech-count').textContent)});}document.getElementById('next').click();}return out;})()`);
    assert.deepEqual(traversal,data.events.filter(e=>e.kind==='speech').map(e=>({speaker:e.speaker,text:e.text,ordinal:e.ordinal})));
    assert.equal(await evaluate('document.querySelector("#opening h2").textContent'),'막이 내렸습니다');
    checks.push('all 90 source speeches in order, complete staging transitions and ending');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await goToSpeech(longest.ordinal);await click('next');await sleep(1200);
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
    const mobile=await evaluate('({stage:document.getElementById("stage").getBoundingClientRect().bottom,dialogue:document.getElementById("dialogue").getBoundingClientRect().top,scroll:document.getElementById("text-scroll").scrollHeight>document.getElementById("text-scroll").clientHeight})');
    assert.ok(mobile.dialogue>=mobile.stage-1);assert.equal(mobile.scroll,true);
    await screenshot('모바일 검증 화면.png');checks.push('390px mobile layout, full dialogue, scroll and no horizontal overflow');
    assert.deepEqual(errors,[]);checks.push('no JavaScript runtime exceptions');
    const result={verifiedAt:new Date().toISOString(),browser:version.product,mode:'file',sourceSha256:data.sourceSha256,speeches:data.speechCount,events:data.events.length,checks,errors};
    fs.writeFileSync(path.join(__dirname,'브라우저 검증.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
  } finally {
    if(socket?.readyState===1){await send('Browser.close',{},true).catch(()=>{});socket.close();}
    browser.kill();for(const item of pending.values())clearTimeout(item.timer);
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
