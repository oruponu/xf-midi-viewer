import { describe, expect, test } from 'bun:test';
import { createLatestGate } from './latest.ts';

describe('createLatestGate', () => {
  test('passes the result of the latest run', async () => {
    const gate = createLatestGate();

    expect(await gate.run(Promise.resolve('a.mid'))).toBe('a.mid');
  });

  test('drops a result that finishes after a newer run', async () => {
    const gate = createLatestGate();
    let resolveSlow!: (value: string) => void;
    const slow = gate.run(new Promise<string>((resolve) => (resolveSlow = resolve)));
    const fast = gate.run(Promise.resolve('b.mid'));

    expect(await fast).toBe('b.mid');
    resolveSlow('a.mid');
    expect(await slow).toBeNull();
  });

  test('drops a pending result after invalidate', async () => {
    const gate = createLatestGate();
    const pending = gate.run(Promise.resolve('a.mid'));
    gate.invalidate();

    expect(await pending).toBeNull();
  });

  test('passes the rejection of the latest run', async () => {
    const gate = createLatestGate();

    await expect(gate.run(Promise.reject(new Error('gone')))).rejects.toThrow('gone');
  });

  test('drops the rejection of a superseded run', async () => {
    const gate = createLatestGate();
    let rejectSlow!: (error: Error) => void;
    const slow = gate.run(new Promise<string>((_, reject) => (rejectSlow = reject)));
    gate.invalidate();
    rejectSlow(new Error('gone'));

    expect(await slow).toBeNull();
  });
});
