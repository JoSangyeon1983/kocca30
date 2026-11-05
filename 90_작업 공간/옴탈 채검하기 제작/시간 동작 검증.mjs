import assert from 'node:assert/strict';
import { MemoryTrial, validateSettings, makeSequence, DEFAULT_SETTINGS } from './engine.mjs';

const sequence = ['up', 'down', 'left', 'right'];
const checks = [];
function check(name, fn) { fn(); checks.push(name); }
check('Hold followed by gap gives four fixed memory onsets and retains past arrows', () => {
  const trial = new MemoryTrial();
  trial.start(DEFAULT_SETTINGS, sequence, 100);
  assert.equal(trial.face, 'up');
  trial.advance(899); assert.equal(trial.notes[0].state, 'current');
  trial.advance(900); assert.equal(trial.face, 'front');
  assert.deepEqual(trial.notes[0], { state: 'default', direction: 'up' });
  trial.advance(1100); assert.equal(trial.face, 'down');
  trial.advance(3100); assert.equal(trial.face, 'right');
  trial.advance(4100); assert.equal(trial.phase, 'input');
  assert.equal(trial.accepting, true);
  assert(trial.notes.every(note => note.direction === null));
  assert.deepEqual(trial.events.filter(event => event.kind === 'memorize_on').map(event => event.plannedMs), [0, 1000, 2000, 3000]);
});
check('Early and late input judge immediately but keep the same hold end, gap start and next-note onset', () => {
  const trials = [4100, 4700].map(responseAt => {
    const trial = new MemoryTrial(); trial.start(DEFAULT_SETTINGS, sequence, 0); trial.advance(4000);
    assert.equal(trial.input('up', responseAt), true);
    assert.equal(trial.input('right', responseAt + 1), false);
    assert.equal(trial.results.length, 1);
    assert.deepEqual(trial.notes[0], { state: 'success', direction: 'up' });
    assert.equal(trial.nextAt, 4800);
    trial.advance(4799); assert.equal(trial.inputStage, 'hold');
    assert(trial.remaining(4799) > 0);
    trial.advance(4800); assert.equal(trial.notes[0].state, 'success');
    assert.equal(trial.inputStage, 'gap');
    assert.equal(trial.results.length, 1);
    trial.advance(4999); assert.equal(trial.index, 0);
    trial.advance(5000); assert.equal(trial.index, 1); assert.equal(trial.remaining(5000), .8);
    return trial;
  });
  assert.deepEqual(trials.map(trial => trial.events.find(event => event.kind === 'judgment').plannedMs), [4100, 4700]);
  assert.deepEqual(trials.map(trial => trial.events.find(event => event.kind === 'gap_start').plannedMs), [4800, 4800]);
  assert.deepEqual(trials.map(trial => trial.events.filter(event => event.kind === 'input_open').map(event => event.plannedMs)), [[4000,5000], [4000,5000]]);
  assert.deepEqual(trials.map(trial => trial.results[0].responseMs), [100,700]);
});
check('All correct responses judge once immediately and retain the full fourth hold and gap', () => {
  const trial = new MemoryTrial(); trial.start(DEFAULT_SETTINGS, sequence, 0); trial.advance(4000);
  for (let index = 0; index < 4; index++) {
    const openAt = 4000 + index * 1000;
    trial.advance(openAt);
    assert.equal(trial.input(sequence[index], openAt + 100), true);
    assert.equal(trial.results.length, index + 1);
    trial.advance(openAt + 800);
    assert.equal(trial.results.length, index + 1);
    assert.equal(trial.phase, 'input');
  }
  trial.advance(7999); assert.equal(trial.phase, 'input');
  trial.advance(8000); assert.equal(trial.phase, 'complete');
  assert.equal(trial.finishedAt, 8000);
  assert(trial.results.every(result => result.state === 'success' && result.responseMs === 100));
});
check('Wrong input immediately reveals the expected arrow without shortening the hold', () => {
  const trial = new MemoryTrial(); trial.start(DEFAULT_SETTINGS, sequence, 0); trial.advance(4000);
  trial.input('right', 4200);
  assert.equal(trial.results.length, 1);
  assert.equal(trial.notes[0].direction, 'up');
  trial.advance(4800);
  assert.equal(trial.results.length, 1);
  assert.deepEqual(trial.notes[0], { state: 'failure', direction: 'up' });
  assert.equal(trial.results[0].actual, 'right');
  assert.equal(trial.results[0].reason, 'wrong');
  trial.advance(5000); assert.equal(trial.remaining(5000), .8);
});
check('Four timeouts continue instead of terminating the trial', () => {
  const trial = new MemoryTrial(); trial.start(DEFAULT_SETTINGS, sequence, 0); trial.advance(20000);
  assert.equal(trial.phase, 'complete');
  assert.equal(trial.finishedAt, 8000);
  assert.deepEqual(trial.results.map(result => result.reason), ['timeout', 'timeout', 'timeout', 'timeout']);
  assert.deepEqual(trial.notes.map(note => note.direction), sequence);
});
check('Key at the exact deadline cannot rescue an expired note', () => {
  const trial = new MemoryTrial(); trial.start(DEFAULT_SETTINGS, sequence, 0); trial.advance(4000);
  assert.equal(trial.input('up', 4800), false);
  assert.equal(trial.results[0].reason, 'timeout');
});
check('Zero gap has consecutive hold windows and no extra response-dependent delay', () => {
  const trial = new MemoryTrial();
  trial.start({ noteHoldSeconds: 1, noteGapSeconds: 0 }, sequence, 0);
  trial.advance(4000); assert.equal(trial.phase, 'input');
  for (let index = 0; index < 4; index++) {
    assert.equal(trial.input(sequence[index], 4100 + 1000 * index), true);
    trial.advance(5000 + 1000 * index);
  }
  assert.equal(trial.phase, 'complete');
});
check('Hold and gap are sequential durations and either may be longer', () => {
  const trial = new MemoryTrial();
  trial.start({ noteHoldSeconds: 2, noteGapSeconds: .5 }, sequence, 0);
  trial.advance(2000); assert.equal(trial.face, 'front');
  trial.advance(2499); assert.equal(trial.index, 0);
  trial.advance(2500); assert.equal(trial.index, 1);
  trial.advance(10000); assert.equal(trial.phase, 'input');
  trial.advance(20000); assert.equal(trial.finishedAt, 20000);
});
check('Reset cancels all scheduled events', () => {
  const trial = new MemoryTrial(); trial.start(DEFAULT_SETTINGS, sequence, 0);
  trial.reset(); trial.advance(100000); assert.equal(trial.phase, 'idle');
  assert.equal(trial.results.length, 0); assert.equal(trial.face, 'front');
});
check('Invalid, negative, nonfinite and outdated settings are rejected', () => {
  for (const value of [null, [], {}, { ...DEFAULT_SETTINGS, noteHoldSeconds: NaN },
    { ...DEFAULT_SETTINGS, noteGapSeconds: -1 }, { ...DEFAULT_SETTINGS, noteHoldSeconds: 0 },
    { ...DEFAULT_SETTINGS, noteGapSeconds: Infinity }, { ...DEFAULT_SETTINGS, unexpected: 1 }]) {
    assert.throws(() => validateSettings(value));
  }
});
check('Random sequences have four valid directions with no adjacent repeats', () => {
  for (let run = 0; run < 500; run++) {
    const generated = makeSequence(); assert.equal(generated.length, 4);
    assert(generated.every((direction, index) => ['up', 'down', 'left', 'right'].includes(direction) && (index === 0 || direction !== generated[index - 1])));
  }
});
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
