export const MAX_PLAYBACK_ADVANCE_SECONDS = 1;

export function isPlaybackAdvance(previousSeconds: number, nextSeconds: number): boolean {
  const step = nextSeconds - previousSeconds;
  return step > 0 && step <= MAX_PLAYBACK_ADVANCE_SECONDS;
}
