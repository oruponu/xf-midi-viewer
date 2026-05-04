import { ByteReader } from './reader.ts';
import type {
  ChannelEvent,
  SmfChunk,
  SmfDivision,
  SmfEvent,
  SmfFile,
  SmfHeader,
  SmfTrack,
  TrackEvent,
} from './types.ts';

export function parseSmf(buffer: ArrayBuffer | Uint8Array): SmfFile {
  const r = new ByteReader(buffer);
  const header = parseHeader(r);
  const tracks: SmfTrack[] = [];
  const extraChunks: SmfChunk[] = [];

  while (!r.eof) {
    const type = r.readAscii(4);
    const length = r.readUint32();
    const data = r.readBytes(length);
    if (type === 'MTrk') {
      tracks.push(parseTrack(data));
    } else if (type === 'MThd') {
      throw new Error('multiple MThd chunks');
    } else {
      extraChunks.push({ type, data });
    }
  }

  return { header, tracks, extraChunks };
}

function parseHeader(r: ByteReader): SmfHeader {
  const type = r.readAscii(4);
  if (type !== 'MThd') {
    throw new Error(`expected MThd, got "${type}"`);
  }
  const length = r.readUint32();
  if (length < 6) {
    throw new Error(`MThd length too small: ${length}`);
  }
  const format = r.readUint16();
  const trackCount = r.readUint16();
  const divisionRaw = r.readUint16();
  if (length > 6) r.skip(length - 6);

  let division: SmfDivision;
  if ((divisionRaw & 0x8000) === 0) {
    division = { kind: 'tpqn', ticksPerQuarter: divisionRaw & 0x7fff };
  } else {
    const highByte = (divisionRaw >> 8) & 0xff;
    const signedHigh = highByte > 0x7f ? highByte - 0x100 : highByte;
    division = {
      kind: 'smpte',
      framesPerSecond: -signedHigh,
      ticksPerFrame: divisionRaw & 0xff,
    };
  }

  return { format, trackCount, division };
}

function parseTrack(bytes: Uint8Array): SmfTrack {
  const r = new ByteReader(bytes);
  const events: TrackEvent[] = [];
  let runningStatus = 0;

  while (!r.eof) {
    const deltaTime = r.readVarLen();
    const firstByte = r.readUint8();
    let status: number;

    if (firstByte < 0x80) {
      if (runningStatus === 0) {
        throw new Error(
          `running status with no prior status at offset ${r.position - 1}`,
        );
      }
      status = runningStatus;
      r.seek(r.position - 1);
    } else {
      status = firstByte;
      if (status >= 0x80 && status <= 0xef) {
        runningStatus = status;
      } else {
        runningStatus = 0;
      }
    }

    const event = parseEvent(r, status);
    events.push({ deltaTime, event });

    if (event.kind === 'meta' && event.metaType === 0x2f) {
      break;
    }
  }

  return { events };
}

function parseEvent(r: ByteReader, status: number): SmfEvent {
  if (status === 0xff) {
    const metaType = r.readUint8();
    const length = r.readVarLen();
    const data = r.readBytes(length);
    return { kind: 'meta', metaType, data };
  }
  if (status === 0xf0) {
    const length = r.readVarLen();
    const data = r.readBytes(length);
    return { kind: 'sysex', data };
  }
  if (status === 0xf7) {
    const length = r.readVarLen();
    const data = r.readBytes(length);
    return { kind: 'sysexEscape', data };
  }
  if (status >= 0x80 && status <= 0xef) {
    return parseChannelEvent(r, status);
  }
  throw new Error(
    `unsupported status byte: 0x${status.toString(16).padStart(2, '0')}`,
  );
}

function parseChannelEvent(r: ByteReader, status: number): ChannelEvent {
  const channel = status & 0x0f;
  const type = status & 0xf0;
  switch (type) {
    case 0x80: {
      const note = r.readUint8();
      const velocity = r.readUint8();
      return { kind: 'noteOff', channel, note, velocity };
    }
    case 0x90: {
      const note = r.readUint8();
      const velocity = r.readUint8();
      return { kind: 'noteOn', channel, note, velocity };
    }
    case 0xa0: {
      const note = r.readUint8();
      const pressure = r.readUint8();
      return { kind: 'polyAftertouch', channel, note, pressure };
    }
    case 0xb0: {
      const controller = r.readUint8();
      const value = r.readUint8();
      return { kind: 'controlChange', channel, controller, value };
    }
    case 0xc0: {
      const program = r.readUint8();
      return { kind: 'programChange', channel, program };
    }
    case 0xd0: {
      const pressure = r.readUint8();
      return { kind: 'channelAftertouch', channel, pressure };
    }
    case 0xe0: {
      const lsb = r.readUint8();
      const msb = r.readUint8();
      return { kind: 'pitchBend', channel, value: (msb << 7) | lsb };
    }
    default:
      throw new Error(`unknown channel event status: 0x${status.toString(16)}`);
  }
}
