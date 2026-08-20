/**
 * DiTune continuous vocal pitch-correction processor.
 *
 * This is intentionally optimized for the small pitch moves used by vocal
 * correction rather than octave-scale creative transposition.
 *
 * Key properties:
 * - two continuously moving overlap-add read heads
 * - cubic delay-line interpolation
 * - sample-domain pitch-ratio slew
 * - grain/window length aligned to an integer number of detected F0 periods
 * - hysteretic near-zero neutral mode so 1-5 cent fluctuations do not chatter
 *   between two differently phased signal paths every control frame
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
    this.shiftMix = 0;
    this.shiftGate = false;
    this.framesWritten = 0;

    // The controller has already done musical retune smoothing. These time
    // constants are only anti-zipper / anti-splice protection in the audio
    // thread, not another musical retune stage.
    this.ratioAlpha = 1 - Math.exp(-1 / (sampleRate * 0.007));
    this.pitchAlpha = 1 - Math.exp(-1 / (sampleRate * 0.045));
    this.windowAlpha = 1 - Math.exp(-1 / (sampleRate * 0.05));
    this.mixAlpha = 1 - Math.exp(-1 / (sampleRate * 0.018));
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
      // Mono sources are mirrored into the second history buffer. Native stereo
      // material keeps independent histories.
      for (let channel = 0; channel < 2; channel++) {
        const source = input[channel] || input[0];
        this.buffers[channel][this.writeIndex] = source ? (source[frame] || 0) : 0;
      }

      const requestedSemitones = semitoneValues.length > 1
        ? semitoneValues[frame]
        : semitoneValues[0];
      const requestedCents = Math.abs(requestedSemitones) * 100;

      // Schmitt-trigger-style neutral zone. Enter correction only when it is
      // musically meaningful, and do not leave it again until the correction is
      // genuinely tiny. This prevents 2-4 cent detector motion from repeatedly
      // crossfading differently delayed taps and sounding phasey/robotic.
      if (!this.shiftGate && requestedCents >= 5.0) this.shiftGate = true;
      else if (this.shiftGate && requestedCents <= 1.8) this.shiftGate = false;

      const effectiveSemitones = this.shiftGate ? requestedSemitones : 0;
      const targetRatio = Math.pow(2, effectiveSemitones / 12);
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

      // Pitch-synchronous-ish grain sizing: choose the closest whole number of
      // periods to the requested quality window. The splice points are therefore
      // much more likely to meet the vocal waveform at similar periodic phase.
      const periodSamples = sampleRate / Math.max(55, this.smoothedPitchHz);
      const cycles = Math.max(3, Math.min(40, Math.round(baseWindow / periodSamples)));
      const synchronousWindow = Math.max(
        sampleRate * 0.028,
        Math.min(sampleRate * 0.09, cycles * periodSamples),
      );
      this.smoothedWindow += (synchronousWindow - this.smoothedWindow) * this.windowAlpha;

      // Only advance the grain phase while correction is active or fading out.
      // At neutral, the phase settles and the output becomes a stable fixed-delay
      // tap rather than a pair of stationary taps that would comb-filter.
      const targetMix = this.shiftGate ? 1 : 0;
      this.shiftMix += (targetMix - this.shiftMix) * this.mixAlpha;

      if (this.shiftGate || this.shiftMix > 0.001) {
        this.phase += (this.smoothedRatio - 1) / Math.max(32, this.smoothedWindow);
        this.phase -= Math.floor(this.phase);
      }

      const phaseA = this.phase;
      const phaseB = (this.phase + 0.5) % 1;

      // Complementary Hann windows sum to 1 for half-cycle phase offset.
      const gainA = 0.5 - 0.5 * Math.cos(twoPi * phaseA);
      const gainB = 0.5 - 0.5 * Math.cos(twoPi * phaseB);

      const safetyDelay = 6;
      const delayA = safetyDelay + (1 - phaseA) * this.smoothedWindow;
      const delayB = safetyDelay + (1 - phaseB) * this.smoothedWindow;
      const neutralDelay = safetyDelay + this.smoothedWindow * 0.5;

      const enoughHistory = this.framesWritten > this.smoothedWindow + 12;

      // Equal-power transition is only used when crossing the hysteresis
      // thresholds, not continuously around every tiny correction fluctuation.
      const crossfadeAngle = Math.max(0, Math.min(1, this.shiftMix)) * Math.PI * 0.5;
      const neutralGain = Math.cos(crossfadeAngle);
      const shiftedGain = Math.sin(crossfadeAngle);

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
          neutral * neutralGain +
          shifted * shiftedGain;
      }

      this.writeIndex += 1;
      if (this.writeIndex >= this.bufferLength) this.writeIndex = 0;
      this.framesWritten += 1;
    }

    return true;
  }
}

registerProcessor('ditune-pitch-correction', DiTunePitchCorrectionProcessor);
