import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  CheckCircle2,
  FileAudio,
  Mic2,
  Music,
  Play,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Wand2,
} from 'lucide-react';
import {
  getFingeringForMidi,
  getPlayableRange,
  midiToNoteName,
  OCARINA_KEYS,
  OCARINA_TYPE_META,
} from '../data/ocarinaData';
import { OcarinaKey, OcarinaType, Song } from '../types/ocarina';
import { getAudioContext, playOcarinaNote } from '../utils/audioSynth';
import {
  AnalysisResult,
  analyzeAudioBufferToMelody,
  convertRawNotesToSong,
  createSampleMelodyAudioBlob,
  ExtractionMode,
  findBestTransposition,
  RawExtractedNote,
} from '../utils/mp3Analyzer';
import { OcarinaDiagram } from './OcarinaDiagram';

interface Mp3StudioTabProps {
  ocarinaType: OcarinaType;
  ocarinaKey: OcarinaKey;
  onSaveAndOpenSong: (song: Song) => void;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

async function decodeAudioSafely(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  const copy = arrayBuffer.slice(0);
  try {
    const ctx = getAudioContext();
    return await ctx.decodeAudioData(copy);
  } catch {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const tempCtx = new AudioCtx();
    try {
      return await tempCtx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      tempCtx.close().catch(() => {});
    }
  }
}

export const Mp3StudioTab: React.FC<Mp3StudioTabProps> = ({
  ocarinaType,
  ocarinaKey,
  onSaveAndOpenSong,
}) => {
  const [fileName, setFileName] = useState<string>('');
  const [songTitle, setSongTitle] = useState<string>('');
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ pct: number; stage: string }>({
    pct: 0,
    stage: '',
  });
  const [error, setError] = useState<string | null>(null);

  const [extractionMode, setExtractionMode] = useState<ExtractionMode>('vocal');
  const [startSec, setStartSec] = useState<number>(0);
  const [windowSec, setWindowSec] = useState<number>(60);
  const [minNoteSec, setMinNoteSec] = useState<number>(0.13);
  const [sensitivity, setSensitivity] = useState<number>(0.08);

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [editableRawNotes, setEditableRawNotes] = useState<RawExtractedNote[]>([]);
  const [transpose, setTranspose] = useState<number>(0);
  const [foldOutOfRange, setFoldOutOfRange] = useState<boolean>(true);
  const [bpm, setBpm] = useState<number>(100);

  const [playingKind, setPlayingKind] = useState<'none' | 'original' | 'ocarina'>('none');
  const origSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ocarinaTimersRef = useRef<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopPlayback = () => {
    if (origSourceRef.current) {
      try {
        origSourceRef.current.stop();
      } catch {
        // ignore
      }
      origSourceRef.current = null;
    }
    ocarinaTimersRef.current.forEach((id) => window.clearTimeout(id));
    ocarinaTimersRef.current = [];
    setPlayingKind('none');
  };

  useEffect(() => {
    return () => stopPlayback();
  }, []);

