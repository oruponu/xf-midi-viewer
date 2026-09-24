import { buildPlaybackSequence } from './smf/playback.ts';
import type { PlaybackSequence } from './smf/playback.ts';
import { extractTiming } from './smf/timing.ts';
import type { SmfTiming } from './smf/timing.ts';
import type { SmfFile } from './smf/types.ts';
import { buildKaraokePages } from './xf/karaokePages.ts';
import type { KaraokePage } from './xf/karaokePages.ts';
import { parseKaraoke } from './xf/lyrics.ts';
import type { ParsedKaraoke } from './xf/lyrics.ts';
import { extractXf } from './xf/parser.ts';
import type { ChordMessage, RehearsalMessage, XfData } from './xf/types.ts';

export interface Song {
  sequence: PlaybackSequence;
  timing: SmfTiming;
  xf: XfData;
  xfError: string | null;
  karaoke: ParsedKaraoke;
  chords: ChordMessage[];
  rehearsals: RehearsalMessage[];
  karaokePages: KaraokePage[];
}

export function buildSong(smf: SmfFile): Song {
  const { xf, xfError } = extractXfOrEmpty(smf);
  const karaoke = parseKaraoke(xf.karaoke);
  const chords: ChordMessage[] = [];
  const rehearsals: RehearsalMessage[] = [];
  for (const event of xf.style.events) {
    if (event.kind === 'chord') chords.push(event);
    else if (event.kind === 'rehearsal') rehearsals.push(event);
  }
  return {
    sequence: buildPlaybackSequence(smf),
    timing: extractTiming(smf),
    xf,
    xfError,
    karaoke,
    chords,
    rehearsals,
    karaokePages: buildKaraokePages(karaoke),
  };
}

function extractXfOrEmpty(smf: SmfFile): { xf: XfData; xfError: string | null } {
  try {
    return { xf: extractXf(smf), xfError: null };
  } catch (error) {
    return {
      xf: {
        version: null,
        commonHeader: null,
        languageHeaders: [],
        karaoke: { header: null, events: [] },
        style: { events: [] },
      },
      xfError: error instanceof Error ? error.message : String(error),
    };
  }
}
