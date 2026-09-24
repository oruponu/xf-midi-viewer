import { useState } from 'react';
import { createSongLoader } from '../lib/songLoader.ts';
import type { SongState } from '../lib/songLoader.ts';

export function useSongLoader(): {
  state: SongState;
  loadFile: (file: File) => Promise<void>;
} {
  const [state, setState] = useState<SongState>({ status: 'empty' });
  const [loader] = useState(() => createSongLoader(setState));
  return { state, loadFile: loader.load };
}
