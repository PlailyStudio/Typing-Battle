const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup() {
  const ctx = vm.createContext({ Date, Number, JSON, Math, isFinite });
  vm.runInContext(fs.readFileSync('shared/rules.js', 'utf8') + '\n' + fs.readFileSync('server/main.js', 'utf8'), ctx);
  return ctx;
}
test('타수는 한글 자소 수로 계산하며 복합 모음과 겹받침을 분리한다', () => {
  const r = setup().BattleRules;
  for (const [text, expected] of [['한', 3], ['아기', 4], ['과', 3], ['값', 4], ['괜', 4], ['까', 2], ['있', 3], ['ABC 12.', 7]]) assert.equal(r.strokes(text), expected, text);
});
test('타수는 정확하게 진행한 자소를 경과 시간으로 나누고 중복 계산하지 않는다', () => {
  const r = setup().BattleRules, p = r.player('a', '나');
  r.update(p, { line: 0, text: r.sentences[0], seq: 1 }, 100);
  const count = r.strokes(r.sentences[0]);
  assert.equal(r.typingSpeed(p, 60), count);
  assert.equal(r.typingSpeed(p, 30), count * 2);
  r.update(p, { line: 0, text: p.text, advance: true, seq: 2 }, 200);
  assert.equal(r.strokeProgress(p), count);
  r.update(p, { line: 1, text: 'X', seq: 3 }, 300);
  assert.equal(r.strokeProgress(p), count);
  r.update(p, { line: 1, text: '우', seq: 4 }, 400);
  assert.equal(r.strokeProgress(p), count + 2);
});
test('마지막 조합 이벤트는 전환 대기만 설정하고 다음 요청으로 확정한다', () => {
  const r = setup().BattleRules, p = r.player('a', '나');
  r.update(p, { line: 0, text: r.sentences[0], composing: true, seq: 1 }, 100);
  assert.equal(p.line, 0); assert.equal(p.composing, false); assert.equal(p.waiting, true);
  r.update(p, { line: 0, text: p.text, advance: true, seq: 2 }, 200);
  assert.equal(p.line, 1); assert.equal(p.text, '');
  assert.equal(r.accuracy(p), 100);
});
test('정답도 수정할 수 있고 다시 맞춘 뒤 전환해야 완성된다', () => {
  const r = setup().BattleRules, p = r.player('a', '나');
  r.update(p, { line: 0, text: '작', advance: true, seq: 1 }, 100);
  assert.equal(p.line, 0); assert.equal(p.waiting, false);
  r.update(p, { line: 0, text: r.sentences[0], seq: 2 }, 200);
  assert.equal(p.line, 0); assert.equal(p.waiting, true);
  assert.equal(r.progress(p), r.sentences[0].length);
  const attempts = p.attempts;
  r.update(p, { line: 0, text: 'x', seq: 3 }, 300);
  assert.equal(p.text, 'x'); assert.equal(p.waiting, false); assert.equal(p.attempts, attempts + 1);
  r.update(p, { line: 0, text: 'x', advance: true, seq: 4 }, 400);
  assert.equal(p.line, 0); assert.equal(p.waiting, false);
  r.update(p, { line: 0, text: r.sentences[0], seq: 5 }, 500);
  assert.equal(p.waiting, true);
  const beforeConfirm = p.attempts;
  r.update(p, { line: 0, text: p.text, advance: true, seq: 6 }, 600);
  assert.equal(p.line, 1); assert.equal(p.text, ''); assert.equal(p.waiting, false);
  assert.equal(p.attempts, beforeConfirm);
});
test('마지막 문장도 전환 요청 시각에 한 번만 완주를 확정한다', () => {
  const r = setup().BattleRules, p = r.player('a', '나');
  p.line = r.sentences.length - 1;
  r.update(p, { line: p.line, text: r.sentences[p.line], seq: 1 }, 200);
  assert.equal(p.finished, 0); assert.equal(p.waiting, true);
  const line = p.line;
  r.update(p, { line, text: p.text, seq: 2 }, 250);
  assert.equal(p.finished, 0); assert.equal(p.line, line);
  r.update(p, { line, text: p.text, advance: true, seq: 3 }, 300);
  assert.equal(p.finished, 300); assert.equal(p.waiting, false);
  assert.equal(p.line, r.sentences.length);
  assert.equal(r.update(p, { line, text: '', advance: true, seq: 4 }, 400), false);
  assert.equal(p.finished, 300);
});
test('목표 안: 조합 가능한 ㅇ/아는 중립, ㅈ/우는 즉시 오타', () => {
  const r = setup().BattleRules;
  for (const text of ['ㅇ', '아']) assert.equal(r.letterState(text, '안', true), 'composing');
  for (const text of ['ㅈ', '우', '악']) assert.equal(r.letterState(text, '안', true), 'wrong');
  assert.equal(r.letterState('안', '안', true), 'correct');
  assert.equal(r.letterState('아', '안', false), 'wrong');
  assert.equal(r.letterState(undefined, '안', false), 'remaining');
});
test('다음 초성이 임시 받침이 되는 조합을 허용한다', () => {
  const r = setup().BattleRules;
  for (const [actual, target, next] of [['악', '아', '기'], ['압', '아', '버'], ['닭', '달', '기'], ['갑', '가', '방']]) {
    assert.equal(r.letterState(actual, target, true, next), 'composing');
    assert.equal(r.letterState(actual, target, false, next), 'wrong');
  }
  for (const [actual, target, next] of [['앚', '아', '기'], ['악', '아', ' '], ['악', '아', undefined], ['닭', '달', '마'], ['욱', '아', '기']]) {
    assert.equal(r.letterState(actual, target, true, next), 'wrong');
  }
});
test('복합 모음과 겹받침의 중간 조합도 허용한다', () => {
  const r = setup().BattleRules;
  for (const [partial, goal] of [['고', '과'], ['구', '권'], ['달', '닭'], ['갑', '값']]) assert.equal(r.canCompose(partial, goal), true);
  for (const [partial, goal] of [['가', '과'], ['갈', '값'], ['a', '안'], ['ㅇ', 'a']]) assert.equal(r.canCompose(partial, goal), false);
});
test('한글 조합은 채점하지 않고 확정 입력으로 문장을 완료한다', () => {
  const { BattleRules: r } = setup(); const p = r.player('a', '나');
  r.update(p, { line: 0, text: 'ㅈ', cursor: 1, composing: true, seq: 1 }, 1);
  assert.equal(p.attempts, 0); assert.equal(p.text, 'ㅈ');
  r.update(p, { line: 0, text: r.sentences[0], cursor: r.sentences[0].length, composing: false, seq: 2 }, 2);
  assert.equal(p.line, 0); assert.equal(p.waiting, true); assert.equal(r.accuracy(p), 100);
  r.update(p, { line: 0, text: p.text, advance: true, seq: 3 }, 3);
  assert.equal(p.line, 1); assert.equal(p.text, '');
});
test('오타 수정, 오래된 패킷, 문장 건너뛰기를 처리한다', () => {
  const { BattleRules: r } = setup(); const p = r.player('a', '나');
  r.update(p, { line: 0, text: 'X', seq: 1 }, 1);
  r.update(p, { line: 0, text: '작', seq: 2 }, 2);
  assert.equal(r.accuracy(p), 50); assert.equal(r.progress(p), 1);
  assert.equal(r.update(p, { line: 0, text: 'XX', seq: 1 }, 3), false);
  assert.equal(r.update(p, { line: 5, text: 'XX', seq: 3 }, 3), false);
});
test('방 입장 제한, 준비, 방장 시작, 제한 시간 이후 입력 거절', () => {
  const ctx = setup(); const h = ctx.handler;
  const d = { broadcastMessage() {} }; const nk = { binaryToString: x => x };
  let s = h.matchInit({}, {}, nk, { title: '방', host: 'a', max: 2 }).state;
  const a = { userId: 'a', username: 'a' }, b = { userId: 'b', username: 'b' };
  assert.equal(h.matchJoinAttempt({}, {}, nk, d, 0, s, a, { name: '가' }).accept, true);
  h.matchJoin({}, {}, nk, d, 0, s, [a]);
  assert.equal(h.matchJoinAttempt({}, {}, nk, d, 0, s, a, {}).accept, false);
  h.matchJoin({}, {}, nk, d, 0, s, [b]);
  assert.equal(h.matchJoinAttempt({}, {}, nk, d, 0, s, { userId: 'c' }, {}).accept, false);
  const msg = (sender, opCode, data = {}) => ({ sender, opCode, data: JSON.stringify(data) });
  h.matchLoop({}, {}, nk, d, 1, s, [msg(a, 3)]); assert.equal(s.phase, 'lobby');
  h.matchLoop({}, {}, nk, d, 2, s, [msg(b, 2), msg(b, 3)]); assert.equal(s.phase, 'lobby');
  h.matchLoop({}, {}, nk, d, 3, s, [msg(a, 3)]); assert.equal(s.phase, 'countdown');
  s.startAt = Date.now() - 61000; s.endAt = Date.now() - 1000; s.phase = 'playing';
  h.matchLoop({}, {}, nk, d, 4, s, [msg(a, 4, { line: 0, text: ctx.BattleRules.sentences[0], seq: 1 })]);
  assert.equal(s.phase, 'result'); assert.equal(s.players[0].line, 0);
});
test('방장 이탈 시 권한을 넘기고 빈 방을 종료한다', () => {
  const ctx = setup(); const h = ctx.handler; const d = { broadcastMessage() {} };
  const s = h.matchInit({}, {}, {}, { title: '방', host: 'a', max: 4 }).state;
  h.matchJoin({}, {}, {}, d, 0, s, [{ userId: 'a', username: 'a' }, { userId: 'b', username: 'b' }]);
  h.matchLeave({}, {}, {}, d, 0, s, [{ userId: 'a' }]); assert.equal(s.host, 'b');
  h.matchLeave({}, {}, {}, d, 0, s, [{ userId: 'b' }]); s.emptyTicks = 300;
  assert.equal(h.matchLoop({}, {}, {}, d, 1, s, []), null);
});

