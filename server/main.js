var R = this.BattleRules;
function broadcast(d, s) { s.serverNow = Date.now(); d.broadcastMessage(1, JSON.stringify(s)); }
function changeSettings(s, data) {
  if (data.version !== (s.settingsVersion || 0)) throw Error('방 설정이 변경되었습니다. 최신 설정을 확인한 뒤 다시 저장해주세요.');
  if (typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 30) throw Error('방 이름은 1~30자로 입력해주세요.');
  if (typeof data.max !== 'number' || Math.floor(data.max) !== data.max || data.max < 2 || data.max > 4) throw Error('최대 인원은 2~4명이어야 합니다.');
  if (data.max < s.players.length) throw Error('현재 참가자 수보다 최대 인원을 줄일 수 없습니다.');
  if (data.language !== 'ko' && data.language !== 'en') throw Error('언어 설정이 올바르지 않습니다.');
  if (data.gameMode !== 'race' && data.gameMode !== 'timed') throw Error('경기 방식이 올바르지 않습니다.');
  if (data.sentenceOrder !== 'sequential' && data.sentenceOrder !== 'random') throw Error('출제 순서가 올바르지 않습니다.');
  var duration = R.durationSeconds(data.duration);
  var sentences = data.customText == null ? null : R.parseCustomSentences(data.customText);
  var next = { title: data.title.trim(), max: data.max, language: data.language, gameMode: data.gameMode, duration: duration, sentenceOrder: data.sentenceOrder, customSentences: sentences };
  var changed = Object.keys(next).some(function (key) { return JSON.stringify(s[key]) !== JSON.stringify(next[key]); });
  if (changed) {
    Object.keys(next).forEach(function (key) { s[key] = next[key]; });
    s.settingsVersion = (s.settingsVersion || 0) + 1;
    s.players.forEach(function (player) { player.ready = false; });
    delete s.sentences;
  }
  return changed;
}
var matchInit = function (ctx, logger, nk, params) {
    var duration = params.gameMode === 'race' ? 60 : R.durationSeconds(params.duration);
    var customSentences = params.customText == null ? null : R.parseCustomSentences(params.customText);
    if (params.code) {
      var existing = nk.storageRead([{ collection: 'battle_codes', key: params.code }])[0];
      if (existing && nk.matchGet(existing.value.matchId)) throw Error('이미 사용 중인 참가 코드입니다.');
      // Conditional writes prevent simultaneous rooms from claiming the same code.
      nk.storageWrite([{ collection: 'battle_codes', key: params.code, value: { matchId: ctx.matchId }, version: existing ? existing.version : '*', permissionRead: 0, permissionWrite: 0 }]);
    }
    return { state: { title: params.title, duration: duration, gameMode: params.gameMode === 'race' ? 'race' : 'timed', customSentences: customSentences, sentenceOrder: params.sentenceOrder === 'sequential' ? 'sequential' : 'random', code: params.code || '', language: params.language === 'en' ? 'en' : 'ko', host: params.host, max: params.max, players: [], names: {}, phase: 'lobby', startAt: 0, endAt: 0, emptyTicks: 0 }, tickRate: 10, label: 'type-battle' };
  };
var matchJoinAttempt = function (ctx, logger, nk, d, tick, s, p, metadata) {
    var duplicate = s.players.some(function (x) { return x.id === p.userId; });
    var ok = s.phase === 'lobby' && s.players.length < s.max && !duplicate;
    if (ok) s.names[p.userId] = String(metadata && metadata.name || '플레이어').slice(0, 12);
    return { state: s, accept: ok, rejectMessage: '입장할 수 없습니다. 경기 중이거나 방이 가득 찼습니다.' };
  };
var matchJoin = function (ctx, logger, nk, d, tick, s, presences) {
    presences.forEach(function (p) { s.players.push(R.player(p.userId, s.names[p.userId] || p.username)); });
    if (!s.players.some(function (p) { return p.id === s.host; })) s.host = s.players[0].id;
    broadcast(d, s); return { state: s };
  };
var matchLeave = function (ctx, logger, nk, d, tick, s, presences) {
    presences.forEach(function (p) { s.players.forEach(function (x) { if (x.id === p.userId) x.left = true; }); });
    if (s.phase === 'lobby') s.players = s.players.filter(function (p) { return !p.left; });
    var active = s.players.filter(function (p) { return !p.left; });
    if (!active.some(function (p) { return p.id === s.host; })) s.host = active.length ? active[0].id : '';
    broadcast(d, s); return { state: s };
  };
