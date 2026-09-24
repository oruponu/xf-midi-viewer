import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import './App.css';
import { InfoPanel } from './components/InfoPanel.tsx';
import type { InfoPanelTab } from './components/InfoPanel.tsx';
import { PlaybackPanel } from './components/PlaybackPanel.tsx';
import { SettingsDialog } from './components/SettingsDialog.tsx';
import { useMidiPlayer } from './hooks/useMidiPlayer.ts';
import { useSettings } from './hooks/useSettings.ts';
import type { Settings } from './hooks/useSettings.ts';
import { useSongLoader } from './hooks/useSongLoader.ts';
import type { MidiScheduler } from './lib/player/scheduler.ts';
import type { Song } from './lib/song.ts';
import type { FileSummary } from './lib/songLoader.ts';

function App() {
  const { state: songState, loadFile } = useSongLoader();
  const [isDragging, setIsDragging] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { settings, updateSettings } = useSettings();
  const song = songState.status === 'loaded' ? songState.song : null;
  const file = songState.status === 'empty' ? null : songState.file;
  const errorMessage = songState.status === 'error' ? songState.message : (song?.xfError ?? null);
  const player = useMidiPlayer(song?.sequence ?? null);
  const { scheduler, isPlaying } = player;
  const midiReady = player.midiAccessState === 'ready' && player.selectedMidiOutputId.length > 0;

  const openFile = useCallback(
    (f: File) => {
      scheduler.stop();
      scheduler.sendReset();
      void loadFile(f);
    },
    [scheduler, loadFile],
  );

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    openFile(f);
  };

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      e.dataTransfer ? Array.from(e.dataTransfer.types).includes('Files') : false;

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setIsDragging(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (e.relatedTarget !== null) return;
      setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      openFile(f);
    };

    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('drop', onDrop);
    };
  }, [openFile]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (e.repeat) return;
      if (isSettingsOpen) return;
      if (!song) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      if (isPlaying) scheduler.pause();
      else scheduler.play();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPlaying, isSettingsOpen, song, scheduler]);

  return (
    <>
      <header className="app-bar">
        <div className="app-bar-inner">
          <h1 className="app-bar-title">XF MIDI Viewer</h1>
          <div className="app-bar-actions">
            <label className="icon-button" title="ファイルを開く" aria-label="ファイルを開く">
              <input
                type="file"
                accept=".mid,.midi,.kar,.xih,.xkm,audio/midi"
                onChange={onChange}
              />
              <FolderOpenIcon />
            </label>
            <button
              type="button"
              className="icon-button"
              title="設定"
              aria-label="設定"
              onClick={() => setIsSettingsOpen(true)}
            >
              <SettingsIcon />
            </button>
          </div>
        </div>
      </header>

      <main className={`app${isDragging ? ' app--dragging' : ''}`}>
        {(songState.status === 'empty' || songState.status === 'loading') && (
          <section className="empty-state">
            <p className="empty-state-headline">
              YAMAHA XF フォーマットの MIDI ファイルを解析・表示します
            </p>
            <p className="muted">上部のアイコンから開くか、ウィンドウへドラッグ&ドロップ</p>
          </section>
        )}

        {errorMessage && (
          <section className="error" role="alert">
            <strong>パースエラー:</strong> {errorMessage}
          </section>
        )}

        <PlayerScope
          key={file ? `${file.name}-${file.size}-${file.lastModified}` : 'empty'}
          file={file}
          song={song}
          settings={settings}
          scheduler={scheduler}
          isPlaying={isPlaying}
          playbackRate={player.playbackRate}
          keyShift={player.keyShift}
          midiReady={midiReady}
        />
      </main>

      <SettingsDialog
        open={isSettingsOpen}
        settings={settings}
        onChange={updateSettings}
        midi={player}
        onClose={() => setIsSettingsOpen(false)}
      />
    </>
  );
}

function FolderOpenIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v1H3V7Z" />
      <path d="M3 10h18.2l-1.95 8.1A2 2 0 0 1 17.3 19.6H5.55a2 2 0 0 1-1.95-1.5L3 10Z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

function PlayerScope({
  file,
  song,
  settings,
  scheduler,
  isPlaying,
  playbackRate,
  keyShift,
  midiReady,
}: {
  file: FileSummary | null;
  song: Song | null;
  settings: Settings;
  scheduler: MidiScheduler;
  isPlaying: boolean;
  playbackRate: number;
  keyShift: number;
  midiReady: boolean;
}) {
  const [activeTab, setActiveTab] = useState<InfoPanelTab>('leadSheet');
  const dockRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = dockRef.current;
    const root = document.documentElement;
    if (!el) {
      root.style.removeProperty('--dock-height');
      return;
    }
    const update = () => {
      root.style.setProperty('--dock-height', `${el.offsetHeight}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--dock-height');
    };
  }, [song]);

  if (!song) return null;

  return (
    <>
      <div className="viewer-chrome">
        <ViewTabs activeTab={activeTab} onChange={setActiveTab} />
      </div>
      <InfoPanel
        file={file}
        song={song}
        activeTab={activeTab}
        scheduler={scheduler}
        autoScrollLeadSheet={settings.autoScrollLeadSheet}
        autoScrollLyrics={settings.autoScrollLyrics}
        keyShift={keyShift}
      />
      <div className="player-dock" ref={dockRef}>
        <div className="player-dock-inner">
          <PlaybackPanel
            sequence={song.sequence}
            timing={song.timing}
            scheduler={scheduler}
            isPlaying={isPlaying}
            playbackRate={playbackRate}
            keyShift={keyShift}
            midiReady={midiReady}
          />
        </div>
      </div>
    </>
  );
}

const VIEW_TABS: ReadonlyArray<{
  id: InfoPanelTab;
  label: string;
}> = [
  { id: 'leadSheet', label: 'リードシート' },
  { id: 'lyrics', label: '歌詞' },
  { id: 'karaoke', label: 'カラオケ' },
  { id: 'details', label: '詳細' },
];

function ViewTabs({
  activeTab,
  onChange,
}: {
  activeTab: InfoPanelTab;
  onChange: (tab: InfoPanelTab) => void;
}) {
  return (
    <nav className="viewer-tabs" aria-label="表示切り替え">
      {VIEW_TABS.map((tab) => (
        <button
          key={tab.id}
          className="viewer-tab"
          type="button"
          aria-selected={activeTab === tab.id}
          onClick={() => onChange(tab.id)}
        >
          <span className="viewer-tab-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'password', 'tel', 'url', 'number']);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(target.type);
  }
  return false;
}

export default App;
