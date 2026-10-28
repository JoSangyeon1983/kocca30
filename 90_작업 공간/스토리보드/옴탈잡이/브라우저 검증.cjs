'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const {pathToFileURL} = require('node:url');
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const context = {window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'극 진행 데이터.js'),'utf8'),context);
const data = JSON.parse(JSON.stringify(context.window.PLAY_DATA));
const source = fs.readFileSync(path.join(__dirname,'..',data.source));
assert.equal(crypto.createHash('sha256').update(source).digest('hex'),data.sourceSha256);
const extracted = source.toString('utf8').split(/\r?\n/).flatMap((line,i) => {
  const match = line.match(/^\s+(?:- |\d+\. )(꺽쇠|옴탈|장쇠): (.+)/);
  return match ? [{speaker:match[1],text:match[2].trim(),sourceLine:i+1}] : [];
});
assert.deepEqual(data.events.filter(event=>event.kind==='speech').map(({speaker,text,sourceLine})=>({speaker,text,sourceLine})),extracted);
for (const item of data.assetInventory) {
  const raw = fs.readFileSync(path.join(__dirname,'이미지',item.name));
  assert.equal(raw.length,item.bytes); assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),item.sha256);
}
const checks = ['source hash, all 35 exact speeches, source lines and all 12 original image hashes'];
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'omtal-play-'));
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',[
  '--headless=new','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check',
  '--disable-background-networking','--disable-background-timer-throttling','--disable-renderer-backgrounding','about:blank'
],{windowsHide:true,stdio:'ignore'});
const pending = new Map(), errors = [];
let socket, sessionId, nextId = 0;
function send(method,params={},root=false) {
  return new Promise((resolve,reject) => {
    const id=++nextId, timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timeout'));},15000);
    pending.set(id,{resolve,reject,timer}); socket.send(JSON.stringify({id,method,params,...(!root&&sessionId?{sessionId}:{})}));
  });
}
async function evaluate(expression) {
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function click(id) { return evaluate(`document.getElementById(${JSON.stringify(id)}).click()`); }
async function checkIdleDialogue() {
  assert.equal(await evaluate(`(()=>{const e=document.getElementById('dialogue'),s=getComputedStyle(e);return e.classList.contains('is-hidden')&&s.display==='flex'&&s.visibility==='visible'&&s.opacity==='1'&&e.getBoundingClientRect().height>100&&getComputedStyle(e.firstElementChild).visibility==='hidden';})()`),true);
}
async function select(id,value) { return evaluate(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change',{bubbles:true}))`); }
async function goToEvent(id) {
  await click('restart');
  const reached=await evaluate(`(()=>{for(let i=0;i<200;i++){if(document.getElementById('stage').dataset.eventId===${JSON.stringify(id)})return true;document.getElementById('next').click();}return false;})()`);
  assert.equal(reached,true,id);
}
async function goToSpeech(ordinal) { await goToEvent(data.events.find(event=>event.ordinal===ordinal).id); }
async function screenshot(name) {
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'); await sleep(300);
  const shot=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(path.join(__dirname,name),Buffer.from(shot.data,'base64'));
}
async function main() {
  try {
    const portFile=path.join(profile,'DevToolsActivePort');
    for(let i=0;i<100&&!fs.existsSync(portFile);i++)await sleep(100);
    const [port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);
    socket=new WebSocket('ws://127.0.0.1:'+port+endpoint);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    socket.addEventListener('message',event=>{
      const message=JSON.parse(event.data);
      if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);
      const item=pending.get(message.id);if(!item)return;clearTimeout(item.timer);pending.delete(message.id);
      if(message.error)item.reject(new Error(JSON.stringify(message.error)));else item.resolve(message.result);
    });
    const version=await send('Browser.getVersion',{},true);
    const {targetId}=await send('Target.createTarget',{url:'about:blank'},true);
    sessionId=(await send('Target.attachToTarget',{targetId,flatten:true},true)).sessionId;
    await send('Runtime.enable');await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:960,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:pathToFileURL(path.join(__dirname,'극 진행 보기.html')).href});
    for(let i=0;i<80;i++){if(await evaluate('document.readyState==="complete"&&document.querySelectorAll("#chapter-select option").length===6'))break;await sleep(100);}
    await sleep(250);
    assert.equal(await evaluate('document.getElementById("load-error").hidden'),true);
    assert.equal(await evaluate('document.querySelectorAll("audio,video").length'),0);
    checks.push('file URL loads six chapters and local images');
    await checkIdleDialogue();
    await click('start');await sleep(1200);
    assert.equal(await evaluate('document.getElementById("stage").dataset.eventId'),data.events.find(event=>event.kind==='speech').id);
    const count1=await evaluate('document.getElementById("speech-text").textContent.length');await sleep(120);
    const count2=await evaluate('document.getElementById("speech-text").textContent.length');assert.ok(count1>0&&count2>count1);
    await click('next');assert.equal(await evaluate('document.getElementById("speech-text").textContent'),extracted[0].text);
    await click('next');await click('previous');await click('next');assert.equal(await evaluate('parseInt(document.getElementById("speech-count").textContent)'),1);
    checks.push('time-based typing, complete speech and previous controls');
    for(const chapter of data.chapters){await select('chapter-select',chapter.id);assert.equal(await evaluate('document.getElementById("stage").dataset.eventId'),data.events[chapter.start].id);}
    checks.push('all six chapter jumps restore full stage state');
    const peeks=data.events.filter(event=>['left','right'].includes(event.effect.peek));
    assert.deepEqual(peeks.map(event=>event.effect.peek),['left','right']);
    for(const event of peeks) {
      assert.equal(event.cast.omtal.visible,false);assert.equal(event.cast.omtal.x,-18);
      const side=event.effect.peek;
      await goToEvent(event.id);await sleep(650);
      await checkIdleDialogue();
      const bounds=await evaluate(`(()=>{const stage=document.getElementById('stage').getBoundingClientRect();const actor=document.getElementById('peek-${side}');const face=actor.querySelector('.peek-face').getBoundingClientRect();return{hidden:actor.hidden,otherHidden:document.getElementById('peek-${side==='left'?'right':'left'}').hidden,mainHidden:document.getElementById('omtal').getAttribute('aria-hidden'),x:(face.x+face.width/2-stage.x)/stage.width,intersects:face.right>stage.left&&face.left<stage.right,clip:getComputedStyle(actor.querySelector('img')).clipPath,asset:actor.querySelector('img').getAttribute('src'),opacity:getComputedStyle(actor).opacity};})()`);
      assert.equal(bounds.hidden,false);assert.equal(bounds.otherHidden,true);assert.equal(bounds.mainHidden,'true');assert.equal(bounds.intersects,true);assert.equal(bounds.opacity,'1');
      assert.ok(side==='left'?bounds.x<.15:bounds.x>.85);assert.equal(bounds.clip,'none');assert.equal(bounds.asset,'이미지/옴탈 서 있는 자세.png');
      await screenshot(side==='left'?'왼쪽 기웃거림 검증 화면.png':'오른쪽 기웃거림 검증 화면.png');
      await click('next');assert.equal(await evaluate('document.getElementById("peek-layer").hidden'),true);
      assert.equal(await evaluate('document.getElementById("omtal").getAttribute("aria-hidden")'),'true');
    }
    await goToEvent(peeks[0].id);await sleep(1950);
    assert.equal(await evaluate('getComputedStyle(document.getElementById("peek-left")).opacity'),'0');
    checks.push('each edge peeks once using the full uncut original image, fully hides before the other side and never moves the main actor across the stage');
    const chase=data.events.find(event=>event.kind==='stage'&&event.effect.demo==='chase');await goToEvent(chase.id);await sleep(250);
    const time1=Number(await evaluate('document.getElementById("clock-value").textContent'));await sleep(250);
    const time2=Number(await evaluate('document.getElementById("clock-value").textContent'));assert.ok(time1>time2);
    checks.push('stage countdown runs while dialogue waits for input');
    const chaseStages=data.events.filter(event=>event.kind==='stage'&&event.effect.demo==='chase');
    assert.deepEqual(chaseStages.map(event=>event.cast.omtal.visible),[true,false,true,false,true]);
    assert.deepEqual(chaseStages.filter(event=>event.cast.omtal.visible).map(event=>event.cast.omtal.x),[25,75,25]);
    assert.ok(data.events.filter(event=>event.chapter==='chase').every(event=>event.cast.kkeok.x===50&&event.cast.omtal.snap));
    await goToEvent(chaseStages[0].id);
    for(let i=0;i<chaseStages.length;i++) {
      const event=chaseStages[i],pose=event.cast.omtal;
      assert.equal(await evaluate('document.getElementById("stage").dataset.eventId'),event.id);
      for(let sample=0;sample<6;sample++) {
        const location=await evaluate(`(()=>{const stage=document.getElementById('stage').getBoundingClientRect();const k=document.getElementById('kkeok').getBoundingClientRect();const o=document.getElementById('omtal').getBoundingClientRect();return{k:(k.x+k.width/2-stage.x)/stage.width,o:(o.x+o.width/2-stage.x)/stage.width};})()`);
        assert.ok(Math.abs(location.k-.5)<.001);assert.ok(Math.abs(location.o-pose.x/100)<.001);await sleep(40);
      }
      if(!pose.visible)assert.equal(await evaluate('getComputedStyle(document.getElementById("omtal")).opacity'),'0');
      else {
        assert.equal(await evaluate('getComputedStyle(document.getElementById("omtal")).opacity'),'1');
        if(i<3)await screenshot(i===0?'쫓아내기 왼쪽 검증 화면.png':'쫓아내기 오른쪽 검증 화면.png');
      }
      if(i+1<chaseStages.length)await click('next');
    }
    checks.push('chase keeps Kkeoksoe centered, completely hides Omtal between appearances and snaps left/right without crossing the center at any sampled transition');
    const hat=data.events.find(event=>event.kind==='speech'&&event.effect.hat);await goToEvent(hat.id);
    assert.equal(await evaluate('document.getElementById("hat-target").hidden'),false);
    assert.equal(await evaluate('document.getElementById("kkeok").getAttribute("aria-hidden")'),'true');
    const shake=data.events.find(event=>event.kind==='speech'&&event.effect.coins);await goToEvent(shake.id);await click('next');await sleep(1050);
    assert.equal(await evaluate('document.getElementById("omtal").dataset.asset'),'옴탈_SD.png');
    assert.equal(await evaluate('document.getElementById("coins").hidden'),false);assert.equal(await evaluate('document.querySelectorAll(".coin").length'),10);
    const shake1=await evaluate('getComputedStyle(document.querySelector("#omtal .actor-motion")).transform');await sleep(100);
    assert.notEqual(await evaluate('getComputedStyle(document.querySelector("#omtal .actor-motion")).transform'),shake1);
    await screenshot('잡아채기 검증 화면.png');
    await click('previous');assert.equal(await evaluate('document.getElementById("omtal").dataset.asset'),'옴탈 서 있는 자세.png');assert.equal(await evaluate('document.getElementById("hat-target").hidden'),false);
    checks.push('hat cue, SD replacement, animated shaking and falling coins; previous restores normal form');
    const inspect=data.events.find(event=>event.kind==='speech'&&event.effect.face==='cycle');await goToEvent(inspect.id);await click('next');
    assert.equal(await evaluate('document.getElementById("inspection").hidden'),false);
    const poses=new Set([await evaluate('document.getElementById("inspection").dataset.pose')]);
    await sleep(850);poses.add(await evaluate('document.getElementById("inspection").dataset.pose'));await sleep(850);poses.add(await evaluate('document.getElementById("inspection").dataset.pose'));
    assert.equal(poses.size,3);await screenshot('채검 검증 화면.png');
    checks.push('three inspection images switch with arrows and hand gesture');
    const drive=data.events.find(event=>event.kind==='speech'&&event.effect.demo==='drive');await goToEvent(drive.id);await click('next');await sleep(1100);
    assert.equal(await evaluate('document.getElementById("inspection").hidden'),true);assert.equal(await evaluate('document.getElementById("masks").hidden'),false);
    const origins=await evaluate('[...document.querySelectorAll(".mask")].map(image=>image.dataset.origin)');assert.equal(new Set(origins).size,6);
    const mask1=await evaluate('document.querySelector(".mask").getBoundingClientRect().x');await sleep(120);assert.notEqual(await evaluate('document.querySelector(".mask").getBoundingClientRect().x'),mask1);
    await screenshot('몰아내기 검증 화면.png');checks.push('six mask origins, curved movement and hit effect');
    const longest=data.events.filter(event=>event.kind==='speech').sort((a,b)=>b.text.length-a.text.length)[0];
    await goToSpeech(longest.ordinal);await select('speed','20');
    for(let i=0;i<120;i++){if(await evaluate('document.getElementById("text-scroll").scrollTop>0'))break;await sleep(40);}
    const during=await evaluate('({top:document.getElementById("text-scroll").scrollTop,chars:document.getElementById("speech-text").textContent.length})');
    assert.ok(during.top>0&&during.chars<longest.text.length);await click('next');
    assert.equal(await evaluate('document.getElementById("speech-text").textContent'),longest.text);await screenshot('긴 대사 검증 화면.png');
    const rect=await evaluate('(()=>{const r=document.getElementById("text-scroll").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:rect.x,y:rect.y,deltaX:0,deltaY:-300});await sleep(150);
    assert.equal(await evaluate('document.getElementById("follow").hidden'),false);await click('follow');assert.ok(await evaluate('document.getElementById("text-scroll").scrollTop>0'));
    checks.push('long text scrolls during typing, stays complete and permits reading earlier lines');
    const autoSpeech=data.events.find(event=>event.ordinal===11);await goToEvent(autoSpeech.id);await click('auto');await click('next');await sleep(1500);
    assert.equal(await evaluate('document.getElementById("stage").dataset.eventId'),data.events[data.events.indexOf(autoSpeech)+1].id);await click('auto');
    checks.push('automatic dialogue advance');
    await click('restart');
    const traversal=await evaluate(`(()=>{const out=[];for(let i=0;i<200;i++){if(document.getElementById('next').disabled)break;if(!document.getElementById('dialogue').classList.contains('is-hidden')){if(document.getElementById('speech-state').textContent==='대사 중')document.getElementById('next').click();out.push({speaker:document.getElementById('speaker').textContent,text:document.getElementById('speech-text').textContent,ordinal:parseInt(document.getElementById('speech-count').textContent)});}document.getElementById('next').click();}return out;})()`);
    assert.deepEqual(traversal,data.events.filter(event=>event.kind==='speech').map(event=>({speaker:event.speaker,text:event.text,ordinal:event.ordinal})));
    assert.equal(await evaluate('document.querySelector("#opening h2").textContent'),'막이 내렸습니다');checks.push(`all ${data.speechCount} speeches and ${data.events.length-data.speechCount} staging events reach the ending without omissions`);
    await checkIdleDialogue();checks.push('empty dialogue frame remains visible before play, during silent staging and after ending');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await goToSpeech(longest.ordinal);await click('next');await sleep(1100);
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'));
    const mobile=await evaluate('({stage:document.getElementById("stage").getBoundingClientRect().bottom,dialogue:document.getElementById("dialogue").getBoundingClientRect().top,scroll:document.getElementById("text-scroll").scrollHeight>document.getElementById("text-scroll").clientHeight})');
    assert.ok(mobile.dialogue>=mobile.stage-1);assert.equal(mobile.scroll,true);await screenshot('모바일 검증 화면.png');
    checks.push('390px mobile layout, separate dialogue, scroll and no horizontal overflow');
    for(const event of peeks) {
      await goToEvent(event.id);await sleep(650);
      await checkIdleDialogue();
      const side=event.effect.peek;
      const x=await evaluate(`(()=>{const stage=document.getElementById('stage').getBoundingClientRect();const face=document.querySelector('#peek-${side} .peek-face').getBoundingClientRect();return(face.x+face.width/2-stage.x)/stage.width;})()`);
      assert.ok(side==='left'?x<.15:x>.85);
      await screenshot(side==='left'?'모바일 왼쪽 기웃거림 검증 화면.png':'모바일 오른쪽 기웃거림 검증 화면.png');
    }
    checks.push('left and right upper-body peeks stay at their respective edges on mobile');
    for(const event of chaseStages.filter(event=>event.cast.omtal.visible).slice(0,2)) {
      await goToEvent(event.id);await sleep(650);
      const center=await evaluate(`(()=>{const stage=document.getElementById('stage').getBoundingClientRect();const actor=document.getElementById('kkeok').getBoundingClientRect();return(actor.x+actor.width/2-stage.x)/stage.width;})()`);
      assert.ok(Math.abs(center-.5)<.001);
      await screenshot(event.cast.omtal.x<50?'모바일 쫓아내기 왼쪽 검증 화면.png':'모바일 쫓아내기 오른쪽 검증 화면.png');
    }
    checks.push('mobile chase keeps Kkeoksoe centered with Omtal appearing at either side');
    assert.deepEqual(errors,[]);checks.push('no JavaScript runtime exceptions');
    const result={verifiedAt:new Date().toISOString(),browser:version.product,mode:'file',sourceSha256:data.sourceSha256,speeches:data.speechCount,events:data.events.length,assets:data.assetInventory.length,checks,errors};
    fs.writeFileSync(path.join(__dirname,'브라우저 검증.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
  } finally {
    if(socket?.readyState===1){await send('Browser.close',{},true).catch(()=>{});socket.close();}
    browser.kill();for(const item of pending.values())clearTimeout(item.timer);
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
