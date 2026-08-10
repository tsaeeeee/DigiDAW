/**
 * Interpolated Fractional Delay Line
 * Uses ring buffer with linear interpolation for smooth pitch/length modulation.
 */
export class DelayLine {
  private buffer: Float32Array;
  private mask: number;
  private writePos: number = 0;

  constructor(maxDelaySamples: number) {
    // Allocate power-of-two size buffer for fast bitwise masking
    let size = 1024;
    while (size < maxDelaySamples + 16) {
      size <<= 1;
    }
    this.buffer = new Float32Array(size);
    this.mask = size - 1;
  }

  public write(sample: number): void {
    this.buffer[this.writePos] = sample;
    this.writePos = (this.writePos + 1) & this.mask;
  }

  public read(delaySamples: number): number {
    if (delaySamples < 0) delaySamples = 0;
    const readPos = this.writePos - delaySamples;
    const iReadPos = Math.floor(readPos);
    const frac = readPos - iReadPos;

    const idx0 = iReadPos & this.mask;
    const idx1 = (iReadPos + 1) & this.mask;

    const s0 = this.buffer[idx0];
    const s1 = this.buffer[idx1];

    return s0 + frac * (s1 - s0);
  }

  public readAt(index: number): number {
    return this.buffer[(this.writePos - 1 - index) & this.mask];
  }

  public clear(): void {
    this.buffer.fill(0);
    this.writePos = 0;
  }
}
