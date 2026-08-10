/**
 * Multi-phase LFO Generator for smooth delay line chorus modulation
 */
export class LFO {
  private phase: number = 0;

  constructor(initialPhase: number = 0) {
    this.phase = initialPhase;
  }

  public process(rateHz: number, sampleRate: number): { sine: number; cos: number } {
    const phaseInc = (2.0 * Math.PI * rateHz) / sampleRate;
    this.phase += phaseInc;
    if (this.phase >= 2.0 * Math.PI) {
      this.phase -= 2.0 * Math.PI;
    }

    return {
      sine: Math.sin(this.phase),
      cos: Math.cos(this.phase),
    };
  }

  public setPhase(phase: number): void {
    this.phase = phase;
  }
}