var matchLoop = function (ctx, logger, nk, d, tick, s, messages) {
    var now = Date.now();
    var active = s.players.filter(function (p) { return !p.left; });
    if (!active.length) { s.emptyTicks++; if (s.emptyTicks > 300) return null; } else s.emptyTicks = 0;
    if (s.phase === 'countdown' && now >= s.startAt) s.phase = 'playing';
    if (s.phase === 'playing' && s.gameMode !== 'race' && now >= s.endAt) s.phase = 'result';
    messages.forEach(function (m) {
      var p = s.players.filter(function (x) { return x.id === m.sender.userId && !x.left; })[0];
      if (!p) return;
      var data; try { data = JSON.parse(nk.binaryToString(m.data)); } catch (e) { return; }
      if (!data || typeof data !== 'object') return;
      if (m.opCode === 7) {
        try {
          if (s.phase !== 'lobby' || p.id !== s.host) throw Error('대기실에서 방장만 설정을 변경할 수 있습니다.');
          var changed = changeSettings(s, data);
          d.broadcastMessage(8, JSON.stringify({ ok: true, changed: changed }), [m.sender]);
        } catch (e) {
          d.broadcastMessage(8, JSON.stringify({ ok: false, error: e.message }), [m.sender]);
        }
      }
      if (m.opCode === 2 && s.phase === 'lobby' && (data.version == null || data.version === (s.settingsVersion || 0))) p.ready = !p.ready;
      if (m.opCode === 6 && s.phase === 'lobby' && typeof data.name === 'string') {
        var nextName = data.name.trim().slice(0, 12);
        if (nextName) { p.name = nextName; s.names[p.id] = nextName; }
      }
      if (m.opCode === 3 && p.id === s.host && s.phase === 'lobby' && (data.version == null || data.version === (s.settingsVersion || 0)) && s.players.length >= 2 && s.players.every(function (x) { return x.id === s.host || x.ready; })) { s.sentences = s.sentenceOrder === 'sequential' ? (s.customSentences || R.sentencesFor(s.language)).slice() : R.shuffledSentences(null, s.language, s.customSentences); s.phase = 'countdown'; s.startAt = now + 3000; s.endAt = s.gameMode === 'race' ? 0 : s.startAt + s.duration * 1000; }
      if (m.opCode === 4 && s.phase === 'playing') R.update(p, data, now, s.sentences, s.gameMode !== 'race');
      if (m.opCode === 5 && p.id === s.host && s.phase === 'result') { s.players = s.players.filter(function (x) { return !x.left; }).map(function (x) { return R.player(x.id, x.name); }); s.phase = 'lobby'; s.startAt = 0; s.endAt = 0; }
    });
    if (s.gameMode === 'race' && s.phase === 'playing' && active.length && active.every(function (p) { return p.finished; })) s.phase = 'result';
    if (messages.length || tick % 5 === 0 || s.phase === 'countdown') broadcast(d, s);
    return { state: s };
  };
var matchTerminate = function (ctx, logger, nk, d, tick, s) { return { state: s }; };
var matchSignal = function (ctx, logger, nk, d, tick, s) { return { state: s, data: 'ok' }; };
var handler = { matchInit: matchInit, matchJoinAttempt: matchJoinAttempt, matchJoin: matchJoin, matchLeave: matchLeave, matchLoop: matchLoop, matchTerminate: matchTerminate, matchSignal: matchSignal };
var createBattle = function (ctx, logger, nk, payload) {
    if (!ctx.userId) throw Error('로그인이 필요합니다.');
    var p = JSON.parse(payload || '{}');
    var duration = p.gameMode === 'race' ? 60 : R.durationSeconds(p.duration);
    if (p.customText != null) R.parseCustomSentences(p.customText);
    for (var attempt = 0; attempt < 10; attempt++) {
      var code = String(Math.floor(100000 + Math.random() * 900000));
      try {
    var id = nk.matchCreate('battle', { duration: duration, gameMode: p.gameMode === 'race' ? 'race' : 'timed', customText: p.customText, sentenceOrder: p.sentenceOrder === 'sequential' ? 'sequential' : 'random', code: code, host: ctx.userId, language: p.language === 'en' ? 'en' : 'ko', title: String(p.title || '즐거운 타자배틀').slice(0, 30), max: Math.max(2, Math.min(4, Math.floor(Number(p.max) || 4))) });
    return JSON.stringify({ matchId: id, code: code });
      } catch (e) { if (attempt === 9) throw e; }
    }
  };
var resolveBattle = function (ctx, logger, nk, payload) {
  if (!ctx.userId) throw Error('로그인이 필요합니다.');
  var code = String(JSON.parse(payload || '{}').code || '').trim();
  if (!/^[0-9]{6}$/.test(code)) throw Error('참가 코드 숫자 6자리를 입력해주세요.');
  var entry = nk.storageRead([{ collection: 'battle_codes', key: code }])[0];
  if (!entry || !nk.matchGet(entry.value.matchId)) throw Error('방이 없거나 종료되었습니다.');
  return JSON.stringify({ matchId: entry.value.matchId, code: code });
};
function InitModule(ctx, logger, nk, initializer) {
  initializer.registerMatch('battle', handler);
  initializer.registerRpc('create_battle', createBattle);
  initializer.registerRpc('resolve_battle', resolveBattle);
  logger.info('TYPE / BATTLE runtime ready');
}
