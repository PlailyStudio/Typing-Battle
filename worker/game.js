import '../shared/rules.js';
import { OP } from '../shared/protocol.js';
const R = globalThis.BattleRules;

export function createRoom(params, code, host, now = Date.now()) {
  return {
    id: crypto.randomUUID(), code, host, title: String(params.title || '즐거운 타자배틀').trim().slice(0, 30),
    max: Math.max(2, Math.min(4, Math.floor(Number(params.max) || 4))),
    language: params.language === 'en' ? 'en' : 'ko', gameMode: params.gameMode === 'race' ? 'race' : 'timed',
    duration: params.gameMode === 'race' ? 60 : R.durationSeconds(params.duration),
    sentenceOrder: params.sentenceOrder === 'sequential' ? 'sequential' : 'random',
    customSentences: params.customText == null ? null : R.parseCustomSentences(params.customText),
    settingsVersion: 0, players: [], phase: 'lobby', startAt: 0, endAt: 0, createdAt: now,
    roundId: null, result: null,
  };
}

export function joinRoom(s, id, userId, name) {
  if (s.phase !== 'lobby' || s.players.length >= s.max || s.players.some(p => p.id === id)) {
    throw Error('입장할 수 없습니다. 경기 중이거나 방이 가득 찼습니다.');
  }
  s.players.push({ ...R.player(id, String(name || '플레이어').trim().slice(0, 12) || '플레이어'), userId });
  if (!s.players.some(p => p.id === s.host)) s.host = id;
}

export function leaveRoom(s, id, now = Date.now()) {
  for (const p of s.players) if (p.id === id) p.left = true;
  if (s.phase === 'lobby') s.players = s.players.filter(p => !p.left);
  const active = s.players.filter(p => !p.left);
  if (!active.some(p => p.id === s.host)) s.host = active[0]?.id || '';
  advanceTime(s, now);
}

function settings(s, data) {
  if (data.version !== s.settingsVersion) throw Error('방 설정이 변경되었습니다. 최신 설정을 확인해주세요.');
  if (typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 30) throw Error('방 이름은 1~30자로 입력해주세요.');
  if (!Number.isInteger(data.max) || data.max < 2 || data.max > 4 || data.max < s.players.length) throw Error('최대 인원을 확인해주세요.');
  if (!['ko', 'en'].includes(data.language) || !['race', 'timed'].includes(data.gameMode) || !['sequential', 'random'].includes(data.sentenceOrder)) throw Error('방 설정이 올바르지 않습니다.');
  const next = { title: data.title.trim(), max: data.max, language: data.language, gameMode: data.gameMode,
    duration: R.durationSeconds(data.duration), sentenceOrder: data.sentenceOrder,
    customSentences: data.customText == null ? null : R.parseCustomSentences(data.customText) };
  const changed = Object.keys(next).some(key => JSON.stringify(s[key]) !== JSON.stringify(next[key]));
  if (changed) {
    Object.assign(s, next); s.settingsVersion++;
    s.players.forEach(p => { p.ready = false; }); delete s.sentences;
  }
  return changed;
}

export function advanceTime(s, now) {
  if (s.phase === 'countdown' && now >= s.startAt) s.phase = 'playing';
  const active = s.players.filter(p => !p.left);
  if (s.phase === 'playing' && (s.gameMode === 'timed' ? now >= s.endAt : active.length && active.every(p => p.finished))) {
    s.phase = 'result';
    // One immutable result per round, ready for a future idempotent D1 insert.
    s.result = {
      schemaVersion: 1, rulesVersion: 'jamo-v1', roomId: s.id, roundId: s.roundId,
      language: s.language, gameMode: s.gameMode, duration: s.duration,
      custom: !!s.customSentences, sentenceOrder: s.sentenceOrder,
      sentences: [...s.sentences], startAt: s.startAt, endedAt: s.gameMode === 'timed' ? s.endAt : now,
      players: s.players.map(p => ({ userId: p.userId, playerId: p.id, name: p.name,
        left: p.left, finishedAt: p.finished || null, completedLines: p.line,
        strokes: R.strokeProgress(p, s.sentences), accuracy: R.accuracy(p),
        elapsedMs: Math.max(0, (p.finished || s.endAt || now) - s.startAt) })),
    };
  }
}

export function handleMessage(s, id, op, data, now = Date.now()) {
  advanceTime(s, now);
  const p = s.players.find(p => p.id === id && !p.left);
  if (!p || !data || typeof data !== 'object' || Array.isArray(data)) return;
  if (op === OP.SETTINGS) {
    try {
      if (s.phase !== 'lobby' || id !== s.host) throw Error('대기실에서 방장만 설정을 변경할 수 있습니다.');
      return { op: OP.SETTINGS_RESULT, data: { ok: true, changed: settings(s, data) } };
    } catch (error) { return { op: OP.SETTINGS_RESULT, data: { ok: false, error: error.message } }; }
  }
  const versionOK = data.version == null || data.version === s.settingsVersion;
  if (op === OP.READY && s.phase === 'lobby' && versionOK) p.ready = !p.ready;
  if (op === OP.NAME && s.phase === 'lobby' && typeof data.name === 'string' && data.name.trim()) p.name = data.name.trim().slice(0, 12);
  if (op === OP.START && id === s.host && s.phase === 'lobby' && versionOK && s.players.length >= 2 && s.players.every(p => p.id === s.host || p.ready)) {
    s.sentences = s.sentenceOrder === 'sequential' ? [...(s.customSentences || R.sentencesFor(s.language))] : R.shuffledSentences(null, s.language, s.customSentences);
    s.roundId = crypto.randomUUID(); s.result = null; s.phase = 'countdown';
    s.startAt = now + 3000; s.endAt = s.gameMode === 'race' ? 0 : s.startAt + s.duration * 1000;
  }
  if (op === OP.INPUT && s.phase === 'playing') R.update(p, data, now, s.sentences, s.gameMode !== 'race');
  if (op === OP.AGAIN && id === s.host && s.phase === 'result') {
    s.players = s.players.filter(p => !p.left).map(p => ({ ...R.player(p.id, p.name), userId: p.userId }));
    s.phase = 'lobby'; s.startAt = 0; s.endAt = 0;
  }
  advanceTime(s, now);
}
