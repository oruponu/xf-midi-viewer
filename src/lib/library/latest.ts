export interface LatestGate {
  run<T>(task: Promise<T>): Promise<T | null>;
  invalidate(): void;
}

export function createLatestGate(): LatestGate {
  let latest = 0;
  return {
    async run<T>(task: Promise<T>): Promise<T | null> {
      latest += 1;
      const token = latest;
      try {
        const value = await task;
        return token === latest ? value : null;
      } catch (error) {
        if (token !== latest) return null;
        throw error;
      }
    },
    invalidate() {
      latest += 1;
    },
  };
}
