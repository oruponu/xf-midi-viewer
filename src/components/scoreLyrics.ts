import type { LyricSyllable } from '../lib/xf/lyrics.ts';

// Height of the lyric band and the room between syllables, in CSS pixels.
export const LYRIC_BAND_PX = 28;
export const LYRIC_GAP_PX = 2;

export function lyricElement(syllable: LyricSyllable): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'score-view-lyric';
  for (const run of syllable.runs) {
    const text = document.createElement('span');
    if (run.kind === 'text') {
      text.textContent = run.text;
      el.appendChild(text);
      continue;
    }
    text.textContent = run.base;
    const reading = document.createElement('rt');
    reading.textContent = run.reading;
    const ruby = document.createElement('ruby');
    ruby.append(text, reading);
    el.appendChild(ruby);
  }
  return el;
}

// Widths in CSS pixels of the elements as the page lays them out.
export function measureWidths(elements: readonly HTMLElement[]): number[] {
  if (elements.length === 0) return [];
  const box = document.createElement('div');
  box.style.cssText = 'position: absolute; top: 0; left: 0; visibility: hidden;';
  box.append(...elements);
  document.body.appendChild(box);
  const widths = elements.map((el) => el.getBoundingClientRect().width);
  box.remove();
  return widths;
}

export function measureLyrics(syllables: readonly LyricSyllable[]): number[] {
  return measureWidths(syllables.map(lyricElement));
}
