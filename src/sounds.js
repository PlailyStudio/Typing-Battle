const NOTES = {
  type: [[700, 0, 0.025, 0.6]],
  error: [[170, 0, 0.07, 0.2]],
  complete: [[660, 0, 0.09, 0.25], [880, 0.07, 0.12, 0.25]],
  countdown: [[520, 0, 0.08, 0.25]],
  start: [[880, 0, 0.18, 0.3]],
  result: [[523, 0, 0.14, 0.25], [659, 0.12, 0.14, 0.25], [784, 0.24, 0.25, 0.25]]
};

/** Small synthesized effects; no downloads, and audio never blocks game input. */
export function createSounds({ enabled = true, volume = 0.8, createContext = () => {
  const Audio = window.AudioContext || window.webkitAudioContext;
  return Audio ? new Audio() : null;
} } = {}) {
  let context, master, phase = '', round = null, count = null;
  const voices = new Set();
  const setVolume = value => {
    volume = Number.isFinite(Number(value)) ? Math.max(0, Math.min(1.5, Number(value))) : 0.8;
    if (master) master.gain.value = enabled ? volume : 0;
  };
  setVolume(volume);
  const unlock = () => {
    if (!enabled || !volume) return;
    try {
      if (!context) {
        context = createContext();
        if (!context) return;
        master = context.createGain(); master.gain.value = volume;
        master.connect(context.destination);
      }
      if (context.state === 'suspended') context.resume().catch(() => {});
    } catch { /* Unsupported or blocked audio must not interrupt the game. */ }
  };
  const play = name => {
    if (!enabled || !volume || !master || context?.state !== 'running' || !NOTES[name]) return;
    try {
      for (const [frequency, delay, duration, level] of NOTES[name]) {
        if (voices.size >= 16) break;
        const oscillator = context.createOscillator(), gain = context.createGain();
        const at = context.currentTime + delay;
        oscillator.type = name === 'type' ? 'triangle' : 'sine';
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(level, at + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
        oscillator.connect(gain); gain.connect(master); voices.add(oscillator);
        oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(at); oscillator.stop(at + duration + 0.01);
      }
    } catch { /* Sound effects are optional. */ }
  };
  return {
    unlock, play, setVolume,
    setEnabled(value) {
      enabled = !!value; setVolume(volume);
      if (!enabled) for (const voice of voices) { try { voice.stop(); } catch {} }
    },
    reset() { phase = ''; round = null; count = null; },
    observe(room, now) {
      if (round !== room.startAt) { round = room.startAt; phase = ''; count = null; }
      if (room.phase === 'countdown') {
        const next = Math.ceil((room.startAt - now) / 1000);
        if (next !== count && next > 0 && next <= 3) play('countdown');
        count = next;
      }
      if (room.phase === 'playing' && phase === 'countdown') play('start');
      if (room.phase === 'result' && phase && phase !== 'result') play('result');
      phase = room.phase;
    }
  };
}
