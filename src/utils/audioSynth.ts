import { midiToFreq } from '../data/ocarinaData';

let sharedCtx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedCtx) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedCtx = new AudioCtx();
  }
  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume().catch(() => {});
  }
  return sharedCtx;
}

function getBreathNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) {
    return noiseBuffer;
  }
  const length = ctx.sampleRate * 1.5;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    // Gentle pink/brownish tint for soft clay breath noise
    data[i] = (last + 0.04 * white) / 1.04;
    last = data[i];
  }
  noiseBuffer = buffer;
  return buffer;
}

export function playOcarinaNote(midi: number, durationSec = 0.45, volume = 0.28): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const freq = midiToFreq(midi);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.linearRampToValueAtTime(volume, now + 0.035);
    masterGain.gain.exponentialRampToValueAtTime(volume * 0.82, now + Math.max(0.08, durationSec * 0.7));
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec + 0.08);
    masterGain.connect(ctx.destination);

    // Pure vessel resonance (fundamental sine)
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(freq, now);

    // Subtle warm 2nd harmonic (soft triangle)
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(freq * 2, now);
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.setValueAtTime(0.055, now);

    // Gentle natural vibrato after initial attack
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.setValueAtTime(5.2, now);
    lfoGain.gain.setValueAtTime(0, now);
    lfoGain.gain.linearRampToValueAtTime(freq * 0.004, now + 0.18);
    lfo.connect(lfoGain);
    lfoGain.connect(osc1.frequency);

    // Breath air chiff through bandpass around note pitch
    const noise = ctx.createBufferSource();
    noise.buffer = getBreathNoiseBuffer(ctx);
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(Math.min(4500, freq * 1.4), now);
    filter.Q.setValueAtTime(3.2, now);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.09, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.025, now + 0.1);

    osc1.connect(masterGain);
    osc2.connect(osc2Gain);
    osc2Gain.connect(masterGain);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(masterGain);

    osc1.start(now);
    osc2.start(now);
    lfo.start(now);
    noise.start(now);

    const stopAt = now + durationSec + 0.1;
    osc1.stop(stopAt);
    osc2.stop(stopAt);
    lfo.stop(stopAt);
    noise.stop(stopAt);
  } catch {
    // ignore audio errors when blocked
  }
}

export interface SustainedHandle {
  stop: () => void;
  setMidi: (midi: number) => void;
}

export function startSustainedOcarinaNote(midi: number, volume = 0.28): SustainedHandle {
  const ctx = getAudioContext();
  const now = ctx.currentTime;
  const freq = midiToFreq(midi);

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(0.0001, now);
  masterGain.gain.linearRampToValueAtTime(volume, now + 0.04);
  masterGain.connect(ctx.destination);

  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(freq, now);

  const osc2 = ctx.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(freq * 2, now);
  const osc2Gain = ctx.createGain();
  osc2Gain.gain.setValueAtTime(0.05, now);

  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.setValueAtTime(5.0, now);
  lfoGain.gain.setValueAtTime(freq * 0.0035, now);
  lfo.connect(lfoGain);
  lfoGain.connect(osc1.frequency);

  const noise = ctx.createBufferSource();
  noise.buffer = getBreathNoiseBuffer(ctx);
  noise.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(Math.min(4500, freq * 1.4), now);
  filter.Q.setValueAtTime(3.0, now);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.03, now);

  osc1.connect(masterGain);
  osc2.connect(osc2Gain);
  osc2Gain.connect(masterGain);
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(masterGain);

  osc1.start(now);
  osc2.start(now);
  lfo.start(now);
  noise.start(now);

  let stopped = false;

  return {
    setMidi: (nextMidi: number) => {
      if (stopped) return;
      const t = ctx.currentTime;
      const nextFreq = midiToFreq(nextMidi);
      osc1.frequency.setTargetAtTime(nextFreq, t, 0.015);
      osc2.frequency.setTargetAtTime(nextFreq * 2, t, 0.015);
      filter.frequency.setTargetAtTime(Math.min(4500, nextFreq * 1.4), t, 0.02);
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      const t = ctx.currentTime;
      masterGain.gain.cancelScheduledValues(t);
      masterGain.gain.setValueAtTime(Math.max(0.0001, masterGain.gain.value), t);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      const end = t + 0.11;
      try {
        osc1.stop(end);
        osc2.stop(end);
        lfo.stop(end);
        noise.stop(end);
      } catch {
        // ignore
      }
    },
  };
}

export function playMetronomeClick(accent = false): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(accent ? 1150 : 820, now);
    osc.frequency.exponentialRampToValueAtTime(accent ? 620 : 480, now + 0.03);

    gain.gain.setValueAtTime(accent ? 0.16 : 0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.05);
  } catch {
    // ignore
  }
}
