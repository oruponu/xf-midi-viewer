import { describe, expect, test } from 'bun:test';
import { accidentalParts } from './accidentals.ts';

describe('accidentalParts', () => {
  test('keeps text without accidentals whole', () => {
    expect(accidentalParts('Am7')).toEqual([{ text: 'Am7', className: null }]);
  });

  test('replaces # and b with their signs', () => {
    expect(accidentalParts('F#m7(b5)')).toEqual([
      { text: 'F', className: null },
      { text: '♯', className: 'accidental-sharp' },
      { text: 'm7(', className: null },
      { text: '♭', className: 'accidental-flat' },
      { text: '5)', className: null },
    ]);
  });

  test('leaves out empty text between adjacent signs', () => {
    expect(accidentalParts('Bbb')).toEqual([
      { text: 'B', className: null },
      { text: '♭', className: 'accidental-flat' },
      { text: '♭', className: 'accidental-flat' },
    ]);
  });
});
