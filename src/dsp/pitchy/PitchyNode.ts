import * as Tone from 'tone';

export interface PitchyOptions {
  referenceHz?: number;
  speed?: number;
  humanize?: number;
  transition?: number;
  color?: number;
  mode?: 'realtime' | 'hq';
}

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface PitchyTelemetry {
  detectedHz: number;
  targetHz: number;
  closestNoteName: string;
  centsDeviation: number;
  isTracking: boolean;
  rms: number;
  pitchRatio: number;
  confidence: number;
}

/**
 * Realtime chromatic pitch-correction node.
 *
 * Tone.PitchShift performs the actual audio transformation. A control-rate YIN
 * detector estimates the vocal fundamental and drives a nearest-semitone
 * correction. The detector is intentionally kept off the audio thread.
 */
export class PitchyNode extends Tone.ToneAudioNode<any> {
  readonly name = 'PitchyNode';

  public static lastActiveInstance: PitchyNode | null = null;
  public static instances: Set<PitchyNode> = new Set();

  public readonly input: Tone.Gain;
  public readonly output: Tone.Gain;
  public readonly inputNode: Tone.Gain;
  public readonly outputNode: Tone.Gain;

  private pitchShift: Tone.PitchShift;
  private colorFilter: Tone.Filter;
  private analyser: AnalyserNode;
  private analysisData: Float32Array;
  private downsampled: Float32Array;
  private yinBuffer: Float32Array;
  private analysisTimer: ReturnType<typeof setInterval> | null = null;
  private rawCtx: BaseAudioContext;
  private isDisposedInternal = false;

  public referenceHz = 440;
  public speed = 75;
  public humanize = 20;
  public transition = 30;
  public color = 50;
  public mode: 'realtime' | 'hq' = 'realtime';

  public detectedHz = 0;
  public targetHz = 0;
  public closestNoteName = 'C';
  public centsDeviation = 0;
  public isTracking = false;
  public currentRms = 0;
  public confidence = 0;

  private currentShiftSemitones = 0;
  private stableTargetMidi: number | null = null;
  private smoothedMidi: number | null = null;
  private lastVoicedAt = -Infinity;

  constructor(options: PitchyOptions = {}) {
    super();

    this.rawCtx = Tone.getContext().rawContext;

    this.inputNode = new Tone.Gain({ context: this.context });
    this.outputNode = new Tone.Gain({ context: this.context });
    this.input = this.inputNode;
    this.output = this.outputNode;

    this.pitchShift = new Tone.PitchShift({
      context: this.context,
      pitch: 0,
      windowSize: 0.04,
      delayTime: 0,
      feedback: 0,
      wet: 1,
    });

    this.colorFilter = new Tone.Filter({
      context: this.context,
      type: 'peaking',
      frequency: 3200,
      Q: 0.8,
      gain: 0,
    });

    this.inputNode.chain(this.pitchShift, this.colorFilter, this.outputNode);

    // A longer capture window makes low male fundamentals considerably more
    // stable while the actual YIN pass still runs on a downsampled copy.
    this.analyser = this.rawCtx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    this.analysisData = new Float32Array(this.analyser.fftSize);
    this.downsampled = new Float32Array(this.analysisData.length);
    this.yinBuffer = new Float32Array(1024);

    const nativeInput = this.inputNode.input as AudioNode;
    nativeInput.connect(this.analyser);

    this.update(options);
    this.startAnalysis();

    PitchyNode.instances.add(this);
    PitchyNode.lastActiveInstance = this;
  }

  public update(options: PitchyOptions) {
    const previousMode = this.mode;

    if (options.referenceHz !== undefined) {
      this.referenceHz = Math.max(415, Math.min(466, options.referenceHz));
    }
    if (options.speed !== undefined) this.speed = Math.max(0, Math.min(100, options.speed));
    if (options.humanize !== undefined) this.humanize = Math.max(0, Math.min(100, options.humanize));
    if (options.transition !== undefined) this.transition = Math.max(0, Math.min(100, options.transition));
    if (options.mode !== undefined) this.mode = options.mode;

    if (options.color !== undefined) {
      this.color = Math.max(0, Math.min(100, options.color));
      this.colorFilter.gain.value = (this.color - 50) * 0.16;
      this.colorFilter.frequency.value = 1400 + (this.color / 100) * 3600;
    }

    // Keep the grain window inside the range where Tone.PitchShift behaves
    // predictably for voice while giving HQ mode a little more stability.
    this.pitchShift.windowSize = this.mode === 'hq' ? 0.07 : 0.04;

    if (previousMode !== this.mode && this.analysisTimer) {
      this.startAnalysis();
    }
  }

  private startAnalysis() {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }

