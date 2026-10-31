import { useEffect, useMemo, useRef, useState } from 'react';
import type { Library, LibraryNotice } from '../hooks/useLibrary.ts';
import type { SongInfo } from '../lib/library/songInfo.ts';
import { filterSongs } from '../lib/library/songSearch.ts';
import { vocalTypeBadge } from '../lib/library/vocalType.ts';
import { CloseIcon } from './CloseIcon.tsx';
import { LibraryFolderButton } from './LibraryFolderButton.tsx';

const NOTICE_NAME_LIMIT = 3;

export function SongLibraryHead({ library }: { library: Library }) {
  return (
    <div className="song-library-head">
      <div className="song-library-title">
        <span className="song-library-folder">{library.folderName}</span>
        <span className="song-library-count">{library.songs.length} 曲</span>
      </div>
      {library.sourceKind === 'folder' && (
        <button
          type="button"
          className="icon-button"
          title="再読み込み"
          aria-label="再読み込み"
          onClick={() => library.refresh()}
        >
          <RefreshIcon />
        </button>
      )}
      {library.sourceKind === 'stored' && (
        <LibraryFolderButton library={library} mode="add" className="song-library-add">
          曲を追加
        </LibraryFolderButton>
      )}
    </div>
  );
}

export function SongLibrary({
  library,
  currentFileName,
  onSelect,
  showHead = true,
}: {
  library: Library;
  currentFileName: string | null;
  onSelect: (fileName: string) => void;
  showHead?: boolean;
}) {
  const [query, setQuery] = useState('');
  const songs = useMemo(() => filterSongs(library.songs, query), [library.songs, query]);
  const currentRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  return (
    <div className="song-library">
      <div className="song-library-top">
        {showHead && <SongLibraryHead library={library} />}
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            searchRef.current?.blur();
          }}
        >
          <input
            ref={searchRef}
            type="search"
            className="song-library-search"
            placeholder="曲名・歌手で検索"
            aria-label="曲名・歌手で検索"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
      </div>
      {library.progress && (
        <p className="muted song-library-progress">
          曲の情報を読み込み中（{library.progress.done} / {library.progress.total}）
        </p>
      )}
      {library.notice && (
        <section className="song-library-notice" role="status">
          <div className="song-library-notice-message">
            <NoticeMessage notice={library.notice} />
          </div>
          <button
            type="button"
            className="icon-button song-library-notice-close"
            title="閉じる"
            aria-label="閉じる"
            onClick={library.dismissNotice}
          >
            <CloseIcon />
          </button>
        </section>
      )}
      {songs.length > 0 ? (
        <ul className="song-library-list">
          {songs.map((song) => {
            const isCurrent = song.fileName === currentFileName;
            return (
              <li key={song.fileName}>
                <button
                  type="button"
                  className="song-library-song"
                  aria-current={isCurrent ? 'true' : undefined}
                  ref={isCurrent ? currentRef : undefined}
                  onClick={() => onSelect(song.fileName)}
                >
                  <span className="song-library-song-title">{song.title}</span>
                  <SongMeta song={song} />
                  <VocalBadge song={song} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        library.progress === null && (
          <p className="muted song-library-empty">見つかりませんでした</p>
        )
      )}
    </div>
  );
}

function SongMeta({ song }: { song: SongInfo }) {
  if (song.performer === undefined && song.year === undefined) return null;
  return (
    <span className="song-library-song-meta">
      {song.performer !== undefined && (
        <span className="song-library-song-performer">{song.performer}</span>
      )}
      {song.year !== undefined && <span>{song.year}</span>}
    </span>
  );
}

function VocalBadge({ song }: { song: SongInfo }) {
  const badge = vocalTypeBadge(song.vocalType);
  if (badge === null) return null;
  return (
    <span className={`song-library-vocal song-library-vocal--${badge.tone}`}>{badge.label}</span>
  );
}

function NoticeMessage({ notice }: { notice: LibraryNotice }) {
  switch (notice.kind) {
    case 'readFailed': {
      const names = notice.fileNames.slice(0, NOTICE_NAME_LIMIT).join('、');
      const more = notice.fileNames.length > NOTICE_NAME_LIMIT ? ' ほか' : '';
      return (
        <>
          読み込めなかった曲があります（{notice.fileNames.length} 曲）: {names}
          {more}
        </>
      );
    }
    case 'quotaExceeded':
      return <>保存できる容量が足りないため、取り込みを途中で止めました。</>;
    case 'missing':
      return <>「{notice.fileNames[0]}」が見つかりませんでした。一覧から外しました。</>;
    case 'noSongs':
      return <>選択したフォルダの直下に MIDI ファイルがありませんでした。</>;
  }
}

function RefreshIcon() {
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
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </svg>
  );
}
