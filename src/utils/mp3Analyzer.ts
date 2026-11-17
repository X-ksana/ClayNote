import { getPlayableRange, midiToFreq } from '../data/ocarinaData';
import { OcarinaKey, OcarinaType, Song, SongNote } from '../types/ocarina';
import { detectPitchYIN } from './pitchDetector';

export type ExtractionMode = 'vocal' | 'solo';
export type VocalRegister = 'auto' | 'female' | 'male';

export interface RawExtractedNote {
  midi: number;
  startSec: number;
  durationSec: number;
  clarity: number;
}

export interface AnalysisConfig {
  mode?: ExtractionMode;
  vocalRegister?: VocalRegister;
  /** Minimum note duration in seconds (default 0.16s for playable ocarina phrasing) */
  minNoteSec?: number;
  /** Sensitivity 0.01..0.25 (lower = catches quieter singing, higher = stricter gate) */
  sensitivity?: number;
  /** Start offset in seconds inside the audio file */
  startSec?: number;
  /** Max audio seconds to analyze from startSec (default 60s) */
  maxDurationSec?: number;
  onProgress?: (pct: number, stage: string) => void;
}

export interface AnalysisResult {
  rawNotes: RawExtractedNote[];
  estimatedBpm: number;
  detectedKeyName: string;
  durationSec: number;
  analyzedStartSec: number;
  analyzedDurationSec: number;
  waveformPeaks: number[];
  modeUsed: ExtractionMode;
}

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Krumhansl-Schmuckler key profiles
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

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

function fftMagnitude(real: Float32Array, imag: Float32Array, magOut: Float32Array): void {
  const n = real.length;
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

function downsample2x(arr: Float32Array): Float32Array {
  const len = Math.floor(arr.length / 2);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = (arr[i * 2] + arr[i * 2 + 1]) * 0.5;
  }
  return out;
}

function detectDominantKey(pcWeights: Float64Array): { rootPc: number; isMinor: boolean; name: string } {
  let bestScore = -Infinity;
  let bestRoot = 0;
  let bestMinor = false;

  for (let root = 0; root < 12; root++) {
    let majScore = 0;
    let minScore = 0;
    for (let i = 0; i < 12; i++) {
      const pc = (root + i) % 12;
      majScore += pcWeights[pc] * MAJOR_PROFILE[i];
      minScore += pcWeights[pc] * MINOR_PROFILE[i];
    }
    if (majScore > bestScore) {
      bestScore = majScore;
      bestRoot = root;
      bestMinor = false;
    }
    if (minScore > bestScore) {
      bestScore = minScore;
      bestRoot = root;
      bestMinor = true;
    }
  }
  return {
    rootPc: bestRoot,
    isMinor: bestMinor,
    name: `${PITCH_NAMES[bestRoot]} ${bestMinor ? 'Minor' : 'Major'}`,
  };
}

/**
 * Extracts dominant singing voice or solo instrument melody from an AudioBuffer.
 * In 'vocal' mode:
 *  1. Computes stereo Mid & Side channels, performing spectral Mid-Side subtraction
 *     (|Mid| - 1.15*|Side|) to cancel wide-panned accompaniment (guzheng, guitars, reverb).
 *  2. Applies 180Hz-2400Hz bandpass to strip kick/bass & cymbals.
 *  3. Uses zero-padded 4096-pt FFT Harmonic Salience with fundamental-verification
 *     (preventing octave-down errors) + Krumhansl key-aware Viterbi DP smoothing.
 */
