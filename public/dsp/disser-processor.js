const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dbToGain = (db) => Math.pow(10, db / 20);
const gainToDb = (gain) => 20 * Math.log10(Math.max(1e-9, gain));

class BiquadSection {
  constructor() {
    this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0;
    this.z1 = [0, 0]; this.z2 = [0, 0];
  }

  setLowpass(frequency, q = Math.SQRT1_2) { this.setCoefficients('lowpass', frequency, q); }
  setHighpass(frequency, q = Math.SQRT1_2) { this.setCoefficients('highpass', frequency, q); }

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
 * Crossover reconstruction:
 * - first LR4 split => low / upper
 * - upper is split again => sibilance / high
 * - low receives the second crossover's LP4+HP4 phase rotation
 * With zero gain reduction the three bands reconstruct as an all-pass magnitude
 * response, so moving the selected range does not secretly EQ the vocal.
 *
 * Detector:
 * Absolute S-band dBFS alone is not reliable because vocal recording levels vary.
 * We therefore track both the selected S-band envelope and a broadband envelope.
 * Detection requires enough absolute S-band level AND enough high-frequency
 * prominence relative to the body of the vocal. The Detection control changes
 * both sensitivity margins; Threshold remains the absolute floor control.
 */
class DisserProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'lowFreq', defaultValue: 4500, minValue: 2500, maxValue: 10000, automationRate: 'k-rate' },
      { name: 'highFreq', defaultValue: 9500, minValue: 3500, maxValue: 16000, automationRate: 'k-rate' },
      { name: 'threshold', defaultValue: -28, minValue: -60, maxValue: -4, automationRate: 'k-rate' },
      { name: 'detection', defaultValue: 65, minValue: 0, maxValue: 100, automationRate: 'k-rate' },
      { name: 'amountDb', defaultValue: 8, minValue: 0, maxValue: 18, automationRate: 'k-rate' },
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

    this.sibEnvelope = 0;
    this.broadbandEnvelope = 0;
    this.gain = 1;
    this.reductionDb = 0;
    this.detectorDb = -120;
    this.rawSibilanceDb = -120;
    this.broadbandDb = -120;
    this.prominenceDb = -120;
    this.triggerExcessDb = 0;

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
    const detection = clamp(parameters.detection[0], 0, 100);
    const amountDb = clamp(parameters.amountDb[0], 0, 18);
    const attackSeconds = Math.max(0.0005, parameters.attackMs[0] / 1000);
    const releaseSeconds = Math.max(0.01, parameters.releaseMs[0] / 1000);
    const listen = parameters.listen[0] >= 0.5;
    const wideMode = parameters.mode[0] >= 0.5;

    this.updateCrossovers(low, high);

    const sibAttackCoeff = Math.exp(-1 / (sampleRate * attackSeconds));
    const sibReleaseCoeff = Math.exp(-1 / (sampleRate * releaseSeconds));
    const broadAttackCoeff = Math.exp(-1 / (sampleRate * 0.0015));
    const broadReleaseCoeff = Math.exp(-1 / (sampleRate * 0.075));
    const gainAttackCoeff = Math.exp(-1 / (sampleRate * Math.max(0.0005, attackSeconds * 0.55)));
    const gainReleaseCoeff = Math.exp(-1 / (sampleRate * Math.max(0.012, releaseSeconds * 0.8)));
    const frameCount = output[0].length;

    const detectionNorm = detection / 100;
    // Higher Detection means the S-band may sit further below the broadband body
    // and still count as sibilance. At the default 65, ~22 dB of relative margin
    // is allowed, which works much better across quiet and loud vocal recordings.
    const prominenceThresholdDb = -8 - detectionNorm * 22;
    // Threshold is still meaningful, but Detection can extend the effective floor
    // downward so a quiet recording does not behave as if the plugin were bypassed.
    const absoluteGateDb = threshold - (4 + detectionNorm * 18);

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

        const compensatedLow =
          this.lowPhaseLowPass.process(lowBase, channel) +
          this.lowPhaseHighPass.process(lowBase, channel);
        const sibBand = this.sibLowPass.process(upper, channel);
        const highBand = this.highPass.process(upper, channel);

        lows[channel] = compensatedLow;
        sibs[channel] = sibBand;
        highs[channel] = highBand;
      }

      const sibPeak = Math.max(Math.abs(sibs[0]), Math.abs(sibs[1]), 1e-9);
      const fullPeak = Math.max(Math.abs(samples[0]), Math.abs(samples[1]), 1e-9);

      const sibCoeff = sibPeak > this.sibEnvelope ? sibAttackCoeff : sibReleaseCoeff;
      this.sibEnvelope = sibPeak + sibCoeff * (this.sibEnvelope - sibPeak);

      const broadCoeff = fullPeak > this.broadbandEnvelope ? broadAttackCoeff : broadReleaseCoeff;
      this.broadbandEnvelope = fullPeak + broadCoeff * (this.broadbandEnvelope - fullPeak);

      this.rawSibilanceDb = gainToDb(this.sibEnvelope);
      this.broadbandDb = gainToDb(this.broadbandEnvelope);
      this.prominenceDb = this.rawSibilanceDb - this.broadbandDb;

      const levelExcess = this.rawSibilanceDb - absoluteGateDb;
      const prominenceExcess = this.prominenceDb - prominenceThresholdDb;

      // Both conditions matter. The +6 dB knee allowance prevents the relative
      // test from becoming a hard gate while still rejecting normal vowels whose
      // upper-band energy is weak relative to the vocal body.
      const combinedExcess = Math.min(levelExcess, prominenceExcess + 6);
      this.triggerExcessDb = Math.max(0, combinedExcess);

      // A smooth saturating gain computer is easier to tune than compressor ratio.
      // Amount is a true maximum attenuation, never makeup gain.
      const targetReductionDb = this.triggerExcessDb > 0
        ? amountDb * (1 - Math.exp(-this.triggerExcessDb / 5.0))
        : 0;
      const targetGain = dbToGain(-targetReductionDb);
      const gainCoeff = targetGain < this.gain ? gainAttackCoeff : gainReleaseCoeff;
      this.gain = targetGain + gainCoeff * (this.gain - targetGain);
      this.reductionDb = Math.max(0, -gainToDb(this.gain));

      // UI detector value follows the same trigger domain as the gain computer.
      this.detectorDb = absoluteGateDb + this.triggerExcessDb;

      for (let channel = 0; channel < output.length; channel++) {
        const index = Math.min(channel, 1);
        if (listen) {
          output[channel][frame] = sibs[index];
        } else if (wideMode) {
          output[channel][frame] = samples[index] * this.gain;
        } else {
          output[channel][frame] = lows[index] + sibs[index] * this.gain + highs[index];
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
        rawSibilanceDb: this.rawSibilanceDb,
        broadbandDb: this.broadbandDb,
        prominenceDb: this.prominenceDb,
        triggerExcessDb: this.triggerExcessDb,
      });
    }

    return true;
  }
}

registerProcessor('disser-dynamic-sibilance', DisserProcessor);
