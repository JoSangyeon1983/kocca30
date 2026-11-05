import { MemoryTrial, makeSequence, validateSettings } from './engine.mjs';
import { LocalSettingsStore, downloadJson } from './storage.mjs';

const $ = id => document.getElementById(id);
const labels = { up: '상', down: '하', left: '좌', right: '우', front: '정면' };
const symbols = { up: '↑', down: '↓', left: '←', right: '→' };
const angles = { up: -90, down: 90, left: 180, right: 0 };
const imageStates = { default: 'default', current: 'cur', success: 'success', failure: 'failure' };
const phaseLabels = { idle: '대기', memorize: '암기', input: '입력', complete: '완료' };
const settingsKeys = ['noteHoldSeconds', 'noteGapSeconds'];
const trial = new MemoryTrial();
const settingsStore = new LocalSettingsStore();
let ready = false, starting = false, lastSequence = null;
let saveTimer, saveTail = Promise.resolve(), rendered = '', lastResult = null;
let formRevision = 0, trialDate = '', runSettings;
const heldKeys = new Set();

const noteElements = Array.from({ length: 4 }, (_, index) => {
  const note = document.createElement('div');
  note.className = 'note';
  note.dataset.state = 'default';
  note.innerHTML = `<img class="note-disc" src="resources/note_default.png" alt="" draggable="false"><span class="note-number">${index + 1}</span><img class="note-arrow" alt="" draggable="false" hidden><span class="note-question" hidden>?</span><span class="note-timer" hidden></span>`;
  $('notes').append(note);
  return { node: note, disc: note.querySelector('.note-disc'), arrow: note.querySelector('.note-arrow'),
    question: note.querySelector('.note-question'), timer: note.querySelector('.note-timer') };
});

function status(message, error = false) {
  $('save-status').textContent = message;
  $('save-status').classList.toggle('error', error);
}

function formSettings() {
  return validateSettings(Object.fromEntries(settingsKeys.map(key => [key, $(key).valueAsNumber])));
}

function putSettings(settings) {
  for (const key of settingsKeys) $(key).value = settings[key];
  formRevision++;
  formIsValid();
}

function formIsValid() {
  try {
    formSettings();
    return true;
  } catch {
    return false;
  }
}

function controls() {
  const running = starting || ['memorize', 'input'].includes(trial.phase);
  const valid = formIsValid();
  settingsKeys.forEach(key => { $(key).disabled = running || !ready; });
  for (const id of ['save', 'reload']) $(id).disabled = running || !ready;
  $('start').disabled = running || !ready || !valid;
  $('replay').disabled = running || !ready || !valid || !lastSequence;
  $('reset').disabled = starting || !ready;
  $('export-result').disabled = !lastResult;
}

function saveSettings() {
  clearTimeout(saveTimer);
  const revision = formRevision;
  let value;
  try { value = formSettings(); }
  catch (error) { status(error.message, true); return Promise.reject(error); }
  status('설정값을 저장하는 중입니다.');
  const promise = saveTail.catch(() => {}).then(() => settingsStore.save(value));
  saveTail = promise;
  return promise.then(data => {
    if (revision === formRevision) status(data.fileSaved ? `${settingsStore.handle.name} 저장 완료.` :
      data.cached ? '브라우저에 저장 완료. JSON 연결 시 파일에도 저장됩니다.' : '현재 화면에 적용했습니다. JSON 저장으로 파일을 보관해 주세요.');
    return data.settings;
  }, error => {
    status(error.message, true);
    throw error;
  });
}

for (const key of settingsKeys) {
  $(key).addEventListener('input', () => {
    formRevision++;
    clearTimeout(saveTimer);
    controls();
    if (formIsValid()) {
      status('변경된 설정을 저장합니다.');
      saveTimer = setTimeout(() => saveSettings().catch(() => {}), 450);
    } else {
      try { formSettings(); } catch (error) { status(error.message, true); }
    }
  });
}

$('settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const value = formSettings();
    if (typeof showSaveFilePicker === 'function') {
      await settingsStore.prepareSave();
      await saveSettings();
    } else {
      await saveSettings();
      downloadJson(value, '설정.json');
      status('설정 JSON을 다운로드했습니다.');
    }
  } catch (error) {
    if (['SecurityError', 'NotSupportedError'].includes(error.name)) {
      downloadJson(formSettings(), '설정.json');
      status('설정 JSON을 다운로드했습니다.');
    } else if (error.name !== 'AbortError') status(error.message, true);
  }
});
$('reload').addEventListener('click', async () => {
  clearTimeout(saveTimer);
  if (typeof showOpenFilePicker !== 'function') { $('settings-file').click(); return; }
  try {
    await saveTail.catch(() => {});
    const data = await settingsStore.connect();
    putSettings(data.settings);
    status(data.writable ? `${settingsStore.handle.name} 연결 완료. 변경값을 파일에 자동 저장합니다.` :
      'JSON을 읽었습니다. 파일에 저장하려면 JSON 저장을 눌러 주세요.');
  } catch (error) {
    if (['SecurityError', 'NotSupportedError'].includes(error.name)) $('settings-file').click();
    else if (error.name !== 'AbortError') status(error.message, true);
  }
  controls();
});
$('settings-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const settings = validateSettings(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
    putSettings(settings); settingsStore.cache(settings);
    status(`${file.name} 불러오기 완료. JSON 저장은 파일 다운로드로 진행합니다.`);
  } catch (error) { status(error.message, true); }
  event.target.value = '';
  controls();
});

