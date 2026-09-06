import type { PlaybackMidiMessage } from '../smf/playback.ts';
import { isNoteMessage } from './messages.ts';

export function collectChaseMessages(
  messages: readonly PlaybackMidiMessage[],
  startIndex: number,
): PlaybackMidiMessage[] {
  const chase: PlaybackMidiMessage[] = [];
  for (let i = 0; i < startIndex; i += 1) {
    const message = messages[i]!;
    if (!isNoteMessage(message.data)) chase.push(message);
  }
  return chase;
}
