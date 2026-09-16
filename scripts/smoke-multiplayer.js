import assert from 'node:assert/strict';
import { Client } from '@heroiclabs/nakama-js';
import '../shared/rules.js';

// Run against the local development server: node scripts/smoke-multiplayer.js
const client = new Client('defaultkey', '127.0.0.1', '7350', false);
const sockets = [];
const states = [];
const settingsResults = [];
const waitFor = async (predicate, label) => {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error(`Timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
};
try {
  const sessions = [];
  for (let i = 0; i < 2; i++) {
    sessions[i] = await client.authenticateDevice(`smoke-player-${i}-type-battle`, true);
    const socket = client.createSocket(false, false);
    sockets.push(socket);
    socket.onmatchdata = event => {
      const data = JSON.parse(new TextDecoder().decode(event.data));
      if (event.op_code === 1) states[i] = data;
      if (event.op_code === 8) settingsResults[i] = data;
    };
    await socket.connect(sessions[i], true);
  }
  const { payload } = await client.rpc(sessions[0], 'create_battle', { title: '통합 테스트', max: 2 });
  const id = payload.matchId;
  await sockets[0].joinMatch(id, undefined, { name: '검증 A' });
  assert.match(payload.code, /^[0-9]{6}$/);
  const resolved = await client.rpc(sessions[1], 'resolve_battle', { code: payload.code });
  assert.equal(resolved.payload.matchId, id);
  await sockets[1].joinMatch(resolved.payload.matchId, undefined, { name: '검증 B' });
  await waitFor(() => states.every(s => s?.players.length === 2) && states.length === 2, 'join');
  const send = (i, op, data = {}) => sockets[i].sendMatchState(id, op, new TextEncoder().encode(JSON.stringify(data)));
  await send(1, 2);
  await waitFor(() => states[0].players[1].ready, 'ready');
  const settings = { version: 0, title: '변경된 통합 테스트', max: 3, language: 'ko', gameMode: 'timed', duration: 90, sentenceOrder: 'sequential', customText: null };
  await send(1, 7, settings);
  await waitFor(() => settingsResults[1]?.ok === false, 'non-host settings rejected');
  await send(0, 7, settings);
  await waitFor(() => settingsResults[0]?.ok && states.every(s => s.settingsVersion === 1), 'settings acknowledged and broadcast');
  assert.equal(states[1].title, settings.title);
  assert.equal(states[1].duration, 90);
  assert.equal(states[1].players[1].ready, false);
  await send(1, 2, { version: 1 });
  await waitFor(() => states[0].players[1].ready, 'ready after settings change');
  await send(0, 3);
  await waitFor(() => states.every(s => s.phase === 'playing'), 'start');
  assert.deepEqual(states[0].sentences, states[1].sentences);
  assert.equal(states[0].sentences.length, 15);
  await send(0, 4, { line: 0, text: 'ㅈ', cursor: 1, composing: true, seq: 1 });
  await waitFor(() => states[1].players[0].text === 'ㅈ', 'Korean composition broadcast');
  assert.equal(states[1].players[0].attempts, 0);
  await send(0, 4, { line: 0, text: states[0].sentences[0], cursor: 25, composing: false, seq: 2 });
  await waitFor(() => states[1].players[0].waiting, 'sentence confirmation wait');
  assert.equal(states[1].players[0].line, 0);
  await send(0, 4, { line: 0, text: states[0].sentences[0], advance: true, seq: 3 });
  await waitFor(() => states[1].players[0].line === 1, 'sentence completion');
  assert.equal(states[1].players[0].name, '검증 A');
  console.log('PASS: two players joined; host-only settings, ready reset, start, Korean composition and sentence transition synchronized.');
  for (const socket of sockets) await socket.leaveMatch(id);
} finally {
  for (const socket of sockets) socket.disconnect();
}
