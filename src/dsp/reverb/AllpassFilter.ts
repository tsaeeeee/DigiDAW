import { DelayLine } from './DelayLine';

/**
 * Modulated Allpass Filter
 * Y(z) = (-g + z^-D) / (1 - g * z^-D) * X(z)
 * Delay D can be dynamically modulated sample-by-sample.
 */
export class ModulatedAllpassFilter {
  private delayLine: DelayLine;
  private baseDelaySamples: number;
  private coefficient: number;

  constructor(maxDelaySamples: number, baseDelaySamples: number, coefficient: number) {
    this.delayLine = new DelayLine(maxDelaySamples);
    this.baseDelaySamples = baseDelaySamples;
    this.coefficient = coefficient;
  }

  public setBaseDelay(samples: number): void {
    this.baseDelaySamples = samples;
  }

  public setCoefficient(g: number): void {
    this.coefficient = g;
  }

  public process(input: number, modOffsetSamples: number = 0): number {
    const currentDelay = Math.max(1, this.baseDelaySamples + modOffsetSamples);
    const delayed = this.delayLine.read(currentDelay);
    const feedForward = -this.coefficient * input;
    const output = feedForward + delayed;
    const feedBack = input + output * this.coefficient;
    this.delayLine.write(feedBack);
    return output;
  }

  public clear(): void {
    this.delayLine.clear();
  }
}
