import { ReverbParams, DEFAULT_REVERB_PARAMS } from './ReverbParameters';
import { DelayLine } from './DelayLine';
import { ModulatedAllpassFilter } from './AllpassFilter';
import { OnePoleLP, BiquadFilter, CrossoverFilter } from './Filters';
import { LFO } from './Modulation';
import { EarlyReflectionEngine } from './EarlyReflection';
import { StereoMatrix } from './StereoMatrix';

/**
 * Modern Algorithmic Reverb DSP Engine (Dattorro FDN Architecture)
 * Features:
 * - Pre Delay
 * - Biquad Low-Cut & High-Cut Input Filters
 * - Multi-Tap Early Reflection Engine
 * - 4-Stage Input Allpass Diffuser Network
 * - Cross-Coupled Modulated Figure-8 Feedback Tank (FDN)
 * - Frequency-Dependent Damping (High Cut attenuation per loop pass)
 * - Bass Multiplier Crossover Filter
 * - LFO Sinusoidal Delay Line Modulation (Eliminates Metallic Ringing)
 * - Stereo Separation & Mid/Side Output Matrix
 */
export class ReverbEngine {
  private sampleRate: number;
  private params: ReverbParams;

  // Input & Pre-delay
  private preDelayL: DelayLine;
  private preDelayR: DelayLine;
  private lcutFilterL: BiquadFilter = new BiquadFilter();
  private lcutFilterR: BiquadFilter = new BiquadFilter();
  private hcutFilterL: BiquadFilter = new BiquadFilter();
  private hcutFilterR: BiquadFilter = new BiquadFilter();

  // Early Reflections
  private earlyReflections: EarlyReflectionEngine = new EarlyReflectionEngine();

  // Input Diffusers (4 Allpass Filters in series per channel)
  private inputDiffusersL: ModulatedAllpassFilter[] = [];
  private inputDiffusersR: ModulatedAllpassFilter[] = [];

  // Feedback Delay Network (Left and Right Tanks)
  private tankAllpass1L: ModulatedAllpassFilter;
  private tankAllpass1R: ModulatedAllpassFilter;
  private tankDelay1L: DelayLine;
  private tankDelay1R: DelayLine;
  private tankDampL: OnePoleLP = new OnePoleLP();
  private tankDampR: OnePoleLP = new OnePoleLP();
  private tankBassCrossL: CrossoverFilter = new CrossoverFilter();
  private tankBassCrossR: CrossoverFilter = new CrossoverFilter();
  private tankAllpass2L: ModulatedAllpassFilter;
  private tankAllpass2R: ModulatedAllpassFilter;
  private tankDelay2L: DelayLine;
  private tankDelay2R: DelayLine;

  // Modulation LFOs
  private lfo1: LFO = new LFO(0);
  private lfo2: LFO = new LFO(Math.PI * 0.5);

  // Stereo Matrix
  private stereoMatrix: StereoMatrix = new StereoMatrix();

  // Feedback State
  private tankFeedbackL: number = 0;
  private tankFeedbackR: number = 0;

  constructor(sampleRate: number = 44100, initialParams: Partial<ReverbParams> = {}) {
    this.sampleRate = sampleRate;
    this.params = { ...DEFAULT_REVERB_PARAMS, ...initialParams };

    // Allocate max 200ms pre-delay lines
    const maxPreDelaySamples = Math.ceil(0.200 * sampleRate);
    this.preDelayL = new DelayLine(maxPreDelaySamples);
    this.preDelayR = new DelayLine(maxPreDelaySamples);

    // Initialize 4 Input Allpass Diffusers per channel with prime delay lengths
    const apDelaysL = [142, 107, 379, 277];
    const apDelaysR = [151, 113, 389, 281];
    for (let i = 0; i < 4; i++) {
      const baseSamplesL = Math.round((apDelaysL[i] * sampleRate) / 44100);
      const baseSamplesR = Math.round((apDelaysR[i] * sampleRate) / 44100);
      this.inputDiffusersL.push(new ModulatedAllpassFilter(baseSamplesL * 2, baseSamplesL, 0.65));
      this.inputDiffusersR.push(new ModulatedAllpassFilter(baseSamplesR * 2, baseSamplesR, 0.65));
    }

    // Tank components (scaled to sample rate)
    const scale = sampleRate / 44100;
    
    this.tankAllpass1L = new ModulatedAllpassFilter(Math.round(1500 * scale), Math.round(672 * scale), 0.7);
    this.tankAllpass1R = new ModulatedAllpassFilter(Math.round(1500 * scale), Math.round(908 * scale), 0.7);

    this.tankDelay1L = new DelayLine(Math.round(9000 * scale));
    this.tankDelay1R = new DelayLine(Math.round(9000 * scale));

    this.tankAllpass2L = new ModulatedAllpassFilter(Math.round(3000 * scale), Math.round(1800 * scale), 0.5);
    this.tankAllpass2R = new ModulatedAllpassFilter(Math.round(3000 * scale), Math.round(2656 * scale), 0.5);

    this.tankDelay2L = new DelayLine(Math.round(9000 * scale));
    this.tankDelay2R = new DelayLine(Math.round(9000 * scale));

    this.updateFilters();
  }

