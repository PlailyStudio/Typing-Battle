const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function fixture() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync('shared/rules.js', 'utf8') + '\n' + fs.readFileSync('server/main.js', 'utf8'), ctx);
  const nk = { binaryToString: data => data }, broadcasts = [];
  const d = { broadcastMessage(op, data, recipients) { broadcasts.push({ op, data: JSON.parse(data), recipients }); } };
  const state = ctx.matchInit({}, {}, nk, { title: '이전 방', host: 'a', max: 4, gameMode: 'race', language: 'ko', sentenceOrder: 'sequential' }).state;
  const a = { userId: 'a' }, b = { userId: 'b' };
  ctx.matchJoin({}, {}, nk, d, 0, state, [a, b]);
  const message = (sender, opCode, data = {}) => ({ sender, opCode, data: JSON.stringify(data) });
  const loop = (...messages) => ctx.matchLoop({}, {}, nk, d, 1, state, messages);
  const settings = { version: 0, title: '새 방', max: 3, gameMode: 'timed', duration: 90, language: 'en', sentenceOrder: 'sequential', customText: 'First line\nSecond line' };
  const result = () => broadcasts.filter(x => x.op === 8).at(-1);
  return { ctx, state, a, b, message, loop, settings, broadcasts, result };
}

test('방장 설정 변경이 모두에게 전달되고 준비 해제 후 새 설정으로 경기가 시작된다', () => {
  const f = fixture(), { state: s, message: m } = f;
  f.loop(m(f.b, 2)); assert.equal(s.players[1].ready, true);
  f.loop(m(f.a, 7, f.settings));
  assert.equal(f.result().data.ok, true);
  assert.equal(f.result().recipients[0].userId, 'a');
  for (const key of ['title', 'max', 'gameMode', 'duration', 'language', 'sentenceOrder']) assert.equal(s[key], f.settings[key]);
  assert.deepEqual(Array.from(s.customSentences), ['First line', 'Second line']);
  assert.equal(s.players[1].ready, false);
  assert.equal(f.broadcasts.at(-1).data.settingsVersion, 1);
  f.loop(m(f.b, 2, { version: 0 }), m(f.a, 3, { version: 0 }));
  assert.equal(s.phase, 'lobby'); assert.equal(s.players[1].ready, false);
  f.loop(m(f.b, 2, { version: 1 }), m(f.a, 3, { version: 1 }));
  assert.equal(s.phase, 'countdown');
  assert.equal(s.endAt - s.startAt, 90000);
  assert.deepEqual(Array.from(s.sentences), ['First line', 'Second line']);
  s.phase = 'result'; f.loop(m(f.a, 5));
  assert.equal(s.phase, 'lobby'); assert.equal(s.title, '새 방');
  f.loop(m(f.a, 7, { ...f.settings, version: 1, customText: null, gameMode: 'race', sentenceOrder: 'random' }));
  f.loop(m(f.b, 2, { version: 2 }), m(f.a, 3, { version: 2 }));
  assert.equal(s.customSentences, null); assert.equal(s.endAt, 0);
  assert.deepEqual(Array.from(s.sentences).sort(), Array.from(f.ctx.BattleRules.sentencesFor('en')).sort());
});

test('비방장·경기 중 설정 변경과 잘못된 설정은 상태를 변경하지 않는다', () => {
  const cases = [{ sender: 'b' }, ...['countdown', 'playing', 'result'].map(phase => ({ phase })),
    ...[{ max: 1 }, { max: 5 }, { max: 2.5 }, { title: '' }, { title: 'a'.repeat(31) }, { duration: 0 }, { duration: 3601 },
      { customText: '' }, { customText: 'a'.repeat(161) }, { language: 'x' }, { gameMode: 'x' }, { sentenceOrder: 'x' }, { version: 99 }].map(patch => ({ patch }))];
  for (const entry of cases) {
    const f = fixture(); f.state.phase = entry.phase || 'lobby'; f.state.startAt = Date.now() + 60000; f.state.endAt = Date.now() + 90000;
    const before = JSON.stringify(f.state);
    f.loop(f.message(entry.sender === 'b' ? f.b : f.a, 7, { ...f.settings, ...entry.patch }));
    assert.equal(f.result().data.ok, false, JSON.stringify(entry));
    const expected = JSON.parse(before); expected.emptyTicks = 0; expected.serverNow = f.state.serverNow;
    assert.deepEqual(JSON.parse(JSON.stringify(f.state)), expected);
  }
});

test('현재 인원보다 작게 변경하지 못하고 방장이 바뀌면 새 방장만 편집한다', () => {
  const f = fixture();
  f.state.players.push(f.ctx.BattleRules.player('c', 'C'));
  f.loop(f.message(f.a, 7, { ...f.settings, max: 2 }));
  assert.equal(f.result().data.ok, false); assert.equal(f.state.max, 4);
  f.state.host = 'b';
  f.loop(f.message(f.a, 7, f.settings)); assert.equal(f.result().data.ok, false);
  f.loop(f.message(f.b, 7, f.settings)); assert.equal(f.result().data.ok, true);
  f.state.players[0].ready = true;
  f.loop(f.message(f.b, 7, { ...f.settings, version: 1 }));
  assert.equal(f.result().data.changed, false); assert.equal(f.state.players[0].ready, true);
});
