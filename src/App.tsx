import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import './App.css';
import { InfoPanel } from './components/InfoPanel.tsx';
import type { InfoPanelTab } from './components/InfoPanel.tsx';
import { PlaybackPanel } from './components/PlaybackPanel.tsx';
import { useMidiPlayer } from './hooks/useMidiPlayer.ts';
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
  const playbackSequence = useMemo(
    () => (smf ? buildPlaybackSequence(smf) : null),
    [smf],
  );

  const loadFile = async (f: File) => {
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
  };

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
  }, []);

  return (
    <main className={`app${isDragging ? ' app--dragging' : ''}`}>
      <header className="app-header">
        <h1>XF MIDI Viewer</h1>
        <p className="muted">
          YAMAHA XF フォーマットの MIDI ファイルを解析・表示します
        </p>
      </header>

      <section className="file-picker">
        <label className="file-input">
          <input
            type="file"
            accept=".mid,.midi,.kar,.xih,.xkm,audio/midi"
            onChange={onChange}
          />
          <span>MIDI ファイルを選択</span>
        </label>
      </section>

      {error && (
        <section className="error" role="alert">
          <strong>パースエラー:</strong> {error}
        </section>
      )}

      <PlayerScope
        key={file ? `${file.name}-${file.size}-${file.lastModified}` : 'empty'}
        file={file}
        sequence={playbackSequence}
        xf={xf}
      />
    </main>
  );
}

function PlayerScope({
  file,
  sequence,
  xf,
}: {
  file: SelectedFile | null;
  sequence: PlaybackSequence | null;
  xf: XfData | null;
}) {
  const [activeTab, setActiveTab] = useState<InfoPanelTab>('leadSheet');
  const player = useMidiPlayer(sequence);
  const activeTick = useMemo(
    () => (sequence ? secondsToTick(player.positionSeconds, sequence) : null),
    [player.positionSeconds, sequence],
  );
  return (
    <>
      {(sequence || xf) && (
        <div className="viewer-chrome">
          {sequence && <PlaybackPanel sequence={sequence} player={player} />}
          {xf && <ViewTabs activeTab={activeTab} onChange={setActiveTab} />}
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