test('무작위 문장 목록은 원본을 보존하고 모든 문장을 한 번씩 포함한다', () => {
  const r = setup().BattleRules, original = Array.from(r.sentences);
  const shuffled = Array.from(r.shuffledSentences(() => 0));
  assert.equal(original.length, 15);
  assert.deepEqual(shuffled.slice().sort(), original.slice().sort());
  assert.notDeepEqual(shuffled, original);
  assert.deepEqual(Array.from(r.sentences), original);
});

test('경기별 문장으로 채점·타수·순위를 계산하며 실제 마지막 문장에서 종료한다', () => {
  const r = setup().BattleRules, a = r.player('a', '가'), b = r.player('b', '나');
  const list = ['가나다.', '바람.'];
  r.update(a, { line: 0, text: list[0], seq: 1 }, 100, list);
  r.update(a, { line: 0, text: a.text, advance: true, seq: 2 }, 150, list);
  assert.equal(a.line, 1);
  assert.equal(r.progress(a, list), list[0].length);
  assert.equal(r.typingSpeed(a, 60, list), r.strokes(list[0]));
  assert.ok(r.compare(a, b, list) < 0);
  r.update(a, { line: 1, text: list[1], seq: 3 }, 200, list);
  assert.equal(a.line, 1); assert.equal(a.finished, 0);
  r.update(a, { line: 1, text: a.text, advance: true, seq: 4 }, 250, list);
  assert.equal(a.line, list.length);
  assert.equal(a.finished, 250);
  assert.equal(r.strokeProgress(a, list), r.strokes(list.join('')));
  assert.equal(b.line, 0);
});

