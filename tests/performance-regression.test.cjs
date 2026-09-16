const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function rules() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync('shared/rules.js', 'utf8'), context);
  return context.BattleRules;
}

test('모든 한글 음절과 비한글 문자의 자소 계산 결과를 유지한다', () => {
  const r = rules();
  const vowels = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  const finals = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
  for (let code = 0; code < 11172; code++) {
    const vowel = vowels[Math.floor(code / 28) % 21], final = finals[code % 28];
    const expected = 2 + Number('ㅘㅙㅚㅝㅞㅟㅢ'.includes(vowel))
      + (final === ' ' ? 0 : 1 + Number('ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ'.includes(final)));
    assert.equal(r.strokes(String.fromCharCode(44032 + code)), expected, String(code));
  }
  assert.equal(r.strokes('ABC 12.ㄱㅘ😀'), 'ABC 12.ㄱㅘ😀'.length);
});

test('반복 경기의 진행도는 기존 누적 방식과 같고 문장 목록 변경도 반영한다', () => {
  const r = rules(), p = r.player('a', 'A');
  for (const list of [['값과 괜찮아.', 'ABC', '값과 괜찮아.'], ['가'], r.sentencesFor('en')]) {
    for (const line of [0, 1, 2, 14, 15, 16, 149, 150, 151, 10000]) {
      p.line = line;
      for (const committed of ['', list[line % list.length], list[line % list.length].slice(0, 2) + 'X']) {
        p.committed = committed;
        let chars = 0, strokes = 0, end = 0;
        for (let i = 0; i < line; i++) { chars += list[i % list.length].length; strokes += r.strokes(list[i % list.length]); }
        const target = list[line % list.length];
        while (end < committed.length && committed[end] === target[end]) end++;
        assert.equal(r.progress(p, list), chars + end);
        assert.equal(r.strokeProgress(p, list), strokes + r.strokes(committed.slice(0, end)));
      }
    }
    list[0] = '변경된 문장';
    p.line = list.length * 2; p.committed = '';
    assert.equal(r.strokeProgress(p, list), list.reduce((sum, text) => sum + r.strokes(text), 0) * 2);
  }
});

