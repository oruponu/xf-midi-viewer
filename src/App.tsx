import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import './App.css';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { ErrorToast } from './components/ErrorToast.tsx';
import { InfoPanel } from './components/InfoPanel.tsx';
import type { InfoPanelTab } from './components/InfoPanel.tsx';
import { LibraryDrawer } from './components/LibraryDrawer.tsx';
import { LibraryFolderButton } from './components/LibraryFolderButton.tsx';
import { PartPanel } from './components/PartPanel.tsx';
import { PlaybackPanel } from './components/PlaybackPanel.tsx';
import { SettingsDialog } from './components/SettingsDialog.tsx';
import { SongLibrary, SongLibraryHead, SongLibraryNotice } from './components/SongLibrary.tsx';
import { useFailureNotice } from './hooks/useFailureNotice.ts';
import { useLibrary } from './hooks/useLibrary.ts';
import { useMediaQuery } from './hooks/useMediaQuery.ts';
import { useMidiPlayer } from './hooks/useMidiPlayer.ts';
import { useSettings } from './hooks/useSettings.ts';
import type { Settings } from './hooks/useSettings.ts';
import { useSongLoader } from './hooks/useSongLoader.ts';
import { useTheme } from './hooks/useTheme.ts';
import { useWakeLock } from './hooks/useWakeLock.ts';
import { MIDI_EXTENSIONS } from './lib/library/midiFiles.ts';
import type { MidiScheduler } from './lib/player/scheduler.ts';
import { buildFixedKeyShifts } from './lib/smf/fixedKey.ts';
import type { KeyShiftChange } from './lib/smf/fixedKey.ts';
import type { Song } from './lib/song.ts';
import { songHeading } from './lib/songHeading.ts';
import type { FileSummary, SongErrorReason } from './lib/songLoader.ts';
import { tabIndexForKey } from './lib/tabNavigation.ts';
import { nextTheme } from './lib/theme.ts';
import type { Theme } from './lib/theme.ts';

const APP_NAME = 'XF MIDI Viewer';
const PART_PANEL_ID = 'part-panel';
const FILE_ACCEPT = [...MIDI_EXTENSIONS, 'audio/midi'].join(',');

const THEME_LABELS: Record<Theme, string> = {
  system: 'システム',
  light: 'ライト',
  dark: 'ダーク',
};