test('서버가 경기별 문장을 공유하고 그 순서로 두 플레이어의 입력을 판정한다', () => {
  const ctx = setup(), h = ctx.handler, r = ctx.BattleRules;
  const broadcasts = [], d = { broadcastMessage(op, data) { broadcasts.push(JSON.parse(data)); } };
  const nk = { binaryToString: x => x };
  const s = h.matchInit({}, {}, nk, { title: '방', host: 'a', max: 2 }).state;
  const a = { userId: 'a', username: '가' }, b = { userId: 'b', username: '나' };
  h.matchJoin({}, {}, nk, d, 0, s, [a, b]);
  const msg = (sender, opCode, data = {}) => ({ sender, opCode, data: JSON.stringify(data) });
  let shuffles = 0;
  r.shuffledSentences = () => { shuffles++; return shuffles === 1 ? ['새 문장.', '다음 문장.'] : ['다시 시작.']; };
  h.matchLoop({}, {}, nk, d, 1, s, [msg(b, 2), msg(a, 3)]);
  assert.deepEqual(broadcasts.at(-1).sentences, ['새 문장.', '다음 문장.']);
  s.startAt = Date.now() - 1000; s.endAt = Date.now() + 60000;
  h.matchLoop({}, {}, nk, d, 2, s, [msg(a, 4, { line: 0, text: s.sentences[0], seq: 1 }), msg(b, 4, { line: 0, text: s.sentences[0], seq: 1 })]);
  assert.equal(s.players[0].line, 0); assert.equal(s.players[1].line, 0);
  assert.ok(s.players.every(p => p.waiting));
  h.matchLoop({}, {}, nk, d, 2, s, [msg(a, 4, { line: 0, text: '', advance: true, seq: 2 }), msg(b, 4, { line: 0, text: '', advance: true, seq: 2 })]);
  assert.equal(s.players[0].line, 1); assert.equal(s.players[1].line, 1);
  s.phase = 'result';
  h.matchLoop({}, {}, nk, d, 3, s, [msg(a, 5), msg(b, 2), msg(a, 3)]);
  assert.equal(shuffles, 2);
  assert.deepEqual(s.sentences, ['다시 시작.']);
  assert.equal(s.players[0].line, 0);
});

