import { ReverbParams, DEFAULT_REVERB_PARAMS } from './ReverbParameters';

/**
 * Analog Circuit Reverb DSP Engine
 * Faithful circuit simulation of the NE5532 + PT2399 / Belton Brick Analog Reverb Circuit:
 *
 * Circuit Diagram Sections:
 * 1. "In" Buffer Stage (NE5532 X1):
 *    - Inverting buffer with R1 (1M), C1 (220n), R2 (100k), R3 (100k) || C2 (100p)
 *    - fc_high = 15.9 kHz, fc_low = 7.2 Hz
 *
 * 2. "Direct" Path (VR6 100k pot):
 *    - Direct clean path via R4 (10k), VR6 (100k), R8 (47k), C3 (220n) into X2
 *
 * 3. "Attack" & Pre-Filter Stage (VR5 100k pot):
 *    - VR5 (Attack) into C7 (100n), active low-pass MFB filter (R9-R12, C8-C10)
 *    - Receives "Feedback" return from VR3 through C11 (33n) + R13 (33k)
 *
 * 4. "Reverb" Delay Core (VR4 10k pot):
 *    - Multi-stage diffuse reflections with clock modulation (Pin 6 VCO)
 *
 * 5. De-Emphasis Reconstruction Filter (R14-R18, C12-C17) & "Feedback" (VR3 100k pot)
 *
 * 6. "Effekt" (VR2 100k pot) & Summing Stage (NE5532 X2 with VR1 "Gain" 200k pot)
 */

class DelayLine {
  private buffer: Float32Array;
  private mask: number;
  private writePos: number = 0;

  constructor(maxDelaySamples: number) {
    let size = 1024;
    while (size < maxDelaySamples + 32) {
      size <<= 1;
    }
    this.buffer = new Float32Array(size);
    this.mask = size - 1;
  }

  public write(sample: number): void {
    if (!Number.isFinite(sample)) sample = 0;
    this.buffer[this.writePos] = sample;
    this.writePos = (this.writePos + 1) & this.mask;
  }

  public read(delaySamples: number): number {
    const clamped = Math.max(0, Math.min(this.mask - 2, delaySamples));
    const readPos = this.writePos - clamped;
    const iReadPos = Math.floor(readPos);
    const frac = readPos - iReadPos;

    const idx0 = iReadPos & this.mask;
    const idx1 = (iReadPos + 1) & this.mask;

    const s0 = this.buffer[idx0];
    const s1 = this.buffer[idx1];
    return s0 + frac * (s1 - s0);
  }

  public clear(): void {
    this.buffer.fill(0);
    this.writePos = 0;
  }
}

class AnalogLowPass {
  private a0: number = 1.0;
  private b1: number = 0.0;
  private z1: number = 0.0;

  public setCutoff(cutoffHz: number, sampleRate: number): void {
    const fc = Math.min(0.49 * sampleRate, Math.max(10, cutoffHz));
    const x = Math.exp((-2.0 * Math.PI * fc) / sampleRate);
    this.a0 = 1.0 - x;
    this.b1 = x;
  }

  public process(input: number): number {
    if (!Number.isFinite(input)) input = 0;
    this.z1 = input * this.a0 + this.z1 * this.b1;
    if (!Number.isFinite(this.z1)) this.z1 = 0;
    return this.z1;
  }

  public clear(): void {
    this.z1 = 0;
  }
}

class AnalogHighPass {
  private a0: number = 1.0;
  private b1: number = 0.0;
  private x1: number = 0.0;
  private y1: number = 0.0;

  public setCutoff(cutoffHz: number, sampleRate: number): void {
    const fc = Math.min(0.49 * sampleRate, Math.max(1, cutoffHz));
    const w = (2.0 * Math.PI * fc) / sampleRate;
    const alpha = 1.0 / (1.0 + w);
    this.a0 = alpha;
    this.b1 = alpha;
  }

  public process(input: number): number {
    if (!Number.isFinite(input)) input = 0;
    const out = this.a0 * (input - this.x1) + this.b1 * this.y1;
    this.x1 = input;
    this.y1 = Number.isFinite(out) ? out : 0;
    return this.y1;
  }

  public clear(): void {
    this.x1 = 0;
    this.y1 = 0;
  }
}

class AnalogBiquad {
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
    const w0 = (2.0 * Math.PI * fc) / sampleRate;
    const alpha = Math.sin(w0) / (2.0 * q);
    const cosw0 = Math.cos(w0);

