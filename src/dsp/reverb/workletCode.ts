/**
 * AudioWorkletProcessor raw code string for Analog Circuit Reverb DSP
 * Faithful circuit simulation of the NE5532 + PT2399 / Belton Brick Analog Reverb Circuit.
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
    const clamped = delaySamples < 0 ? 0 : delaySamples;
    const readPos = this.writePos - clamped;
    const iReadPos = Math.floor(readPos);
    const frac = readPos - iReadPos;

    const idx0 = iReadPos & this.mask;
    const idx1 = (iReadPos + 1) & this.mask;

    const s0 = this.buffer[idx0];
    const s1 = this.buffer[idx1];
    return s0 + frac * (s1 - s0);
  }

  clear() {
    this.buffer.fill(0);
    this.writePos = 0;
  }
}

class AnalogLowPass {
  constructor() {
    this.a0 = 1.0;
    this.b1 = 0.0;
    this.z1 = 0.0;
  }

  setCutoff(cutoffHz, sampleRate) {
    const fc = Math.min(0.49 * sampleRate, Math.max(10, cutoffHz));
    const x = Math.exp((-2.0 * Math.PI * fc) / sampleRate);
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

class AnalogHighPass {
  constructor() {
    this.a0 = 1.0;
    this.b1 = 0.0;
    this.x1 = 0.0;
    this.y1 = 0.0;
  }

  setCutoff(cutoffHz, sampleRate) {
    const fc = Math.min(0.49 * sampleRate, Math.max(1, cutoffHz));
    const w = 2.0 * Math.PI * fc / sampleRate;
    const alpha = 1.0 / (1.0 + w);
    this.a0 = alpha;
    this.b1 = alpha;
  }

  process(input) {
    const out = this.a0 * (input - this.x1) + this.b1 * this.y1;
    this.x1 = input;
    this.y1 = out;
    return out;
  }

  clear() {
    this.x1 = 0;
    this.y1 = 0;
  }
}

class AnalogBiquad {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0;
    this.a1 = 0; this.a2 = 0;
    this.x1 = 0; this.x2 = 0;
    this.y1 = 0; this.y2 = 0;
  }

  setLowpass(cutoffHz, sampleRate, q = 0.707) {
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

  setHighpass(cutoffHz, sampleRate, q = 0.707) {
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

  process(input) {
    const out = this.b0 * input + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = input;
    this.y2 = this.y1;
    this.y1 = out;
    return out;
  }

  clear() {
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
}

class AnalogAllpass {
  constructor(maxDelay, delaySamples, coefficient = 0.6) {
    this.delayLine = new DelayLine(maxDelay);
    this.delaySamples = delaySamples;
    this.coefficient = coefficient;
  }

  setDelay(delay) {
    this.delaySamples = delay;
  }

  setCoefficient(c) {
    this.coefficient = c;
  }

  process(input, modOffset = 0) {
    const d = this.delaySamples + modOffset;
    const delayed = this.delayLine.read(d);
    const v = input - this.coefficient * delayed;
    const out = delayed + this.coefficient * v;
    this.delayLine.write(v);
    return out;
  }

  clear() {
    this.delayLine.clear();
  }
}

function opAmpSaturate(x, gain = 1.0) {
  const scaled = x * gain;
  if (scaled > 2.5) return 1.0;
  if (scaled < -2.5) return -1.0;
  return Math.tanh(scaled);
}

class CircuitReverbDSP {
  constructor(sampleRate, params) {
    this.sampleRate = sampleRate;
    this.params = params;

    const maxPreDelay = Math.ceil(0.25 * sampleRate);
    this.preDelayL = new DelayLine(maxPreDelay);
    this.preDelayR = new DelayLine(maxPreDelay);

    this.inputHP_L = new AnalogHighPass();
    this.inputHP_R = new AnalogHighPass();
    this.inputLP_L = new AnalogLowPass();
    this.inputLP_R = new AnalogLowPass();

    this.userLcutL = new AnalogBiquad();
    this.userLcutR = new AnalogBiquad();
    this.userHcutL = new AnalogBiquad();
    this.userHcutR = new AnalogBiquad();

    this.preEmphasisL = new AnalogBiquad();
    this.preEmphasisR = new AnalogBiquad();
    this.feedbackHP_L = new AnalogHighPass();
    this.feedbackHP_R = new AnalogHighPass();

    this.diffusersL = [];
    this.diffusersR = [];
    const scale = sampleRate / 44100;
    const apDelaysL = [142, 107, 379, 277];
    const apDelaysR = [151, 113, 389, 281];
    for (let i = 0; i < 4; i++) {
      const dL = Math.round(apDelaysL[i] * scale);
      const dR = Math.round(apDelaysR[i] * scale);
      this.diffusersL.push(new AnalogAllpass(dL * 2, dL, 0.62));
      this.diffusersR.push(new AnalogAllpass(dR * 2, dR, 0.62));
    }

    this.tankAllpass1L = new AnalogAllpass(Math.round(1600 * scale), Math.round(672 * scale), 0.7);
    this.tankAllpass1R = new AnalogAllpass(Math.round(1600 * scale), Math.round(908 * scale), 0.7);
    this.tankDelay1L = new DelayLine(Math.round(9000 * scale));
    this.tankDelay1R = new DelayLine(Math.round(9000 * scale));

    this.tankDampingL = new AnalogLowPass();
    this.tankDampingR = new AnalogLowPass();

    this.tankAllpass2L = new AnalogAllpass(Math.round(3200 * scale), Math.round(1800 * scale), 0.5);
    this.tankAllpass2R = new AnalogAllpass(Math.round(3200 * scale), Math.round(2656 * scale), 0.5);
    this.tankDelay2L = new DelayLine(Math.round(9000 * scale));
    this.tankDelay2R = new DelayLine(Math.round(9000 * scale));

    this.deEmphasisL = new AnalogBiquad();
    this.deEmphasisR = new AnalogBiquad();
    this.postFilterLP_L = new AnalogLowPass();
    this.postFilterLP_R = new AnalogLowPass();

    this.sumFilterLP_L = new AnalogLowPass();
    this.sumFilterLP_R = new AnalogLowPass();
    this.outHP_L = new AnalogHighPass();
    this.outHP_R = new AnalogHighPass();
    this.outLP_L = new AnalogLowPass();
    this.outLP_R = new AnalogLowPass();

    this.lfoPhase1 = 0;
    this.lfoPhase2 = Math.PI * 0.5;

    this.feedbackSampleL = 0;
    this.feedbackSampleR = 0;

    this.updateFilters();
  }

  updateFilters() {
    const sr = this.sampleRate;
    this.inputHP_L.setCutoff(7.2, sr);
    this.inputHP_R.setCutoff(7.2, sr);
    this.inputLP_L.setCutoff(15915, sr);
    this.inputLP_R.setCutoff(15915, sr);

    this.userLcutL.setHighpass(this.params.lcut, sr);
    this.userLcutR.setHighpass(this.params.lcut, sr);
    this.userHcutL.setLowpass(this.params.hcut, sr);
    this.userHcutR.setLowpass(this.params.hcut, sr);

    this.preEmphasisL.setLowpass(3400, sr, 0.85);
    this.preEmphasisR.setLowpass(3400, sr, 0.85);
    this.feedbackHP_L.setCutoff(146, sr);
    this.feedbackHP_R.setCutoff(146, sr);

    const dampCutoff = Math.max(500, Math.min(16000, this.params.damp));
    this.tankDampingL.setCutoff(dampCutoff, sr);
    this.tankDampingR.setCutoff(dampCutoff, sr);

    this.deEmphasisL.setLowpass(4200, sr, 0.707);
    this.deEmphasisR.setLowpass(4200, sr, 0.707);
    this.postFilterLP_L.setCutoff(8000, sr);
    this.postFilterLP_R.setCutoff(8000, sr);

    this.sumFilterLP_L.setCutoff(14500, sr);
    this.sumFilterLP_R.setCutoff(14500, sr);
    this.outHP_L.setCutoff(154, sr);
    this.outHP_R.setCutoff(154, sr);
    this.outLP_L.setCutoff(7200, sr);
    this.outLP_R.setCutoff(7200, sr);

    const diffCoeff = 0.3 + 0.45 * (this.params.diff / 100);
    for (let i = 0; i < 4; i++) {
      this.diffusersL[i].setCoefficient(diffCoeff);
      this.diffusersR[i].setCoefficient(diffCoeff);
    }
  }

  processSample(inL, inR) {
    const sr = this.sampleRate;
    const scaleSR = sr / 44100;

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

    const bufInL = this.inputLP_L.process(this.inputHP_L.process(procInL));
    const bufInR = this.inputLP_R.process(this.inputHP_R.process(procInR));
    const x1OutL = -opAmpSaturate(bufInL, 1.0);
    const x1OutR = -opAmpSaturate(bufInR, 1.0);

    const dryGain = (this.params.dry / 100);
    const directL = x1OutL * dryGain;
    const directR = x1OutR * dryGain;

    const attackGain = 0.5 + (this.params.er / 100) * 0.7;
    let filteredInL = this.userHcutL.process(this.userLcutL.process(inL * attackGain));
    let filteredInR = this.userHcutR.process(this.userLcutR.process(inR * attackGain));

    const preDelaySamples = Math.round((this.params.predelay / 1000) * sr);
    this.preDelayL.write(filteredInL);
    this.preDelayR.write(filteredInR);
    const delayedInL = this.preDelayL.read(preDelaySamples);
    const delayedInR = this.preDelayR.read(preDelaySamples);

    const fbHP_L = this.feedbackHP_L.process(this.feedbackSampleL);
    const fbHP_R = this.feedbackHP_R.process(this.feedbackSampleR);
    const preInL = this.preEmphasisL.process(delayedInL + fbHP_L);
    const preInR = this.preEmphasisR.process(delayedInR + fbHP_R);

    let diffL = preInL;
    let diffR = preInR;
    for (let i = 0; i < 4; i++) {
      diffL = this.diffusersL[i].process(diffL);
      diffR = this.diffusersR[i].process(diffR);
    }

    const sizeScale = 0.5 + (this.params.size / 100) * 0.9;
    const decayTime = Math.max(0.2, this.params.decay);
    const decayFactor = Math.pow(10, -3.0 / (decayTime * (44100 / (4200 * sizeScale))));
    const baseFeedback = Math.min(0.96, Math.max(0.1, decayFactor));

    const modDepth = (this.params.mod / 100) * 12.0 * scaleSR;
    const lfoFreq = Math.max(0.1, this.params.speed);
    this.lfoPhase1 += (2 * Math.PI * lfoFreq) / sr;
    this.lfoPhase2 += (2 * Math.PI * (lfoFreq * 1.13)) / sr;
    if (this.lfoPhase1 > 2 * Math.PI) this.lfoPhase1 -= 2 * Math.PI;
    if (this.lfoPhase2 > 2 * Math.PI) this.lfoPhase2 -= 2 * Math.PI;

    const mod1 = Math.sin(this.lfoPhase1) * modDepth;
    const mod2 = Math.cos(this.lfoPhase2) * modDepth;

    const tankInL = diffL + this.feedbackSampleR * baseFeedback;
    const tankInR = diffR + this.feedbackSampleL * baseFeedback;

    const ap1OutL = this.tankAllpass1L.process(tankInL, mod1);
    const ap1OutR = this.tankAllpass1R.process(tankInR, mod2);

    const d1LenL = Math.round(4453 * scaleSR * sizeScale);
    const d1LenR = Math.round(3720 * scaleSR * sizeScale);
    this.tankDelay1L.write(ap1OutL);
    this.tankDelay1R.write(ap1OutR);
    const d1OutL = this.tankDelay1L.read(d1LenL);
    const d1OutR = this.tankDelay1R.read(d1LenR);

    const dampedL = this.tankDampingL.process(d1OutL) * this.params.bass;
    const dampedR = this.tankDampingR.process(d1OutR) * this.params.bass;

    const ap2OutL = this.tankAllpass2L.process(dampedL, mod2);
    const ap2OutR = this.tankAllpass2R.process(dampedR, mod1);

    const d2LenL = Math.round(3163 * scaleSR * sizeScale);
    const d2LenR = Math.round(2520 * scaleSR * sizeScale);
    this.tankDelay2L.write(ap2OutL);
    this.tankDelay2R.write(ap2OutR);
    const d2OutL = this.tankDelay2L.read(d2LenL);
    const d2OutR = this.tankDelay2R.read(d2LenR);

    const fbPotGain = 0.4 + (this.params.decay / 20.0) * 0.45;
    this.feedbackSampleL = opAmpSaturate(d2OutL * fbPotGain, 0.9);
    this.feedbackSampleR = opAmpSaturate(d2OutR * fbPotGain, 0.9);

    const rawWetL = (this.tankDelay1L.read(Math.round(266 * scaleSR))
      + this.tankDelay1L.read(Math.round(2974 * scaleSR))
      - this.tankAllpass2L.process(this.tankDelay2L.read(Math.round(1913 * scaleSR)))
      + this.tankDelay2L.read(Math.round(1996 * scaleSR))
      - this.tankDelay1R.read(Math.round(1990 * scaleSR))) * 0.45;

    const rawWetR = (this.tankDelay1R.read(Math.round(353 * scaleSR))
      + this.tankDelay1R.read(Math.round(3627 * scaleSR))
      - this.tankAllpass2R.process(this.tankDelay2R.read(Math.round(1228 * scaleSR)))
      + this.tankDelay2R.read(Math.round(2673 * scaleSR))
      - this.tankDelay1L.read(Math.round(1066 * scaleSR))) * 0.45;

    const deEmphL = this.postFilterLP_L.process(this.deEmphasisL.process(rawWetL));
    const deEmphR = this.postFilterLP_R.process(this.deEmphasisR.process(rawWetR));

    const wetGain = (this.params.wet / 100) * 1.1;
    const effectL = deEmphL * wetGain;
    const effectR = deEmphR * wetGain;

    const sumL = this.sumFilterLP_L.process(-(directL + effectL));
    const sumR = this.sumFilterLP_R.process(-(directR + effectR));

    const satOutL = opAmpSaturate(sumL, 1.0);
    const satOutR = opAmpSaturate(sumR, 1.0);

    let finalOutL = this.outLP_L.process(this.outHP_L.process(satOutL));
    let finalOutR = this.outLP_R.process(this.outHP_R.process(satOutR));

    const sep = this.params.sep / 100;
    const outMid = (finalOutL + finalOutR) * 0.5;
    const outSide = (finalOutL - finalOutR) * 0.5;
    finalOutL = outMid + outSide * (1.0 + sep);
    finalOutR = outMid - outSide * (1.0 + sep);

    return { outL: finalOutL, outR: finalOutR };
  }
}

class ProReverbProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.params = {};
    this.dsp = new CircuitReverbDSP(sampleRate, this.params);

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'UPDATE_PARAMS') {
        this.params = { ...this.params, ...event.data.params };
        this.dsp.params = this.params;
        this.dsp.updateFilters();
      }
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output[1] || output[0];
    const inL = (input && input[0]) || new Float32Array(outL.length);
    const inR = (input && input[1]) || inL;

    for (let i = 0; i < outL.length; i++) {
      const res = this.dsp.processSample(inL[i], inR[i]);
      outL[i] = res.outL;
      outR[i] = res.outR;
    }

    return true;
  }
}

registerProcessor('pro-reverb-processor', ProReverbProcessor);
`;
