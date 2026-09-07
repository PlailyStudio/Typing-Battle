/** Own the length limit: native maxlength can truncate an active Korean IME range. */
export function bindNicknameInput(input, { limit = 12, showError, onChange = () => {}, onBlur = () => {}, blurOnEnter = false }) {
  input.removeAttribute('maxlength');
  let accepted = input.value, composing = false, blockedComposition = false;
  let selection = [input.selectionStart, input.selectionEnd];
  const remember = () => { accepted = input.value; selection = [input.selectionStart, input.selectionEnd]; };
  const restore = () => { input.value = accepted; input.setSelectionRange(...selection); };
  const reject = () => { showError(`닉네임 최대 글자 수는 ${limit}자 입니다.`); };
  const paste = (event, text) => {
    event.preventDefault();
    // Match a single-line input's native newline handling and preserve unselected text.
    text = text.replace(/[\r\n]/g, '');
    const start = input.selectionStart, end = input.selectionEnd;
    const available = Math.max(0, limit - (input.value.length - (end - start)));
    const insertion = text.slice(0, available);
    input.value = input.value.slice(0, start) + insertion + input.value.slice(end);
    input.setSelectionRange(start + insertion.length, start + insertion.length);
    remember();
    if (text.length > available) reject(); else showError('');
    if (!composing) onChange();
  };
  input.onfocus = remember;
  input.onpaste = event => {
    if (event.clipboardData) paste(event, event.clipboardData.getData('text/plain'));
  };
  input.onbeforeinput = event => {
    if (composing || event.isComposing) {
      if (blockedComposition && event.cancelable) event.preventDefault();
      return;
    }
    remember();
    if (!event.inputType?.startsWith('insert')) return;
    const text = event.data ?? event.dataTransfer?.getData('text/plain');
    if (event.inputType === 'insertFromPaste' && text != null) { paste(event, text); return; }
    const remaining = input.value.length - (input.selectionEnd - input.selectionStart);
    if ((text !== null && text !== undefined && remaining + text.length > limit) || (remaining >= limit && text == null)) {
      event.preventDefault(); reject();
    }
  };
  input.oncompositionstart = () => {
    remember(); composing = true;
    blockedComposition = accepted.length >= limit && input.selectionStart === input.selectionEnd;
    if (blockedComposition) reject();
  };
  const validate = () => {
    if (blockedComposition) { restore(); reject(); return false; }
    if (input.value.length > limit) {
      if (composing) {
        // IME may split the last syllable's temporary final into the next initial.
        accepted = input.value.slice(0, limit);
        selection = [Math.min(input.selectionStart, limit), Math.min(input.selectionEnd, limit)];
        blockedComposition = true;
      }
      restore(); reject(); return false;
    }
    remember(); showError(''); return true;
  };
  input.oninput = event => {
    if (validate() && !composing && !event.isComposing) onChange();
  };
  input.oncompositionend = () => {
    validate(); composing = false; blockedComposition = false;
    onChange();
  };
  input.onblur = () => {
    validate(); composing = false; blockedComposition = false;
    onBlur(); remember();
  };
  input.onkeydown = event => {
    if (!blurOnEnter || event.key !== 'Enter' || composing || event.isComposing || event.keyCode === 229) return;
    event.preventDefault(); input.blur();
  };
}
