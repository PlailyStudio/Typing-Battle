const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

// Exercise lifecycle logic in isolation; the smoke test separately uses real workerd sockets/storage.
async function roomClass() {
  const source = fs.readFileSync('worker/room.js', 'utf8')
    .replace("import { DurableObject } from 'cloudflare:workers';", 'class DurableObject {}')
    .replace("'./game.js'", JSON.stringify(pathToFileURL(path.resolve('worker/game.js')).href))
    .replace("'../shared/protocol.js'", JSON.stringify(pathToFileURL(path.resolve('shared/protocol.js')).href));
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).BattleRoom;
}

async function fixture() {
  const { createRoom, joinRoom, handleMessage } = await import('../worker/game.js');
  const Room = await roomClass();
  const state = createRoom({ gameMode: 'race', customText: '가'.repeat(160), sentenceOrder: 'sequential' }, '123456', 'a');
  joinRoom(state, 'a', 'user-a', 'A'); joinRoom(state, 'b', 'user-b', 'B');
  handleMessage(state, 'b', 2, {}); handleMessage(state, 'a', 3, {}, Date.now() - 5000);
  state.phase = 'playing'; state.lastActivity = Date.now(); state.emptyUntil = 0;
  const sockets = state.players.map(player => ({
    attachment: { roomId: state.id, roundId: state.roundId, player: structuredClone(player), lastSeen: Date.now(), windowStart: Date.now(), count: 0 },
    deserializeAttachment() { return structuredClone(this.attachment); },
    serializeAttachment(value) { assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 2048, 'socket attachment limit'); this.attachment = structuredClone(value); },
    send(message) { this.lastMessage = JSON.parse(message); }, close(code) { this.closed = code; },
  }));
  let stored = structuredClone(state), puts = 0, alarmAt;
  const ctx = {
    blockConcurrencyWhile(fn) { const promise = Promise.resolve().then(fn); this.ready = promise; return promise; },
    getWebSockets: () => sockets,
    storage: {
      async get() { return structuredClone(stored); },
      async put(_key, value) { stored = structuredClone(value); puts++; },
      async setAlarm(at) { alarmAt = at; },
      async deleteAll() { stored = undefined; },
    },
  };
  const restore = async () => { const room = new Room(ctx, {}); await ctx.ready; return room; };
  return { room: await restore(), sockets, restore, stored: () => stored, puts: () => puts, alarm: () => alarmAt };
}

test('Cloudflare hibernation restores typing from attachments without per-input DB writes', async () => {
  const f = await fixture();
  await f.room.webSocketMessage(f.sockets[0], JSON.stringify({ op: 4, data: { seq: 1, line: 0, text: '가'.repeat(160) } }));
  assert.equal(f.puts(), 0); assert.equal(f.stored().players[0].seq, 0);
  const restored = await f.restore();
  assert.equal(restored.state.players[0].seq, 1); assert.equal(restored.state.players[0].waiting, true);
  await restored.webSocketMessage(f.sockets[0], JSON.stringify({ op: 4, data: { seq: 2, line: 0, text: '가'.repeat(160), advance: true } }));
  assert.ok((await f.restore()).state.players[0].finished);
});

test('Cloudflare departures persist host transfer and cannot resurrect disconnected players', async () => {
  const f = await fixture();
  await f.room.webSocketClose(f.sockets[0], 1000);
  const restored = await f.restore();
  assert.equal(restored.state.players[0].left, true); assert.equal(restored.state.host, 'b');
  await restored.webSocketClose(f.sockets[1], 1000);
  assert.ok(f.alarm() <= Date.now() + 30000);
  restored.state.emptyUntil = Date.now() - 1;
  await restored.alarm(); assert.equal(f.stored(), undefined);
});

test('Cloudflare deadline alarms persist results once and survive reconstruction', async () => {
  const f = await fixture();
  f.room.state.gameMode = 'timed'; f.room.state.endAt = Date.now() - 1;
  await f.room.alarm();
  const restored = await f.restore();
  assert.equal(restored.state.phase, 'result');
  assert.equal(restored.state.result.roundId, restored.state.roundId);
  const result = structuredClone(restored.state.result);
  await restored.alarm(); assert.deepEqual(restored.state.result, result);
});

test('Cloudflare closes oversized or malformed WebSocket messages', async () => {
  const f = await fixture();
  await f.room.webSocketMessage(f.sockets[0], 'a'.repeat(32769)); assert.equal(f.sockets[0].closed, 1009);
  await f.room.webSocketMessage(f.sockets[1], '{'); assert.equal(f.sockets[1].closed, 1007);
});

test('Cloudflare server URL validation requires HTTPS except loopback development', async () => {
  const { serverBase } = await import('../src/multiplayer.js');
  assert.equal(serverBase('https://example.workers.dev/'), 'https://example.workers.dev');
  assert.equal(serverBase('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  for (const url of ['http://public.example', 'https://a:b@example.com', 'https://example.com/path', 'https://example.com/?token=x']) assert.throws(() => serverBase(url));
});
