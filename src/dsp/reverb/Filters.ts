/**
 * One-pole and Biquad Filter utilities for frequency-dependent damping and crossover
 */

export class OnePoleLP {
  private a0: number = 1.0;
  private b1: number = 0.0;
  private z1: number = 0.0;

  public setCutoff(cutoffHz: number, sampleRate: number): void {
    const fc = Math.min(0.49 * sampleRate, Math.max(10, cutoffHz));
    const x = Math.exp(-2.0 * Math.PI * fc / sampleRate);
    this.a0 = 1.0 - x;
    this.b1 = x;
  }

  public process(input: number): number {
    this.z1 = input * this.a0 + this.z1 * this.b1;
    return this.z1;
  }

  public clear(): void {
    this.z1 = 0;
  }
}

export class OnePoleHP {
  private a0: number = 1.0;
  private a1: number = -1.0;
  private b1: number = 0.0;
  private x1: number = 0.0;
  private y1: number = 0.0;

  public setCutoff(cutoffHz: number, sampleRate: number): void {
    const fc = Math.min(0.49 * sampleRate, Math.max(10, cutoffHz));
    const x = Math.exp(-2.0 * Math.PI * fc / sampleRate);
    this.a0 = (1.0 + x) / 2.0;
    this.a1 = -this.a0;
    this.b1 = x;
  }

  public process(input: number): number {
    const output = this.a0 * input + this.a1 * this.x1 + this.b1 * this.y1;
    this.x1 = input;
    this.y1 = output;
    return output;
  }

  public clear(): void {
    this.x1 = 0;
    this.y1 = 0;
  }
}

/**
 * Crossover Filter Splitter
 * Splits audio into low-frequency and high-frequency bands for Bass Multiplier processing.
 */
export class CrossoverFilter {
  private lp: OnePoleLP = new OnePoleLP();

  public setCrossover(frequencyHz: number, sampleRate: number): void {
    this.lp.setCutoff(frequencyHz, sampleRate);
  }

  public process(input: number, bassMultiplier: number): { low: number; high: number; sum: number } {
    const low = this.lp.process(input);
    const high = input - low;
    const scaledLow = low * bassMultiplier;
    return { low: scaledLow, high, sum: scaledLow + high };
  }

  public clear(): void {
    this.lp.clear();
  }
}

/**
 * Biquad Filter (Lowpass / Highpass) for High Cut and Low Cut input filters
 */
export class BiquadFilter {
  private b0: number = 1;
  private b1: number = 0;
  private b2: number = 0;
  private a1: number = 0;
  private a2: number = 0;

  private x1: number = 0;
  private x2: number = 0;
  private y1: number = 0;
  private y2: number = 0;

  public setLowpass(cutoffHz: number, sampleRate: number, q: number = 0.707): void {
    const fc = Math.min(0.49 * sampleRate, Math.max(20, cutoffHz));
    const omega = 2 * Math.PI * fc / sampleRate;
    const sin = Math.sin(omega);
    const cos = Math.cos(omega);
    const alpha = sin / (2 * q);

    const b0 = (1 - cos) / 2;
    const b1 = 1 - cos;
    const b2 = (1 - cos) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cos;
    const a2 = 1 - alpha;

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  public setHighpass(cutoffHz: number, sampleRate: number, q: number = 0.707): void {
    const fc = Math.min(0.49 * sampleRate, Math.max(10, cutoffHz));
    const omega = 2 * Math.PI * fc / sampleRate;
    const sin = Math.sin(omega);
    const cos = Math.cos(omega);
    const alpha = sin / (2 * q);

    const b0 = (1 + cos) / 2;
    const b1 = -(1 + cos);
    const b2 = (1 + cos) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cos;
    const a2 = 1 - alpha;

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  public process(input: number): number {
    const output = this.b0 * input + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = input;
    this.y2 = this.y1;
    this.y1 = output;
    return output;
  }

  public clear(): void {
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }
}
