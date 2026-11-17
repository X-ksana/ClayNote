import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  CheckCircle2,
  FileAudio,
  Globe,
  Link2,
  Mic,
  Mic2,
  MonitorSpeaker,
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
  VocalRegister,
} from '../utils/mp3Analyzer';
import { OcarinaDiagram } from './OcarinaDiagram';

interface Mp3StudioTabProps {
  ocarinaType: OcarinaType;
  ocarinaKey: OcarinaKey;
  onSaveAndOpenSong: (song: Song) => void;
}

type AudioSourceTab = 'file' | 'tab-capture' | 'mic-url';

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
  const [sourceTab, setSourceTab] = useState<AudioSourceTab>('file');
  const [fileName, setFileName] = useState<string>('');
  const [songTitle, setSongTitle] = useState<string>('');
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ pct: number; stage: string }>({
    pct: 0,
    stage: '',
  });
  const [error, setError] = useState<string | null>(null);

  // Extraction settings
  const [extractionMode, setExtractionMode] = useState<ExtractionMode>('vocal');
  const [vocalRegister, setVocalRegister] = useState<VocalRegister>('female');
  const [startSec, setStartSec] = useState<number>(0);
  const [windowSec, setWindowSec] = useState<number>(60);
  const [minNoteSec, setMinNoteSec] = useState<number>(0.16);
  const [sensitivity, setSensitivity] = useState<number>(0.07);

  // Recording / Capture / URL states
  const [captureKind, setCaptureKind] = useState<'none' | 'tab' | 'mic'>('none');
  const [captureSeconds, setCaptureSeconds] = useState<number>(0);
  const [audioUrlInput, setAudioUrlInput] = useState<string>('');

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [editableRawNotes, setEditableRawNotes] = useState<RawExtractedNote[]>([]);
  const [transpose, setTranspose] = useState<number>(0);
  const [foldOutOfRange, setFoldOutOfRange] = useState<boolean>(true);
  const [bpm, setBpm] = useState<number>(100);

  const [playingKind, setPlayingKind] = useState<'none' | 'original' | 'ocarina'>('none');
  const origSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const ocarinaTimersRef = useRef<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const captureChunksRef = useRef<Blob[]>([]);
  const captureTimerRef = useRef<number | null>(null);

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

  const cleanupCapture = () => {
    if (captureTimerRef.current !== null) {
      window.clearInterval(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    if (captureStreamRef.current) {
      captureStreamRef.current.getTracks().forEach((t) => t.stop());
      captureStreamRef.current = null;
    }
    recorderRef.current = null;
    setCaptureKind('none');
  };

  useEffect(() => {
    return () => {
      stopPlayback();
      cleanupCapture();
    };
  }, []);

  const runAnalysis = async (
    buf: AudioBuffer,
    opts?: {
      mode?: ExtractionMode;
      register?: VocalRegister;
      start?: number;
      win?: number;
      minSec?: number;
      sens?: number;
    }
  ) => {
    const useMode = opts?.mode ?? extractionMode;
    const useRegister = opts?.register ?? vocalRegister;
    const useStart = opts?.start ?? startSec;
    const useWin = opts?.win ?? windowSec;
    const useMinSec = opts?.minSec ?? minNoteSec;
    const useSens = opts?.sens ?? sensitivity;

    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await analyzeAudioBufferToMelody(buf, {
        mode: useMode,
        vocalRegister: useRegister,
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
          : 'Could not analyze audio buffer. Try adjusting Voice Gate or Vocal Register.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const processDecodedBlobOrBuffer = async (blob: Blob, labelName: string, titleGuess: string) => {
    stopPlayback();
    setError(null);
    setFileName(labelName);
    setSongTitle(titleGuess);
    setStartSec(0);
    try {
      setIsAnalyzing(true);
      setProgress({ pct: 2, stage: `Decoding ${labelName}...` });
      const arrayBuf = await blob.arrayBuffer();
      const decoded = await decodeAudioSafely(arrayBuf);
      setAudioBuffer(decoded);
      await runAnalysis(decoded, { mode: extractionMode, register: vocalRegister, start: 0 });
    } catch (err) {
      setIsAnalyzing(false);
      const msg = err instanceof Error ? err.message : 'Unsupported audio codec';
      setError(`Could not decode "${labelName}" (${msg}). Try an MP3, WAV, M4A, or OGG file.`);
    }
  };

  const handleFileChosen = async (file: File) => {
    const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
    await processDecodedBlobOrBuffer(file, file.name, cleanTitle);
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

  // Start capturing YouTube / Bilibili browser tab audio (Desktop Chrome/Edge)
  const startTabAudioCapture = async () => {
    setError(null);
    stopPlayback();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      setError(
        'Tab audio capture is only supported in desktop browsers (Chrome/Edge). On a phone, use "Record Speaker / Mic" or upload an MP3 file.'
      );
      return;
    }
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as MediaTrackConstraints,
      });

      const audioTracks = displayStream.getAudioTracks();
      if (audioTracks.length === 0) {
        displayStream.getTracks().forEach((t) => t.stop());
        setError(
          'No audio track was shared! Please try again and check "Also share tab audio" in the browser popup.'
        );
        return;
      }

      const audioOnlyStream = new MediaStream(audioTracks);
      captureStreamRef.current = displayStream;
      captureChunksRef.current = [];

      const recorder = new MediaRecorder(audioOnlyStream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) captureChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const mime = recorder.mimeType || 'audio/webm';
        const recordedBlob = new Blob(captureChunksRef.current, { type: mime });
        cleanupCapture();
        await processDecodedBlobOrBuffer(
          recordedBlob,
          'captured-website-audio.webm',
          'Captured YouTube / Bilibili Melody'
        );
      };

      // Stop if user clicks browser's "Stop sharing" banner
      audioTracks[0].onended = () => {
        if (recorder.state === 'recording') recorder.stop();
      };

      recorderRef.current = recorder;
      recorder.start(250);
      setCaptureKind('tab');
      setCaptureSeconds(0);
      captureTimerRef.current = window.setInterval(() => {
        setCaptureSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      cleanupCapture();
      if (err instanceof Error && err.name !== 'NotAllowedError') {
        setError(`Tab capture error: ${err.message}`);
      }
    }
  };

  // Record from phone/desktop microphone (speaker playback or singing/humming)
  const startMicCapture = async () => {
    setError(null);
    stopPlayback();
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      captureStreamRef.current = micStream;
      captureChunksRef.current = [];
      const recorder = new MediaRecorder(micStream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) captureChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const mime = recorder.mimeType || 'audio/webm';
        const recordedBlob = new Blob(captureChunksRef.current, { type: mime });
        cleanupCapture();
        await processDecodedBlobOrBuffer(recordedBlob, 'mic-recording.webm', 'Recorded Melody');
      };
      recorderRef.current = recorder;
      recorder.start(250);
      setCaptureKind('mic');
      setCaptureSeconds(0);
      captureTimerRef.current = window.setInterval(() => {
        setCaptureSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      cleanupCapture();
      setError(
        err instanceof Error
          ? `Microphone error: ${err.message}`
          : 'Could not access microphone.'
      );
    }
  };

  const stopActiveCapture = () => {
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    } else {
      cleanupCapture();
    }
  };

  // Load direct audio URL (.mp3/.wav/.ogg)
  const handleLoadAudioUrl = async () => {
    const trimmed = audioUrlInput.trim();
    if (!trimmed) return;
    setError(null);

    if (/youtube\.com|youtu\.be|bilibili\.com|b23\.tv/i.test(trimmed)) {
      setError(
        'YouTube & Bilibili webpage URLs block direct browser downloads (CORS) and require a paid server/yt-dlp to extract. On desktop, use the "Capture YouTube / Bilibili Tab" button right next to this tab — it records the playing song directly in your browser for free!'
      );
      return;
    }

    try {
      setIsAnalyzing(true);
      setProgress({ pct: 5, stage: 'Fetching audio URL...' });
      const resp = await fetch(trimmed);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const urlName = trimmed.split('/').pop()?.split('?')[0] || 'remote-audio.mp3';
      await processDecodedBlobOrBuffer(
        blob,
        urlName,
        urlName.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ')
      );
    } catch (err) {
      setIsAnalyzing(false);
      setError(
        `Could not fetch URL directly (${err instanceof Error ? err.message : 'CORS blocked'}). Download the MP3 or use Tab Audio Capture instead.`
      );
    }
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
      {/* Header & Source Selector */}
      <div className="bg-white rounded-2xl border border-[#E6DDD0] p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-[#2C221E] flex items-center gap-2">
              <AudioLines className="w-5 h-5 text-[#C2593F]" />
              Audio & Website-to-Ocarina Studio
            </h2>
            <p className="text-xs sm:text-sm text-[#6E5D55] mt-0.5">
              Upload an MP3 or capture audio directly from a playing YouTube / Bilibili browser tab.
            </p>
          </div>
          <button
            onClick={handleLoadSampleMelody}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#FAF6F0] border border-[#E6DDD0] text-xs font-semibold text-[#C2593F] hover:border-[#C2593F] transition cursor-pointer shrink-0"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Try Sample Melody
          </button>
        </div>

        {/* 3 Audio Source Tabs */}
        <div className="grid grid-cols-3 gap-1.5 bg-[#F3ECE1] p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setSourceTab('file')}
            className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              sourceTab === 'file' ? 'bg-white text-[#C2593F] shadow-xs' : 'text-[#6E5D55]'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload MP3</span>
          </button>
          <button
            type="button"
            onClick={() => setSourceTab('tab-capture')}
            className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              sourceTab === 'tab-capture' ? 'bg-white text-[#C2593F] shadow-xs' : 'text-[#6E5D55]'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span className="truncate">YouTube / Bilibili</span>
          </button>
          <button
            type="button"
            onClick={() => setSourceTab('mic-url')}
            className={`py-2 px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition cursor-pointer ${
              sourceTab === 'mic-url' ? 'bg-white text-[#C2593F] shadow-xs' : 'text-[#6E5D55]'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            <span className="truncate">Mic / Audio URL</span>
          </button>
        </div>

        {/* Source Panel */}
        {sourceTab === 'file' && (
          <>
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
                {fileName
                  ? `Loaded: ${fileName} (Tap to choose another)`
                  : 'Tap or Drop an MP3 / WAV / M4A File Here'}
              </div>
              <p className="text-xs text-[#6E5D55] mt-1">
                Tip: For full songs with vocals, keep <strong>Song / Voice Focus</strong> ON and pick the verse/chorus section below.
              </p>
            </div>
          </>
        )}

        {sourceTab === 'tab-capture' && (
          <div className="bg-[#FAF6F0] rounded-2xl border border-[#E6DDD0] p-4 sm:p-5 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FCEEE9] text-[#C2593F] flex items-center justify-center shrink-0">
                <MonitorSpeaker className="w-5 h-5" />
              </div>
              <div className="text-xs sm:text-sm space-y-1">
                <div className="font-bold text-[#2C221E]">
                  Capture Playing YouTube / Bilibili / Spotify Tab (Free, Zero Server)
                </div>
                <ol className="list-decimal list-inside text-[#6E5D55] space-y-0.5 text-xs">
                  <li>Open the song on YouTube or Bilibili in another browser tab.</li>
                  <li>
                    Click <strong>Capture Tab Audio</strong> below, choose that tab, and enable{' '}
                    <strong>“Also share tab audio”</strong>.
                  </li>
                  <li>Play the chorus/verse (10–60s), then click <strong>Stop & Convert</strong>!</li>
                </ol>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {captureKind !== 'tab' ? (
                <button
                  type="button"
                  onClick={startTabAudioCapture}
                  disabled={captureKind === 'mic' || isAnalyzing}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C2593F] text-white text-xs sm:text-sm font-bold hover:bg-[#9E412B] transition cursor-pointer"
                >
                  <MonitorSpeaker className="w-4 h-4" />
                  Capture Tab Audio (Desktop)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopActiveCapture}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#2C221E] text-white text-xs sm:text-sm font-bold animate-pulse cursor-pointer"
                >
                  <Square className="w-4 h-4" />
                  Stop & Convert ({formatTime(captureSeconds)})
                </button>
              )}
              <span className="text-[11px] text-[#6E5D55]">
                Using a phone? Mobile browsers block cross-tab capture — switch to{' '}
                <button
                  type="button"
                  onClick={() => setSourceTab('mic-url')}
                  className="text-[#C2593F] font-semibold underline cursor-pointer"
                >
                  Mic / Audio URL
                </button>{' '}
                or upload an MP3.
              </span>
            </div>
          </div>
        )}

        {sourceTab === 'mic-url' && (
          <div className="bg-[#FAF6F0] rounded-2xl border border-[#E6DDD0] p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs sm:text-sm font-bold text-[#2C221E]">
                  Option A: Record Singing, Humming, or Nearby Speaker (Phone & Desktop)
                </div>
                <p className="text-xs text-[#6E5D55]">
                  Play a YouTube/Bilibili song out loud (or hum the melody) into your phone mic.
                </p>
              </div>
              {captureKind !== 'mic' ? (
                <button
                  type="button"
                  onClick={startMicCapture}
                  disabled={captureKind === 'tab' || isAnalyzing}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C2593F] text-white text-xs font-bold hover:bg-[#9E412B] cursor-pointer shrink-0"
                >
                  <Mic className="w-4 h-4" />
                  Record Audio
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopActiveCapture}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#2C221E] text-white text-xs font-bold animate-pulse cursor-pointer shrink-0"
                >
                  <Square className="w-4 h-4" />
                  Stop & Convert ({formatTime(captureSeconds)})
                </button>
              )}
            </div>

            <div className="border-t border-[#E6DDD0] pt-3 space-y-2">
              <div className="text-xs font-bold text-[#2C221E] flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-[#C2593F]" />
                Option B: Direct Audio File URL (.mp3 / .wav / .ogg)
              </div>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={audioUrlInput}
                  onChange={(e) => setAudioUrlInput(e.target.value)}
                  placeholder="https://example.com/melody.mp3"
                  className="flex-1 bg-white border border-[#E6DDD0] rounded-xl px-3 py-2 text-xs text-[#2C221E]"
                />
                <button
                  type="button"
                  onClick={handleLoadAudioUrl}
                  disabled={isAnalyzing || !audioUrlInput.trim()}
                  className="px-3.5 py-2 rounded-xl bg-[#2C221E] text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                >
                  Load URL
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Vocal Isolation Mode + Register Settings */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2.5">
          <button
            type="button"
            onClick={() => {
              setExtractionMode('vocal');
              if (audioBuffer) runAnalysis(audioBuffer, { mode: 'vocal' });
            }}
            className={`md:col-span-4 p-3 rounded-xl border text-left transition cursor-pointer flex items-start gap-2.5 ${
              extractionMode === 'vocal'
                ? 'bg-[#FCEEE9] border-[#C2593F]'
                : 'bg-[#FAF6F0] border-[#E6DDD0] hover:border-[#C2593F]/50'
            }`}
          >
            <Mic2
              className={`w-4 h-4 shrink-0 mt-0.5 ${
                extractionMode === 'vocal' ? 'text-[#C2593F]' : 'text-[#6E5D55]'
              }`}
            />
            <div>
              <div className="text-xs font-bold text-[#2C221E]">Song / Voice Focus</div>
              <div className="text-[11px] text-[#6E5D55] leading-tight mt-0.5">
                Mid-Side vocal isolation + key-aware contour tracking for MP3s with backing music.
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              setExtractionMode('solo');
              if (audioBuffer) runAnalysis(audioBuffer, { mode: 'solo' });
            }}
            className={`md:col-span-4 p-3 rounded-xl border text-left transition cursor-pointer flex items-start gap-2.5 ${
              extractionMode === 'solo'
                ? 'bg-[#FCEEE9] border-[#C2593F]'
                : 'bg-[#FAF6F0] border-[#E6DDD0] hover:border-[#C2593F]/50'
            }`}
          >
            <Music
              className={`w-4 h-4 shrink-0 mt-0.5 ${
                extractionMode === 'solo' ? 'text-[#C2593F]' : 'text-[#6E5D55]'
              }`}
            />
            <div>
              <div className="text-xs font-bold text-[#2C221E]">Solo Instrument / Clean</div>
              <div className="text-[11px] text-[#6E5D55] leading-tight mt-0.5">
                Precision YIN tracking for solo ocarina, flute, piano, or acapella singing.
              </div>
            </div>
          </button>

          <div className="md:col-span-4 p-3 rounded-xl border border-[#E6DDD0] bg-[#FAF6F0] flex flex-col justify-center">
            <label className="text-[11px] font-bold text-[#6E5D55] uppercase tracking-wider mb-1">
              Singer Vocal Range
            </label>
            <select
              value={vocalRegister}
              onChange={(e) => {
                const nextReg = e.target.value as VocalRegister;
                setVocalRegister(nextReg);
                if (audioBuffer) runAnalysis(audioBuffer, { register: nextReg });
              }}
              className="bg-white border border-[#E6DDD0] rounded-lg px-2.5 py-1.5 text-xs font-bold text-[#2C221E]"
            >
              <option value="female">Female / High / Opera (G3–D6)</option>
              <option value="auto">Auto / Mixed Range (F3–D6)</option>
              <option value="male">Male / Low Vocal (C3–G5)</option>
            </select>
          </div>
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
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-[#6E5D55]">
                    Song Title for Scroll
                  </label>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#FCEEE9] text-[#9E412B]">
                    Detected Key: {analysis.detectedKeyName}
                  </span>
                </div>
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

              {/* Section / Chorus Picker when track > 25s */}
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
                      <span>Min Note (Phrasing)</span>
                      <span className="font-mono-tech font-bold">
                        {Math.round(minNoteSec * 1000)}ms
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.1}
                      max={0.3}
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
                    max={0.2}
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
