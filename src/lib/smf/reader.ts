export class ByteReader {
  private readonly view: DataView;
  private cursor = 0;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    if (buffer instanceof Uint8Array) {
      this.view = new DataView(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength,
      );
    } else {
      this.view = new DataView(buffer);
    }
  }

  get position(): number {
    return this.cursor;
  }

  get length(): number {
    return this.view.byteLength;
  }

  get remaining(): number {
    return this.length - this.cursor;
  }

  get eof(): boolean {
    return this.cursor >= this.length;
  }

  seek(pos: number): void {
    if (pos < 0 || pos > this.length) {
      throw new RangeError(
        `seek out of bounds: ${pos} (length=${this.length})`,
      );
    }
    this.cursor = pos;
  }

  skip(n: number): void {
    this.seek(this.cursor + n);
  }

  readUint8(): number {
    this.ensure(1);
    const v = this.view.getUint8(this.cursor);
    this.cursor += 1;
    return v;
  }

  readInt8(): number {
    this.ensure(1);
    const v = this.view.getInt8(this.cursor);
    this.cursor += 1;
    return v;
  }

  readUint16(): number {
    this.ensure(2);
    const v = this.view.getUint16(this.cursor, false);
    this.cursor += 2;
    return v;
  }

  readUint32(): number {
    this.ensure(4);
    const v = this.view.getUint32(this.cursor, false);
    this.cursor += 4;
    return v;
  }

  readBytes(n: number): Uint8Array {
    this.ensure(n);
    const start = this.view.byteOffset + this.cursor;
    const out = new Uint8Array(this.view.buffer, start, n).slice();
    this.cursor += n;
    return out;
  }

  readAscii(n: number): string {
    const bytes = this.readBytes(n);
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      s += String.fromCharCode(bytes[i]!);
    }
    return s;
  }

  readVarLen(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.readUint8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error(`VLQ exceeds 4 bytes at offset ${this.cursor - 4}`);
  }

  private ensure(n: number): void {
    if (this.cursor + n > this.length) {
      throw new RangeError(
        `read past end: need ${n} byte(s) at offset ${this.cursor}, but only ${this.remaining} remaining`,
      );
    }
  }
}
