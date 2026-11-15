import React, { useEffect, useState } from 'react';
import {
  Award,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Mic,
  MicOff,
  Play,
  Sparkles,
  Volume2,
  Wind,
} from 'lucide-react';
import {
  getFingeringForMidi,
  midiToNoteName,
  OCARINA_KEYS,
  OCARINA_TYPE_META,
} from '../data/ocarinaData';
import { useMicrophonePitch } from '../hooks/useMicrophonePitch';
import { OcarinaKey, OcarinaType } from '../types/ocarina';
import { playOcarinaNote } from '../utils/audioSynth';
import { OcarinaDiagram } from './OcarinaDiagram';

interface LearnTabProps {
  ocarinaType: OcarinaType;
  ocarinaKey: OcarinaKey;
  onStartPracticeSong: (songId: string) => void;
  onGoToScales: () => void;
}

interface Lesson {
  id: string;
  number: string;
  title: string;
  duration: string;
  summary: string;
  steps: string[];
  proTip: string;
  drillOffsets: number[];
  interactiveType: 'breath' | 'notes' | 'quiz' | 'song';
  songId?: string;
}

const LESSONS: Lesson[] = [
  {
    id: 'lesson-breath',
    number: '01',
    title: 'Posture & Breath Control (The #1 Ocarina Secret)',
    duration: '3 min',
    summary:
      'Unlike a piano, an ocarina changes pitch when you blow harder or softer! Too soft sounds flat; too hard sounds sharp.',
    steps: [
      'Hold the ocarina lightly with finger pads (not fingertips) so air cannot leak around holes.',
      'Place the mouthpiece gently between your lips — never bite it.',
      'Take a relaxed belly breath and blow a steady, warm stream of air ("Tu" syllable).',
      'Watch the live breath-pressure gauge below: keep your note in the green ±15¢ Sweet Spot!',
    ],
    proTip:
      'On 12-hole ocarinas, higher notes (C6–F6) require slightly stronger breath pressure than low notes (A4–E5).',
    drillOffsets: [0, 4, 7],
    interactiveType: 'breath',
  },
  {
    id: 'lesson-tabs',
    number: '02',
    title: 'Reading Hole Diagrams & Fingerings',
    duration: '3 min',
    summary:
      'Learn how filled vs. open circles map to your hands, thumbs, and subholes on 12-hole, 6-hole, and 4-hole ocarinas.',
    steps: [
      'Filled dark circles (●) mean COVER the hole completely with the flat pad of your finger.',
      'Light cream circles (○) mean LIFT your finger cleanly off the hole.',
      'On 12-hole & 6-hole models, the bottom pill shows your two BACK THUMB holes.',
      'Small extra holes on 12-hole ocarinas are SUBHOLES used only for the lowest notes (A4, Bb4, B4).',
    ],
    proTip:
      'Never lift your fingers too high off the ocarina! Keep hovering ~1cm above the holes for fast transitions.',
    drillOffsets: [0, 2, 4, 5, 7],
    interactiveType: 'quiz',
  },
  {
    id: 'lesson-first-notes',
    number: '03',
    title: 'Your First 5 Notes (C–D–E–F–G)',
    duration: '5 min',
    summary:
      'Master the 5 foundational notes that unlock dozens of folk songs, hymns, and beginner melodies.',
    steps: [
      'Tap each note below to hear its exact pitch and memorize the finger lift pattern.',
      'Turn on the Microphone Check to play each note on your real ocarina (or hum/whistle!).',
      'Notice how on a 12-hole ocarina you lift one right-hand finger at a time, while 6-hole and 4-hole use cross-fingerings.',
    ],
    proTip:
      'Keep your left pinky or right thumb lightly supporting the instrument when many top holes are open.',
    drillOffsets: [0, 2, 4, 5, 7],
    interactiveType: 'notes',
  },
  {
    id: 'lesson-high-notes',
    number: '04',
    title: 'High Notes, Subholes & The "Acute Bend"',
    duration: '4 min',
    summary:
      'Fix airy high notes (D6, E6, F6) and learn how to slide cleanly onto the small subholes.',
    steps: [
      'When playing the highest 2–3 notes, bring the ocarina closer to your chest ("acute bend" — tuck your chin down slightly).',
      'This angles your airstream cleanly across the labium window, eliminating raspy airiness.',
      'For subholes (below root C), roll your middle/ring finger smoothly instead of jumping.',
    ],
    proTip:
      'If high E6 or F6 sounds breathy, increase air speed slightly AND tilt the ocarina downward toward your chin.',
    drillOffsets: [12, 14, 16, 17],
    interactiveType: 'notes',
  },
  {
    id: 'lesson-articulation',
    number: '05',
    title: 'Tonguing ("Tu") & Playing Your First Song',
    duration: '5 min',
    summary:
      'Separate repeated notes crisply with light tonguing and apply everything in a guided song!',
    steps: [
      'Whisper "Tu - Tu - Tu" gently against the roof of your mouth behind your top teeth — do not stop breathing from your diaphragm.',
      'Use "Slurring" (one continuous breath while moving fingers) for smooth lyrical phrases.',
      'Add subtle vibrato on long held notes by gently pulsing your belly air.',
    ],
    proTip:
      'Start every new song at 0.75x tempo in Wait-for-Note mode until your fingers move automatically.',
    drillOffsets: [0, 7, 9, 7, 5, 4, 2, 0],
    interactiveType: 'song',
    songId: 'twinkle-star',
  },
];

