import type { SoundBankEntry } from './soundBank.ts';

export interface ProcessorFailureNotice {
  message: string;
  hint?: string;
}

export class ProcessorFailure {
  private failedWith: Error | null = null;
  private readonly rejecters = new Set<(error: Error) => void>();

  get error(): Error | null {
    return this.failedWith;
  }

  fail(error: Error): void {
    if (this.failedWith) return;
    this.failedWith = error;
    for (const reject of this.rejecters) reject(error);
    this.rejecters.clear();
  }

  // A crashed processor never answers pending messages.
  guard<T>(promise: Promise<T>): Promise<T> {
    if (this.failedWith) return Promise.reject(this.failedWith);
    return new Promise<T>((resolve, reject) => {
      this.rejecters.add(reject);
      promise.then(resolve, reject).finally(() => this.rejecters.delete(reject));
    });
  }
}

export function processorFailureNotice(
  reason: string,
  soundBank: SoundBankEntry,
): ProcessorFailureNotice {
  const message = reason ? `内蔵音源が停止しました: ${reason}` : '内蔵音源が停止しました';
  return soundBank.bundled
    ? { message }
    : {
        message,
        hint: '停止を繰り返す場合は設定から標準の SoundFont に戻すか、別の SoundFont を読み込んでください。',
      };
}
