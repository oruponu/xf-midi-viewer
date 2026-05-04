export interface XfFlags {
  hasInfoHeader: boolean;
  hasStyle: boolean;
  hasLyricMeta: boolean;
  hasKaraoke: boolean;
}

export interface XfVersion {
  versionString: string;
  flags: XfFlags;
}

export interface XfInfoHeaderCommon {
  kind: 'common';
  date?: string;
  country?: string;
  category?: string;
  beat?: string;
  instrumentOnMelody?: number;
  vocalType?: string;
  composer?: string;
  lyricist?: string;
  arranger?: string;
  performer?: string;
  programmer?: string;
  keyword?: string;
}

export interface XfInfoHeaderLanguageSpecific {
  kind: 'languageSpecific';
  language: string;
  songName?: string;
  composer?: string;
  lyricist?: string;
  arranger?: string;
  performer?: string;
  programmer?: string;
}

export type XfInfoHeader = XfInfoHeaderCommon | XfInfoHeaderLanguageSpecific;

export interface XfLyricsHeader {
  melodyChannels: number[];
  displayOffset: number;
  language: string | undefined;
}

export type VocalPart =
  | 'male'
  | 'female'
  | 'chorus'
  | 'solo'
  | 'mixed'
  | 'speech'
  | 'nonLyric';

export type KaraokeEvent =
  | { kind: 'lyric'; tick: number; text: string }
  | { kind: 'carriageReturn'; tick: number }
  | { kind: 'lineFeed'; tick: number }
  | { kind: 'vocalPart'; tick: number; part: VocalPart };

export interface XfKaraokeData {
  header: XfLyricsHeader | null;
  events: KaraokeEvent[];
}

export interface XfData {
  version: XfVersion | null;
  commonHeader: XfInfoHeaderCommon | null;
  languageHeaders: XfInfoHeaderLanguageSpecific[];
  karaoke: XfKaraokeData;
}
