import { accidentalParts } from './accidentals.ts';
import { measureWidths } from './scoreLyrics.ts';

export const CHORD_BAND_PX = 20;
export const CHORD_GAP_PX = 6;

export function chordElement(label: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'score-view-chord';
  for (const part of accidentalParts(label)) {
    if (part.className === null) {
      el.append(part.text);
      continue;
    }
    const sign = document.createElement('span');
    sign.className = part.className;
    sign.textContent = part.text;
    el.appendChild(sign);
  }
  return el;
}

export function measureChords(labels: readonly string[]): number[] {
  return measureWidths(labels.map(chordElement));
}
