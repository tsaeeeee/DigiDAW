const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dbToGain = (db) => Math.pow(10, db / 20);
const gainToDb = (gain) => 20 * Math.log10(Math.max(1e-9, gain));

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
    this.setBasicCoefficients('lowpass', frequency, q);
  }

  setHighpass(frequency, q = Math.SQRT1_2) {
    this.setBasicCoefficients('highpass', frequency, q);
  }

  setBasicCoefficients(type, frequency, q) {
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

  /**
   * RBJ high-shelf. gainDb is always <= 0 in Disser, so this stage has no
   * positive-gain state. At 0 dB the numerator and denominator become equal
   * and the filter is an exact unity transfer function.
   */
  setHighShelf(frequency, gainDb, slope = 0.7) {
    const f = clamp(frequency, 20, sampleRate * 0.45);
    const safeGainDb = clamp(gainDb, -24, 0);
    const safeSlope = clamp(slope, 0.25, 1);
    const A = Math.pow(10, safeGainDb / 40);
    const omega = 2 * Math.PI * f / sampleRate;
    const cos = Math.cos(omega);
    const sin = Math.sin(omega);
    const alpha = (sin * 0.5) * Math.sqrt(
      Math.max(0, (A + 1 / A) * (1 / safeSlope - 1) + 2),
    );
    const beta = 2 * Math.sqrt(A) * alpha;

    const b0 = A * ((A + 1) + (A - 1) * cos + beta);
    const b1 = -2 * A * ((A - 1) + (A + 1) * cos);
    const b2 = A * ((A + 1) + (A - 1) * cos - beta);
    const a0 = (A + 1) - (A - 1) * cos + beta;
    const a1 = 2 * ((A - 1) - (A + 1) * cos);
    const a2 = (A + 1) - (A - 1) * cos - beta;

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(sample, channel) {
    const index = Math.min(channel, 1);
    const output = this.b0 * sample + this.z1[index];
    this.z1[index] = this.b1 * sample - this.a1 * output + this.z2[index];
    this.z2[index] = this.b2 * sample - this.a2 * output;
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

class DynamicHighShelf {
  constructor() {
    this.filter = new BiquadSection();
    this.centerHz = 6500;
    this.slope = 0.7;
    this.lastGainDb = Number.NaN;
    this.lastLow = -1;
    this.lastHigh = -1;
    this.setRange(4500, 9500);
    this.setGainDb(0, true);
  }

  /**
   * The user-selected low/high values remain the detector boundaries. For the
   * audio path they describe the transition region of a subtractive shelf:
   * narrow ranges produce a steeper shelf; broad ranges produce a gentler one.
   * Frequencies above the selected range are therefore not left as an untreated
   * "air" branch that can sound relatively boosted after de-essing.
   */
  setRange(low, high) {
    if (Math.abs(low - this.lastLow) < 0.1 && Math.abs(high - this.lastHigh) < 0.1) return;
    this.lastLow = low;
    this.lastHigh = high;

    const safeLow = clamp(low, 2500, Math.min(10000, sampleRate * 0.34));
    const safeHigh = clamp(
      Math.max(safeLow + 500, high),
      safeLow + 500,
      Math.min(16000, sampleRate * 0.45),
    );

    this.centerHz = Math.sqrt(safeLow * safeHigh);
    const octaveWidth = Math.max(0.2, Math.log2(safeHigh / safeLow));
    this.slope = clamp(1 / (octaveWidth * 1.3), 0.3, 1);
    this.lastGainDb = Number.NaN;
  }

  setGainDb(gainDb, force = false) {
    const safe = clamp(gainDb, -18, 0);
    if (!force && Number.isFinite(this.lastGainDb) && Math.abs(safe - this.lastGainDb) < 0.006) return;
    this.lastGainDb = safe;
    this.filter.setHighShelf(this.centerHz, safe, this.slope);
  }

  process(sample, channel) {
    return this.filter.process(sample, channel);
  }
}

/**
 * Disser dynamic sibilance processor.
 *
 * Detection and processing are intentionally separate:
 *
 *   detector: input -> HP4(low) -> LP4(high) -> envelope/prominence detector
 *
 *   Split audio: input -> single-path dynamic high-shelf attenuation -> output
 *   Wide audio:  input -> broadband gain attenuation -> output
 *
 * The previous Split engine reconstructed low + attenuated-S + high crossover
 * branches. That reconstruction was flat at 0 dB GR, but once the S branch was
 * reduced the untouched band above Range High could become perceptually dominant
 * (and time-varying branch phase could make the result feel like a high boost).
 * The new Split path never sums parallel frequency bands and has no makeup gain.
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

    // Detector-only filters. They never participate in Normal audio output.
    this.detectorHighPass = new Lr4Filter('highpass');
    this.detectorLowPass = new Lr4Filter('lowpass');
    this.dynamicShelf = new DynamicHighShelf();

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

  updateRange(low, high) {
    const safeLow = clamp(low, 2500, Math.min(10000, sampleRate * 0.34));
    const safeHigh = clamp(
      Math.max(safeLow + 500, high),
      safeLow + 500,
      Math.min(16000, sampleRate * 0.45),
    );

    if (Math.abs(safeLow - this.lastLow) > 0.1) {
      this.detectorHighPass.setFrequency(safeLow);
      this.lastLow = safeLow;
    }
    if (Math.abs(safeHigh - this.lastHigh) > 0.1) {
      this.detectorLowPass.setFrequency(safeHigh);
      this.lastHigh = safeHigh;
    }

    this.dynamicShelf.setRange(safeLow, safeHigh);
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

    this.updateRange(low, high);

    const sibAttackCoeff = Math.exp(-1 / (sampleRate * attackSeconds));
    const sibReleaseCoeff = Math.exp(-1 / (sampleRate * releaseSeconds));
    const broadAttackCoeff = Math.exp(-1 / (sampleRate * 0.0015));
    const broadReleaseCoeff = Math.exp(-1 / (sampleRate * 0.075));
    const gainAttackCoeff = Math.exp(-1 / (sampleRate * Math.max(0.0005, attackSeconds * 0.55)));
    const gainReleaseCoeff = Math.exp(-1 / (sampleRate * Math.max(0.012, releaseSeconds * 0.8)));
    const frameCount = output[0].length;

    const detectionNorm = detection / 100;
    const prominenceThresholdDb = -8 - detectionNorm * 22;
    const absoluteGateDb = threshold - (4 + detectionNorm * 18);

    for (let frame = 0; frame < frameCount; frame++) {
      const inputL = input[0] ? (input[0][frame] || 0) : 0;
      const inputR = input[1] ? (input[1][frame] || 0) : inputL;
      const samples = [inputL, inputR];
      const sibs = [0, 0];

      // Detector sidechain only. The main Split signal never enters this graph.
      for (let channel = 0; channel < 2; channel++) {
        const hp = this.detectorHighPass.process(samples[channel], channel);
        sibs[channel] = this.detectorLowPass.process(hp, channel);
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
      const combinedExcess = Math.min(levelExcess, prominenceExcess + 6);
      this.triggerExcessDb = Math.max(0, combinedExcess);

      const targetReductionDb = this.triggerExcessDb > 0
        ? amountDb * (1 - Math.exp(-this.triggerExcessDb / 5.0))
        : 0;
      const targetGain = dbToGain(-targetReductionDb);
      const gainCoeff = targetGain < this.gain ? gainAttackCoeff : gainReleaseCoeff;
      this.gain = targetGain + gainCoeff * (this.gain - targetGain);
      this.reductionDb = Math.max(0, -gainToDb(this.gain));
      this.detectorDb = absoluteGateDb + this.triggerExcessDb;

      // Coefficients only change when the smoothed reduction has moved by a
      // meaningful fraction of a centibel. gainDb is clamped <= 0, so Split has
      // no positive-gain filter state at any point.
      this.dynamicShelf.setGainDb(-this.reductionDb);

      for (let channel = 0; channel < output.length; channel++) {
        const index = Math.min(channel, 1);
        if (listen) {
          output[channel][frame] = sibs[index];
        } else if (wideMode) {
          output[channel][frame] = samples[index] * this.gain;
        } else {
          output[channel][frame] = this.dynamicShelf.process(samples[index], index);
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
