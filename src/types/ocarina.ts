export type OcarinaType = '12-hole' | '6-hole' | '4-hole';

export type OcarinaKey = 'AC' | 'SC' | 'BC' | 'AG' | 'AF';

export interface OcarinaKeyInfo {
  id: OcarinaKey;
  name: string;
  shortName: string;
  /** MIDI number of the ocarina's tonic / "all main holes closed" C-position note */
  rootMidi: number;
  description: string;
}

export interface HoleDefinition {
  id: string;
  label: string;
  hand: 'L' | 'R';
  isThumb?: boolean;
  isSubhole?: boolean;
  /** Normalized SVG coordinates (0-100 viewBox) */
  x: number;
  y: number;
  r: number;
}

export type HoleMap = Record<string, boolean>; // true = closed/covered, false = open

export interface FingeringEntry {
  /** Semitone offset relative to ocarina rootMidi */
  offset: number;
  /** Map of holeId -> closed (true) or open (false) */
  holes: HoleMap;
  tip?: string;
}

export interface SongNote {
  id: string;
  /** MIDI note number (e.g., 72 = C5) */
  midi: number;
  /** Start time in beats (for authored songs) or seconds (converted via BPM) */
  startBeat: number;
  /** Duration in beats */
  durationBeats: number;
  lyric?: string;
  outOfRange?: boolean;
}

export interface Song {
  id: string;
  title: string;
  composer: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced' | 'Custom MP3';
  bpm: number;
  /** Recommended ocarina type/key */
  recommendedType?: OcarinaType;
  recommendedKey?: OcarinaKey;
  notes: SongNote[];
  source: 'library' | 'mp3' | 'scale';
  createdAt?: number;
}

export type NoteGrade = 'pending' | 'active' | 'perfect' | 'good' | 'sharp' | 'flat' | 'wrong' | 'missed';

export interface PracticeNoteResult {
  noteId: string;
  targetMidi: number;
  detectedMidi: number | null;
  avgCents: number | null;
  grade: NoteGrade;
  samples: number;
}

export interface PitchReading {
  frequency: number | null;
  midi: number | null;
  exactMidi: number | null;
  noteName: string;
  cents: number;
  clarity: number;
  rms: number;
}

export type AppTab = 'learn' | 'scales' | 'play' | 'mp3' | 'tuner';
export type ScrollViewMode = 'tab' | 'highway';
export type TutorMode = 'listen' | 'wait' | 'graded';
