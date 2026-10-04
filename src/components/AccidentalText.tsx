const ACCIDENTAL_SIGNS: Record<string, { sign: string; className: string }> = {
  '#': { sign: '♯', className: 'accidental-sharp' },
  b: { sign: '♭', className: 'accidental-flat' },
};

export function AccidentalText({ text }: { text: string }) {
  return text.split(/([#b])/).map((part, i) => {
    const accidental = ACCIDENTAL_SIGNS[part];
    if (!accidental) return part;
    return (
      <span key={i} className={accidental.className}>
        {accidental.sign}
      </span>
    );
  });
}
