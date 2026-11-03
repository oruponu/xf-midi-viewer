import { describe, expect, test } from 'bun:test';
import { isMidiFileName, topLevelMidiFiles } from './midiFiles.ts';

function fileAt(path: string): File {
  const file = new File([], path.split('/').at(-1)!);
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

describe('isMidiFileName', () => {
  test('accepts MIDI extensions in any case', () => {
    expect(['a.mid', 'b.MID', 'c.midi', 'd.kar', 'e.xih', 'f.xkm'].every(isMidiFileName)).toBe(
      true,
    );
    expect(isMidiFileName('desktop.ini')).toBe(false);
    expect(isMidiFileName('mid')).toBe(false);
  });
});

describe('topLevelMidiFiles', () => {
  test('keeps only MIDI files directly inside the chosen folder', () => {
    const files = [fileAt('Songs/a.mid'), fileAt('Songs/Zip/b.mid'), fileAt('Songs/desktop.ini')];

    expect(topLevelMidiFiles(files).map((f) => f.name)).toEqual(['a.mid']);
  });

  test('keeps files picked without a folder', () => {
    expect(topLevelMidiFiles([new File([], 'c.mid')]).map((f) => f.name)).toEqual(['c.mid']);
  });
});
