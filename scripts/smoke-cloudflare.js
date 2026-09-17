import assert from 'node:assert/strict';
import { createMultiplayer } from '../src/multiplayer.js';

// Local only by default. Override explicitly to smoke-test an already deployed server.
const base = process.env.BATTLE_TEST_URL || 'http://127.0.0.1:8787';
const connections = [], states = [], replies = [];
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 12000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error(`Timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
};
const send = (i, op, data = {}) => connections[i].socket.sendMatchState('', op, new TextEncoder().encode(JSON.stringify(data)));
try {
  const health = await fetch(`${base}/healthcheck`); assert.equal(health.status, 200);
  assert.equal((await fetch(`${base}/rooms/123456`)).status, 400);
  assert.equal((await fetch(`${base}/healthcheck`, { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  for (let i = 0; i < 2; i++) {
    const connection = await createMultiplayer({ VITE_MULTIPLAYER_BACKEND: 'cloudflare', VITE_MULTIPLAYER_URL: base });
    connections.push(connection);
    connection.socket.onmatchdata = event => {
      const data = JSON.parse(new TextDecoder().decode(event.data));
      if (event.op_code === 1) states[i] = data;
      if (event.op_code === 8) replies[i] = data;
    };
  }
  const { client, session } = connections[0];
  const { payload } = await client.rpc(session, 'create_battle', { title: 'Cloudflare 통합 검증', max: 2, gameMode: 'race', customText: '가', sentenceOrder: 'sequential' });
  assert.match(payload.code, /^\d{6}$/);
  await connections[0].socket.joinMatch(payload.code, undefined, { name: '검증 A' });
  const resolved = await connections[1].client.rpc(connections[1].session, 'resolve_battle', { code: payload.code });
  assert.equal(resolved.payload.code, payload.code);
  await connections[1].socket.joinMatch(payload.code, undefined, { name: '검증 B' });
  await waitFor(() => states.length === 2 && states.every(s => s.players.length === 2), 'join');
  assert.equal(states[0].host, session.user_id);
  const settings = { title: '변경된 방', max: 2, language: 'ko', gameMode: 'race', duration: 1, sentenceOrder: 'sequential', customText: '가', version: 0 };
  await send(1, 7, settings); await waitFor(() => replies[1]?.ok === false, 'host-only settings');
  await send(1, 2); await waitFor(() => states[0].players[1].ready, 'ready');
  await send(0, 7, settings); await waitFor(() => replies[0]?.ok && states[1].settingsVersion === 1, 'settings');
  assert.equal(states[0].players[1].ready, false);
  await send(1, 6, { name: '새 이름' }); await waitFor(() => states[0].players[1].name === '새 이름', 'rename');
  await send(1, 2, { version: 1 }); await waitFor(() => states[0].players[1].ready, 'ready again');
  await send(0, 3, { version: 1 });
  await waitFor(() => states.every(s => s.phase === 'playing'), 'alarm starts game without input');
  const roundId = states[0].roundId;
  await send(0, 4, { seq: 1, line: 0, text: 'ㄱ', composing: true });
  await waitFor(() => states[1].players[0].text === 'ㄱ', 'IME');
  assert.equal(states[1].players[0].attempts, 0);
  for (let i = 0; i < 2; i++) {
    await send(i, 4, { seq: 2, line: 0, text: '가' });
    await waitFor(() => states[1 - i].players[i].waiting, 'waiting for confirmation');
    await send(i, 4, { seq: 3, line: 0, text: '가', advance: true });
    await waitFor(() => states[1 - i].players[i].finished, 'finish');
  }
  await waitFor(() => states.every(s => s.phase === 'result'), 'race result');
  await send(0, 5); await waitFor(() => states.every(s => s.phase === 'lobby'), 'rematch');
  replies[0] = null;
  await send(0, 7, { ...settings, gameMode: 'timed', version: 1 });
  await waitFor(() => replies[0]?.ok && states[1].settingsVersion === 2, 'timed settings');
  await send(1, 2, { version: 2 }); await waitFor(() => states[0].players[1].ready, 'timed ready');
  await send(0, 3, { version: 2 });
  await waitFor(() => states.every(s => s.phase === 'result'), 'alarm ends timed game without input');
  assert.notEqual(states[0].roundId, roundId);
  await send(0, 5); await waitFor(() => states[1].phase === 'lobby', 'lobby');
  connections[0].socket.disconnect();
  await waitFor(() => states[1].players.length === 1 && states[1].host === connections[1].session.user_id, 'host transfer');
  console.log('PASS: Cloudflare runtime + browser adapter: create/join, settings, ready, IME, finish, rematch, deadline alarms, departure, identity and origin checks.');
} finally {
  connections.forEach(c => c.socket.disconnect());
}
