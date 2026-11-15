import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Music2, Play, Square, Target, Volume2, Wind } from 'lucide-react';
import {
  findMidiFromHoles,
  getFingeringForMidi,
  getFingeringsForType,
  getHolesForType,
  getPlayableRange,
  midiToNoteName,
  midiToPitchClass,
  MUSICAL_SCALES,
  OCARINA_KEYS,
  OCARINA_TYPE_META,
} from '../data/ocarinaData';
import { HoleMap, OcarinaKey, OcarinaType, Song } from '../types/ocarina';
import {
  playOcarinaNote,
  startSustainedOcarinaNote,
  SustainedHandle,
} from '../utils/audioSynth';
import { OcarinaDiagram } from './OcarinaDiagram';

interface ScalesTabProps {
  ocarinaType: OcarinaType;
  ocarinaKey: OcarinaKey;
  onChangeType: (t: OcarinaType) => void;
  onChangeKey: (k: OcarinaKey) => void;
  onPracticeScaleSong: (song: Song) => void;
}

const KEYBOARD_KEYS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Z', 'X', 'C'];

export const ScalesTab: React.FC<ScalesTabProps> = ({
  ocarinaType,
  ocarinaKey,
  onChangeType,
  onChangeKey,
  onPracticeScaleSong,
}) => {
  const [selectedScaleId, setSelectedScaleId] = useState<string>('major');
  const [scaleRootOffset, setScaleRootOffset] = useState<number>(0);
  const [selectedMidi, setSelectedMidi] = useState<number>(OCARINA_KEYS[ocarinaKey].rootMidi);
  const [isPlayingScale, setIsPlayingScale] = useState<boolean>(false);
  const [virtualMode, setVirtualMode] = useState<'pads' | 'holes'>('pads');
  const [customHoles, setCustomHoles] = useState<HoleMap>(() => {
    const def = getFingeringsForType(ocarinaType).find((f) => f.offset === 0);
    return def ? { ...def.holes } : {};
  });

  const sustainedRef = useRef<SustainedHandle | null>(null);
  const scaleTimerRef = useRef<number[]>([]);

  const keyInfo = OCARINA_KEYS[ocarinaKey];
  const typeMeta = OCARINA_TYPE_META[ocarinaType];
  const { minMidi, maxMidi } = getPlayableRange(ocarinaType, ocarinaKey);
  const fingerings = getFingeringsForType(ocarinaType);

  useEffect(() => {
    setSelectedMidi(keyInfo.rootMidi);
    const def = fingerings.find((f) => f.offset === 0) ?? fingerings[0];
    if (def) setCustomHoles({ ...def.holes });
  }, [ocarinaType, ocarinaKey]);

  const stopAllAudio = () => {
    scaleTimerRef.current.forEach((id) => window.clearTimeout(id));
    scaleTimerRef.current = [];
    setIsPlayingScale(false);
    if (sustainedRef.current) {
      sustainedRef.current.stop();
      sustainedRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopAllAudio();
  }, []);

  const activeScale = MUSICAL_SCALES.find((s) => s.id === selectedScaleId) ?? MUSICAL_SCALES[0];

  // Build notes in the selected scale that fit within this ocarina's range
  const scaleRootMidi = keyInfo.rootMidi + scaleRootOffset;
  const scaleNotes: number[] = [];
  for (const iv of activeScale.intervals) {
    const m = scaleRootMidi + iv;
    if (m >= minMidi && m <= maxMidi) {
      scaleNotes.push(m);
    }
  }

  // Diatonic + chromatic playable notes for Virtual Ocarina pads
  const allPlayableMidis = fingerings.map((f) => keyInfo.rootMidi + f.offset);
  // Filter unique offsets (some 6-hole/4-hole high overblows share offsets, keep unique MIDI)
  const uniquePlayableMidis = Array.from(new Set(allPlayableMidis));
  const diatonicKeyboardMidis = uniquePlayableMidis.filter((m) => {
    const pc = (m - keyInfo.rootMidi + 120) % 12;
    return [0, 2, 4, 5, 7, 9, 11].includes(pc);
  });

  const handlePlayScale = () => {
    if (isPlayingScale) {
      stopAllAudio();
      return;
    }
    if (scaleNotes.length === 0) return;
    setIsPlayingScale(true);
    const seq = [...scaleNotes, ...[...scaleNotes].reverse().slice(1)];
    seq.forEach((m, idx) => {
      const id = window.setTimeout(() => {
        setSelectedMidi(m);
        playOcarinaNote(m, 0.36);
        if (idx === seq.length - 1) {
          window.setTimeout(() => setIsPlayingScale(false), 380);
        }
      }, idx * 380);
      scaleTimerRef.current.push(id);
    });
  };

  const handlePracticeScale = () => {
    const seq = [...scaleNotes, ...[...scaleNotes].reverse().slice(1)];
    const song: Song = {
      id: `scale-${activeScale.id}-${ocarinaKey}-${Date.now()}`,
      title: `${midiToPitchClass(scaleRootMidi)} ${activeScale.name} Scale`,
      composer: `${typeMeta.shortName} ${keyInfo.shortName} Drill`,
      difficulty: 'Beginner',
      bpm: 88,
      recommendedType: ocarinaType,
      recommendedKey: ocarinaKey,
      source: 'scale',
      notes: seq.map((midi, i) => ({
        id: `sc-${i}`,
        midi,
        startBeat: i,
        durationBeats: 1,
      })),
    };
    onPracticeScaleSong(song);
  };

  // Keyboard support for Virtual Ocarina
  useEffect(() => {
    const downKeys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toUpperCase();
      const idx = KEYBOARD_KEYS.indexOf(k);
      if (idx === -1 || downKeys.has(k)) return;
      const midi = diatonicKeyboardMidis[idx];
      if (midi === undefined) return;
      downKeys.add(k);
      setSelectedMidi(midi);
      const fing = getFingeringForMidi(midi, ocarinaType, ocarinaKey);
      if (fing.entry) setCustomHoles({ ...fing.entry.holes });
      if (sustainedRef.current) {
        sustainedRef.current.setMidi(midi);
      } else {
        sustainedRef.current = startSustainedOcarinaNote(midi);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toUpperCase();
      if (!downKeys.has(k)) return;
      downKeys.delete(k);
      if (downKeys.size === 0 && sustainedRef.current) {
        sustainedRef.current.stop();
        sustainedRef.current = null;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [diatonicKeyboardMidis, ocarinaType, ocarinaKey]);

  const activeFingering = getFingeringForMidi(selectedMidi, ocarinaType, ocarinaKey);
  const holeModeMidi = findMidiFromHoles(customHoles, ocarinaType, ocarinaKey);

  const toggleCustomHole = (holeId: string) => {
    setCustomHoles((prev) => {
      const next = { ...prev, [holeId]: !prev[holeId] };
      const nextMidi = findMidiFromHoles(next, ocarinaType, ocarinaKey);
      setSelectedMidi(nextMidi);
      if (sustainedRef.current) {
        sustainedRef.current.setMidi(nextMidi);
      }
      return next;
    });
  };

  const holeCountClosed = (holes: HoleMap) =>
    getHolesForType(ocarinaType).filter((h) => holes[h.id]).length;

  return (
    <div className="space-y-5">
      {/* Ocarina Type & Key Switcher Card */}
      <div className="bg-white rounded-2xl border border-[#E6DDD0] p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-[#2C221E]">
              Ocarina Scales, Tunings & Virtual Instrument
            </h2>
            <p className="text-xs sm:text-sm text-[#6E5D55]">
              Switch between 12-hole, 6-hole, or 4-hole ocarinas and keys (AC, SC, BC, AG, AF).
            </p>
          </div>
          <span className="font-mono-tech text-xs font-semibold px-3 py-1.5 rounded-full bg-[#FAF6F0] border border-[#E6DDD0] text-[#6E5D55]">
            Range: {midiToNoteName(minMidi)} – {midiToNoteName(maxMidi)}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Ocarina Hole Model */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-[#6E5D55]">
              1. Ocarina Model
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['12-hole', '6-hole', '4-hole'] as OcarinaType[]).map((t) => {
                const m = OCARINA_TYPE_META[t];
                const active = ocarinaType === t;
                return (
                  <button
                    key={t}
                    onClick={() => onChangeType(t)}
                    className={`p-2.5 rounded-xl border text-left transition cursor-pointer ${
                      active
                        ? 'bg-[#FCEEE9] border-[#C2593F] text-[#9E412B]'
                        : 'bg-[#FAF6F0] border-[#E6DDD0] text-[#2C221E] hover:border-[#C2593F]/50'
                    }`}
                  >
                    <div className="font-bold text-xs sm:text-sm">{m.shortName}</div>
                    <div className="text-[11px] text-[#6E5D55] leading-tight mt-0.5">
                      {t === '12-hole' ? 'Sweet Potato' : t === '6-hole' ? 'Pendant' : 'Beginner'}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-[#6E5D55]">{typeMeta.description}</p>
          </div>

          {/* Ocarina Key */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-[#6E5D55]">
              2. Ocarina Key / Pitch Scale
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {(Object.keys(OCARINA_KEYS) as OcarinaKey[]).map((k) => {
                const info = OCARINA_KEYS[k];
                const active = ocarinaKey === k;
                return (
                  <button
                    key={k}
                    onClick={() => onChangeKey(k)}
                    className={`py-2 px-1 rounded-xl border text-center transition cursor-pointer ${
                      active
                        ? 'bg-[#C2593F] border-[#C2593F] text-white shadow-xs'
                        : 'bg-[#FAF6F0] border-[#E6DDD0] text-[#2C221E] hover:border-[#C2593F]/50'
                    }`}
                  >
                    <div className="font-bold text-xs sm:text-sm">{k}</div>
                    <div
                      className={`text-[10px] truncate ${
                        active ? 'text-white/90' : 'text-[#6E5D55]'
                      }`}
                    >
                      {info.shortName.split(' ')[0]}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-[#6E5D55]">{keyInfo.description}</p>
          </div>
        </div>
      </div>

      {/* Musical Scale Explorer */}
      <div className="bg-white rounded-2xl border border-[#E6DDD0] p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Music2 className="w-5 h-5 text-[#C2593F]" />
            <h3 className="text-base sm:text-lg font-bold text-[#2C221E]">Musical Scale Explorer</h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handlePlayScale}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                isPlayingScale
                  ? 'bg-[#2C221E] text-white'
                  : 'bg-[#C2593F] text-white hover:bg-[#9E412B]'
              }`}
            >
              {isPlayingScale ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlayingScale ? 'Stop Scale' : 'Play Scale'}
            </button>
            <button
              onClick={handlePracticeScale}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#3D6B58] text-white hover:bg-[#2E5445] transition cursor-pointer"
            >
              <Target className="w-3.5 h-3.5" />
              Practice in Voice Tutor
            </button>
          </div>
        </div>

        {/* Scale Type & Root Pills */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 flex flex-wrap gap-1.5">
            {MUSICAL_SCALES.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedScaleId(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  selectedScaleId === s.id
                    ? 'bg-[#2C221E] text-white'
                    : 'bg-[#F3ECE1] text-[#2C221E] hover:bg-[#E6DDD0]'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-semibold text-[#6E5D55]">Start Note:</span>
            <select
              value={scaleRootOffset}
              onChange={(e) => setScaleRootOffset(Number(e.target.value))}
              className="bg-[#FAF6F0] border border-[#E6DDD0] rounded-lg px-2.5 py-1.5 text-xs font-bold text-[#2C221E]"
            >
              {[0, 2, 4, 5, 7, 9].map((off) => (
                <option key={off} value={off}>
                  {midiToNoteName(keyInfo.rootMidi + off)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="text-xs text-[#6E5D55]">{activeScale.description}</p>

        {/* Scale Note Cards with Mini Diagrams */}
        <div className="flex gap-2.5 overflow-x-auto pb-2">
          {scaleNotes.map((m, idx) => {
            const fing = getFingeringForMidi(m, ocarinaType, ocarinaKey);
            const active = selectedMidi === m;
            return (
              <button
                key={`${m}-${idx}`}
                onClick={() => {
                  setSelectedMidi(m);
                  if (fing.entry) setCustomHoles({ ...fing.entry.holes });
                  playOcarinaNote(m, 0.5);
                }}
                className={`shrink-0 rounded-xl border p-2.5 flex flex-col items-center transition cursor-pointer min-w-[84px] ${
                  active
                    ? 'bg-[#FCEEE9] border-[#C2593F] shadow-xs'
                    : 'bg-[#FAF6F0] border-[#E6DDD0] hover:border-[#C2593F]/60'
                }`}
              >
                <span className="text-xs font-bold text-[#2C221E]">{midiToNoteName(m)}</span>
                {fing.entry && (
                  <OcarinaDiagram
                    type={ocarinaType}
                    holes={fing.entry.holes}
                    size="xs"
                    className="my-1"
                  />
                )}
                <span className="text-[10px] text-[#6E5D55]">
                  {fing.entry ? `${holeCountClosed(fing.entry.holes)} closed` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Interactive Virtual Ocarina */}
      <div className="bg-white rounded-2xl border border-[#E6DDD0] p-4 sm:p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-[#2C221E]">
              Playable Virtual Ocarina
            </h3>
            <p className="text-xs text-[#6E5D55]">
              Tap note pads on your phone, use your keyboard, or tap holes directly to build fingerings.
            </p>
          </div>
          <div className="inline-flex rounded-xl bg-[#F3ECE1] p-1">
            <button
              onClick={() => setVirtualMode('pads')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                virtualMode === 'pads' ? 'bg-white text-[#2C221E] shadow-xs' : 'text-[#6E5D55]'
              }`}
            >
              Touch Note Pads
            </button>
            <button
              onClick={() => setVirtualMode('holes')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                virtualMode === 'holes' ? 'bg-white text-[#2C221E] shadow-xs' : 'text-[#6E5D55]'
              }`}
            >
              Tap Holes Directly
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          {/* Diagram Showcase */}
          <div className="lg:col-span-5 bg-[#FAF6F0] rounded-2xl border border-[#E6DDD0] p-4 flex flex-col items-center">
            <OcarinaDiagram
              type={ocarinaType}
              holes={
                virtualMode === 'holes'
                  ? customHoles
                  : activeFingering.entry?.holes ?? customHoles
              }
              size="lg"
              interactive={virtualMode === 'holes'}
              onToggleHole={toggleCustomHole}
              showLabels
            />

            <div className="mt-2 text-center space-y-1">
              <div className="text-2xl font-bold text-[#2C221E] font-mono-tech">
                {midiToNoteName(virtualMode === 'holes' ? holeModeMidi : selectedMidi)}
              </div>
              {virtualMode === 'holes' ? (
                <button
                  onPointerDown={() => {
                    if (sustainedRef.current) sustainedRef.current.stop();
                    sustainedRef.current = startSustainedOcarinaNote(holeModeMidi);
                  }}
                  onPointerUp={() => {
                    sustainedRef.current?.stop();
                    sustainedRef.current = null;
                  }}
                  onPointerLeave={() => {
                    sustainedRef.current?.stop();
                    sustainedRef.current = null;
                  }}
                  className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#C2593F] text-white font-semibold text-sm active:scale-95 transition select-none cursor-pointer"
                >
                  <Wind className="w-4 h-4" />
                  Hold to Blow Note
                </button>
              ) : (
                activeFingering.entry?.tip && (
                  <p className="text-xs text-[#6E5D55] max-w-xs">{activeFingering.entry.tip}</p>
                )
              )}
            </div>
          </div>

          {/* Touch Pads / Keyboard Reference */}
          <div className="lg:col-span-7 space-y-3">
            <div className="flex items-center justify-between text-xs text-[#6E5D55]">
              <span className="font-semibold flex items-center gap-1.5">
                <Volume2 className="w-4 h-4 text-[#C2593F]" />
                Hold any pad to sustain tone (release to stop)
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px]">
                <Keyboard className="w-3.5 h-3.5" /> Keyboard keys A–X supported
              </span>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {uniquePlayableMidis.map((midi) => {
                const name = midiToNoteName(midi);
                const isAccidental = name.includes('#');
                const diatonicIdx = diatonicKeyboardMidis.indexOf(midi);
                const shortcut = diatonicIdx !== -1 ? KEYBOARD_KEYS[diatonicIdx] : null;
                const isSelected = selectedMidi === midi;

                return (
                  <button
                    key={midi}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setSelectedMidi(midi);
                      const f = getFingeringForMidi(midi, ocarinaType, ocarinaKey);
                      if (f.entry) setCustomHoles({ ...f.entry.holes });
                      if (sustainedRef.current) sustainedRef.current.stop();
                      sustainedRef.current = startSustainedOcarinaNote(midi);
                    }}
                    onPointerUp={() => {
                      sustainedRef.current?.stop();
                      sustainedRef.current = null;
                    }}
                    onPointerLeave={() => {
                      sustainedRef.current?.stop();
                      sustainedRef.current = null;
                    }}
                    onPointerCancel={() => {
                      sustainedRef.current?.stop();
                      sustainedRef.current = null;
                    }}
                    className={`relative py-3 px-2 rounded-xl border font-bold text-sm transition select-none active:scale-95 cursor-pointer ${
                      isSelected
                        ? 'bg-[#C2593F] text-white border-[#9E412B] shadow-sm'
                        : isAccidental
                        ? 'bg-[#EFE6DA] text-[#2C221E] border-[#D9CBB8] hover:border-[#C2593F]'
                        : 'bg-[#FAF6F0] text-[#2C221E] border-[#E6DDD0] hover:border-[#C2593F]'
                    }`}
                  >
                    <div className="font-mono-tech">{name}</div>
                    {shortcut && (
                      <span
                        className={`hidden sm:inline-block text-[10px] font-mono-tech mt-0.5 px-1.5 rounded ${
                          isSelected ? 'bg-white/20 text-white' : 'bg-white text-[#6E5D55]'
                        }`}
                      >
                        {shortcut}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
