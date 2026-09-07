// Original looping arrangements, synthesized locally without audio downloads.
const TRACKS = {
  lobby: { bpm: 96, chords: [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]],
    melody: [[76, null, 79, 76, 74, null, 71, null], [72, null, 76, 79, 76, null, 72, null], [69, null, 72, 76, 74, 72, 69, null], [71, 74, 79, null, 77, 74, 71, null]] },
  game: { bpm: 120, chords: [[62, 66, 69, 73], [59, 62, 66, 69], [55, 59, 62, 66], [57, 61, 64, 67]],
    melody: [[78, 81, null, 78, 76, null, 74, null], [78, null, 81, 83, 81, null, 74, null], [79, 78, 74, null, 78, null, 81, null], [81, null, 76, 73, 76, null, 74, null]] }
};

export function createMusic({ enabled = true, volume = 0.8,
  createContext = () => { const Audio = window.AudioContext || window.webkitAudioContext; return Audio ? new Audio() : null; },
  schedule = callback => setInterval(callback, 50), cancel = id => clearInterval(id)
} = {}) {
  let context, master, bus, timer = null, scene = 'lobby', step = 0, nextAt = 0, paused = false;
  const voices = new Set();
  const clamp = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(1.5, Number(value))) : 0.8;
  volume = clamp(volume);
  function note(midi, at, duration, level, type = 'sine', kick = false) {
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), at);
    if (kick) oscillator.frequency.exponentialRampToValueAtTime(45, at + duration);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain); gain.connect(bus);
    voices.add(oscillator);
    oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(at); oscillator.stop(at + duration + 0.02);
  }
  function tick() {
    if (!TRACKS[scene] || context?.state !== 'running') return;
    const track = TRACKS[scene], beat = 60 / track.bpm;
    // Drop missed beats after a stalled tab instead of emitting a burst.
    if (nextAt < context.currentTime) nextAt = context.currentTime + 0.02;
    while (nextAt < context.currentTime + 0.15) {
      const bar = Math.floor(step / 8) % 4, eighth = step % 8, chord = track.chords[bar];
      const melody = track.melody[bar][eighth];
      if (melody !== null) {
        note(melody, nextAt, beat * 0.65, scene === 'game' ? 0.12 : 0.14, 'triangle');
        note(melody + 12, nextAt, beat * 0.4, scene === 'game' ? 0.015 : 0.025);
      }
      if (eighth === 0 || eighth === 4) note(chord[eighth === 0 ? 0 : 2] - 24, nextAt, beat * 1.2, 0.22);
      if (eighth % 2 === 0) {
        for (const pitch of chord) note(pitch, nextAt, beat * 0.75, 0.035, 'triangle');
      }
      if (scene === 'game') {
        if (eighth === 0 || eighth === 4) note(43, nextAt, 0.13, 0.12, 'sine', true);
        if (eighth === 2 || eighth === 6) note(86, nextAt, 0.055, 0.028, 'triangle');
        if (eighth % 2) note(102, nextAt, 0.025, 0.01);
      }
      step = (step + 1) % 32;
      nextAt += beat / 2;
    }
  }
  function stop() {
    if (timer !== null) { cancel(timer); timer = null; }
    if (!bus) return;
    const oldBus = bus, oldVoices = [...voices], at = context.currentTime;
    oldBus.gain.cancelScheduledValues(at);
    oldBus.gain.setValueAtTime(oldBus.gain.value, at);
    oldBus.gain.linearRampToValueAtTime(0, at + 0.12);
    for (const voice of oldVoices) { try { voice.stop(at + 0.13); } catch {} }
    // Disconnect after the fade, including when the context is suspended.
    setTimeout(() => oldBus.disconnect(), 200);
    bus = null;
  }
  function start() {
    if (!TRACKS[scene] || !enabled || !volume || paused || timer !== null || context?.state !== 'running') return;
    try {
      bus = context.createGain(); bus.connect(master);
      bus.gain.setValueAtTime(0, context.currentTime);
      bus.gain.linearRampToValueAtTime(1, context.currentTime + 0.25);
      step = 0; nextAt = context.currentTime + 0.03;
      tick(); timer = schedule(() => { try { tick(); } catch { stop(); } });
    } catch { stop(); }
  }
  function unlock() {
    if (!enabled || !volume || paused) return;
    try {
      if (!context) {
        context = createContext();
        if (!context) return;
        master = context.createGain(); master.gain.value = volume; master.connect(context.destination);
      }
      if (context.state === 'suspended') context.resume().then(start).catch(() => {});
      else start();
    } catch { /* Audio must never interrupt typing. */ }
  }
  return {
    unlock,
    setScene(value) {
      const next = value === 'countdown' ? 'silent' : value === 'playing' ? 'game' : 'lobby';
      if (scene === next) return;
      stop(); scene = next; start();
    },
    setEnabled(value) { enabled = !!value; if (enabled) unlock(); else stop(); },
    setVolume(value) {
      volume = clamp(value);
      if (master) master.gain.setTargetAtTime(volume, context.currentTime, 0.04);
      if (!volume) stop(); else unlock();
    },
    setPaused(value) { paused = !!value; if (paused) stop(); else if (context) unlock(); }
  };
}
