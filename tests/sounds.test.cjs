const { test } = require('node:test');
const assert = require('node:assert/strict');

async function fixture(enabled = true) {
  const { createSounds } = await import('../src/sounds.js');
  const voices = [], gains = [];
  let created = 0;
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const context = { currentTime: 1, state: 'running', destination: {},
    createGain() { const gain = { gain: param(), connect() {}, disconnect() { this.disconnected = true; } }; gains.push(gain); return gain; },
    createOscillator() { const voice = { frequency: param(), connect() {}, disconnect() { this.disconnected = true; }, start() {}, stop() {} }; voices.push(voice); return voice; }
  };
  const sounds = createSounds({ enabled, volume: 0.3, createContext: () => { created++; return context; } });
  return { sounds, context, voices, gains, created: () => created };
}

test('오디오는 사용자 동작 후 한 번만 초기화하고 음소거·음량을 반영한다', async () => {
  const f = await fixture();
  f.sounds.play('type'); assert.equal(f.created(), 0);
  f.sounds.unlock(); f.sounds.unlock(); assert.equal(f.created(), 1);
  assert.equal(f.gains[0].gain.value, 0.3);
  f.sounds.play('complete'); assert.equal(f.voices.length, 2);
  f.sounds.setEnabled(false); f.sounds.play('result');
  assert.equal(f.gains[0].gain.value, 0); assert.equal(f.voices.length, 2);
  f.sounds.setVolume(0.15); f.sounds.setEnabled(true);
  assert.equal(f.gains[0].gain.value, 0.15);
  f.sounds.setVolume(1.2); assert.equal(f.gains[0].gain.value, 1.2);
  f.sounds.setVolume(3); assert.equal(f.gains[0].gain.value, 2);
  f.sounds.setVolume(NaN); assert.equal(f.gains[0].gain.value, 1);
  f.voices[0].onended(); assert.equal(f.voices[0].disconnected, true);
  const muted = await fixture(false); muted.sounds.unlock(); assert.equal(muted.created(), 0);
});

test('반복 갱신과 서버 방송은 카운트다운·시작·종료 소리를 중복 재생하지 않는다', async () => {
  const f = await fixture(); f.sounds.unlock();
  const room = { startAt: 4000, phase: 'countdown' };
  for (const now of [1000, 1001, 1100, 2000, 2001, 3000, 3001]) f.sounds.observe(room, now);
  assert.equal(f.voices.length, 3);
  room.phase = 'playing'; f.sounds.observe(room, 4000); f.sounds.observe(room, 4100);
  assert.equal(f.voices.length, 4);
  room.phase = 'result'; f.sounds.observe(room, 5000); f.sounds.observe(room, 5100);
  assert.equal(f.voices.length, 7);
  f.sounds.reset(); room.startAt = 8000; room.phase = 'countdown'; f.sounds.observe(room, 5000);
  assert.equal(f.voices.length, 8);
});

test('빠른 타이핑 효과음 수를 제한하고 오디오 미지원도 처리한다', async () => {
  const f = await fixture(); f.sounds.unlock();
  for (let i = 0; i < 100; i++) f.sounds.play('type');
  assert.equal(f.voices.length, 16);
  for (let i = 0; i < 100; i++) f.sounds.play('error');
  assert.equal(f.voices.length, 16);
  const { createSounds } = await import('../src/sounds.js');
  const unavailable = createSounds({ createContext() { throw Error('unavailable'); } });
  assert.doesNotThrow(() => { unavailable.unlock(); unavailable.play('type'); });
});
