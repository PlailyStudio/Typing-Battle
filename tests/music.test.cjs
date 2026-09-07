const { test } = require('node:test');
const assert = require('node:assert/strict');

async function fixture() {
  const { createMusic } = await import('../src/music.js');
  const voices = [], timers = new Map();
  let created = 0, serial = 0;
  const param = () => ({ value: 0, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime(v) { this.value = v; } });
  const context = { currentTime: 0, state: 'running', destination: {},
    createGain() { return { gain: param(), connect() {}, disconnect() {} }; },
    createOscillator() { const voice = { frequency: param(), connect() {}, disconnect() {}, start(at) { this.at = at; }, stop(at) { this.end = at; } }; voices.push(voice); return voice; }
  };
  const music = createMusic({ createContext: () => { created++; return context; },
    schedule(fn) { timers.set(++serial, fn); return serial; }, cancel(id) { timers.delete(id); } });
  return { music, voices, context, timers, created: () => created, tick() { for (const fn of timers.values()) fn(); } };
}

test('음악은 입력 후 시작하고 반복 입력·화면 갱신에 중복되지 않는다', async () => {
  const f = await fixture();
  f.music.setPaused(false); f.music.setScene('lobby'); assert.equal(f.created(), 0);
  f.music.unlock(); const count = f.voices.length;
  assert.ok(count > 0);
  for (let i = 0; i < 100; i++) { f.music.unlock(); f.music.setScene('lobby'); }
  assert.equal(f.voices.length, count); assert.equal(f.created(), 1); assert.equal(f.timers.size, 1);
  f.music.setScene('countdown');
  assert.equal(f.timers.size, 0, '카운트다운 동안 배경음악을 멈춘다');
  assert.ok(f.voices.every(voice => voice.end <= f.context.currentTime + 0.13));
  f.music.unlock(); f.music.setVolume(0.3);
  f.music.setEnabled(false); f.music.setEnabled(true);
  f.music.setPaused(true); f.music.setPaused(false);
  f.music.setScene('countdown');
  assert.equal(f.voices.length, count, '입력·설정 변경·탭 복귀에도 음악을 재개하지 않는다');
  assert.equal(f.timers.size, 0);
  f.music.setScene('playing');
  assert.notEqual(f.voices[count].frequency.value, f.voices[0].frequency.value);
  const gameCount = f.voices.length;
  f.music.setScene('playing'); assert.equal(f.voices.length, gameCount);
  f.music.setScene('result'); assert.ok(f.voices.length > gameCount); assert.equal(f.timers.size, 1);
  f.music.setEnabled(false); assert.equal(f.timers.size, 0);
});

test('음소거·볼륨 0·탭 숨김은 재생을 멈추고 복귀 시 하나만 재개한다', async () => {
  const f = await fixture(); f.music.unlock();
  f.music.setEnabled(false); f.music.setScene('playing'); f.music.unlock(); assert.equal(f.timers.size, 0);
  f.music.setEnabled(true); assert.equal(f.timers.size, 1);
  f.music.setVolume(0); f.music.unlock(); assert.equal(f.timers.size, 0);
  f.music.setVolume(0.2); assert.equal(f.timers.size, 1);
  f.music.setPaused(true); f.music.setScene('lobby'); assert.equal(f.timers.size, 0);
  f.music.setPaused(false); assert.equal(f.timers.size, 1);
  const before = f.voices.length; f.context.currentTime = 600; f.tick();
  assert.ok(f.voices.length - before < 20, '지연된 비트를 한꺼번에 재생하지 않는다');
  f.music.setEnabled(false);
});

test('오디오 미지원 및 재개 거부는 게임에 오류를 전파하지 않는다', async () => {
  const { createMusic } = await import('../src/music.js');
  for (const createContext of [() => null, () => { throw Error('blocked'); }, () => ({ state: 'suspended', destination: {}, createGain: () => ({ gain: {}, connect() {} }), resume: () => Promise.reject(Error('blocked')) })]) {
    const music = createMusic({ createContext });
    assert.doesNotThrow(() => { music.unlock(); music.setScene('playing'); music.setEnabled(false); });
  }
  await new Promise(resolve => setImmediate(resolve));
});
