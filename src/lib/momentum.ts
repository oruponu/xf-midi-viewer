export interface MotionSample {
  t: number;
  x: number;
  y: number;
}

export const SAMPLE_WINDOW_MS = 100;
const REST_MS = 50;
export const MOMENTUM_TIME_CONSTANT_MS = 325;

export function releaseVelocity(
  samples: readonly MotionSample[],
  now: number,
): { vx: number; vy: number } {
  const last = samples.at(-1);
  if (!last || now - last.t > REST_MS) return { vx: 0, vy: 0 };
  const first = samples.find((s) => last.t - s.t <= SAMPLE_WINDOW_MS) ?? last;
  const dt = last.t - first.t;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

export function momentumOffset(velocity: number, elapsedMs: number): number {
  return (
    velocity * MOMENTUM_TIME_CONSTANT_MS * (1 - Math.exp(-elapsedMs / MOMENTUM_TIME_CONSTANT_MS))
  );
}

export function momentumSpeed(velocity: number, elapsedMs: number): number {
  return velocity * Math.exp(-elapsedMs / MOMENTUM_TIME_CONSTANT_MS);
}
