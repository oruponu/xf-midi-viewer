import { ByteReader } from '../smf/reader.ts';
import type { SmfFile, SmfTrack } from '../smf/types.ts';
import { decodeLatin1, decodeXfText } from './decode.ts';
import type {
  KaraokeEvent,
  VocalPart,
  XfData,
  XfFlags,
  XfInfoHeader,
  XfInfoHeaderCommon,
  XfInfoHeaderLanguageSpecific,
  XfKaraokeData,
  XfLyricsHeader,
  XfVersion,
} from './types.ts';

const YAMAHA_ID_HIGH = 0x43;
const YAMAHA_ID_LOW = 0x7b;
const XF_SUBID = 0x00;

export function parseXfVersion(metaData: Uint8Array): XfVersion | null {
  if (metaData.length < 9) return null;
  if (metaData[0] !== YAMAHA_ID_HIGH || metaData[1] !== YAMAHA_ID_LOW)
    return null;
  if (metaData[2] !== XF_SUBID) return null;

  const versionString = String.fromCharCode(
    metaData[3]!,
    metaData[4]!,
    metaData[5]!,
    metaData[6]!,
  );
  if (!versionString.startsWith('XF')) return null;

  const s0 = metaData[8]!;
  const flags: XfFlags = {
    hasInfoHeader: (s0 & 0x01) !== 0,
    hasStyle: (s0 & 0x02) !== 0,
    hasLyricMeta: (s0 & 0x08) !== 0,
    hasKaraoke: (s0 & 0x10) !== 0,
  };

  return { versionString, flags };
}

export function parseXfInfoHeader(data: Uint8Array): XfInfoHeader | null {
  const ascii = decodeLatin1(data);

  if (ascii.startsWith('XFhd:')) {
    return parseCommonHeader(ascii.slice(5));
  }
  if (ascii.startsWith('XFln:')) {
    return parseLanguageSpecificHeader(data, ascii);
  }
  return null;
}

function fieldOrUndefined(fields: string[], i: number): string | undefined {
  const v = fields[i];
  return v === undefined || v === '' ? undefined : v;
}

function parseCommonHeader(rest: string): XfInfoHeaderCommon {
  const fields = rest.split(':');
  const f = (i: number): string | undefined => fieldOrUndefined(fields, i);

  let instrumentOnMelody: number | undefined;
  const instStr = f(4);
  if (instStr !== undefined) {
    const n = Number(instStr);
    if (Number.isFinite(n) && n >= 1 && n <= 128) {
      instrumentOnMelody = n;
    }
  }

  return {
    kind: 'common',
    date: f(0),
    country: f(1),
    category: f(2),
    beat: f(3),
    instrumentOnMelody,
    vocalType: f(5),
    composer: f(6),
    lyricist: f(7),
    arranger: f(8),
    performer: f(9),
    programmer: f(10),
    keyword: f(11),
  };
}

function parseLanguageSpecificHeader(
  data: Uint8Array,
  ascii: string,
): XfInfoHeaderLanguageSpecific {
  const afterPrefix = ascii.slice(5);
  const langEnd = afterPrefix.indexOf(':');

  let language: string;
  let restBytes: Uint8Array;
  if (langEnd === -1) {
    language = afterPrefix;
    restBytes = new Uint8Array(0);
  } else {
    language = afterPrefix.slice(0, langEnd);
    const restStart = 5 + langEnd + 1;
    restBytes = data.slice(restStart);
  }

  const restText = decodeXfText(restBytes, language);
  const fields = restText.split(':');
  const f = (i: number): string | undefined => fieldOrUndefined(fields, i);

  return {
    kind: 'languageSpecific',
    language,
    songName: f(0),
    composer: f(1),
    lyricist: f(2),
    arranger: f(3),
    performer: f(4),
    programmer: f(5),
  };
}

export function extractXf(smf: SmfFile): XfData {
  let version: XfVersion | null = null;
  let commonHeader: XfInfoHeaderCommon | null = null;
  const languageHeaders: XfInfoHeaderLanguageSpecific[] = [];

  const addHeader = (h: XfInfoHeader): void => {
    if (h.kind === 'common') {
      if (commonHeader === null) commonHeader = h;
    } else {
      languageHeaders.push(h);
    }
  };

  for (const chunk of smf.extraChunks) {
    if (chunk.type !== 'XFIH') continue;
    for (const h of parseXfihChunk(chunk.data)) {
      addHeader(h);
    }
  }

  for (const track of smf.tracks) {
    for (const tev of track.events) {
      const ev = tev.event;
      if (ev.kind !== 'meta') continue;
      if (ev.metaType === 0x7f && version === null) {
        version = parseXfVersion(ev.data);
      } else if (ev.metaType === 0x01) {
        const h = parseXfInfoHeader(ev.data);
        if (h) addHeader(h);
      }
    }
  }

  return {
    version,
    commonHeader,
    languageHeaders,
    karaoke: extractKaraoke(smf),
  };
}

