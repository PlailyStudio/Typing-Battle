const { test } = require('node:test');
const assert = require('node:assert/strict');

async function fixture(waiting = true, transitionKeys = { key: null, blockInput: false }) {
  const { bindTypingInput } = await import('../src/typing-input.js');
  const state = { enabled: true, waiting, text: waiting ? '완성 문장' : '', cursor: 0 };
  const input = { isConnected: true, value: state.text, selectionStart: 0 };
  const submissions = [], compositions = [], sounds = [];
  bindTypingInput(input, { transitionKeys, state: () => state, submit: advance => submissions.push({ advance: !!advance, text: input.value }), setComposing: value => compositions.push(value), blockClipboard: event => event.preventDefault(), onType: () => sounds.push(input.value) });
  const fire = (type, data = {}) => {
    const event = { code: 'KeyA', key: 'a', repeat: false, preventDefault() { this.prevented = true; }, ...data };
    input['on' + type](event);
    return event;
  };
  return { input, state, submissions, compositions, sounds, fire, transitionKeys };
}

test('한글 조합의 각 입력과 삭제에 효과음을 내고 중복 이벤트·차단 입력은 제외한다', async () => {
  const f = await fixture(false);
  f.fire('compositionstart');
  for (const text of ['ㅎ', '하', '한']) { f.input.value = text; f.fire('input', { isComposing: true }); }
  f.fire('compositionend'); f.fire('input', { isComposing: false });
  assert.deepEqual(f.sounds, ['ㅎ', '하', '한']);
  f.input.value = ''; f.fire('input');
  assert.equal(f.sounds.length, 4);
  f.state.waiting = true; f.state.text = '완성 문장'; f.input.value = 'a'; f.fire('input');
  assert.equal(f.sounds.length, 5);
  f.input.isConnected = false; f.fire('input');
  assert.equal(f.sounds.length, 5);
});

test('키 누름은 전환하지 않고 정답 뒤 추가 입력만 한 번 전환한다', async () => {
  const f = await fixture();
  assert.equal(f.fire('keydown').prevented, undefined);
  assert.equal(f.submissions.length, 0);
  f.fire('compositionstart');
  f.input.value = '완성 문장ㅁ'; f.fire('input', { isComposing: true, inputType: 'insertCompositionText' });
  assert.deepEqual(f.submissions, [{ advance: true, text: '완성 문장' }]);
  for (let i = 0; i < 3; i++) assert.equal(f.fire('keydown', { repeat: true }).prevented, true);
  assert.equal(f.fire('beforeinput', { inputType: 'insertCompositionText' }).prevented, true);
  f.fire('compositionend'); f.fire('input'); f.fire('keyup');
  assert.equal(f.submissions.length, 1);
});

test('정답 상태에서도 삭제·수정 입력을 그대로 제출하고 비입력 키는 전환하지 않는다', async () => {
  const f = await fixture();
  f.state.text = '안녕하세요'; f.input.value = f.state.text;
  for (const key of ['Backspace', 'Delete', 'ArrowLeft', 'Shift', 'Tab']) {
    f.fire('keydown', { code: key, key }); f.fire('keyup', { code: key, key });
  }
  for (const [text, inputType] of [['안녕하세ㅇ', 'deleteContentBackward'], ['안녕하세', 'deleteContentForward'], ['안녕하세요', 'insertText'], ['안녕X하세요', 'insertText'], ['X', 'insertText']]) {
    f.input.value = text; f.fire('input', { inputType });
    assert.equal(f.input.value, text);
    assert.deepEqual(f.submissions.at(-1), { advance: false, text });
  }
  f.input.value = '안녕하세요 '; f.fire('input', { inputType: 'insertText' });
  assert.deepEqual(f.submissions.at(-1), { advance: true, text: '안녕하세요' });
});

test('Enter와 숫자패드 Enter는 대기 중 한 번만 확정하고 반복 입력을 차단한다', async () => {
  for (const code of ['Enter', 'NumpadEnter']) {
    const f = await fixture();
    assert.equal(f.fire('keydown', { code, key: 'Enter' }).prevented, true);
    f.fire('keydown', { code, key: 'Enter', repeat: true });
    f.fire('keyup', { code, key: 'Enter' });
    assert.deepEqual(f.submissions, [{ advance: true, text: '완성 문장' }]);
    const typing = await fixture(false);
    typing.fire('keydown', { code, key: 'Enter' });
    assert.equal(typing.submissions.length, 0);
  }
});

test('정답의 마지막 한글이 조합 중이어도 Enter 한 번으로 확정한다', async () => {
  for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
    const f = await fixture();
    f.fire('compositionstart');
    f.fire('keydown', { code: 'Enter', key: 'Enter', ...flags });
    assert.deepEqual(f.submissions, [{ advance: true, text: '완성 문장' }]);
    f.fire('compositionend'); f.fire('input', { isComposing: false });
    f.fire('keyup', { code: 'Enter', key: 'Enter' });
    assert.equal(f.submissions.length, 1);
  }
  const f = await fixture(false);
  f.fire('compositionstart');
  f.fire('keydown', { code: 'Enter', key: 'Enter' });
  assert.equal(f.submissions.length, 0);
});