async function start(replay) {
  if (starting || !ready || ['memorize', 'input'].includes(trial.phase)) return;
  starting = true;
  controls();
  try {
    runSettings = await saveSettings();
    const sequence = replay && lastSequence ? [...lastSequence] : makeSequence();
    lastSequence = [...sequence];
    lastResult = null;
    trialDate = new Date().toISOString();
    $('result-panel').hidden = true;
    $('notice').textContent = '입력하면 즉시 판정합니다. 다음 노트는 유지 시간과 간격이 모두 끝난 뒤 시작합니다.';
    // The stage receives focus so numbers no longer edit a settings field.
    $('stage').focus({ preventScroll: true });
    trial.start(runSettings, sequence, performance.now());
    rendered = '';
  } catch (error) { status(error.message, true); }
  finally { starting = false; controls(); render(performance.now()); }
}

$('start').addEventListener('click', () => start(false));
$('replay').addEventListener('click', () => start(true));
function reset(message) {
  trial.reset();
  heldKeys.clear();
  document.querySelectorAll('.direction-key').forEach(node => node.classList.remove('pressed'));
  lastResult = null;
  $('result-panel').hidden = true;
  rendered = '';
  if (message) $('notice').textContent = message;
  controls();
  render(performance.now());
}
$('reset').addEventListener('click', () => reset('시험을 초기화했습니다. 저장된 시간 설정과 재시험할 순서는 유지됩니다.'));

function renderResults() {
  lastResult = { startedAt: trialDate, settings: runSettings,
    sequence: [...trial.sequence], results: trial.results.map(item => ({ ...item })),
    events: trial.events.map(item => ({ ...item })) };
  const successes = trial.results.filter(result => result.state === 'success').length;
  $('result-title').textContent = `${successes}개 성공 / 4개`;
  $('result-subtitle').textContent = '실패 노트의 화살표는 정답 방향입니다. 입력한 방향은 아래에서 확인하세요.';
  $('result-rows').replaceChildren(...trial.results.map(result => {
    const row = document.createElement('tr');
    const texts = [String(result.index), `${symbols[result.expected]} ${labels[result.expected]}`,
      result.actual ? `${symbols[result.actual]} ${labels[result.actual]}` : '입력 없음',
      result.reason === 'timeout' ? '실패 (시간 초과)' : result.state === 'success' ? '성공' : '실패 (방향 오류)',
      `${(result.responseMs / 1000).toFixed(3)}초`];
    texts.forEach((text, index) => {
      const cell = document.createElement('td'); cell.textContent = text;
      if (index === 3) cell.className = `${result.state}-text`;
      row.append(cell);
    });
    return row;
  }));
  $('result-panel').hidden = false;
  controls();
}

