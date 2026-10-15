'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Model, classify, validate } = require('./balance.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '버나 데이터.json'), 'utf8'));
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-7, label + ': ' + actual + ' vs ' + expected);
let checks = 0;
function check(label, fn) { fn(); checks++; console.log('PASS ' + label); }
check('JSON and offline browser data are identical', () => {
  const context = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'), context);
  assert.equal(JSON.stringify(context.window.BEONA_DATA), JSON.stringify(data));
});
for (const p of data) {
  check(p.name + ': symmetric intervals and exact boundaries', () => {
    for (const sign of [-1, 1]) {
      assert.equal(classify(sign * (p.restore - .001), p), 'restore');
      assert.equal(classify(sign * p.restore, p), 'hold');
      assert.equal(classify(sign * (p.hold - .001), p), 'hold');
      assert.equal(classify(sign * p.hold, p), 'increase');
      assert.equal(classify(sign * (p.limit - .001), p), 'increase');
      assert.equal(classify(sign * p.limit, p), 'fall');
    }
  });
  check(p.name + ': neutral restores gradually without overshoot', () => {
    for (const sign of [-1, 1]) {
      const m = new Model(p); m.tilt = sign * p.tiltSpeed; m.tick(.25);
      near(m.tilt, sign * p.tiltSpeed * .75, 'gradual restore'); m.tick(2); near(m.tilt, 0, 'no overshoot');
      m.tick(10); near(m.tilt, 0, 'neutral stays neutral');
    }
  });
  check(p.name + ': hold and existing tilt direction', () => {
    for (const sign of [-1, 1]) {
      const m = new Model(p); m.tilt = sign * 8; m.rod = p.restore; m.tick(.5); near(m.tilt, sign * 8, 'hold');
      m.rod = -sign * p.hold; m.tick(.25); near(m.tilt, sign * (8 + p.tiltSpeed * .25), 'existing direction');
      m.reset(); m.rod = sign * p.hold; m.tick(.25); near(m.tilt, sign * p.tiltSpeed * .25, 'zero seeds rod direction');
    }
  });
  check(p.name + ': airborne restoration, return and landing failure', () => {
    const m = new Model(p); m.tilt = p.tiltSpeed; m.rod = p.hold; assert.ok(m.launch()); assert.equal(m.launch(), false);
    m.rod = p.limit + 1; m.tick(.25); near(m.tilt, p.tiltSpeed * .75, 'air restore'); assert.equal(m.fallTime, null);
    m.tick(.85); assert.equal(m.flightTime, null); assert.equal(m.mode, 'fall');
    m.tick(1); near(m.rod, 0, 'reset rod'); near(m.tilt, 0, 'reset tilt'); assert.equal(m.params.beonaId, p.beonaId);
    m.rod = p.hold; m.tilt = 20; m.launch(); m.rod = 0; m.tick(1.1); assert.equal(m.mode, 'restore'); near(m.height, 0, 'land at tip');
  });
  check(p.name + ': fall depends on rod, not beona angle', () => {
    const m = new Model(p); m.tilt = 200; m.rod = p.hold; m.tick(.25); assert.equal(m.mode, 'increase');
    m.rod = -p.limit; m.tick(1 / 120); assert.equal(m.mode, 'fall');
  });
}
check('equal 30, 60 and 144 Hz duration gives equal tilt and rotation', () => {
  const results = [30, 60, 144].map(hz => {
    const m = new Model(data[0]); m.rod = 16;
    for (let i = 0; i < hz * 2; i++) m.tick(1 / hz);
    return { tilt: m.tilt, spin: m.spin };
  });
  for (const r of results) { near(r.tilt, 120, 'tilt'); near(r.spin, 240, 'spin'); }
});
check('rotation is independent of tilt, movement and flight', () => {
  const a = new Model(data[0]), b = new Model(data[0]); b.launch();
  for (let i = 0; i < 120; i++) { a.tick(1 / 120); b.tick(1 / 120, { turn: 1, move: 1 }); }
  near(a.spin, b.spin, 'rotation'); near(b.x, 220, 'movement');
});
check('invalid or unordered settings rejected', () => {
  assert.throws(() => validate({ ...data[0], restore: 16 }));
  assert.throws(() => validate({ ...data[0], tiltSpeed: NaN }));
  assert.throws(() => validate({ ...data[0], limit: 99 }));
});
console.log('All ' + checks + ' checks passed.');
