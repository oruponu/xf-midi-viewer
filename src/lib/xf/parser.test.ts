import { describe, expect, test } from 'bun:test';
import type { SmfChunk, SmfFile, SmfTrack, TrackEvent } from '../smf/types.ts';
import {
  extractXf,
  parseVocalPartCue,
  parseXfInfoHeader,
  parseXfLyricsHeader,
  parseXfVersion,
} from './parser.ts';
import type { VocalPart } from './types.ts';

const u8 = (...values: number[]): Uint8Array => new Uint8Array(values);

const ascii = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

const concat = (...arrays: Uint8Array[]): Uint8Array => {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
};

const makeVersionData = (
  versionStr: string,
  s0: number,
  s1 = 0,
): Uint8Array => {
  if (versionStr.length !== 4) throw new Error('versionStr must be 4 chars');
  return u8(
    0x43,
    0x7b,
    0x00,
    versionStr.charCodeAt(0),
    versionStr.charCodeAt(1),
    versionStr.charCodeAt(2),
    versionStr.charCodeAt(3),
    s1,
    s0,
  );
};

const makeMeta = (metaType: number, data: Uint8Array): TrackEvent => ({
  deltaTime: 0,
  event: { kind: 'meta', metaType, data },
});

const emptyHeader = {
  format: 0,
  trackCount: 0,
  division: { kind: 'tpqn' as const, ticksPerQuarter: 480 },
};

const makeSmf = (
  tracks: SmfTrack[] = [],
  extraChunks: SmfChunk[] = [],
): SmfFile => ({
  header: { ...emptyHeader, trackCount: tracks.length },
  tracks,
  extraChunks,
});

describe('parseXfVersion', () => {
  test('parses XF02 with all flags off', () => {
    expect(parseXfVersion(makeVersionData('XF02', 0x00))).toEqual({
      versionString: 'XF02',
      flags: {
        hasInfoHeader: false,
        hasStyle: false,
        hasLyricMeta: false,
        hasKaraoke: false,
      },
    });
  });

  test('decodes all flag bits', () => {
    const v = parseXfVersion(makeVersionData('XF02', 0x1b));
    expect(v?.flags).toEqual({
      hasInfoHeader: true,
      hasStyle: true,
      hasLyricMeta: true,
      hasKaraoke: true,
    });
  });

  test.each([
    [0x01, 'hasInfoHeader'],
    [0x02, 'hasStyle'],
    [0x08, 'hasLyricMeta'],
    [0x10, 'hasKaraoke'],
  ])('flag bit 0x%s sets %s', (bits, flagName) => {
    const v = parseXfVersion(makeVersionData('XF02', bits));
    expect(v?.flags[flagName as keyof NonNullable<typeof v>['flags']]).toBe(
      true,
    );
  });

  test('returns null for too-short data', () => {
    expect(parseXfVersion(u8(0x43, 0x7b))).toBeNull();
  });

  test('returns null for non-Yamaha manufacturer', () => {
    expect(
      parseXfVersion(u8(0x41, 0x00, 0x00, 0x58, 0x46, 0x30, 0x32, 0x00, 0x00)),
    ).toBeNull();
  });

  test('returns null for non-XF subID', () => {
    expect(
      parseXfVersion(u8(0x43, 0x7b, 0x01, 0x58, 0x46, 0x30, 0x32, 0x00, 0x00)),
    ).toBeNull();
  });

  test('returns null for non-XF version string', () => {
    expect(
      parseXfVersion(u8(0x43, 0x7b, 0x00, 0x59, 0x59, 0x30, 0x32, 0x00, 0x00)),
    ).toBeNull();
  });
});

