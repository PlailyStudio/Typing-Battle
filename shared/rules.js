(function (root) {
  var sentences = [
    '작은 움직임이 모여 새로운 가능성을 만든다.',
    '우리는 저마다의 속도로 같은 문장을 지나간다.',
    '창문 너머로 부드러운 바람이 불어오는 오후다.',
    '빠르게 달리는 것보다 멈추지 않는 것이 중요하다.',
    '키보드 위의 리듬이 나만의 이야기를 완성한다.',
    '오늘의 작은 도전이 내일의 나를 바꾼다.',
    '고요한 밤하늘에 별들이 하나둘 빛나기 시작했다.',
    '천천히 숨을 고르고 다음 문장을 향해 나아간다.',
    '함께하는 순간은 혼자일 때보다 오래 기억된다.',
    '마지막 글자까지 집중하며 나의 기록을 넘어선다.',
    '비가 그친 골목에 햇살이 조용히 내려앉았다.',
    '책장을 넘기자 잊고 있던 기억이 떠올랐다.',
    '따뜻한 차 한 잔을 두고 창밖을 바라본다.',
    '낯선 길을 걷다가 마음에 드는 풍경을 만났다.',
    '저녁 바람에 나뭇잎이 가볍게 흔들린다.'
  ];
  var englishSentences = [
    'Small steps can lead to wonderful changes.',
    'The morning light falls softly across the room.',
    'A quiet walk can make a busy day feel lighter.',
    'Every new page is a chance to learn something.',
    'Keep your eyes on the words and find your rhythm.',
    'The best ideas often begin with a simple question.',
    'Rain leaves tiny mirrors along the empty street.',
    'We watched the clouds drift above the hills.',
    'Take a deep breath and begin the next sentence.',
    'A warm cup of tea waits beside an open book.',
    'The garden grows a little brighter every spring.',
    'Friends make an ordinary afternoon feel special.',
    'There is always another way to solve a problem.',
    'Stars appear as the city settles into the night.',
    'Finish the last word with the same care as the first.'
  ];
  function sentencesFor(language) { return language === 'en' ? englishSentences : sentences; }
  function durationSeconds(value) {
    var seconds = value === undefined ? 60 : Number(value);
    if (!isFinite(seconds) || Math.floor(seconds) !== seconds || seconds < 1 || seconds > 3600) throw Error('제한 시간은 1~3600초 사이의 정수로 입력해주세요.');
    return seconds;
  }
  function parseCustomSentences(text) {
    if (typeof text !== 'string') throw Error('문장을 입력해주세요.');
    if (text.length > 10000) throw Error('문장은 전체 10,000자까지 입력할 수 있습니다.');
    var lines = text.split(/\r\n|\n|\r/).map(function (line) { return line.replace(/\t/g, ' ').trim(); }).filter(function (line) { return line.length > 0; });
    if (!lines.length) throw Error('문장을 한 줄 이상 입력해주세요.');
    if (lines.length > 50) throw Error('문장은 최대 50개까지 입력할 수 있습니다.');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].length > 160) throw Error((i + 1) + '번째 문장이 너무 깁니다. 한 문장은 160자까지 입력할 수 있습니다.');
    }
    return lines;
  }
  function shuffledSentences(random, language, customSentences) {
    var list = (customSentences || sentencesFor(language)).slice(), rng = random || Math.random;
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1)), temp = list[i];
      list[i] = list[j]; list[j] = temp;
    }
    return list;
  }
  function player(id, name) { return { id: id, name: name, line: 0, text: '', committed: '', cursor: 0, composing: false, waiting: false, correct: 0, attempts: 0, ready: false, left: false, finished: 0, seq: 0 }; }
  // line counts confirmed sentences; matching text alone only enters waiting.
  function completeSentence(p, now, sentences, repeat) {
    p.line++; p.text = ''; p.committed = ''; p.cursor = 0; p.composing = false; p.waiting = false;
    if (!repeat && p.line === sentences.length) p.finished = now;
  }
  function update(p, msg, now, list, repeat) {
    var sentences = list || root.BattleRules.sentences;
    if (p.finished || p.left || msg.line !== p.line || typeof msg.text !== 'string' || msg.text.length > 160 || !Number.isInteger(msg.seq) || msg.seq <= p.seq) return false;
    p.seq = msg.seq;
    if (p.waiting && msg.advance === true) { completeSentence(p, now, sentences, repeat); return true; }
    p.waiting = false;
    p.text = msg.text; p.cursor = Math.max(0, Math.min(p.text.length, Number(msg.cursor) || 0)); p.composing = !!msg.composing;
    if (p.composing && p.text !== sentences[p.line % sentences.length]) return true;
    var old = p.committed, i = 0;
    while (i < old.length && i < p.text.length && old[i] === p.text[i]) i++;
    for (var j = i; j < p.text.length; j++) { p.attempts++; if (p.text[j] === sentences[p.line % sentences.length][j]) p.correct++; }
    p.committed = p.text;
    if (p.text === sentences[p.line % sentences.length]) {
      p.composing = false;
      p.waiting = true;
    }
    return true;
  }
  // Count complete cycles once, so long timed games do not grow the work per tick.
  function completedProgress(line, sentences, countStrokes) {
    var cycles = Math.floor(line / sentences.length), remainder = line % sentences.length;
    var total = 0, limit = cycles ? sentences.length : remainder;
    for (var i = 0; i < limit; i++) {
      var value = countStrokes ? strokes(sentences[i]) : sentences[i].length;
      total += value * (cycles + (i < remainder ? 1 : 0));
    }
    return total;
  }
  function progress(p, list) { var sentences = list || root.BattleRules.sentences; var n = completedProgress(p.line, sentences, false); var t = sentences[p.line % sentences.length] || ''; for (var j = 0; j < p.committed.length && p.committed[j] === t[j]; j++) n++; return n; }
  function accuracy(p) { return p.attempts ? Math.round(p.correct / p.attempts * 100) : 100; }
  function strokes(text) {
    var total = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i) - 44032;
      if (code < 0 || code > 11171) { total++; continue; }
      var vowel = Math.floor(code / 28) % 21, final = code % 28;
      total += 2 + ((vowel >= 9 && vowel <= 11) || (vowel >= 14 && vowel <= 16) || vowel === 19 ? 1 : 0);
      if (final) total += final === 3 || final === 5 || final === 6 || (final >= 9 && final <= 15) || final === 18 ? 2 : 1;
    }
    return total;
  }
  function strokeProgress(p, list) {
    var sentences = list || root.BattleRules.sentences;
    var total = completedProgress(p.line, sentences, true);
    var target = sentences[p.line % sentences.length] || '', end = 0;
    while (end < p.committed.length && p.committed[end] === target[end]) end++;
    return total + strokes(p.committed.slice(0, end));
  }
  function typingSpeed(p, elapsedSeconds, list) { return Math.round(strokeProgress(p, list) / Math.max(1, elapsedSeconds) * 60); }
  function compare(a, b, list) { if (a.left !== b.left) return a.left ? 1 : -1; if (a.finished && b.finished) return a.finished - b.finished; if (a.finished || b.finished) return a.finished ? -1 : 1; return progress(b, list) - progress(a, list) || accuracy(b) - accuracy(a); }
  function hangulParts(ch) {
    var code = ch.charCodeAt(0) - 44032;
    if (code < 0 || code > 11171) return null;
    return { initial: 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'[Math.floor(code / 588)], vowel: 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'[Math.floor(code / 28) % 21], final: ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'][code % 28] };
  }
  // Whether the active IME syllable can still become the target without deleting it.
  function canCompose(actual, target) {
    if (actual === target) return true;
    var goal = hangulParts(target);
    if (!goal) return false;
    if (actual === goal.initial) return true;
    var part = hangulParts(actual);
    if (!part || part.initial !== goal.initial) return false;
    var vowelStart = { 'ㅘ': 'ㅗ', 'ㅙ': 'ㅗ', 'ㅚ': 'ㅗ', 'ㅝ': 'ㅜ', 'ㅞ': 'ㅜ', 'ㅟ': 'ㅜ', 'ㅢ': 'ㅡ' };
    if (part.vowel !== goal.vowel) return !part.final && vowelStart[goal.vowel] === part.vowel;
    if (!part.final || part.final === goal.final) return true;
    var finalStart = { 'ㄳ': 'ㄱ', 'ㄵ': 'ㄴ', 'ㄶ': 'ㄴ', 'ㄺ': 'ㄹ', 'ㄻ': 'ㄹ', 'ㄼ': 'ㄹ', 'ㄽ': 'ㄹ', 'ㄾ': 'ㄹ', 'ㄿ': 'ㄹ', 'ㅀ': 'ㄹ', 'ㅄ': 'ㅂ', 'ㄲ': 'ㄱ', 'ㅆ': 'ㅅ' };
    return finalStart[goal.final] === part.final;
  }
  // IME temporarily attaches the next syllable's initial to the current syllable.
  // Example: 아 + ㄱ becomes 악, then the next vowel produces 아기.
  function canCarryInitial(actual, target, nextTarget) {
    var part = hangulParts(actual), goal = hangulParts(target);
    var next = nextTarget ? hangulParts(nextTarget) : null;
    if (!part || !goal || !next || part.initial !== goal.initial || part.vowel !== goal.vowel) return false;
    if (!goal.final) return part.final === next.initial;
    var splitFinal = { 'ㄳ': ['ㄱ', 'ㅅ'], 'ㄵ': ['ㄴ', 'ㅈ'], 'ㄶ': ['ㄴ', 'ㅎ'], 'ㄺ': ['ㄹ', 'ㄱ'], 'ㄻ': ['ㄹ', 'ㅁ'], 'ㄼ': ['ㄹ', 'ㅂ'], 'ㄽ': ['ㄹ', 'ㅅ'], 'ㄾ': ['ㄹ', 'ㅌ'], 'ㄿ': ['ㄹ', 'ㅍ'], 'ㅀ': ['ㄹ', 'ㅎ'], 'ㅄ': ['ㅂ', 'ㅅ'] };
    var split = splitFinal[part.final];
    return !!split && split[0] === goal.final && split[1] === next.initial;
  }
  function letterState(actual, target, isComposing, nextTarget) {
    if (actual === undefined) return 'remaining';
    if (actual === target) return 'correct';
    return isComposing && (canCompose(actual, target) || canCarryInitial(actual, target, nextTarget)) ? 'composing' : 'wrong';
  }
  root.BattleRules = { sentences: sentences, durationSeconds: durationSeconds, parseCustomSentences: parseCustomSentences, sentencesFor: sentencesFor, shuffledSentences: shuffledSentences, player: player, update: update, progress: progress, accuracy: accuracy, compare: compare, canCompose: canCompose, letterState: letterState, strokes: strokes, strokeProgress: strokeProgress, typingSpeed: typingSpeed };
})(typeof globalThis !== 'undefined' ? globalThis : this);
