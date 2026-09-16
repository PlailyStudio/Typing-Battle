// Keep the editor mounted during presence/ready broadcasts so drafts and IME survive.
export function createLobbySettings(container, { rules, userId, send, notify }) {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const field = name => container.querySelector(`[name="${name}"]`);
  let room, signature, dirty = false, pending = false, timeout;
  const status = (message, isError = false) => {
    const node = container.querySelector('[role="status"]');
    node.textContent = message;
    node.classList.toggle('error', isError);
  };
  const setPending = value => {
    pending = value;
    container.querySelector('fieldset').disabled = pending || room.host !== userId;
    container.querySelector('[type="submit"]').disabled = pending;
    container.querySelector('[type="reset"]').disabled = pending;
  };
  function render() {
    const host = room.host === userId;
    const select = (name, values, value) => `<select name="${name}" id="settings-${name}">${values.map(([id, label]) => `<option value="${id}" ${value === id ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
    const wrap = (name, label, control) => `<div><label for="settings-${name}">${label}</label>${control}</div>`;
    container.innerHTML = `<h3>방 설정</h3><p class="custom-help">${host ? '변경 후 저장하면 참가자들이 다시 준비해야 합니다.' : '방장이 설정을 변경할 수 있습니다.'}</p>
      <form><fieldset ${host ? '' : 'disabled'}><div class="room-settings-grid">
      ${wrap('title', '방 이름', `<input name="title" id="settings-title" maxlength="30" required value="${escape(room.title)}">`)}
      ${wrap('max', '최대 인원', select('max', [['2', '2명'], ['3', '3명'], ['4', '4명']], String(room.max)))}
      ${wrap('source', '문장', select('source', [['default', '기본 문장'], ['custom', '직접 입력']], room.customSentences ? 'custom' : 'default'))}
      ${wrap('language', '언어', select('language', [['ko', '한국어'], ['en', '영어']], room.language))}
      ${wrap('gameMode', '방식', select('gameMode', [['race', '완주'], ['timed', '시간 제한']], room.gameMode))}
      ${wrap('sentenceOrder', '순서', select('sentenceOrder', [['sequential', '순서대로'], ['random', '무작위']], room.sentenceOrder))}
      <div data-duration>${wrap('duration', '제한 시간 (초)', `<input name="duration" id="settings-duration" type="number" min="1" max="3600" step="1" value="${room.duration || 60}">`)}</div>
      <div data-custom class="full-width">${wrap('customText', '사용할 문장', `<textarea name="customText" id="settings-customText" rows="6" maxlength="10000" placeholder="한 줄에 한 문장씩 입력해주세요.">${escape(room.customSentences?.join('\n') || '')}</textarea>`)}<p class="custom-help">줄바꿈마다 한 문장 · 최대 50문장, 한 문장 160자</p></div>
      </div></fieldset><p class="custom-help" role="status"></p><div class="room-settings-actions" ${host ? '' : 'hidden'}><button class="primary" type="submit">설정 저장</button><button class="ghost" type="reset">변경 취소</button></div></form>`;
    const form = container.querySelector('form');
    const visibility = () => {
      const custom = field('source').value === 'custom';
      const timed = field('gameMode').value === 'timed';
      container.querySelector('[data-custom]').hidden = !custom;
      container.querySelector('[data-duration]').hidden = !timed;
      field('customText').disabled = !custom;
      field('language').disabled = custom;
      field('duration').disabled = !timed;
      field('duration').required = timed;
    };
    form.oninput = form.onchange = () => { dirty = true; visibility(); status('변경한 설정을 저장해주세요.'); };
    form.onreset = event => { event.preventDefault(); dirty = false; render(); };
    form.onsubmit = async event => {
      event.preventDefault();
      if (pending || room.host !== userId) return;
      try {
        const title = field('title').value.trim();
        if (!title) throw Error('방 이름을 입력해주세요.');
        const max = Number(field('max').value);
        if (max < room.players.length) throw Error('현재 참가자 수보다 최대 인원을 줄일 수 없습니다.');
        const timed = field('gameMode').value === 'timed';
        const duration = timed ? rules.durationSeconds(field('duration').value) : room.duration || 60;
        const customText = field('source').value === 'custom' ? field('customText').value : null;
        if (customText != null) rules.parseCustomSentences(customText);
        const payload = { version: room.settingsVersion || 0, title, max, duration, customText,
          language: field('language').value, gameMode: field('gameMode').value, sentenceOrder: field('sentenceOrder').value };
        setPending(true); status('설정을 저장하는 중…');
        timeout = setTimeout(() => {
          if (!container.isConnected) return;
          setPending(false); status('서버 응답을 받지 못했습니다. 서버 업데이트와 연결 상태를 확인해주세요.', true);
        }, 8000);
        if (!await send(7, payload)) {
          clearTimeout(timeout); setPending(false); status('설정 전송에 실패했습니다. 다시 시도해주세요.', true);
        }
      } catch (error) { status(error.message, true); }
    };
    visibility();
  }
  return {
    update(next) {
      room = next;
      const nextSignature = JSON.stringify([room.host, room.settingsVersion || 0, room.title, room.max, room.language, room.gameMode, room.duration, room.sentenceOrder, room.customSentences]);
      if (signature === nextSignature) return;
      const changed = signature !== undefined;
      signature = nextSignature;
      clearTimeout(timeout); pending = false; dirty = false;
      render();
      if (changed) status('방 설정이 변경되었습니다. 새 설정을 확인해주세요.');
    },
    result(result) {
      clearTimeout(timeout); setPending(false);
      if (!result.ok) { status(result.error || '설정을 저장하지 못했습니다.', true); return; }
      dirty = false;
      status('설정을 저장했습니다.');
      notify(result.changed ? '방 설정이 변경되었습니다. 다시 준비해주세요.' : '설정을 확인했습니다.');
    },
    hasUnsavedChanges: () => dirty || pending,
    destroy() { clearTimeout(timeout); }
  };
}