describe('parseXfInfoHeader - common (XFhd)', () => {
  test('parses full header from spec example', () => {
    const text =
      'XFhd:1994/09/28:JP:Pops:8Beat:65:f1:Taro Yamaha:Hanako Hamamatsu::Machiko Nakazawa:Jiro Toyo';
    const h = parseXfInfoHeader(ascii(text));
    expect(h).toEqual({
      kind: 'common',
      date: '1994/09/28',
      country: 'JP',
      category: 'Pops',
      beat: '8Beat',
      instrumentOnMelody: 65,
      vocalType: 'f1',
      composer: 'Taro Yamaha',
      lyricist: 'Hanako Hamamatsu',
      arranger: undefined,
      performer: 'Machiko Nakazawa',
      programmer: 'Jiro Toyo',
      keyword: undefined,
    });
  });

  test('empty fields become undefined', () => {
    const h = parseXfInfoHeader(ascii('XFhd:::::::::::'));
    expect(h?.kind).toBe('common');
    if (h?.kind === 'common') {
      expect(h.date).toBeUndefined();
      expect(h.composer).toBeUndefined();
      expect(h.keyword).toBeUndefined();
    }
  });

  test('accepts boundary instrument numbers (1, 128)', () => {
    const min = parseXfInfoHeader(ascii('XFhd:::::1:::::::'));
    const max = parseXfInfoHeader(ascii('XFhd:::::128:::::::'));
    expect(min?.kind === 'common' && min.instrumentOnMelody).toBe(1);
    expect(max?.kind === 'common' && max.instrumentOnMelody).toBe(128);
  });

  test('rejects out-of-range instrument number', () => {
    const h = parseXfInfoHeader(ascii('XFhd:::::129:::::::'));
    if (h?.kind === 'common') {
      expect(h.instrumentOnMelody).toBeUndefined();
    }
  });

  test('rejects non-numeric instrument', () => {
    const h = parseXfInfoHeader(ascii('XFhd:::::abc:::::::'));
    if (h?.kind === 'common') {
      expect(h.instrumentOnMelody).toBeUndefined();
    }
  });
});

describe('parseXfInfoHeader - language specific (XFln)', () => {
  test('parses ASCII XFln', () => {
    const h = parseXfInfoHeader(ascii('XFln:L1:Song:Composer:Lyricist::::'));
    expect(h).toEqual({
      kind: 'languageSpecific',
      language: 'L1',
      songName: 'Song',
      composer: 'Composer',
      lyricist: 'Lyricist',
      arranger: undefined,
      performer: undefined,
      programmer: undefined,
    });
  });

  test('decodes JP body as Shift-JIS', () => {
    const data = concat(ascii('XFln:JP:'), u8(0x8a, 0x79));
    const h = parseXfInfoHeader(data);
    expect(h?.kind).toBe('languageSpecific');
    if (h?.kind === 'languageSpecific') {
      expect(h.language).toBe('JP');
      expect(h.songName).toBe('楽');
    }
  });

  test('returns header with only language when no other fields', () => {
    const h = parseXfInfoHeader(ascii('XFln:JP'));
    expect(h?.kind).toBe('languageSpecific');
    if (h?.kind === 'languageSpecific') {
      expect(h.language).toBe('JP');
      expect(h.songName).toBeUndefined();
    }
  });
});

describe('parseXfInfoHeader - other', () => {
  test('returns null for non-XF text', () => {
    expect(parseXfInfoHeader(ascii('Hello, world'))).toBeNull();
  });

  test('returns null for empty input', () => {
    expect(parseXfInfoHeader(u8())).toBeNull();
  });
});

