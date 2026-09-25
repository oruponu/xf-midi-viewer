import { describe, expect, test } from 'bun:test';
import {
  BUNDLED_SOUND_BANK,
  nextSoundBankToLoad,
  saveFailureMessage,
  savedAfterAttempt,
} from './soundBank.ts';

const userA = { name: 'A.sf2', bundled: false };
const userB = { name: 'B.sf3', bundled: false };

describe('nextSoundBankToLoad', () => {
  test('uses the saved sound bank, or the bundled one when nothing is saved', () => {
    expect(nextSoundBankToLoad(userA)).toEqual(userA);
    expect(nextSoundBankToLoad(null)).toEqual(BUNDLED_SOUND_BANK);
  });
});

describe('savedAfterAttempt', () => {
  test('replaces the saved entry only when saving succeeded', () => {
    expect(savedAfterAttempt(userA, userB, true)).toEqual(userB);
    expect(savedAfterAttempt(userA, userB, false)).toEqual(userA);
    expect(savedAfterAttempt(null, userB, false)).toBeNull();
  });
});

describe('saveFailureMessage', () => {
  test('names the previously saved sound bank that will load next time', () => {
    const next = nextSoundBankToLoad(savedAfterAttempt(userA, userB, false));
    expect(saveFailureMessage(next)).toBe('保存できませんでした。次回は A.sf2 を読み込みます');
  });

  test('says the standard sound bank will load when nothing was saved before', () => {
    const next = nextSoundBankToLoad(savedAfterAttempt(null, userB, false));
    expect(saveFailureMessage(next)).toBe('保存できませんでした。次回は標準の音源を読み込みます');
  });
});