test('영어 문장 15개를 중복 없이 섞고 대소문자와 구두점을 정확히 채점한다', () => {
  const r = setup().BattleRules;
  const list = r.shuffledSentences(() => 0, 'en');
  assert.equal(list.length, 15);
  assert.equal(new Set(list).size, 15);
  assert.ok(list.every(text => /^[\x20-\x7e]+$/.test(text) && text.length <= 160));
  assert.deepEqual(Array.from(list).sort(), Array.from(r.sentencesFor('en')).sort());
  assert.equal(r.sentencesFor('unknown'), r.sentences);
  const p = r.player('a', 'A'), target = list[0];
  r.update(p, { line: 0, text: target.toLowerCase(), seq: 1 }, 100, list);
  assert.equal(p.line, 0);
  r.update(p, { line: 0, text: target.slice(0, -1), seq: 2 }, 200, list);
  assert.equal(p.line, 0);
  r.update(p, { line: 0, text: target, seq: 3 }, 300, list);
  assert.equal(p.line, 0); assert.equal(p.waiting, true);
  r.update(p, { line: 0, text: p.text, advance: true, seq: 4 }, 400, list);
  assert.equal(p.line, 1);
  assert.equal(r.typingSpeed(p, 60, list), target.length);
});

test('영어 방 생성부터 재경기까지 서버의 언어와 문장 순서를 유지한다', () => {
  const ctx = setup(), h = ctx.handler;
  let params, broadcast;
  const nk = { matchCreate(name, value) { params = value; return 'match'; }, binaryToString: x => x };
  ctx.createBattle({ userId: 'a' }, {}, nk, JSON.stringify({ language: 'en', max: 2 }));
  assert.equal(params.language, 'en');
  const s = h.matchInit({}, {}, nk, { ...params, code: undefined }).state;
  const d = { broadcastMessage(op, data) { broadcast = JSON.parse(data); } };
  const a = { userId: 'a', username: 'A' }, b = { userId: 'b', username: 'B' };
  h.matchJoin({}, {}, nk, d, 0, s, [a, b]);
  assert.equal(broadcast.language, 'en');
  const msg = (sender, opCode, data = {}) => ({ sender, opCode, data: JSON.stringify(data) });
  h.matchLoop({}, {}, nk, d, 1, s, [msg(b, 2), msg(a, 3)]);
  assert.deepEqual(broadcast.sentences.slice().sort(), Array.from(ctx.BattleRules.sentencesFor('en')).sort());
  s.startAt = Date.now() - 1000; s.endAt = Date.now() + 60000;
  h.matchLoop({}, {}, nk, d, 2, s, [msg(a, 4, { line: 0, text: s.sentences[0], seq: 1 }), msg(b, 4, { line: 0, text: s.sentences[0], seq: 1 })]);
  assert.equal(s.players[0].line, 0); assert.equal(s.players[1].line, 0);
  assert.ok(s.players.every(p => p.waiting));
  h.matchLoop({}, {}, nk, d, 2, s, [msg(a, 4, { line: 0, text: '', advance: true, seq: 2 }), msg(b, 4, { line: 0, text: '', advance: true, seq: 2 })]);
  assert.equal(s.players[0].line, 1); assert.equal(s.players[1].line, 1);
  s.phase = 'result';
  h.matchLoop({}, {}, nk, d, 3, s, [msg(a, 5), msg(b, 2), msg(a, 3)]);
  assert.equal(s.language, 'en');
  assert.deepEqual(Array.from(s.sentences).sort(), Array.from(ctx.BattleRules.sentencesFor('en')).sort());
  ctx.createBattle({ userId: 'a' }, {}, nk, JSON.stringify({ language: 'invalid' }));
  assert.equal(params.language, 'ko');
  assert.equal(h.matchInit({}, {}, nk, { language: 'invalid' }).state.language, 'ko');
});

