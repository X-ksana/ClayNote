import { getPlayableRange } from '../data/ocarinaData';
import { OcarinaKey, OcarinaType, Song, SongNote } from '../types/ocarina';
import { detectPitchYIN } from './pitchDetector';

export interface RawExtractedNote {
  midi: number;
  startSec: number;
  durationSec: number;
  clarity: number;
}

export interface AnalysisConfig {
  /** Minimum note duration in seconds (default 0.14s) */
  minNoteSec?: number;
  /** RMS threshold multiplier relative to track peak (default 0.08) */
  sensitivity?: number;
  /** Max audio seconds to analyze (default 90s for fast mobile performance) */
  maxDurationSec?: number;
  onProgress?: (pct: number, stage: string) => void;
}

export interface AnalysisResult {
  rawNotes: RawExtractedNote[];
  estimatedBpm: number;
  durationSec: number;
  waveformPeaks: number[];
}

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function analyzeAudioBufferToMelody(
  audioBuffer: AudioBuffer,
  config: AnalysisConfig = {}
): Promise<AnalysisResult> {
  const minNoteSec = config.minNoteSec ?? 0.14;
  const sensitivity = config.sensitivity ?? 0.08;
  const maxDurationSec = config.maxDurationSec ?? 90;
  const onProgress = config.onProgress;

  onProgress?.(5, 'Mixing stereo channels to mono...');

  // Mix down to mono
  const sampleRate = audioBuffer.sampleRate;
  const maxSamples = Math.min(audioBuffer.length, Math.floor(maxDurationSec * sampleRate));
  const mono = new Float32Array(maxSamples);
  const numChannels = audioBuffer.numberOfChannels;

  for (let ch = 0; ch < numChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < maxSamples; i++) {
      mono[i] += data[i] / numChannels;
    }
  }

  // Downsample to ~22050Hz if sampleRate >= 44100 for faster mobile YIN analysis
  let workSamples = mono;
  let workRate = sampleRate;
  if (sampleRate >= 44100) {
    const factor = 2;
    const newLen = Math.floor(mono.length / factor);
    const down = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      down[i] = (mono[i * 2] + mono[i * 2 + 1]) * 0.5;
    }
    workSamples = down;
    workRate = sampleRate / factor;
  }

  // Compute compact waveform peaks (120 bars) for visual display
  const waveformPeaks: number[] = [];
  const barCount = 120;
  const barStep = Math.max(1, Math.floor(workSamples.length / barCount));
  let globalPeak = 0.001;
  for (let b = 0; b < barCount; b++) {
    let peak = 0;
    const start = b * barStep;
    const end = Math.min(workSamples.length, start + barStep);
    for (let i = start; i < end; i++) {
      const v = Math.abs(workSamples[i]);
      if (v > peak) peak = v;
    }
    if (peak > globalPeak) globalPeak = peak;
    waveformPeaks.push(peak);
  }
  for (let b = 0; b < waveformPeaks.length; b++) {
    waveformPeaks[b] = Math.min(1, waveformPeaks[b] / globalPeak);
  }

  // Adaptive RMS gate based on track loudness
  let rmsSum = 0;
  for (let i = 0; i < workSamples.length; i += 4) {
    rmsSum += workSamples[i] * workSamples[i];
  }
  const overallRms = Math.sqrt(rmsSum / Math.max(1, Math.floor(workSamples.length / 4)));
  const rmsGate = Math.max(0.008, overallRms * sensitivity * 2.2);

  const windowSize = 1536;
  const hopSize = Math.floor(workRate * 0.025); // 25ms frames
  const totalFrames = Math.max(1, Math.floor((workSamples.length - windowSize) / hopSize));

  interface Frame {
    time: number;
    midi: number | null;
    clarity: number;
    rms: number;
  }
  const frames: Frame[] = [];

  for (let f = 0; f < totalFrames; f++) {
    const start = f * hopSize;
    const slice = workSamples.subarray(start, start + windowSize);
    const reading = detectPitchYIN(slice, workRate, {
      minFreq: 130, // C3
      maxFreq: 2400, // ~D7
      threshold: 0.16,
      rmsThreshold: rmsGate,
    });

    frames.push({
      time: start / workRate,
      midi: reading.clarity >= 0.65 ? reading.midi : null,
      clarity: reading.clarity,
      rms: reading.rms,
    });

    // Yield periodically to keep mobile UI responsive
    if (f % 120 === 0) {
      const pct = 10 + Math.round((f / totalFrames) * 75);
      onProgress?.(pct, `Extracting melody pitch (${Math.round((f / totalFrames) * 100)}%)...`);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.(88, 'Smoothing pitch contour & segmenting notes...');

  // 5-frame median filter to kill transient octave blips
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

  // Segment contiguous frames with identical MIDI note (or slight re-onset dip)
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
      // Allow 1-frame dropout without breaking note
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
    } else if (Math.abs(m - curMidi) === 0) {
      // Check for sharp volume dip indicating repeated same note
      const prevRms = i > 0 ? frames[i - 1].rms : frames[i].rms;
      const prev2Rms = i > 1 ? frames[i - 2].rms : prevRms;
      if (frames[i].rms > prevRms * 1.65 && prevRms < prev2Rms * 0.7 && t - curStart >= minNoteSec) {
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
    durationSec: maxSamples / sampleRate,
    waveformPeaks,
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
    // Prefer smaller shift & octave shifts when tied
    const isOctave = shift % 12 === 0 ? 0 : 1;
    const penalty = Math.abs(shift) + isOctave * 2;
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

    // Quantize cleanly to nearest 1/4 beat (sixteenth)
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

  // Ensure strictly non-overlapping sequential startBeats if quantization caused collisions
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

/**
 * Generates a realistic solo melody WAV Blob in memory so users can test
 * the MP3/Audio-to-Ocarina-Scroll pipeline immediately in 1 click.
 */
export function createSampleMelodyAudioBlob(): Blob {
  const sampleRate = 22050;
  // Melody: C5, D5, E5, G5, E5, D5, C5, E5, G5, A5, G5, E5, D5, C5 (pitched in Bb4..G5 so Auto-Transpose shines!)
  const sequence: Array<[number, number]> = [
    [70, 0.45], // Bb4
    [72, 0.45], // C5
    [74, 0.45], // D5
    [77, 0.75], // F5
    [74, 0.45], // D5
    [72, 0.45], // C5
    [70, 0.8],  // Bb4
    [74, 0.45], // D5
    [77, 0.45], // F5
    [79, 0.65], // G5
    [77, 0.45], // F5
    [74, 0.45], // D5
    [72, 0.45], // C5
    [70, 0.9],  // Bb4
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
      const env =
        Math.min(1, t / 0.03) *
        Math.min(1, (dur - t) / 0.05) *
        0.55;
      const val =
        Math.sin(2 * Math.PI * freq * t) * 0.85 +
        Math.sin(2 * Math.PI * freq * 2 * t) * 0.15;
      pcm[cursor + i] = val * env;
    }
    cursor += len + Math.floor(0.06 * sampleRate);
  }

  // Encode 16-bit PCM WAV
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
