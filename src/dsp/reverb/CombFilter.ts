import { DelayLine } from './DelayLine';
import { OnePoleLP } from './Filters';

/**
 * Lowpass-Damped Comb Filter
 * Feedback loop includes a one-pole lowpass filter for high-frequency attenuation.
 */
export class DampedCombFilter {
  private delayLine: DelayLine;
  private lp: OnePoleLP = new OnePoleLP();
  private baseDelaySamples: number;
  private feedback: number = 0.5;

  constructor(maxDelaySamples: number, baseDelaySamples: number) {
    this.delayLine = new DelayLine(maxDelaySamples);
    this.baseDelaySamples = baseDelaySamples;
  }

  public setBaseDelay(samples: number): void {
    this.baseDelaySamples = samples;
  }

  public setFeedback(fb: number): void {
    this.feedback = fb;
  }

  public setDamping(dampHz: number, sampleRate: number): void {
    this.lp.setCutoff(dampHz, sampleRate);
  }

  public process(input: number, modOffsetSamples: number = 0): number {
    const currentDelay = Math.max(1, this.baseDelaySamples + modOffsetSamples);
    const delayed = this.delayLine.read(currentDelay);
    const damped = this.lp.process(delayed);
    this.delayLine.write(input + damped * this.feedback);
    return delayed;
  }

  public clear(): void {
    this.delayLine.clear();
    this.lp.clear();
  }
}
