export const DEFAULT_SETTINGS = Object.freeze({
  noteHoldSeconds: 0.8,
  noteGapSeconds: 0.2,
});

export function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('시간 설정을 확인해 주세요.');
  }
  const labels = {
    noteHoldSeconds: '공통 노트 유지 시간',
    noteGapSeconds: '노트 사이 간격',
  };
  if (Object.keys(value).length !== Object.keys(labels).length ||
      Object.keys(value).some(key => !(key in labels))) {
    throw new Error('설정 파일에는 공통 유지 시간과 노트 사이 간격이 필요합니다.');
  }
  const settings = {};
  for (const [key, label] of Object.entries(labels)) {
    const number = value[key];
    const minimum = key === 'noteGapSeconds' ? 0 : 0.05;
    if (typeof number !== 'number' || !Number.isFinite(number) || number < minimum || number > 60) {
      throw new Error(`${label}은 ${minimum}초 이상 60초 이하로 입력해 주세요.`);
    }
    settings[key] = number;
  }
  return settings;
}

export function makeSequence(random = Math.random) {
  const sequence = [];
  for (let index = 0; index < 4; index++) {
    const choices = ['up', 'down', 'left', 'right'].filter(direction => direction !== sequence[index - 1]);
    sequence.push(choices[Math.floor(random() * choices.length)]);
  }
  return sequence;
}

export class MemoryTrial {
  constructor() { this.reset(); }

  reset() {
    this.phase = 'idle';
    this.index = -1;
    this.face = 'front';
    this.accepting = false;
    this.inputStage = null;
    this.pendingInput = null;
    this.notes = Array.from({ length: 4 }, () => ({ state: 'default', direction: null }));
    this.sequence = [];
    this.results = [];
    this.events = [];
    this.nextAt = Infinity;
    this.startedAt = 0;
    this.finishedAt = null;
  }

  start(settings, sequence, now) {
    const validated = validateSettings(settings);
    if (!Array.isArray(sequence) || sequence.length !== 4 ||
        sequence.some((direction, index) => !['up', 'down', 'left', 'right'].includes(direction) ||
          (index > 0 && direction === sequence[index - 1]))) {
      throw new Error('서로 이어지는 방향이 다른 네 개의 방향이 필요합니다.');
    }
    this.reset();
    this.settings = validated;
    this.cycleMs = (validated.noteHoldSeconds + validated.noteGapSeconds) * 1000;
    this.sequence = [...sequence];
    this.startedAt = now;
    this.phase = 'memorize';
    this.showMemory(0, now, now);
  }

  record(kind, at, observed, extra = {}) {
    this.events.push({ kind, index: this.index + 1,
      plannedMs: Math.round((at - this.startedAt) * 1000) / 1000,
      observedMs: Math.round((observed - this.startedAt) * 1000) / 1000,
      ...extra });
  }

  showMemory(index, at, observed) {
    this.index = index;
    this.memoryVisible = true;
    this.face = this.sequence[index];
    this.notes[index] = { state: 'current', direction: this.face };
    this.nextAt = at + this.settings.noteHoldSeconds * 1000;
    this.record('memorize_on', at, observed, { direction: this.face });
  }

  openInput(index, at, observed) {
    this.index = index;
    this.inputStage = 'hold';
    this.pendingInput = null;
    this.accepting = true;
    this.notes[index] = { state: 'current', direction: null };
    this.openedAt = at;
    this.nextAt = at + this.settings.noteHoldSeconds * 1000;
    this.record('input_open', at, observed);
  }

  advance(now) {
    // Both stages use the original timeline. User response and frame delays never shift a note.
    for (let guard = 0; now >= this.nextAt && guard < 32; guard++) {
      const at = this.nextAt;
      if (this.phase === 'memorize') {
        if (this.memoryVisible) {
          this.memoryVisible = false;
          this.notes[this.index].state = 'default';
          this.face = 'front';
          this.record('memorize_off', at, now);
          this.nextAt = this.startedAt + (this.index + 1) * this.cycleMs;
        } else if (this.index < 3) {
          this.showMemory(this.index + 1, at, now);
        } else {
          this.phase = 'input';
          this.inputStartedAt = at;
          this.notes = Array.from({ length: 4 }, () => ({ state: 'default', direction: null }));
          this.openInput(0, at, now);
        }
      } else if (this.phase === 'input') {
        if (this.inputStage === 'hold') {
          if (this.accepting) this.judge(at, now);
          this.inputStage = 'gap';
          this.record('gap_start', at, now);
          this.nextAt = this.inputStartedAt + (this.index + 1) * this.cycleMs;
        }
        else if (this.index < 3) this.openInput(this.index + 1, at, now);
        else {
          // The fourth judgment gets the same full gap as the other three.
          this.phase = 'complete';
          this.inputStage = null;
          this.finishedAt = at;
          this.nextAt = Infinity;
          this.record('complete', at, now);
        }
      } else break;
    }
  }

  input(direction, now) {
    this.advance(now);
    if (this.phase !== 'input' || !this.accepting || !['up', 'down', 'left', 'right'].includes(direction)) return false;
    this.pendingInput = { direction, at: now };
    this.accepting = false;
    this.record('input_received', now, now, { direction });
    this.judge(now, now);
    return true;
  }

  judge(at, observed) {
    const direction = this.pendingInput?.direction ?? null;
    const expected = this.sequence[this.index];
    const success = direction === expected;
    const result = {
      index: this.index + 1, expected, actual: direction,
      state: success ? 'success' : 'failure',
      reason: success ? 'correct' : direction === null ? 'timeout' : 'wrong',
      responseMs: Math.round(((this.pendingInput?.at ?? at) - this.openedAt) * 1000) / 1000,
    };
    this.results.push(result);
    // A failed note always reveals the expected direction, including timeouts.
    this.notes[this.index] = { state: result.state, direction: expected };
    this.accepting = false;
    this.record('judgment', at, observed, result);
    // Keep the original hold deadline. The fixed gap starts only when it expires.
  }

  remaining(now) {
    return this.phase === 'input' && this.inputStage === 'hold' ? Math.max(0, (this.nextAt - now) / 1000) : 0;
  }
}