test('6자리 코드는 충돌 시 재시도하고 종료된 방의 코드는 재사용한다', () => {
  const ctx = setup(), records = new Map(), live = new Set();
  let serial = 0;
  const nk = {
    storageRead(reqs) { return reqs.map(r => records.get(r.key)).filter(Boolean); },
    storageWrite(reqs) {
      for (const r of reqs) {
        const old = records.get(r.key);
        if ((r.version === '*' && old) || (r.version !== '*' && r.version !== old?.version)) throw Error('conflict');
        records.set(r.key, { value: r.value, version: String(++serial) });
        assert.equal(r.permissionRead, 0); assert.equal(r.permissionWrite, 0);
      }
    },
    matchGet(id) { return live.has(id) ? { matchId: id } : null; },
    matchCreate(name, params) {
      const id = `match-${++serial}`;
      ctx.handler.matchInit({ matchId: id }, {}, nk, params);
      live.add(id); return id;
    }
  };
  let draws = [0, 0, 0.5, 0];
  ctx.Math = Object.create(Math);
  ctx.Math.random = () => draws.shift() ?? 0.9;
  const create = () => JSON.parse(ctx.createBattle({ userId: 'a' }, {}, nk, '{}'));
  const resolve = code => JSON.parse(ctx.resolveBattle({ userId: 'b' }, {}, nk, JSON.stringify({ code })));
  const first = create(), second = create();
  assert.equal(first.code, '100000'); assert.equal(second.code, '550000');
  assert.equal(resolve(` ${first.code} `).matchId, first.matchId);
  assert.equal(resolve(second.code).matchId, second.matchId);
  assert.throws(() => resolve('abc123'));
  assert.throws(() => resolve('999999'));
  live.delete(first.matchId);
  assert.throws(() => resolve(first.code));
  const replacement = create();
  assert.equal(replacement.code, first.code);
  assert.equal(resolve(first.code).matchId, replacement.matchId);
  assert.throws(() => ctx.resolveBattle({}, {}, nk, '{}'));
});

test('직접 입력 문장은 줄바꿈별로 나누고 빈 줄을 제외하며 길이를 검증한다', () => {
  const r = setup().BattleRules;
  assert.deepEqual(Array.from(r.parseCustomSentences(' 첫 문장.\r\n\r\nSecond sentence.\n  \n마지막 문장.\r끝. ')), ['첫 문장.', 'Second sentence.', '마지막 문장.', '끝.']);
  assert.deepEqual(Array.from(r.parseCustomSentences('같은 문장\n같은 문장')), ['같은 문장', '같은 문장']);
  assert.equal(r.parseCustomSentences('a'.repeat(160)).length, 1);
  for (const invalid of ['', ' \n\t', null, [], 'a'.repeat(161), Array(51).fill('문장').join('\n'), 'a'.repeat(10001)]) {
    assert.throws(() => r.parseCustomSentences(invalid));
  }
  const source = r.parseCustomSentences('첫 문장\n둘째 문장\n셋째 문장');
  const shuffled = r.shuffledSentences(() => 0, 'en', source);
  assert.deepEqual(Array.from(shuffled).sort(), Array.from(source).sort());
  assert.notDeepEqual(Array.from(shuffled), Array.from(source));
  const p = r.player('a', 'A');
  shuffled.forEach((text, line) => {
    r.update(p, { line, text, seq: line * 2 + 1 }, 100 + line, shuffled);
    r.update(p, { line, text, advance: true, seq: line * 2 + 2 }, 200 + line, shuffled);
  });
  assert.equal(p.line, 3); assert.equal(p.finished, 202);
});

