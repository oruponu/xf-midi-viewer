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

export interface ChordRoot {
  note: 'reserved' | 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
  accidental: 'bbb' | 'bb' | 'b' | 'natural' | '#' | '##' | '###';
}

export interface ChordBass {
  root: ChordRoot;
  type: string;
}

export type RehearsalLetter =
  | 'Intro'
  | 'Ending'
  | 'Fill-in'
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M';

export type GuitarPart = 'guitar' | 'bass' | 'ukulele' | 'reserved';

export type FingeringContext =
  | 'keyboard'
  | 'guitar'
  | 'upStroke'
  | 'downStroke'
  | 'reserved';

export interface GuitarStringVoicing {
  fret: number;
  finger: number;
}

export type StyleMessage =
  | {
      kind: 'chord';
      tick: number;
      root: ChordRoot;
      type: string;
      bass: ChordBass | null;
    }
  | {
      kind: 'rehearsal';
      tick: number;
      letter: RehearsalLetter;
      variation: number;
    }
  | {
      kind: 'phraseMark';
      tick: number;
      hand: 'right' | 'left';
      channel: number | null;
      level: number;
    }
  | {
      kind: 'maxPhraseMark';
      tick: number;
      count: number;
    }
  | {
      kind: 'fingering';
      tick: number;
      channel: number;
      noteNumber: number;
      fingering: number;
      hand: 'right' | 'left';
      context: FingeringContext;
    }
  | {
      kind: 'guideTrack';
      tick: number;
      rightHandChannel: number | null;
      leftHandChannel: number | null;
    }
  | {
      kind: 'guitarInfo';
      tick: number;
      channel: number | null;
      part: GuitarPart;
      capo: number;
      stringNotes: number[];
    }
  | {
      kind: 'guitarVoicing';
      tick: number;
      channel: number | null;
      strings: GuitarStringVoicing[];
    };

export interface XfStyleData {
  events: StyleMessage[];
}

export interface XfData {
  version: XfVersion | null;
  commonHeader: XfInfoHeaderCommon | null;
  languageHeaders: XfInfoHeaderLanguageSpecific[];
  karaoke: XfKaraokeData;
  style: XfStyleData;
}