    const a0 = 1.0 + alpha;
    this.b0 = ((1.0 - cosw0) / 2.0) / a0;
    this.b1 = (1.0 - cosw0) / a0;
    this.b2 = ((1.0 - cosw0) / 2.0) / a0;
    this.a1 = (-2.0 * cosw0) / a0;
    this.a2 = (1.0 - alpha) / a0;
  }

  public setHighpass(cutoffHz: number, sampleRate: number, q: number = 0.707): void {
    const fc = Math.min(0.49 * sampleRate, Math.max(10, cutoffHz));
    const w0 = (2.0 * Math.PI * fc) / sampleRate;
    const alpha = Math.sin(w0) / (2.0 * q);
    const cosw0 = Math.cos(w0);

    const a0 = 1.0 + alpha;
    this.b0 = ((1.0 + cosw0) / 2.0) / a0;
    this.b1 = (-(1.0 + cosw0)) / a0;
    this.b2 = ((1.0 + cosw0) / 2.0) / a0;
    this.a1 = (-2.0 * cosw0) / a0;
    this.a2 = (1.0 - alpha) / a0;
  }

  public process(input: number): number {
    if (!Number.isFinite(input)) input = 0;
    const out = this.b0 * input + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = input;
    this.y2 = this.y1;
    this.y1 = Number.isFinite(out) ? out : 0;
    return this.y1;
  }

  public clear(): void {
    this.x1 = 0;
    this.x2 = 0;
    this.y1 = 0;
    this.y2 = 0;
  }
}

class AnalogAllpass {
  private delayLine: DelayLine;
  private delaySamples: number;
  private coefficient: number;

  constructor(maxDelay: number, delaySamples: number, coefficient: number = 0.6) {
    this.delayLine = new DelayLine(maxDelay);
    this.delaySamples = delaySamples;
    this.coefficient = coefficient;
  }

  public setDelay(delay: number): void {
    this.delaySamples = Math.max(1, delay);
  }

  public setCoefficient(c: number): void {
    this.coefficient = Math.max(-0.95, Math.min(0.95, c));
  }

  public process(input: number, modOffset: number = 0): number {
    if (!Number.isFinite(input)) input = 0;
    const d = Math.max(1, this.delaySamples + modOffset);
    const delayed = this.delayLine.read(d);
    const v = input - this.coefficient * delayed;
    const out = delayed + this.coefficient * v;
    this.delayLine.write(v);
    return Number.isFinite(out) ? out : 0;
  }

  public clear(): void {
    this.delayLine.clear();
  }
}

function opAmpSaturate(x: number, gain: number = 1.0): number {
  if (!Number.isFinite(x)) return 0;
  const scaled = x * gain;
  if (scaled > 3.0) return 1.0;
  if (scaled < -3.0) return -1.0;
  return Math.tanh(scaled);
}

export class ReverbEngine {
  private sampleRate: number;
  private params: ReverbParams;

  // Circuit Stage 1: Input Buffer X1 (NE5532)
  private inputHP_L: AnalogHighPass = new AnalogHighPass();
  private inputHP_R: AnalogHighPass = new AnalogHighPass();
  private inputLP_L: AnalogLowPass = new AnalogLowPass();
  private inputLP_R: AnalogLowPass = new AnalogLowPass();

  // User Filter Controls
  private userLcutL: AnalogBiquad = new AnalogBiquad();
  private userLcutR: AnalogBiquad = new AnalogBiquad();
  private userHcutL: AnalogBiquad = new AnalogBiquad();
  private userHcutR: AnalogBiquad = new AnalogBiquad();

  // Pre-Delay Line (Attack stage)
  private preDelayL: DelayLine;
  private preDelayR: DelayLine;

  // Circuit Stage 3: Active Pre-Emphasis Anti-Aliasing Filter & Feedback Return
  private preEmphasisL: AnalogBiquad = new AnalogBiquad();
  private preEmphasisR: AnalogBiquad = new AnalogBiquad();
  private feedbackHP_L: AnalogHighPass = new AnalogHighPass();
  private feedbackHP_R: AnalogHighPass = new AnalogHighPass();

  // Circuit Stage 4: Reverb Tank Delay Core
  private diffusersL: AnalogAllpass[] = [];
  private diffusersR: AnalogAllpass[] = [];
  private tankAllpass1L: AnalogAllpass;
  private tankAllpass1R: AnalogAllpass;
  private tankDelay1L: DelayLine;
  private tankDelay1R: DelayLine;
  private tankDampingL: AnalogLowPass = new AnalogLowPass();
  private tankDampingR: AnalogLowPass = new AnalogLowPass();
  private tankAllpass2L: AnalogAllpass;
  private tankAllpass2R: AnalogAllpass;
  private tankDelay2L: DelayLine;
  private tankDelay2R: DelayLine;