  const runAnalysis = async (
    buf: AudioBuffer,
    opts?: {
      mode?: ExtractionMode;
      start?: number;
      win?: number;
      minSec?: number;
      sens?: number;
    }
  ) => {
    const useMode = opts?.mode ?? extractionMode;
    const useStart = opts?.start ?? startSec;
    const useWin = opts?.win ?? windowSec;
    const useMinSec = opts?.minSec ?? minNoteSec;
    const useSens = opts?.sens ?? sensitivity;

    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await analyzeAudioBufferToMelody(buf, {
        mode: useMode,
        startSec: useStart,
        maxDurationSec: useWin,
        minNoteSec: useMinSec,
        sensitivity: useSens,
        onProgress: (pct, stage) => setProgress({ pct, stage }),
      });
      setAnalysis(res);
      setEditableRawNotes(res.rawNotes);
      setBpm(res.estimatedBpm);
      const fit = findBestTransposition(res.rawNotes, ocarinaType, ocarinaKey);
      setTranspose(fit.bestShift);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not analyze audio buffer. Try switching Extraction Mode or lowering Noise Gate.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFileChosen = async (file: File) => {
    stopPlayback();
    setError(null);
    setFileName(file.name);
    const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
    setSongTitle(cleanTitle);
    setStartSec(0);

    try {
      setIsAnalyzing(true);
      setProgress({ pct: 2, stage: `Decoding ${file.name}...` });
      const arrayBuf = await file.arrayBuffer();
      const decoded = await decodeAudioSafely(arrayBuf);
      setAudioBuffer(decoded);
      await runAnalysis(decoded, { mode: extractionMode, start: 0 });
    } catch (err) {
      setIsAnalyzing(false);
      const msg = err instanceof Error ? err.message : 'Unsupported audio codec';
      setError(
        `Could not decode "${file.name}" (${msg}). Please try a standard MP3, WAV, M4A, or OGG file.`
      );
    }
  };

  const handleLoadSampleMelody = async () => {
    stopPlayback();
    setError(null);
    const blob = createSampleMelodyAudioBlob();
    setFileName('sample-folk-melody.wav');
    setSongTitle('Sample Folk Melody (Demo)');
    setStartSec(0);
    setExtractionMode('solo');
    const arrayBuf = await blob.arrayBuffer();
    const decoded = await decodeAudioSafely(arrayBuf);
    setAudioBuffer(decoded);
    await runAnalysis(decoded, { mode: 'solo', start: 0 });
  };

  const bestFitInfo = useMemo(() => {
    if (editableRawNotes.length === 0) return null;
    return findBestTransposition(editableRawNotes, ocarinaType, ocarinaKey);
  }, [editableRawNotes, ocarinaType, ocarinaKey]);

  const previewSong = useMemo(() => {
    if (!analysis) return null;
    return convertRawNotesToSong({
      title: songTitle || 'Converted MP3 Melody',
      rawNotes: editableRawNotes,
      bpm,
      transposeSemitones: transpose,
      foldOutOfRange,
      ocarinaType,
      ocarinaKey,
    });
  }, [analysis, editableRawNotes, songTitle, bpm, transpose, foldOutOfRange, ocarinaType, ocarinaKey]);

  const { minMidi, maxMidi } = getPlayableRange(ocarinaType, ocarinaKey);
  const inRangeFinalCount = previewSong
    ? previewSong.notes.filter((n) => !n.outOfRange).length
    : 0;
  const finalFitPct =
    previewSong && previewSong.notes.length > 0
      ? Math.round((inRangeFinalCount / previewSong.notes.length) * 100)
      : 0;

  const handlePlayOriginal = () => {
    if (playingKind === 'original') {
      stopPlayback();
      return;
    }
    if (!audioBuffer) return;
    stopPlayback();
    const ctx = getAudioContext();
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    src.onended = () => setPlayingKind('none');
    src.start(0, startSec, Math.min(windowSec, audioBuffer.duration - startSec));
    origSourceRef.current = src;
    setPlayingKind('original');
  };

  const handlePlayConverted = () => {
    if (playingKind === 'ocarina') {
      stopPlayback();
      return;
    }
    if (!previewSong || previewSong.notes.length === 0) return;
    stopPlayback();
    setPlayingKind('ocarina');
    const secPerBeat = 60 / bpm;
    const notesToPlay = previewSong.notes.slice(0, 100);
    notesToPlay.forEach((n, idx) => {
      const delayMs = n.startBeat * secPerBeat * 1000;
      const durSec = Math.max(0.14, n.durationBeats * secPerBeat * 0.88);
      const tId = window.setTimeout(() => {
        playOcarinaNote(n.midi, durSec, 0.28);
        if (idx === notesToPlay.length - 1) {
          const endId = window.setTimeout(() => setPlayingKind('none'), durSec * 1000 + 80);
          ocarinaTimersRef.current.push(endId);
        }
      }, delayMs);
      ocarinaTimersRef.current.push(tId);
    });
  };

  const removeRawNoteAt = (idx: number) => {
    setEditableRawNotes((prev) => prev.filter((_, i) => i !== idx));
  };

  const totalDur = audioBuffer?.duration ?? 0;

  return (
    <div className="space-y-5">
      {/* Header & Upload Dropzone */}
      <div className="bg-white rounded-2xl border border-[#E6DDD0] p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-[#2C221E] flex items-center gap-2">
              <AudioLines className="w-5 h-5 text-[#C2593F]" />
              MP3-to-Ocarina Music Scroll Converter
            </h2>
            <p className="text-xs sm:text-sm text-[#6E5D55] mt-0.5">
              Extracts singing vocals or solo instrument melodies in-browser and maps them onto playable ocarina fingerings.
            </p>
          </div>
          <button
            onClick={handleLoadSampleMelody}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#FAF6F0] border border-[#E6DDD0] text-xs font-semibold text-[#C2593F] hover:border-[#C2593F] transition cursor-pointer shrink-0"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Try Sample Melody Audio
          </button>
        </div>

        {/* Extraction Mode Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              setExtractionMode('vocal');
              if (audioBuffer) runAnalysis(audioBuffer, { mode: 'vocal' });
            }}
            className={`p-3 rounded-xl border text-left transition cursor-pointer flex items-start gap-3 ${
              extractionMode === 'vocal'
                ? 'bg-[#FCEEE9] border-[#C2593F]'
                : 'bg-[#FAF6F0] border-[#E6DDD0] hover:border-[#C2593F]/50'
            }`}
          >
            <Mic2
              className={`w-5 h-5 shrink-0 mt-0.5 ${
                extractionMode === 'vocal' ? 'text-[#C2593F]' : 'text-[#6E5D55]'
              }`}
            />
            <div>
              <div className="text-xs sm:text-sm font-bold text-[#2C221E]">
                Song / Voice Focus (Recommended for MP3s)
              </div>
              <div className="text-[11px] text-[#6E5D55] mt-0.5">
                Isolates center vocal range (155Hz–2.2kHz), reduces drums/bass, and tracks lead voice melody.
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setExtractionMode('solo');
              if (audioBuffer) runAnalysis(audioBuffer, { mode: 'solo' });
            }}
            className={`p-3 rounded-xl border text-left transition cursor-pointer flex items-start gap-3 ${
              extractionMode === 'solo'
                ? 'bg-[#FCEEE9] border-[#C2593F]'
                : 'bg-[#FAF6F0] border-[#E6DDD0] hover:border-[#C2593F]/50'
            }`}
          >
            <Music
              className={`w-5 h-5 shrink-0 mt-0.5 ${
                extractionMode === 'solo' ? 'text-[#C2593F]' : 'text-[#6E5D55]'
              }`}
            />
            <div>
              <div className="text-xs sm:text-sm font-bold text-[#2C221E]">
                Solo Instrument / Clean Voice
              </div>
              <div className="text-[11px] text-[#6E5D55] mt-0.5">
                High-precision pitch tracking for solo flute, piano, ocarina, whistling, or acapella.
              </div>
            </div>
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac"
          className="hidden"
          onClick={(e) => {
            (e.target as HTMLInputElement).value = '';
          }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileChosen(f);
          }}
        />

        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) handleFileChosen(f);
          }}
          className="border-2 border-dashed border-[#D4C5B3] hover:border-[#C2593F] bg-[#FAF6F0] rounded-2xl p-6 text-center cursor-pointer transition"
        >
          <div className="w-12 h-12 rounded-2xl bg-[#FCEEE9] text-[#C2593F] flex items-center justify-center mx-auto mb-3">
            {fileName ? <FileAudio className="w-6 h-6" /> : <Upload className="w-6 h-6" />}
          </div>
          <div className="font-bold text-sm sm:text-base text-[#2C221E]">
            {fileName ? `Loaded: ${fileName} (Tap to choose another)` : 'Tap or Drop an MP3 / WAV / M4A File Here'}
          </div>
          <p className="text-xs text-[#6E5D55] mt-1">
            Runs 100% locally in your browser — works on phone and desktop with no file upload limits.
          </p>
        </div>

        {isAnalyzing && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-semibold text-[#C2593F]">
              <span>{progress.stage}</span>
              <span>{progress.pct}%</span>
            </div>
            <div className="h-2.5 bg-[#F3ECE1] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#C2593F] transition-all duration-150"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
            {error}
          </div>
        )}
      </div>

      {/* Analysis Result & Smart Ocarina Compatibility Studio */}
      {analysis && previewSong && (
        <div className="space-y-5">
          {/* Waveform + Section Picker + Audio Compare */}
          <div className="bg-white rounded-2xl border border-[#E6DDD0] p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-[#6E5D55]">
                  Song Title for Scroll
                </label>
                <input
                  type="text"
                  value={songTitle}
                  onChange={(e) => setSongTitle(e.target.value)}
                  className="mt-1 w-full bg-[#FAF6F0] border border-[#E6DDD0] rounded-xl px-3 py-2 text-sm font-bold text-[#2C221E]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:pt-5">
                <button
                  onClick={handlePlayOriginal}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                    playingKind === 'original'
                      ? 'bg-[#2C221E] text-white border-[#2C221E]'
                      : 'bg-[#FAF6F0] text-[#2C221E] border-[#E6DDD0]'
                  }`}
                >
                  {playingKind === 'original' ? (
                    <Square className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  Original Audio
                </button>
                <button
                  onClick={handlePlayConverted}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                    playingKind === 'ocarina'
                      ? 'bg-[#2C221E] text-white'
                      : 'bg-[#C2593F] text-white hover:bg-[#9E412B]'
                  }`}
                >
                  {playingKind === 'ocarina' ? (
                    <Square className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  Ocarina Preview
                </button>
              </div>
            </div>

            {/* Full-track Waveform with Highlighted Analyzed Section */}
            <div className="space-y-2">
              <div className="h-16 bg-[#FAF6F0] rounded-xl border border-[#E6DDD0] px-2 relative flex items-center gap-[2px] overflow-hidden">
                {totalDur > 0 && (
                  <div
                    className="absolute top-0 bottom-0 bg-[#C2593F]/12 border-x border-[#C2593F]/40 pointer-events-none"
                    style={{
                      left: `${(analysis.analyzedStartSec / totalDur) * 100}%`,
                      width: `${Math.min(
                        100,
                        (analysis.analyzedDurationSec / totalDur) * 100
                      )}%`,
                    }}
                  />
                )}
                {analysis.waveformPeaks.map((p, idx) => (
                  <div
                    key={idx}
                    className="flex-1 bg-[#C2593F]/75 rounded-full relative z-10"
                    style={{ height: `${Math.max(8, Math.round(p * 100))}%` }}
                  />
                ))}
              </div>

              {/* Section / Chorus Picker when track > 30s */}
              {totalDur > 25 && (
                <div className="flex flex-wrap items-center justify-between gap-3 bg-[#FAF6F0] border border-[#E6DDD0] rounded-xl px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                    <span className="font-semibold text-[#6E5D55] shrink-0">
                      Start Time ({formatTime(startSec)} / {formatTime(totalDur)}):
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, Math.floor(totalDur - 5))}
                      value={startSec}
                      onChange={(e) => setStartSec(Number(e.target.value))}
                      className="flex-1 accent-[#C2593F]"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[#6E5D55]">Length:</span>
                    {[30, 60, 90].map((w) => (
                      <button
                        key={w}
                        onClick={() => setWindowSec(w)}
                        className={`px-2 py-0.5 rounded font-bold cursor-pointer ${
                          windowSec === w ? 'bg-[#C2593F] text-white' : 'bg-white text-[#6E5D55]'
                        }`}
                      >
                        {w}s
                      </button>
                    ))}
                    <button
                      onClick={() => audioBuffer && runAnalysis(audioBuffer)}
                      disabled={isAnalyzing}
                      className="px-2.5 py-1 rounded-lg bg-[#2C221E] text-white font-semibold cursor-pointer"
                    >
                      Analyze Section
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Ocarina Compatibility & Cleanup Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="bg-[#FAF6F0] rounded-xl border border-[#E6DDD0] p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#2C221E] flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-[#C2593F]" />
                    Ocarina Range Fit ({OCARINA_TYPE_META[ocarinaType].shortName}{' '}
                    {OCARINA_KEYS[ocarinaKey].shortName})
                  </span>
                  <span
                    className={`font-mono-tech text-xs font-bold px-2 py-0.5 rounded-full ${
                      finalFitPct >= 90
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {finalFitPct}% Fit ({inRangeFinalCount}/{previewSong.notes.length})
                  </span>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[#6E5D55]">Transpose (Semitones)</span>
                    <span className="font-mono-tech font-bold">
                      {transpose >= 0 ? `+${transpose}` : transpose} st
                      {bestFitInfo && bestFitInfo.bestShift !== transpose && (
                        <button
                          onClick={() => setTranspose(bestFitInfo.bestShift)}
                          className="ml-2 text-[#C2593F] underline cursor-pointer"
                        >
                          Use Best (
                          {bestFitInfo.bestShift >= 0
                            ? `+${bestFitInfo.bestShift}`
                            : bestFitInfo.bestShift}
                          )
                        </button>
                      )}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-12}
                    max={18}
                    value={transpose}
                    onChange={(e) => setTranspose(Number(e.target.value))}
                    className="w-full accent-[#C2593F]"
                  />
                </div>

                <label className="flex items-center justify-between text-xs font-medium text-[#2C221E] cursor-pointer">
                  <span>
                    Octave-fold stray notes into {midiToNoteName(minMidi)}–{midiToNoteName(maxMidi)}
                  </span>
                  <input
                    type="checkbox"
                    checked={foldOutOfRange}
                    onChange={(e) => setFoldOutOfRange(e.target.checked)}
                    className="accent-[#3D6B58] w-4 h-4"
                  />
                </label>
              </div>

              <div className="bg-[#FAF6F0] rounded-xl border border-[#E6DDD0] p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#2C221E] flex items-center gap-1.5">
                    <SlidersHorizontal className="w-4 h-4 text-[#C2593F]" />
                    Extraction Cleanup & Tempo
                  </span>
                  <button
                    onClick={() => audioBuffer && runAnalysis(audioBuffer)}
                    disabled={isAnalyzing}
                    className="text-xs font-bold text-[#C2593F] hover:underline cursor-pointer"
                  >
                    Re-Analyze
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex justify-between text-[11px] text-[#6E5D55] mb-1">
                      <span>Min Note</span>
                      <span className="font-mono-tech font-bold">
                        {Math.round(minNoteSec * 1000)}ms
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.08}
                      max={0.28}
                      step={0.02}
                      value={minNoteSec}
                      onChange={(e) => setMinNoteSec(Number(e.target.value))}
                      className="w-full accent-[#C2593F]"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-[11px] text-[#6E5D55] mb-1">
                      <span>Tempo (BPM)</span>
                      <span className="font-mono-tech font-bold">{bpm}</span>
                    </div>
                    <input
                      type="range"
                      min={60}
                      max={160}
                      value={bpm}
                      onChange={(e) => setBpm(Number(e.target.value))}
                      className="w-full accent-[#C2593F]"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-[#6E5D55] mb-1">
                    <span>Voice Gate (lower = catches softer singing)</span>
                    <span className="font-mono-tech font-bold">{Math.round(sensitivity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min={0.01}
                    max={0.22}
                    step={0.01}
                    value={sensitivity}
                    onChange={(e) => setSensitivity(Number(e.target.value))}
                    className="w-full accent-[#C2593F]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Generated Ocarina Scroll Preview */}
          <div className="bg-white rounded-2xl border border-[#E6DDD0] p-4 sm:p-5 shadow-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-[#2C221E]">
                  Generated Ocarina Scroll Preview ({previewSong.notes.length} notes)
                </h3>
                <p className="text-xs text-[#6E5D55]">
                  Tap a note card to hear it, or tap its trash icon to remove unwanted blips before opening in Tutor.
                </p>
              </div>
              <button
                onClick={() => onSaveAndOpenSong(previewSong)}
                disabled={previewSong.notes.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#3D6B58] text-white text-xs sm:text-sm font-bold hover:bg-[#2E5445] disabled:opacity-50 transition cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                Save & Open in Play Tutor
              </button>
            </div>

            {previewSong.notes.length === 0 ? (
              <div className="text-sm text-[#6E5D55] bg-[#FAF6F0] rounded-xl p-4 space-y-2 text-center">
                <p>No vocal/melody notes detected in this section with current gate settings.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    onClick={() => {
                      const nextSens = 0.02;
                      setSensitivity(nextSens);
                      if (audioBuffer) runAnalysis(audioBuffer, { sens: nextSens });
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#C2593F] text-white text-xs font-bold cursor-pointer"
                  >
                    Lower Voice Gate (2%) & Retry
                  </button>
                  <button
                    onClick={() => {
                      const nextMode: ExtractionMode = extractionMode === 'vocal' ? 'solo' : 'vocal';
                      setExtractionMode(nextMode);
                      if (audioBuffer) runAnalysis(audioBuffer, { mode: nextMode, sens: 0.03 });
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white border border-[#E6DDD0] text-xs font-bold text-[#2C221E] cursor-pointer"
                  >
                    Switch to {extractionMode === 'vocal' ? 'Solo Instrument' : 'Song / Voice'} Mode
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {previewSong.notes.map((n, idx) => {
                  const fing = getFingeringForMidi(n.midi, ocarinaType, ocarinaKey);
                  return (
                    <div
                      key={n.id}
                      onClick={() => playOcarinaNote(n.midi, 0.35)}
                      className={`relative group shrink-0 rounded-xl border p-2 flex flex-col items-center cursor-pointer min-w-[78px] ${
                        n.outOfRange
                          ? 'bg-red-50 border-red-300'
                          : 'bg-[#FAF6F0] border-[#E6DDD0] hover:border-[#C2593F]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeRawNoteAt(idx);
                        }}
                        title="Remove note"
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-[#E6DDD0] text-[#6E5D55] hover:text-red-600 flex items-center justify-center opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <span className="font-mono-tech text-xs font-bold text-[#2C221E]">
                        {midiToNoteName(n.midi)}
                      </span>
                      {fing.entry && (
                        <OcarinaDiagram
                          type={ocarinaType}
                          holes={fing.entry.holes}
                          size="xs"
                          highlightMismatch={n.outOfRange}
                          className="my-1"
                        />
                      )}
                      <span className="text-[10px] text-[#6E5D55]">{n.durationBeats}b</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
