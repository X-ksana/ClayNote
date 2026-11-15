import {
  FingeringEntry,
  HoleDefinition,
  HoleMap,
  OcarinaKey,
  OcarinaKeyInfo,
  OcarinaType,
} from '../types/ocarina';

export const OCARINA_KEYS: Record<OcarinaKey, OcarinaKeyInfo> = {
  AC: {
    id: 'AC',
    name: 'Alto C (Standard)',
    shortName: 'Alto C',
    rootMidi: 72, // C5
    description: 'Most popular ocarina key. Warm mid-range voice (A4–F6 on 12-hole).',
  },
  SC: {
    id: 'SC',
    name: 'Soprano C (High)',
    shortName: 'Soprano C',
    rootMidi: 84, // C6
    description: 'Bright, bird-like voice one octave higher than Alto C (A5–F7).',
  },
  BC: {
    id: 'BC',
    name: 'Bass C (Deep)',
    shortName: 'Bass C',
    rootMidi: 60, // C4
    description: 'Rich, mellow low register one octave below Alto C (A3–F5).',
  },
  AG: {
    id: 'AG',
    name: 'Alto G',
    shortName: 'Alto G',
    rootMidi: 67, // G4
    description: 'Earthy, resonant tone pitched a fourth below Alto C (E4–C6).',
  },
  AF: {
    id: 'AF',
    name: 'Alto F',
    shortName: 'Alto F',
    rootMidi: 65, // F4
    description: 'Deep, soulful tone great for folk ballads (D4–Bb5).',
  },
};

export const OCARINA_TYPE_META: Record<
  OcarinaType,
  {
    id: OcarinaType;
    name: string;
    shortName: string;
    holeCount: number;
    minOffset: number;
    maxOffset: number;
    description: string;
  }
> = {
  '12-hole': {
    id: '12-hole',
    name: '12-Hole Transverse',
    shortName: '12-Hole',
    holeCount: 12,
    minOffset: -3, // A below root
    maxOffset: 17, // F an octave + 4th above root
    description: 'Full 1.5+ octave chromatic range (21 notes). Ideal for pop, anime, Zelda & classical.',
  },
  '6-hole': {
    id: '6-hole',
    name: '6-Hole Pendant',
    shortName: '6-Hole',
    holeCount: 6,
    minOffset: 0,
    maxOffset: 16,
    description: 'Compact necklace-style English pendant using cross-fingerings (17 chromatic notes).',
  },
  '4-hole': {
    id: '4-hole',
    name: '4-Hole Beginner',
    shortName: '4-Hole',
    holeCount: 4,
    minOffset: 0,
    maxOffset: 12,
    description: 'Simple 1-octave pendant ocarina. Fast to learn for kids & first-time players.',
  },
};

export const HOLES_12: HoleDefinition[] = [
  // Left hand top 4 + subhole
  { id: 'L1', label: 'L Index', hand: 'L', x: 26, y: 40, r: 4.3 },
  { id: 'L2', label: 'L Middle', hand: 'L', x: 35, y: 34, r: 4.5 },
  { id: 'L3', label: 'L Ring', hand: 'L', x: 44, y: 31, r: 4.2 },
  { id: 'L4', label: 'L Pinky', hand: 'L', x: 52, y: 36, r: 3.4 },
  { id: 'LS', label: 'L Subhole', hand: 'L', isSubhole: true, x: 40, y: 43, r: 2.3 },
  // Right hand top 4 + subhole
  { id: 'R1', label: 'R Index', hand: 'R', x: 60, y: 32, r: 4.3 },
  { id: 'R2', label: 'R Middle', hand: 'R', x: 69, y: 30, r: 4.4 },
  { id: 'R3', label: 'R Ring', hand: 'R', x: 78, y: 34, r: 4.0 },
  { id: 'R4', label: 'R Pinky', hand: 'R', x: 86, y: 42, r: 3.3 },
  { id: 'RS', label: 'R Subhole', hand: 'R', isSubhole: true, x: 73, y: 42, r: 2.3 },
  // Back thumb holes (shown clearly below the body)
  { id: 'LT', label: 'L Thumb (Back)', hand: 'L', isThumb: true, x: 36, y: 80, r: 4.5 },
  { id: 'RT', label: 'R Thumb (Back)', hand: 'R', isThumb: true, x: 66, y: 80, r: 4.5 },
];

