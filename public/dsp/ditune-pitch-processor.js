/**
 * DiTune continuous pitch-correction processor.
 *
 * A two-head, overlap-add delay-line shifter designed for small vocal tuning
 * moves. Unlike Tone.PitchShift's public pitch setter, the read-head velocity
 * changes continuously sample-by-sample, so correction updates and sign
 * changes do not restart/reverse LFO ranges at control-rate boundaries.
 */
class DiTunePitchCorrectionProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'semitones',
        defaultValue: 0,
        minValue: -2,
        maxValue: 2,
        automationRate: 'a-rate',
      },
      {
        name: 'windowMs',
        defaultValue: 52,
        minValue: 28,
        maxValue: 90,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();

    // Enough history for 90 ms windows even at unusually high sample rates.
    this.bufferLength = 65536;
    this.buffers = [
      new Float32Array(this.bufferLength),
      new Float32Array(this.bufferLength),
    ];

    this.writeIndex = 0;
    this.phase = 0;
    this.smoothedRatio = 1;
    this.smoothedWindow = Math.max(32, sampleRate * 0.052);
    this.shiftMix = 0;
    this.framesWritten = 0;

    this.ratioAlpha = 1 - Math.exp(-1 / (sampleRate * 0.0045));
    this.windowAlpha = 1 - Math.exp(-1 / (sampleRate * 0.035));
    this.mixAlpha = 1 - Math.exp(-1 / (sampleRate * 0.008));
  }

  wrapIndex(index) {
    let wrapped = index % this.bufferLength;
    if (wrapped < 0) wrapped += this.bufferLength;
    return wrapped;
  }

  readCubic(buffer, position) {
    const base = Math.floor(position);
    const x = position - base;

    const i0 = this.wrapIndex(base - 1);
    const i1 = this.wrapIndex(base);
    const i2 = this.wrapIndex(base + 1);
    const i3 = this.wrapIndex(base + 2);

    const y0 = buffer[i0];
    const y1 = buffer[i1];
    const y2 = buffer[i2];
    const y3 = buffer[i3];

    const a0 = -0.5 * y0 + 1.5 * y1 - 1.5 * y2 + 0.5 * y3;
    const a1 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const a2 = -0.5 * y0 + 0.5 * y2;
    const a3 = y1;

    return ((a0 * x + a1) * x + a2) * x + a3;
  }

  readDelay(buffer, delaySamples) {
    return this.readCubic(buffer, this.writeIndex - delaySamples);
  }

  smoothStep01(value) {
    const x = Math.max(0, Math.min(1, value));
    return x * x * (3 - 2 * x);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    if (!output.length) return true;

    const frameCount = output[0].length;
    const semitoneValues = parameters.semitones;
    const windowValues = parameters.windowMs;
    const twoPi = Math.PI * 2;

    for (let frame = 0; frame < frameCount; frame++) {
      // Write the incoming frame first. A mono source is mirrored into the
      // second history buffer so the same processor remains stereo-safe.
      for (let channel = 0; channel < 2; channel++) {
        const source = input[channel] || input[0];
        this.buffers[channel][this.writeIndex] = source ? (source[frame] || 0) : 0;
      }

      const semitones = semitoneValues.length > 1
        ? semitoneValues[frame]
        : semitoneValues[0];

      const targetRatio = Math.pow(2, semitones / 12);
      this.smoothedRatio += (targetRatio - this.smoothedRatio) * this.ratioAlpha;

      const requestedWindowMs = windowValues.length > 1
        ? windowValues[frame]
        : windowValues[0];
      const targetWindow = Math.max(
        sampleRate * 0.028,
        Math.min(sampleRate * 0.09, sampleRate * requestedWindowMs / 1000),
      );
      this.smoothedWindow += (targetWindow - this.smoothedWindow) * this.windowAlpha;

      // readSpeed = 1 - d(delay)/dt. Advancing this phase by (ratio - 1)
      // therefore makes the read heads move at the requested pitch ratio. The
      // phase simply reverses direction when correction crosses zero; no delay
      // range is reconfigured, which avoids the classic sign-change glitch.
      this.phase += (this.smoothedRatio - 1) / Math.max(32, this.smoothedWindow);
      this.phase -= Math.floor(this.phase);

      const phaseA = this.phase;
      const phaseB = (this.phase + 0.5) % 1;

      const gainA = 0.5 - 0.5 * Math.cos(twoPi * phaseA);
      const gainB = 0.5 - 0.5 * Math.cos(twoPi * phaseB);

      const safetyDelay = 4;
      const delayA = safetyDelay + (1 - phaseA) * this.smoothedWindow;
      const delayB = safetyDelay + (1 - phaseB) * this.smoothedWindow;
      const neutralDelay = safetyDelay + this.smoothedWindow * 0.5;

      // Very small corrections are better served by a clean, latency-matched
      // neutral tap than by running two grains. Fade the shifter in only once
      // there is a musically meaningful correction (~1-4 cents).
      const correctionCents = Math.abs(12 * Math.log2(Math.max(1e-9, this.smoothedRatio))) * 100;
      const targetShiftMix = this.smoothStep01((correctionCents - 1.0) / 3.0);
      this.shiftMix += (targetShiftMix - this.shiftMix) * this.mixAlpha;

      const enoughHistory = this.framesWritten > this.smoothedWindow + 8;

      for (let channel = 0; channel < output.length; channel++) {
        const source = input[channel] || input[0];
        const history = this.buffers[Math.min(channel, 1)];

        if (!enoughHistory) {
          output[channel][frame] = source ? (source[frame] || 0) : 0;
          continue;
        }

        const shifted =
          this.readDelay(history, delayA) * gainA +
          this.readDelay(history, delayB) * gainB;
        const neutral = this.readDelay(history, neutralDelay);

        output[channel][frame] =
          neutral * (1 - this.shiftMix) +
          shifted * this.shiftMix;
      }

      this.writeIndex += 1;
      if (this.writeIndex >= this.bufferLength) this.writeIndex = 0;
      this.framesWritten += 1;
    }

    return true;
  }
}

registerProcessor('ditune-pitch-correction', DiTunePitchCorrectionProcessor);
