import { useState } from 'react';
import { createSongLoader, INITIAL_SONG_STATE } from '../lib/songLoader.ts';
import type { SongState } from '../lib/songLoader.ts';

export function useSongLoader(): {
  state: SongState;
  loadFile: (file: File, beforeSwap?: () => void) => Promise<void>;
} {
  const [state, setState] = useState<SongState>(INITIAL_SONG_STATE);
  const [loader] = useState(() => createSongLoader(setState));
  return { state, loadFile: loader.load };
}