function ui() {
  const nodes = new Map();
  const get = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      dataset: {}, hidden: true, disabled: false, textWrites: 0, htmlWrites: 0,
      get textContent() { return this.text || ''; },
      set textContent(value) { this.text = String(value); this.textWrites++; },
      set innerHTML(value) { this.html = value; this.htmlWrites++; },
      focus() {}
    });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    document: { querySelector: get, querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener() {}, matchMedia: () => ({ matches: true }) },
    localStorage: { getItem() {}, setItem() {} }, TextEncoder, TextDecoder,
    URL, URLSearchParams,
    location: { origin: 'http://localhost:5173', pathname: '/', hostname: 'localhost', search: '' },
    history: { replaceState() {} },
    setInterval() {}, requestAnimationFrame() {}, performance: { now: () => 10000 }, Date: { now: () => 10000 }
  });
  vm.runInContext(fs.readFileSync('shared/rules.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('src/server-url.js', 'utf8').replaceAll('export function', 'function'), context);
  const source = fs.readFileSync('src/main.js', 'utf8').replace(/^import .*;\r?\n/gm, '')
    .replaceAll('import.meta.env', '({})').split('const initialInviteCode =')[0];
  vm.runInContext(fs.readFileSync('src/sounds.js', 'utf8').replace('export function', 'function'), context);
  vm.runInContext(fs.readFileSync('src/music.js', 'utf8').replace('export function', 'function'), context);
  vm.runInContext(fs.readFileSync('src/typing-input.js', 'utf8').replace('export function', 'function'), context);
  vm.runInContext(source, context);
  vm.runInContext(`
    mode = 'single'; self = R.player('me', '나');
    room = { phase: 'playing', gameMode: 'race', language: 'ko', startAt: 9000,
      players: [self], sentences: ['값과', '다음'], host: 'me', max: 1 };
  `, context);
  return { context, get, run: code => vm.runInContext(code, context) };
}

test('수동·자동 문장 전환은 같은 입력창과 포커스를 유지하고 바로 다음 글자를 받는다', () => {
  for (const automatic of [false, true]) {
    const f = ui(), input = f.get('#typing');
    input.value = '값과'; input.selectionStart = 2; input.isConnected = true;
    f.context.document.activeElement = input;
    for (const method of ['blur', 'focus', 'cloneNode', 'replaceWith']) input[method] = () => assert.fail(method);
    input.setSelectionRange = (start, end) => { input.selectionStart = start; input.selectionEnd = end; };
    f.run(`attachTypingInput($('#typing')); autoNext = ${automatic}; self.text = '값과'; self.waiting = ${!automatic}; submitInput(${!automatic})`);
    assert.equal(f.run('self.line'), 1);
    assert.equal(f.context.document.activeElement, input);
    assert.equal(f.get('#typing'), input);
    assert.equal(input.value, '');
    assert.equal(input.selectionStart, 0);
    input.value = '값과'; input.oninput({ inputType: 'insertCompositionText', isComposing: false });
    assert.equal(input.value, '');
    input.oncompositionstart();
    input.value = '다'; input.selectionStart = 1;
    input.oninput({ inputType: 'insertCompositionText', isComposing: true });
    assert.equal(f.run('self.text'), '다');
  }
});

test('타이머는 전체 화면 갱신 없이 0.01초 차이를 표시한다', () => {
  const f = ui();
  f.context.performance.now = () => 10231;
  f.run('refreshTimer()');
  assert.equal(f.get('#timer').textContent, '1.23');
  f.context.performance.now = () => 10241;
  f.run('refreshTimer()');
  assert.equal(f.get('#timer').textContent, '1.24');
  f.run("room.gameMode = 'timed'; room.endAt = 12000; refreshTimer()");
  assert.equal(f.get('#timer').textContent, '1.76');
});

test('자동 전환은 한글 조합 종료 후 같은 입력창을 비우고 잔여 이벤트를 차단한다', () => {
  const f = ui(), input = f.get('#typing');
  input.value = ''; input.isConnected = true; input.selectionStart = 0;
  f.run("room.sentences = ['가', '나']; autoNext = true; attachTypingInput($('#typing'))");
  input.oncompositionstart();
  input.value = '가'; input.selectionStart = 1;
  input.oninput({ isComposing: true, inputType: 'insertCompositionText' });
  assert.equal(f.run('self.line'), 0);
  assert.equal(input.value, '가');
  input.oncompositionend();
  assert.equal(f.run('self.line'), 1);
  assert.equal(input.value, '');
  input.value = '가'; input.oninput({ isComposing: false, inputType: 'insertCompositionText' });
  assert.equal(input.value, '');
  input.oncompositionstart(); input.value = '나'; input.selectionStart = 1;
  input.oninput({ isComposing: true, inputType: 'insertCompositionText' });
  input.oncompositionend();
  assert.equal(f.run('self.line'), 2);
  assert.equal(f.run('self.finished'), 10000);
});

test('정답 입력과 조합 종료는 입력창·포커스·커서를 그대로 유지한다', () => {
  const f = ui(), input = f.get('#typing');
  input.value = '값과'; input.selectionStart = 2; input.selectionEnd = 2;
  input.scrollLeft = 24;
  input.blur = () => assert.fail('전환 대기에서 포커스를 해제하면 안 됨');
  input.cloneNode = () => assert.fail('전환 대기에서 입력창을 교체하면 안 됨');
  input.focus = () => assert.fail('전환 대기에서 포커스를 다시 잡으면 안 됨');
  f.run('composing = true; submitInput()');
  assert.equal(f.run('self.waiting'), true);
  f.run('composing = false; submitInput(); refresh()');
  assert.equal(input.value, '값과');
  assert.equal(input.selectionStart, 2);
  assert.equal(input.selectionEnd, 2);
  assert.equal(input.scrollLeft, 24);
  assert.equal(f.run('self.line'), 0);
});

test('반복 화면 갱신은 문장 DOM을 유지하고 입력·커서·조합 변경은 즉시 반영한다', () => {
  const f = ui();
  f.run('refresh()');
  const target = f.get('#target'), before = target.html;
  for (let i = 0; i < 100; i++) f.run('refresh()');
  assert.equal(target.htmlWrites, 1);
  assert.equal(f.get('#room-language').textWrites, 1);
  assert.equal(f.get('#next-sentence').textWrites, 1);
  f.run("self.text = '가'; self.cursor = 1; self.composing = true; refresh()");
  assert.notEqual(target.html, before);
  assert.match(target.html, /class="composing/);
  f.run('self.composing = false; refresh()');
  assert.match(target.html, /class="wrong/);
  f.run('self.cursor = 0; refresh()');
  assert.match(target.html, /wrong caret/);
  f.run("self.line = 1; self.text = ''; refresh()");
  assert.match(target.html, /다/);
  f.run('self.finished = 10000; refresh()');
  assert.match(target.html, /모든 문장을 완성/);
});

test('싱글·멀티 진행도는 전환 확정에만 증가하고 마지막 입력은 완주를 기다린다', () => {
  for (const mode of ['single', 'multi']) {
    const f = ui();
    f.run(`mode = '${mode}'; room.sentences = ['A', 'Long sentence']; refresh()`);
    assert.match(f.get('#self-progress').html, /value="0"/);
    f.run("R.update(self, { line: 0, text: 'A', seq: 1 }, 10000, room.sentences); refresh()");
    assert.match(f.get('#self-progress').html, /value="0"/);
    assert.equal(f.get('#self-progress').htmlWrites, 1);
    f.run("R.update(self, { line: 0, text: 'A', advance: true, seq: 2 }, 11000, room.sentences); refresh()");
    assert.match(f.get('#self-progress').html, /value="50"/);
    f.run("R.update(self, { line: 1, text: 'Long sentence', seq: 3 }, 12000, room.sentences); refresh()");
    assert.match(f.get('#self-progress').html, /value="50"/);
    assert.equal(f.get('#next-button').textContent, '완주 확정');
    assert.match(f.get('#input-hint').textContent, /완주가 확정/);
    assert.equal(f.run('self.finished'), 0);
    assert.match(f.run('mini(self)'), /value="50"/);
    f.run("R.update(self, { line: 1, text: 'Long sentence', advance: true, seq: 4 }, 13000, room.sentences); refresh()");
    assert.match(f.get('#self-progress').html, /value="100"/);
    assert.match(f.run('mini(self)'), /value="100"/);
    assert.equal(f.run('self.finished'), 13000);
    assert.equal(f.run('elapsed(self)'), 4);
  }
});

test('상대 화면과 대기실·결과는 동일한 방송에서 DOM을 유지한다', () => {
  const f = ui();
  f.run("mode = 'multi'; room.players.push(R.player('other', '상대')); refresh(); refresh()");
  assert.equal(f.get('#opponents').htmlWrites, 1);
  f.run("room.players[1].text = '값'; refresh()");
  assert.equal(f.get('#opponents').htmlWrites, 2);
  f.run("room.phase = 'lobby'; refresh(); refresh()");
  assert.equal(f.get('#players').htmlWrites, 1);
  assert.equal(f.get('#lobby-action').htmlWrites, 1);
  f.run("room.players[1].ready = true; refresh()");
  assert.equal(f.get('#players').htmlWrites, 2);
  f.run("room.phase = 'result'; self.finished = 10000; refresh(); refresh()");
  assert.equal(f.get('#results').htmlWrites, 1);
  assert.equal(typeof f.get('#again').onclick, 'function');
  assert.equal(typeof f.get('#result-home').onclick, 'function');
});

test('완주 입력 이벤트에서 고해상도 시간을 확정하고 100ms 갱신과 무관하게 결과에 보존한다', () => {
  for (const finish of [10231.25, 10241.75]) {
    const f = ui(), input = f.get('#typing');
    input.value = 'A'; input.selectionStart = 1; input.isConnected = true;
    f.run("room.sentences = ['A']; attachTypingInput($('#typing')); self.text = 'A'; self.waiting = true");
    f.context.performance.now = () => finish;
    f.context.Date.now = () => 999999; // System clock jumps do not change elapsed time.
    f.run('submitInput(true)');
    assert.equal(f.run('self.finished'), finish);
    f.context.performance.now = () => 11000;
    f.run("room.phase = 'result'; results()");
    assert.ok(f.get('#results').html.includes(((finish - 9000) / 1000).toFixed(2) + '초'));
  }
});
