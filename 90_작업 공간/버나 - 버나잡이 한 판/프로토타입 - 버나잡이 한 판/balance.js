(function (root) {
  'use strict';
  const STEP = 1 / 120;
  const SETTINGS = Object.freeze({ rodSpeed: 32, moveSpeed: 220, maxRod: 45, spinSpeed: 120, flightDuration: 1.1, flightHeight: 130, fallDuration: 1 });
  function validate(p) {
    if (!p || typeof p.beonaId !== 'string' || typeof p.name !== 'string') throw new Error('물체의 아이디와 이름이 필요합니다.');
    for (const key of ['tiltSpeed', 'restore', 'hold', 'limit']) {
      if (!Number.isFinite(p[key])) throw new Error('속도와 구간값은 유한한 숫자여야 합니다.');
    }
    if (!(p.tiltSpeed > 0 && p.restore > 0 && p.restore < p.hold && p.hold < p.limit && p.limit <= SETTINGS.maxRod)) {
      throw new Error('속도 > 0, 0 < 복원값 < 유지값 < 한계값 ≤ 45로 입력하세요.');
    }
    return p;
  }
  function classify(angle, p) {
    const magnitude = Math.abs(angle);
    return magnitude < p.restore ? 'restore' : magnitude < p.hold ? 'hold' : magnitude < p.limit ? 'increase' : 'fall';
  }
  const towardZero = (value, amount) => Math.sign(value) * Math.max(0, Math.abs(value) - amount);
  class Model {
    constructor(p) {
      this.params = { ...validate(p) };
      this.spin = 0;
      this.accumulator = 0;
      this.reset();
    }
    reset() {
      this.rod = 0;
      this.tilt = 0;
      this.x = 0;
      this.height = 0;
      this.flightTime = null;
      this.fallTime = null;
      this.mode = 'restore';
      this.accumulator = 0;
    }
    setParams(p) { this.params = { ...validate(p) }; this.reset(); }
    launch() {
      if (this.flightTime !== null || this.fallTime !== null || classify(this.rod, this.params) === 'fall') return false;
      this.flightTime = 0;
      this.mode = 'air';
      return true;
    }
    tick(dt, input = {}) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      this.accumulator += dt;
      while (this.accumulator + 1e-10 >= STEP) {
        this.accumulator -= STEP;
        this.step(STEP, input);
      }
    }
    step(dt, input) {
      this.spin = (this.spin + SETTINGS.spinSpeed * dt) % 360;
      if (this.fallTime !== null) {
        this.fallTime += dt;
        if (this.fallTime + 1e-9 >= SETTINGS.fallDuration) {
          // Preserve the remaining frame time and independent rotation on restart.
          const remainder = this.accumulator;
          this.reset();
          this.accumulator = remainder;
        }
        return;
      }
      const turn = Math.max(-1, Math.min(1, Number(input.turn) || 0));
      const move = Math.max(-1, Math.min(1, Number(input.move) || 0));
      this.rod = Math.max(-SETTINGS.maxRod, Math.min(SETTINGS.maxRod, this.rod + turn * SETTINGS.rodSpeed * dt));
      this.x = Math.max(-240, Math.min(240, this.x + move * SETTINGS.moveSpeed * dt));
      if (this.flightTime !== null) {
        const airDt = Math.min(dt, SETTINGS.flightDuration - this.flightTime);
        this.tilt = towardZero(this.tilt, this.params.tiltSpeed * airDt);
        this.flightTime += dt;
        this.mode = 'air';
        const progress = Math.min(1, this.flightTime / SETTINGS.flightDuration);
        this.height = 4 * SETTINGS.flightHeight * progress * (1 - progress);
        if (this.flightTime + 1e-9 < SETTINGS.flightDuration) return;
        this.flightTime = null;
        this.height = 0;
        this.mode = classify(this.rod, this.params);
        if (this.mode === 'fall') this.fallTime = 0;
        return;
      }
      this.mode = classify(this.rod, this.params);
      if (this.mode === 'restore') this.tilt = towardZero(this.tilt, this.params.tiltSpeed * dt);
      if (this.mode === 'increase') this.tilt += (Math.sign(this.tilt) || Math.sign(this.rod)) * this.params.tiltSpeed * dt;
      if (this.mode === 'fall') this.fallTime = 0;
    }
  }
  const api = { Model, SETTINGS, STEP, classify, validate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BeonaBalance = api;
})(typeof globalThis === 'object' ? globalThis : this);
