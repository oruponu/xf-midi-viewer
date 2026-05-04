import type { XfFlags, XfVersion } from './types.ts';

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
