export function createAudioController() {
  let context;
  let muted = localStorage.getItem('paper.audioMuted') === 'true';
  let windGain;

  function ensureContext() {
    if (!context) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      context = new AudioCtor();
      windGain = context.createGain();
      windGain.gain.value = 0;
      windGain.connect(context.destination);
      startWindLoop();
    }

    if (context.state === 'suspended') {
      context.resume();
    }
  }

  function startWindLoop() {
    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = 90;
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    oscillator.connect(filter);
    filter.connect(windGain);
    oscillator.start();
  }

  function blip(frequency, duration = 0.12, type = 'sine', volume = 0.06) {
    if (muted) {
      return;
    }

    ensureContext();

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.65), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  return {
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      localStorage.setItem('paper.audioMuted', String(muted));

      if (muted && windGain) {
        windGain.gain.setTargetAtTime(0, context.currentTime, 0.08);
      }

      return muted;
    },
    setWind(speed, stalled, crashed) {
      if (muted || !context || !windGain) {
        return;
      }

      const target = crashed ? 0 : Math.min(0.075, Math.max(0.012, speed / 8500)) + stalled * 0.035;
      windGain.gain.setTargetAtTime(target, context.currentTime, 0.12);
    },
    launch() {
      blip(360, 0.18, 'triangle', 0.075);
    },
    collect() {
      blip(740, 0.1, 'sine', 0.07);
      setTimeout(() => blip(980, 0.08, 'sine', 0.045), 45);
    },
    hit() {
      blip(150, 0.18, 'square', 0.06);
    },
    deliver() {
      blip(520, 0.16, 'triangle', 0.07);
      setTimeout(() => blip(780, 0.14, 'triangle', 0.055), 70);
      setTimeout(() => blip(1040, 0.18, 'triangle', 0.045), 145);
    },
    crash() {
      blip(110, 0.3, 'sawtooth', 0.075);
    },
  };
}