export async function analyzeAudioBufferToMelody(
  audioBuffer: AudioBuffer,
  config: AnalysisConfig = {}
): Promise<AnalysisResult> {
  const mode: ExtractionMode = config.mode ?? 'vocal';
  const vocalRegister: VocalRegister = config.vocalRegister ?? 'auto';
  const minNoteSec = config.minNoteSec ?? 0.16;
  const sensitivity = config.sensitivity ?? 0.07;
  const startSec = Math.max(0, Math.min(config.startSec ?? 0, Math.max(0, audioBuffer.duration - 1)));
  const maxDurationSec = config.maxDurationSec ?? 60;
  const onProgress = config.onProgress;

  // MIDI bounds tailored to vocal register
  const minMidiBound = vocalRegister === 'female' ? 55 : vocalRegister === 'male' ? 48 : 53; // G3 / C3 / F3
  const maxMidiBound = vocalRegister === 'female' ? 86 : vocalRegister === 'male' ? 79 : 86; // D6 / G5 / D6

  onProgress?.(4, 'Preparing audio channels...');

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
      detectedKeyName: 'C Major',
      durationSec: audioBuffer.duration,
      analyzedStartSec: startSec,
      analyzedDurationSec: segSamples / sampleRate,
      waveformPeaks: computeTrackWaveform(audioBuffer),
      modeUsed: mode,
    };
  }

  const numChannels = audioBuffer.numberOfChannels;
  let midRaw: Float32Array = new Float32Array(segSamples);
  let sideRaw: Float32Array | null = null;

  if (numChannels >= 2) {
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    if (mode === 'vocal') {
      sideRaw = new Float32Array(segSamples);
      for (let i = 0; i < segSamples; i++) {
        const l = left[startSample + i];
        const r = right[startSample + i];
        midRaw[i] = (l + r) * 0.5;
        sideRaw[i] = (l - r) * 0.5;
      }
    } else {
      for (let i = 0; i < segSamples; i++) {
        midRaw[i] = (left[startSample + i] + right[startSample + i]) * 0.5;
      }
    }
  } else {
    const ch0 = audioBuffer.getChannelData(0);
    midRaw.set(ch0.subarray(startSample, startSample + segSamples));
  }

  let workRate = sampleRate;
  if (sampleRate >= 40000) {
    midRaw = downsample2x(midRaw);
    if (sideRaw) sideRaw = downsample2x(sideRaw);
    workRate = sampleRate / 2;
  }

  const waveformPeaks = computeTrackWaveform(audioBuffer);

  // Bandpass filter for vocal mode (185Hz highpass kills bass/cello/kick, 2400Hz lowpass kills cymbals)
  let midProc: Float32Array = midRaw;
  let sideProc: Float32Array | null = sideRaw;
  if (mode === 'vocal') {
    onProgress?.(10, 'Filtering bass & percussion (185Hz–2.4kHz)...');
    const hpCutoff = vocalRegister === 'male' ? 135 : 185;
    midProc = applyBiquadFilter(applyBiquadFilter(midRaw, workRate, 'highpass', hpCutoff, 0.8), workRate, 'lowpass', 2400, 0.8);
    if (sideRaw) {
      sideProc = applyBiquadFilter(applyBiquadFilter(sideRaw, workRate, 'highpass', hpCutoff, 0.8), workRate, 'lowpass', 2400, 0.8);
    }
  }

  const hopSize = Math.floor(workRate * 0.025); // 25ms hop
  const windowSize = 2048; // ~93ms window
  const fftSize = 4096; // ~5.38Hz bin spacing
  const totalFrames = Math.max(1, Math.floor((midProc.length - windowSize) / hopSize));

  const hann = new Float32Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
  }

  // Compute frame RMS energy for silence gating
  const frameRms = new Float32Array(totalFrames);
  const sortedRms: number[] = [];
  for (let f = 0; f < totalFrames; f++) {
    const start = f * hopSize;
    let sq = 0;
    for (let i = 0; i < windowSize; i += 2) {
      const v = midProc[start + i];
      sq += v * v;
    }
    const rms = Math.sqrt(sq / (windowSize / 2));
    frameRms[f] = rms;
    sortedRms.push(rms);
  }
  sortedRms.sort((a, b) => a - b);
  const peakRms = sortedRms[Math.floor(sortedRms.length * 0.95)] ?? 0.1;
  const rmsGate = Math.max(0.0015, peakRms * (sensitivity * 0.55));

  interface FrameCandidate {
    time: number;
    midi: number | null;
    clarity: number;
    rms: number;
    scores: Float32Array | null;
  }

  const numMidiBins = maxMidiBound - minMidiBound + 1;
  const frames: FrameCandidate[] = [];
  const pcHistogram = new Float64Array(12);

  if (mode === 'vocal') {
    const realM = new Float32Array(fftSize);
    const imagM = new Float32Array(fftSize);
    const magM = new Float32Array(fftSize / 2);

    const realS = new Float32Array(fftSize);
    const imagS = new Float32Array(fftSize);
    const magS = new Float32Array(fftSize / 2);

    const magVocal = new Float32Array(fftSize / 2);
    const binHz = workRate / fftSize;

    // Precompute harmonic bins & vocal register weighting
    const sweetCenter = vocalRegister === 'female' ? 71 : vocalRegister === 'male' ? 62 : 69; // B4 / D4 / A4
    const midiCandidates: Array<{ bins: number[]; vocalWeight: number }> = [];
    for (let m = minMidiBound; m <= maxMidiBound; m++) {
      const f0 = midiToFreq(m);
      const bins = [1, 2, 3, 4].map((h) => (f0 * h) / binHz);
      const dist = Math.abs(m - sweetCenter) / 14;
      const vocalWeight = 1.0 - 0.15 * Math.min(1.4, dist * dist);
      midiCandidates.push({ bins, vocalWeight });
    }

    const minBandBin = Math.floor(170 / binHz);
    const maxBandBin = Math.min(magVocal.length - 2, Math.ceil(2500 / binHz));

    for (let f = 0; f < totalFrames; f++) {
      const start = f * hopSize;
      const rms = frameRms[f];

      if (rms < rmsGate) {
        frames.push({ time: start / workRate, midi: null, clarity: 0, rms, scores: null });
      } else {
        realM.fill(0);
        imagM.fill(0);
        for (let i = 0; i < windowSize; i++) {
          realM[i] = midProc[start + i] * hann[i];
        }
        fftMagnitude(realM, imagM, magM);

        if (sideProc) {
          realS.fill(0);
          imagS.fill(0);
          for (let i = 0; i < windowSize; i++) {
            realS[i] = sideProc[start + i] * hann[i];
          }
          fftMagnitude(realS, imagS, magS);
          for (let b = minBandBin; b <= maxBandBin; b++) {
            // Spectral Mid-Side subtraction suppresses stereo instruments & reverb
            magVocal[b] = Math.max(0, magM[b] - 1.15 * magS[b]);
          }
        } else {
          for (let b = minBandBin; b <= maxBandBin; b++) {
            magVocal[b] = magM[b];
          }
        }

        let bandSum = 1e-6;
        for (let b = minBandBin; b <= maxBandBin; b++) {
          bandSum += magVocal[b];
        }
        const avgBin = bandSum / Math.max(1, maxBandBin - minBandBin + 1);

        const scores = new Float32Array(numMidiBins);
        let bestIdx = 0;
        let bestScore = -Infinity;

        const peakAt = (bFloat: number) => {
          const b = Math.round(bFloat);
          if (b < 2 || b >= magVocal.length - 2) return 0;
          return Math.max(magVocal[b - 1], magVocal[b], magVocal[b + 1]);
        };

        for (let idx = 0; idx < numMidiBins; idx++) {
          const { bins, vocalWeight } = midiCandidates[idx];
          const h1 = peakAt(bins[0]);
          const h2 = peakAt(bins[1]);
          const h3 = peakAt(bins[2]);
          const h4 = peakAt(bins[3]);

          // Fundamental presence requirement: kills octave-down ghost picks!
          // If 2*f0 is huge while f0 AND 3*f0 are weak, true pitch is an octave higher (2*f0).
          const maxHarm = Math.max(h1, h2, h3, 1e-6);
          const fundRatio = h1 / maxHarm;
          const oddSupport = (h1 + h3) / (h2 + h4 + 1e-6);
          let octaveGate = 1.0;
          if (fundRatio < 0.22 && oddSupport < 0.55) {
            octaveGate = 0.25;
          } else if (fundRatio < 0.35) {
            octaveGate = 0.65;
          }

          // Sub-octave suppression
          const halfH = peakAt(bins[0] * 0.5);
          const rawSalience =
            (h1 * 1.15 + h2 * 0.65 + h3 * 0.4 + h4 * 0.2 - halfH * 0.3) / (avgBin * 2.2);

          const logScore = Math.log1p(Math.max(0, rawSalience)) * octaveGate * vocalWeight;
          scores[idx] = logScore;

          if (logScore > bestScore) {
            bestScore = logScore;
            bestIdx = idx;
          }
        }

        const isPitched = bestScore > 0.72;
        const bestMidi = minMidiBound + bestIdx;
        if (isPitched) {
          pcHistogram[((bestMidi % 12) + 12) % 12] += bestScore;
        }

        frames.push({
          time: start / workRate,
          midi: isPitched ? bestMidi : null,
          clarity: isPitched ? Math.min(1, bestScore / 2.5) : 0,
          rms,
          scores: isPitched ? scores : null,
        });
      }

      if (f % 80 === 0) {
        const pct = 15 + Math.round((f / totalFrames) * 65);
        onProgress?.(pct, `Isolating vocal melody (${Math.round((f / totalFrames) * 100)}%)...`);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // Detect musical key & give subtle in-key bonus before Viterbi DP smoothing
    const keyInfo = detectDominantKey(pcHistogram);
    const scaleOffsets = keyInfo.isMinor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    const inKeySet = new Set(scaleOffsets.map((o) => (keyInfo.rootPc + o) % 12));

    for (let f = 0; f < frames.length; f++) {
      const sc = frames[f].scores;
      if (!sc) continue;
      for (let idx = 0; idx < numMidiBins; idx++) {
        const pc = ((minMidiBound + idx) % 12 + 12) % 12;
        if (inKeySet.has(pc)) {
          sc[idx] += 0.28;
        }
      }
    }

    onProgress?.(84, `Smoothing contour (${keyInfo.name})...`);

    // Island-by-island Viterbi Dynamic Programming with strong octave/leap stability
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
              // Strong stability against frame-to-frame octave flips and wild accompaniment jumps
              let pen = 0;
              if (jump === 0) pen = 0;
              else if (jump <= 2) pen = 0.25;
              else if (jump <= 5) pen = 0.65;
              else if (jump <= 7) pen = 0.95;
              else if (jump === 12) pen = 2.2;
              else pen = 1.2 + (jump - 7) * 0.22;

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

    // Store key name for result
    var detectedKeyName = keyInfo.name;
  } else {
    // 'solo' mode: YIN pitch detection
    const yinWin = 1536;
    const yinFrames = Math.max(1, Math.floor((midProc.length - yinWin) / hopSize));
    for (let f = 0; f < yinFrames; f++) {
      const start = f * hopSize;
      const slice = midProc.subarray(start, start + yinWin);
      const reading = detectPitchYIN(slice, workRate, {
        minFreq: midiToFreq(minMidiBound) * 0.9,
        maxFreq: midiToFreq(maxMidiBound) * 1.1,
        threshold: 0.2,
        rmsThreshold: rmsGate,
      });

      const m = reading.clarity >= 0.45 ? reading.midi : null;
      if (m !== null) pcHistogram[((m % 12) + 12) % 12] += reading.clarity;

      frames.push({
        time: start / workRate,
        midi: m,
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
    var detectedKeyName = detectDominantKey(pcHistogram).name;
  }

  onProgress?.(92, 'Cleaning ornaments & building ocarina notes...');

  // 7-frame median filter (~175ms smoothing window) removes quick vibrato/flicker noise
  const smoothedMidi: Array<number | null> = frames.map((fr, idx) => {
    if (fr.midi === null) return null;
    const win: number[] = [];
    for (let k = Math.max(0, idx - 3); k <= Math.min(frames.length - 1, idx + 3); k++) {
      const m = frames[k].midi;
      if (m !== null) win.push(m);
    }
    if (win.length < 3) return null;
    return Math.round(median(win));
  });

  // Segment contiguous pitch regions into discrete musical notes
  let rawNotes: RawExtractedNote[] = [];
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
      const next2M = i + 2 < frames.length ? smoothedMidi[i + 2] : null;
      if (curMidi !== null && (nextM === curMidi || next2M === curMidi)) {
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
      const prevRms = i > 0 ? frames[i - 1].rms : frames[i].rms;
      const prev2Rms = i > 1 ? frames[i - 2].rms : prevRms;
      if (frames[i].rms > prevRms * 1.6 && prevRms < prev2Rms * 0.7 && t - curStart >= minNoteSec) {
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

  // Merge tiny same-pitch fragments separated by < 100ms gaps
  const merged: RawExtractedNote[] = [];
  for (const n of rawNotes) {
    const prev = merged[merged.length - 1];
    if (prev && prev.midi === n.midi && n.startSec - (prev.startSec + prev.durationSec) < 0.1) {
      prev.durationSec = n.startSec + n.durationSec - prev.startSec;
      prev.clarity = (prev.clarity + n.clarity) * 0.5;
    } else {
      merged.push({ ...n });
    }
  }
  rawNotes = merged;

  // Estimate BPM from median inter-onset interval
  let estimatedBpm = 96;
  if (rawNotes.length >= 4) {
    const iois: number[] = [];
    for (let i = 1; i < rawNotes.length; i++) {
      const diff = rawNotes[i].startSec - rawNotes[i - 1].startSec;
      if (diff >= 0.2 && diff <= 1.5) iois.push(diff);
    }
    if (iois.length >= 2) {
      const medIoi = median(iois);
      let bpm = 60 / medIoi;
      while (bpm < 68) bpm *= 2;
      while (bpm > 144) bpm /= 2;
      estimatedBpm = Math.round(bpm);
    }
  }

  onProgress?.(100, 'Complete!');
  return {
    rawNotes,
    estimatedBpm,
    detectedKeyName: detectedKeyName!,
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