  // Circuit Stage 5: De-Emphasis Post-Filter
  private deEmphasisL: AnalogBiquad = new AnalogBiquad();
  private deEmphasisR: AnalogBiquad = new AnalogBiquad();
  private postFilterLP_L: AnalogLowPass = new AnalogLowPass();
  private postFilterLP_R: AnalogLowPass = new AnalogLowPass();

  // Circuit Stage 6: Summing Stage X2 & Output Filters
  private sumFilterLP_L: AnalogLowPass = new AnalogLowPass();
  private sumFilterLP_R: AnalogLowPass = new AnalogLowPass();
  private outHP_L: AnalogHighPass = new AnalogHighPass();
  private outHP_R: AnalogHighPass = new AnalogHighPass();
  private outLP_L: AnalogLowPass = new AnalogLowPass();
  private outLP_R: AnalogLowPass = new AnalogLowPass();

  // LFO Clock Modulation
  private lfoPhase1: number = 0;
  private lfoPhase2: number = Math.PI * 0.5;

  // Feedback State
  private feedbackSampleL: number = 0;
  private feedbackSampleR: number = 0;

  constructor(sampleRate: number = 44100, initialParams: Partial<ReverbParams> = {}) {
    this.sampleRate = sampleRate || 44100;
    this.params = { ...DEFAULT_REVERB_PARAMS, ...initialParams };

    const maxPreDelay = Math.ceil(0.3 * this.sampleRate);
    this.preDelayL = new DelayLine(maxPreDelay);
    this.preDelayR = new DelayLine(maxPreDelay);

    const scale = this.sampleRate / 44100;

    const apDelaysL = [142, 107, 379, 277];
    const apDelaysR = [151, 113, 389, 281];
    for (let i = 0; i < 4; i++) {
      const dL = Math.max(16, Math.round(apDelaysL[i] * scale));
      const dR = Math.max(16, Math.round(apDelaysR[i] * scale));
      this.diffusersL.push(new AnalogAllpass(dL * 3, dL, 0.65));
      this.diffusersR.push(new AnalogAllpass(dR * 3, dR, 0.65));
    }

    this.tankAllpass1L = new AnalogAllpass(Math.round(2000 * scale), Math.round(672 * scale), 0.7);
    this.tankAllpass1R = new AnalogAllpass(Math.round(2000 * scale), Math.round(908 * scale), 0.7);

    this.tankDelay1L = new DelayLine(Math.round(16000 * scale));
    this.tankDelay1R = new DelayLine(Math.round(16000 * scale));

    this.tankAllpass2L = new AnalogAllpass(Math.round(4000 * scale), Math.round(1800 * scale), 0.5);
    this.tankAllpass2R = new AnalogAllpass(Math.round(4000 * scale), Math.round(2656 * scale), 0.5);

    this.tankDelay2L = new DelayLine(Math.round(16000 * scale));
    this.tankDelay2R = new DelayLine(Math.round(16000 * scale));

    this.updateCircuitFilters();
  }

  public setSampleRate(sampleRate: number): void {
    if (this.sampleRate !== sampleRate) {
      this.sampleRate = sampleRate;
      this.updateCircuitFilters();
    }
  }

  public setParams(newParams: Partial<ReverbParams>): void {
    this.params = { ...this.params, ...newParams };
    this.updateCircuitFilters();
  }

