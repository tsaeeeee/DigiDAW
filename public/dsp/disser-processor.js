const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

class BiquadSection {
  constructor() {
    this.b0 = 1;
    this.b1 = 0;
    this.b2 = 0;
    this.a1 = 0;
    this.a2 = 0;
    this.z1 = [0, 0];
    this.z2 = [0, 0];
  }

  setLowpass(frequency, q = Math.SQRT1_2) {
    this.setCoefficients('lowpass', frequency, q);
  }

  setHighpass(frequency, q = Math.SQRT1_2) {
    this.setCoefficients('highpass', frequency, q);
  }

  setCoefficients(type, frequency, q) {
    const f = clamp(frequency, 20, sampleRate * 0.45);
    const omega = 2 * Math.PI * f / sampleRate;
    const cos = Math.cos(omega);
    const sin = Math.sin(omega);
    const alpha = sin / (2 * Math.max(0.001, q));
    const a0 = 1 + alpha;

    if (type === 'lowpass') {
      this.b0 = ((1 - cos) * 0.5) / a0;
      this.b1 = (1 - cos) / a0;
      this.b2 = this.b0;
    } else {
      this.b0 = ((1 + cos) * 0.5) / a0;
      this.b1 = -(1 + cos) / a0;
      this.b2 = this.b0;
    }

    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(sample, channel) {
    const output = this.b0 * sample + this.z1[channel];
    this.z1[channel] = this.b1 * sample - this.a1 * output + this.z2[channel];
    this.z2[channel] = this.b2 * sample - this.a2 * output;
    return output;
  }
}

class Lr4Filter {
  constructor(type) {
    this.type = type;
    this.first = new BiquadSection();
    this.second = new BiquadSection();
  }

  setFrequency(frequency) {
    if (this.type === 'lowpass') {
      this.first.setLowpass(frequency);
      this.second.setLowpass(frequency);
    } else {
      this.first.setHighpass(frequency);
      this.second.setHighpass(frequency);
    }
  }