describe('extractXf', () => {
  test('extracts version from inline meta', () => {
    const smf = makeSmf([
      { events: [makeMeta(0x7f, makeVersionData('XF02', 0x1b))] },
    ]);
    expect(extractXf(smf).version?.versionString).toBe('XF02');
  });

  test('extracts inline common header', () => {
    const smf = makeSmf([
      { events: [makeMeta(0x01, ascii('XFhd:2026/01/01:::::::::::'))] },
    ]);
    expect(extractXf(smf).commonHeader?.date).toBe('2026/01/01');
  });

  test('XFIH chunk wins over inline for common header', () => {
    const inlineText = ascii('XFhd:from-inline:::::::::::');
    const xfihText = ascii('XFhd:from-xfih:::::::::::');
    const smf = makeSmf(
      [{ events: [makeMeta(0x01, inlineText)] }],
      [
        {
          type: 'XFIH',
          data: concat(u8(0x00, 0xff, 0x01, xfihText.length), xfihText),
        },
      ],
    );
    expect(extractXf(smf).commonHeader?.date).toBe('from-xfih');
  });

  test('collects multiple language headers', () => {
    const smf = makeSmf([
      {
        events: [
          makeMeta(0x01, ascii('XFln:L1:English Title:::::')),
          makeMeta(0x01, concat(ascii('XFln:JP:'), u8(0x8a, 0x79))),
        ],
      },
    ]);
    const xf = extractXf(smf);
    expect(xf.languageHeaders).toHaveLength(2);
    expect(xf.languageHeaders[0]?.language).toBe('L1');
    expect(xf.languageHeaders[1]?.language).toBe('JP');
    expect(xf.languageHeaders[1]?.songName).toBe('楽');
  });

  test('returns null version when no XF data present', () => {
    const xf = extractXf(makeSmf());
    expect(xf.version).toBeNull();
    expect(xf.commonHeader).toBeNull();
    expect(xf.languageHeaders).toEqual([]);
    expect(xf.karaoke).toEqual({ header: null, events: [] });
  });

  test('throws on non-meta status inside XFIH chunk', () => {
    const smf = makeSmf(
      [],
      [{ type: 'XFIH', data: u8(0x00, 0x90, 0x3c, 0x40) }],
    );
    expect(() => extractXf(smf)).toThrow(/unexpected status.*XFIH/);
  });
});

describe('parseXfLyricsHeader', () => {
  test('parses spec example with multiple channels', () => {
    expect(parseXfLyricsHeader('$Lyrc:4,12:240:JP')).toEqual({
      melodyChannels: [4, 12],
      displayOffset: 240,
      language: 'JP',
    });
  });

  test('parses single channel', () => {
    expect(parseXfLyricsHeader('$Lyrc:1:480:L1')).toEqual({
      melodyChannels: [1],
      displayOffset: 480,
      language: 'L1',
    });
  });

  test('empty language becomes undefined', () => {
    expect(parseXfLyricsHeader('$Lyrc:1:480:')?.language).toBeUndefined();
  });

  test('filters out-of-range and non-numeric channels', () => {
    expect(
      parseXfLyricsHeader('$Lyrc:0,1,17,abc,16:0:JP')?.melodyChannels,
    ).toEqual([1, 16]);
  });

  test('treats negative offset as 0', () => {
    expect(parseXfLyricsHeader('$Lyrc:1:-10:JP')?.displayOffset).toBe(0);
  });

  test('empty channels field yields empty array', () => {
    expect(parseXfLyricsHeader('$Lyrc::240:JP')?.melodyChannels).toEqual([]);
  });

  test('returns null for non-Lyrc text', () => {
    expect(parseXfLyricsHeader('&m')).toBeNull();
    expect(parseXfLyricsHeader('XFhd:...')).toBeNull();
    expect(parseXfLyricsHeader('')).toBeNull();
  });
});

describe('parseVocalPartCue', () => {
  test.each<[string, VocalPart]>([
    ['&m', 'male'],
    ['&f', 'female'],
    ['&c', 'chorus'],
    ['&s', 'solo'],
    ['&p', 'mixed'],
    ['&w', 'speech'],
    ['&x', 'nonLyric'],
  ])('%s -> %s', (input, expected) => {
    expect(parseVocalPartCue(input)).toBe(expected);
  });

  test.each(['&z', '&', '&mm', 'm', '', '$Lyrc:1:0:JP'])(
    'rejects %p',
    (input) => {
      expect(parseVocalPartCue(input)).toBeNull();
    },
  );
});

