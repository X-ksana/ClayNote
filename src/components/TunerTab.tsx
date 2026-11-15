import React, { useEffect, useState } from 'react';
import { Mic, MicOff, Volume2, Wind } from 'lucide-react';
import {
  getFingeringForMidi,
  getPlayableRange,
  midiToNoteName,
  OCARINA_KEYS,
  OCARINA_TYPE_META,
} from '../data/ocarinaData';
import { useMicrophonePitch } from '../hooks/useMicrophonePitch';
import { OcarinaKey, OcarinaType } from '../types/ocarina';
import { playOcarinaNote } from '../utils/audioSynth';
import { OcarinaDiagram } from './OcarinaDiagram';

interface TunerTabProps {
  ocarinaType: OcarinaType;
  ocarinaKey: OcarinaKey;
}

export const TunerTab: React.FC<TunerTabProps> = ({ ocarinaType, ocarinaKey }) => {
  const { isListening, isDemoActive, reading, error, startMic, stopMic, triggerDemoNote } =
    useMicrophonePitch();

  const [centsTrace, setCentsTrace] = useState<Array<number | null>>([]);
  const { minMidi, maxMidi } = getPlayableRange(ocarinaType, ocarinaKey);
  const rootMidi = OCARINA_KEYS[ocarinaKey].rootMidi;

  useEffect(() => {
    if (!isListening && !isDemoActive) return;
    setCentsTrace((prev) => {
      const next = [...prev, reading.frequency ? reading.cents : null];
      if (next.length > 60) next.shift();
      return next;
    });
  }, [reading.frequency, reading.cents, isListening, isDemoActive]);

  const inTune = reading.frequency !== null && Math.abs(reading.cents) <= 12;
  const activeMidi = reading.midi ?? rootMidi;
  const fing = getFingeringForMidi(activeMidi, ocarinaType, ocarinaKey);

  // Build SVG path for breath stability trace
  const tracePath = centsTrace
    .map((val, idx) => {
      if (val === null) return null;
      const x = (idx / 59) * 300;
      const y = 40 - Math.max(-45, Math.min(45, val)) * 0.75;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-[#E6DDD0] p-4 sm:p-6 shadow-xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-[#2C221E] flex items-center gap-2">
              <Wind className="w-5 h-5 text-[#C2593F]" />
              Chromatic Ocarina Tuner & Breath Coach
            </h2>
            <p className="text-xs sm:text-sm text-[#6E5D55]">
              Calibrated for {OCARINA_TYPE_META[ocarinaType].shortName}{' '}
              {OCARINA_KEYS[ocarinaKey].name}. Keep your breath inside ±12¢ for pure tone.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isListening ? (
              <button
                onClick={startMic}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#C2593F] text-white text-xs sm:text-sm font-bold hover:bg-[#9E412B] transition cursor-pointer"
              >
                <Mic className="w-4 h-4" />
                Start Tuner Mic
              </button>
            ) : (
              <button
                onClick={stopMic}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#2C221E] text-white text-xs sm:text-sm font-bold cursor-pointer"
              >
                <MicOff className="w-4 h-4" />
                Stop Mic
              </button>
            )}
            {!isListening && (
              <button
                onClick={() =>
                  isDemoActive ? triggerDemoNote(null) : triggerDemoNote(rootMidi, -6)
                }
                className={`px-3 py-2.5 rounded-xl text-xs font-semibold border cursor-pointer ${
                  isDemoActive
                    ? 'bg-[#3D6B58] text-white border-[#3D6B58]'
                    : 'bg-[#FAF6F0] text-[#6E5D55] border-[#E6DDD0]'
                }`}
              >
                {isDemoActive ? 'Demo ON' : 'Demo Pitch'}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          {/* Big Tuner Dial */}
          <div className="lg:col-span-7 bg-[#FAF6F0] rounded-2xl border border-[#E6DDD0] p-5 flex flex-col items-center space-y-4">
            <div className="text-center">
              <div
                className={`text-6xl sm:text-7xl font-bold font-mono-tech transition-colors ${
                  inTune
                    ? 'text-[#3D6B58]'
                    : reading.frequency
                    ? 'text-[#C2593F]'
                    : 'text-[#B8A58F]'
                }`}
              >
                {reading.noteName}
              </div>
              <div className="text-xs sm:text-sm font-mono-tech text-[#6E5D55] mt-1">
                {reading.frequency
                  ? `${reading.frequency.toFixed(1)} Hz • ${
                      reading.cents >= 0 ? `+${reading.cents}` : reading.cents
                    } cents`
                  : 'Waiting for sound...'}
              </div>
            </div>

            {/* Linear Precision Gauge (-50 to +50 cents) */}
            <div className="w-full max-w-md space-y-1.5">
              <div className="h-5 bg-white border border-[#E6DDD0] rounded-full relative overflow-hidden">
                <div className="absolute left-[38%] right-[38%] top-0 bottom-0 bg-emerald-100" />
                <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-[#3D6B58]/40" />
                {reading.frequency && (
                  <div
                    className={`absolute top-0.5 bottom-0.5 w-3.5 rounded-full transition-all duration-75 ${
                      inTune ? 'bg-[#3D6B58]' : 'bg-[#C2593F]'
                    }`}
                    style={{
                      left: `calc(${Math.max(3, Math.min(97, 50 + reading.cents))}% - 7px)`,
                    }}
                  />
                )}
              </div>
              <div className="flex justify-between text-[11px] font-mono-tech text-[#6E5D55]">
                <span>-50¢ Flat</span>
                <span className="text-[#3D6B58] font-bold">0¢ Pure</span>
                <span>+50¢ Sharp</span>
              </div>
            </div>

            {/* Breath Coaching Banner */}
            <div
              className={`w-full max-w-md text-center py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold ${
                !reading.frequency
                  ? 'bg-white text-[#6E5D55] border border-[#E6DDD0]'
                  : inTune
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : reading.cents > 0
                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                  : 'bg-sky-50 text-sky-800 border border-sky-200'
              }`}
            >
              {!reading.frequency
                ? 'Play a long, steady note on your ocarina'
                : inTune
                ? 'Sweet Spot! Keep your breath pressure steady.'
                : reading.cents > 0
                ? 'Too Sharp — Relax your breath slightly'
                : 'Too Flat — Support with slightly firmer air'}
            </div>

            {/* Rolling Breath Stability Trace */}
            <div className="w-full max-w-md bg-white rounded-xl border border-[#E6DDD0] p-3">
              <div className="flex justify-between text-[11px] text-[#6E5D55] font-semibold mb-1">
                <span>Breath Stability Trace</span>
                <span>Flatline = Steady Air</span>
              </div>
              <svg viewBox="0 0 300 80" className="w-full h-16">
                <rect x="0" y="31" width="300" height="18" fill="#ECFDF5" />
                <line x1="0" y1="40" x2="300" y2="40" stroke="#A7F3D0" strokeDasharray="4 4" />
                {tracePath && (
                  <polyline
                    fill="none"
                    stroke="#C2593F"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={tracePath}
                  />
                )}
              </svg>
            </div>
          </div>

          {/* Detected Note Fingering + Reference Tone Buttons */}
          <div className="lg:col-span-5 bg-[#FAF6F0] rounded-2xl border border-[#E6DDD0] p-5 flex flex-col items-center space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-[#6E5D55]">
              Fingering for {midiToNoteName(activeMidi)}
            </div>
            {fing.entry && (
              <OcarinaDiagram
                type={ocarinaType}
                holes={fing.entry.holes}
                size="md"
                showLabels
                highlightMismatch={!fing.inRange}
              />
            )}
            <p className="text-xs text-[#6E5D55] text-center">
              {fing.inRange
                ? fing.entry?.tip
                : `${midiToNoteName(activeMidi)} is outside ${OCARINA_KEYS[ocarinaKey].shortName} range (${midiToNoteName(minMidi)}–${midiToNoteName(maxMidi)}).`}
            </p>

            <div className="w-full pt-2 border-t border-[#E6DDD0]">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#6E5D55] mb-2 text-center">
                Reference Tones (Tap to Hear)
              </div>
              <div className="flex flex-wrap justify-center gap-1.5">
                {[0, 2, 4, 5, 7, 9, 11, 12]
                  .map((off) => rootMidi + off)
                  .filter((m) => m >= minMidi && m <= maxMidi)
                  .map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        playOcarinaNote(m, 0.7);
                        if (isDemoActive) {
                          triggerDemoNote(m, Math.round((Math.random() - 0.5) * 18));
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-[#E6DDD0] text-xs font-bold text-[#2C221E] hover:border-[#C2593F] cursor-pointer"
                    >
                      <Volume2 className="w-3 h-3 text-[#C2593F]" />
                      {midiToNoteName(m)}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