test('직접 입력한 문장은 방 생성 시 검증하고 참가자와 재경기에 공유한다', () => {
  const ctx = setup(), h = ctx.handler;
  let params, broadcast, created = 0;
  const nk = { matchCreate(name, value) { params = value; created++; return 'custom-room'; }, binaryToString: x => x };
  assert.throws(() => ctx.createBattle({ userId: 'a' }, {}, nk, JSON.stringify({ customText: '\n ' })));
  assert.equal(created, 0);
  const text = '내 문장.\nMy sentence.';
  ctx.createBattle({ userId: 'a' }, {}, nk, JSON.stringify({ customText: text, max: 2 }));
  const s = h.matchInit({}, {}, nk, { ...params, code: undefined }).state;
  const d = { broadcastMessage(op, data) { broadcast = JSON.parse(data); } };
  const a = { userId: 'a', username: 'A' }, b = { userId: 'b', username: 'B' };
  h.matchJoin({}, {}, nk, d, 0, s, [a, b]);
  assert.deepEqual(broadcast.customSentences, ['내 문장.', 'My sentence.']);
  const msg = (sender, opCode, data = {}) => ({ sender, opCode, data: JSON.stringify(data) });
  h.matchLoop({}, {}, nk, d, 1, s, [msg(b, 2), msg(a, 3)]);
  assert.deepEqual(broadcast.sentences.slice().sort(), ['내 문장.', 'My sentence.'].sort());
  s.startAt = Date.now() - 1000; s.endAt = Date.now() + 60000;
  h.matchLoop({}, {}, nk, d, 2, s, [msg(a, 4, { line: 0, text: s.sentences[0], seq: 1 }), msg(b, 4, { line: 0, text: s.sentences[0], seq: 1 })]);
  assert.equal(s.players[0].line, 0); assert.equal(s.players[1].line, 0);
  assert.ok(s.players.every(p => p.waiting));
  h.matchLoop({}, {}, nk, d, 2, s, [msg(a, 4, { line: 0, text: '', advance: true, seq: 2 }), msg(b, 4, { line: 0, text: '', advance: true, seq: 2 })]);
  assert.equal(s.players[0].line, 1); assert.equal(s.players[1].line, 1);
  s.phase = 'result';
  h.matchLoop({}, {}, nk, d, 3, s, [msg(a, 5), msg(b, 2), msg(a, 3)]);
  assert.deepEqual(Array.from(s.sentences).sort(), ['내 문장.', 'My sentence.'].sort());
  assert.equal(s.players[0].line, 0);
});

test('입력 순서 출제는 중복 문장과 원본 순서를 유지하고 재경기에도 적용된다', () => {
  const ctx = setup(), h = ctx.handler;
  let params;
  const nk = { matchCreate(name, value) { params = value; return 'ordered-room'; }, binaryToString: x => x };
  ctx.createBattle({ userId: 'a' }, {}, nk, JSON.stringify({ customText: '첫 문장\n둘째 문장\n첫 문장', sentenceOrder: 'sequential', max: 2 }));
  assert.equal(params.sentenceOrder, 'sequential');
  const s = h.matchInit({}, {}, nk, { ...params, code: undefined }).state;
  const d = { broadcastMessage() {} }, a = { userId: 'a' }, b = { userId: 'b' };
  h.matchJoin({}, {}, nk, d, 0, s, [a, b]);
  const msg = (sender, opCode) => ({ sender, opCode, data: '{}' });
  h.matchLoop({}, {}, nk, d, 1, s, [msg(b, 2), msg(a, 3)]);
  assert.deepEqual(Array.from(s.sentences), ['첫 문장', '둘째 문장', '첫 문장']);
  assert.notEqual(s.sentences, s.customSentences);
  s.phase = 'result';
  h.matchLoop({}, {}, nk, d, 2, s, [msg(a, 5), msg(b, 2), msg(a, 3)]);
  assert.deepEqual(Array.from(s.sentences), ['첫 문장', '둘째 문장', '첫 문장']);
  assert.equal(s.sentenceOrder, 'sequential');
  assert.equal(h.matchInit({}, {}, nk, { sentenceOrder: 'invalid' }).state.sentenceOrder, 'random');
});

