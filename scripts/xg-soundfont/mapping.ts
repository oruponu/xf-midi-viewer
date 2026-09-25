export interface SourceNote {
  readonly drum: boolean;
  readonly bankMSB: number;
  readonly program: number;
  readonly note: number;
}

export function gs(program: number, note: number): SourceNote {
  return { drum: true, bankMSB: 0, program, note };
}

export function voice(bankMSB: number, program: number, note = 60): SourceNote {
  return { drum: false, bankMSB, program, note };
}

export type Mapped =
  | { readonly name: string; readonly from: SourceNote }
  | { readonly name: string; readonly from: null; readonly reason: 'no-substitute' };

export interface XgKit {
  readonly bankMSB: 126 | 127;
  readonly program: number;
  readonly name: string;
  readonly base?: XgKit;
  readonly notes: Readonly<Record<number, Mapped>>;
}

export type XgSfxVoice = Mapped & { readonly program: number };

export function resolveKitNotes(kit: XgKit): Map<number, Mapped> {
  const notes = kit.base ? resolveKitNotes(kit.base) : new Map<number, Mapped>();
  for (const [note, mapped] of Object.entries(kit.notes)) notes.set(Number(note), mapped);
  return notes;
}

export function describeSource(source: SourceNote): string {
  return source.drum
    ? `GS ドラムキット ${source.program} のノート ${source.note}`
    : `音色 MSB ${source.bankMSB} / PC ${source.program} のノート ${source.note}`;
}
