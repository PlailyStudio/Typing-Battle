import assert from 'node:assert/strict';
import { Client } from '@heroiclabs/nakama-js';

const client = new Client('defaultkey', '127.0.0.1', '7350', false);
const sockets = [], states = [], sessions = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error('Timed out waiting for server');
    await pause(10);
  }
}
let matchId;
try {
  for (let i = 0; i < 2; i++) {
    sessions[i] = await client.authenticateDevice(`timing-check-${i}`, true);
    const socket = client.createSocket(false, false);
    socket.onmatchdata = event => {
      if (event.op_code === 1) states[i] = JSON.parse(new TextDecoder().decode(event.data));
    };
    sockets.push(socket);
    await socket.connect(sessions[i], true);
  }
  const { payload } = await client.rpc(sessions[0], 'create_battle', {
    title: 'Timing verification', max: 2, gameMode: 'race', language: 'en',
    customText: 'A', sentenceOrder: 'sequential'
  });
  matchId = payload.matchId;
  for (let i = 0; i < 2; i++) await sockets[i].joinMatch(matchId, undefined, { name: `Timing ${i}` });
  const send = (i, op, data = {}) => sockets[i].sendMatchState(matchId, op, new TextEncoder().encode(JSON.stringify(data)));
  await waitFor(() => states[0]?.players.length === 2);
  await send(1, 2);
  await waitFor(() => states[0].players[1].ready);
  await send(0, 3);
  await waitFor(() => states[0].phase === 'playing');
  for (let i = 0; i < 2; i++) await send(i, 4, { line: 0, text: 'A', seq: 1 });
  await waitFor(() => states[0].players.every(p => p.waiting));
  // Two separately received messages inside one 100ms server tick must retain
  // distinct timestamps, even though their results are broadcast together.
  await pause(23);
  await send(0, 4, { line: 0, text: 'A', seq: 2, advance: true });
  await pause(17);
  await send(1, 4, { line: 0, text: 'A', seq: 2, advance: true });
  await waitFor(() => states[0].phase === 'result');
  const result = states[0];
  const elapsed = result.players.map(p => p.finished - result.startAt);
  console.log(JSON.stringify({ elapsedMs: elapsed, displayedSeconds: elapsed.map(ms => (ms / 1000).toFixed(2)) }));
  assert.ok(elapsed.every(ms => ms > 0));
  assert.notEqual(elapsed[0], elapsed[1], 'Distinct receipt times were collapsed into a server tick');
} finally {
  for (const socket of sockets) {
    if (matchId) { try { await socket.leaveMatch(matchId); } catch {} }
    socket.disconnect();
  }
}