  private updateCircuitFilters(): void {
    const sr = this.sampleRate;

    this.inputHP_L.setCutoff(7.2, sr);
    this.inputHP_R.setCutoff(7.2, sr);
    this.inputLP_L.setCutoff(15915, sr);
    this.inputLP_R.setCutoff(15915, sr);

    this.userLcutL.setHighpass(Math.max(20, this.params.lcut || 120), sr);
    this.userLcutR.setHighpass(Math.max(20, this.params.lcut || 120), sr);
    this.userHcutL.setLowpass(Math.min(20000, this.params.hcut || 12000), sr);
    this.userHcutR.setLowpass(Math.min(20000, this.params.hcut || 12000), sr);

    this.preEmphasisL.setLowpass(3600, sr, 0.8);
    this.preEmphasisR.setLowpass(3600, sr, 0.8);
    this.feedbackHP_L.setCutoff(146, sr);
    this.feedbackHP_R.setCutoff(146, sr);

    const dampCutoff = Math.max(500, Math.min(18000, this.params.damp || 5000));
    this.tankDampingL.setCutoff(dampCutoff, sr);
    this.tankDampingR.setCutoff(dampCutoff, sr);

    this.deEmphasisL.setLowpass(4500, sr, 0.707);
    this.deEmphasisR.setLowpass(4500, sr, 0.707);
    this.postFilterLP_L.setCutoff(9000, sr);
    this.postFilterLP_R.setCutoff(9000, sr);

    this.sumFilterLP_L.setCutoff(16000, sr);
    this.sumFilterLP_R.setCutoff(16000, sr);
    this.outHP_L.setCutoff(15, sr);
    this.outHP_R.setCutoff(15, sr);
    this.outLP_L.setCutoff(18000, sr);
    this.outLP_R.setCutoff(18000, sr);

    const diffCoeff = 0.35 + 0.45 * ((this.params.diff ?? 80) / 100);
    for (let i = 0; i < 4; i++) {
      this.diffusersL[i].setCoefficient(diffCoeff);
      this.diffusersR[i].setCoefficient(diffCoeff);
    }
  }

