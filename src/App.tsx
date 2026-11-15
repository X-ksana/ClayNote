import React, { useState } from 'react';
import { AudioLines, BookOpen, Compass, Music, PlayCircle } from 'lucide-react';
import { LearnTab } from './components/LearnTab';
import { Mp3StudioTab } from './components/Mp3StudioTab';
import { PlayTutorTab } from './components/PlayTutorTab';
import { ScalesTab } from './components/ScalesTab';
import { TunerTab } from './components/TunerTab';
import { OCARINA_KEYS, OCARINA_TYPE_META } from './data/ocarinaData';
import {
  deleteCustomSong,
  loadSavedSongs,
  saveCustomSong,
  STARTER_SONGS,
} from './data/starterSongs';
import { AppTab, OcarinaKey, OcarinaType, Song } from './types/ocarina';

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('learn');
  const [ocarinaType, setOcarinaType] = useState<OcarinaType>('12-hole');
  const [ocarinaKey, setOcarinaKey] = useState<OcarinaKey>('AC');

  const [customSongs, setCustomSongs] = useState<Song[]>(() => loadSavedSongs());
  const [transientScaleSongs, setTransientScaleSongs] = useState<Song[]>([]);
  const [activeSongId, setActiveSongId] = useState<string>(STARTER_SONGS[0].id);

  const allSongs: Song[] = [...customSongs, ...transientScaleSongs, ...STARTER_SONGS];

  const handleSaveAndOpenSong = (song: Song) => {
    const updated = saveCustomSong(song);
    setCustomSongs(updated);
    setActiveSongId(song.id);
    setActiveTab('play');
  };

  const handleDeleteSong = (songId: string) => {
    const updated = deleteCustomSong(songId);
    setCustomSongs(updated);
    if (activeSongId === songId) {
      setActiveSongId(STARTER_SONGS[0].id);
    }
  };

  const handlePracticeScaleSong = (song: Song) => {
    setTransientScaleSongs((prev) => [song, ...prev.slice(0, 4)]);
    setActiveSongId(song.id);
    setActiveTab('play');
  };

  const handleStartPracticeSong = (songId: string) => {
    setActiveSongId(songId);
    setActiveTab('play');
  };

  const navItems: Array<{ id: AppTab; label: string; shortLabel: string; icon: React.ReactNode }> = [
    { id: 'learn', label: 'Learn', shortLabel: 'Learn', icon: <BookOpen className="w-4 h-4 sm:w-4 sm:h-4" /> },
    { id: 'scales', label: 'Scales & Play', shortLabel: 'Scales', icon: <Music className="w-4 h-4" /> },
    { id: 'play', label: 'Play & Tutor', shortLabel: 'Tutor', icon: <PlayCircle className="w-4 h-4" /> },
    { id: 'mp3', label: 'MP3 Studio', shortLabel: 'MP3', icon: <AudioLines className="w-4 h-4" /> },
    { id: 'tuner', label: 'Tuner', shortLabel: 'Tuner', icon: <Compass className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF6F0] text-[#2C221E] pb-20 md:pb-8">
      {/* Top Sticky Craft Header */}
      <header className="sticky top-0 z-30 bg-[#FAF6F0]/95 backdrop-blur-md border-b border-[#E6DDD0]">
        <div className="max-w-6xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-2">
          {/* Brand */}
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src="/ocarina-icon.svg"
              alt="ClayNote"
              className="w-9 h-9 rounded-xl border border-[#E6DDD0] shadow-xs shrink-0"
            />
            <div className="min-w-0">
              <div className="font-serif-display font-bold text-base sm:text-lg leading-none text-[#2C221E] truncate">
                ClayNote
              </div>
              <div className="text-[11px] text-[#6E5D55] leading-tight hidden sm:block">
                Ocarina Studio & Voice Tutor
              </div>
            </div>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-1 bg-[#F3ECE1] p-1 rounded-xl border border-[#E6DDD0]">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    active
                      ? 'bg-white text-[#C2593F] shadow-xs'
                      : 'text-[#6E5D55] hover:text-[#2C221E]'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Global Ocarina Model & Key Quick Selector */}
          <div className="flex items-center gap-1.5 shrink-0">
            <select
              aria-label="Ocarina model"
              value={ocarinaType}
              onChange={(e) => setOcarinaType(e.target.value as OcarinaType)}
              className="bg-white border border-[#E6DDD0] rounded-xl px-2 sm:px-2.5 py-1.5 text-xs font-bold text-[#2C221E] cursor-pointer"
            >
              {(['12-hole', '6-hole', '4-hole'] as OcarinaType[]).map((t) => (
                <option key={t} value={t}>
                  {OCARINA_TYPE_META[t].shortName}
                </option>
              ))}
            </select>
            <select
              aria-label="Ocarina key"
              value={ocarinaKey}
              onChange={(e) => setOcarinaKey(e.target.value as OcarinaKey)}
              className="bg-[#FCEEE9] border border-[#C2593F]/30 rounded-xl px-2 sm:px-2.5 py-1.5 text-xs font-bold text-[#9E412B] cursor-pointer"
            >
              {(Object.keys(OCARINA_KEYS) as OcarinaKey[]).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-6 pt-4 sm:pt-6">
        {activeTab === 'learn' && (
          <LearnTab
            ocarinaType={ocarinaType}
            ocarinaKey={ocarinaKey}
            onStartPracticeSong={handleStartPracticeSong}
            onGoToScales={() => setActiveTab('scales')}
          />
        )}

        {activeTab === 'scales' && (
          <ScalesTab
            ocarinaType={ocarinaType}
            ocarinaKey={ocarinaKey}
            onChangeType={setOcarinaType}
            onChangeKey={setOcarinaKey}
            onPracticeScaleSong={handlePracticeScaleSong}
          />
        )}

        {activeTab === 'play' && (
          <PlayTutorTab
            songs={allSongs}
            activeSongId={activeSongId}
            onSelectSong={setActiveSongId}
            onDeleteSong={handleDeleteSong}
            ocarinaType={ocarinaType}
            ocarinaKey={ocarinaKey}
          />
        )}

        {activeTab === 'mp3' && (
          <Mp3StudioTab
            ocarinaType={ocarinaType}
            ocarinaKey={ocarinaKey}
            onSaveAndOpenSong={handleSaveAndOpenSong}
          />
        )}

        {activeTab === 'tuner' && (
          <TunerTab ocarinaType={ocarinaType} ocarinaKey={ocarinaKey} />
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#E6DDD0] safe-pb">
        <div className="grid grid-cols-5 px-1 pt-1.5">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition ${
                  active ? 'text-[#C2593F]' : 'text-[#6E5D55]'
                }`}
              >
                <div
                  className={`p-1.5 rounded-xl ${
                    active ? 'bg-[#FCEEE9]' : ''
                  }`}
                >
                  {item.icon}
                </div>
                <span className="text-[10px] font-bold mt-0.5">{item.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

export default App;