export const HOLES_6: HoleDefinition[] = [
  { id: 'L1', label: 'Top Left', hand: 'L', x: 37, y: 35, r: 5.8 },
  { id: 'L2', label: 'Bottom Left', hand: 'L', x: 38, y: 55, r: 5.2 },
  { id: 'R1', label: 'Top Right', hand: 'R', x: 63, y: 35, r: 5.0 },
  { id: 'R2', label: 'Bottom Right', hand: 'R', x: 62, y: 55, r: 4.3 },
  { id: 'LT', label: 'L Thumb (Back)', hand: 'L', isThumb: true, x: 37, y: 82, r: 4.8 },
  { id: 'RT', label: 'R Thumb (Back)', hand: 'R', isThumb: true, x: 63, y: 82, r: 4.8 },
];

export const HOLES_4: HoleDefinition[] = [
  { id: 'L1', label: 'Top Left', hand: 'L', x: 37, y: 36, r: 6.4 },
  { id: 'L2', label: 'Bottom Left', hand: 'L', x: 38, y: 58, r: 5.6 },
  { id: 'R1', label: 'Top Right', hand: 'R', x: 63, y: 36, r: 5.2 },
  { id: 'R2', label: 'Bottom Right', hand: 'R', x: 62, y: 58, r: 4.5 },
];

export function getHolesForType(type: OcarinaType): HoleDefinition[] {
  if (type === '12-hole') return HOLES_12;
  if (type === '6-hole') return HOLES_6;
  return HOLES_4;
}

const mk12 = (closed: string[]): HoleMap => {
  const map: HoleMap = {};
  for (const h of HOLES_12) map[h.id] = closed.includes(h.id);
  return map;
};

const mk6 = (closed: string[]): HoleMap => {
  const map: HoleMap = {};
  for (const h of HOLES_6) map[h.id] = closed.includes(h.id);
  return map;
};

const mk4 = (closed: string[]): HoleMap => {
  const map: HoleMap = {};
  for (const h of HOLES_4) map[h.id] = closed.includes(h.id);
  return map;
};

/**
 * Standard Taiwanese/Italian 12-Hole Ocarina Fingerings (offsets -3 to +17 relative to tonic C)
 */
export const FINGERINGS_12: FingeringEntry[] = [
  { offset: -3, holes: mk12(['L1','L2','L3','L4','LS','R1','R2','R3','R4','RS','LT','RT']), tip: 'Cover all 12 holes gently; blow softly.' },
  { offset: -2, holes: mk12(['L1','L2','L3','L4','R1','R2','R3','R4','RS','LT','RT']), tip: 'Slide left finger slightly to uncover L subhole.' },
  { offset: -1, holes: mk12(['L1','L2','L3','L4','LS','R1','R2','R3','R4','LT','RT']), tip: 'Uncover R subhole (keep L subhole covered).' },
  { offset: 0, holes: mk12(['L1','L2','L3','L4','R1','R2','R3','R4','LT','RT']), tip: 'Root note: all 10 main holes closed, both subholes open.' },
  { offset: 1, holes: mk12(['L1','L2','L3','L4','R1','R2','R3','RS','LT','RT']), tip: 'Lift R pinky while covering R subhole (or half-hole R4).' },
  { offset: 2, holes: mk12(['L1','L2','L3','L4','R1','R2','R3','LT','RT']), tip: 'Lift R pinky cleanly.' },
  { offset: 3, holes: mk12(['L1','L2','L3','L4','R1','R2','RS','LT','RT']), tip: 'Lift R pinky & R ring; cover R subhole (or keep R4 closed).' },
  { offset: 4, holes: mk12(['L1','L2','L3','L4','R1','R2','LT','RT']), tip: 'Lift R pinky & R ring.' },
  { offset: 5, holes: mk12(['L1','L2','L3','L4','R1','LT','RT']), tip: 'Lift R pinky, R ring & R middle.' },
  { offset: 6, holes: mk12(['L1','L2','L3','L4','R2','LT','RT']), tip: 'Cross-fingering: lift R index while keeping R middle down.' },
  { offset: 7, holes: mk12(['L1','L2','L3','L4','LT','RT']), tip: 'All 4 right fingers open; thumbs & left hand closed.' },
  { offset: 8, holes: mk12(['L1','L2','L3','R2','LT','RT']), tip: 'Lift L pinky with R middle down for clean G#/Ab.' },
  { offset: 9, holes: mk12(['L1','L2','L3','LT','RT']), tip: 'All right fingers + L pinky open.' },
  { offset: 10, holes: mk12(['L1','L2','R2','LT','RT']), tip: 'Cross-fingering: L1, L2, R2 + both thumbs.' },
  { offset: 11, holes: mk12(['L1','L2','LT','RT']), tip: 'L1, L2 + both thumbs closed.' },
  { offset: 12, holes: mk12(['L1','LT','RT']), tip: 'Octave note: L index + both thumbs closed.' },
  { offset: 13, holes: mk12(['L2','LT','RT']), tip: 'Switch L index to L middle + both thumbs.' },
  { offset: 14, holes: mk12(['LT','RT']), tip: 'Both thumbs closed only! Blow slightly firmer.' },
  { offset: 15, holes: mk12(['R1','RT']), tip: 'R thumb + R index closed (or half L thumb).' },
  { offset: 16, holes: mk12(['RT']), tip: 'Only Right Thumb closed. Use acute bend if airy.' },
  { offset: 17, holes: mk12([]), tip: 'All holes open! Tuck chin slightly (acute bend) for crisp tone.' },
];

