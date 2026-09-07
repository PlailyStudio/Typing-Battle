import '../shared/rules.js';
import './style.css';
import { bindTypingInput } from './typing-input.js';
import { bindNicknameInput } from './nickname-input.js';
import { createSounds } from './sounds.js';
import { createMusic } from './music.js';

const R = globalThis.BattleRules;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const saved = (key, fallback = '') => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
let soundEnabled = saved('tb-sound-enabled', 'true') !== 'false';
let soundVolume = Number(saved('tb-sound-volume', '100'));
if (!Number.isFinite(soundVolume)) soundVolume = 100;
soundVolume = Math.max(0, Math.min(200, soundVolume));
const sounds = createSounds({ enabled: soundEnabled, volume: soundVolume / 100 });
window.addEventListener('pointerdown', sounds.unlock, { capture: true });
window.addEventListener('keydown', sounds.unlock, { capture: true });
sounds.bindUI(document);
let musicEnabled = saved('tb-music-enabled', 'true') !== 'false';
let musicVolume = Number(saved('tb-music-volume', '100'));
musicVolume = Number.isFinite(musicVolume) ? Math.max(0, Math.min(200, musicVolume)) : 100;
const music = createMusic({ enabled: musicEnabled, volume: musicVolume / 100 });
window.addEventListener('pointerdown', music.unlock, { capture: true });
window.addEventListener('keydown', music.unlock, { capture: true });
document.addEventListener('visibilitychange', () => music.setPaused(document.hidden));
window.addEventListener('pagehide', () => music.setPaused(true));
window.addEventListener('pageshow', () => music.setPaused(document.hidden));
let tab = 'single', room = null, self = null, socket = null, session = null, matchId = '', roomCode = '', pendingInviteCode = '', mode = '', offset = 0, seq = 0, composing = false, displayedPhase = '', best = Number(saved('tb-best-jamo-v1', '0')), resultSaved = false;
let language = 'ko';
let gameMode = 'race', duration = 60;
let sentenceSource = 'default', customText = '', sentenceOrder = 'sequential';
let nickname = '', error = '', busy = false;
let finalizingInput = false;
let autoNext = saved('tb-next-mode', 'input') === 'auto';
const app = $('#app');
const encoder = new TextEncoder(), decoder = new TextDecoder();
const renderedHTML = new WeakMap();
const sentenceCache = new Map();
function setHTML(node, html) {
  if (renderedHTML.get(node) === html) return;
  node.innerHTML = html;
  renderedHTML.set(node, html);
}
function setText(node, text) {
  text = String(text);
  if (node.textContent !== text) node.textContent = text;
}
const transitionKeys = { key: null, blockInput: false };
function releaseTransitionKey(event) {
  if (event.type !== 'blur' && event.code !== transitionKeys.key && event.key !== transitionKeys.key) return;
  transitionKeys.key = null; transitionKeys.blockInput = false;
  if ($('#typing')) $('#typing').readOnly = false;
}
window.addEventListener('keyup', releaseTransitionKey);
window.addEventListener('blur', releaseTransitionKey);
function frame(body) {
  sentenceCache.clear();
  app.innerHTML = `<header><a class="brand" href="#" aria-label="메인으로">타자 배틀</a></header><main>${body}</main><div class="toast" role="status" id="toast"></div>`;
  $('.brand').onclick = e => { e.preventDefault(); if (!room) home(); else toast('경기를 나가려면 나가기 버튼을 눌러주세요.'); };
}
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); setTimeout(() => $('#toast')?.classList.remove('show'), 3500); }
function inviteUrl(code = roomCode) {
  return code ? `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}` : '';
}
function syncLanguageControl() {
  const control = $('#language');
  if (!control) return;
  const custom = sentenceSource === 'custom';
  control.disabled = custom;
  control.innerHTML = custom
    ? '<option value="custom">사용자 지정</option>'
    : `<option value="ko" ${language === 'ko' ? 'selected' : ''}>한국어</option><option value="en" ${language === 'en' ? 'selected' : ''}>영어</option>`;
}
function addPersonalSettings(container) {
  container.insertAdjacentHTML('beforeend', '<details class="personal-settings"><summary>개인 설정</summary></details>');
  $('.personal-settings').insertAdjacentHTML('beforeend', `<label for="next-mode">문장 전환 방식</label><select id="next-mode"><option value="input" ${!autoNext ? 'selected' : ''}>문장 완성 후 추가 입력으로 다음 문장</option><option value="auto" ${autoNext ? 'selected' : ''}>문장 완성 후 자동으로 다음 문장</option></select>`);
  $('#next-mode').onchange = event => {
    autoNext = event.target.value === 'auto';
    save('tb-next-mode', autoNext ? 'auto' : 'input');
    if (autoNext && self?.waiting) submitInput(true);
    if (room) refresh();
  };
  $('.personal-settings').insertAdjacentHTML('beforeend', `<label for="sound-enabled">효과음</label><select id="sound-enabled"><option value="on" ${soundEnabled ? 'selected' : ''}>켜기</option><option value="off" ${!soundEnabled ? 'selected' : ''}>끄기</option></select><label for="sound-volume">효과음 크기 <output id="sound-level">${soundVolume}%</output></label><input id="sound-volume" type="range" min="0" max="200" step="5" value="${soundVolume}" ${soundEnabled ? '' : 'disabled'}>`);
  $('#sound-enabled').onchange = event => {
    soundEnabled = event.target.value === 'on';
    save('tb-sound-enabled', String(soundEnabled)); sounds.setEnabled(soundEnabled);
    $('#sound-volume').disabled = !soundEnabled;
    if (soundEnabled) sounds.unlock();
  };
  $('#sound-volume').oninput = event => {
    soundVolume = Number(event.target.value); save('tb-sound-volume', String(soundVolume));
    $('#sound-level').textContent = `${soundVolume}%`; sounds.setVolume(soundVolume / 100); sounds.unlock();
  };
  $('.personal-settings').insertAdjacentHTML('beforeend', `<label for="music-enabled">배경음악</label><select id="music-enabled"><option value="on" ${musicEnabled ? 'selected' : ''}>켜기</option><option value="off" ${!musicEnabled ? 'selected' : ''}>끄기</option></select><label for="music-volume">배경음악 크기 <output id="music-level">${musicVolume}%</output></label><input id="music-volume" type="range" min="0" max="200" step="5" value="${musicVolume}" ${musicEnabled ? '' : 'disabled'}>`);
  $('#music-enabled').onchange = event => {
    musicEnabled = event.target.value === 'on';
    save('tb-music-enabled', String(musicEnabled)); music.setEnabled(musicEnabled);
    $('#music-volume').disabled = !musicEnabled;
  };
  $('#music-volume').oninput = event => {
    musicVolume = Number(event.target.value); save('tb-music-volume', String(musicVolume));
    $('#music-level').textContent = `${musicVolume}%`; music.setVolume(musicVolume / 100);
  };
  const audioSettings = document.createElement('div');
  audioSettings.className = 'audio-settings';
  $('.personal-settings').append(audioSettings);
  for (const kind of ['sound', 'music']) {
    const group = document.createElement('div');
    group.className = 'audio-setting';
    for (const field of ['enabled', 'volume']) {
      group.append($(`label[for="${kind}-${field}"]`), $(`#${kind}-${field}`));
    }
    audioSettings.append(group);
  }
}
function home() {
  sounds.reset();
  music.setScene('lobby');
  frame(`<section class="launch"><div class="tabs" role="tablist" aria-label="플레이 모드">${[['single', '싱글플레이'], ['create', '방 생성'], ['join', '방 참가']].map(([id, label]) => `<button role="tab" aria-selected="${tab === id}" data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`).join('')}</div><form id="launch-form"><label for="nickname">닉네임</label><input id="nickname" placeholder="닉네임을 입력해주세요." maxlength="12" value="${esc(nickname)}" autocomplete="off">${tab === 'create' ? '<div class="form-row"><div><label for="room-title">방 이름</label><input id="room-title" maxlength="30" value="즐거운 타자배틀" required></div><div><label for="capacity">최대 인원</label><select id="capacity"><option value="2">2명</option><option value="3">3명</option><option value="4" selected>4명</option></select></div></div>' : tab === 'join' ? `<label for="room-code">참가 코드</label><input id="room-code" required inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="숫자 6자리" value="${esc(pendingInviteCode)}" autocomplete="off">` : ''}${tab !== 'join' ? `<label for="language">언어</label><select id="language"><option value="ko" ${language === 'ko' ? 'selected' : ''}>한국어</option><option value="en" ${language === 'en' ? 'selected' : ''}>영어</option></select>` : ''}<p id="form-error" class="error" role="alert">${esc(error)}</p><button class="primary launch-button" ${busy ? 'disabled' : ''}>${busy ? '연결 중…' : tab === 'single' ? '시작' : tab === 'create' ? '방 만들기' : '참가'} </button></form></section>`);
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { nickname = $('#nickname').value; tab = b.dataset.tab; error = ''; home(); });
  addPersonalSettings($('#launch-form'));
  if ($('#language')) $('#language').onchange = e => { language = e.target.value; };
  if (tab !== 'join') {
    $('#form-error').insertAdjacentHTML('beforebegin', `<label for="game-mode">경기 방식</label><select id="game-mode"><option value="race" ${gameMode === 'race' ? 'selected' : ''}>완주 · 전체 문장 입력</option><option value="timed" ${gameMode === 'timed' ? 'selected' : ''}>시간 제한</option></select><div id="duration-setting" ${gameMode === 'race' ? 'hidden' : ''}><label for="duration">제한 시간 (초)</label><input id="duration" type="number" min="1" max="3600" step="1" value="${esc(duration)}" ${gameMode === 'race' ? 'disabled' : 'required'}></div><label for="sentence-source">문장</label><select id="sentence-source"><option value="default" ${sentenceSource === 'default' ? 'selected' : ''}>기본 문장</option><option value="custom" ${sentenceSource === 'custom' ? 'selected' : ''}>직접 입력</option></select><div id="custom-editor" ${sentenceSource === 'custom' ? '' : 'hidden'}><label for="custom-text">사용할 문장</label><textarea id="custom-text" rows="6" maxlength="10000" aria-describedby="custom-help" placeholder="한 줄에 한 문장씩 입력해주세요.">${esc(customText)}</textarea><p id="custom-help" class="custom-help">줄바꿈마다 한 문장 · 빈 줄 제외 · 최대 50문장, 한 문장 160자</p></div><label for="sentence-order">출제 순서</label><select id="sentence-order"><option value="sequential" ${sentenceOrder === 'sequential' ? 'selected' : ''}>순서대로</option><option value="random" ${sentenceOrder === 'random' ? 'selected' : ''}>무작위</option></select>`);
    $('#game-mode').onchange = e => { gameMode = e.target.value; $('#duration-setting').hidden = gameMode === 'race'; $('#duration').disabled = gameMode === 'race'; $('#duration').required = gameMode !== 'race'; };
    const durationInput = $('#duration');
    durationInput.type = 'text';
    durationInput.inputMode = 'numeric';
    durationInput.pattern = '[0-9]+';
    durationInput.onbeforeinput = event => {
      if (event.inputType?.startsWith('insert') && event.data && /[^0-9]/.test(event.data)) event.preventDefault();
    };
    durationInput.oninput = () => {
      const text = durationInput.value, cursor = durationInput.selectionStart;
      const digits = text.replace(/[^0-9]/g, '');
      if (digits !== text) {
        durationInput.value = digits;
        const position = text.slice(0, cursor).replace(/[^0-9]/g, '').length;
        durationInput.setSelectionRange(position, position);
      }
      duration = digits;
    };
    durationInput.onkeydown = event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      durationInput.blur();
    };
    $('#sentence-source').onchange = e => { sentenceSource = e.target.value; $('#custom-editor').hidden = sentenceSource !== 'custom'; syncLanguageControl(); $('#form-error').textContent = ''; };
    $('#sentence-order').onchange = e => { sentenceOrder = e.target.value; };
    $('#custom-text').oninput = e => { customText = e.target.value; $('#form-error').textContent = ''; };
  }
  // Keep labels and controls together when switching between one and two columns.
  document.querySelectorAll('#launch-form > label').forEach(label => {
    const control = label.nextElementSibling;
    const field = document.createElement('div');
    field.className = 'form-field';
    label.before(field); field.append(label, control);
  });
  $('.launch').classList.toggle('join-layout', tab === 'join');
  $('.launch').classList.toggle('single-layout', tab !== 'join');
  if (tab !== 'join') {
    const form = $('#launch-form');
    const fields = document.createDocumentFragment();
    const nicknameField = $('#nickname').parentElement;
    nicknameField.classList.add('full-width');
    fields.append(nicknameField);
    if (tab === 'create') fields.append($('#room-title').closest('.form-row'));
    for (const pair of [['sentence-source', 'language'], ['game-mode', 'sentence-order']]) {
      const row = document.createElement('div');
      row.className = 'single-row';
      pair.forEach(id => row.append($('#' + id).parentElement));
      fields.append(row);
    }
    fields.append($('#duration-setting'), $('#custom-editor'));
    form.prepend(fields);
    $('label[for="game-mode"]').textContent = '방식';
    $('label[for="sentence-order"]').textContent = '순서';
    $('#game-mode option[value="race"]').textContent = '완주';
  }
  syncLanguageControl();
  setupNicknameInput($('#nickname'), { blurOnEnter: true });
  $('#launch-form').onsubmit = launch;
}
function setupNicknameInput(input, options = {}) {
  const hint = document.createElement('p');
  hint.id = `${input.id}-limit`;
  hint.className = 'nickname-error';
  hint.setAttribute('role', 'status');
  input.setAttribute('aria-describedby', hint.id);
  (input.closest('.lobby-profile-row') || input).after(hint);
  let previousName = input.value;
  bindNicknameInput(input, { ...options, onChange: () => {
    if (input.value !== previousName) { previousName = input.value; sounds.unlock(); sounds.play('ui'); }
    options.onChange?.();
  }, showError: message => { hint.textContent = message; } });
}
async function launch(e) {
  e.preventDefault(); if (busy) return;
  nickname = $('#nickname').value.trim() || `플레이어${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
  $('#nickname').value = nickname;
  error = '';
  if (tab !== 'join' && gameMode === 'timed') {
    try { duration = R.durationSeconds(duration); } catch (e) { error = e.message; $('#form-error').textContent = error; $('#duration').focus(); return; }
  }
  if (tab !== 'join' && sentenceSource === 'custom') {
    try { R.parseCustomSentences(customText); } catch (e) { error = e.message; $('#form-error').textContent = error; $('#custom-text').focus(); return; }
  }
  if (tab === 'single') { startSolo(); return; }
  const title = $('#room-title')?.value, max = Number($('#capacity')?.value || 4), code = $('#room-code')?.value.trim() || pendingInviteCode;
  busy = true; $('.launch-button').disabled = true; $('.launch-button').textContent = '서버에 연결 중…';
  let connectionStep = '서버 인증';
  try {
    const { Client } = await import('@heroiclabs/nakama-js');
    const ssl = import.meta.env.VITE_NAKAMA_SSL === 'true';
    const client = new Client(import.meta.env.VITE_NAKAMA_KEY || 'defaultkey', import.meta.env.VITE_NAKAMA_HOST || location.hostname, import.meta.env.VITE_NAKAMA_PORT || '7350', ssl);
    client.timeout = 6000;
    let device = sessionStorage.getItem('tb-device'); if (!device) { device = crypto.randomUUID(); sessionStorage.setItem('tb-device', device); }
    session = await client.authenticateDevice(device, true);
    socket = client.createSocket(ssl, false);
    socket.ondisconnect = () => { if (room && mode === 'multi') { error = '서버 연결이 끊겼습니다. 방에 다시 입장해주세요.'; room = null; socket = null; home(); } };
    socket.onmatchdata = event => {
      if (event.op_code !== 1) return;
      const next = JSON.parse(decoder.decode(event.data));
      offset = next.serverNow - Date.now();
      const mine = next.players.find(p => p.id === session.user_id);
      if (mine && (!self || next.phase === 'lobby' || next.phase === 'result' || mine.seq >= self.seq)) self = { ...mine };
      if (next.phase === 'lobby') { resultSaved = false; composing = false; seq = 0; }
      room = next;
      roomCode = next.code || roomCode;
      if (room.phase !== displayedPhase) arena(); else refresh();
    };
    connectionStep = '실시간 연결';
    await socket.connect(session, true);
    connectionStep = tab === 'create' ? '방 생성' : '참가 코드 조회';
    const resolved = tab === 'create'
      ? (await client.rpc(session, 'create_battle', { title, max, language, gameMode, sentenceOrder, duration: gameMode === 'race' ? undefined : duration, ...(sentenceSource === 'custom' ? { customText } : {}) })).payload
      : (await client.rpc(session, 'resolve_battle', { code })).payload;
    matchId = resolved.matchId; roomCode = resolved.code;
    mode = 'multi'; self = null; seq = 0; displayedPhase = ''; resultSaved = false;
    connectionStep = '방 입장';
    const joined = await socket.joinMatch(matchId, undefined, { name: nickname });
    matchId = joined.match_id;
    pendingInviteCode = '';
    if (location.search) history.replaceState(null, '', location.pathname);
    if (!room) { room = { title: title || '타자 배틀', phase: 'lobby', host: '', max, players: [] }; arena(); }
  } catch (e) {
    room = null; socket?.disconnect(); socket = null;
    if (tab === 'join') pendingInviteCode = code;
    error = connectionStep === '방 생성' ? '서버에 연결했지만 방 생성에 실패했습니다. 서버가 최신 버전으로 실행 중인지 확인해주세요.'
      : connectionStep === '참가 코드 조회' ? '참가 코드를 조회하지 못했습니다. 코드가 맞는지, 방이 종료되지 않았는지 확인해주세요.'
      : connectionStep === '방 입장' ? '방에 입장하지 못했습니다. 경기 중이거나 방이 가득 찼을 수 있습니다.'
      : `${connectionStep}에 실패했습니다. 서버 주소와 실행 상태를 확인해주세요.`;
    console.error(e); home();
  } finally { busy = false; if (!room) home(); }
}
function startSolo() {
  mode = 'single'; offset = 0; seq = 0; resultSaved = false; composing = false;
  self = R.player('me', nickname);
  const customSentences = sentenceSource === 'custom' ? R.parseCustomSentences(customText) : null;
  room = { gameMode, duration: gameMode === 'race' ? 60 : duration, language, customSentences, sentenceOrder, sentences: sentenceOrder === 'sequential' ? (customSentences || R.sentencesFor(language)).slice() : R.shuffledSentences(null, language, customSentences), title: gameMode === 'race' ? '완주' : '시간 제한', phase: 'countdown', players: [self], host: 'me', max: 1, startAt: Date.now() + 3000, endAt: gameMode === 'race' ? 0 : Date.now() + 3000 + duration * 1000 };
  arena();
}
function matchSentences() { return room?.sentences || R.sentencesFor(room?.language); }
function isRace() { return room?.gameMode === 'race'; }
function expired() { return !isRace() && now() >= room.endAt; }
function targetAt(line) { const list = matchSentences(); return list[isRace() ? line : line % list.length]; }
function elapsed(p) { return Math.max(0, ((p?.finished || (isRace() ? now() : Math.min(now(), room.endAt))) - room.startAt) / 1000); }
function comparePlayers(a, b) {
  if (isRace()) return R.compare(a, b, matchSentences());
  if (a.left !== b.left) return a.left ? 1 : -1;
  return R.strokeProgress(b, matchSentences()) - R.strokeProgress(a, matchSentences()) || R.accuracy(b) - R.accuracy(a);
}
function now() { return Date.now() + offset; }
function cpm(p) { return room?.startAt ? R.typingSpeed(p, elapsed(p), matchSentences()) : 0; }
function sentence(p) {
  const text = (p.finished ? null : targetAt(p.line)); if (!text) return '<span class="complete-text">모든 문장을 완성했습니다.</span>';
  const previous = sentenceCache.get(p.id);
  if (previous && previous.target === text && previous.text === p.text && previous.cursor === p.cursor && previous.composing === p.composing) return previous.html;
  const html = [...text].map((ch, i) => `<span class="${R.letterState(p.text[i], ch, p.composing && i === p.cursor - 1, text[i + 1])} ${i === p.cursor ? 'caret' : ''}">${esc(ch)}</span>`).join('');
  sentenceCache.set(p.id, { target: text, text: p.text, cursor: p.cursor, composing: p.composing, html });
  return html;
}
function raceProgress(p) {
  if (!isRace()) return '';
  const total = matchSentences().length, completed = p.line;
  const percent = p.finished ? 100 : total ? Math.min(100, Math.max(0, completed / total * 100)) : 0;
  const label = `${Math.floor(percent)}%`;
  return `<div class="race-progress"><div class="race-progress-label"><span>완주 진행도</span><strong>${label}</strong></div><progress max="100" value="${percent}" aria-label="${esc(p.name)} 완주 진행도">${label}</progress></div>`;
}
function mini(p) { return `<article class="opponent ${p.left ? 'disconnected' : ''}"><div class="mini-head"><span><span class="avatar">${esc(p.name.slice(0, 1))}</span>${esc(p.name)}</span><span class="mini-badge">${p.left ? '연결 끊김' : p.finished ? '완료' : p.waiting ? '전환 대기' : '입력 중'}</span></div>${raceProgress(p)}<div class="mini-sentence">${sentence(p)}</div><div class="mini-input">${esc(p.text) || '<span class="muted">입력을 기다리는 중</span>'}</div><div class="mini-foot"><span>문장 ${isRace() ? Math.min(p.line + 1, matchSentences().length) + ' / ' + matchSentences().length : p.line + 1}</span><span><span class="mini-speed"></span> <small>타/분</small></span></div></article>`; }
function arena() {
  transitionKeys.key = null; transitionKeys.blockInput = false;
  displayedPhase = room.phase;
  const isLobby = room.phase === 'lobby', isResult = room.phase === 'result';
  frame(`<section class="arena"><div class="arena-title"><div><h2>${esc(room.title)}</h2><span class="room-language" id="room-language">${room.customSentences ? '직접 입력' : room.language === 'en' ? '영어' : '한국어'}</span></div><button class="ghost" id="leave">나가기</button></div>${isLobby ? `<div class="lobby-layout"><section class="panel"><div class="section-top"><span>대기실</span><span id="count"></span></div><div class="lobby-profile"><label for="lobby-nickname">닉네임</label><div class="lobby-profile-row"><input id="lobby-nickname" placeholder="닉네임을 입력해주세요." maxlength="12" autocomplete="off"></div></div><div id="players"></div><div id="lobby-action"></div></section><aside class="panel invite"><label for="share-code">참가 코드</label><input id="share-code" readonly value="${esc(room.code || roomCode)}"><label for="invite-link">초대 링크</label><input id="invite-link" readonly value="${esc(inviteUrl(room.code || roomCode))}"><button class="primary" id="copy">초대 링크 복사</button></aside></div>` : isResult ? '<div id="results"></div>' : `<div id="opponents" class="opponents"></div><div class="match-strip"><span id="phase-label">경기 준비</span><div><strong id="timer">${isRace() ? 0 : room.duration || 60}</strong><span id="timer-label">초 남음</span></div><span id="rank">—</span></div><section class="typing-panel"><div class="typing-head"><span>${esc(nickname)}</span><span id="line-number">01 / ${matchSentences().length}</span></div><div id="target" class="target" lang="${room.language === 'en' ? 'en' : 'ko'}"></div><div id="next-preview" class="next-preview"><span>다음</span><p id="next-sentence" lang="${room.language === 'en' ? 'en' : 'ko'}"></p></div><label for="typing" class="sr-only">위 문장을 입력하세요</label><input id="typing" class="typing-input" lang="${room.language === 'en' ? 'en' : 'ko'}" placeholder="잠시 후 시작합니다" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" maxlength="160"><button type="button" class="primary next-sentence-button" id="next-button" hidden>다음 문장</button><div class="typing-footer"><span id="input-hint">문장을 정확하게 입력한 뒤 Enter를 누르거나 문자·공백을 추가로 입력해 완성을 확정해주세요.</span><div><span><b id="cpm">0</b> 타/분</span><span><b id="accuracy">100</b> % 정확도</span></div></div></section>`}</section>`);
  if (isRace() && !isLobby && !isResult) $('.match-strip').insertAdjacentHTML('beforeend', '<div id="self-progress"></div>');
  $('#leave').onclick = leave;
  if (!isLobby) addPersonalSettings($('.arena'));
  if ($('#next-button')) $('#next-button').onclick = () => { if (self?.waiting) submitInput(true); };
  if (room.phase === 'countdown') {
    $('.arena').insertAdjacentHTML('beforeend', '<div class="countdown-overlay" role="status" aria-live="polite"><div class="countdown-content"><strong id="countdown-number" aria-label="시작까지 남은 초">3</strong></div></div>');
  }
  if (isLobby) {
    addPersonalSettings($('.lobby-layout > .panel'));
    const nameInput = $('#lobby-nickname');
    nameInput.value = self?.name || nickname;
    let lastSentName = nameInput.value;
    const applyName = (fillEmpty = false) => {
      if (!nameInput.isConnected || room?.phase !== 'lobby') return;
      let nextName = nameInput.value.trim();
      if (!nextName && fillEmpty) {
        nextName = `플레이어${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
        nameInput.value = nextName;
      }
      if (!nextName || nextName === lastSentName) return;
      nickname = nextName.slice(0, 12);
      lastSentName = nickname;
      send(6, { name: nickname });
    };
    setupNicknameInput(nameInput, { onChange: () => applyName(), onBlur: () => applyName(true), blurOnEnter: true });
    $('#copy').onclick = async () => {
      const link = inviteUrl();
      try { await navigator.clipboard.writeText(link); toast('초대 링크를 복사했습니다.'); }
      catch { $('#invite-link').select(); toast('선택된 링크를 직접 복사해주세요.'); }
    };
  }
  const input = $('#typing');
  if (input) {
    input.disabled = true;
    input.value = self?.text || '';
    attachTypingInput(input);
    document.querySelectorAll('.typing-panel, .opponents').forEach(panel => {
      panel.oncopy = blockClipboard;
      panel.oncut = blockClipboard;
      panel.ondragstart = e => e.preventDefault();
    });
  }
  refresh();
}
function blockClipboard(e) { e.preventDefault(); toast('타자 영역에서는 복사·붙여넣기를 사용할 수 없습니다. 직접 입력해주세요.'); }
function attachTypingInput(input) {
  bindTypingInput(input, {
    state: () => ({ enabled: !finalizingInput && room?.phase === 'playing' && !!self && !self.finished && !expired(), waiting: !!self?.waiting, text: self?.text || '', cursor: self?.cursor || 0 }),
    transitionKeys,
    submit: submitInput,
    onType: () => sounds.play('type'),
    setComposing: value => { composing = value; },
    blockClipboard
  });
}
function renewTypingInput(input) {
  // A new DOM input starts a fresh native IME session; late events stay on the old node.
  const replacement = input.cloneNode(false);
  replacement.value = self?.text || '';
  input.replaceWith(replacement);
  attachTypingInput(replacement);
  return replacement;
}
async function send(op, data = {}) { try { await socket.sendMatchState(matchId, op, encoder.encode(JSON.stringify(data))); } catch { toast('입력 전송에 실패했습니다. 연결 상태를 확인해주세요.'); } }
function applyInput(data) {
  R.update(self, data, now(), matchSentences(), !isRace());
  if (mode === 'multi') send(4, data);
}
function submitInput(advance = false) {
  if (finalizingInput) return;
  if (room?.phase !== 'playing' || !self || self.finished || expired()) return;
  const input = $('#typing');
  const inputMatched = input.value === targetAt(self.line) && !self.waiting;
  const oldCommitted = self.committed, oldAttempts = self.attempts, oldCorrect = self.correct;
  // Keep the native input and selection while waiting for confirmation.
  // Only an actual sentence transition needs a fresh IME session.
  const resetInputSession = (autoNext && inputMatched) || (advance && self.waiting);
  const restoreFocus = document.activeElement === input || document.activeElement === $('#next-button');
  const data = { line: self.line, text: input.value, cursor: input.selectionStart, composing: resetInputSession ? false : composing, seq: ++seq, advance: advance === true };
  if (resetInputSession) { finalizingInput = true; composing = false; input.blur(); }
  applyInput(data);
  // Automatic mode uses the same confirmation request as an extra input.
  if (autoNext && inputMatched && self.waiting) {
    applyInput({ line: self.line, text: self.text, advance: true, seq: ++seq });
  }
  if (self.line !== data.line) sounds.play('complete');
  else if (!advance && !self.composing && self.committed !== oldCommitted) {
    if (self.attempts - oldAttempts > self.correct - oldCorrect) sounds.play('error');
  }
  if (!composing && self.text !== input.value) input.value = self.text;
  const replacement = resetInputSession ? renewTypingInput(input) : null;
  refresh();
  if (resetInputSession) {
    finalizingInput = false;
    // Refocus after the native event batch, rather than inside compositionend/input.
    setTimeout(() => {
      if (restoreFocus && replacement.isConnected && !replacement.disabled && room?.phase === 'playing'
        && (!document.activeElement || document.activeElement === document.body || document.activeElement === replacement || document.activeElement === $('#next-button'))) {
        replacement.focus({ preventScroll: true });
        replacement.setSelectionRange(replacement.value.length, replacement.value.length);
      }
    }, 0);
  }
}
function refresh() {
  if (!room) return;
  sounds.observe(room, now());
  music.setScene(room.phase);
  const roomLanguage = room.customSentences ? `직접 입력 · ${room.customSentences.length}문장 · ${room.sentenceOrder === 'sequential' ? '입력 순서대로' : '무작위'}` : room.language === 'en' ? '영어' : '한국어';
  setText($('#room-language'), roomLanguage + (isRace() ? ' · 완주' : ` · ${room.duration || 60}초`));
  if (room.phase === 'lobby') {
    $('#share-code').value = room.code || roomCode;
    $('#invite-link').value = inviteUrl(room.code || roomCode);
    setText($('#count'), `${room.players.length} / ${room.max}`);
    setHTML($('#players'), room.players.map(p => `<div class="lobby-player"><span class="avatar">${esc(p.name.slice(0, 1))}</span><strong>${esc(p.name)}</strong><span>${p.id === room.host ? '방장' : p.ready ? '준비 완료' : '준비 중'}</span></div>`).join(''));
    const host = room.host === session?.user_id;
    setHTML($('#lobby-action'), `<button class="primary" id="ready" ${host && (room.players.length < 2 || room.players.some(p => p.id !== room.host && !p.ready)) ? 'disabled' : ''}>${host ? '경기 시작하기' : self?.ready ? '준비 취소' : '준비 완료'}</button>`);
    $('#ready').onclick = () => send(host ? 3 : 2); return;
  }
  if (room.phase === 'result') { results(); return; }
  if (!self) return;
  if (isRace()) setHTML($('#self-progress'), raceProgress(self));
  const opponents = room.players.filter(p => p.id !== self.id);
  setHTML($('#opponents'), mode === 'single' ? '' : opponents.map(mini).join(''));
  document.querySelectorAll('.mini-speed').forEach((node, i) => setText(node, cpm(opponents[i])));
  const countdown = Math.max(0, Math.ceil((room.startAt - now()) / 1000));
  const countdownNumber = $('#countdown-number');
  if (countdownNumber && countdownNumber.textContent !== String(countdown || '시작!')) countdownNumber.textContent = String(countdown || '시작!');
  setText($('#timer'), room.phase === 'countdown' ? countdown : isRace() ? elapsed(self).toFixed(1) : Math.max(0, Math.ceil((room.endAt - now()) / 1000)));
  setText($('#timer-label'), room.phase === 'countdown' ? '초 후 시작' : isRace() ? '초 경과' : '초 남음');
  setText($('#phase-label'), room.phase === 'countdown' ? '곧 시작합니다' : self.finished ? '입력 완료 · 결과 대기' : '진행 중');
  const sorted = room.players.map(p => p.id === self.id ? self : p).sort(comparePlayers);
  setText($('#rank'), mode === 'single' ? '' : `${sorted.findIndex(p => p.id === self.id) + 1} / ${sorted.length} 위`);
  const target = $('#target'), preview = $('#next-sentence');
  const advancing = target.dataset.line !== undefined && self.line === Number(target.dataset.line) + 1
    && !!targetAt(self.line) && !$('#next-preview').hidden;
  const animate = advancing && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const previousRect = animate ? preview.getBoundingClientRect() : null;
  const previousSize = animate ? parseFloat(getComputedStyle(preview).fontSize) : 0;
  setHTML(target, sentence(self));
  target.dataset.line = String(self.line);
  const nextSentence = targetAt(self.line + 1);
  $('#next-preview').hidden = !nextSentence || !!self.finished;
  setText(preview, nextSentence || '');
  if (animate) {
    target.getAnimations().forEach(animation => animation.cancel());
    const destination = target.getBoundingClientRect();
    const scale = previousSize / parseFloat(getComputedStyle(target).fontSize);
    target.animate([
      { transform: `translate(${previousRect.left - destination.left}px, ${previousRect.top - destination.top}px) scale(${scale})`, opacity: 0.7 },
      { transform: 'translate(0, 0) scale(1)', opacity: 1 }
    ], { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    if (nextSentence) {
      preview.getAnimations().forEach(animation => animation.cancel());
      preview.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: 100, fill: 'backwards' });
    }
  }
  setText($('#line-number'), isRace() ? `${Math.min(self.line + 1, matchSentences().length)} / ${matchSentences().length}` : `문장 ${self.line + 1}`);
  setText($('#cpm'), cpm(self)); setText($('#accuracy'), R.accuracy(self));
  const lastSentence = isRace() && self.line === matchSentences().length - 1;
  setText($('#input-hint'), autoNext ? '문장을 정확하게 입력하면 자동으로 다음 문장으로 넘어갑니다.' : self.waiting ? lastSentence ? '입력 확인! Enter를 누르거나 문자·공백을 추가로 입력하면 완주가 확정됩니다.' : '입력 확인! Enter를 누르거나 문자·공백을 추가로 입력하면 다음 문장으로 넘어갑니다.' : '문장을 정확하게 입력한 뒤 Enter를 누르거나 문자·공백을 추가로 입력해 완성을 확정해주세요.');
  setText($('#next-button'), lastSentence ? '완주 확정' : '다음 문장');
  $('#typing').readOnly = transitionKeys.blockInput;
  $('#typing').maxLength = self.waiting ? 161 : 160;
  $('#next-button').hidden = !self.waiting;
  $('#next-button').disabled = room.phase !== 'playing' || expired();
  const input = $('#typing'), enabled = room.phase === 'playing' && !self.finished && !expired();
  const wasDisabled = input.disabled; input.disabled = !enabled;
  input.placeholder = enabled ? '위 문장을 여기에 입력하세요' : self.finished ? '모든 문장을 완성했습니다.' : '카운트다운 후 입력할 수 있습니다';
  if (enabled && wasDisabled) input.focus();
}
function results() {
  const players = room.players.slice().sort(comparePlayers);
  if (!resultSaved && self) { const bestKey = room.language === 'en' ? 'tb-best-en-v1' : 'tb-best-jamo-v1'; best = Math.max(Number(saved(bestKey, '0')), cpm(self)); save(bestKey, String(best)); resultSaved = true; }
  let lastRank = 1;
  setHTML($('#results'), `<section class="result-panel"><h1>결과</h1>${isRace() ? `<p class="finish-time">완주 시간 <strong>${self?.finished ? elapsed(self).toFixed(2) + '초' : '미완주'}</strong></p>` : `<p class="finish-time">${room.duration || 60}초 기록 <strong>${self ? R.strokeProgress(self, matchSentences()) : 0}타</strong></p>`}<div class="result-metrics"><div><span>나의 타수</span><strong>${self ? cpm(self) : 0}<small>타/분</small></strong></div><div><span>정확도</span><strong>${self ? R.accuracy(self) : 100}<small>%</small></strong></div><div><span>완성한 문장</span><strong>${self?.line || 0}<small>${isRace() ? '/ ' + matchSentences().length : '개'}</small></strong></div></div><div class="result-table">${players.map((p, i) => { if (i && comparePlayers(players[i - 1], p) !== 0) lastRank = i + 1; return `<div><span class="result-rank">${String(lastRank).padStart(2, '0')}</span><strong>${esc(p.name)} ${p.id === self?.id ? '<small>나</small>' : ''}</strong><span>${isRace() ? p.finished ? elapsed(p).toFixed(2) + '초' : '미완주' : R.strokeProgress(p, matchSentences()) + '타'}</span><span>${p.left ? '이탈' : p.finished ? '완료' : '시간 종료'}</span></div>`; }).join('')}</div><div class="result-actions"><button class="primary" id="again" ${mode === 'multi' && room.host !== session?.user_id ? 'disabled' : ''}>${mode === 'single' ? '다시 시작' : room.host === session?.user_id ? '대기실로 돌아가기' : '방장의 대기실 복귀를 기다리는 중'}</button><button class="ghost" id="result-home">메인으로</button></div></section>`);
  $('#again').onclick = () => mode === 'single' ? startSolo() : send(5);
  $('#result-home').onclick = leave;
}
async function leave() { const old = socket; room = null; self = null; socket = null; displayedPhase = ''; if (old) { old.onmatchdata = () => {}; old.ondisconnect = () => {}; try { await old.leaveMatch(matchId); } catch {} old.disconnect(); } error = ''; home(); }
setInterval(() => {
  if (!room || room.phase === 'lobby' || room.phase === 'result') return;
  if (mode === 'single') {
    if (room.phase === 'countdown' && now() >= room.startAt) room.phase = 'playing';
    if (room.phase === 'playing' && (expired() || (isRace() && self.finished))) room.phase = 'result';
  }
  if (displayedPhase !== room.phase) arena(); else refresh();
}, 100);
const initialInviteCode = new URLSearchParams(location.search).get('room')?.trim();
if (/^\d{6}$/.test(initialInviteCode || '')) {
  tab = 'join';
  pendingInviteCode = initialInviteCode;
  home();
  queueMicrotask(() => $('#launch-form')?.requestSubmit());
} else {
  home();
}
