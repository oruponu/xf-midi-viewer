import { expect, test } from 'bun:test';
import { renderMessages } from './render.ts';
import { drumTestMidi } from './testMidi.ts';

test('renderMessages throws before sf3DecoderReady() is awaited', () => {
  const midi = drumTestMidi([0], [36], [100]);
  expect(() => renderMessages(undefined as never, midi.messages, midi.endSeconds)).toThrow(
    'SF3 decoder is not ready; await sf3DecoderReady() first',
  );
});
