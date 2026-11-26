import { accidentalParts } from './accidentals.ts';

export function AccidentalText({ text }: { text: string }) {
  return accidentalParts(text).map((part, i) =>
    part.className === null ? (
      part.text
    ) : (
      <span key={i} className={part.className}>
        {part.text}
      </span>
    ),
  );
}
