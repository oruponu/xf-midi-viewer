import type { SongInfo } from './songInfo.ts';

const collator = new Intl.Collator('ja');

export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '');
}

export function filterSongs(songs: readonly SongInfo[], query: string): SongInfo[] {
  const terms = query
    .normalize('NFKC')
    .split(/\s+/)
    .map(normalizeForSearch)
    .filter((term) => term !== '');
  if (terms.length === 0) return [...songs];
  return songs.filter((song) => {
    const fields = [
      song.title,
      song.titleReading,
      song.performer,
      song.performerReading,
      song.fileName,
    ]
      .filter((text) => text !== undefined)
      .map(normalizeForSearch);
    return terms.every((term) => fields.some((field) => field.includes(term)));
  });
}

export function sortSongs(songs: readonly SongInfo[]): SongInfo[] {
  return songs
    .map((song) => ({ song, key: normalizeForSearch(song.titleReading ?? song.title) }))
    .sort(
      (a, b) =>
        collator.compare(a.key, b.key) || collator.compare(a.song.fileName, b.song.fileName),
    )
    .map(({ song }) => song);
}
