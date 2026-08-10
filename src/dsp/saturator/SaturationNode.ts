import * as Tone from 'tone';

/**
 * Analog Op-Amp Saturation & WaveShaping Module
 * Emulates console analog saturation using asymmetrical soft-clipping curves.
 */

export type SaturationMode = 'clean' | 'normal' | 'hot' | 'redline';

export interface SaturationOptions {
  inputGain?: number;       // dB (-20 to +20)
  saturationDrive?: number; // Drive control (0 to 10)
  saturationMode?: SaturationMode;
  outputGain?: number;      // dB (-12 to +12)
  oversample?: OverSampleType; // 'none' | '2x' | '4x'
}

/**
 * Generates an asymmetrical soft-clipping transfer curve for Web Audio API WaveShaperNode / Tone.WaveShaper.
 */
export function createSaturationCurve(
  drive: number = 1.0,
  asymmetry: number = 0.01,
  samples: number = 2048
): Float32Array {
  const curve = new Float32Array(samples);

  for (let i = 0; i < samples; ++i) {
    // Map array index to normalized signal level [-1, 1]
    const x = (i * 2) / (samples - 1) - 1;

    // Asymmetrical bias mimics transistor imbalance in analog console gain stages
    const biasedX = x + asymmetry;

    // Hyperbolic tangent (tanh) soft clipping
    let y = Math.tanh(biasedX * drive);

    // Subtract DC offset so silence yields exactly zero voltage
    const offset = Math.tanh(asymmetry * drive);
    y = y - offset;

    // Normalize bounds so output peak is controlled
    const maxVal = Math.tanh((1 + asymmetry) * drive) - offset;
    const minVal = Math.tanh((-1 + asymmetry) * drive) - offset;
    const maxBound = Math.max(Math.abs(maxVal), Math.abs(minVal));

    if (maxBound > 0) {
      curve[i] = Math.max(-1, Math.min(1, y / maxBound));
    } else {
      curve[i] = Math.max(-1, Math.min(1, y));
    }
  }

  return curve;
}

/**
 * Calculates drive multiplier and asymmetry parameters based on console settings.
 */
export function calculateSaturationParameters(
  inputGainDb: number = 0,
  saturationDrive: number = 0,
  mode: SaturationMode = 'normal'
): { driveAmt: number; asymmetry: number } {
  // Drive scales organically with input gain and drive control
  const totalDriveDb = (inputGainDb > 0 ? inputGainDb * 0.75 : 0) + (saturationDrive * 3);
  const baseDriveMultiplier = Math.pow(10, totalDriveDb / 20);

  let driveAmt = 1.0;
  let asymmetry = 0.01;

  switch (mode) {
    case 'clean':
      driveAmt = 1.0 + baseDriveMultiplier * 0.05;
      asymmetry = 0.005;
      break;
    case 'normal':
      driveAmt = 1.5 + baseDriveMultiplier * 0.5;
      asymmetry = 0.03;
      break;
    case 'hot':
      driveAmt = 2.5 + baseDriveMultiplier * 1.5;
      asymmetry = 0.08;
      break;
    case 'redline':
      driveAmt = 5.0 + baseDriveMultiplier * 4.0;
      asymmetry = 0.18;
      break;
  }

  return { driveAmt, asymmetry };
}

/**
 * Standalone Saturation Node wrapper for Tone.js audio graph.
 * Fully integrates Tone.Gain -> Tone.WaveShaper -> Tone.Gain for complete compatibility.
 */
export class SaturationNode {
  public waveshaper: Tone.WaveShaper;
  public inputNode: Tone.Gain;
  public outputNode: Tone.Gain;
  public input: Tone.Gain;  // Tone.js chaining compatibility
  public output: Tone.Gain; // Tone.js chaining compatibility

  constructor(ctxOrOptions?: any, options?: SaturationOptions) {
    let opts: SaturationOptions = {};
    if (ctxOrOptions && typeof ctxOrOptions === 'object') {
      if ('inputGain' in ctxOrOptions || 'saturationDrive' in ctxOrOptions || 'saturationMode' in ctxOrOptions || 'outputGain' in ctxOrOptions) {
        opts = ctxOrOptions;
      } else if (options) {
        opts = options;
      }
    }

    this.inputNode = new Tone.Gain(1);
    this.outputNode = new Tone.Gain(1);
    this.input = this.inputNode;
    this.output = this.outputNode;

    const { driveAmt, asymmetry } = calculateSaturationParameters(
      opts.inputGain ?? 0,
      opts.saturationDrive ?? 3.0,
      opts.saturationMode ?? 'normal'
    );

    const initialCurve = createSaturationCurve(driveAmt, asymmetry);
    this.waveshaper = new Tone.WaveShaper({
      curve: initialCurve,
    });
    if (opts.oversample) {
      this.waveshaper.oversample = opts.oversample;
    }

    // Connect Tone.Gain -> Tone.WaveShaper -> Tone.Gain
    Tone.connect(this.inputNode, this.waveshaper);
    Tone.connect(this.waveshaper, this.outputNode);

    this.update(opts);
  }

  /**
   * Update saturation parameters on the fly.
   */
  public update(options: SaturationOptions): void {
    const inputGain = options.inputGain ?? 0;
    const drive = options.saturationDrive ?? 3.0;
    const mode = options.saturationMode ?? 'normal';
    const outputGain = options.outputGain ?? 0;

    // Apply Input Gain (dB to linear)
    const inLinear = Math.pow(10, inputGain / 20);
    this.inputNode.gain.value = inLinear;

    // Apply Output Gain (dB to linear)
    const outLinear = Math.pow(10, outputGain / 20);
    this.outputNode.gain.value = outLinear;

    const { driveAmt, asymmetry } = calculateSaturationParameters(inputGain, drive, mode);
    this.waveshaper.curve = createSaturationCurve(driveAmt, asymmetry);
  }

  public connect(destination: any): any {
    return Tone.connect(this.outputNode, destination);
  }

  public disconnect(): void {
    try {
      this.inputNode.disconnect();
    } catch {
      // ignore
    }
    try {
      this.waveshaper.disconnect();
    } catch {
      // ignore
    }
    try {
      this.outputNode.disconnect();
    } catch {
      // ignore
    }
  }

  public dispose(): void {
    try {
      this.inputNode.dispose();
      this.waveshaper.dispose();
      this.outputNode.dispose();
    } catch {
      // ignore
    }
  }
}
