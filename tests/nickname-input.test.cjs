const { test } = require('node:test');
const assert = require('node:assert/strict');

async function fixture(value = '') {
  const { bindNicknameInput } = await import('../src/nickname-input.js');
  const changes = [], errors = [];
  const input = { value, selectionStart: value.length, selectionEnd: value.length,
    removeAttribute() {}, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    blur() { this.blurred = true; this.onblur(); }
  };
  bindNicknameInput(input, { showError: message => errors.push(message),
    onChange: () => changes.push(input.value), onBlur: () => changes.push(input.value), blurOnEnter: true });
  const fire = (type, data = {}) => {
    const event = { cancelable: true, preventDefault() { this.prevented = true; }, ...data };
    input['on' + type](event); return event;
  };
  return { input, changes, errors, fire };
}

test('12자 이후 일반 입력을 막고 선택 영역 교체·삭제는 허용한다', async () => {
  const f = await fixture('abcdefghijkl');
  assert.equal(f.fire('beforeinput', { inputType: 'insertText', data: 'm' }).prevented, true);
  assert.equal(f.input.value, 'abcdefghijkl');
  assert.equal(f.errors.at(-1), '닉네임 최대 글자 수는 12자 입니다.');
  f.input.setSelectionRange(10, 12);
  assert.equal(f.fire('beforeinput', { inputType: 'insertText', data: 'XY' }).prevented, undefined);
  f.input.value = 'abcdefghijXY'; f.fire('input');
  assert.equal(f.changes.at(-1), 'abcdefghijXY'); assert.equal(f.errors.at(-1), '');
  assert.equal(f.fire('beforeinput', { inputType: 'insertFromPaste', data: 'long paste' }).prevented, true);
  f.fire('beforeinput', { inputType: 'deleteContentBackward' });
  f.input.value = 'abcdefghijX'; f.fire('input');
  assert.equal(f.errors.at(-1), '');
});

test('긴 닉네임 붙여넣기는 12자까지 자르고 갱신한다', async () => {
  const f = await fixture();
  const event = f.fire('paste', { clipboardData: { getData: () => '가나다라마바사아자차카타파하' } });
  assert.equal(event.prevented, true);
  assert.equal(f.input.value, '가나다라마바사아자차카타');
  assert.equal(f.input.selectionStart, 12);
  assert.equal(f.changes.at(-1), f.input.value);
  assert.match(f.errors.at(-1), /12자/);
});

test('부분 선택과 중간 커서 붙여넣기는 남은 길이만 채우고 나머지 문자를 보존한다', async () => {
  const f = await fixture('abcdefghij');
  f.input.setSelectionRange(3, 5);
  f.fire('paste', { clipboardData: { getData: () => '123456789' } });
  assert.equal(f.input.value, 'abc1234fghij');
  assert.equal(f.input.selectionStart, 7);
  f.input.setSelectionRange(0, 12);
  f.fire('paste', { clipboardData: { getData: () => '새\r\n이름' } });
  assert.equal(f.input.value, '새이름');
  assert.equal(f.errors.at(-1), '');
  f.input.setSelectionRange(1, 1);
  f.fire('beforeinput', { inputType: 'insertFromPaste', data: '1234567890' });
  assert.equal(f.input.value, '새123456789이름');
  assert.equal(f.changes.at(-1), f.input.value);
});

test('가득 찬 닉네임에서 새 한글 조합이 마지막 글자를 바꾸지 못한다', async () => {
  const name = '가나다라마바사아자차카타', f = await fixture(name);
  f.fire('compositionstart');
  f.input.value = name.slice(0, -1) + '파'; f.fire('input', { isComposing: true });
  assert.equal(f.input.value, name);
  f.input.value = name + 'ㅍ'; f.fire('compositionend');
  assert.equal(f.input.value, name);
  assert.equal(f.changes.at(-1), name);
  assert.match(f.errors.at(-1), /12자/);
});

test('12번째 한글은 끝까지 조합하고 초과 음절은 제거한다', async () => {
  const prefix = '가나다라마바사아자차카', f = await fixture(prefix);
  f.fire('compositionstart');
  for (const syllable of ['ㄱ', '가', '간']) {
    f.input.value = prefix + syllable; f.fire('input', { isComposing: true });
    assert.equal(f.input.value, prefix + syllable);
  }
  f.input.value = prefix + '가나'; f.fire('input', { isComposing: true });
  assert.equal(f.input.value, prefix + '가');
  f.input.value = prefix + '가난'; f.fire('compositionend');
  assert.equal(f.input.value, prefix + '가');
  assert.equal(f.changes.at(-1), prefix + '가');
  assert.match(f.errors.at(-1), /12자/);
});

test('취소할 수 없는 초과 입력도 복원하고 Enter는 조합 종료 후 포커스를 해제한다', async () => {
  const f = await fixture('abcdefghijkl');
  f.fire('beforeinput', { inputType: 'insertFromPaste', data: null });
  f.input.value += 'mnop'; f.fire('input');
  assert.equal(f.input.value, 'abcdefghijkl');
  f.fire('compositionstart'); f.fire('keydown', { key: 'Enter', isComposing: true });
  assert.equal(f.input.blurred, undefined);
  f.fire('compositionend');
  assert.equal(f.fire('keydown', { key: 'Enter' }).prevented, true);
  assert.equal(f.input.blurred, true);
  assert.equal(f.changes.at(-1), 'abcdefghijkl');
});