describe('extractXf - karaoke', () => {
  test('extracts $Lyrc header and lyrics with tick from inline track', () => {
    const smf = makeSmf([
      {
        events: [
          {
            deltaTime: 0,
            event: {
              kind: 'meta',
              metaType: 0x07,
              data: ascii('$Lyrc:1:240:L1'),
            },
          },
          {
            deltaTime: 96,
            event: { kind: 'meta', metaType: 0x05, data: ascii('Hello') },
          },
          {
            deltaTime: 96,
            event: { kind: 'meta', metaType: 0x05, data: ascii('World') },
          },
        ],
      },
    ]);
    const k = extractXf(smf).karaoke;
    expect(k.header).toEqual({
      melodyChannels: [1],
      displayOffset: 240,
      language: 'L1',
    });
    expect(k.events).toEqual([
      { kind: 'lyric', tick: 96, text: 'Hello' },
      { kind: 'lyric', tick: 192, text: 'World' },
    ]);
  });

  test('decodes lyrics using $Lyrc language (JP -> Shift-JIS)', () => {
    const smf = makeSmf([
      {
        events: [
          {
            deltaTime: 0,
            event: {
              kind: 'meta',
              metaType: 0x07,
              data: ascii('$Lyrc:1:0:JP'),
            },
          },
          {
            deltaTime: 0,
            event: { kind: 'meta', metaType: 0x05, data: u8(0x8a, 0x79) },
          },
        ],
      },
    ]);
    const k = extractXf(smf).karaoke;
    expect(k.events[0]).toEqual({ kind: 'lyric', tick: 0, text: '楽' });
  });

  test('identifies CR (FF 05 01 0D) and LF (FF 05 01 0A) as separate kinds', () => {
    const smf = makeSmf([
      {
        events: [
          {
            deltaTime: 0,
            event: { kind: 'meta', metaType: 0x05, data: u8(0x0d) },
          },
          {
            deltaTime: 0,
            event: { kind: 'meta', metaType: 0x05, data: u8(0x0a) },
          },
        ],
      },
    ]);
    const events = extractXf(smf).karaoke.events;
    expect(events[0]?.kind).toBe('carriageReturn');
    expect(events[1]?.kind).toBe('lineFeed');
  });

  test('extracts vocal part cues', () => {
    const smf = makeSmf([
      {
        events: [
          {
            deltaTime: 0,
            event: { kind: 'meta', metaType: 0x07, data: ascii('&f') },
          },
          {
            deltaTime: 480,
            event: { kind: 'meta', metaType: 0x07, data: ascii('&x') },
          },
        ],
      },
    ]);
    const events = extractXf(smf).karaoke.events;
    expect(events).toEqual([
      { kind: 'vocalPart', tick: 0, part: 'female' },
      { kind: 'vocalPart', tick: 480, part: 'nonLyric' },
    ]);
  });

  test('XFKM chunk wins over inline lyrics', () => {
    const xfkmEvents = concat(u8(0x00, 0xff, 0x05, 4), ascii('xfkm'));
    const smf = makeSmf(
      [
        {
          events: [
            {
              deltaTime: 0,
              event: { kind: 'meta', metaType: 0x05, data: ascii('inline') },
            },
          ],
        },
      ],
      [{ type: 'XFKM', data: xfkmEvents }],
    );
    const events = extractXf(smf).karaoke.events;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'lyric', text: 'xfkm' });
  });

  test('throws on non-meta status inside XFKM chunk', () => {
    const smf = makeSmf(
      [],
      [{ type: 'XFKM', data: u8(0x00, 0x90, 0x3c, 0x40) }],
    );
    expect(() => extractXf(smf)).toThrow(/unexpected status.*XFKM/);
  });
});
