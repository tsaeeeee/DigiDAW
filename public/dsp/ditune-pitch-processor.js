/**
 * DiTune continuous vocal pitch-correction processor.
 *
 * Optimized for the small pitch moves used by vocal correction.
 *
 * Key properties:
 * - two continuously moving overlap-add read heads
 * - cubic delay-line interpolation
 * - sample-domain pitch-ratio slew
 * - grain/window length aligned to an EVEN number of detected F0 periods
 * - near-zero phase parking instead of crossfading differently delayed taps
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
      {
        name: 'inputHz',
        defaultValue: 180,
        minValue: 55,
        maxValue: 1050,
        automationRate: 'k-rate',
      },
    ];
  }

  constructor() {
    super();

    this.bufferLength = 65536;
    this.buffers = [
      new Float32Array(this.bufferLength),
      new Float32Array(this.bufferLength),
    ];

    this.writeIndex = 0;
    this.phase = 0;
    this.smoothedRatio = 1;
    this.smoothedPitchHz = 180;
    this.smoothedWindow = Math.max(32, sampleRate * 0.052);
    this.framesWritten = 0;

    // The controller already performs the musical retune envelope. These are
    // audio-thread anti-zipper / anti-splice smoothers only.
    this.ratioAlpha = 1 - Math.exp(-1 / (sampleRate * 0.007));
    this.pitchAlpha = 1 - Math.exp(-1 / (sampleRate * 0.045));
    this.windowAlpha = 1 - Math.exp(-1 / (sampleRate * 0.05));
    this.parkAlpha = 1 - Math.exp(-1 / (sampleRate * 0.020));
  }

  wrapIndex(index) {
    let wrapped = index % this.bufferLength;
    if (wrapped < 0) wrapped += this.bufferLength;
    return wrapped;
  }

  circularDelta(from, to) {
    let delta = to - from;
    while (delta > 0.5) delta -= 1;
    while (delta < -0.5) delta += 1;
    return delta;
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

  process(inputs, outputs, parameters) {
    const input = inputs[0] || [];
    const output = outputs[0] || [];
    if (!output.length) return true;

    const frameCount = output[0].length;
    const semitoneValues = parameters.semitones;
    const windowValues = parameters.windowMs;
    const inputHzValues = parameters.inputHz;
    const twoPi = Math.PI * 2;

    for (let frame = 0; frame < frameCount; frame++) {
      // Mono sources are mirrored to channel 2. Native stereo keeps independent
      // histories so the insert never collapses the channel topology.
      for (let channel = 0; channel < 2; channel++) {
        const source = input[channel] || input[0];
        this.buffers[channel][this.writeIndex] = source ? (source[frame] || 0) : 0;
      }

      const requestedSemitones = semitoneValues.length > 1
        ? semitoneValues[frame]
        : semitoneValues[0];
      const targetRatio = Math.pow(2, requestedSemitones / 12);
      this.smoothedRatio += (targetRatio - this.smoothedRatio) * this.ratioAlpha;

      const requestedPitchHz = inputHzValues.length > 1
        ? inputHzValues[frame]
        : inputHzValues[0];
      const safePitchHz = Math.max(55, Math.min(1050, requestedPitchHz || 180));
      this.smoothedPitchHz += (safePitchHz - this.smoothedPitchHz) * this.pitchAlpha;

      const requestedWindowMs = windowValues.length > 1
        ? windowValues[frame]
        : windowValues[0];
      const baseWindow = Math.max(
        sampleRate * 0.028,
        Math.min(sampleRate * 0.09, sampleRate * requestedWindowMs / 1000),
      );

      // The two overlap heads are separated by half a grain. If the grain has
      // an odd number of F0 periods, half a grain is N + 0.5 periods and the
      // fundamental can meet 180 degrees out of phase during the crossfade.
      // Force an EVEN cycle count so half-window is always a whole number of
      // vocal periods. This is the most important phase-coherence rule here.
      const periodSamples = sampleRate / Math.max(55, this.smoothedPitchHz);
      const rawCycles = baseWindow / periodSamples;
      const cycles = Math.max(4, Math.min(40, Math.round(rawCycles / 2) * 2));
      const synchronousWindow = Math.max(
        sampleRate * 0.028,
        Math.min(sampleRate * 0.09, cycles * periodSamples),
      );
      this.smoothedWindow += (synchronousWindow - this.smoothedWindow) * this.windowAlpha;

      // Once close enough, snap exactly onto the period-synchronous geometry.
      // The approach remains smooth, but the steady-state overlap is not left a
      // fraction of a period away from its phase-coherent target forever.
      if (Math.abs(synchronousWindow - this.smoothedWindow) < periodSamples * 0.06) {
        this.smoothedWindow = synchronousWindow;
      }

      const correctionCents = Math.abs(12 * Math.log2(Math.max(1e-9, this.smoothedRatio))) * 100;

      // Continuous read-head velocity. Crossing correction zero merely reverses
      // phase direction; nothing gets reconfigured or restarted.
      this.phase += (this.smoothedRatio - 1) / Math.max(32, this.smoothedWindow);
      this.phase -= Math.floor(this.phase);

      // Do NOT crossfade a neutral tap against the two-head shifter near zero.
      // Those paths have different delay/phase and can create a metallic comb
      // filter. Instead, gently park phase at 0 or 0.5. At either anchor one
      // Hann head is fully closed and the other fully open, leaving one clean
      // latency-matched delay tap.
      if (correctionCents < 2.2) {
        const distanceToZero = Math.abs(this.circularDelta(this.phase, 0));
        const distanceToHalf = Math.abs(this.circularDelta(this.phase, 0.5));
        const anchor = distanceToZero <= distanceToHalf ? 0 : 0.5;
        const parkStrength = 1 - correctionCents / 2.2;
        this.phase += this.circularDelta(this.phase, anchor) * this.parkAlpha * parkStrength;
        this.phase -= Math.floor(this.phase);
      }

      const phaseA = this.phase;
      const phaseB = (this.phase + 0.5) % 1;

      // Half-cycle-offset Hann windows are complementary: gainA + gainB = 1.
      const gainA = 0.5 - 0.5 * Math.cos(twoPi * phaseA);
      const gainB = 0.5 - 0.5 * Math.cos(twoPi * phaseB);

      const safetyDelay = 6;
      const delayA = safetyDelay + (1 - phaseA) * this.smoothedWindow;
      const delayB = safetyDelay + (1 - phaseB) * this.smoothedWindow;
      const enoughHistory = this.framesWritten > this.smoothedWindow + 12;

      for (let channel = 0; channel < output.length; channel++) {
        const source = input[channel] || input[0];
        const history = this.buffers[Math.min(channel, 1)];

        if (!enoughHistory) {
          output[channel][frame] = source ? (source[frame] || 0) : 0;
          continue;
        }

        output[channel][frame] =
          this.readDelay(history, delayA) * gainA +
          this.readDelay(history, delayB) * gainB;
      }

      this.writeIndex += 1;
      if (this.writeIndex >= this.bufferLength) this.writeIndex = 0;
      this.framesWritten += 1;
    }

    return true;
  }
}

registerProcessor('ditune-pitch-correction', DiTunePitchCorrectionProcessor);
