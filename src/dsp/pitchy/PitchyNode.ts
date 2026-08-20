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
 * The current audio transform still uses Tone.PitchShift, but the control
 * engine is deliberately more vocal-oriented than a raw nearest-note snap:
 * - YIN fundamental estimation
 * - octave-jump rejection
 * - time-constant pitch smoothing
 * - slower pitch-centre tracking to preserve vibrato
 * - target-note hysteresis + candidate confirmation
 * - sustained-note Humanize behaviour
 * - time-based retune speed / transition
 * - short voiced/unvoiced wet crossfades so consonants are not hard-tuned
 *
 * This keeps the existing DigiDAW graph contract while making Pitchy much less
 * susceptible to one-frame detector mistakes and zippery note transitions.
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
  private candidateTargetMidi: number | null = null;
  private candidateTargetFrames = 0;
  private smoothedMidi: number | null = null;
  private pitchCenterMidi: number | null = null;
  private previousMeasuredMidi: number | null = null;
  private lastVoicedAt = -Infinity;
  private noteStartedAt = -Infinity;
  private lastAnalysisAt = -Infinity;
  private wetVoiceState = true;

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
      windowSize: 0.05,
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
    // stable while the YIN pass itself still operates on a decimated copy.
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

    // Tone.PitchShift gets grainier with very small windows. These values trade
    // a little more latency for a noticeably smoother sustained vocal.
    this.pitchShift.windowSize = this.mode === 'hq' ? 0.08 : 0.05;

    if (previousMode !== this.mode && this.analysisTimer) {
      this.startAnalysis();
    }
  }

  private startAnalysis() {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }

    // Faster control updates improve retune smoothness. The expensive YIN loop
    // remains downsampled so this stays practical for browser playback.
    const intervalMs = this.mode === 'hq' ? 32 : 24;
    this.analysisTimer = setInterval(() => this.analysePitch(), intervalMs);
  }

  private analysisDeltaSeconds(now: number): number {
    const fallback = this.mode === 'hq' ? 0.032 : 0.024;
    if (!Number.isFinite(this.lastAnalysisAt) || this.lastAnalysisAt < 0) {
      this.lastAnalysisAt = now;
      return fallback;
    }
    const delta = Math.max(0.008, Math.min(0.08, now - this.lastAnalysisAt));
    this.lastAnalysisAt = now;
    return delta;
  }

  private alphaForTimeConstant(deltaSeconds: number, timeConstantSeconds: number): number {
    const tau = Math.max(0.001, timeConstantSeconds);
    return Math.max(0, Math.min(1, 1 - Math.exp(-deltaSeconds / tau)));
  }

  private unwrapOctaveJump(measuredMidi: number): number {
    const previous = this.previousMeasuredMidi;
    if (previous === null || !Number.isFinite(previous)) {
      this.previousMeasuredMidi = measuredMidi;
      return measuredMidi;
    }

    let candidate = measuredMidi;
    while (candidate - previous > 7) candidate -= 12;
    while (previous - candidate > 7) candidate += 12;

    this.previousMeasuredMidi = candidate;
    return candidate;
  }

  private setVoicedWetState(voiced: boolean) {
    if (this.wetVoiceState === voiced) return;
    this.wetVoiceState = voiced;

    // The built-in wet control gives a short crossfade around consonants and
    // breath noise instead of abruptly forcing an old pitch correction onto
    // unvoiced material. Twelve milliseconds is short enough not to pump.
    try {
      this.pitchShift.wet.rampTo(voiced ? 1 : 0, 0.012);
    } catch {
      this.pitchShift.wet.value = voiced ? 1 : 0;
    }
  }

  private updateStableTarget(centerMidi: number, now: number) {
    const nearestMidi = Math.round(centerMidi);

    if (this.stableTargetMidi === null) {
      this.stableTargetMidi = nearestMidi;
      this.candidateTargetMidi = null;
      this.candidateTargetFrames = 0;
      this.noteStartedAt = now;
      return;
    }

    if (nearestMidi === this.stableTargetMidi) {
      this.candidateTargetMidi = null;
      this.candidateTargetFrames = 0;
      return;
    }

    const distanceFromCurrent = Math.abs(centerMidi - this.stableTargetMidi);
    if (distanceFromCurrent < 0.62) {
      this.candidateTargetMidi = null;
      this.candidateTargetFrames = 0;
      return;
    }

    // A genuine large interval is allowed through quickly. Boundary crossings
    // around vibrato or noisy consonants need two consecutive confirmations.
    if (distanceFromCurrent >= 1.15) {
      this.stableTargetMidi = nearestMidi;
      this.candidateTargetMidi = null;
      this.candidateTargetFrames = 0;
      this.noteStartedAt = now;
      return;
    }

    if (this.candidateTargetMidi === nearestMidi) {
      this.candidateTargetFrames += 1;
    } else {
      this.candidateTargetMidi = nearestMidi;
      this.candidateTargetFrames = 1;
    }

    if (this.candidateTargetFrames >= 2) {
      this.stableTargetMidi = nearestMidi;
      this.candidateTargetMidi = null;
      this.candidateTargetFrames = 0;
      this.noteStartedAt = now;
    }
  }

  private analysePitch() {
    if (this.isDisposedInternal) return;

    const now = this.rawCtx.currentTime;
    const deltaSeconds = this.analysisDeltaSeconds(now);

    this.analyser.getFloatTimeDomainData(this.analysisData);
    const source = this.analysisData;

    let mean = 0;
    for (let i = 0; i < source.length; i++) mean += source[i];
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

    // Some breathy/raspy vocals never cross the strict threshold. Accept a
    // clear global valley, but reject genuinely ambiguous frames.
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

    let measuredMidi = 69 + 12 * Math.log2(pitchHz / this.referenceHz);
    measuredMidi = this.unwrapOctaveJump(measuredMidi);

    // Fast smoothing removes frame-level jitter while retaining musical motion.
    const fastTau = this.mode === 'hq' ? 0.045 : 0.032;
    const fastAlpha = this.alphaForTimeConstant(deltaSeconds, fastTau);
    this.smoothedMidi = this.smoothedMidi === null
      ? measuredMidi
      : this.smoothedMidi + (measuredMidi - this.smoothedMidi) * fastAlpha;

    // A slower centre line separates note centre from vibrato. Correction is
    // calculated mostly from this centre when Humanize is raised, so the singer
    // keeps natural oscillation instead of the tuner fighting every vibrato arc.
    const humanizeNorm = this.humanize / 100;
    const centerTau = 0.09 + humanizeNorm * 0.09;
    const centerAlpha = this.alphaForTimeConstant(deltaSeconds, centerTau);
    this.pitchCenterMidi = this.pitchCenterMidi === null
      ? this.smoothedMidi
      : this.pitchCenterMidi + (this.smoothedMidi - this.pitchCenterMidi) * centerAlpha;

    const continuousMidi = this.smoothedMidi;
    const centerMidi = this.pitchCenterMidi;

    this.updateStableTarget(centerMidi, now);
    if (this.stableTargetMidi === null) {
      this.handleUnvoiced(false);
      return;
    }

    const targetMidi = this.stableTargetMidi;
    const targetHz = this.referenceHz * Math.pow(2, (targetMidi - 69) / 12);
    const noteClass = ((targetMidi % 12) + 12) % 12;

    const noteAge = Number.isFinite(this.noteStartedAt) && this.noteStartedAt >= 0
      ? Math.max(0, now - this.noteStartedAt)
      : 0;
    const sustainRamp = Math.max(0, Math.min(1, (noteAge - 0.16) / 0.38));

    // Humanize acts primarily on sustained material: attacks still lock quickly,
    // while held notes retain more vibrato and small expressive movement.
    const vibratoDeviation = continuousMidi - centerMidi;
    const vibratoPreserve = humanizeNorm * (0.35 + sustainRamp * 0.65);
    const correctionReferenceMidi = centerMidi + vibratoDeviation * (1 - vibratoPreserve);
    let correction = targetMidi - correctionReferenceMidi;

    // Humanize also supplies a gentle Flex-like soft zone around the note centre.
    // A singer already close to target is not constantly pulled dead-centre.
    const flexZone = 0.025 + humanizeNorm * (0.08 + sustainRamp * 0.16);
    const absCorrection = Math.abs(correction);
    if (flexZone > 0 && absCorrection < flexZone) {
      const x = Math.max(0, Math.min(1, absCorrection / flexZone));
      const smoothStep = x * x * (3 - 2 * x);
      correction *= smoothStep;
    }

    this.detectedHz = pitchHz;
    this.targetHz = targetHz;
    this.closestNoteName = NOTE_NAMES[noteClass] || 'C';
    this.centsDeviation = Math.max(-50, Math.min(50, Math.round((targetMidi - continuousMidi) * 100)));
    this.isTracking = true;
    this.confidence = confidence;
    this.lastVoicedAt = now;
    this.setVoicedWetState(true);

    this.applyPitchShift(correction, deltaSeconds, noteAge, confidence);
  }

  private handleUnvoiced(resetFrequency: boolean) {
    const now = this.rawCtx.currentTime;
    this.isTracking = false;

    if (resetFrequency) {
      this.detectedHz = 0;
      this.targetHz = 0;
    }

    const elapsed = now - this.lastVoicedAt;

    // Tiny consonant gaps keep the previous correction; this avoids rapidly
    // toggling the shifter during normal syllables. Longer unvoiced regions are
    // crossfaded to the internal dry path to avoid pitch-shifting sibilance.
    if (elapsed < 0.065) return;
    this.setVoicedWetState(false);

    if (elapsed < 0.18) return;

    this.stableTargetMidi = null;
    this.candidateTargetMidi = null;
    this.candidateTargetFrames = 0;
    this.smoothedMidi = null;
    this.pitchCenterMidi = null;
    this.previousMeasuredMidi = null;
    this.noteStartedAt = -Infinity;
    this.centsDeviation = Math.round(this.centsDeviation * 0.7);

    const deltaSeconds = this.analysisDeltaSeconds(now);
    this.applyPitchShift(0, deltaSeconds, 0, 0.5);
  }

  private applyPitchShift(
    targetSemitones: number,
    deltaSeconds: number,
    noteAgeSeconds: number,
    confidence: number,
  ) {
    const speedNorm = this.speed / 100;
    const transitionNorm = this.transition / 100;
    const humanizeNorm = this.humanize / 100;

    // Convert the UI control to a real retune time. Speed 100 is near-instant;
    // Speed 0 is deliberately slow. Transition adds glide without changing the
    // final correction amount.
    let retuneMs = 3 + Math.pow(1 - speedNorm, 2.1) * 157;
    retuneMs += transitionNorm * 130;

    // Humanize only slows sustained notes. New note attacks remain responsive.
    const sustainRamp = Math.max(0, Math.min(1, (noteAgeSeconds - 0.16) / 0.38));
    retuneMs += humanizeNorm * sustainRamp * 240;

    // Ambiguous frames should move the correction more cautiously rather than
    // yanking the shifter toward a possibly wrong harmonic.
    if (confidence < 0.75) {
      const confidencePenalty = (0.75 - confidence) / 0.20;
      retuneMs += Math.max(0, Math.min(1, confidencePenalty)) * 90;
    }

    const alpha = this.alphaForTimeConstant(deltaSeconds, Math.max(0.003, retuneMs / 1000));
    const clampedTarget = Math.max(-2, Math.min(2, targetSemitones));

    this.currentShiftSemitones += (clampedTarget - this.currentShiftSemitones) * alpha;

    // Sub-cent resolution is enough for tuning while avoiding tiny control-rate
    // fluctuations that only create zipper/warble in the pitch shifter.
    this.currentShiftSemitones = Math.round(this.currentShiftSemitones * 200) / 200;
    if (Math.abs(this.currentShiftSemitones) < 0.0025) this.currentShiftSemitones = 0;

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
