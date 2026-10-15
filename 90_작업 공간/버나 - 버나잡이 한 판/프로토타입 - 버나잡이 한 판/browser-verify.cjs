'use strict';
// Isolated headless Edge smoke test. Does not connect to the user's browser profile.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'beona-browser-'));
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding', 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
let socket;
const pending = new Map();
let nextId = 0;
const errors = [];
const checks = [];
let sessionId;
function send(method, params = {}, browserLevel = false) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 12000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(!browserLevel && sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function values() {
  return evaluate('({rod:parseFloat(document.getElementById("rod-angle").textContent),tilt:parseFloat(document.getElementById("beona-angle").textContent),contact:document.getElementById("contact").textContent,mode:document.getElementById("mode").textContent})');
}
async function slider(value) {
  await evaluate('document.getElementById("rod-test").value=' + value + ';document.getElementById("rod-test").dispatchEvent(new Event("input",{bubbles:true}));document.activeElement.blur();');
}
async function key(code, keyValue, down = true) {
  await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key: keyValue, windowsVirtualKeyCode: code === 'Space' ? 32 : keyValue.toUpperCase().charCodeAt(0) });
}
async function run() {
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; !fs.existsSync(portFile) && i < 100; i++) await sleep(100);
    const [port, endpoint] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    socket = new WebSocket('ws://127.0.0.1:' + port + endpoint);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
      if (!message.id) return;
      const request = pending.get(message.id); if (!request) return;
      clearTimeout(request.timeout); pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
    });
    const version = await send('Browser.getVersion', {}, true);
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, true);
    sessionId = (await send('Target.attachToTarget', { targetId, flatten: true }, true)).sessionId;
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(path.join(__dirname, '버나잡이 한 판.html')).href });
    for (let i = 0; i < 60; i++) {
      if (await evaluate('document.readyState === "complete" && document.getElementById("object-select")?.options.length === 3')) break;
      await sleep(100);
    }
    assert.equal(await evaluate('document.getElementById("object-select").options.length'), 3);
    checks.push('file URL loads all three JSON objects');
    await key('KeyS', 's'); await sleep(220); await key('KeyS', 's', false); await sleep(50);
    const afterRight = await values(); assert.ok(afterRight.rod > 1 && afterRight.rod < 15);
    await key('KeyA', 'a'); await sleep(100); await key('KeyA', 'a', false); await sleep(50);
    assert.ok((await values()).rod < afterRight.rod); checks.push('A and S keyboard tilt controls');
    await slider(16); await sleep(300); const growing = await values(); assert.equal(growing.mode, '증가'); assert.ok(growing.tilt > 5);
    await slider(12); await sleep(80); const held = await values(); await sleep(100); assert.equal((await values()).tilt, held.tilt);
    checks.push('increase and hold visible in browser');
    await key('Space', ' '); await key('Space', ' ', false); await sleep(80); const airborne = await values();
    assert.equal(airborne.contact, '공중'); assert.ok(airborne.tilt < held.tilt); checks.push('Space launches and restores in air');
    await slider(0); await sleep(1150); assert.equal((await values()).contact, '접촉 중');
    await slider(-20); await sleep(100); assert.equal((await values()).contact, '낙하 중');
    await sleep(1100); const restarted = await values(); assert.equal(restarted.rod, 0); assert.equal(restarted.tilt, 0);
    checks.push('left threshold triggers fall and automatic restart');
    await evaluate('document.getElementById("object-select").value="1";document.getElementById("object-select").dispatchEvent(new Event("change"));');
    assert.equal(await evaluate('document.getElementById("restore").value'), '8');
    await evaluate('document.getElementById("restore").value="13";document.getElementById("settings-form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));');
    assert.ok((await evaluate('document.getElementById("error").textContent')).length > 0);
    await evaluate('document.getElementById("restore").value="7";document.getElementById("settings-form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));');
    assert.equal(await evaluate('document.getElementById("error").textContent'), ''); checks.push('object selection and setting validation');
    await evaluate('document.getElementById("object-select").value="0";document.getElementById("object-select").dispatchEvent(new Event("change"));');
    await sleep(100);
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, '검증 화면.png'), Buffer.from(screenshot.data, 'base64'));
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1')); checks.push('390px viewport has no horizontal overflow');
    assert.deepEqual(errors, []); checks.push('no JavaScript runtime exceptions');
    const result = { browser: version.product, protocol: version.protocolVersion, urlMode: 'file', checks, errors, screenshot: '검증 화면.png' };
    fs.writeFileSync(path.join(__dirname, '브라우저 검증.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (socket?.readyState === 1) { await send('Browser.close', {}, true).catch(() => {}); socket.close(); }
    browser.kill();
    for (const item of pending.values()) clearTimeout(item.timeout);
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