function render(now) {
  const signature = JSON.stringify([trial.phase, trial.index, trial.accepting, trial.inputStage, trial.face, trial.notes]);
  if (signature !== rendered) {
    rendered = signature;
    $('stage').dataset.phase = trial.phase;
    $('phase-label').textContent = phaseLabels[trial.phase];
    document.querySelectorAll('[data-phase]').forEach(node => {
      if (node.tagName === 'SPAN') node.classList.toggle('active', node.dataset.phase === (trial.phase === 'complete' ? 'input' : trial.phase));
    });
    $('omtal').src = `resources/omtal_${trial.face}.png`;
    $('omtal').alt = `${labels[trial.face]} 방향을 보는 옴탈`;
    noteElements.forEach((element, index) => {
      const value = trial.notes[index], asset = imageStates[value.state];
      element.node.dataset.state = value.state;
      element.node.setAttribute('aria-label', `${index + 1}번 노트: ${value.state}${value.direction ? ` ${labels[value.direction]}` : ''}`);
      element.disc.src = `resources/note_${asset}.png`;
      element.arrow.hidden = !value.direction;
      if (value.direction) {
        element.arrow.src = `resources/arrow_${asset}.png`;
        element.arrow.style.transform = `rotate(${angles[value.direction]}deg)`;
      }
      const currentInput = trial.phase === 'input' && trial.inputStage === 'hold' && trial.index === index;
      element.question.hidden = !currentInput || value.state !== 'current';
      element.timer.hidden = !currentInput;
    });
    $('progress').textContent = trial.phase === 'idle' ? '시작 준비' : trial.phase === 'complete' ? '시험 완료' : `${trial.index + 1} / 4`;
    $('instruction').textContent = trial.phase === 'idle' ? '옴탈의 고개 움직임을 잘 기억해두게나!' :
      trial.phase === 'memorize' ? '고개 방향과 순서를 기억해 주세요.' :
      trial.phase === 'complete' ? '네 번의 입력이 모두 끝났습니다.' : '기억한 방향을 순서대로 입력해 주세요.';
    $('stage-message').textContent = trial.phase === 'idle' ? '왼쪽의 시작 버튼을 눌러 주세요.' :
      trial.phase === 'memorize' ? (trial.memoryVisible ? `${trial.index + 1}번째 방향` : '다음 박을 기다려 주세요.') :
      trial.phase === 'complete' ? `성공 ${trial.results.filter(result => result.state === 'success').length}개, 실패 ${trial.results.filter(result => result.state === 'failure').length}개` :
      trial.inputStage === 'gap' ? '노트 사이 간격입니다. 다음 노트를 준비해 주세요.' :
      trial.accepting ? `${trial.index + 1}번째 방향을 입력하세요.` : '판정 완료. 유지 시간이 끝나면 노트 사이 간격이 시작됩니다.';
    $('input-status').textContent = trial.phase === 'input' ?
      (trial.inputStage === 'gap' ? '다음 노트 준비' : trial.accepting ? '지금 입력하세요' : '판정 결과 표시 중') : '입력 단계에서 활성화';
    if (trial.phase === 'complete') renderResults();
  }
  if (trial.phase === 'input' && trial.inputStage === 'hold') noteElements[trial.index].timer.textContent = `${trial.remaining(now).toFixed(1)}초`;
}

window.addEventListener('keydown', event => {
  const match = /^(?:Numpad|Digit)([1-4])$/.exec(event.code);
  if (!match || event.ctrlKey || event.altKey || event.metaKey ||
      event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  event.preventDefault();
  if (event.repeat || heldKeys.has(event.code)) return;
  heldKeys.add(event.code);
  const direction = ['up', 'down', 'left', 'right'][Number(match[1]) - 1];
  document.querySelector(`[data-direction="${direction}"]`).classList.add('pressed');
  trial.input(direction, performance.now());
  render(performance.now());
});
window.addEventListener('keyup', event => {
  heldKeys.delete(event.code);
  const match = /^(?:Numpad|Digit)([1-4])$/.exec(event.code);
  if (match) document.querySelector(`[data-direction="${['up', 'down', 'left', 'right'][Number(match[1]) - 1]}"]`).classList.remove('pressed');
});
window.addEventListener('blur', () => {
  heldKeys.clear();
  document.querySelectorAll('.direction-key').forEach(node => node.classList.remove('pressed'));
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && ['memorize', 'input'].includes(trial.phase)) {
    reset('화면을 벗어나 시험을 중단했습니다. 동일한 조건으로 다시 시작해 주세요.');
  }
});

$('export-result').addEventListener('click', () => {
  if (!lastResult) return;
  const filename = '시험 ' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  downloadJson(lastResult, filename);
  $('notice').textContent = `시험 기록 저장 완료: ${filename}`;
});

async function initialize() {
  controls();
  try {
    const initial = JSON.parse($('initial-settings').textContent);
    putSettings(settingsStore.cached(initial));
    const names = ['background', ...['front', 'up', 'down', 'left', 'right'].map(face => `omtal_${face}`),
      ...['default', 'cur', 'success', 'failure'].flatMap(state => [`note_${state}`, `arrow_${state}`])];
    await Promise.all(names.map(name => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = resolve;
      image.onerror = () => reject(new Error(`이미지를 읽을 수 없습니다: ${name}.png`));
      image.src = `resources/${name}.png`;
    })));
    const restored = await settingsStore.restore();
    if (restored) putSettings(restored);
    ready = true;
    status(restored ? `${settingsStore.handle.name} 자동 불러오기 완료.` : '설정 준비 완료. JSON 연결 없이도 바로 시작할 수 있습니다.');
    controls();
  } catch (error) { status(error.message, true); }
}

function frame(now) { trial.advance(now); render(now); requestAnimationFrame(frame); }
window.addEventListener('pagehide', () => {
  clearTimeout(saveTimer);
  try { settingsStore.cache(formSettings()); } catch {}
});
requestAnimationFrame(frame);
initialize();
