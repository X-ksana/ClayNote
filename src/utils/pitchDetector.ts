import { freqToMidiAndCents } from '../data/ocarinaData';
import { PitchReading } from '../types/ocarina';

export interface YinOptions {
  minFreq?: number;
  maxFreq?: number;
  threshold?: number;
  rmsThreshold?: number;
}

/**
 * Fast, accurate YIN monophonic pitch detector with parabolic interpolation.
 * Ideal for ocarina, whistling, singing, and solo melody extraction.
 */
export function detectPitchYIN(
  buffer: Float32Array,
  sampleRate: number,
  options: YinOptions = {}
): PitchReading {
  const minFreq = options.minFreq ?? 110; // ~A2 (covers humming + Bass C ocarina)
  const maxFreq = options.maxFreq ?? 3000; // covers up to F7 on Soprano C
  const threshold = options.threshold ?? 0.14;
  const rmsThreshold = options.rmsThreshold ?? 0.012;

  // 1. Compute RMS energy
  let sumSq = 0;
  for (let i = 0; i < buffer.length; i++) {
    sumSq += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(sumSq / buffer.length);

  if (rms < rmsThreshold) {
    return {
      frequency: null,
      midi: null,
      exactMidi: null,
      noteName: '—',
      cents: 0,
      clarity: 0,
      rms,
    };
  }

  const halfLen = Math.floor(buffer.length / 2);
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const maxTau = Math.min(halfLen - 1, Math.floor(sampleRate / minFreq));

  if (maxTau <= minTau + 2) {
    return {
      frequency: null,
      midi: null,
      exactMidi: null,
      noteName: '—',
      cents: 0,
      clarity: 0,
      rms,
    };
  }

  // 2. Difference function d(tau)
  const diff = new Float32Array(maxTau + 1);
  for (let tau = minTau; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < halfLen; i++) {
      const delta = buffer[i] - buffer[i + tau];
      sum += delta * delta;
    }
    diff[tau] = sum;
  }

  // 3. Cumulative mean normalized difference d'(tau)
  const cmndf = new Float32Array(maxTau + 1);
  cmndf[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = runningSum === 0 ? 1 : (diff[tau] * tau) / runningSum;
  }

  // 4. Absolute threshold search for first dip below threshold
  let tauEstimate = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (cmndf[tau] < threshold) {
      while (tau + 1 <= maxTau && cmndf[tau + 1] < cmndf[tau]) {
        tau++;
      }
      tauEstimate = tau;
      break;
    }
  }

  // Fallback: pick global minimum if none below strict threshold
  if (tauEstimate === -1) {
    let minVal = Infinity;
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (cmndf[tau] < minVal) {
        minVal = cmndf[tau];
        tauEstimate = tau;
      }
    }
    if (minVal > 0.35 || tauEstimate === -1) {
      return {
        frequency: null,
        midi: null,
        exactMidi: null,
        noteName: '—',
        cents: 0,
        clarity: Math.max(0, 1 - minVal),
        rms,
      };
    }
  }

  // 5. Parabolic interpolation around tauEstimate
  let betterTau = tauEstimate;
  if (tauEstimate > minTau && tauEstimate < maxTau) {
    const s0 = cmndf[tauEstimate - 1];
    const s1 = cmndf[tauEstimate];
    const s2 = cmndf[tauEstimate + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-6) {
      betterTau = tauEstimate + (s2 - s0) / denom;
    }
  }

  const frequency = sampleRate / betterTau;
  if (!Number.isFinite(frequency) || frequency < minFreq || frequency > maxFreq) {
    return {
      frequency: null,
      midi: null,
      exactMidi: null,
      noteName: '—',
      cents: 0,
      clarity: 0,
      rms,
    };
  }

  const clarity = Math.max(0, Math.min(1, 1 - cmndf[tauEstimate]));
  const { exactMidi, midi, cents, noteName } = freqToMidiAndCents(frequency);

  return {
    frequency,
    midi,
    exactMidi,
    noteName,
    cents,
    clarity,
    rms,
  };
}