    const intervalMs = this.mode === 'hq' ? 36 : 30;
    this.analysisTimer = setInterval(() => this.analysePitch(), intervalMs);
  }

  private analysePitch() {
    if (this.isDisposedInternal) return;

    this.analyser.getFloatTimeDomainData(this.analysisData);
    const source = this.analysisData;

    let mean = 0;
    let sumSq = 0;
    for (let i = 0; i < source.length; i++) {
      const sample = source[i];
      mean += sample;
      sumSq += sample * sample;
    }
    mean /= source.length;

    // AC RMS is more useful for voiced detection than raw RMS when a DC offset
    // or asymmetric saturator exists earlier in the insert chain.
    let acSumSq = 0;
    for (let i = 0; i < source.length; i++) {
      const centered = source[i] - mean;
      acSumSq += centered * centered;
    }

    const rms = Math.sqrt(acSumSq / source.length);
    this.currentRms = rms;

    if (rms < 0.0035) {
      this.handleUnvoiced(true);
      return;
    }

    const sampleRate = this.rawCtx.sampleRate || 44100;
    const downsampleFactor = this.mode === 'hq' ? 2 : 4;
    const downLength = Math.floor(source.length / downsampleFactor);
    const down = this.downsampled;

    // Box-average decimation removes enough upper-band content to make the YIN
    // difference function less likely to lock onto a bright harmonic.
    for (let i = 0; i < downLength; i++) {
      const base = i * downsampleFactor;
      let sum = 0;
      for (let j = 0; j < downsampleFactor; j++) {
        sum += source[base + j] - mean;
      }
      down[i] = sum / downsampleFactor;
    }

    const effectiveRate = sampleRate / downsampleFactor;
    const minHz = 55;
    const maxHz = 1100;
    const minTau = Math.max(2, Math.floor(effectiveRate / maxHz));
    const maxTau = Math.min(
      Math.floor(effectiveRate / minHz),
      Math.floor(downLength / 2) - 1,
      this.yinBuffer.length - 2,
    );

    if (maxTau <= minTau + 2) {
      this.handleUnvoiced(false);
      return;
    }

    const yin = this.yinBuffer;
    yin.fill(0, 0, maxTau + 2);

    // Use one fixed comparison window for every lag. This avoids favouring long
    // lags simply because they have fewer samples contributing to the error.
    const comparisonLength = downLength - maxTau - 1;
    for (let tau = 1; tau <= maxTau + 1; tau++) {
      let difference = 0;
      for (let i = 0; i < comparisonLength; i++) {
        const delta = down[i] - down[i + tau];
        difference += delta * delta;
      }
      yin[tau] = difference;
    }

    // Cumulative mean normalised difference (the core YIN step).
    yin[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau <= maxTau + 1; tau++) {
      runningSum += yin[tau];
      yin[tau] = runningSum > 1e-12 ? (yin[tau] * tau) / runningSum : 1;
    }

    const threshold = this.mode === 'hq' ? 0.14 : 0.18;
    let tauEstimate = -1;

    // Pick the first convincing valley rather than the global best harmonic.
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (yin[tau] < threshold) {
        while (tau + 1 <= maxTau && yin[tau + 1] < yin[tau]) tau++;
        tauEstimate = tau;
        break;
      }
    }

    // Some breathy/raspy vocals never cross the strict threshold. In that
    // situation accept a clear global valley, but reject genuinely ambiguous
    // frames so the shifter does not jump randomly.
    if (tauEstimate < 0) {
      let bestTau = minTau;
      let bestValue = yin[minTau];
      for (let tau = minTau + 1; tau <= maxTau; tau++) {
        if (yin[tau] < bestValue) {
          bestValue = yin[tau];
          bestTau = tau;
        }
      }
      if (bestValue <= 0.32) tauEstimate = bestTau;
    }

    if (tauEstimate < 0) {
      this.confidence *= 0.8;
      this.handleUnvoiced(false);
      return;
    }

    // Sub-sample parabolic interpolation around the YIN minimum.
    let refinedTau = tauEstimate;
    if (tauEstimate > 1 && tauEstimate < maxTau) {
      const left = yin[tauEstimate - 1];
      const center = yin[tauEstimate];
      const right = yin[tauEstimate + 1];
      const denominator = left - 2 * center + right;
      if (Math.abs(denominator) > 1e-9) {
        refinedTau += 0.5 * (left - right) / denominator;
      }
    }

    const pitchHz = effectiveRate / refinedTau;
    if (!Number.isFinite(pitchHz) || pitchHz < minHz || pitchHz > maxHz) {
      this.handleUnvoiced(false);
      return;
    }

    const confidence = Math.max(0, Math.min(1, 1 - yin[tauEstimate]));
    if (confidence < 0.55) {
      this.confidence = confidence;
      this.handleUnvoiced(false);
      return;
    }

    const measuredMidi = 69 + 12 * Math.log2(pitchHz / this.referenceHz);

    // Small pitch smoothing removes one-frame octave/harmonic jitter without
    // taking away the fast retune behaviour controlled below.
    const pitchSmoothAlpha = this.mode === 'hq' ? 0.46 : 0.34;
    this.smoothedMidi = this.smoothedMidi === null
      ? measuredMidi
      : this.smoothedMidi + (measuredMidi - this.smoothedMidi) * pitchSmoothAlpha;

    const continuousMidi = this.smoothedMidi;
    const nearestMidi = Math.round(continuousMidi);

    // Hysteresis around semitone boundaries prevents target-note chatter on
    // vibrato that sits exactly between two notes.
    if (this.stableTargetMidi === null) {
      this.stableTargetMidi = nearestMidi;
    } else if (nearestMidi !== this.stableTargetMidi) {
      const distanceFromCurrent = Math.abs(continuousMidi - this.stableTargetMidi);
      if (distanceFromCurrent > 0.58) this.stableTargetMidi = nearestMidi;
    }

    const targetMidi = this.stableTargetMidi;
    const targetHz = this.referenceHz * Math.pow(2, (targetMidi - 69) / 12);
    const rawCorrection = targetMidi - continuousMidi;
    const noteClass = ((targetMidi % 12) + 12) % 12;

    this.detectedHz = pitchHz;
    this.targetHz = targetHz;
    this.closestNoteName = NOTE_NAMES[noteClass] || 'C';
    this.centsDeviation = Math.max(-50, Math.min(50, Math.round(rawCorrection * 100)));
    this.isTracking = true;
    this.confidence = confidence;
    this.lastVoicedAt = this.rawCtx.currentTime;

    const humanize = this.humanize / 100;
    let correction = rawCorrection;

    // Humanize preserves small natural movement around the centre of the note
    // while larger intonation errors still get pulled to target.
    const softZone = 0.04 + humanize * 0.18;
    const absCorrection = Math.abs(correction);
    if (absCorrection < softZone && softZone > 0) {
      const amount = absCorrection / softZone;
      const preserve = humanize * (1 - amount);
      correction *= 1 - preserve * 0.92;
    } else {
      correction *= 1 - humanize * 0.18;
    }

    this.applyPitchShift(correction);
  }

  private handleUnvoiced(resetFrequency: boolean) {
    this.isTracking = false;
    if (resetFrequency) {
      this.detectedHz = 0;
      this.targetHz = 0;
    }

    // Hold the last correction across short consonants/breath gaps. Releasing
    // instantly on every unvoiced frame is what makes many browser autotunes
    // sound like the effect repeatedly switches on and off.
    const elapsed = this.rawCtx.currentTime - this.lastVoicedAt;
    if (elapsed < 0.16) return;

    this.stableTargetMidi = null;
    this.smoothedMidi = null;
    this.centsDeviation = Math.round(this.centsDeviation * 0.7);
    this.applyPitchShift(0);
  }

  private applyPitchShift(targetSemitones: number) {
    const speedNorm = this.speed / 100;
    const transitionNorm = this.transition / 100;

    // Speed controls how quickly we reach the correction; Transition adds an
    // additional glide. Correction strength itself is not thrown away at low
    // speed, which is closer to how a retune-speed control is expected to feel.
    let alpha = 0.08 + Math.pow(speedNorm, 1.45) * 0.84;
    alpha *= 1 - transitionNorm * 0.72;
    alpha = Math.max(0.025, Math.min(0.94, alpha));

    const clampedTarget = Math.max(-2, Math.min(2, targetSemitones));
    this.currentShiftSemitones += (clampedTarget - this.currentShiftSemitones) * alpha;
    if (Math.abs(this.currentShiftSemitones) < 0.0015) this.currentShiftSemitones = 0;

    this.pitchShift.pitch = this.currentShiftSemitones;
  }

  public getTelemetry(): PitchyTelemetry {
    return {
      detectedHz: this.detectedHz,
      targetHz: this.targetHz,
      closestNoteName: this.closestNoteName,
      centsDeviation: this.centsDeviation,
      isTracking: this.isTracking,
      rms: this.currentRms,
      pitchRatio: Math.pow(2, this.currentShiftSemitones / 12),
      confidence: this.confidence,
    };
  }

  public dispose(): this {
    if (this.isDisposedInternal) return this;
    this.isDisposedInternal = true;

    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }

    PitchyNode.instances.delete(this);
    if (PitchyNode.lastActiveInstance === this) {
      PitchyNode.lastActiveInstance = PitchyNode.instances.values().next().value || null;
    }

    try { this.analyser.disconnect(); } catch {}
    try { this.pitchShift.dispose(); } catch {}
    try { this.colorFilter.dispose(); } catch {}

    super.dispose();
    return this;
  }
}