  public setSampleRate(sampleRate: number): void {
    if (this.sampleRate !== sampleRate) {
      this.sampleRate = sampleRate;
      this.updateFilters();
    }
  }

  public setParams(newParams: Partial<ReverbParams>): void {
    this.params = { ...this.params, ...newParams };
    this.updateFilters();
  }

  private updateFilters(): void {
    const sr = this.sampleRate;
    
    // Low cut and High cut input filters
    this.lcutFilterL.setHighpass(this.params.lcut, sr);
    this.lcutFilterR.setHighpass(this.params.lcut, sr);
    this.hcutFilterL.setLowpass(this.params.hcut, sr);
    this.hcutFilterR.setLowpass(this.params.hcut, sr);

    // High frequency damping in tank loop
    this.tankDampL.setCutoff(this.params.damp, sr);
    this.tankDampR.setCutoff(this.params.damp, sr);

    // Bass multiplier crossover
    this.tankBassCrossL.setCrossover(this.params.cross, sr);
    this.tankBassCrossR.setCrossover(this.params.cross, sr);

    // Input diffusion coefficient
    const diffCoeff = 0.3 + 0.45 * (this.params.diff / 100);
    for (let i = 0; i < 4; i++) {
      this.inputDiffusersL[i].setCoefficient(diffCoeff);
      this.inputDiffusersR[i].setCoefficient(diffCoeff);
    }
  }