  public processSample(inL: number, inR: number): { outL: number; outR: number } {
    if (!Number.isFinite(inL)) inL = 0;
    if (!Number.isFinite(inR)) inR = 0;

    const sr = this.sampleRate;
    const scaleSR = sr / 44100;

    // 1. Mid/Side Mode Pre-Processing
    let mid = (inL + inR) * 0.7071;
    let side = (inL - inR) * 0.7071;
    let procInL = inL;
    let procInR = inR;
    if (this.params.mode === 1) {
      procInL = side;
      procInR = side;
    } else if (this.params.mode === 0) {
      procInL = mid;
      procInR = mid;
    }

    // 2. Circuit Input Stage X1 (NE5532 Buffer)
    const bufInL = this.inputLP_L.process(this.inputHP_L.process(procInL));
    const bufInR = this.inputLP_R.process(this.inputHP_R.process(procInR));

    // 3. Direct Clean Path: VR6 ("Direct" 100k pot)
    const dryGain = (this.params.dry ?? 100) / 100;
    const directL = bufInL * dryGain;
    const directR = bufInR * dryGain;

    // 4. Attack & Reverb Pre-Filtering (VR5 "Attack" 100k pot)
    const attackGain = 0.5 + ((this.params.er ?? 40) / 100) * 0.8;
    const filteredInL = this.userHcutL.process(this.userLcutL.process(inL * attackGain));
    const filteredInR = this.userHcutR.process(this.userLcutR.process(inR * attackGain));

    const preDelaySamples = Math.round(((this.params.predelay ?? 20) / 1000) * sr);
    this.preDelayL.write(filteredInL);
    this.preDelayR.write(filteredInR);
    const delayedInL = this.preDelayL.read(preDelaySamples);
    const delayedInR = this.preDelayR.read(preDelaySamples);

    // Sum input with Feedback loop from VR3
    const fbHP_L = this.feedbackHP_L.process(this.feedbackSampleL);
    const fbHP_R = this.feedbackHP_R.process(this.feedbackSampleR);
    const preInL = this.preEmphasisL.process(delayedInL + fbHP_L);
    const preInR = this.preEmphasisR.process(delayedInR + fbHP_R);

    // 5. 4-Stage Input Diffusers
    let diffL = preInL;
    let diffR = preInR;
    for (let i = 0; i < 4; i++) {
      diffL = this.diffusersL[i].process(diffL);
      diffR = this.diffusersR[i].process(diffR);
    }

    // 6. PT2399 / Belton Reverb Tank Core
    const sizeScale = 0.5 + ((this.params.size ?? 65) / 100) * 0.9;
    const decaySec = Math.max(0.2, this.params.decay ?? 2.5);
    const decayGain = Math.min(0.92, Math.max(0.2, 0.4 + (decaySec / 20) * 0.52));

    const modDepth = ((this.params.mod ?? 30) / 100) * 10.0 * scaleSR;
    const lfoSpeed = Math.max(0.1, this.params.speed ?? 1.5);
    this.lfoPhase1 += (2 * Math.PI * lfoSpeed) / sr;
    this.lfoPhase2 += (2 * Math.PI * (lfoSpeed * 1.17)) / sr;
    if (this.lfoPhase1 > 2 * Math.PI) this.lfoPhase1 -= 2 * Math.PI;
    if (this.lfoPhase2 > 2 * Math.PI) this.lfoPhase2 -= 2 * Math.PI;

    const mod1 = Math.sin(this.lfoPhase1) * modDepth;
    const mod2 = Math.cos(this.lfoPhase2) * modDepth;

    // Cross-coupled tank nodes
    const tankInL = diffL + this.feedbackSampleR * decayGain;
    const tankInR = diffR + this.feedbackSampleL * decayGain;

    const ap1OutL = this.tankAllpass1L.process(tankInL, mod1);
    const ap1OutR = this.tankAllpass1R.process(tankInR, mod2);

    const d1LenL = Math.max(10, Math.round(4453 * scaleSR * sizeScale));
    const d1LenR = Math.max(10, Math.round(3720 * scaleSR * sizeScale));
    this.tankDelay1L.write(ap1OutL);
    this.tankDelay1R.write(ap1OutR);
    const d1OutL = this.tankDelay1L.read(d1LenL);
    const d1OutR = this.tankDelay1R.read(d1LenR);

    const bassMult = Math.max(0.5, Math.min(2.0, this.params.bass ?? 1.0));
    const dampedL = this.tankDampingL.process(d1OutL) * bassMult;
    const dampedR = this.tankDampingR.process(d1OutR) * bassMult;

    const ap2OutL = this.tankAllpass2L.process(dampedL, mod2);
    const ap2OutR = this.tankAllpass2R.process(dampedR, mod1);

    const d2LenL = Math.max(10, Math.round(3163 * scaleSR * sizeScale));
    const d2LenR = Math.max(10, Math.round(2520 * scaleSR * sizeScale));
    this.tankDelay2L.write(ap2OutL);
    this.tankDelay2R.write(ap2OutR);
    const d2OutL = this.tankDelay2L.read(d2LenL);
    const d2OutR = this.tankDelay2R.read(d2LenR);

    // Feedback Loop (VR3 "Feedback" pot)
    const fbGain = 0.35 + (decaySec / 20.0) * 0.45;
    this.feedbackSampleL = opAmpSaturate(d2OutL * fbGain, 0.85);
    this.feedbackSampleR = opAmpSaturate(d2OutR * fbGain, 0.85);

    // Multi-tap dense reverb matrix
    const wetL = (this.tankDelay1L.read(Math.round(266 * scaleSR))
      + this.tankDelay1L.read(Math.round(2974 * scaleSR))
      - this.tankAllpass2L.process(this.tankDelay2L.read(Math.round(1913 * scaleSR)))
      + this.tankDelay2L.read(Math.round(1996 * scaleSR))
      - this.tankDelay1R.read(Math.round(1990 * scaleSR))) * 0.5;

    const wetR = (this.tankDelay1R.read(Math.round(353 * scaleSR))
      + this.tankDelay1R.read(Math.round(3627 * scaleSR))
      - this.tankAllpass2R.process(this.tankDelay2R.read(Math.round(1228 * scaleSR)))
      + this.tankDelay2R.read(Math.round(2673 * scaleSR))
      - this.tankDelay1L.read(Math.round(1066 * scaleSR))) * 0.5;

    // 7. De-Emphasis Post-Filter Stage (R14-R18, C12-C17)
    const deEmphL = this.postFilterLP_L.process(this.deEmphasisL.process(wetL));
    const deEmphR = this.postFilterLP_R.process(this.deEmphasisR.process(wetR));

    // 8. VR2 ("Effekt" 100k pot)
    const wetGain = ((this.params.wet ?? 50) / 100) * 1.35;
    const effectL = deEmphL * wetGain;
    const effectR = deEmphR * wetGain;

    // 9. Master Summing Stage (Op-Amp X2 NE5532)
    const sumL = directL + effectL;
    const sumR = directR + effectR;

    let finalOutL = this.outLP_L.process(this.outHP_L.process(sumL));
    let finalOutR = this.outLP_R.process(this.outHP_R.process(sumR));

    // Stereo Separation Matrix
    const sep = (this.params.sep ?? 0) / 100;
    const outMid = (finalOutL + finalOutR) * 0.5;
    const outSide = (finalOutL - finalOutR) * 0.5;
    finalOutL = outMid + outSide * (1.0 + sep);
    finalOutR = outMid - outSide * (1.0 + sep);

    return { outL: finalOutL, outR: finalOutR };
  }
}
