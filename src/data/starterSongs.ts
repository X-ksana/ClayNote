import { Song, SongNote } from '../types/ocarina';

// Helper to build compact SongNote arrays from [midi, durationBeats, lyric?]
function buildNotes(items: Array<[number, number, string?]>): SongNote[] {
  let beat = 0;
  return items.map(([midi, dur, lyric], idx) => {
    const note: SongNote = {
      id: `n-${idx}`,
      midi,
      startBeat: beat,
      durationBeats: dur,
      lyric,
    };
    beat += dur;
    return note;
  });
}

// Note MIDI shortcuts for Alto C (C5 = 72)
const A4 = 69, B4 = 71;
const C5 = 72, D5 = 74, E5 = 76, F5 = 77, Fs5 = 78, G5 = 79, A5 = 81, Bb5 = 82, B5 = 83, C6 = 84, D6 = 86, E6 = 88;

export const STARTER_SONGS: Song[] = [
  {
    id: 'twinkle-star',
    title: 'Twinkle, Twinkle, Little Star',
    composer: 'Traditional Folk',
    difficulty: 'Beginner',
    bpm: 96,
    recommendedType: '4-hole',
    recommendedKey: 'AC',
    source: 'library',
    notes: buildNotes([
      [C5, 1, 'Twin-'], [C5, 1, 'kle'], [G5, 1, 'twin-'], [G5, 1, 'kle'],
      [A5, 1, 'lit-'], [A5, 1, 'tle'], [G5, 2, 'star,'],
      [F5, 1, 'how'], [F5, 1, 'I'], [E5, 1, 'won-'], [E5, 1, 'der'],
      [D5, 1, 'what'], [D5, 1, 'you'], [C5, 2, 'are.'],
      [G5, 1, 'Up'], [G5, 1, 'a-'], [F5, 1, 'bove'], [F5, 1, 'the'],
      [E5, 1, 'world'], [E5, 1, 'so'], [D5, 2, 'high,'],
      [G5, 1, 'like'], [G5, 1, 'a'], [F5, 1, 'dia-'], [F5, 1, 'mond'],
      [E5, 1, 'in'], [E5, 1, 'the'], [D5, 2, 'sky.'],
      [C5, 1, 'Twin-'], [C5, 1, 'kle'], [G5, 1, 'twin-'], [G5, 1, 'kle'],
      [A5, 1, 'lit-'], [A5, 1, 'tle'], [G5, 2, 'star,'],
      [F5, 1, 'how'], [F5, 1, 'I'], [E5, 1, 'won-'], [E5, 1, 'der'],
      [D5, 1, 'what'], [D5, 1, 'you'], [C5, 2, 'are.'],
    ]),
  },
  {
    id: 'ode-to-joy',
    title: 'Ode to Joy',
    composer: 'L. van Beethoven',
    difficulty: 'Beginner',
    bpm: 104,
    recommendedType: '4-hole',
    recommendedKey: 'AC',
    source: 'library',
    notes: buildNotes([
      [E5, 1], [E5, 1], [F5, 1], [G5, 1],
      [G5, 1], [F5, 1], [E5, 1], [D5, 1],
      [C5, 1], [C5, 1], [D5, 1], [E5, 1],
      [E5, 1.5], [D5, 0.5], [D5, 2],
      [E5, 1], [E5, 1], [F5, 1], [G5, 1],
      [G5, 1], [F5, 1], [E5, 1], [D5, 1],
      [C5, 1], [C5, 1], [D5, 1], [E5, 1],
      [D5, 1.5], [C5, 0.5], [C5, 2],
    ]),
  },
  {
    id: 'mary-lamb',
    title: 'Mary Had a Little Lamb (Warmup)',
    composer: 'Traditional',
    difficulty: 'Beginner',
    bpm: 100,
    recommendedType: '4-hole',
    recommendedKey: 'AC',
    source: 'library',
    notes: buildNotes([
      [E5, 1], [D5, 1], [C5, 1], [D5, 1],
      [E5, 1], [E5, 1], [E5, 2],
      [D5, 1], [D5, 1], [D5, 2],
      [E5, 1], [G5, 1], [G5, 2],
      [E5, 1], [D5, 1], [C5, 1], [D5, 1],
      [E5, 1], [E5, 1], [E5, 1], [E5, 1],
      [D5, 1], [D5, 1], [E5, 1], [D5, 1],
      [C5, 4],
    ]),
  },
  {
    id: 'amazing-grace',
    title: 'Amazing Grace',
    composer: 'Traditional Hymn',
    difficulty: 'Intermediate',
    bpm: 84,
    recommendedType: '12-hole',
    recommendedKey: 'AC',
    source: 'library',
    notes: buildNotes([
      [G5, 1, 'A-'], [C6, 2, 'maz-'], [E6, 0.5, 'ing'], [C6, 0.5],
      [E6, 2, 'grace'], [D6, 1, 'how'], [C6, 2, 'sweet'], [A5, 1, 'the'], [G5, 2, 'sound'],
      [G5, 1, 'That'], [C6, 2, 'saved'], [E6, 0.5, 'a'], [C6, 0.5],
      [E6, 2, 'wretch'], [D6, 1, 'like'], [E6, 3, 'me.'],
    ]),
  },
  {
    id: 'scarborough-fair',
    title: 'Scarborough Fair (Dorian)',
    composer: 'English Folk',
    difficulty: 'Intermediate',
    bpm: 92,
    recommendedType: '12-hole',
    recommendedKey: 'AC',
    source: 'library',
    notes: buildNotes([
      [D5, 2, 'Are'], [D5, 1, 'you'], [A5, 2, 'go-'], [A5, 1, 'ing'],
      [E5, 1, 'to'], [F5, 1, 'Scar-'], [E5, 1, 'bo-'], [D5, 3, 'rough'],
      [A5, 1, 'Fair?'], [C6, 2, 'Pars-'], [D6, 1, 'ley'], [C6, 1, 'sage,'],
      [A5, 1, 'rose-'], [B5, 1, 'ma-'], [G5, 1, 'ry'], [A5, 3, 'and'],
      [A5, 1, 'thyme.'],
    ]),
  },
  {
    id: 'sakura-sakura',
    title: 'Sakura Sakura',
    composer: 'Japanese Folk',
    difficulty: 'Intermediate',
    bpm: 86,
    recommendedType: '12-hole',
    recommendedKey: 'AC',
    source: 'library',
    notes: buildNotes([
      [A5, 1, 'Sa-'], [A5, 1, 'ku-'], [B5, 2, 'ra,'],
      [A5, 1, 'sa-'], [A5, 1, 'ku-'], [B5, 2, 'ra,'],
      [A5, 1, 'no-'], [B5, 1, 'ya-'], [C6, 1, 'ma'], [B5, 1, 'mo'],
      [A5, 1, 'sa-'], [B5, 0.5, 'to'], [A5, 0.5], [F5, 2, 'mo'],
      [E5, 1, 'mi-'], [C5, 1, 'wa-'], [E5, 1, 'ta-'], [F5, 1, 'su'],
      [E5, 1, 'ka-'], [E5, 0.5, 'gi-'], [C5, 0.5], [B4, 2, 'ri'],
    ]),
  },
  {
    id: 'greensleeves',
    title: 'Greensleeves',
    composer: '16th Century English (D Minor)',
    difficulty: 'Advanced',
    bpm: 88,
    recommendedType: '12-hole',
    recommendedKey: 'AC',
    source: 'library',
    notes: buildNotes([
      [D5, 1], [F5, 2], [G5, 1], [A5, 1.5], [Bb5, 0.5], [A5, 1],
      [G5, 2], [E5, 1], [C5, 1.5], [D5, 0.5], [E5, 1],
      [F5, 2], [D5, 1], [D5, 1.5], [73, 0.5], [D5, 1], // 73 = C#5
      [E5, 2], [C5, 1], [A4, 2],
      [D5, 1], [F5, 2], [G5, 1], [A5, 1.5], [Bb5, 0.5], [A5, 1],
      [G5, 2], [E5, 1], [C5, 1.5], [D5, 0.5], [E5, 1],
      [F5, 1.5], [E5, 0.5], [D5, 1], [73, 1.5], [B4, 0.5], [73, 1],
      [D5, 3],
    ]),
  },
];

const STORAGE_KEY = 'claynote_custom_songs_v1';

export function loadSavedSongs(): Song[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomSong(song: Song): Song[] {
  const existing = loadSavedSongs().filter((s) => s.id !== song.id);
  const next = [song, ...existing];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
  return next;
}

export function deleteCustomSong(songId: string): Song[] {
  const next = loadSavedSongs().filter((s) => s.id !== songId);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}
