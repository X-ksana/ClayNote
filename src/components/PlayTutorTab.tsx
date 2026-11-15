import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Award,
  CheckCircle2,
  Download,
  Gauge,
  LayoutList,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  getFingeringForMidi,
  getPlayableRange,
  midiToNoteName,
  OCARINA_KEYS,
  OCARINA_TYPE_META,
} from '../data/ocarinaData';
import { useMicrophonePitch } from '../hooks/useMicrophonePitch';
import {
  NoteGrade,
  OcarinaKey,
  OcarinaType,
  PracticeNoteResult,
  ScrollViewMode,
  Song,
  SongNote,
  TutorMode,
} from '../types/ocarina';
import { playMetronomeClick, playOcarinaNote } from '../utils/audioSynth';
import { OcarinaDiagram } from './OcarinaDiagram';

interface PlayTutorTabProps {
  songs: Song[];
  activeSongId: string;
  onSelectSong: (id: string) => void;
  onDeleteSong: (id: string) => void;
  ocarinaType: OcarinaType;
  ocarinaKey: OcarinaKey;
}

export const PlayTutorTab: React.FC<PlayTutorTabProps> = ({
  songs,
  activeSongId,
  onSelectSong,
  onDeleteSong,
  ocarinaType,
  ocarinaKey,
}) => {
  const activeSong = songs.find((s) => s.id === activeSongId) ?? songs[0];

  const [scrollMode, setScrollMode] = useState<ScrollViewMode>('tab');
  const [tutorMode, setTutorMode] = useState<TutorMode>('listen');
  const [tempoScale, setTempoScale] = useState<number>(1.0);
  const [metronomeOn, setMetronomeOn] = useState<boolean>(false);
  const [playSynthGuide, setPlaySynthGuide] = useState<boolean>(true);
  const [transposeOffset, setTransposeOffset] = useState<number>(0);

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentBeat, setCurrentBeat] = useState<number>(0);
  const [activeNoteIdx, setActiveNoteIdx] = useState<number>(0);
  const [results, setResults] = useState<Record<string, PracticeNoteResult>>({});
  const [showReport, setShowReport] = useState<boolean>(false);
  const [autoDemoPlay, setAutoDemoPlay] = useState<boolean>(false);

  const {
    isListening,
    isDemoActive,
    reading,
    error: micError,
    startMic,
    stopMic,
    triggerDemoNote,
  } = useMicrophonePitch();

  const tabContainerRef = useRef<HTMLDivElement | null>(null);
  const noteRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);
  const triggeredSynthRef = useRef<Set<string>>(new Set());
  const lastMetronomeBeatRef = useRef<number>(-1);
  const sampleAccRef = useRef<
    Record<string, { hitFrames: number; sharpFrames: number; flatFrames: number; wrongFrames: number; totalFrames: number; centsSum: number; lastMidi: number | null }>
  >({});

  // Reset playback state when changing song
  useEffect(() => {
    setIsPlaying(false);
    setCurrentBeat(0);
    setActiveNoteIdx(0);
    setResults({});
    setShowReport(false);
    setTransposeOffset(0);
    triggeredSynthRef.current.clear();
    sampleAccRef.current = {};
    lastMetronomeBeatRef.current = -1;
  }, [activeSong?.id]);

  const { minMidi, maxMidi } = getPlayableRange(ocarinaType, ocarinaKey);

  // Apply optional user transposition so any song can fit current ocarina key/type
  const transposedNotes: SongNote[] = useMemo(() => {
    if (!activeSong) return [];
    return activeSong.notes.map((n) => {
      const m = n.midi + transposeOffset;
      return {
        ...n,
        midi: m,
        outOfRange: m < minMidi || m > maxMidi,
      };
    });
  }, [activeSong, transposeOffset, minMidi, maxMidi]);

  const totalBeats = useMemo(() => {
    if (transposedNotes.length === 0) return 4;
    const last = transposedNotes[transposedNotes.length - 1];
    return last.startBeat + last.durationBeats;
  }, [transposedNotes]);

  const outOfRangeCount = transposedNotes.filter((n) => n.outOfRange).length;

  const autoFitTranspose = () => {
    if (!activeSong || activeSong.notes.length === 0) return;
    let bestShift = 0;
    let bestFit = -1;
    for (let s = -24; s <= 24; s++) {
      let fit = 0;
      for (const n of activeSong.notes) {
        const m = n.midi + s;
        if (m >= minMidi && m <= maxMidi) fit++;
      }
      if (fit > bestFit || (fit === bestFit && Math.abs(s) < Math.abs(bestShift))) {
        bestFit = fit;
        bestShift = s;
      }
    }
    setTransposeOffset(bestShift);
  };

  // Current target note based on mode
  const currentTargetNote =
    tutorMode === 'wait'
      ? transposedNotes[activeNoteIdx] ?? null
      : transposedNotes.find(
          (n) => currentBeat >= n.startBeat && currentBeat < n.startBeat + n.durationBeats
        ) ?? transposedNotes[activeNoteIdx] ?? null;

  // Auto-Demo simulation for Wait/Graded modes when enabled
  useEffect(() => {
    if (!autoDemoPlay || !isPlaying || !currentTargetNote) return;
    // Simulate realistic slight cents wobble
    const wobble = Math.round(Math.sin(performance.now() / 300) * 9);
    triggerDemoNote(currentTargetNote.midi, wobble);
  }, [autoDemoPlay, isPlaying, currentTargetNote?.id, currentBeat]);

  // Evaluate live pitch in Wait-for-Note mode
  useEffect(() => {
    if (!isPlaying || tutorMode !== 'wait' || !currentTargetNote) return;
    if (reading.midi === null) return;

    const match = reading.midi === currentTargetNote.midi && Math.abs(reading.cents) <= 30;
    if (match) {
      const grade: NoteGrade = Math.abs(reading.cents) <= 15 ? 'perfect' : 'good';
      setResults((prev) => ({
        ...prev,
        [currentTargetNote.id]: {
          noteId: currentTargetNote.id,
          targetMidi: currentTargetNote.midi,
          detectedMidi: reading.midi,
          avgCents: reading.cents,
          grade,
          samples: 1,
        },
      }));

      const nextIdx = activeNoteIdx + 1;
      if (nextIdx >= transposedNotes.length) {
        setIsPlaying(false);
        setShowReport(true);
      } else {
        setActiveNoteIdx(nextIdx);
        setCurrentBeat(transposedNotes[nextIdx].startBeat);
        if (playSynthGuide) {
          playOcarinaNote(transposedNotes[nextIdx].midi, 0.35, 0.2);
        }
      }
    }
  }, [isPlaying, tutorMode, currentTargetNote, reading.midi, reading.cents, activeNoteIdx, transposedNotes, playSynthGuide]);

  // Real-time timeline loop for Listen & Graded modes
  useEffect(() => {
    if (!isPlaying || tutorMode === 'wait') {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }

    lastFrameRef.current = performance.now();
    const beatsPerSec = ((activeSong?.bpm ?? 100) * tempoScale) / 60;

    const finalizeNoteGrade = (note: SongNote) => {
      const acc = sampleAccRef.current[note.id];
      if (!acc || acc.totalFrames === 0) {
        setResults((prev) => ({
          ...prev,
          [note.id]: {
            noteId: note.id,
            targetMidi: note.midi,
            detectedMidi: null,
            avgCents: null,
            grade: 'missed',
            samples: 0,
          },
        }));
        return;
      }
      const avgCents = Math.round(acc.centsSum / acc.totalFrames);
      const hitRatio = acc.hitFrames / acc.totalFrames;
      let grade: NoteGrade = 'wrong';
      if (hitRatio >= 0.45) {
        grade = Math.abs(avgCents) <= 15 ? 'perfect' : 'good';
      } else if (acc.sharpFrames > acc.flatFrames && acc.sharpFrames > acc.wrongFrames) {
        grade = 'sharp';
      } else if (acc.flatFrames > acc.wrongFrames) {
        grade = 'flat';
      }
      setResults((prev) => ({
        ...prev,
        [note.id]: {
          noteId: note.id,
          targetMidi: note.midi,
          detectedMidi: acc.lastMidi,
          avgCents,
          grade,
          samples: acc.totalFrames,
        },
      }));
    };

    const step = (now: number) => {
      const dt = Math.min(0.1, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;

      setCurrentBeat((prevBeat) => {
        const nextBeat = prevBeat + dt * beatsPerSec;

        // Metronome click on whole beats
        if (metronomeOn) {
          const wholeBeat = Math.floor(nextBeat);
          if (wholeBeat > lastMetronomeBeatRef.current) {
            lastMetronomeBeatRef.current = wholeBeat;
            playMetronomeClick(wholeBeat % 4 === 0);
          }
        }

        // Find active note
        const idx = transposedNotes.findIndex(
          (n) => nextBeat >= n.startBeat && nextBeat < n.startBeat + n.durationBeats
        );
        if (idx !== -1) {
          setActiveNoteIdx(idx);
          const note = transposedNotes[idx];
          if (
            (tutorMode === 'listen' || playSynthGuide) &&
            !triggeredSynthRef.current.has(note.id)
          ) {
            triggeredSynthRef.current.add(note.id);
            const durSec = Math.max(0.16, (note.durationBeats / beatsPerSec) * 0.85);
            playOcarinaNote(note.midi, durSec, tutorMode === 'listen' ? 0.28 : 0.16);
          }
        }

        // Finalize any notes whose window just ended in Graded mode
        if (tutorMode === 'graded') {
          for (const n of transposedNotes) {
            if (nextBeat >= n.startBeat + n.durationBeats && !results[n.id]) {
              finalizeNoteGrade(n);
            }
          }
        }

        if (nextBeat >= totalBeats + 0.4) {
          setIsPlaying(false);
          if (tutorMode === 'graded') {
            for (const n of transposedNotes) {
              if (!results[n.id]) finalizeNoteGrade(n);
            }
            setShowReport(true);
          }
          return totalBeats;
        }
        return nextBeat;
      });

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [
    isPlaying,
    tutorMode,
    activeSong?.bpm,
    tempoScale,
    metronomeOn,
    playSynthGuide,
    transposedNotes,
    totalBeats,
  ]);

  // Collect mic pitch samples during Graded mode
  useEffect(() => {
    if (!isPlaying || tutorMode !== 'graded' || !currentTargetNote) return;
    if (reading.midi === null) return;

    const id = currentTargetNote.id;
    if (!sampleAccRef.current[id]) {
      sampleAccRef.current[id] = {
        hitFrames: 0,
        sharpFrames: 0,
        flatFrames: 0,
        wrongFrames: 0,
        totalFrames: 0,
        centsSum: 0,
        lastMidi: null,
      };
    }
    const acc = sampleAccRef.current[id];
    acc.totalFrames++;
    acc.lastMidi = reading.midi;

    if (reading.midi === currentTargetNote.midi) {
      acc.centsSum += reading.cents;
      if (Math.abs(reading.cents) <= 30) {
        acc.hitFrames++;
      } else if (reading.cents > 30) {
        acc.sharpFrames++;
      } else {
        acc.flatFrames++;
      }
    } else if (reading.midi > currentTargetNote.midi) {
      acc.sharpFrames++;
    } else {
      acc.flatFrames++;
    }
    if (Math.abs(reading.midi - currentTargetNote.midi) > 1) {
      acc.wrongFrames++;
    }
  }, [isPlaying, tutorMode, currentTargetNote?.id, reading.midi, reading.cents, currentBeat]);

  // Smooth auto-scroll Classic Tab card into view
  useEffect(() => {
    if (scrollMode !== 'tab' || !currentTargetNote) return;
    const el = noteRefs.current[currentTargetNote.id];
    if (el && tabContainerRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [currentTargetNote?.id, scrollMode]);

  const handleTogglePlay = async () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (currentBeat >= totalBeats - 0.1) {
      handleRestart();
    }
    if ((tutorMode === 'wait' || tutorMode === 'graded') && !isListening && !isDemoActive && !autoDemoPlay) {
      await startMic();
    }
    if (tutorMode === 'wait' && transposedNotes[activeNoteIdx] && playSynthGuide) {
      playOcarinaNote(transposedNotes[activeNoteIdx].midi, 0.35, 0.22);
    }
    setShowReport(false);
    setIsPlaying(true);
  };

  const handleRestart = () => {
    setIsPlaying(false);
    setCurrentBeat(0);
    setActiveNoteIdx(0);
    setResults({});
    setShowReport(false);
    triggeredSynthRef.current.clear();
    sampleAccRef.current = {};
    lastMetronomeBeatRef.current = -1;
  };

  const handleExportTabText = () => {
    if (!activeSong) return;
    const lines = [
      `ClayNote Ocarina Tab — ${activeSong.title}`,
      `Instrument: ${OCARINA_TYPE_META[ocarinaType].name} (${OCARINA_KEYS[ocarinaKey].name})`,
      `Tempo: ${activeSong.bpm} BPM | Transpose: ${transposeOffset >= 0 ? `+${transposeOffset}` : transposeOffset} st`,
      '',
      transposedNotes
        .map((n) => `${midiToNoteName(n.midi)}(${n.durationBeats}b)${n.lyric ? ` "${n.lyric}"` : ''}`)
        .join('  '),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSong.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-tab.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Summary Stats for Graded / Wait Session
  const gradedValues = Object.values(results);
  const hitCount = gradedValues.filter((r) => r.grade === 'perfect' || r.grade === 'good').length;
  const perfectCount = gradedValues.filter((r) => r.grade === 'perfect').length;
  const accuracyPct =
    gradedValues.length > 0 ? Math.round((hitCount / gradedValues.length) * 100) : 0;

  const targetFingering = currentTargetNote
    ? getFingeringForMidi(currentTargetNote.midi, ocarinaType, ocarinaKey)
    : null;

  // Highway pitch bounds
  const highwayMinMidi = Math.min(...transposedNotes.map((n) => n.midi), minMidi) - 2;
  const highwayMaxMidi = Math.max(...transposedNotes.map((n) => n.midi), maxMidi) + 2;
  const highwaySpan = Math.max(8, highwayMaxMidi - highwayMinMidi);

  const gradeBadgeStyle = (grade?: NoteGrade) => {
    switch (grade) {
      case 'perfect':
        return 'bg-emerald-50 border-emerald-500 text-emerald-900';
      case 'good':
        return 'bg-teal-50 border-teal-400 text-teal-900';
      case 'sharp':
      case 'flat':
        return 'bg-amber-50 border-amber-400 text-amber-900';
      case 'wrong':
      case 'missed':
        return 'bg-red-50 border-red-400 text-red-900';
      default:
        return 'bg-[#FAF6F0] border-[#E6DDD0] text-[#2C221E]';
    }
  };

  return (
    <div className="space-y-4">
      {/* Song Picker + Controls Header */}
      <div className="bg-white rounded-2xl border border-[#E6DDD0] p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#6E5D55]">
              Selected Music Scroll
            </label>
            <div className="flex items-center gap-2 mt-1">
              <select
                value={activeSong?.id ?? ''}
                onChange={(e) => onSelectSong(e.target.value)}
                className="flex-1 bg-[#FAF6F0] border border-[#E6DDD0] rounded-xl px-3 py-2 text-sm font-bold text-[#2C221E] truncate"
              >
                {songs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.source === 'mp3' ? '🎵 [MP3] ' : s.source === 'scale' ? '🎼 [Scale] ' : ''}
                    {s.title} ({s.difficulty})
                  </option>
                ))}
              </select>
              {activeSong?.source === 'mp3' && (
                <button
                  onClick={() => onDeleteSong(activeSong.id)}
                  title="Delete custom song"
                  className="p-2 rounded-xl border border-[#E6DDD0] text-[#6E5D55] hover:text-red-600 hover:border-red-300 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={handleExportTabText}
                title="Download readable tab (.txt)"
                className="p-2 rounded-xl border border-[#E6DDD0] text-[#6E5D55] hover:text-[#C2593F] hover:border-[#C2593F] cursor-pointer"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Dual Scroll View Switcher */}
          <div className="flex flex-col items-start sm:items-end gap-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#6E5D55]">
              Scroll Display
            </span>
            <div className="inline-flex rounded-xl bg-[#F3ECE1] p-1">
              <button
                onClick={() => setScrollMode('tab')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  scrollMode === 'tab' ? 'bg-white text-[#2C221E] shadow-xs' : 'text-[#6E5D55]'
                }`}
              >
                <LayoutList className="w-3.5 h-3.5" />
                Tab Scroll
              </button>
              <button
                onClick={() => setScrollMode('highway')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  scrollMode === 'highway' ? 'bg-white text-[#2C221E] shadow-xs' : 'text-[#6E5D55]'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                Rhythm Highway
              </button>
            </div>
          </div>
        </div>

        {/* Range Compatibility Alert & Quick Transpose */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[#FAF6F0] border border-[#E6DDD0] rounded-xl px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[#6E5D55]">
              {activeSong?.composer} • {activeSong?.bpm} BPM •{' '}
              {outOfRangeCount === 0 ? (
                <span className="text-[#3D6B58] font-bold">
                  100% fits {OCARINA_TYPE_META[ocarinaType].shortName} ({OCARINA_KEYS[ocarinaKey].shortName})
                </span>
              ) : (
                <span className="text-amber-700 font-bold">
                  {outOfRangeCount} note(s) outside {midiToNoteName(minMidi)}–{midiToNoteName(maxMidi)}
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#6E5D55]">Transpose:</span>
            <button
              onClick={() => setTransposeOffset((v) => Math.max(-12, v - 1))}
              className="px-2 py-0.5 rounded bg-white border border-[#E6DDD0] font-bold cursor-pointer"
            >
              -1
            </button>
            <span className="font-mono-tech font-bold min-w-[28px] text-center">
              {transposeOffset >= 0 ? `+${transposeOffset}` : transposeOffset}
            </span>
            <button
              onClick={() => setTransposeOffset((v) => Math.min(12, v + 1))}
              className="px-2 py-0.5 rounded bg-white border border-[#E6DDD0] font-bold cursor-pointer"
            >
              +1
            </button>
            {outOfRangeCount > 0 && (
              <button
                onClick={autoFitTranspose}
                className="px-2.5 py-1 rounded-lg bg-[#C2593F] text-white font-semibold cursor-pointer"
              >
                Auto-Fit
              </button>
            )}
          </div>
        </div>

        {/* Transport & Tutor Mode Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleTogglePlay}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-sm transition cursor-pointer ${
                isPlaying
                  ? 'bg-[#2C221E] text-white'
                  : 'bg-[#C2593F] text-white hover:bg-[#9E412B] shadow-xs'
              }`}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isPlaying ? 'Pause' : 'Start Practice'}
            </button>
            <button
              onClick={handleRestart}
              className="p-2.5 rounded-xl bg-[#FAF6F0] border border-[#E6DDD0] text-[#2C221E] hover:border-[#C2593F] cursor-pointer"
              title="Restart"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Tutor Mode Selector */}
            <div className="inline-flex rounded-xl bg-[#F3ECE1] p-1">
              {(
                [
                  { id: 'listen', label: 'Listen' },
                  { id: 'wait', label: 'Wait-for-Note' },
                  { id: 'graded', label: 'Live Graded' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setTutorMode(m.id);
                    handleRestart();
                  }}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    tutorMode === m.id ? 'bg-white text-[#C2593F] shadow-xs' : 'text-[#6E5D55]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tempo, Metronome, Mic Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 bg-[#FAF6F0] border border-[#E6DDD0] rounded-xl px-2 py-1">
              <Gauge className="w-3.5 h-3.5 text-[#6E5D55]" />
              {[0.5, 0.75, 1, 1.25].map((sp) => (
                <button
                  key={sp}
                  onClick={() => setTempoScale(sp)}
                  className={`px-2 py-0.5 rounded-lg text-xs font-mono-tech font-bold cursor-pointer ${
                    tempoScale === sp ? 'bg-[#C2593F] text-white' : 'text-[#6E5D55]'
                  }`}
                >
                  {sp}x
                </button>
              ))}
            </div>

            <button
              onClick={() => setMetronomeOn((v) => !v)}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer ${
                metronomeOn
                  ? 'bg-[#3D6B58] text-white border-[#3D6B58]'
                  : 'bg-[#FAF6F0] text-[#6E5D55] border-[#E6DDD0]'
              }`}
            >
              Metronome
            </button>

            <button
              onClick={() => setPlaySynthGuide((v) => !v)}
              title="Toggle guide synth audio"
              className={`p-2 rounded-xl border transition cursor-pointer ${
                playSynthGuide
                  ? 'bg-[#FCEEE9] text-[#C2593F] border-[#C2593F]/40'
                  : 'bg-[#FAF6F0] text-[#6E5D55] border-[#E6DDD0]'
              }`}
            >
              {playSynthGuide ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {!isListening ? (
              <button
                onClick={startMic}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#2C221E] text-white text-xs font-semibold cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5" />
                Mic Off
              </button>
            ) : (
              <button
                onClick={stopMic}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5 animate-pulse" />
                Mic Live
              </button>
            )}

            <button
              onClick={() => {
                if (autoDemoPlay) {
                  setAutoDemoPlay(false);
                  triggerDemoNote(null);
                } else {
                  setAutoDemoPlay(true);
                }
              }}
              className={`px-2.5 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer ${
                autoDemoPlay
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-white text-[#6E5D55] border-[#E6DDD0]'
              }`}
            >
              {autoDemoPlay ? 'Auto-Demo ON' : 'Demo Pitch'}
            </button>
          </div>
        </div>

        {micError && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-2.5">
            {micError}
          </div>
        )}
      </div>

      {/* Live Coaching HUD: Current Target Fingering + Real-Time Mic Feedback */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        <div className="md:col-span-5 bg-white rounded-2xl border border-[#E6DDD0] p-4 shadow-xs flex items-center gap-4">
          <div className="shrink-0 bg-[#FAF6F0] rounded-xl border border-[#E6DDD0] p-2">
            {targetFingering?.entry && (
              <OcarinaDiagram
                type={ocarinaType}
                holes={targetFingering.entry.holes}
                size="sm"
                showLabels
                highlightMismatch={Boolean(currentTargetNote?.outOfRange)}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#6E5D55]">
              {tutorMode === 'wait' ? 'Play This Note Now' : 'Current Note'}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono-tech text-[#C2593F]">
                {currentTargetNote ? midiToNoteName(currentTargetNote.midi) : '—'}
              </span>
              {currentTargetNote?.lyric && (
                <span className="text-sm font-medium text-[#6E5D55] truncate">
                  “{currentTargetNote.lyric}”
                </span>
              )}
            </div>
            <p className="text-xs text-[#6E5D55] mt-1 line-clamp-2">
              {currentTargetNote?.outOfRange
                ? 'Note outside this ocarina range — click Auto-Fit above!'
                : targetFingering?.entry?.tip ?? 'Cover dark holes and blow steadily.'}
            </p>
          </div>
        </div>

        {/* Live Voice/Ocarina Pitch Analyzer HUD */}
        <div className="md:col-span-7 bg-white rounded-2xl border border-[#E6DDD0] p-4 shadow-xs flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#6E5D55]">
                Voice & Ocarina Pitch Analyzer
              </span>
              <div className="flex items-baseline gap-2.5 mt-0.5">
                <span className="text-2xl font-bold font-mono-tech text-[#2C221E]">
                  {reading.noteName}
                </span>
                {reading.frequency && (
                  <span className="text-xs font-mono-tech text-[#6E5D55]">
                    {reading.frequency.toFixed(1)} Hz ({reading.cents >= 0 ? `+${reading.cents}` : reading.cents}¢)
                  </span>
                )}
              </div>
            </div>

            {gradedValues.length > 0 && (
              <div className="text-right">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#6E5D55]">
                  Live Accuracy
                </div>
                <div className="text-2xl font-bold font-mono-tech text-[#3D6B58]">
                  {accuracyPct}%
                </div>
              </div>
            )}
          </div>

          {/* Real-time Cents Deviation Bar */}
          <div>
            <div className="h-3 bg-[#F3ECE1] rounded-full relative overflow-hidden">
              <div className="absolute left-[38%] right-[38%] top-0 bottom-0 bg-emerald-200/80" />
              {reading.frequency && (
                <div
                  className={`absolute top-0 bottom-0 w-3 rounded-full transition-all duration-75 ${
                    currentTargetNote &&
                    reading.midi === currentTargetNote.midi &&
                    Math.abs(reading.cents) <= 22
                      ? 'bg-[#3D6B58]'
                      : 'bg-[#C2593F]'
                  }`}
                  style={{
                    left: `calc(${Math.max(4, Math.min(96, 50 + reading.cents))}% - 6px)`,
                  }}
                />
              )}
            </div>
            <div className="flex justify-between text-[11px] text-[#6E5D55] mt-1">
              <span>Flat (Blow Firmer)</span>
              <span>
                {!isListening && !isDemoActive && !autoDemoPlay
                  ? 'Tap Mic Off or Demo Pitch to analyze'
                  : currentTargetNote && reading.midi === currentTargetNote.midi
                  ? Math.abs(reading.cents) <= 18
                    ? '✓ Accurate Pitch!'
                    : reading.cents > 0
                    ? 'Slightly Sharp — Ease breath'
                    : 'Slightly Flat — Firm breath'
                  : reading.midi !== null
                  ? `Playing ${reading.noteName} (Target: ${
                      currentTargetNote ? midiToNoteName(currentTargetNote.midi) : '—'
                    })`
                  : 'Listening for note...'}
              </span>
              <span>Sharp (Blow Softer)</span>
            </div>
          </div>
        </div>
      </div>

      {/* DUAL MUSIC SCROLL VIEWPORT */}
      {scrollMode === 'tab' ? (
        <div className="bg-white rounded-2xl border border-[#E6DDD0] p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between text-xs text-[#6E5D55]">
            <span className="font-semibold">
              Horizontal Ocarina Tab Scroll ({transposedNotes.length} notes)
            </span>
            <span>Tap any card to hear & jump playhead</span>
          </div>

          <div
            ref={tabContainerRef}
            className="flex gap-2.5 overflow-x-auto pb-3 pt-1 px-1 scroll-smooth"
          >
            {transposedNotes.map((note, idx) => {
              const isActive = idx === activeNoteIdx;
              const res = results[note.id];
              const fing = getFingeringForMidi(note.midi, ocarinaType, ocarinaKey);

              return (
                <div
                  key={note.id}
                  ref={(el) => {
                    noteRefs.current[note.id] = el;
                  }}
                  onClick={() => {
                    setActiveNoteIdx(idx);
                    setCurrentBeat(note.startBeat);
                    playOcarinaNote(note.midi, 0.45);
                  }}
                  style={{ minWidth: `${Math.max(82, Math.min(130, note.durationBeats * 56))}px` }}
                  className={`shrink-0 rounded-2xl border-2 p-2.5 flex flex-col items-center transition cursor-pointer ${
                    isActive
                      ? 'border-[#C2593F] bg-[#FCEEE9] scale-[1.03] shadow-sm'
                      : gradeBadgeStyle(res?.grade)
                  }`}
                >
                  <div className="flex items-center justify-between w-full text-[11px] font-bold">
                    <span className="font-mono-tech text-sm">
                      {midiToNoteName(note.midi)}
                    </span>
                    <span className="text-[10px] opacity-75">{note.durationBeats}b</span>
                  </div>

                  {fing.entry && (
                    <OcarinaDiagram
                      type={ocarinaType}
                      holes={fing.entry.holes}
                      size="xs"
                      highlightMismatch={note.outOfRange}
                      className="my-1.5"
                    />
                  )}

                  <div className="text-[11px] font-medium truncate max-w-full min-h-[16px]">
                    {res ? (
                      <span className="uppercase text-[10px] font-bold">
                        {res.grade === 'perfect'
                          ? '★ Perfect'
                          : res.grade === 'good'
                          ? '✓ Good'
                          : res.grade}
                      </span>
                    ) : (
                      note.lyric ?? (note.outOfRange ? 'Out of range' : '')
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* RHYTHM-GAME NOTE HIGHWAY */
        <div className="bg-[#231B18] text-[#FAF6F0] rounded-2xl border border-[#3E302B] p-4 shadow-sm space-y-3 overflow-hidden">
          <div className="flex items-center justify-between text-xs text-[#D4C5B3]">
            <span className="font-semibold flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#E39780]" />
              Rhythm-Game Note Highway (Strike Zone on Left)
            </span>
            <span className="font-mono-tech">
              Beat {currentBeat.toFixed(1)} / {totalBeats.toFixed(1)}
            </span>
          </div>

          <div className="relative h-64 sm:h-72 rounded-xl bg-[#191310] border border-[#3E302B] overflow-hidden select-none">
            {/* Horizontal pitch guide lines */}
            {[0.2, 0.4, 0.6, 0.8].map((pos) => (
              <div
                key={pos}
                className="absolute left-0 right-0 border-t border-white/5"
                style={{ top: `${pos * 100}%` }}
              />
            ))}

            {/* Strike Zone Line */}
            <div className="absolute top-0 bottom-0 left-[18%] w-1 bg-[#C2593F] shadow-[0_0_12px_rgba(194,89,63,0.9)] z-10" />
            <div className="absolute top-2 left-[19%] text-[10px] font-bold uppercase tracking-wider text-[#E39780] z-10">
              Play Line
            </div>

            {/* Live Mic Pitch Cursor on Strike Zone */}
            {reading.midi !== null && (
              <div
                className="absolute left-[18%] -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-emerald-400 border-2 border-white shadow-[0_0_12px_rgba(52,211,153,0.9)] z-20 transition-all duration-75"
                style={{
                  top: `${Math.max(
                    8,
                    Math.min(
                      92,
                      90 - ((reading.midi - highwayMinMidi) / highwaySpan) * 80
                    )
                  )}%`,
                }}
              />
            )}

            {/* Scrolling Note Blocks */}
            {transposedNotes.map((note) => {
              // 1 beat = 11% width -> ~7.5 beats visible ahead
              const xPct = 18 + (note.startBeat - currentBeat) * 11;
              const widthPct = Math.max(4.5, note.durationBeats * 11 - 0.8);
              if (xPct + widthPct < -5 || xPct > 105) return null;

              const yPct = 90 - ((note.midi - highwayMinMidi) / highwaySpan) * 80;
              const isCurrent =
                currentBeat >= note.startBeat &&
                currentBeat < note.startBeat + note.durationBeats;
              const res = results[note.id];

              let colorCls = 'bg-[#D57960] border-[#FAF6F0]/40 text-white';
              if (isCurrent) colorCls = 'bg-[#F59E0B] border-white text-[#2C221E] shadow-md';
              else if (res?.grade === 'perfect' || res?.grade === 'good')
                colorCls = 'bg-[#3D6B58] border-emerald-300 text-white';
              else if (res?.grade === 'wrong' || res?.grade === 'missed')
                colorCls = 'bg-red-700/80 border-red-300 text-white';
              else if (res?.grade === 'sharp' || res?.grade === 'flat')
                colorCls = 'bg-amber-600 border-amber-300 text-white';

              return (
                <div
                  key={note.id}
                  onClick={() => {
                    setCurrentBeat(note.startBeat);
                    playOcarinaNote(note.midi, 0.4);
                  }}
                  style={{
                    left: `${xPct}%`,
                    width: `${widthPct}%`,
                    top: `${yPct}%`,
                  }}
                  className={`absolute -translate-y-1/2 h-8 rounded-lg border px-2 flex items-center justify-between text-xs font-bold cursor-pointer ${colorCls}`}
                >
                  <span className="font-mono-tech truncate">{midiToNoteName(note.midi)}</span>
                  {note.lyric && (
                    <span className="text-[10px] opacity-85 truncate ml-1 hidden sm:inline">
                      {note.lyric}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Session Accuracy Report Card */}
      {showReport && gradedValues.length > 0 && (
        <div className="bg-white rounded-2xl border-2 border-[#3D6B58] p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-[#3D6B58] flex items-center justify-center shrink-0">
              <Award className="w-8 h-8" />
            </div>
            <div>
              <h4 className="text-lg font-bold text-[#2C221E]">
                Practice Session Complete!
              </h4>
              <p className="text-sm text-[#6E5D55]">
                Accuracy: <strong className="text-[#3D6B58]">{accuracyPct}%</strong> ({hitCount}/
                {gradedValues.length} notes in tune • {perfectCount} Perfect ±15¢)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                handleRestart();
                setIsPlaying(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#C2593F] text-white text-xs font-bold cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              Play Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