function App() {
  const { state: songState, loadFile } = useSongLoader();
  const [isDragging, setIsDragging] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isPartPanelOpen, setIsPartPanelOpen] = useState(false);
  const [selectedTab, setActiveTab] = useState<InfoPanelTab>('leadSheet');
  const canShowScore = useMediaQuery(SCORE_MEDIA_QUERY);
  // The selection is kept, so the score comes back when the screen is large enough again.
  const activeTab = selectedTab === 'score' && !canShowScore ? 'leadSheet' : selectedTab;
  const togglePartPanel = useCallback(() => setIsPartPanelOpen((open) => !open), []);
  const closePartPanel = useCallback(() => setIsPartPanelOpen(false), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isTouchPrimary = useMediaQuery('(pointer: coarse)');
  const canDockLibrary = useMediaQuery('(min-width: 1100px)');
  const { settings, updateSettings } = useSettings();
  useTheme(settings.theme);
  const library = useLibrary();
  const isLibraryDocked = settings.libraryDocked && canDockLibrary && songState.current !== null;
  const closeLibrary = useCallback(() => {
    setIsLibraryOpen(false);
    if (isLibraryDocked) updateSettings({ libraryDocked: false });
  }, [isLibraryDocked, updateSettings]);
  const toggleLibraryDock = useCallback(() => {
    updateSettings({ libraryDocked: !isLibraryDocked });
    setIsLibraryOpen(isLibraryDocked);
  }, [isLibraryDocked, updateSettings]);
  const song = songState.current?.song ?? null;
  const file = songState.current?.file ?? null;
  const loadFailure = songState.failure;
  const [dismissedFailureId, setDismissedFailureId] = useState<number | null>(null);
  const songKey = file ? `${file.name}-${file.size}-${file.lastModified}` : 'empty';
  const [failedSongKey, setFailedSongKey] = useState<string | null>(null);
  const songFailed = failedSongKey === songKey;
  const heading = useMemo(
    () => (song && file ? songHeading(song.xf, file.name) : null),
    [song, file],
  );
  const fixedKeyShifts = useMemo(
    () => (settings.fixKeyToC && song ? buildFixedKeyShifts(song.timing) : null),
    [settings.fixKeyToC, song],
  );
  const player = useMidiPlayer(song?.sequence ?? null, fixedKeyShifts);
  const { scheduler, isPlaying } = player;
  const outputReady = player.outputReady && !player.isPreparing;
  const { play, stop } = player;
  const { notice: playerNotice, dismiss: dismissPlayerNotice } = useFailureNotice(player.failure);
  useWakeLock(isPlaying);

  const songTitle = heading?.title;
  useEffect(() => {
    document.title = songTitle ? `${songTitle} - ${APP_NAME}` : APP_NAME;
  }, [songTitle]);

  const openFile = useCallback(
    (f: File) => {
      void loadFile(f, () => {
        stop();
        scheduler.sendReset();
      });
    },
    [scheduler, stop, loadFile],
  );

  const { openSong } = library;
  const openLibrarySong = useCallback(
    async (fileName: string): Promise<boolean> => {
      const f = await openSong(fileName);
      if (f) openFile(f);
      return f !== null;
    },
    [openSong, openFile],
  );

  const { refresh: refreshLibrary } = library;
  const isLibraryShown = isLibraryOpen || isLibraryDocked;
  useEffect(() => {
    if (isLibraryShown) refreshLibrary({ prompt: false });
  }, [isLibraryShown, refreshLibrary]);

  useEffect(() => {
    if (!isLibraryDocked) return;
    const root = document.documentElement;
    root.classList.add('library-docked');
    return () => root.classList.remove('library-docked');
  }, [isLibraryDocked]);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
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
      if (isSettingsOpen || isLibraryOpen) return;
      if (!song || songFailed) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      if (isPlaying) scheduler.pause();
      else play();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPlaying, isSettingsOpen, isLibraryOpen, song, songFailed, scheduler, play]);

  return (
    <>
      <header className="app-bar">
        <div className="app-bar-inner">
          <div className="app-bar-lead">
            {songState.current && (
              <button
                type="button"
                className="icon-button"
                title="曲の一覧"
                aria-label="曲の一覧"
                aria-expanded={isLibraryShown}
                onClick={() =>
                  isLibraryDocked ? closeLibrary() : setIsLibraryOpen((open) => !open)
                }
              >
                <ListIcon />
              </button>
            )}
            {heading ? (
              <div className="app-bar-song">
                <h1 className="app-bar-title app-bar-song-title" title={heading.title}>
                  {heading.title}
                </h1>
                {heading.performer && (
                  <p className="app-bar-song-performer" title={heading.performer}>
                    {heading.performer}
                  </p>
                )}
              </div>
            ) : (
              <h1 className="app-bar-title">{APP_NAME}</h1>
            )}
          </div>
          <div className="app-bar-actions">
            <input type="file" accept={FILE_ACCEPT} hidden onChange={onChange} ref={fileInputRef} />
            <button
              type="button"
              className="icon-button"
              title="ファイルを開く"
              aria-label="ファイルを開く"
              onClick={() => fileInputRef.current?.click()}
            >
              <FolderOpenIcon />
            </button>
            <button
              type="button"
              className="icon-button"
              title={`テーマ: ${THEME_LABELS[settings.theme]}`}
              aria-label={`テーマ: ${THEME_LABELS[settings.theme]}`}
              onClick={() => updateSettings({ theme: nextTheme(settings.theme) })}
            >
              <ThemeIcon theme={settings.theme} />
            </button>
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

      <div className="toast-stack">
        {songState.current && loadFailure && loadFailure.id !== dismissedFailureId && (
          <ErrorToast
            timerKey={loadFailure.id}
            onDismiss={() => setDismissedFailureId(loadFailure.id)}
          >
            <LoadErrorMessage
              fileName={loadFailure.file.name}
              reason={loadFailure.reason}
              detail={loadFailure.detail}
            />
          </ErrorToast>
        )}
        {playerNotice && (
          <ErrorToast timerKey={playerNotice.id} onDismiss={dismissPlayerNotice}>
            {playerNotice.failure.message}
            {playerNotice.failure.hint && (
              <>
                <br />
                {playerNotice.failure.hint}
              </>
            )}
          </ErrorToast>
        )}
      </div>

      <main className={`app${isDragging ? ' app--dragging' : ''}`}>
        {!songState.current && loadFailure && (
          <section className="error" role="alert">
            <LoadErrorMessage
              fileName={loadFailure.file.name}
              reason={loadFailure.reason}
              detail={loadFailure.detail}
            />
          </section>
        )}

        {!songState.current && library.status === 'ready' && (
          <section className="library-start">
            <SongLibrary
              library={library}
              currentFileName={null}
              onSelect={(fileName) => void openLibrarySong(fileName)}
            />
            <button
              type="button"
              className="library-start-file"
              onClick={() => fileInputRef.current?.click()}
            >
              ファイルを開く
            </button>
          </section>
        )}

        {!songState.current && library.status === 'empty' && (
          <section className="empty-state">
            <SongLibraryNotice library={library} />
            <div className="drop-zone">
              <span className="drop-zone-icon">
                <FolderOpenIcon size={36} />
              </span>
              <p className="empty-state-headline">
                {isTouchPrimary ? 'MIDI ファイルを開く' : 'MIDI ファイルをここにドロップ'}
              </p>
              <p className="muted">YAMAHA XF フォーマットの歌詞とコードを表示します</p>
              <div className="drop-zone-actions">
                <button
                  type="button"
                  className="file-select-button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  ファイルを選択
                </button>
                <LibraryFolderButton
                  library={library}
                  mode="replace"
                  className="folder-select-button"
                >
                  フォルダを選択
                </LibraryFolderButton>
              </div>
              <p className="muted">
                MIDI ファイルをまとめたフォルダを選択すると、曲の一覧から開けます
              </p>
              <p className="drop-zone-formats">対応形式: {MIDI_EXTENSIONS.join(' ')}</p>
            </div>
          </section>
        )}

        {song?.xfError && (
          <section className="error" role="alert">
            <strong>歌詞やコードなどの XF 情報を読み込めませんでした。</strong>
            <br />
            曲の再生はできます。
            <div className="error-detail">詳細: {song.xfError}</div>
          </section>
        )}

        <ErrorBoundary
          key={songKey}
          fallback={(error) => (
            <section className="error" role="alert">
              <strong>この曲を表示できませんでした:</strong> {error.message}
              <br />
              別のファイルを開いてください。
            </section>
          )}
          onError={() => {
            stop();
            setFailedSongKey(songKey);
          }}
        >
          <PlayerScope
            file={file}
            song={song}
            settings={settings}
            scheduler={scheduler}
            isPlaying={isPlaying}
            playbackRate={player.playbackRate}
            keyShift={player.keyShift}
            fixedKeyShifts={fixedKeyShifts}
            outputReady={outputReady}
            onPlay={play}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isPartPanelOpen={isPartPanelOpen}
            onTogglePartPanel={togglePartPanel}
            onClosePartPanel={closePartPanel}
          />
        </ErrorBoundary>
      </main>

      <SettingsDialog
        open={isSettingsOpen}
        settings={settings}
        onChange={updateSettings}
        player={player}
        library={library}
        onClose={() => setIsSettingsOpen(false)}
      />

      {songState.current && (
        <LibraryDrawer
          open={isLibraryOpen}
          docked={isLibraryDocked}
          canDock={canDockLibrary}
          onClose={closeLibrary}
          onToggleDock={toggleLibraryDock}
          title={<SongLibraryHead library={library} />}
        >
          <SongLibrary
            library={library}
            showHead={false}
            currentFileName={file?.name ?? null}
            onSelect={(fileName) => {
              void openLibrarySong(fileName).then((opened) => {
                if (opened) setIsLibraryOpen(false);
              });
            }}
          />
        </LibraryDrawer>
      )}
    </>
  );
}

