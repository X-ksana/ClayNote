import { getPlayableRange, midiToFreq } from '../data/ocarinaData';
import { OcarinaKey, OcarinaType, Song, SongNote } from '../types/ocarina';
import { detectPitchYIN } from './pitchDetector';

export type ExtractionMode = 'vocal' | 'solo';

export interface RawExtractedNote {
  midi: number;
  startSec: number;
  durationSec: number;
  clarity: number;
}

export interface AnalysisConfig {
  mode?: ExtractionMode;
  /** Minimum note duration in seconds (default 0.13s) */
  minNoteSec?: number;
  /** Sensitivity 0.02..0.25 (lower = captures quieter notes, higher = stricter gate) */
  sensitivity?: number;
  /** Start offset in seconds inside the audio file */
  startSec?: number;
  /** Max audio seconds to analyze from startSec (default 60s) */
  maxDurationSec?: number;
  /** Vocal pitch range bounds in MIDI (default 48..88 = C3..E6) */
  minMidi?: number;
  maxMidi?: number;
  onProgress?: (pct: number, stage: string) => void;
}

export interface AnalysisResult {
  rawNotes: RawExtractedNote[];
  estimatedBpm: number;
  durationSec: number;
  analyzedStartSec: number;
  analyzedDurationSec: number;
  waveformPeaks: number[];
  modeUsed: ExtractionMode;
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Computes full-track waveform peaks for visual timeline scrubbing.
 */
export function computeTrackWaveform(audioBuffer: AudioBuffer, barCount = 120): number[] {
  const peaks: number[] = [];
  const ch0 = audioBuffer.getChannelData(0);
  const step = Math.max(1, Math.floor(ch0.length / barCount));
  let globalPeak = 0.001;
  for (let b = 0; b < barCount; b++) {
    let peak = 0;
    const start = b * step;
    const end = Math.min(ch0.length, start + step);
    const stride = Math.max(1, Math.floor((end - start) / 64));
    for (let i = start; i < end; i += stride) {
      const v = Math.abs(ch0[i]);
      if (v > peak) peak = v;
    }
    if (peak > globalPeak) globalPeak = peak;
    peaks.push(peak);
  }
  for (let i = 0; i < peaks.length; i++) {
    peaks[i] = Math.min(1, peaks[i] / globalPeak);
  }
  return peaks;
}

/**
 * Simple 2nd-order Biquad filter (High-pass or Low-pass) to isolate vocal/melody frequencies
 * and suppress kick drums, bass guitar (<150Hz), and hi-hats/cymbals (>2200Hz).
 */
function applyBiquadFilter(
  samples: Float32Array,
  sampleRate: number,
  type: 'highpass' | 'lowpass',
  cutoffHz: number,
  q = 0.707
): Float32Array {
  const out = new Float32Array(samples.length);
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * q);

  let b0 = 0, b1 = 0, b2 = 0;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW0;
  const a2 = 1 - alpha;

  if (type === 'highpass') {
    b0 = (1 + cosW0) / 2;
    b1 = -(1 + cosW0);
    b2 = (1 + cosW0) / 2;
  } else {
    b0 = (1 - cosW0) / 2;
    b1 = 1 - cosW0;
    b2 = (1 - cosW0) / 2;
  }

  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/**
 * In-place Radix-2 Cooley-Tukey FFT (length N must be power of 2).
 */
function fftMagnitude(real: Float32Array, imag: Float32Array, magOut: Float32Array): void {
  const n = real.length;
  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      let tmp = real[i]; real[i] = real[j]; real[j] = tmp;
      tmp = imag[i]; imag[i] = imag[j]; imag[j] = tmp;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  // Butterfly stages
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    const wStepR = Math.cos(step);
    const wStepI = Math.sin(step);
    for (let i = 0; i < n; i += size) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < half; k++) {
        const idx1 = i + k;
        const idx2 = idx1 + half;
        const tr = wr * real[idx2] - wi * imag[idx2];
        const ti = wr * imag[idx2] + wi * real[idx2];
        real[idx2] = real[idx1] - tr;
        imag[idx2] = imag[idx1] - ti;
        real[idx1] += tr;
        imag[idx1] += ti;
        const nextWr = wr * wStepR - wi * wStepI;
        wi = wr * wStepI + wi * wStepR;
        wr = nextWr;
      }
    }
  }

  const halfN = magOut.length;
  for (let i = 0; i < halfN; i++) {
    magOut[i] = Math.hypot(real[i], imag[i]);
  }
}