test('시간 제한은 문장 목록을 반복해 누적 타수를 기록하고 완주는 마지막에 끝난다', () => {
  const r = setup().BattleRules, list = ['가.'], timed = r.player('a', 'A'), race = r.player('b', 'B');
  for (let i = 0; i < 3; i++) {
    r.update(timed, { line: i, text: '가.', seq: i * 2 + 1 }, 100 + i, list, true);
    r.update(timed, { line: i, text: '가.', advance: true, seq: i * 2 + 2 }, 110 + i, list, true);
  }
  assert.equal(timed.finished, 0); assert.equal(timed.line, 3);
  assert.equal(r.strokeProgress(timed, list), r.strokes('가.') * 3);
  assert.equal(r.progress(timed, list), 6);
  r.update(timed, { line: 3, text: '가.', seq: 7 }, 200, list, true);
  assert.equal(timed.waiting, true);
  r.update(timed, { line: 3, text: '가.', advance: true, seq: 8 }, 201, list, true);
  assert.equal(timed.line, 4); assert.equal(timed.finished, 0);
  r.update(race, { line: 0, text: '가.', seq: 1 }, 500, list, false);
  assert.equal(race.finished, 0); assert.equal(race.line, 0);
  r.update(race, { line: 0, text: '가.', advance: true, seq: 2 }, 600, list, false);
  assert.equal(race.finished, 600);
});

test('제한 시간은 기본 60초이며 정수 범위를 검증한다', () => {
  const r = setup().BattleRules;
  assert.equal(r.durationSeconds(), 60);
  assert.equal(r.durationSeconds('90'), 90);
  for (const invalid of ['', 0, -1, 1.5, 'abc', 3601, Infinity]) assert.throws(() => r.durationSeconds(invalid));
});

test('서버가 지정 시간에 종료하며 완주 모드는 시간 제한 없이 모두의 완주를 기다린다', () => {
  const ctx = setup(), h = ctx.handler, d = { broadcastMessage() {} };
  let params;
  const nk = { binaryToString: x => x, matchCreate(name, value) { params = value; return 'mode-room'; } };
  const a = { userId: 'a' }, b = { userId: 'b' };
  const msg = (sender, opCode, data = {}) => ({ sender, opCode, data: JSON.stringify(data) });
  for (const gameMode of ['timed', 'race']) {
    ctx.createBattle({ userId: 'a' }, {}, nk, JSON.stringify({ gameMode, duration: 90, customText: 'A.', max: 2 }));
    const s = h.matchInit({}, {}, nk, { ...params, code: undefined }).state;
    h.matchJoin({}, {}, nk, d, 0, s, [a, b]);
    h.matchLoop({}, {}, nk, d, 1, s, [msg(b, 2), msg(a, 3)]);
    assert.equal(s.endAt, gameMode === 'race' ? 0 : s.startAt + 90000);
    s.startAt = Date.now() - 120000;
    if (gameMode === 'timed') s.endAt = Date.now() + 10000;
    h.matchLoop({}, {}, nk, d, 2, s, [msg(a, 4, { line: 0, text: 'A.', seq: 1 })]);
    assert.equal(s.phase, 'playing');
    if (gameMode === 'race') {
      assert.equal(s.players[0].finished, 0);
      h.matchLoop({}, {}, nk, d, 3, s, [msg(a, 4, { line: 0, text: '', advance: true, seq: 2 })]);
      assert.ok(s.players[0].finished);
      assert.equal(s.phase, 'playing');
      h.matchLoop({}, {}, nk, d, 3, s, [msg(b, 4, { line: 0, text: 'A.', seq: 1 })]);
      assert.equal(s.phase, 'playing'); assert.equal(s.players[1].finished, 0);
      h.matchLoop({}, {}, nk, d, 3, s, [msg(b, 4, { line: 0, text: '', advance: true, seq: 2 })]);
    } else {
      assert.equal(s.players[0].finished, 0);
      s.endAt = Date.now() - 1;
      h.matchLoop({}, {}, nk, d, 3, s, [msg(a, 4, { line: 0, text: 'A.', advance: true, seq: 2 })]);
      assert.equal(s.players[0].line, 0);
    }
    assert.equal(s.phase, 'result');
    h.matchLoop({}, {}, nk, d, 4, s, [msg(a, 5), msg(b, 2), msg(a, 3)]);
    assert.equal(s.gameMode, gameMode);
    assert.equal(s.endAt, gameMode === 'race' ? 0 : s.startAt + 90000);
  }
});

