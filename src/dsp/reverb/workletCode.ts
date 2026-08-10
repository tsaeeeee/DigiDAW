/**
 * AudioWorkletProcessor raw code string for Pro Reverb DSP
 * Runs sample-by-sample processing inside the Web Audio API AudioWorklet thread.
 */
export const PRO_REVERB_WORKLET_CODE = `
class DelayLine {
  constructor(maxDelaySamples) {
    let size = 1024;
    while (size < maxDelaySamples + 16) {
      size <<= 1;
    }
    this.buffer = new Float32Array(size);
    this.mask = size - 1;
    this.writePos = 0;
  }

  write(sample) {
    this.buffer[this.writePos] = sample;
    this.writePos = (this.writePos + 1) & this.mask;
  }

  read(delaySamples) {
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

  readAt(index) {
    return this.buffer[(this.writePos - 1 - index) & this.mask];
  }

  clear() {
    this.buffer.fill(0);
    this.writePos = 0;
  }
}

class OnePoleLP {
  constructor() {
    this.a0 = 1.0;
    this.b1 = 0.0;
    this.z1 = 0.0;
  }

  setCutoff(cutoffHz, sampleRate) {
    const fc = Math.min(0.49 * sampleRate, Math.max(10, cutoffHz));
    const x = Math.exp(-2.0 * Math.PI * fc / sampleRate);
    this.a0 = 1.0 - x;
    this.b1 = x;
  }

  process(input) {
    this.z1 = input * this.a0 + this.z1 * this.b1;
    return this.z1;
  }

  clear() {
    this.z1 = 0;
  }
}

class CrossoverFilter {
  constructor() {
    this.lp = new OnePoleLP();
  }

  setCrossover(frequencyHz, sampleRate) {
    this.lp.setCutoff(frequencyHz, sampleRate);
  }

  process(input, bassMultiplier) {
    const low = this.lp.process(input);
    const high = input - low;
    const scaledLow = low * bassMultiplier;
    return scaledLow + high;
  }

  clear() {
    this.lp.clear();
  }
}

class BiquadFilter {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
  }

  setLowpass(cutoffHz, sampleRate, q = 0.707) {
    const fc = Math.min(0.49 * sampleRate, Math.max(20, cutoffHz));
    const omega = 2 * Math.PI * fc / sampleRate;
    const sin = Math.sin(omega);
    const cos = Math.cos(omega);
    const alpha = sin / (2 * q);

    const b0 = (1 - cos) / 2;
    const b1 = 1 - cos;
    const b2 = (1 - cos) / 2;
    const a0 = 1 + alpha;

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  setHighpass(cutoffHz, sampleRate, q = 0.707) {
    const fc = Math.min(0.49 * sampleRate, Math.max(10, cutoffHz));
    const omega = 2 * Math.PI * fc / sampleRate;
    const sin = Math.sin(omega);
    const cos = Math.cos(omega);
    const alpha = sin / (2 * q);

    const b0 = (1 + cos) / 2;
    const b1 = -(1 + cos);
    const b2 = (1 + cos) / 2;
    const a0 = 1 + alpha;

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(input) {
    const output = this.b0 * input + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = input;
    this.y2 = this.y1;
    this.y1 = output;
    return output;
  }

  clear() {
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
}

class ModulatedAllpassFilter {
  constructor(maxDelaySamples, baseDelaySamples, coefficient) {
    this.delayLine = new DelayLine(maxDelaySamples);
    this.baseDelaySamples = baseDelaySamples;
    this.coefficient = coefficient;
  }

  setCoefficient(g) {
    this.coefficient = g;
  }

  process(input, modOffsetSamples = 0) {
    const currentDelay = Math.max(1, this.baseDelaySamples + modOffsetSamples);
    const delayed = this.delayLine.read(currentDelay);
    const feedForward = -this.coefficient * input;
    const output = feedForward + delayed;
    const feedBack = input + output * this.coefficient;
    this.delayLine.write(feedBack);
    return output;
  }

  clear() {
    this.delayLine.clear();
  }
}

class LFO {
  constructor(initialPhase = 0) {
    this.phase = initialPhase;
  }

  process(rateHz, sampleRate) {
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
}

const EARLY_TAPS = [
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

class EarlyReflectionEngine {
  constructor() {
    this.delayL = new DelayLine(9600);
    this.delayR = new DelayLine(9600);
  }

  process(inputL, inputR, roomSizeScale, erLevel, sampleRate) {
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

  clear() {
    this.delayL.clear();
    this.delayR.clear();
  }
}

class StereoMatrix {
  processInputMode(inL, inR, mode) {
    if (mode === 1) {
      const side = (inL - inR) * 0.7071;
      return { l: side, r: -side };
    }
    return { l: inL, r: inR };
  }

  applyStereoSeparation(outL, outR, separationPct) {
    const normSep = Math.max(-1, Math.min(1, separationPct / 100));
    const mid = (outL + outR) * 0.5;
    const side = (outL - outR) * 0.5;
    const sideGain = Math.max(0, 1.0 + normSep);
    const newSide = side * sideGain;
    return {
      l: mid + newSide,
      r: mid - newSide,
    };
  }
}

class WorkletReverbEngine {
  constructor(sampleRate) {
    this.sampleRate = sampleRate;
    this.params = {
      mode: 0, hcut: 12000, lcut: 120, predelay: 20, size: 65,
      mod: 30, diff: 80, speed: 1.5, bass: 1.0, decay: 2.5,
      cross: 500, damp: 5000, dry: 100, er: 40, wet: 50, sep: 0
    };

    const maxPreDelaySamples = Math.ceil(0.200 * sampleRate);
    this.preDelayL = new DelayLine(maxPreDelaySamples);
    this.preDelayR = new DelayLine(maxPreDelaySamples);

    this.lcutFilterL = new BiquadFilter();
    this.lcutFilterR = new BiquadFilter();
    this.hcutFilterL = new BiquadFilter();
    this.hcutFilterR = new BiquadFilter();

    this.earlyReflections = new EarlyReflectionEngine();

    this.inputDiffusersL = [];
    this.inputDiffusersR = [];

    const apDelaysL = [142, 107, 379, 277];
    const apDelaysR = [151, 113, 389, 281];
    for (let i = 0; i < 4; i++) {
      const baseL = Math.round((apDelaysL[i] * sampleRate) / 44100);
      const baseR = Math.round((apDelaysR[i] * sampleRate) / 44100);
      this.inputDiffusersL.push(new ModulatedAllpassFilter(baseL * 2, baseL, 0.65));
      this.inputDiffusersR.push(new ModulatedAllpassFilter(baseR * 2, baseR, 0.65));
    }

    const scale = sampleRate / 44100;

    this.tankAllpass1L = new ModulatedAllpassFilter(Math.round(1500 * scale), Math.round(672 * scale), 0.7);
    this.tankAllpass1R = new ModulatedAllpassFilter(Math.round(1500 * scale), Math.round(908 * scale), 0.7);

    this.tankDelay1L = new DelayLine(Math.round(9000 * scale));
    this.tankDelay1R = new DelayLine(Math.round(9000 * scale));

    this.tankDampL = new OnePoleLP();
    this.tankDampR = new OnePoleLP();

    this.tankBassCrossL = new CrossoverFilter();
    this.tankBassCrossR = new CrossoverFilter();

    this.tankAllpass2L = new ModulatedAllpassFilter(Math.round(3000 * scale), Math.round(1800 * scale), 0.5);
    this.tankAllpass2R = new ModulatedAllpassFilter(Math.round(3000 * scale), Math.round(2656 * scale), 0.5);

    this.tankDelay2L = new DelayLine(Math.round(9000 * scale));
    this.tankDelay2R = new DelayLine(Math.round(9000 * scale));

    this.lfo1 = new LFO(0);
    this.lfo2 = new LFO(Math.PI * 0.5);

    this.stereoMatrix = new StereoMatrix();

    this.tankFeedbackL = 0;
    this.tankFeedbackR = 0;

    this.updateFilters();
  }

  setParams(newParams) {
    Object.assign(this.params, newParams);
    this.updateFilters();
  }

  updateFilters() {
    const sr = this.sampleRate;
    this.lcutFilterL.setHighpass(this.params.lcut, sr);
    this.lcutFilterR.setHighpass(this.params.lcut, sr);
    this.hcutFilterL.setLowpass(this.params.hcut, sr);
    this.hcutFilterR.setLowpass(this.params.hcut, sr);

    this.tankDampL.setCutoff(this.params.damp, sr);
    this.tankDampR.setCutoff(this.params.damp, sr);

    this.tankBassCrossL.setCrossover(this.params.cross, sr);
    this.tankBassCrossR.setCrossover(this.params.cross, sr);

    const diffCoeff = 0.3 + 0.45 * (this.params.diff / 100);
    for (let i = 0; i < 4; i++) {
      this.inputDiffusersL[i].setCoefficient(diffCoeff);
      this.inputDiffusersR[i].setCoefficient(diffCoeff);
    }
  }

  processSample(inL, inR) {
    const sr = this.sampleRate;
    const scaleSR = sr / 44100;

    const modeInput = this.stereoMatrix.processInputMode(inL, inR, this.params.mode);

    let filteredL = this.hcutFilterL.process(this.lcutFilterL.process(modeInput.l));
    let filteredR = this.hcutFilterR.process(this.lcutFilterR.process(modeInput.r));

    const preDelaySamples = Math.max(0, Math.round((this.params.predelay * sr) / 1000));
    this.preDelayL.write(filteredL);
    this.preDelayR.write(filteredR);

    const preDelayedL = this.preDelayL.read(preDelaySamples);
    const preDelayedR = this.preDelayR.read(preDelaySamples);

    const roomSizeNorm = this.params.size / 100;
    const erGainNorm = this.params.er / 100;
    const er = this.earlyReflections.process(preDelayedL, preDelayedR, roomSizeNorm, erGainNorm, sr);

    let diffL = preDelayedL;
    let diffR = preDelayedR;
    for (let i = 0; i < 4; i++) {
      diffL = this.inputDiffusersL[i].process(diffL);
      diffR = this.inputDiffusersR[i].process(diffR);
    }

    const modDepthSamples = (this.params.mod / 100) * 8.0 * scaleSR;
    const lfo1Val = this.lfo1.process(this.params.speed, sr);
    const lfo2Val = this.lfo2.process(this.params.speed * 0.85, sr);

    const modOffsetL1 = lfo1Val.sine * modDepthSamples;
    const modOffsetR1 = lfo1Val.cos * modDepthSamples;
    const modOffsetL2 = lfo2Val.sine * modDepthSamples;
    const modOffsetR2 = lfo2Val.cos * modDepthSamples;

    const t60 = Math.max(0.1, this.params.decay);
    const baseLoopSamples = 4400 * scaleSR * Math.max(0.3, roomSizeNorm);
    const rawFeedback = Math.pow(10, (-3 * (baseLoopSamples / sr)) / t60);
    const feedbackCoeff = Math.min(0.985, Math.max(0.1, rawFeedback));

    const inputTankL = diffL + this.tankFeedbackR * feedbackCoeff;
    const inputTankR = diffR + this.tankFeedbackL * feedbackCoeff;

    const ap1L = this.tankAllpass1L.process(inputTankL, modOffsetL1);
    const baseDelay1L = Math.round(4453 * scaleSR * Math.max(0.2, roomSizeNorm));
    this.tankDelay1L.write(ap1L);
    const delayed1L = this.tankDelay1L.read(baseDelay1L + modOffsetL2);

    const damped1L = this.tankDampL.process(delayed1L);
    const bassProcessedL = this.tankBassCrossL.process(damped1L, this.params.bass);
    const ap2L = this.tankAllpass2L.process(bassProcessedL, modOffsetR1);

    const baseDelay2L = Math.round(3720 * scaleSR * Math.max(0.2, roomSizeNorm));
    this.tankDelay2L.write(ap2L);
    const delayed2L = this.tankDelay2L.read(baseDelay2L);

    this.tankFeedbackL = delayed2L;

    const ap1R = this.tankAllpass1R.process(inputTankR, modOffsetR1);
    const baseDelay1R = Math.round(4211 * scaleSR * Math.max(0.2, roomSizeNorm));
    this.tankDelay1R.write(ap1R);
    const delayed1R = this.tankDelay1R.read(baseDelay1R + modOffsetR2);

    const damped1R = this.tankDampR.process(delayed1R);
    const bassProcessedR = this.tankBassCrossR.process(damped1R, this.params.bass);
    const ap2R = this.tankAllpass2R.process(bassProcessedR, modOffsetL1);

    const baseDelay2R = Math.round(3163 * scaleSR * Math.max(0.2, roomSizeNorm));
    this.tankDelay2R.write(ap2R);
    const delayed2R = this.tankDelay2R.read(baseDelay2R);

    this.tankFeedbackR = delayed2R;

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

    const stereoLate = this.stereoMatrix.applyStereoSeparation(lateL, lateR, this.params.sep);

    const dryGain = this.params.dry / 100;
    const wetGain = this.params.wet / 100;

    const outL = inL * dryGain + er.erL + stereoLate.l * wetGain;
    const outR = inR * dryGain + er.erR + stereoLate.r * wetGain;

    return { outL, outR };
  }
}

class ProReverbProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new WorkletReverbEngine(sampleRate);
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'UPDATE_PARAMS') {
        this.engine.setParams(event.data.params);
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0 || !output || output.length === 0) {
      return true;
    }

    const inputL = input[0] || new Float32Array(128);
    const inputR = input[1] || inputL;

    const outputL = output[0];
    const outputR = output[1] || outputL;

    const numSamples = inputL.length;

    for (let i = 0; i < numSamples; i++) {
      const res = this.engine.processSample(inputL[i], inputR[i]);
      outputL[i] = res.outL;
      if (outputR && outputR !== outputL) {
        outputR[i] = res.outR;
      }
    }

    return true;
  }
}

registerProcessor('pro-reverb-processor', ProReverbProcessor);
`;