test('조합 중 편집한 오답·반복 Enter는 전환하지 않고 모바일 줄바꿈은 전환한다', async () => {
  const edited = await fixture();
  edited.input.value = '편집 중인 다른 문장';
  edited.fire('keydown', { code: 'Enter', key: 'Enter', isComposing: true });
  assert.equal(edited.submissions.length, 0);
  const held = await fixture();
  held.fire('keydown', { code: 'Enter', key: 'Enter', repeat: true });
  assert.equal(held.submissions.length, 0);
  const mobile = await fixture();
  assert.equal(mobile.fire('beforeinput', { inputType: 'insertLineBreak' }).prevented, true);
  mobile.fire('input', { inputType: 'insertLineBreak' });
  assert.deepEqual(mobile.submissions, [{ advance: true, text: '완성 문장' }]);
});

test('키보드 이벤트 없는 모바일 추가 입력도 전환하고 붙여넣기는 차단한다', async () => {
  const f = await fixture();
  assert.equal(f.fire('beforeinput', { inputType: 'insertFromPaste' }).prevented, true);
  f.input.value += '붙여넣기'; f.fire('input', { inputType: 'insertFromPaste' });
  assert.equal(f.submissions.length, 0);
  f.input.value += 'a'; f.fire('input', { inputType: 'insertText' });
  assert.equal(f.submissions.length, 1);
  assert.equal(f.transitionKeys.blockInput, false);
});

test('교체된 입력창의 늦은 input·compositionend는 다음 문장에 전달되지 않는다', async () => {
  const f = await fixture(false);
  f.fire('compositionstart');
  f.input.isConnected = false;
  f.input.value = '이전 문장 잔여 글자';
  f.fire('compositionend'); f.fire('input', { isComposing: false });
  f.fire('select'); f.fire('keydown'); f.fire('keyup');
  assert.equal(f.submissions.length, 0);
  const fresh = await fixture(false);
  fresh.input.value = '새'; fresh.fire('input', { isComposing: false });
  assert.deepEqual(fresh.submissions, [{ advance: false, text: '새' }]);
});

test('대기 중 백스페이스 반복은 허용하고 시간 종료 후에는 전환하지 않는다', async () => {
  const f = await fixture();
  assert.equal(f.fire('keydown', { code: 'Backspace', key: 'Backspace', repeat: true }).prevented, undefined); f.fire('keyup');
  assert.equal(f.submissions.length, 0);
  f.state.enabled = false; f.fire('keydown'); f.fire('keyup');
  assert.equal(f.submissions.length, 0);
});

test('즉시 전환 후 새 입력창도 전환 키를 차단하고 다른 키는 바로 입력한다', async () => {
  const previous = await fixture();
  previous.fire('keydown');
  previous.input.value += 'a'; previous.fire('input', { inputType: 'insertText' });
  assert.equal(previous.submissions.length, 1);
  previous.input.isConnected = false;
  previous.fire('blur');
  const fresh = await fixture(false, previous.transitionKeys);
  assert.equal(fresh.fire('keydown', { repeat: true }).prevented, true);
  assert.equal(fresh.fire('beforeinput', { inputType: 'insertText' }).prevented, true);
  fresh.input.value = 'a'; fresh.fire('input');
  assert.equal(fresh.input.value, ''); assert.equal(fresh.submissions.length, 0);
  fresh.fire('keydown', { code: 'KeyB', key: 'b' });
  assert.equal(fresh.fire('beforeinput', { inputType: 'insertText' }).prevented, undefined);
  fresh.input.value = 'b'; fresh.fire('input');
  assert.deepEqual(fresh.submissions, [{ advance: false, text: 'b' }]);
  fresh.fire('keyup');
  fresh.fire('keydown'); fresh.input.value = 'ba'; fresh.fire('input');
  assert.equal(fresh.submissions.at(-1).text, 'ba');
});

test('일반 한글 조합은 정상 제출하고 대기 중 추가 조합으로 전환한다', async () => {
  const f = await fixture(false);
  f.fire('compositionstart'); f.input.value = '한'; f.fire('input', { isComposing: true });
  f.fire('compositionend');
  assert.equal(f.submissions.length, 2);
  assert.equal(f.compositions.at(-1), false);
  f.state.waiting = true; f.state.text = '한';
  f.fire('compositionstart'); f.input.value = '한ㄱ'; f.fire('input', { isComposing: true }); f.fire('compositionend');
  assert.equal(f.input.value, '한'); assert.equal(f.submissions.length, 3);
  assert.deepEqual(f.submissions.at(-1), { advance: true, text: '한' });
});