function LoadErrorMessage({
  fileName,
  reason,
  detail,
}: {
  fileName: string;
  reason: SongErrorReason;
  detail: string;
}) {
  switch (reason) {
    case 'notSmf':
      return (
        <>
          <strong>{fileName} は MIDI ファイルではありません。</strong>
          <br />
          MIDI ファイルを開いてください。
        </>
      );
    case 'broken':
      return (
        <>
          <strong>{fileName} を読み込めませんでした。</strong>
          <br />
          ファイルが壊れている可能性があります。
          <div className="error-detail">詳細: {detail}</div>
        </>
      );
    case 'readFailed':
      return (
        <>
          <strong>{fileName} を読み込めませんでした。</strong>
          <br />
          もう一度開いてください。
        </>
      );
  }
}

function ListIcon() {
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
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function FolderOpenIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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

function ThemeIcon({ theme }: { theme: Theme }) {
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
      {theme === 'system' && (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
        </>
      )}
      {theme === 'light' && (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </>
      )}
      {theme === 'dark' && <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />}
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
  fixedKeyShifts,
  outputReady,
  onPlay,
  activeTab,
  onTabChange,
  isPartPanelOpen,
  onTogglePartPanel,
  onClosePartPanel,
}: {
  file: FileSummary | null;
  song: Song | null;
  settings: Settings;
  scheduler: MidiScheduler;
  isPlaying: boolean;
  playbackRate: number;
  keyShift: number;
  fixedKeyShifts: readonly KeyShiftChange[] | null;
  outputReady: boolean;
  onPlay: () => void;
  activeTab: InfoPanelTab;
  onTabChange: (tab: InfoPanelTab) => void;
  isPartPanelOpen: boolean;
  onTogglePartPanel: () => void;
  onClosePartPanel: () => void;
}) {
  const dockRef = useRef<HTMLDivElement | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const manualKeyShifts = useMemo<KeyShiftChange[]>(
    () => [{ tick: 0, semitones: keyShift }],
    [keyShift],
  );
  const keyShifts = fixedKeyShifts ?? manualKeyShifts;

  useEffect(() => {
    const dock = dockRef.current;
    const chrome = chromeRef.current;
    const root = document.documentElement;
    const clear = () => {
      root.style.removeProperty('--dock-height');
      root.style.removeProperty('--viewer-tabs-bottom');
    };
    if (!dock || !chrome) {
      clear();
      return;
    }
    const update = () => {
      root.style.setProperty('--dock-height', `${dock.offsetHeight}px`);
      // The bottom padding fades out over the content.
      const tabsBottom = chrome.offsetHeight - parseFloat(getComputedStyle(chrome).paddingBottom);
      root.style.setProperty('--viewer-tabs-bottom', `${tabsBottom}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(dock);
    observer.observe(chrome);
    return () => {
      observer.disconnect();
      clear();
    };
  }, [song]);

  if (!song) return null;

  return (
    <>
      <div className="viewer-chrome" ref={chromeRef}>
        <ViewTabs activeTab={activeTab} onChange={onTabChange} />
      </div>
      <InfoPanel
        id={VIEW_PANEL_ID}
        labelledBy={viewTabId(activeTab)}
        file={file}
        song={song}
        activeTab={activeTab}
        scheduler={scheduler}
        autoScrollLeadSheet={settings.autoScrollLeadSheet}
        autoScrollLyrics={settings.autoScrollLyrics}
        showPitchBar={settings.showPitchBar}
        chordDegrees={settings.chordDegrees}
        keyShifts={keyShifts}
        playbackRate={playbackRate}
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
            keyShifts={keyShifts}
            isKeyFixed={fixedKeyShifts !== null}
            outputReady={outputReady}
            onPlay={onPlay}
            partCount={song.channelParts.length}
            isPartPanelOpen={isPartPanelOpen}
            partPanelId={PART_PANEL_ID}
            onTogglePartPanel={onTogglePartPanel}
          />
        </div>
      </div>
      {isPartPanelOpen && song.channelParts.length > 0 && (
        <PartPanel
          id={PART_PANEL_ID}
          parts={song.channelParts}
          activity={song.noteActivity}
          melodyChannels={song.xf.karaoke.header?.melodyChannels ?? []}
          scheduler={scheduler}
          onClose={onClosePartPanel}
        />
      )}
    </>
  );
}

const VIEW_TABS: ReadonlyArray<{
  id: InfoPanelTab;
  label: string;
}> = [
  { id: 'leadSheet', label: 'リードシート' },
  { id: 'score', label: '譜面' },
  { id: 'lyrics', label: '歌詞' },
  { id: 'karaoke', label: 'カラオケ' },
  { id: 'details', label: '詳細' },
];

// A full score cannot be read on a phone-sized screen in either orientation.
const SCORE_MEDIA_QUERY = '(min-width: 600px) and (min-height: 500px)';

const VIEW_PANEL_ID = 'view-panel';

function viewTabId(tab: InfoPanelTab): string {
  return `view-tab-${tab}`;
}

function ViewTabs({
  activeTab,
  onChange,
}: {
  activeTab: InfoPanelTab;
  onChange: (tab: InfoPanelTab) => void;
}) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Removed from the list rather than hidden, so the arrow keys never land on it.
  const canShowScore = useMediaQuery(SCORE_MEDIA_QUERY);
  const tabs = canShowScore ? VIEW_TABS : VIEW_TABS.filter((tab) => tab.id !== 'score');

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((tab) => tab.id === activeTab);
    const next = tabIndexForKey(e.key, current, tabs.length);
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next]!.id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="viewer-tabs" role="tablist" aria-label="表示切り替え" onKeyDown={onKeyDown}>
      {tabs.map((tab, i) => {
        const selected = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            id={viewTabId(tab.id)}
            className="viewer-tab"
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={VIEW_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
          >
            <span className="viewer-tab-label">{tab.label}</span>
          </button>
        );
      })}
    </div>
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
