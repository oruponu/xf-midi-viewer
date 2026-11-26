export interface AccidentalPart {
  text: string;
  // Class of a sign, null for plain text.
  className: string | null;
}

const ACCIDENTAL_SIGNS: Record<string, { sign: string; className: string }> = {
  '#': { sign: '♯', className: 'accidental-sharp' },
  b: { sign: '♭', className: 'accidental-flat' },
};

export function accidentalParts(text: string): AccidentalPart[] {
  return text.split(/([#b])/).flatMap((part): AccidentalPart[] => {
    if (part === '') return [];
    const accidental = ACCIDENTAL_SIGNS[part];
    return accidental
      ? [{ text: accidental.sign, className: accidental.className }]
      : [{ text: part, className: null }];
  });
}
