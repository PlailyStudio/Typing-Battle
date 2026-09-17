const { test } = require('node:test');
const assert = require('node:assert/strict');
const game = import('../worker/game.js');

async function fixture(params = {}) {
  const g = await game;
  const s = g.createRoom({ gameMode: 'race', sentenceOrder: 'sequential', customText: '가', ...params }, '123456', 'a', 1000);
  g.joinRoom(s, 'a', 'user-a', 'A'); g.joinRoom(s, 'b', 'user-b', 'B');
  const send = (id, op, data = {}, now = 1000) => g.handleMessage(s, id, op, data, now);
  const start = () => { send('b', 2); send('a', 3); };
  return { ...g, s, send, start };
}

test('Cloudflare: host authority, version checks, and ready reset', async () => {
  const { s, send } = await fixture();
  const settings = { title: '새 방', max: 2, language: 'ko', gameMode: 'race', duration: 60, sentenceOrder: 'sequential', customText: '나', version: 0 };
  send('b', 2); send('b', 3); assert.equal(s.phase, 'lobby');
  assert.equal(send('b', 7, settings).data.ok, false);
  assert.equal(send('a', 7, settings).data.ok, true);
  assert.equal(s.players[1].ready, false); assert.equal(s.settingsVersion, 1);
  send('b', 2, { version: 0 }); assert.equal(s.players[1].ready, false);
  assert.equal(send('a', 7, settings).data.ok, false);
  send('b', 2, { version: 1 }); send('a', 3, { version: 1 });
  assert.equal(s.phase, 'countdown'); assert.deepEqual(s.sentences, ['나']);
});

test('Cloudflare: IME, sequence checks, server timestamps, immutable results and rematch IDs', async () => {
  const { s, send, start } = await fixture(); start();
  send('a', 4, { seq: 1, line: 0, text: '가' }, 3999); assert.equal(s.players[0].seq, 0);
  send('a', 4, { seq: 1, line: 0, text: 'ㄱ', composing: true }, 4000);
  assert.equal(s.players[0].attempts, 0);
  send('a', 4, { seq: 2, line: 0, text: '가' }, 4010); assert.equal(s.players[0].waiting, true);
  send('a', 4, { seq: 2, line: 0, text: '가', advance: true }, 4020); assert.equal(s.players[0].finished, 0);
  send('a', 4, { seq: 3, line: 0, text: '가', advance: true, finished: 1 }, 4031);
  send('b', 4, { seq: 1, line: 0, text: '가' }, 4040);
  send('b', 4, { seq: 2, line: 0, text: '가', advance: true }, 4041);
  assert.equal(s.phase, 'result'); assert.equal(s.players[0].finished, 4031);
  assert.equal(s.result.players[0].elapsedMs, 31); assert.equal(s.result.players[0].strokes, 2);
  const result = structuredClone(s.result), roundId = s.roundId;
  send('a', 4, { seq: 999, line: 1, text: 'hack' }, 5000); assert.deepEqual(s.result, result);
  send('a', 5); assert.equal(s.phase, 'lobby'); assert.equal(s.players[0].userId, 'user-a');
  start(); assert.notEqual(s.roundId, roundId);
});

test('Cloudflare: deadline rejects late input, departure transfers host, capacity and duplicates rejected', async () => {
  const { s, send, start, joinRoom, leaveRoom, advanceTime } = await fixture({ gameMode: 'timed', duration: 1, max: 2 });
  assert.throws(() => joinRoom(s, 'c', 'u', 'C'));
  assert.throws(() => joinRoom(s, 'a', 'user-a', 'A'));
  start(); advanceTime(s, 4000); assert.equal(s.phase, 'playing');
  send('a', 4, { seq: 1, line: 0, text: '가' }, 4999);
  send('a', 4, { seq: 2, line: 0, text: '가', advance: true }, 5000);
  assert.equal(s.phase, 'result'); assert.equal(s.players[0].line, 0); assert.equal(s.result.endedAt, 5000);
  leaveRoom(s, 'a', 5001); assert.equal(s.host, 'b');
  send('b', 5); assert.equal(s.players.length, 1);
});

test('Cloudflare: malformed settings and creation parameters do not corrupt state', async () => {
  const { s, send, createRoom } = await fixture();
  assert.throws(() => createRoom({ gameMode: 'timed', duration: 0 }, '123456', 'a'));
  assert.throws(() => createRoom({ customText: 'A'.repeat(161) }, '123456', 'a'));
  const before = structuredClone(s);
  assert.equal(send('a', 7, { version: 0, title: 'bad', max: 1 }).data.ok, false);
  assert.deepEqual(s, before);
});
