/** Bind one native input session. Replaced inputs cannot submit late IME events. */
export function bindTypingInput(input, { state, submit, setComposing, blockClipboard, onType = () => {}, transitionKeys = { key: null, blockInput: false } }) {
  let composing = false;
  let lastTypedText = input.value;
  let pressedKey = null;
  let confirmed = false;
  const active = () => input.isConnected && state().enabled;
  const restore = () => {
    const text = state().text;
    if (input.value === text) return;
    const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection;
    const scroll = input.scrollLeft;
    input.value = text;
    input.setSelectionRange?.(Math.min(start ?? text.length, text.length), Math.min(end ?? text.length, text.length), direction);
    input.scrollLeft = scroll;
  };
  const blocked = () => !active() || confirmed || transitionKeys.blockInput;
  const confirmSentence = () => {
    if (blocked() || !state().waiting) return;
    restore();
    confirmed = true;
    transitionKeys.key = pressedKey;
    transitionKeys.blockInput = !!pressedKey;
    composing = false;
    setComposing(false);
    submit(true);
  };
  const confirmAddedText = event => {
    if (!state().waiting) return false;
    const target = state().text;
    const added = input.value.length > target.length && input.value.startsWith(target);
    const inserted = !event?.inputType || ['insertText', 'insertCompositionText', 'insertFromComposition'].includes(event.inputType);
    if (!added || !inserted) return false;
    confirmSentence();
    return true;
  };

  input.oncompositionstart = () => {
    if (blocked()) { restore(); return; }
    composing = true;
    setComposing(true);
  };
  input.oncompositionend = () => {
    if (!input.isConnected) return;
    const hadComposition = composing;
    composing = false;
    setComposing(false);
    if (blocked()) { restore(); return; }
    if (!hadComposition) return;
    if (confirmAddedText()) return;
    submit();
  };
  input.oninput = event => {
    if (!input.isConnected) return;
    if (blocked()) { restore(); return; }
    if (['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop'].includes(event.inputType)) { blockClipboard(event); restore(); return; }
    if (confirmAddedText(event)) return;
    if (input.value !== lastTypedText) {
      lastTypedText = input.value;
      onType();
    }
    composing = event.isComposing === true;
    setComposing(composing);
    submit();
  };
  input.onkeydown = event => {
    if (!active()) return;
    const key = event.code || event.key;
    if (transitionKeys.key === key) {
      event.preventDefault();
      transitionKeys.blockInput = true;
      input.readOnly = true;
      return;
    }
    pressedKey = key;
    // A different fresh key can type immediately, even before the transition key is released.
    if (!event.repeat) {
      transitionKeys.blockInput = false;
      input.readOnly = false;
    }
    if (state().waiting && (event.key === 'Enter' || key === 'Enter' || key === 'NumpadEnter')
      && !composing && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      confirmSentence();
    }
  };
  input.onkeyup = event => {
    if ((event.code || event.key) === pressedKey) pressedKey = null;
    if ((event.code || event.key) !== transitionKeys.key) return;
    event.preventDefault();
    transitionKeys.key = null;
    transitionKeys.blockInput = false;
    if (input.isConnected) input.readOnly = false;
  };
  // Native blur is part of replacing the input, so preserve the held-key guard.
  input.onblur = () => {};
  input.onselect = () => {
    if (!blocked() && input.selectionStart !== state().cursor) submit();
  };
  input.onbeforeinput = event => {
    if (!input.isConnected) return;
    if (blocked()) { event.preventDefault(); restore(); return; }
    if (['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'deleteByCut'].includes(event.inputType)) blockClipboard(event);
  };
  input.onpaste = blockClipboard;
  input.ondrop = blockClipboard;
}
