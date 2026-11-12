// Note numbers follow the XG drum kits (scripts/xg-soundfont/xgDrumKits.ts).

export const OPEN_HI_HAT = 46;

const UNKNOWN_KEY = 'b/4/x2';

// Drum set positions as in common band scores: kick in the first space, snare in the third,
// toms around it, hi-hats and cymbals as crosses from the top line up, pedal hi-hat below.
const DRUM_SET_KEYS: Record<number, string> = {
  33: 'f/4',
  35: 'f/4',
  36: 'f/4',
  44: 'd/4/x2',
  25: 'c/5',
  26: 'c/5',
  27: 'c/5',
  28: 'c/5',
  29: 'c/5',
  31: 'c/5',
  38: 'c/5',
  40: 'c/5',
  34: 'c/5/x2',
  37: 'c/5/x2',
  50: 'e/5',
  48: 'e/5',
  47: 'd/5',
  45: 'd/5',
  43: 'a/4',
  41: 'a/4',
  42: 'g/5/x2',
  46: 'g/5/x2',
  51: 'f/5/x2',
  53: 'f/5/x2',
  59: 'f/5/x2',
  49: 'a/5/x2',
  57: 'a/5/x2',
  55: 'b/5/x2',
  52: 'b/5/x2',
};

const FOOT_NOTES = new Set([33, 35, 36, 44]);

// No standard exists for these, so skins are plain heads and everything else is a cross.
const PERCUSSION_KEYS: Record<number, string> = {
  80: 'a/5/x2',
  81: 'a/5/x2',
  54: 'g/5/x2',
  69: 'f/5/x2',
  70: 'f/5/x2',
  82: 'f/5/x2',
  56: 'e/5/x2',
  67: 'e/5/x2',
  68: 'd/5/x2',
  75: 'd/5/x2',
  76: 'd/5/x2',
  77: 'c/5/x2',
  39: 'c/5/x2',
  19: 'c/5/x2',
  30: 'c/5/x2',
  32: 'c/5/x2',
  60: 'e/5',
  61: 'd/5',
  62: 'c/5',
  63: 'c/5',
  64: 'b/4',
  65: 'a/4',
  66: 'g/4',
  13: 'f/4',
  14: 'f/4',
};

const PERCUSSION_NAMES: Record<number, string> = {
  13: 'Surdo',
  14: 'Surdo',
  15: 'Hi Q',
  16: 'Whip',
  17: 'Scratch',
  18: 'Scratch',
  19: 'Snap',
  20: 'Click',
  21: 'Click',
  22: 'Bell',
  23: 'Click',
  24: 'Click',
  30: 'Castanet',
  32: 'Sticks',
  39: 'Clap',
  54: 'Tamb.',
  56: 'Cowbell',
  58: 'Vibraslap',
  60: 'Bongo',
  61: 'Bongo',
  62: 'Conga',
  63: 'Conga',
  64: 'Conga',
  65: 'Timbale',
  66: 'Timbale',
  67: 'Agogo',
  68: 'Agogo',
  69: 'Cabasa',
  70: 'Maracas',
  71: 'Whistle',
  72: 'Whistle',
  73: 'Guiro',
  74: 'Guiro',
  75: 'Claves',
  76: 'Wood Block',
  77: 'Wood Block',
  78: 'Cuica',
  79: 'Cuica',
  80: 'Triangle',
  81: 'Triangle',
  82: 'Shaker',
};

export function isDrumSetNote(note: number): boolean {
  return note in DRUM_SET_KEYS;
}

export function isFootNote(note: number): boolean {
  return FOOT_NOTES.has(note);
}

export function drumSetKey(note: number): string {
  return DRUM_SET_KEYS[note] ?? UNKNOWN_KEY;
}

export function percussionKey(note: number): string {
  return PERCUSSION_KEYS[note] ?? UNKNOWN_KEY;
}

export function percussionName(note: number): string {
  return PERCUSSION_NAMES[note] ?? `#${note}`;
}
