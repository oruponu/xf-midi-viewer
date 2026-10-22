import { describe, expect, test } from 'bun:test';
import { ProcessorFailure, processorFailureNotice } from './processorFailure.ts';

describe('ProcessorFailure', () => {
  test('guard() passes the result through while the processor is alive', async () => {
    const failure = new ProcessorFailure();
    await expect(failure.guard(Promise.resolve('loaded'))).resolves.toBe('loaded');
    await expect(failure.guard(Promise.reject(new Error('bad bank')))).rejects.toThrow('bad bank');
  });

  test('fail() rejects promises that are still pending', async () => {
    const failure = new ProcessorFailure();
    const pending = failure.guard(new Promise<void>(() => {}));
    failure.fail(new Error('crashed'));
    await expect(pending).rejects.toThrow('crashed');
  });

  test('guard() rejects at once after a failure', async () => {
    const failure = new ProcessorFailure();
    failure.fail(new Error('crashed'));
    await expect(failure.guard(Promise.resolve('loaded'))).rejects.toThrow('crashed');
  });

  test('keeps the first error', async () => {
    const failure = new ProcessorFailure();
    failure.fail(new Error('first'));
    failure.fail(new Error('second'));
    expect(failure.error?.message).toBe('first');
    await expect(failure.guard(Promise.resolve())).rejects.toThrow('first');
  });
});

describe('processorFailureNotice', () => {
  test('points to the settings when a user sound bank is in use', () => {
    expect(
      processorFailureNotice('Uncaught RangeError: Array buffer allocation failed', {
        name: 'A.sf3',
        bundled: false,
      }),
    ).toEqual({
      message: '内蔵音源が停止しました: Uncaught RangeError: Array buffer allocation failed',
      hint: '停止を繰り返す場合は設定から標準の SoundFont に戻すか、別の SoundFont を読み込んでください。',
    });
  });

  test('has no hint for the bundled sound bank', () => {
    expect(
      processorFailureNotice('Error: boom', { name: 'GeneralUser GS', bundled: true }),
    ).toEqual({ message: '内蔵音源が停止しました: Error: boom' });
  });

  test('omits an empty reason', () => {
    expect(processorFailureNotice('', { name: 'GeneralUser GS', bundled: true })).toEqual({
      message: '内蔵音源が停止しました',
    });
  });
});
