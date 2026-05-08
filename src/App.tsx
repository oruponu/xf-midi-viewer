import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import './App.css';
import { InfoPanel } from './components/InfoPanel.tsx';
import type { InfoPanelTab } from './components/InfoPanel.tsx';
import { PlaybackPanel } from './components/PlaybackPanel.tsx';
import { SettingsDialog } from './components/SettingsDialog.tsx';
import { useMidiPlayer } from './hooks/useMidiPlayer.ts';
import { useSettings } from './hooks/useSettings.ts';
import type { Settings } from './hooks/useSettings.ts';
import { parseSmf } from './lib/smf/parser.ts';
import { buildPlaybackSequence, secondsToTick } from './lib/smf/playback.ts';
import type { PlaybackSequence } from './lib/smf/playback.ts';
import type { SmfFile } from './lib/smf/types.ts';
import { extractXf } from './lib/xf/parser.ts';
import type { XfData } from './lib/xf/types.ts';

type SelectedFile = {
  name: string;
  size: number;
  lastModified: number;
};

function App() {
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [smf, setSmf] = useState<SmfFile | null>(null);
  const [xf, setXf] = useState<XfData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { settings, updateSettings } = useSettings();
  const playbackSequence = useMemo(
    () => (smf ? buildPlaybackSequence(smf) : null),
    [smf],
  );
  const player = useMidiPlayer(playbackSequence);

  const loadFile = useCallback(
    async (f: File) => {
      player.stop();
      setFile({ name: f.name, size: f.size, lastModified: f.lastModified });
      setError(null);
      setXf(null);
      setSmf(null);
      try {
        const buffer = await f.arrayBuffer();
        const parsedSmf = parseSmf(buffer);
        setSmf(parsedSmf);
        setXf(extractXf(parsedSmf));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [player],
  );

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    void loadFile(f);
  };

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      e.dataTransfer
        ? Array.from(e.dataTransfer.types).includes('Files')
        : false;

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
      void loadFile(f);
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
  }, [loadFile]);

  return (
    <>
      <header className="app-bar">
        <div className="app-bar-inner">
          <h1 className="app-bar-title">XF MIDI Viewer</h1>
          <div className="app-bar-actions">
            <label
              className="icon-button"
              title="ファイルを開く"
              aria-label="ファイルを開く"
            >
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
        {!xf && !error && (
          <section className="empty-state">
            <p className="empty-state-headline">
              YAMAHA XF フォーマットの MIDI ファイルを解析・表示します
            </p>
            <p className="muted">
              上部のアイコンから開くか、ウィンドウへドラッグ&ドロップ
            </p>
          </section>
        )}

        {error && (
          <section className="error" role="alert">
            <strong>パースエラー:</strong> {error}
          </section>
        )}

        <PlayerScope
          key={
            file ? `${file.name}-${file.size}-${file.lastModified}` : 'empty'
          }
          file={file}
          sequence={playbackSequence}
          xf={xf}
          settings={settings}
          player={player}
        />
      </main>

      <SettingsDialog
        open={isSettingsOpen}
        settings={settings}
        onChange={updateSettings}
        player={player}
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
  sequence,
  xf,
  settings,
  player,
}: {
  file: SelectedFile | null;
  sequence: PlaybackSequence | null;
  xf: XfData | null;
  settings: Settings;
  player: ReturnType<typeof useMidiPlayer>;
}) {
  const [activeTab, setActiveTab] = useState<InfoPanelTab>('leadSheet');
  const activeTick = useMemo(
    () => (sequence ? secondsToTick(player.positionSeconds, sequence) : null),
    [player.positionSeconds, sequence],
  );
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
  }, [sequence]);

  return (
    <>
      {xf && (
        <div className="viewer-chrome">
          <ViewTabs activeTab={activeTab} onChange={setActiveTab} />
        </div>
      )}
      {xf && (
        <InfoPanel
          file={file}
          data={xf}
          activeTab={activeTab}
          activeTick={activeTick}
          sequence={sequence}
          getPositionSeconds={player.getPositionSeconds}
          autoScrollLeadSheet={settings.autoScrollLeadSheet}
          autoScrollLyrics={settings.autoScrollLyrics}
        />
      )}
      {sequence && (
        <div className="player-dock" ref={dockRef}>
          <div className="player-dock-inner">
            <PlaybackPanel sequence={sequence} player={player} />
          </div>
        </div>
      )}
    </>
  );
}

const VIEW_TABS: ReadonlyArray<{
  id: InfoPanelTab;
  label: string;
}> = [
  { id: 'leadSheet', label: 'リードシート' },
  { id: 'lyrics', label: '歌詞' },
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

export default App;
