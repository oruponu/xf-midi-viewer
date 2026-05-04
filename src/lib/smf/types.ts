export type SmfDivision =
  | { kind: 'tpqn'; ticksPerQuarter: number }
  | { kind: 'smpte'; framesPerSecond: number; ticksPerFrame: number };

export interface SmfHeader {
  format: number;
  trackCount: number;
  division: SmfDivision;
}

export type ChannelEvent =
  | { kind: 'noteOff'; channel: number; note: number; velocity: number }
  | { kind: 'noteOn'; channel: number; note: number; velocity: number }
  | { kind: 'polyAftertouch'; channel: number; note: number; pressure: number }
  | {
      kind: 'controlChange';
      channel: number;
      controller: number;
      value: number;
    }
  | { kind: 'programChange'; channel: number; program: number }
  | { kind: 'channelAftertouch'; channel: number; pressure: number }
  | { kind: 'pitchBend'; channel: number; value: number };

export type SysExEvent =
  | { kind: 'sysex'; data: Uint8Array }
  | { kind: 'sysexEscape'; data: Uint8Array };

export interface MetaEvent {
  kind: 'meta';
  metaType: number;
  data: Uint8Array;
}

export type SmfEvent = ChannelEvent | SysExEvent | MetaEvent;

export interface TrackEvent {
  deltaTime: number;
  event: SmfEvent;
}

export interface SmfTrack {
  events: TrackEvent[];
}

export interface SmfChunk {
  type: string;
  data: Uint8Array;
}

export interface SmfFile {
  header: SmfHeader;
  tracks: SmfTrack[];
  extraChunks: SmfChunk[];
}
