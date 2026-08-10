import { DelayLine } from './DelayLine';

interface Tap {
  delayMs: number;
  gainL: number;
  gainR: number;
}

// Asymmetric early reflection tap structure (based on physical room acoustics)
const EARLY_TAPS: Tap[] = [
  { delayMs: 4.3,  gainL: 0.84, gainR: 0.22 },
  { delayMs: 7.1,  gainL: 0.31, gainR: 0.78 },
  { delayMs: 11.8, gainL: 0.65, gainR: 0.35 },
  { delayMs: 15.4, gainL: 0.25, gainR: 0.62 },
  { delayMs: 21.2, gainL: 0.54, gainR: 0.48 },
  { delayMs: 27.6, gainL: 0.42, gainR: 0.51 },
  { delayMs: 34.1, gainL: 0.33, gainR: 0.29 },
  { delayMs: 42.8, gainL: 0.28, gainR: 0.36 },
  { delayMs: 51.5, gainL: 0.21, gainR: 0.24 },
  { delayMs: 63.0, gainL: 0.15, gainR: 0.18 },
];

export class EarlyReflectionEngine {
  private delayL: DelayLine = new DelayLine(9600);
  private delayR: DelayLine = new DelayLine(9600);

  public process(
    inputL: number,
    inputR: number,
    roomSizeScale: number,
    erLevel: number,
    sampleRate: number
  ): { erL: number; erR: number } {
    this.delayL.write(inputL);
    this.delayR.write(inputR);

    let outL = 0;
    let outR = 0;

    const scale = Math.max(0.2, roomSizeScale);

    for (let i = 0; i < EARLY_TAPS.length; i++) {
      const tap = EARLY_TAPS[i];
      const samples = Math.round((tap.delayMs * scale * sampleRate) / 1000);

      const sL = this.delayL.read(samples);
      const sR = this.delayR.read(samples);

      outL += sL * tap.gainL + sR * (tap.gainR * 0.5);
      outR += sR * tap.gainR + sL * (tap.gainL * 0.5);
    }

    const gain = erLevel * 0.35;
    return {
      erL: outL * gain,
      erR: outR * gain,
    };
  }

  public clear(): void {
    this.delayL.clear();
    this.delayR.clear();
  }
}
