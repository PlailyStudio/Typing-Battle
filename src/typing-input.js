/** Keep one focused native input across sentences, including IME sessions. */
export function bindTypingInput(input, { state, submit, setComposing, blockClipboard, onType = () => {}, transitionKeys = { key: null, blockInput: false } }) {
  let composing = false;
  let lastTypedText = input.value;
  let pressedKey = null;
  let confirmed = false;
  let suppressTail = false;
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
    suppressTail = false;
    if (blocked()) { restore(); return; }
    composing = true;
    setComposing(true);
  };
  input.oncompositionend = () => {
    if (!input.isConnected) return;
    const hadComposition = composing;
    composing = false;
    setComposing(false);
    if (blocked() || suppressTail) { restore(); return; }
    if (!hadComposition) return;
    if (confirmAddedText()) return;
    submit();
  };
  input.oninput = event => {
    if (!input.isConnected) return;
    if (blocked() || suppressTail) { restore(); return; }
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
      return;
    }
    pressedKey = key;
    // A different fresh key can type immediately, even before the transition key is released.
    if (!event.repeat) {
      transitionKeys.blockInput = false;
      suppressTail = false;
    }
    // Confirm immediately, even while the final Korean syllable is composing.
    if (state().waiting && input.value === state().text
      && (event.key === 'Enter' || key === 'Enter' || key === 'NumpadEnter') && !event.repeat) {
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
  };
  input.onblur = () => {};
  input.onselect = () => {
    if (!blocked() && !suppressTail && input.selectionStart !== state().cursor) submit();
  };
  input.onbeforeinput = event => {
    if (!input.isConnected) return;
    // A fresh non-composition edit also releases the tail guard on mobile.
    if (!event.isComposing && ['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) suppressTail = false;
    if (blocked()) { event.preventDefault(); restore(); return; }
    if (['insertLineBreak', 'insertParagraph'].includes(event.inputType) && state().waiting && input.value === state().text) {
      event.preventDefault(); confirmSentence(); return;
    }
    if (['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'deleteByCut'].includes(event.inputType)) blockClipboard(event);
  };
  input.onpaste = blockClipboard;
  input.ondrop = blockClipboard;
  return {
    reset() {
      transitionKeys.key = pressedKey;
      transitionKeys.blockInput = !!pressedKey;
      confirmed = false;
      composing = false;
      suppressTail = true;
      lastTypedText = '';
      setComposing(false);
      input.value = '';
      input.setSelectionRange?.(0, 0);
      input.scrollLeft = 0;
    },
    confirm: confirmSentence
  };
}