const COMPLETED_KEY = 'claynote_completed_lessons_v1';

export const LearnTab: React.FC<LearnTabProps> = ({
  ocarinaType,
  ocarinaKey,
  onStartPracticeSong,
  onGoToScales,
}) => {
  const [activeId, setActiveId] = useState<string>(LESSONS[0].id);
  const [completed, setCompleted] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(COMPLETED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [selectedDrillIdx, setSelectedDrillIdx] = useState(0);
  const [quizTargetOffset, setQuizTargetOffset] = useState<number>(4);
  const [quizResult, setQuizResult] = useState<'idle' | 'correct' | 'wrong'>('idle');

  const { isListening, isDemoActive, reading, error, startMic, stopMic, triggerDemoNote } =
    useMicrophonePitch();

  const activeLesson = LESSONS.find((l) => l.id === activeId) ?? LESSONS[0];
  const rootMidi = OCARINA_KEYS[ocarinaKey].rootMidi;
  const meta = OCARINA_TYPE_META[ocarinaType];

  const validDrillOffsets = activeLesson.drillOffsets.filter(
    (off) => off >= meta.minOffset && off <= meta.maxOffset
  );
  const effectiveOffsets = validDrillOffsets.length > 0 ? validDrillOffsets : [0, 2, 4];
  const activeOffset = effectiveOffsets[selectedDrillIdx % effectiveOffsets.length];
  const targetMidi = rootMidi + activeOffset;
  const targetFingering = getFingeringForMidi(targetMidi, ocarinaType, ocarinaKey);

  useEffect(() => {
    setSelectedDrillIdx(0);
  }, [activeId, ocarinaType]);

  const toggleCompleted = (id: string) => {
    setCompleted((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(COMPLETED_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const progressPct = Math.round((completed.length / LESSONS.length) * 100);

  // Breath / Note check logic
  const isTargetHit =
    reading.midi !== null &&
    reading.midi === targetMidi &&
    Math.abs(reading.cents) <= 22;

  const breathStatus =
    reading.frequency === null
      ? 'Play or hum a steady note into your microphone'
      : Math.abs(reading.cents) <= 15
      ? 'Sweet Spot! Steady breath pressure'
      : reading.cents > 15
      ? 'Blowing too hard (Sharp) — relax your breath'
      : 'Blowing too soft (Flat) — support with slightly firmer air';

  const quizChoices = [0, 2, 4, 7].filter((o) => o <= meta.maxOffset);
  const quizMidi = rootMidi + quizTargetOffset;
  const quizFingering = getFingeringForMidi(quizMidi, ocarinaType, ocarinaKey);

  return (
    <div className="space-y-5">
      {/* Top Progress Banner */}
      <div className="bg-white rounded-2xl border border-[#E6DDD0] p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-[#FCEEE9] text-[#C2593F] flex items-center justify-center shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-[#2C221E]">
              Ocarina Academy — {meta.shortName} ({OCARINA_KEYS[ocarinaKey].shortName})
            </h2>
            <p className="text-xs sm:text-sm text-[#6E5D55]">
              Interactive lessons adapted automatically to your selected ocarina holes & tuning.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:min-w-[200px]">
          <div className="flex-1">
            <div className="flex justify-between text-xs font-semibold mb-1">
              <span className="text-[#6E5D55]">Course Progress</span>
              <span className="text-[#C2593F]">
                {completed.length}/{LESSONS.length} ({progressPct}%)
              </span>
            </div>
            <div className="h-2.5 bg-[#F3ECE1] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#3D6B58] rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
          <Award
            className={`w-6 h-6 shrink-0 ${
              progressPct === 100 ? 'text-amber-500' : 'text-[#D4C5B3]'
            }`}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Lesson List Sidebar / Horizontal Strip on Mobile */}
        <div className="lg:col-span-4 space-y-2.5">
          {LESSONS.map((lesson) => {
            const isActive = lesson.id === activeLesson.id;
            const isDone = completed.includes(lesson.id);
            return (
              <button
                key={lesson.id}
                onClick={() => setActiveId(lesson.id)}
                className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-start gap-3 ${
                  isActive
                    ? 'bg-[#FCEEE9] border-[#C2593F] shadow-xs'
                    : 'bg-white border-[#E6DDD0] hover:border-[#C2593F]/50'
                }`}
              >
                <span
                  className={`font-mono-tech text-xs font-bold px-2 py-1 rounded-lg shrink-0 ${
                    isDone
                      ? 'bg-[#3D6B58] text-white'
                      : isActive
                      ? 'bg-[#C2593F] text-white'
                      : 'bg-[#F3ECE1] text-[#6E5D55]'
                  }`}
                >
                  {isDone ? '✓' : lesson.number}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-[#2C221E] leading-snug">
                    {lesson.title}
                  </div>
                  <div className="text-xs text-[#6E5D55] mt-0.5 flex items-center gap-2">
                    <span>{lesson.duration}</span>
                    {isDone && <span className="text-[#3D6B58] font-medium">Completed</span>}
                  </div>
                </div>
                <ChevronRight
                  className={`w-4 h-4 shrink-0 mt-1 ${
                    isActive ? 'text-[#C2593F]' : 'text-[#B8A58F]'
                  }`}
                />
              </button>
            );
          })}
        </div>

        {/* Active Lesson Workspace */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-[#E6DDD0] p-4 sm:p-6 shadow-xs space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E6DDD0] pb-4">
            <div>
              <span className="inline-block text-xs font-bold uppercase tracking-wider text-[#C2593F] mb-1">
                Lesson {activeLesson.number} • {activeLesson.duration}
              </span>
              <h3 className="text-xl sm:text-2xl font-bold text-[#2C221E]">{activeLesson.title}</h3>
              <p className="text-sm text-[#6E5D55] mt-1">{activeLesson.summary}</p>
            </div>
            <button
              onClick={() => toggleCompleted(activeLesson.id)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                completed.includes(activeLesson.id)
                  ? 'bg-[#3D6B58] text-white'
                  : 'bg-[#F3ECE1] text-[#2C221E] hover:bg-[#E6DDD0]'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              {completed.includes(activeLesson.id) ? 'Completed' : 'Mark Complete'}
            </button>
          </div>

          {/* Step-by-Step Guide */}
          <ol className="space-y-2.5">
            {activeLesson.steps.map((step, idx) => (
              <li key={idx} className="flex items-start gap-3 text-sm text-[#2C221E]">
                <span className="w-6 h-6 rounded-full bg-[#F3ECE1] text-[#9E412B] font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>

          {/* Pro Tip Box */}
          <div className="bg-[#FAF6F0] border border-[#E6DDD0] rounded-xl p-3.5 flex items-start gap-2.5 text-xs sm:text-sm text-[#6E5D55]">
            <Sparkles className="w-4 h-4 text-[#C2593F] shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-[#2C221E]">Ocarina Tip: </span>
              {activeLesson.proTip}
            </div>
          </div>

          {/* Interactive Lesson Lab */}
          <div className="bg-[#FAF6F0] rounded-2xl border border-[#E6DDD0] p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-sm text-[#2C221E]">
                <Wind className="w-4 h-4 text-[#C2593F]" />
                Interactive Lab
              </div>
              <div className="flex items-center gap-2">
                {!isListening ? (
                  <button
                    onClick={startMic}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#C2593F] text-white text-xs font-semibold hover:bg-[#9E412B] transition cursor-pointer"
                  >
                    <Mic className="w-3.5 h-3.5" />
                    Enable Mic Check
                  </button>
                ) : (
                  <button
                    onClick={stopMic}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2C221E] text-white text-xs font-semibold cursor-pointer"
                  >
                    <MicOff className="w-3.5 h-3.5" />
                    Stop Mic
                  </button>
                )}
                {!isListening && (
                  <button
                    onClick={() =>
                      isDemoActive ? triggerDemoNote(null) : triggerDemoNote(targetMidi, 4)
                    }
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer ${
                      isDemoActive
                        ? 'bg-[#3D6B58] text-white border-[#3D6B58]'
                        : 'bg-white text-[#6E5D55] border-[#E6DDD0] hover:border-[#C2593F]'
                    }`}
                  >
                    {isDemoActive ? 'Demo Active' : 'Simulate Mic'}
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
                {error}
              </div>
            )}

            {activeLesson.interactiveType === 'quiz' ? (
              <div className="flex flex-col sm:flex-row items-center gap-5">
                <div className="bg-white rounded-xl border border-[#E6DDD0] p-3 flex flex-col items-center">
                  {quizFingering.entry && (
                    <OcarinaDiagram
                      type={ocarinaType}
                      holes={quizFingering.entry.holes}
                      size="md"
                      showLabels
                    />
                  )}
                  <span className="text-[11px] text-[#6E5D55] mt-1">
                    Dark = Covered • Cream = Open
                  </span>
                </div>
                <div className="flex-1 space-y-3 w-full">
                  <div className="text-sm font-semibold text-[#2C221E]">
                    Which note does this fingering produce on your {OCARINA_KEYS[ocarinaKey].shortName}?
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {quizChoices.map((off) => {
                      const m = rootMidi + off;
                      return (
                        <button
                          key={off}
                          onClick={() => {
                            playOcarinaNote(m, 0.45);
                            if (off === quizTargetOffset) {
                              setQuizResult('correct');
                            } else {
                              setQuizResult('wrong');
                            }
                          }}
                          className="py-2.5 px-3 rounded-xl bg-white border border-[#E6DDD0] font-bold text-sm hover:border-[#C2593F] hover:bg-[#FCEEE9] transition cursor-pointer"
                        >
                          {midiToNoteName(m)}
                        </button>
                      );
                    })}
                  </div>
                  {quizResult !== 'idle' && (
                    <div
                      className={`text-xs font-semibold px-3 py-2 rounded-lg flex items-center justify-between ${
                        quizResult === 'correct'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      <span>
                        {quizResult === 'correct'
                          ? `Spot on! That is ${midiToNoteName(quizMidi)}.`
                          : 'Not quite — count the closed holes from the bottom up!'}
                      </span>
                      <button
                        onClick={() => {
                          const nextPool = quizChoices.filter((x) => x !== quizTargetOffset);
                          const next =
                            nextPool[Math.floor(Math.random() * nextPool.length)] ?? quizChoices[0];
                          setQuizTargetOffset(next);
                          setQuizResult('idle');
                        }}
                        className="underline ml-2 cursor-pointer"
                      >
                        Next Card
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Note Drill Selector */}
                <div className="flex flex-wrap gap-2">
                  {effectiveOffsets.map((off, i) => {
                    const m = rootMidi + off;
                    const selected = i === selectedDrillIdx % effectiveOffsets.length;
                    return (
                      <button
                        key={`${off}-${i}`}
                        onClick={() => {
                          setSelectedDrillIdx(i);
                          playOcarinaNote(m, 0.55);
                          if (isDemoActive) triggerDemoNote(m, 3);
                        }}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                          selected
                            ? 'bg-[#C2593F] text-white shadow-xs'
                            : 'bg-white border border-[#E6DDD0] text-[#2C221E] hover:border-[#C2593F]'
                        }`}
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        {midiToNoteName(m)}
                      </button>
                    );
                  })}
                </div>

                {/* Diagram + Mic / Breath Meter */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                  <div className="bg-white rounded-xl border border-[#E6DDD0] p-3 flex flex-col items-center">
                    {targetFingering.entry && (
                      <OcarinaDiagram
                        type={ocarinaType}
                        holes={targetFingering.entry.holes}
                        size="md"
                        showLabels
                      />
                    )}
                    <div className="text-center mt-1">
                      <span className="text-sm font-bold text-[#2C221E]">
                        Target: {midiToNoteName(targetMidi)}
                      </span>
                      {targetFingering.entry?.tip && (
                        <p className="text-[11px] text-[#6E5D55] mt-0.5">
                          {targetFingering.entry.tip}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-[#E6DDD0] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#6E5D55]">Detected Pitch</span>
                      <span className="font-mono-tech text-lg font-bold text-[#2C221E]">
                        {reading.noteName}{' '}
                        {reading.frequency ? (
                          <span className="text-xs font-normal text-[#6E5D55]">
                            ({reading.cents >= 0 ? `+${reading.cents}` : reading.cents}¢)
                          </span>
                        ) : null}
                      </span>
                    </div>

                    {/* Breath pressure / cents meter */}
                    <div>
                      <div className="h-3 bg-[#F3ECE1] rounded-full relative overflow-hidden">
                        {/* Sweet spot center band */}
                        <div className="absolute left-[38%] right-[38%] top-0 bottom-0 bg-emerald-200/80" />
                        {reading.frequency && (
                          <div
                            className={`absolute top-0 bottom-0 w-2.5 rounded-full transition-all duration-75 ${
                              Math.abs(reading.cents) <= 15
                                ? 'bg-[#3D6B58]'
                                : 'bg-[#C2593F]'
                            }`}
                            style={{
                              left: `calc(${Math.max(4, Math.min(96, 50 + reading.cents))}% - 5px)`,
                            }}
                          />
                        )}
                      </div>
                      <div className="flex justify-between text-[10px] text-[#6E5D55] mt-1 font-medium">
                        <span>Flat (Soft)</span>
                        <span className="text-[#3D6B58]">Sweet Spot</span>
                        <span>Sharp (Hard)</span>
                      </div>
                    </div>

                    <div
                      className={`text-xs font-semibold p-2.5 rounded-lg ${
                        isTargetHit
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-[#FAF6F0] text-[#6E5D55]'
                      }`}
                    >
                      {isTargetHit
                        ? `Great job! You nailed ${midiToNoteName(targetMidi)} accurately!`
                        : breathStatus}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              onClick={onGoToScales}
              className="text-xs sm:text-sm font-semibold text-[#C2593F] hover:text-[#9E412B] cursor-pointer"
            >
              Explore All Scales & Virtual Ocarina →
            </button>
            {activeLesson.songId && (
              <button
                onClick={() => onStartPracticeSong(activeLesson.songId!)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#3D6B58] text-white text-xs sm:text-sm font-semibold hover:bg-[#2E5445] transition cursor-pointer"
              >
                <Play className="w-4 h-4" />
                Practice "Twinkle Twinkle" in Tutor
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