test('기본 문장도 순서대로 출제할 수 있다', () => {
  const ctx = setup(), h = ctx.handler;
  for (const language of ['ko', 'en']) {
    const s = h.matchInit({}, {}, {}, { host: 'a', max: 2, gameMode: 'race', sentenceOrder: 'sequential', language }).state;
    const d = { broadcastMessage() {} }, nk = { binaryToString: x => x };
    h.matchJoin({}, {}, nk, d, 0, s, [{ userId: 'a' }, { userId: 'b' }]);
    h.matchLoop({}, {}, nk, d, 1, s, [{ sender: { userId: 'b' }, opCode: 2, data: '{}' }, { sender: { userId: 'a' }, opCode: 3, data: '{}' }]);
    assert.deepEqual(Array.from(s.sentences), Array.from(ctx.BattleRules.sentencesFor(language)));
    assert.notEqual(s.sentences, ctx.BattleRules.sentencesFor(language));
    assert.equal(s.endAt, 0);
  }
});

test('사용자 문장이 null로 전달되어도 기본 문장 방을 생성한다', () => {
  const ctx = setup();
  const nk = { matchCreate(name, params) {
    // Nakama converts absent optional JS values to null across the Go runtime boundary.
    const transported = JSON.parse(JSON.stringify(params, (key, value) => value === undefined ? null : value));
    const state = ctx.handler.matchInit({}, {}, {}, { ...transported, code: undefined }).state;
    assert.equal(state.customSentences, null);
    return 'default-room';
  } };
  for (const payload of [{ gameMode: 'race' }, { gameMode: 'timed', customText: null }]) {
    assert.equal(JSON.parse(ctx.createBattle({ userId: 'a' }, {}, nk, JSON.stringify(payload))).matchId, 'default-room');
  }
  assert.throws(() => ctx.createBattle({ userId: 'a' }, {}, nk, JSON.stringify({ customText: '' })));
});

test('대기실에서 참가자가 닉네임을 변경하면 서버 상태와 다음 방송에 반영된다', () => {
  const ctx = setup(), h = ctx.handler, broadcasts = [];
  const d = { broadcastMessage(op, data) { broadcasts.push(JSON.parse(data)); } };
  const nk = { binaryToString: value => value };
  const state = h.matchInit({}, {}, nk, { host: 'a', max: 2, language: 'ko' }).state;
  const a = { userId: 'a', username: '원래이름' }, b = { userId: 'b', username: '참가자' };
  h.matchJoin({}, {}, nk, d, 0, state, [a, b]);
  h.matchLoop({}, {}, nk, d, 1, state, [{ sender: a, opCode: 6, data: JSON.stringify({ name: '새이름' }) }]);
  assert.equal(state.players.find(player => player.id === 'a').name, '새이름');
  assert.equal(state.names.a, '새이름');
  assert.equal(broadcasts.at(-1).players.find(player => player.id === 'a').name, '새이름');
  h.matchLoop({}, {}, nk, d, 2, state, [{ sender: a, opCode: 6, data: JSON.stringify({ name: '   ' }) }]);
  assert.equal(state.players.find(player => player.id === 'a').name, '새이름');
});