  public processSample(inL: number, inR: number): { outL: number; outR: number } {
    const sr = this.sampleRate;
    const scaleSR = sr / 44100;

    // 1. Mid/Side Mode Processing
    const modeInput = this.stereoMatrix.processInputMode(inL, inR, this.params.mode);

    // 2. High-Cut and Low-Cut Input Filtering
    let filteredL = this.hcutFilterL.process(this.lcutFilterL.process(modeInput.l));
    let filteredR = this.hcutFilterR.process(this.lcutFilterR.process(modeInput.r));

    // 3. Pre Delay
    const preDelaySamples = Math.max(0, Math.round((this.params.predelay * sr) / 1000));
    this.preDelayL.write(filteredL);
    this.preDelayR.write(filteredR);

    const preDelayedL = this.preDelayL.read(preDelaySamples);
    const preDelayedR = this.preDelayR.read(preDelaySamples);

    // 4. Early Reflections
    const roomSizeNorm = this.params.size / 100;
    const erGainNorm = this.params.er / 100;
    const er = this.earlyReflections.process(preDelayedL, preDelayedR, roomSizeNorm, erGainNorm, sr);

    // 5. Input Diffusers (Series of 4 Allpass Filters)
    let diffL = preDelayedL;
    let diffR = preDelayedR;
    for (let i = 0; i < 4; i++) {
      diffL = this.inputDiffusersL[i].process(diffL);
      diffR = this.inputDiffusersR[i].process(diffR);
    }

    // 6. Modulation LFOs for smooth chorus delay-line modulation
    const modDepthSamples = (this.params.mod / 100) * 8.0 * scaleSR;
    const lfo1Val = this.lfo1.process(this.params.speed, sr);
    const lfo2Val = this.lfo2.process(this.params.speed * 0.85, sr);

    const modOffsetL1 = lfo1Val.sine * modDepthSamples;
    const modOffsetR1 = lfo1Val.cos * modDepthSamples;
    const modOffsetL2 = lfo2Val.sine * modDepthSamples;
    const modOffsetR2 = lfo2Val.cos * modDepthSamples;

    // 7. Calculate Feedback Coefficient based on Decay Time (T60)
    // Decay coefficient g = 10^(-3 * delayTime / T60)
    const t60 = Math.max(0.1, this.params.decay);
    const baseLoopSamples = 4400 * scaleSR * Math.max(0.3, roomSizeNorm);
    const rawFeedback = Math.pow(10, (-3 * (baseLoopSamples / sr)) / t60);
    const feedbackCoeff = Math.min(0.985, Math.max(0.1, rawFeedback));

    // 8. Cross-Coupled Feedback Delay Tank (Figure-8 FDN)
    // Left Tank Input = diffL + tankFeedbackR * feedbackCoeff
    // Right Tank Input = diffR + tankFeedbackL * feedbackCoeff
    const inputTankL = diffL + this.tankFeedbackR * feedbackCoeff;
    const inputTankR = diffR + this.tankFeedbackL * feedbackCoeff;

    // Tank Left Side
    const ap1L = this.tankAllpass1L.process(inputTankL, modOffsetL1);
    
    // Main Tank Delay 1
    const baseDelay1L = Math.round(4453 * scaleSR * Math.max(0.2, roomSizeNorm));
    this.tankDelay1L.write(ap1L);
    const delayed1L = this.tankDelay1L.read(baseDelay1L + modOffsetL2);

    // High Frequency Damping
    const damped1L = this.tankDampL.process(delayed1L);

    // Low Frequency Bass Multiplier Crossover
    const bassProcessedL = this.tankBassCrossL.process(damped1L, this.params.bass).sum;

    // Nested Allpass 2
    const ap2L = this.tankAllpass2L.process(bassProcessedL, modOffsetR1);

    // Main Tank Delay 2
    const baseDelay2L = Math.round(3720 * scaleSR * Math.max(0.2, roomSizeNorm));
    this.tankDelay2L.write(ap2L);
    const delayed2L = this.tankDelay2L.read(baseDelay2L);

    this.tankFeedbackL = delayed2L;

    // Tank Right Side
    const ap1R = this.tankAllpass1R.process(inputTankR, modOffsetR1);

    // Main Tank Delay 1
    const baseDelay1R = Math.round(4211 * scaleSR * Math.max(0.2, roomSizeNorm));
    this.tankDelay1R.write(ap1R);
    const delayed1R = this.tankDelay1R.read(baseDelay1R + modOffsetR2);

    // High Frequency Damping
    const damped1R = this.tankDampR.process(delayed1R);

    // Low Frequency Bass Multiplier Crossover
    const bassProcessedR = this.tankBassCrossR.process(damped1R, this.params.bass).sum;

    // Nested Allpass 2
    const ap2R = this.tankAllpass2R.process(bassProcessedR, modOffsetL1);

    // Main Tank Delay 2
    const baseDelay2R = Math.round(3163 * scaleSR * Math.max(0.2, roomSizeNorm));
    this.tankDelay2R.write(ap2R);
    const delayed2R = this.tankDelay2R.read(baseDelay2R);

    this.tankFeedbackR = delayed2R;

    // 9. Late Reverb Tap Extraction for Lush Stereo Field
    const tapL1 = this.tankDelay1L.readAt(Math.round(266 * scaleSR));
    const tapL2 = this.tankDelay1L.readAt(Math.round(2974 * scaleSR));
    const tapL3 = this.tankDelay2L.readAt(Math.round(1913 * scaleSR));
    const tapL4 = this.tankDelay2R.readAt(Math.round(1996 * scaleSR));

    const tapR1 = this.tankDelay1R.readAt(Math.round(353 * scaleSR));
    const tapR2 = this.tankDelay1R.readAt(Math.round(2870 * scaleSR));
    const tapR3 = this.tankDelay2R.readAt(Math.round(1720 * scaleSR));
    const tapR4 = this.tankDelay2L.readAt(Math.round(1085 * scaleSR));

    const lateL = (tapL1 + tapL2 - tapL3 + tapL4) * 0.35;
    const lateR = (tapR1 + tapR2 - tapR3 + tapR4) * 0.35;

    // 10. Stereo Separation & Width Matrix
    const stereoLate = this.stereoMatrix.applyStereoSeparation(lateL, lateR, this.params.sep);

    // 11. Final Wet/Dry/ER Mix
    const dryGain = this.params.dry / 100;
    const wetGain = this.params.wet / 100;

    const outL = inL * dryGain + er.erL + stereoLate.l * wetGain;
    const outR = inR * dryGain + er.erR + stereoLate.r * wetGain;

    return { outL, outR };
  }

  public clear(): void {
    this.preDelayL.clear();
    this.preDelayR.clear();
    this.lcutFilterL.clear();
    this.lcutFilterR.clear();
    this.hcutFilterL.clear();
    this.hcutFilterR.clear();
    this.earlyReflections.clear();
    for (let i = 0; i < 4; i++) {
      this.inputDiffusersL[i].clear();
      this.inputDiffusersR[i].clear();
    }
    this.tankAllpass1L.clear();
    this.tankAllpass1R.clear();
    this.tankDelay1L.clear();
    this.tankDelay1R.clear();
    this.tankDampL.clear();
    this.tankDampR.clear();
    this.tankBassCrossL.clear();
    this.tankBassCrossR.clear();
    this.tankAllpass2L.clear();
    this.tankAllpass2R.clear();
    this.tankDelay2L.clear();
    this.tankDelay2R.clear();
    this.tankFeedbackL = 0;
    this.tankFeedbackR = 0;
  }
}
