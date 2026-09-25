export interface SoundBankEntry {
  name: string;
  bundled: boolean;
}

export const BUNDLED_SOUND_BANK: SoundBankEntry = { name: 'GeneralUser GS', bundled: true };

export const SAVED_LOAD_FAILURE_MESSAGE =
  '保存した SoundFont を読み込めなかったため、標準の音源に戻しました';

export const DELETE_FAILURE_MESSAGE =
  '保存した SoundFont を削除できませんでした。次回も読み込まれます';

export function nextSoundBankToLoad(saved: SoundBankEntry | null): SoundBankEntry {
  return saved ?? BUNDLED_SOUND_BANK;
}

export function savedAfterAttempt(
  previous: SoundBankEntry | null,
  attempted: SoundBankEntry,
  succeeded: boolean,
): SoundBankEntry | null {
  return succeeded ? attempted : previous;
}

export function saveFailureMessage(next: SoundBankEntry): string {
  return next.bundled
    ? '保存できませんでした。次回は標準の音源を読み込みます'
    : `保存できませんでした。次回は ${next.name} を読み込みます`;
}
