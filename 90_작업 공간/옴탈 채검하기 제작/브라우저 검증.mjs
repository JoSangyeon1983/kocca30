import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(sourceRoot, '..', '옴탈 채검하기 시간 테스트'));
const output = path.join(sourceRoot, '검증'); fs.mkdirSync(output, { recursive: true });
assert.deepEqual(fs.readdirSync(root).sort(), ['index.html','resources','설정.json'].sort());
const downloads = fs.mkdtempSync(path.join(output, '직접 실행 다운로드 '));
const originalSettings = fs.readFileSync(path.join(root, '설정.json'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'omtal-offline-'));
const errors = [], requests = [], checks = [], pending = new Map();
let browser, socket, sessionId, nextId = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function send(method, params = {}, top = false) {
  return new Promise((resolve, reject) => {
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timeout')); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(!top && sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(20); }
  throw new Error('Condition timed out: ' + expression);
}
async function click(id) { await evaluate(`document.getElementById(${JSON.stringify(id)}).click()`); }
async function setSettings(settings) {
  await evaluate(`(()=>{for(const [key,value] of Object.entries(${JSON.stringify(settings)})){const input=document.getElementById(key);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  await until(`document.getElementById('save-status').textContent.includes('저장 완료')`);
}
async function ready() { await until(`document.getElementById('start')&&!document.getElementById('start').disabled`); }
async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
}
async function press(number, repeat = false) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: String(number), code: `Numpad${number}`, windowsVirtualKeyCode: 96 + number, nativeVirtualKeyCode: 96 + number, location: 3, autoRepeat: repeat });
}
async function release(number) {
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: String(number), code: `Numpad${number}`, windowsVirtualKeyCode: 96 + number, nativeVirtualKeyCode: 96 + number, location: 3 });
}
async function downloadFile(prefix) {
  for (let index = 0; index < 100; index++) {
    const name = fs.readdirSync(downloads).find(name => name.startsWith(prefix) && name.endsWith('.json'));
    if (name) return JSON.parse(fs.readFileSync(path.join(downloads, name), 'utf8'));
    await sleep(40);
  }
  throw new Error('Download did not finish: ' + prefix);
}

try {
  const executable = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file => fs.existsSync(file));
  assert(executable);
  browser = spawn(executable, ['--headless=new','--disable-gpu','--remote-debugging-port=0','--user-data-dir=' + profile,
    '--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-background-timer-throttling','--disable-renderer-backgrounding','about:blank'], { windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let index = 0; index < 100 && !fs.existsSync(portFile); index++) await sleep(100);
  const [port, endpoint] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    const item = pending.get(message.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
  });
  const version = await send('Browser.getVersion', {}, true);
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }, true);
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, true);
  sessionId = (await send('Target.attachToTarget', { targetId, flatten: true }, true)).sessionId;
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['http://*','https://*','ws://*','wss://*'] });
  await send('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(path.join(root, 'index.html')).href });
  await ready();
  assert.equal(await evaluate('location.protocol'), 'file:');
  assert.equal(await evaluate(`document.querySelector('script[type="module"]')===null&&document.getElementById('shutdown')===null`), true);
  assert.equal(await evaluate(`Array.from(document.images).filter(image=>!image.hidden).every(image=>image.complete&&image.naturalWidth>0)`), true);
  checks.push('Only HTML, settings JSON and resources are present; direct file URL starts with all assets loaded and no server or module dependency');
  await screenshot('09 서버 없는 직접 실행');

  const changed = { noteHoldSeconds: .6, noteGapSeconds: .2 };
  await setSettings(changed);
  await send('Page.reload'); await ready();
  assert.deepEqual(await evaluate(`({noteHoldSeconds:document.getElementById('noteHoldSeconds').valueAsNumber,noteGapSeconds:document.getElementById('noteGapSeconds').valueAsNumber})`), changed);
  checks.push('Browser settings automatically persist across a reload without a file connection');

  // Exercise the actual local-file input fallback, with the user-provided JSON.
  await evaluate('window.showOpenFilePicker=undefined;window.showSaveFilePicker=undefined');
  await send('Page.setInterceptFileChooserDialog', { enabled: true });
  await click('reload');
  const { root: documentRoot } = await send('DOM.getDocument');
  const { nodeId } = await send('DOM.querySelector', { nodeId: documentRoot.nodeId, selector: '#settings-file' });
  await send('DOM.setFileInputFiles', { nodeId, files: [path.join(root, '설정.json')] });
  await until(`document.getElementById('save-status').textContent.includes('불러오기 완료')`);
  const actualSettings = JSON.parse(originalSettings.toString('utf8'));
  assert.deepEqual(await evaluate(`({noteHoldSeconds:document.getElementById('noteHoldSeconds').valueAsNumber,noteGapSeconds:document.getElementById('noteGapSeconds').valueAsNumber})`), actualSettings);
  await click('save');
  assert.deepEqual(await downloadFile('설정'), actualSettings);
  checks.push('Actual adjacent JSON loads through the file input and saves as a real JSON download');

  await send('Page.reload'); await ready();
  const features = await evaluate(`({secure:isSecureContext,openPicker:typeof showOpenFilePicker==='function',savePicker:typeof showSaveFilePicker==='function',opfs:!!navigator.storage?.getDirectory})`);
  let linkedFileVerified = false;
  if (features.opfs) {
    const accessible = await evaluate(`(async()=>{try{const directory=await navigator.storage.getDirectory();window.testHandle=await directory.getFileHandle('설정.json',{create:true});const stream=await testHandle.createWritable();await stream.write(JSON.stringify({noteHoldSeconds:.9,noteGapSeconds:.3}));await stream.close();return true;}catch(error){return error.name+': '+error.message;}})()`);
    if (accessible === true) {
      // Only the picker is substituted; the returned handle, file writes and IndexedDB are real browser APIs.
      await evaluate('window.showOpenFilePicker=async()=>[window.testHandle]');
      await click('reload'); await until(`document.getElementById('save-status').textContent.includes('연결 완료')`);
      await setSettings({ noteHoldSeconds: .5, noteGapSeconds: .25 });
      assert.deepEqual(await evaluate(`(async()=>JSON.parse(await(await testHandle.getFile()).text()))()`), { noteHoldSeconds: .5, noteGapSeconds: .25 });
      await send('Page.reload'); await ready();
      assert.equal(await evaluate(`document.getElementById('noteHoldSeconds').valueAsNumber`), .5);
      assert.equal(await evaluate(`document.getElementById('save-status').textContent.includes('자동 불러오기 완료')`), true);
      linkedFileVerified = true;
      checks.push('Real browser file handle autosaves changes and restores its handle and JSON through IndexedDB after reload (picker substituted with an OPFS handle)');
    } else features.opfsError = accessible;
  }
  if (!linkedFileVerified) {
    await evaluate(`(()=>{window.testJson={noteHoldSeconds:.9,noteGapSeconds:.3};window.testHandle={kind:'file',name:'연결 시험.json',queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',getFile:async()=>new File([JSON.stringify(window.testJson)],'연결 시험.json'),createWritable:async()=>({write:async text=>{window.testJson=JSON.parse(text);},close:async()=>{},abort:async()=>{}})};window.showOpenFilePicker=async()=>[window.testHandle];})()`);
    await click('reload'); await until(`document.getElementById('save-status').textContent.includes('연결 완료')`);
    await setSettings({noteHoldSeconds:.5,noteGapSeconds:.25});
    assert.deepEqual(await evaluate('window.testJson'),{noteHoldSeconds:.5,noteGapSeconds:.25});
    checks.push('Connected-file autosave logic verified with a test handle; native OS file selection and persistent real handles are not covered by this headless run');
  }

  await setSettings(changed);
  await evaluate(`(()=>{const values=[0,.34,.9,.34];let index=0;Math.random=()=>values[index++%4];})()`);
  await click('start'); await until(`document.getElementById('stage').dataset.phase==='input'`);
  for (const [index, number] of [1,3,4,2].entries()) {
    await until(`document.querySelectorAll('.note')[${index}].dataset.state==='current'`);
    if (index % 2) await sleep(350);
    await press(number); await release(number);
    assert.equal(await evaluate(`document.querySelectorAll('.note')[${index}].dataset.state`), 'success');
  }
  await until(`document.getElementById('stage').dataset.phase==='complete'`);
  assert.equal(await evaluate(`document.querySelectorAll('.note[data-state="success"]').length`), 4);
  checks.push('Direct-open HTML accepts Numpad 1-4 and reveals success immediately for early and late responses');
  await click('reset'); await setSettings({ noteHoldSeconds: 1, noteGapSeconds: .25 });
  await evaluate(`(()=>{const values=[0,.34,.9,.34];let index=0;Math.random=()=>values[index++%4];})()`);
  await click('start'); await until(`document.getElementById('stage').dataset.phase==='input'`);
  await press(2); await press(2, true);
  assert.equal(await evaluate(`document.querySelectorAll('.note[data-state="failure"]').length`), 1);
  await screenshot('10 직접 실행 즉시 판정');
  await until(`document.querySelectorAll('.note')[1].dataset.state==='current'`);
  await press(2, true); await release(2);
  await until(`document.getElementById('stage').dataset.phase==='complete'`);
  assert.equal(await evaluate(`document.querySelectorAll('.note[data-state="failure"]').length`), 4);
  await click('export-result');
  const result = await downloadFile('시험 ');
  assert.deepEqual(result.events.filter(event=>event.kind==='input_open').map(event=>event.plannedMs), [5000,6250,7500,8750]);
  assert.deepEqual(result.events.filter(event=>event.kind==='gap_start').map(event=>event.plannedMs), [6000,7250,8500,9750]);
  assert.equal(result.events.at(-1).plannedMs, 10000);
  assert.equal(result.results.filter(item=>item.reason==='timeout').length, 3);
  checks.push('Wrong input, timeouts, held keys, fixed hold ends and next onsets work; result JSON downloads without a server');
  await click('reset');
  const layouts=[];
  for (const [width,height] of [[1920,1080],[1365,768],[390,844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:1,mobile:false }); await sleep(60);
    const layout=await evaluate(`({width:innerWidth,documentWidth:document.documentElement.scrollWidth,startBottom:document.getElementById('start').getBoundingClientRect().bottom})`);
    assert(layout.documentWidth<=width+1);
    if(width>1000) assert(layout.startBottom<=height);
    layouts.push(layout);
  }
  checks.push('Desktop and narrow layouts have no horizontal overflow');
  assert.deepEqual(requests.filter(url=>/^(https?|wss?):/i.test(url)), []);
  assert.deepEqual(fs.readFileSync(path.join(root,'설정.json')), originalSettings);
  assert.deepEqual(fs.readdirSync(root).sort(), ['index.html','resources','설정.json'].sort());
  assert.deepEqual(errors, []);
  checks.push('No HTTP or WebSocket requests, no runtime errors and no modification of the original settings JSON');
  await send('Page.reload'); await ready();
  const probe=await send('Runtime.evaluate',{expression:`Promise.race([showOpenFilePicker({multiple:false}).then(()=> 'selected',error=>error.name+': '+error.message),new Promise(resolve=>setTimeout(()=>resolve('picker waiting'),500))])`,returnByValue:true,awaitPromise:true,userGesture:true});
  features.nativePickerProbe=probe.result?.value??probe.exceptionDetails?.text;
  const report={browser:version.product,protocol:'file:',checks,features,linkedFileVerified,layouts,errors,httpRequests:[]};
  fs.writeFileSync(path.join(output,'서버 없는 검증 결과.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {
  if(socket?.readyState===WebSocket.OPEN){try{await send('Browser.close',{},true);}catch{}socket.close();}
  browser?.kill();
}