/**
 * Extracts dominant singing/lead melody from an MP3/audio buffer using either:
 * - 'vocal': Center-focused + Bandpass (155Hz-2200Hz) + Zero-padded FFT Harmonic Salience + Viterbi contour smoothing
 * - 'solo': Clean monophonic YIN pitch tracking with relaxed threshold + fallback salience
 */
export async function analyzeAudioBufferToMelody(
  audioBuffer: AudioBuffer,
  config: AnalysisConfig = {}
): Promise<AnalysisResult> {
  const mode: ExtractionMode = config.mode ?? 'vocal';
  const minNoteSec = config.minNoteSec ?? 0.13;
  const sensitivity = config.sensitivity ?? 0.08;
  const startSec = Math.max(0, Math.min(config.startSec ?? 0, Math.max(0, audioBuffer.duration - 1)));
  const maxDurationSec = config.maxDurationSec ?? 60;
  const minMidiBound = config.minMidi ?? 48; // C3
  const maxMidiBound = config.maxMidi ?? 88; // E6
  const onProgress = config.onProgress;

  onProgress?.(5, 'Preparing audio channel...');

  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.floor(startSec * sampleRate);
  const segSamples = Math.min(
    audioBuffer.length - startSample,
    Math.floor(maxDurationSec * sampleRate)
  );

  if (segSamples <= 2048) {
    return {
      rawNotes: [],
      estimatedBpm: 100,
      durationSec: audioBuffer.duration,
      analyzedStartSec: startSec,
      analyzedDurationSec: segSamples / sampleRate,
      waveformPeaks: computeTrackWaveform(audioBuffer),
      modeUsed: mode,
    };
  }

  const mono = new Float32Array(segSamples);
  const numChannels = audioBuffer.numberOfChannels;

  if (numChannels >= 2 && mode === 'vocal') {
    // Center-vocal weighted mix: boost mid (L+R) slightly over stereo side content
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    for (let i = 0; i < segSamples; i++) {
      const l = left[startSample + i];
      const r = right[startSample + i];
      const mid = (l + r) * 0.5;
      const side = Math.abs(l - r) * 0.5;
      // Attenuate strongly wide-panned accompaniment slightly while preserving center vocals
      const centerWeight = Math.abs(mid) / (Math.abs(mid) + side * 0.65 + 1e-5);
      mono[i] = mid * (0.45 + 0.55 * centerWeight);
    }
  } else {
    for (let ch = 0; ch < numChannels; ch++) {
      const data = audioBuffer.getChannelData(ch);
      for (let i = 0; i < segSamples; i++) {
        mono[i] += data[startSample + i] / numChannels;
      }
    }
  }

  // Downsample cleanly to ~22050Hz (or ~16k-24k) for crisp vocal analysis & speed
  let workSamples = mono;
  let workRate = sampleRate;
  if (sampleRate >= 40000) {
    const factor = 2;
    const newLen = Math.floor(mono.length / factor);
    const down = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      down[i] = (mono[i * 2] + mono[i * 2 + 1]) * 0.5;
    }
    workSamples = down;
    workRate = sampleRate / factor;
  }

  const waveformPeaks = computeTrackWaveform(audioBuffer);

  // In vocal mode, isolate 155Hz–2200Hz to strip kick/bass & cymbals
  let filteredSamples: Float32Array = workSamples;
  if (mode === 'vocal') {
    onProgress?.(10, 'Isolating vocal & lead melody band (155Hz–2.2kHz)...');
    const hp = applyBiquadFilter(workSamples, workRate, 'highpass', 155, 0.8);
    filteredSamples = applyBiquadFilter(hp, workRate, 'lowpass', 2200, 0.8);
  }

  const hopSize = Math.floor(workRate * 0.025); // 25ms steps
  const windowSize = 2048; // ~93ms window at 22050Hz
  const fftSize = 4096; // zero-padded for 5.38Hz bin spacing!
  const totalFrames = Math.max(1, Math.floor((filteredSamples.length - windowSize) / hopSize));

  // Precompute Hann window
  const hann = new Float32Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
  }

  // First pass: compute frame RMS values so we have an adaptive energy gate
  const frameRms = new Float32Array(totalFrames);
  const sortedRms: number[] = [];
  for (let f = 0; f < totalFrames; f++) {
    const start = f * hopSize;
    let sq = 0;
    for (let i = 0; i < windowSize; i += 2) {
      const v = filteredSamples[start + i];
      sq += v * v;
    }
    const rms = Math.sqrt(sq / (windowSize / 2));
    frameRms[f] = rms;
    sortedRms.push(rms);
  }
  sortedRms.sort((a, b) => a - b);
  const peakRms = sortedRms[Math.floor(sortedRms.length * 0.95)] ?? 0.1;

  // Gate only true silence / ultra-quiet background (never gate out continuous music verses!)
  const rmsGate = Math.max(0.0015, peakRms * (sensitivity * 0.5));

  interface FrameCandidate {
    time: number;
    midi: number | null;
    clarity: number;
    rms: number;
    scores: Float32Array | null;
  }

  const numMidiBins = maxMidiBound - minMidiBound + 1;
  const frames: FrameCandidate[] = [];

  if (mode === 'vocal') {
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    const mag = new Float32Array(fftSize / 2);
    const binHz = workRate / fftSize;

    // Precompute harmonic bin lookups & vocal weight for each MIDI candidate
    const midiHarmonicBins: Array<{ bins: number[]; vocalWeight: number }> = [];
    for (let m = minMidiBound; m <= maxMidiBound; m++) {
      const f0 = midiToFreq(m);
      const bins = [1, 2, 3, 4].map((h) => (f0 * h) / binHz);
      // Gentle vocal melody preference around C4 (60) .. G5 (79)
      const distFromSweetSpot = Math.abs(m - 68) / 14;
      const vocalWeight = 1.0 - 0.18 * Math.min(1.5, distFromSweetSpot * distFromSweetSpot);
      midiHarmonicBins.push({ bins, vocalWeight });
    }

    const harmonicWeights = [1.0, 0.72, 0.42, 0.22];

    for (let f = 0; f < totalFrames; f++) {
      const start = f * hopSize;
      const rms = frameRms[f];

      if (rms < rmsGate) {
        frames.push({ time: start / workRate, midi: null, clarity: 0, rms, scores: null });
      } else {
        real.fill(0);
        imag.fill(0);
        for (let i = 0; i < windowSize; i++) {
          real[i] = filteredSamples[start + i] * hann[i];
        }
        fftMagnitude(real, imag, mag);

        // Compute total spectral energy in melody band for normalization (rejects broadband drums!)
        const minBin = Math.floor(140 / binHz);
        const maxBin = Math.min(mag.length - 2, Math.ceil(2400 / binHz));
        let bandEnergy = 1e-6;
        for (let b = minBin; b <= maxBin; b++) {
          bandEnergy += mag[b];
        }
        const avgBinMag = bandEnergy / Math.max(1, maxBin - minBin + 1);

        const scores = new Float32Array(numMidiBins);
        let bestIdx = 0;
        let bestScore = -Infinity;
        let secondBest = -Infinity;

        for (let idx = 0; idx < numMidiBins; idx++) {
          const { bins, vocalWeight } = midiHarmonicBins[idx];
          let sum = 0;
          for (let h = 0; h < bins.length; h++) {
            const bFloat = bins[h];
            const bInt = Math.round(bFloat);
            if (bInt >= 2 && bInt < mag.length - 2) {
              // Local peak around bin to handle vibrato/tuning slight offsets
              const localMax = Math.max(mag[bInt - 1], mag[bInt], mag[bInt + 1]);
              sum += localMax * harmonicWeights[h];
            }
          }
          // Sub-octave suppression: check 0.5 * f0 to avoid octave-down error
          const halfBin = Math.round(bins[0] * 0.5);
          const halfEnergy =
            halfBin >= 2 && halfBin < mag.length - 1
              ? Math.max(mag[halfBin - 1], mag[halfBin], mag[halfBin + 1])
              : 0;
          const score = ((sum - halfEnergy * 0.35) / (avgBinMag * 2.4)) * vocalWeight;
          scores[idx] = score;
          if (score > bestScore) {
            secondBest = bestScore;
            bestScore = score;
            bestIdx = idx;
          } else if (score > secondBest) {
            secondBest = score;
          }
        }

        // Harmonic tonality check: pitched voice stands cleanly above flat percussion noise
        const tonality = Math.min(1, Math.max(0, (bestScore - 1.05) / 2.2));
        const isPitched = bestScore > 1.35;

        frames.push({
          time: start / workRate,
          midi: isPitched ? minMidiBound + bestIdx : null,
          clarity: isPitched ? tonality : 0,
          rms,
          scores: isPitched ? scores : null,
        });
      }

      if (f % 80 === 0) {
        const pct = 15 + Math.round((f / totalFrames) * 68);
        onProgress?.(pct, `Tracking vocal melody (${Math.round((f / totalFrames) * 100)}%)...`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // Viterbi / Dynamic Programming smoothing across voiced segments to prevent octave/chord jumps
    onProgress?.(85, 'Smoothing vocal contour...');
    const dpScores = new Float32Array(numMidiBins);
    const prevDp = new Float32Array(numMidiBins);
    const backPtr: Int16Array[] = [];

    for (let f = 0; f < frames.length; f++) {
      const fr = frames[f];
      const ptr = new Int16Array(numMidiBins).fill(-1);
      if (!fr.scores) {
        prevDp.fill(0);
        backPtr.push(ptr);
        continue;
      }

      const prevHasScores = f > 0 && frames[f - 1].scores !== null;
      for (let cur = 0; cur < numMidiBins; cur++) {
        if (!prevHasScores) {
          dpScores[cur] = fr.scores[cur];
          ptr[cur] = cur;
        } else {
          let bestPrevScore = -Infinity;
          let bestPrevIdx = cur;
          for (let prev = 0; prev < numMidiBins; prev++) {
            const jump = Math.abs(cur - prev);
            // Allow smooth steps & musical intervals, penalize erratic huge jumps & octave flips
            const penalty = jump === 0 ? 0 : jump <= 2 ? 0.12 : jump === 12 ? 0.9 : 0.28 + jump * 0.12;
            const cand = prevDp[prev] - penalty;
            if (cand > bestPrevScore) {
              bestPrevScore = cand;
              bestPrevIdx = prev;
            }
          }
          dpScores[cur] = bestPrevScore + fr.scores[cur];
          ptr[cur] = bestPrevIdx;
        }
      }
      prevDp.set(dpScores);
      backPtr.push(ptr);
    }

    // Backtrack each contiguous voiced island
    let idxEnd = frames.length - 1;
    while (idxEnd >= 0) {
      if (!frames[idxEnd].scores) {
        idxEnd--;
        continue;
      }
      let idxStart = idxEnd;
      while (idxStart > 0 && frames[idxStart - 1].scores !== null) {
        idxStart--;
      }
      // Re-run forward DP cleanly on this island or backtrack from end if we didn't overwrite prevDp:
      // Let's do a fast local DP per island so prevDp is exact!
      const islandLen = idxEnd - idxStart + 1;
      const localPrev = new Float32Array(numMidiBins);
      const localCur = new Float32Array(numMidiBins);
      const localBack: Int16Array[] = [];
      for (let k = 0; k < islandLen; k++) {
        const sc = frames[idxStart + k].scores!;
        const ptr = new Int16Array(numMidiBins);
        for (let cur = 0; cur < numMidiBins; cur++) {
          if (k === 0) {
            localCur[cur] = sc[cur];
            ptr[cur] = cur;
          } else {
            let bestP = -Infinity;
            let bestPI = cur;
            for (let prev = 0; prev < numMidiBins; prev++) {
              const jump = Math.abs(cur - prev);
              const pen = jump === 0 ? 0 : jump <= 2 ? 0.12 : jump === 12 ? 0.95 : 0.28 + jump * 0.12;
              const cand = localPrev[prev] - pen;
              if (cand > bestP) {
                bestP = cand;
                bestPI = prev;
              }
            }
            localCur[cur] = bestP + sc[cur];
            ptr[cur] = bestPI;
          }
        }
        localPrev.set(localCur);
        localBack.push(ptr);
      }

      let bestFinal = 0;
      for (let c = 1; c < numMidiBins; c++) {
        if (localPrev[c] > localPrev[bestFinal]) bestFinal = c;
      }
      let trace = bestFinal;
      for (let k = islandLen - 1; k >= 0; k--) {
        frames[idxStart + k].midi = minMidiBound + trace;
        trace = localBack[k][trace];
      }
      idxEnd = idxStart - 1;
    }
  } else {
    // 'solo' mode: YIN pitch detection with relaxed clarity
    const yinWin = 1536;
    const yinFrames = Math.max(1, Math.floor((filteredSamples.length - yinWin) / hopSize));
    for (let f = 0; f < yinFrames; f++) {
      const start = f * hopSize;
      const slice = filteredSamples.subarray(start, start + yinWin);
      const reading = detectPitchYIN(slice, workRate, {
        minFreq: midiToFreq(minMidiBound) * 0.95,
        maxFreq: midiToFreq(maxMidiBound) * 1.05,
        threshold: 0.2,
        rmsThreshold: rmsGate,
      });

      frames.push({
        time: start / workRate,
        midi: reading.clarity >= 0.45 ? reading.midi : null,
        clarity: reading.clarity,
        rms: reading.rms,
        scores: null,
      });

      if (f % 120 === 0) {
        const pct = 15 + Math.round((f / yinFrames) * 70);
        onProgress?.(pct, `Extracting solo pitch (${Math.round((f / yinFrames) * 100)}%)...`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }

  onProgress?.(92, 'Segmenting melody into ocarina notes...');

  // 5-frame median filter to remove single-frame artifacts
  const smoothedMidi: Array<number | null> = frames.map((fr, idx) => {
    if (fr.midi === null) return null;
    const win: number[] = [];
    for (let k = Math.max(0, idx - 2); k <= Math.min(frames.length - 1, idx + 2); k++) {
      const m = frames[k].midi;
      if (m !== null) win.push(m);
    }
    if (win.length < 2) return null;
    return Math.round(median(win));
  });

  // Segment contiguous pitch regions into discrete musical notes
  const rawNotes: RawExtractedNote[] = [];
  const frameDur = hopSize / workRate;
  let curMidi: number | null = null;
  let curStart = 0;
  let curClaritySum = 0;
  let curCount = 0;

  const flushNote = (endTime: number) => {
    if (curMidi !== null && curCount > 0) {
      const dur = endTime - curStart;
      if (dur >= minNoteSec) {
        rawNotes.push({
          midi: curMidi,
          startSec: curStart,
          durationSec: dur,
          clarity: curClaritySum / curCount,
        });
      }
    }
    curMidi = null;
    curCount = 0;
    curClaritySum = 0;
  };

  for (let i = 0; i < frames.length; i++) {
    const m = smoothedMidi[i];
    const t = frames[i].time;

    if (m === null) {
      const nextM = i + 1 < frames.length ? smoothedMidi[i + 1] : null;
      if (curMidi !== null && nextM === curMidi) {
        curCount++;
        continue;
      }
      flushNote(t);
    } else if (curMidi === null) {
      curMidi = m;
      curStart = t;
      curClaritySum = frames[i].clarity;
      curCount = 1;
    } else if (m === curMidi) {
      // Split repeated same-pitch syllables on clear volume re-articulation
      const prevRms = i > 0 ? frames[i - 1].rms : frames[i].rms;
      const prev2Rms = i > 1 ? frames[i - 2].rms : prevRms;
      if (frames[i].rms > prevRms * 1.55 && prevRms < prev2Rms * 0.72 && t - curStart >= minNoteSec) {
        flushNote(t);
        curMidi = m;
        curStart = t;
        curClaritySum = frames[i].clarity;
        curCount = 1;
      } else {
        curClaritySum += frames[i].clarity;
        curCount++;
      }
    } else {
      flushNote(t);
      curMidi = m;
      curStart = t;
      curClaritySum = frames[i].clarity;
      curCount = 1;
    }
  }
  flushNote(frames.length * frameDur);

  // Estimate BPM from median inter-onset interval
  let estimatedBpm = 100;
  if (rawNotes.length >= 4) {
    const iois: number[] = [];
    for (let i = 1; i < rawNotes.length; i++) {
      const diff = rawNotes[i].startSec - rawNotes[i - 1].startSec;
      if (diff >= 0.18 && diff <= 1.5) iois.push(diff);
    }
    if (iois.length >= 2) {
      const medIoi = median(iois);
      let bpm = 60 / medIoi;
      while (bpm < 68) bpm *= 2;
      while (bpm > 152) bpm /= 2;
      estimatedBpm = Math.round(bpm);
    }
  }

  onProgress?.(100, 'Complete!');
  return {
    rawNotes,
    estimatedBpm,
    durationSec: audioBuffer.duration,
    analyzedStartSec: startSec,
    analyzedDurationSec: segSamples / sampleRate,
    waveformPeaks,
    modeUsed: mode,
  };
}

export interface TranspositionFit {
  bestShift: number;
  fitPercent: number;
  inRangeCount: number;
  totalCount: number;
}

export function findBestTransposition(
  rawNotes: RawExtractedNote[],
  ocarinaType: OcarinaType,
  ocarinaKey: OcarinaKey
): TranspositionFit {
  if (rawNotes.length === 0) {
    return { bestShift: 0, fitPercent: 0, inRangeCount: 0, totalCount: 0 };
  }
  const { minMidi, maxMidi } = getPlayableRange(ocarinaType, ocarinaKey);

  let bestShift = 0;
  let bestCount = -1;
  let bestPenalty = Infinity;

  for (let shift = -24; shift <= 24; shift++) {
    let count = 0;
    for (const n of rawNotes) {
      const m = n.midi + shift;
      if (m >= minMidi && m <= maxMidi) count++;
    }
    const isOctave = shift % 12 === 0 ? 0 : 1;
    const penalty = Math.abs(shift) + isOctave * 8;
    if (count > bestCount || (count === bestCount && penalty < bestPenalty)) {
      bestCount = count;
      bestShift = shift;
      bestPenalty = penalty;
    }
  }

  return {
    bestShift,
    fitPercent: Math.round((bestCount / rawNotes.length) * 100),
    inRangeCount: bestCount,
    totalCount: rawNotes.length,
  };
}

export function convertRawNotesToSong(params: {
  title: string;
  rawNotes: RawExtractedNote[];
  bpm: number;
  transposeSemitones: number;
  foldOutOfRange: boolean;
  ocarinaType: OcarinaType;
  ocarinaKey: OcarinaKey;
}): Song {
  const { title, rawNotes, bpm, transposeSemitones, foldOutOfRange, ocarinaType, ocarinaKey } = params;
  const { minMidi, maxMidi } = getPlayableRange(ocarinaType, ocarinaKey);
  const beatsPerSec = bpm / 60;
  const firstTime = rawNotes.length > 0 ? rawNotes[0].startSec : 0;

  const notes: SongNote[] = rawNotes.map((rn, idx) => {
    let midi = rn.midi + transposeSemitones;
    let outOfRange = midi < minMidi || midi > maxMidi;

    if (outOfRange && foldOutOfRange) {
      while (midi < minMidi && midi + 12 <= maxMidi) midi += 12;
      while (midi > maxMidi && midi - 12 >= minMidi) midi -= 12;
      outOfRange = midi < minMidi || midi > maxMidi;
    }

    const rawStartBeat = Math.max(0, (rn.startSec - firstTime) * beatsPerSec);
    const startBeat = Math.round(rawStartBeat * 4) / 4;
    const rawDurBeat = Math.max(0.25, rn.durationSec * beatsPerSec);
    const durationBeats = Math.max(0.25, Math.round(rawDurBeat * 4) / 4);

    return {
      id: `mp3-n-${idx}`,
      midi,
      startBeat,
      durationBeats,
      outOfRange,
    };
  });

  for (let i = 1; i < notes.length; i++) {
    const prevEnd = notes[i - 1].startBeat + notes[i - 1].durationBeats;
    if (notes[i].startBeat < notes[i - 1].startBeat + 0.25) {
      notes[i].startBeat = prevEnd;
    } else if (notes[i].startBeat < prevEnd) {
      notes[i - 1].durationBeats = Math.max(0.25, notes[i].startBeat - notes[i - 1].startBeat);
    }
  }

  return {
    id: `mp3-${Date.now()}`,
    title: title.trim() || 'Converted MP3 Melody',
    composer: 'Extracted via ClayNote Audio Studio',
    difficulty: 'Custom MP3',
    bpm,
    recommendedType: ocarinaType,
    recommendedKey: ocarinaKey,
    notes,
    source: 'mp3',
    createdAt: Date.now(),
  };
}

export function createSampleMelodyAudioBlob(): Blob {
  const sampleRate = 22050;
  const sequence: Array<[number, number]> = [
    [70, 0.45],
    [72, 0.45],
    [74, 0.45],
    [77, 0.75],
    [74, 0.45],
    [72, 0.45],
    [70, 0.8],
    [74, 0.45],
    [77, 0.45],
    [79, 0.65],
    [77, 0.45],
    [74, 0.45],
    [72, 0.45],
    [70, 0.9],
  ];

  const totalSec = sequence.reduce((acc, [, d]) => acc + d + 0.06, 0.2);
  const totalSamples = Math.floor(totalSec * sampleRate);
  const pcm = new Float32Array(totalSamples);

  let cursor = Math.floor(0.1 * sampleRate);
  for (const [midi, dur] of sequence) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const len = Math.floor(dur * sampleRate);
    for (let i = 0; i < len && cursor + i < totalSamples; i++) {
      const t = i / sampleRate;
      const env = Math.min(1, t / 0.03) * Math.min(1, (dur - t) / 0.05) * 0.55;
      const val =
        Math.sin(2 * Math.PI * freq * t) * 0.85 +
        Math.sin(2 * Math.PI * freq * 2 * t) * 0.15;
      pcm[cursor + i] = val * env;
    }
    cursor += len + Math.floor(0.06 * sampleRate);
  }

  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, pcm.length * 2, true);

  let offset = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
