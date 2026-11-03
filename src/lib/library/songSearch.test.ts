import { describe, expect, test } from 'bun:test';
import { filterSongs, sortSongs } from './songSearch.ts';
import type { SongInfo } from './songInfo.ts';

const kaerimichi: SongInfo = {
  fileName: '帰り道の歌.mid',
  title: '帰り道の歌',
  titleReading: 'かえりみちのうた',
  performer: '星空楽団',
  performerReading: 'ほしぞらがくだん',
};
const blueSky: SongInfo = {
  fileName: 'BLUE SKY (live).mid',
  title: 'BLUE SKY',
  titleReading: 'ぶるーすかい',
  performer: 'Morning Glow',
  performerReading: 'もーにんぐぐろう',
};
const steps: SongInfo = {
  fileName: '365歩.MID',
  title: '365歩',
  titleReading: 'さんびゃくろくじゅうごほ',
  performer: 'TK',
};
const etude: SongInfo = { fileName: 'Etude.MID', title: 'Etude' };
const all = [kaerimichi, blueSky, steps, etude];

describe('filterSongs', () => {
  test('returns every song for an empty query', () => {
    expect(filterSongs(all, '  ')).toEqual(all);
  });

  test('matches readings in hiragana and katakana', () => {
    expect(filterSongs(all, 'ほしぞら')).toEqual([kaerimichi]);
    expect(filterSongs(all, 'ホシゾラ')).toEqual([kaerimichi]);
  });

  test('matches full-width and case-insensitive text', () => {
    expect(filterSongs(all, 'ｍｏｒｎｉｎｇ')).toEqual([blueSky]);
  });

  test('requires every space-separated term to match', () => {
    expect(filterSongs(all, 'morning blue')).toEqual([blueSky]);
    expect(filterSongs(all, 'morning 365')).toEqual([]);
  });

  test('matches the file name', () => {
    expect(filterSongs(all, 'live')).toEqual([blueSky]);
  });
});

describe('sortSongs', () => {
  test('orders by the title reading and falls back to the title', () => {
    expect(sortSongs(all).map((s) => s.title)).toEqual([
      'Etude',
      '帰り道の歌',
      '365歩',
      'BLUE SKY',
    ]);
  });
});