  process(sample, channel) {
    return this.second.process(this.first.process(sample, channel), channel);
  }
}

/**
 * Disser dynamic sibilance processor.
 *
 * The first LR4 split creates low + upper. The upper branch is split again into
 * sibilance + high. A second high-crossover LP4+HP4 pair is applied to the low
 * branch as a phase-compensation all-pass. Therefore, with 0 dB gain reduction:
 *
 * compensatedLow + sibilance + high
 * = A(high) * low + A(high) * upper
 * = A(high) * A(low) * input
 *
 * The magnitude stays unity while only phase rotates. Moving Range controls can
 * no longer behave like a hidden treble EQ when the compressor is idle.
 *
 * Detector and gain computer live in this same AudioWorklet. No branch uses a
 * DynamicsCompressorNode, so there is no hidden lookahead-latency mismatch.
 */
class DisserProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'lowFreq', defaultValue: 4500, minValue: 2500, maxValue: 10000, automationRate: 'k-rate' },
      { name: 'highFreq', defaultValue: 9500, minValue: 3500, maxValue: 16000, automationRate: 'k-rate' },
      { name: 'threshold', defaultValue: -28, minValue: -60, maxValue: -4, automationRate: 'k-rate' },
      { name: 'ratio', defaultValue: 6, minValue: 1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'attackMs', defaultValue: 3, minValue: 0.5, maxValue: 50, automationRate: 'k-rate' },
      { name: 'releaseMs', defaultValue: 80, minValue: 10, maxValue: 500, automationRate: 'k-rate' },
      { name: 'listen', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'mode', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();

    this.lowPass = new Lr4Filter('lowpass');
    this.upperHighPass = new Lr4Filter('highpass');

    this.lowPhaseLowPass = new Lr4Filter('lowpass');
    this.lowPhaseHighPass = new Lr4Filter('highpass');

    this.sibLowPass = new Lr4Filter('lowpass');
    this.highPass = new Lr4Filter('highpass');

    this.envelope = 0;
    this.gain = 1;
    this.reductionDb = 0;
    this.detectorDb = -120;
    this.blockCounter = 0;
    this.lastLow = -1;
    this.lastHigh = -1;
  }

  updateCrossovers(low, high) {
    const safeLow = clamp(low, 2500, Math.min(10000, sampleRate * 0.34));
    const safeHigh = clamp(
      Math.max(safeLow + 500, high),
      safeLow + 500,
      Math.min(16000, sampleRate * 0.45),
    );

    if (Math.abs(safeLow - this.lastLow) > 0.1) {
      this.lowPass.setFrequency(safeLow);
      this.upperHighPass.setFrequency(safeLow);
      this.lastLow = safeLow;
    }

    if (Math.abs(safeHigh - this.lastHigh) > 0.1) {
      this.lowPhaseLowPass.setFrequency(safeHigh);
      this.lowPhaseHighPass.setFrequency(safeHigh);
      this.sibLowPass.setFrequency(safeHigh);
      this.highPass.setFrequency(safeHigh);
      this.lastHigh = safeHigh;
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    if (!output.length) return true;

    const low = parameters.lowFreq[0];
    const high = parameters.highFreq[0];
    const threshold = parameters.threshold[0];
    const ratio = Math.max(1, parameters.ratio[0]);
    const attackSeconds = Math.max(0.0005, parameters.attackMs[0] / 1000);
    const releaseSeconds = Math.max(0.01, parameters.releaseMs[0] / 1000);
    const listen = parameters.listen[0] >= 0.5;
    const wideMode = parameters.mode[0] >= 0.5;

    this.updateCrossovers(low, high);

    const attackCoeff = Math.exp(-1 / (sampleRate * attackSeconds));
    const releaseCoeff = Math.exp(-1 / (sampleRate * releaseSeconds));
    const gainSlew = 1 - Math.exp(-1 / (sampleRate * 0.0015));
    const frameCount = output[0].length;

    for (let frame = 0; frame < frameCount; frame++) {
      const inputL = input[0] ? (input[0][frame] || 0) : 0;
      const inputR = input[1] ? (input[1][frame] || 0) : inputL;
      const samples = [inputL, inputR];
      const lows = [0, 0];
      const sibs = [0, 0];
      const highs = [0, 0];

      for (let channel = 0; channel < 2; channel++) {
        const sample = samples[channel];
        const lowBase = this.lowPass.process(sample, channel);
        const upper = this.upperHighPass.process(sample, channel);

        // Sum of the high-crossover LR4 LP/HP pair is an all-pass. Applying that
        // same phase rotation to the low branch keeps the full three-way sum
        // magnitude-flat when no gain reduction is active.
        const compensatedLow =
          this.lowPhaseLowPass.process(lowBase, channel) +
          this.lowPhaseHighPass.process(lowBase, channel);

        const sibBand = this.sibLowPass.process(upper, channel);
        const highBand = this.highPass.process(upper, channel);

        lows[channel] = compensatedLow;
        sibs[channel] = sibBand;
        highs[channel] = highBand;
      }

      const detector = Math.max(Math.abs(sibs[0]), Math.abs(sibs[1]), 1e-9);
      const envelopeCoeff = detector > this.envelope ? attackCoeff : releaseCoeff;
      this.envelope = detector + envelopeCoeff * (this.envelope - detector);
      this.detectorDb = 20 * Math.log10(Math.max(1e-9, this.envelope));

      let targetReductionDb = 0;
      if (this.detectorDb > threshold && ratio > 1.0001) {
        targetReductionDb = (this.detectorDb - threshold) * (1 - 1 / ratio);
      }
      targetReductionDb = clamp(targetReductionDb, 0, 24);

      const targetGain = Math.pow(10, -targetReductionDb / 20);
      this.gain += (targetGain - this.gain) * gainSlew;
      this.reductionDb = Math.max(0, -20 * Math.log10(Math.max(1e-9, this.gain)));

      for (let channel = 0; channel < output.length; channel++) {
        const index = Math.min(channel, 1);

        if (listen) {
          // Listen is exactly the detector range before attenuation.
          output[channel][frame] = sibs[index];
        } else if (wideMode) {
          // Wide: selected S-band detects, whole vocal ducks. There is no makeup
          // gain, so this mode can only attenuate, never boost.
          output[channel][frame] = samples[index] * this.gain;
        } else {
          // Split: only selected S-band is attenuated. Low/high remain unity and
          // the phase-compensated crossover reconstructs flat at 0 dB GR.
          output[channel][frame] =
            lows[index] + sibs[index] * this.gain + highs[index];
        }
      }
    }

    this.blockCounter += 1;
    if (this.blockCounter >= 8) {
      this.blockCounter = 0;
      this.port.postMessage({
        type: 'telemetry',
        reductionDb: this.reductionDb,
        detectorDb: this.detectorDb,
      });
    }

    return true;
  }
}

registerProcessor('disser-dynamic-sibilance', DisserProcessor);