const VOCAL_PART_MAP: Record<string, VocalPart> = {
  m: 'male',
  f: 'female',
  c: 'chorus',
  s: 'solo',
  p: 'mixed',
  w: 'speech',
  x: 'nonLyric',
};

export function parseXfLyricsHeader(text: string): XfLyricsHeader | null {
  if (!text.startsWith('$Lyrc:')) return null;
  const fields = text.slice(6).split(':');

  const channelsField = fields[0] ?? '';
  const melodyChannels: number[] = [];
  if (channelsField !== '') {
    for (const s of channelsField.split(',')) {
      const n = Number.parseInt(s, 10);
      if (Number.isFinite(n) && n >= 1 && n <= 16) {
        melodyChannels.push(n);
      }
    }
  }

  let displayOffset = 0;
  const offsetField = fields[1] ?? '';
  if (offsetField !== '') {
    const n = Number.parseInt(offsetField, 10);
    if (Number.isFinite(n) && n >= 0) {
      displayOffset = n;
    }
  }

  const language = fields[2] !== undefined && fields[2] !== ''
    ? fields[2]
    : undefined;

  return { melodyChannels, displayOffset, language };
}

export function parseVocalPartCue(text: string): VocalPart | null {
  if (text.length !== 2 || !text.startsWith('&')) return null;
  return VOCAL_PART_MAP[text.charAt(1)] ?? null;
}

type RawMetaAtTick = {
  tick: number;
  metaType: number;
  data: Uint8Array;
};

function metasFromTrack(track: SmfTrack): RawMetaAtTick[] {
  const out: RawMetaAtTick[] = [];
  let tick = 0;
  for (const tev of track.events) {
    tick += tev.deltaTime;
    const ev = tev.event;
    if (ev.kind === 'meta') {
      out.push({ tick, metaType: ev.metaType, data: ev.data });
    }
  }
  return out;
}

function metasFromXfkmChunk(data: Uint8Array): RawMetaAtTick[] {
  const r = new ByteReader(data);
  const out: RawMetaAtTick[] = [];
  let tick = 0;
  while (!r.eof) {
    tick += r.readVarLen();
    const status = r.readUint8();
    if (status !== 0xff) {
      throw new Error(
        `unexpected status 0x${status.toString(16).padStart(2, '0')} in XFKM chunk`,
      );
    }
    const metaType = r.readUint8();
    const len = r.readVarLen();
    out.push({ tick, metaType, data: r.readBytes(len) });
  }
  return out;
}

function buildKaraoke(metas: RawMetaAtTick[]): XfKaraokeData {
  let header: XfLyricsHeader | null = null;
  for (const m of metas) {
    if (m.metaType !== 0x07) continue;
    const hdr = parseXfLyricsHeader(decodeLatin1(m.data));
    if (hdr) {
      header = hdr;
      break;
    }
  }

  const language = header?.language;
  const events: KaraokeEvent[] = [];

  for (const m of metas) {
    if (m.metaType === 0x07) {
      const text = decodeLatin1(m.data);
      if (parseXfLyricsHeader(text) !== null) continue;
      const part = parseVocalPartCue(text);
      if (part !== null) {
        events.push({ kind: 'vocalPart', tick: m.tick, part });
      }
    } else if (m.metaType === 0x05) {
      if (m.data.length === 1 && m.data[0] === 0x0d) {
        events.push({ kind: 'carriageReturn', tick: m.tick });
      } else if (m.data.length === 1 && m.data[0] === 0x0a) {
        events.push({ kind: 'lineFeed', tick: m.tick });
      } else {
        const text = decodeXfText(m.data, language);
        events.push({ kind: 'lyric', tick: m.tick, text });
      }
    }
  }

  return { header, events };
}

function extractKaraoke(smf: SmfFile): XfKaraokeData {
  for (const chunk of smf.extraChunks) {
    if (chunk.type !== 'XFKM') continue;
    const k = buildKaraoke(metasFromXfkmChunk(chunk.data));
    if (k.events.length > 0 || k.header !== null) {
      return k;
    }
  }

  for (const track of smf.tracks) {
    const k = buildKaraoke(metasFromTrack(track));
    if (k.events.length > 0 || k.header !== null) {
      return k;
    }
  }

  return { header: null, events: [] };
}

function parseXfihChunk(data: Uint8Array): XfInfoHeader[] {
  const r = new ByteReader(data);
  const headers: XfInfoHeader[] = [];
  while (!r.eof) {
    r.readVarLen();
    const status = r.readUint8();
    if (status !== 0xff) {
      throw new Error(
        `unexpected status 0x${status.toString(16).padStart(2, '0')} in XFIH chunk`,
      );
    }
    const metaType = r.readUint8();
    const length = r.readVarLen();
    const textBytes = r.readBytes(length);
    if (metaType === 0x01) {
      const h = parseXfInfoHeader(textBytes);
      if (h) headers.push(h);
    }
  }
  return headers;
}