/**
 * Standard 6-Hole English Pendant Fingerings (offsets 0 to +16)
 */
export const FINGERINGS_6: FingeringEntry[] = [
  { offset: 0, holes: mk6(['L1','L2','R1','R2','LT','RT']), tip: 'All 6 holes closed; steady gentle breath.' },
  { offset: 1, holes: mk6(['L1','L2','R1','LT','RT']), tip: 'Slightly peek R2 (half-hole) for C#/Db.' },
  { offset: 2, holes: mk6(['L1','L2','R1','LT','RT']), tip: 'Open Bottom-Right (R2).' },
  { offset: 3, holes: mk6(['L1','L2','R2','LT','RT']), tip: 'Open Top-Right (R1), keep R2 closed.' },
  { offset: 4, holes: mk6(['L1','L2','LT','RT']), tip: 'Both Right top holes open.' },
  { offset: 5, holes: mk6(['L1','R1','R2','LT','RT']), tip: 'Open Bottom-Left (L2), close R1 & R2.' },
  { offset: 6, holes: mk6(['L1','R1','LT','RT']), tip: 'Open L2 & R2.' },
  { offset: 7, holes: mk6(['L1','LT','RT']), tip: 'Only Top-Left + both thumbs closed.' },
  { offset: 8, holes: mk6(['L2','R1','LT','RT']), tip: 'Open L1, close L2 & R1 + thumbs.' },
  { offset: 9, holes: mk6(['LT','RT']), tip: 'All 4 top holes open; both thumbs closed.' },
  { offset: 10, holes: mk6(['L2','RT']), tip: 'L thumb open, L2 & R thumb closed.' },
  { offset: 11, holes: mk6(['RT']), tip: 'Only Right Thumb closed.' },
  { offset: 12, holes: mk6([]), tip: 'Octave: all 6 holes open!' },
  { offset: 13, holes: mk6(['L2']), tip: 'Overblow slightly or close L2 gently.' },
  { offset: 14, holes: mk6([]), tip: 'All open + firmer breath pressure (+2 semitones).' },
  { offset: 15, holes: mk6([]), tip: 'All open + firm breath (+3 semitones).' },
  { offset: 16, holes: mk6([]), tip: 'All open + strong focused breath (+4 semitones).' },
];

/**
 * Standard 4-Hole John Taylor Beginner Ocarina Fingerings (offsets 0 to +12)
 */
export const FINGERINGS_4: FingeringEntry[] = [
  { offset: 0, holes: mk4(['L1','L2','R1','R2']), tip: 'All 4 holes closed.' },
  { offset: 1, holes: mk4(['L1','L2','R1']), tip: 'Half-cover R2 for sharp/flat.' },
  { offset: 2, holes: mk4(['L1','L2','R1']), tip: 'Open Bottom-Right (R2).' },
  { offset: 3, holes: mk4(['L1','L2','R2']), tip: 'Open Top-Right (R1).' },
  { offset: 4, holes: mk4(['L1','L2']), tip: 'Open both Right holes (R1 & R2).' },
  { offset: 5, holes: mk4(['L1','R1','R2']), tip: 'Open Bottom-Left (L2) only.' },
  { offset: 6, holes: mk4(['L1','R1']), tip: 'Open L2 & R2.' },
  { offset: 7, holes: mk4(['L1']), tip: 'Only Top-Left (L1) closed.' },
  { offset: 8, holes: mk4(['L2','R2']), tip: 'Close L2 & R2 (cross-fingering).' },
  { offset: 9, holes: mk4(['L2']), tip: 'Only Bottom-Left (L2) closed.' },
  { offset: 10, holes: mk4(['R2']), tip: 'Only Bottom-Right (R2) closed.' },
  { offset: 11, holes: mk4(['R1']), tip: 'Only Top-Right (R1) closed.' },
  { offset: 12, holes: mk4([]), tip: 'All 4 holes open! Octave note.' },
];

