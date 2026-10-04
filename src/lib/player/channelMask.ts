const CHANNEL_COUNT = 16;

export function isChannelAudible(muted: number, solo: number, channel: number): boolean {
  const bit = 1 << channel;
  return solo !== 0 ? (solo & bit) !== 0 : (muted & bit) === 0;
}

export function silencedChannels(
  muted: number,
  solo: number,
  nextMuted: number,
  nextSolo: number,
): number[] {
  const channels: number[] = [];
  for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
    if (isChannelAudible(muted, solo, channel) && !isChannelAudible(nextMuted, nextSolo, channel)) {
      channels.push(channel);
    }
  }
  return channels;
}
