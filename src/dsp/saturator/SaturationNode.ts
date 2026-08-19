import * as Tone from 'tone';

export type SaturationMode = 'clean' | 'normal' | 'hot' | 'redline';

export interface SaturationOptions {
  inputGain?: number;
  saturationDrive?: number;
  saturationMode?: SaturationMode;
  outputGain?: number;
  oversample?: OverSampleType;
}

/**
 * Generates an asymmetrical soft-clipping transfer curve.
 *
 * Keep a little level compression in the curve instead of fully normalising
 * every drive setting back to unity. The old full normalisation made strong
 * drive settings sound much subtler than the UI suggested.
 */
export function createSaturationCurve(
  drive: number = 1,
  asymmetry: number = 0.01,
  samples: number = 4096,
): Float32Array {
  const curve = new Float32Array(samples);
  const safeDrive = Math.max(0.05, Math.min(40, drive));
  const bias = Math.max(-0.35, Math.min(0.35, asymmetry));
  const dcOffset = Math.tanh(bias * safeDrive);

  const reference = Math.max(0.35, Math.tanh(safeDrive * 0.72));

  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1;
    const shaped = Math.tanh((x + bias) * safeDrive) - dcOffset;
    curve[i] = Math.max(-1, Math.min(1, shaped / reference));
  }

  return curve;
}

export function calculateSaturationParameters(
  inputGainDb: number = 0,
  saturationDrive: number = 0,
  mode: SaturationMode = 'normal',
): { driveAmt: number; asymmetry: number } {
  const driveKnob = Math.max(0, Math.min(10, saturationDrive));
  const positiveInput = Math.max(0, inputGainDb);

  // Input gain already exists as a real gain stage, so only a small portion of
  // it should influence the non-linearity itself. This avoids effectively
  // applying input gain twice while preserving console-style push behaviour.
  const inputInfluence = Math.pow(10, (positiveInput * 0.2) / 20);
  const knobInfluence = 1 + Math.pow(driveKnob / 10, 1.35) * 7;

  let modeDrive = 1;
  let asymmetry = 0.01;

  switch (mode) {
    case 'clean':
      modeDrive = 0.75;
      asymmetry = 0.004;
      break;
    case 'normal':
      modeDrive = 1.25;
      asymmetry = 0.025;
      break;
    case 'hot':
      modeDrive = 2.1;
      asymmetry = 0.065;
      break;
    case 'redline':
      modeDrive = 3.6;
      asymmetry = 0.14;
      break;
  }

  return {
    driveAmt: Math.max(0.2, Math.min(40, modeDrive * knobInfluence * inputInfluence)),
    asymmetry,
  };
}

/**
 * Tone.js-compatible saturation wrapper.
 * Audio path: input gain -> oversampled waveshaper -> output gain.
 */
export class SaturationNode extends Tone.ToneAudioNode<any> {
  readonly name = 'SaturationNode';

  public waveshaper: Tone.WaveShaper;
  public readonly inputNode: Tone.Gain;
  public readonly outputNode: Tone.Gain;
  public readonly input: Tone.Gain;
  public readonly output: Tone.Gain;

  private currentOptions: SaturationOptions = {};

  constructor(ctxOrOptions?: any, options?: SaturationOptions) {
    super();

    let opts: SaturationOptions = {};
    if (ctxOrOptions && typeof ctxOrOptions === 'object') {
      if (
        'inputGain' in ctxOrOptions ||
        'saturationDrive' in ctxOrOptions ||
        'saturationMode' in ctxOrOptions ||
        'outputGain' in ctxOrOptions ||
        'oversample' in ctxOrOptions
      ) {
        opts = ctxOrOptions;
      } else if (options) {
        opts = options;
      }
    }

    this.inputNode = new Tone.Gain({ context: this.context });
    this.outputNode = new Tone.Gain({ context: this.context });
    this.input = this.inputNode;
    this.output = this.outputNode;

    const { driveAmt, asymmetry } = calculateSaturationParameters(
      opts.inputGain ?? 0,
      opts.saturationDrive ?? 3,
      opts.saturationMode ?? 'normal',
    );

    this.waveshaper = new Tone.WaveShaper({
      context: this.context,
      curve: createSaturationCurve(driveAmt, asymmetry),
    });

    this.waveshaper.oversample = opts.oversample ?? '4x';
    this.inputNode.chain(this.waveshaper, this.outputNode);
    this.update(opts);
  }

  public update(options: SaturationOptions): void {
    this.currentOptions = { ...this.currentOptions, ...options };

    const inputGain = this.currentOptions.inputGain ?? 0;
    const drive = this.currentOptions.saturationDrive ?? 3;
    const mode = this.currentOptions.saturationMode ?? 'normal';
    const outputGain = this.currentOptions.outputGain ?? 0;

    this.inputNode.gain.value = Math.pow(10, Math.max(-20, Math.min(20, inputGain)) / 20);
    this.outputNode.gain.value = Math.pow(10, Math.max(-12, Math.min(12, outputGain)) / 20);

    const { driveAmt, asymmetry } = calculateSaturationParameters(inputGain, drive, mode);
    this.waveshaper.curve = createSaturationCurve(driveAmt, asymmetry);
    this.waveshaper.oversample = this.currentOptions.oversample ?? '4x';
  }

  public dispose(): this {
    // ToneAudioNode.dispose() owns input/output endpoint cleanup. Dispose only
    // the internal waveshaper here to avoid double-disposing the Gain wrappers.
    try { this.waveshaper.dispose(); } catch {}
    super.dispose();
    return this;
  }
}