export function getFingeringsForType(type: OcarinaType): FingeringEntry[] {
  if (type === '12-hole') return FINGERINGS_12;
  if (type === '6-hole') return FINGERINGS_6;
  return FINGERINGS_4;
}

export function getPlayableRange(type: OcarinaType, key: OcarinaKey): { minMidi: number; maxMidi: number } {
  const meta = OCARINA_TYPE_META[type];
  const root = OCARINA_KEYS[key].rootMidi;
  return {
    minMidi: root + meta.minOffset,
    maxMidi: root + meta.maxOffset,
  };
}

export function getFingeringForMidi(
  midi: number,
  type: OcarinaType,
  key: OcarinaKey
): { entry: FingeringEntry | null; inRange: boolean; offset: number } {
  const root = OCARINA_KEYS[key].rootMidi;
  const offset = midi - root;
  const list = getFingeringsForType(type);
  const found = list.find((f) => f.offset === offset);
  if (found) {
    return { entry: found, inRange: true, offset };
  }
  // Clamp to nearest for visual reference if out of range
  const clamped = offset < list[0].offset ? list[0] : list[list.length - 1];
  return { entry: clamped, inRange: false, offset };
}

/**
 * Given current interactive holes, find matching MIDI note on this ocarina
 */
export function findMidiFromHoles(holes: HoleMap, type: OcarinaType, key: OcarinaKey): number {
  const list = getFingeringsForType(type);
  const root = OCARINA_KEYS[key].rootMidi;
  let best = list[0];
  let bestScore = -1;
  for (const item of list) {
    let matches = 0;
    const keys = Object.keys(item.holes);
    for (const k of keys) {
      if (Boolean(holes[k]) === Boolean(item.holes[k])) matches++;
    }
    if (matches === keys.length) {
      return root + item.offset;
    }
    if (matches > bestScore) {
      bestScore = matches;
      best = item;
    }
  }
  return root + best.offset;
}

export interface ScaleDef {
  id: string;
  name: string;
  intervals: number[];
  description: string;
}

export const MUSICAL_SCALES: ScaleDef[] = [
  {
    id: 'major',
    name: 'Major (Ionian)',
    intervals: [0, 2, 4, 5, 7, 9, 11, 12],
    description: 'Bright, happy foundation scale — best place to start.',
  },
  {
    id: 'minor',
    name: 'Natural Minor',
    intervals: [0, 2, 3, 5, 7, 8, 10, 12],
    description: 'Expressive, folk and ballad mood.',
  },
  {
    id: 'pentatonic_major',
    name: 'Major Pentatonic',
    intervals: [0, 2, 4, 7, 9, 12],
    description: '5-note uplifting scale used in Celtic, folk & East Asian melodies.',
  },
  {
    id: 'pentatonic_minor',
    name: 'Minor Pentatonic',
    intervals: [0, 3, 5, 7, 10, 12],
    description: 'Soulful 5-note scale great for improvisation.',
  },
  {
    id: 'dorian',
    name: 'Dorian Mode',
    intervals: [0, 2, 3, 5, 7, 9, 10, 12],
    description: 'Mystical medieval & Zelda-style adventure sound.',
  },
  {
    id: 'blues',
    name: 'Blues Scale',
    intervals: [0, 3, 5, 6, 7, 10, 12],
    description: 'Adds the expressive b5 blue note.',
  },
  {
    id: 'chromatic',
    name: 'Chromatic (All Semitones)',
    intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    description: 'Master every sharp, flat, and cross-fingering.',
  },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToNoteName(midi: number): string {
  const rounded = Math.round(midi);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return `${name}${octave}`;
}

export function midiToPitchClass(midi: number): string {
  const rounded = Math.round(midi);
  return NOTE_NAMES[((rounded % 12) + 12) % 12];
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidiAndCents(freq: number): {
  exactMidi: number;
  midi: number;
  cents: number;
  noteName: string;
} {
  const exactMidi = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(exactMidi);
  const cents = Math.round((exactMidi - midi) * 100);
  return {
    exactMidi,
    midi,
    cents,
    noteName: midiToNoteName(midi),
  };
}
