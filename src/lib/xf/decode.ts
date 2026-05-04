const ENCODING_MAP: Record<string, string> = {
  L1: 'iso-8859-1',
  JP: 'shift_jis',
  B5: 'big5',
  CY: 'koi8-r',
};

const LATIN1 = 'iso-8859-1';

function makeDecoder(label: string): TextDecoder {
  return new TextDecoder(label as 'utf-8');
}

export function decodeLatin1(bytes: Uint8Array): string {
  return makeDecoder(LATIN1).decode(bytes);
}

export function decodeXfText(
  bytes: Uint8Array,
  language: string | undefined,
): string {
  const encoding = (language && ENCODING_MAP[language]) ?? LATIN1;
  try {
    return makeDecoder(encoding).decode(bytes);
  } catch {
    return decodeLatin1(bytes);
  }
}
