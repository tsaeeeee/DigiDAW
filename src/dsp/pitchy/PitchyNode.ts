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
  correctionCents: number;
  backend: 'loading' | 'worklet' | 'tone-fallback';
}

type PitchBackend = PitchyTelemetry['backend'];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Realtime chromatic vocal pitch correction.
 *
 * Controller:
 * - YIN fundamental estimation with confidence gating
 * - short median/outlier protection
 * - confirmed octave-error rejection
 * - target-note hysteresis + confirmation
 * - independent target-note glide and correction servo
 * - vibrato-preserving Humanize and onset protection
 * - confidence-weighted OBSERVATION smoothing (not correction-depth pumping)
 * - same-path unvoiced hold/release
 *
 * Transform:
 * - preferred: DigiDAW AudioWorklet continuous overlap-add shifter
 * - detected F0 is also supplied to the worklet so its grain length can track
 *   an integer number of vocal periods instead of cutting arbitrary phases
 * - Tone.PitchShift remains fallback-only when AudioWorklet is unavailable
 */
export class PitchyNode extends Tone.ToneAudioNode<any> {
  readonly name = 'PitchyNode';

  public static lastActiveInstance: PitchyNode | null = null;
  public static instances: Set<PitchyNode> = new Set();
  private static workletLoads = new WeakMap<BaseAudioContext, Promise<void>>();

  public readonly input: Tone.Gain;
  public readonly output: Tone.Gain;
  public readonly inputNode: Tone.Gain;
  public readonly outputNode: Tone.Gain;

  private colorFilter: Tone.Filter;
  private startupDryGain: Tone.Gain;
  private correctedGain: Tone.Gain;
  private workletNode: AudioWorkletNode | null = null;
  private fallbackPitchShift: Tone.PitchShift | null = null;
  private backend: PitchBackend = 'loading';

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
  private targetGuideMidi: number | null = null;

  private smoothedMidi: number | null = null;
  private pitchCenterMidi: number | null = null;
  private measuredHistory: number[] = [];

  private octaveCandidateMidi: number | null = null;
  private octaveCandidateFrames = 0;

  private lastVoicedAt = -Infinity;
  private noteStartedAt = -Infinity;
  private lastAnalysisAt = -Infinity;

  constructor(options: PitchyOptions = {}) {
    super();
    this.rawCtx = Tone.getContext().rawContext;

    this.inputNode = new Tone.Gain({ context: this.context });
    this.outputNode = new Tone.Gain({ context: this.context });
    this.input = this.inputNode;
    this.output = this.outputNode;

    this.colorFilter = new Tone.Filter({
      context: this.context,
      type: 'highshelf',
      frequency: 4800,
      Q: 0.7,
      gain: 0,
    });

    // AudioWorklet loading is asynchronous. Until it is ready, the vocal passes
    // cleanly. There is only one startup crossfade; voiced/unvoiced changes do
    // not jump between unmatched dry/wet latencies later.
    this.startupDryGain = new Tone.Gain({ context: this.context, gain: 1 });
    this.correctedGain = new Tone.Gain({ context: this.context, gain: 0 });
    this.inputNode.connect(this.startupDryGain);
    this.startupDryGain.connect(this.colorFilter);
    this.correctedGain.connect(this.colorFilter);
    this.colorFilter.connect(this.outputNode);

    this.analyser = this.rawCtx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    this.analysisData = new Float32Array(this.analyser.fftSize);
    this.downsampled = new Float32Array(this.analysisData.length);
    this.yinBuffer = new Float32Array(2048);

    const nativeInput = this.inputNode.input as AudioNode;
    nativeInput.connect(this.analyser);

    this.update(options);
    this.startAnalysis();
    void this.initializePitchBackend();

    PitchyNode.instances.add(this);
    PitchyNode.lastActiveInstance = this;
  }

  private static getWorkletUrl() {
    const base = (((import.meta as any).env?.BASE_URL as string | undefined) || '/');
    const normalized = base.endsWith('/') ? base : `${base}/`;
    return `${normalized}dsp/ditune-pitch-processor.js`;
  }

  private static ensureWorklet(context: BaseAudioContext) {
    const audioWorklet = (context as BaseAudioContext & { audioWorklet?: AudioWorklet }).audioWorklet;
    if (!audioWorklet || typeof AudioWorkletNode === 'undefined') {
      return Promise.reject(new Error('AudioWorklet is unavailable'));
    }

    const existing = PitchyNode.workletLoads.get(context);
    if (existing) return existing;

    const load = audioWorklet.addModule(PitchyNode.getWorkletUrl()).catch((error) => {
      PitchyNode.workletLoads.delete(context);
      throw error;
    });
    PitchyNode.workletLoads.set(context, load);
    return load;
  }

  private async initializePitchBackend() {
    const isOffline = typeof OfflineAudioContext !== 'undefined' && this.rawCtx instanceof OfflineAudioContext;

    if (!isOffline) {
      try {
        await PitchyNode.ensureWorklet(this.rawCtx);
        if (this.isDisposedInternal) return;

        const node = new AudioWorkletNode(this.rawCtx, 'ditune-pitch-correction', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers',
          parameterData: {
            semitones: this.currentShiftSemitones,
            windowMs: this.mode === 'hq' ? 72 : 52,
            inputHz: this.detectedHz || 180,
          },
        });

        this.workletNode = node;
        this.backend = 'worklet';
        Tone.connect(this.inputNode, node);
        Tone.connect(node, this.correctedGain);
        this.updateWorkletWindow();
        this.pushPitchEstimateToWorklet(this.detectedHz || 180, 1);
        this.pushPitchShiftValue();
        this.fadeToCorrectedPath();
        return;
      } catch (error) {
        console.warn('Ditune AudioWorklet unavailable; using Tone.PitchShift fallback.', error);
      }
    }

    if (this.isDisposedInternal) return;
    const fallback = new Tone.PitchShift({
      context: this.context,
      pitch: this.currentShiftSemitones,
      windowSize: this.mode === 'hq' ? 0.09 : 0.065,
      delayTime: 0,
      feedback: 0,
      wet: 1,
    });

    this.fallbackPitchShift = fallback;
    this.backend = 'tone-fallback';
    this.inputNode.connect(fallback);
    fallback.connect(this.correctedGain);
    this.fadeToCorrectedPath();
  }

  private fadeToCorrectedPath() {
    try {
      this.startupDryGain.gain.rampTo(0, 0.05);
      this.correctedGain.gain.rampTo(1, 0.05);
    } catch {
      this.startupDryGain.gain.value = 0;
      this.correctedGain.gain.value = 1;
    }
  }

  public update(options: PitchyOptions) {
    const previousMode = this.mode;
    if (options.referenceHz !== undefined) this.referenceHz = clamp(options.referenceHz, 415, 466);
    if (options.speed !== undefined) this.speed = clamp(options.speed, 0, 100);
    if (options.humanize !== undefined) this.humanize = clamp(options.humanize, 0, 100);
    if (options.transition !== undefined) this.transition = clamp(options.transition, 0, 100);
    if (options.mode !== undefined) this.mode = options.mode;

    if (options.color !== undefined) {
      this.color = clamp(options.color, 0, 100);
      this.colorFilter.frequency.value = 4800;
      this.colorFilter.gain.value = (this.color - 50) * 0.06;
    }

    if (this.fallbackPitchShift) {
      this.fallbackPitchShift.windowSize = this.mode === 'hq' ? 0.09 : 0.065;
    }
    this.updateWorkletWindow();
    if (previousMode !== this.mode && this.analysisTimer) this.startAnalysis();
  }

  private updateWorkletWindow() {
    if (!this.workletNode) return;
    const parameter = this.workletNode.parameters.get('windowMs');
    if (!parameter) return;
    const now = this.rawCtx.currentTime;
    const value = this.mode === 'hq' ? 72 : 52;
    try { parameter.cancelAndHoldAtTime(now); } catch { parameter.cancelScheduledValues(now); }
    parameter.setTargetAtTime(value, now, 0.04);
  }

  private pushPitchEstimateToWorklet(pitchHz: number, confidence: number) {
    if (!this.workletNode || confidence < 0.58 || !Number.isFinite(pitchHz)) return;
    const parameter = this.workletNode.parameters.get('inputHz');
    if (!parameter) return;
    const now = this.rawCtx.currentTime;
    const value = clamp(pitchHz, 55, 1050);
    try { parameter.cancelAndHoldAtTime(now); } catch { parameter.cancelScheduledValues(now); }
    parameter.setTargetAtTime(value, now, 0.045);
  }

  private startAnalysis() {
    if (this.analysisTimer) clearInterval(this.analysisTimer);
    const intervalMs = this.mode === 'hq' ? 32 : 22;
    this.analysisTimer = setInterval(() => this.analysePitch(), intervalMs);
  }

  private analysisDeltaSeconds(now: number) {
    const fallback = this.mode === 'hq' ? 0.032 : 0.022;
    if (!Number.isFinite(this.lastAnalysisAt) || this.lastAnalysisAt < 0) {
      this.lastAnalysisAt = now;
      return fallback;
    }
    const delta = clamp(now - this.lastAnalysisAt, 0.008, 0.08);
    this.lastAnalysisAt = now;
    return delta;
  }

  private alphaForTimeConstant(deltaSeconds: number, timeConstantSeconds: number) {
    return clamp(1 - Math.exp(-deltaSeconds / Math.max(0.001, timeConstantSeconds)), 0, 1);
  }

  private protectOctaveOutlier(measuredMidi: number) {
    const reference = this.smoothedMidi;
    if (reference === null) return measuredMidi;

    const delta = measuredMidi - reference;
    if (Math.abs(delta) < 9.5 || Math.abs(delta) > 14.5) {
      this.octaveCandidateMidi = null;
      this.octaveCandidateFrames = 0;
      return measuredMidi;
    }

    const folded = measuredMidi - Math.sign(delta) * 12;
    if (Math.abs(folded - reference) > 2.2) {
      this.octaveCandidateMidi = null;
      this.octaveCandidateFrames = 0;
      return measuredMidi;
    }

    if (this.octaveCandidateMidi !== null && Math.abs(measuredMidi - this.octaveCandidateMidi) < 0.6) {
      this.octaveCandidateFrames += 1;
      this.octaveCandidateMidi += (measuredMidi - this.octaveCandidateMidi) * 0.35;
    } else {
      this.octaveCandidateMidi = measuredMidi;
      this.octaveCandidateFrames = 1;
    }

    if (this.octaveCandidateFrames >= 3) {
      this.octaveCandidateMidi = null;
      this.octaveCandidateFrames = 0;
      return measuredMidi;
    }
    return folded;
  }

  private robustMeasuredMidi(measuredMidi: number) {
    const protectedMidi = this.protectOctaveOutlier(measuredMidi);
    this.measuredHistory.push(protectedMidi);
    if (this.measuredHistory.length > 3) this.measuredHistory.shift();
    return median(this.measuredHistory);
  }

  private updateStableTarget(centerMidi: number, now: number, confidence: number) {
    const nearestMidi = Math.round(centerMidi);
    if (this.stableTargetMidi === null) {
      this.stableTargetMidi = nearestMidi;
      this.targetGuideMidi = nearestMidi;
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

    const direction = nearestMidi > this.stableTargetMidi ? 1 : -1;
    const distancePastCurrent = (centerMidi - this.stableTargetMidi) * direction;
    const switchThreshold = 0.56 + (this.humanize / 100) * 0.08;
    if (distancePastCurrent < switchThreshold) {
      this.candidateTargetMidi = null;
      this.candidateTargetFrames = 0;
      return;
    }

    if (this.candidateTargetMidi === nearestMidi) this.candidateTargetFrames += 1;
    else {
      this.candidateTargetMidi = nearestMidi;
      this.candidateTargetFrames = 1;
    }

    const requiredFrames = confidence >= 0.82 ? 2 : 3;
    if (this.candidateTargetFrames < requiredFrames) return;

    this.stableTargetMidi = nearestMidi;
    this.candidateTargetMidi = null;
    this.candidateTargetFrames = 0;
    this.noteStartedAt = now;
    if (this.targetGuideMidi === null) this.targetGuideMidi = nearestMidi;
  }

  private advanceTargetGuide(deltaSeconds: number) {
    if (this.stableTargetMidi === null) return null;
    if (this.targetGuideMidi === null) this.targetGuideMidi = this.stableTargetMidi;
    const transitionNorm = this.transition / 100;
    const glideSeconds = 0.004 + Math.pow(transitionNorm, 1.7) * 0.22;
    const alpha = this.alphaForTimeConstant(deltaSeconds, glideSeconds);
    this.targetGuideMidi += (this.stableTargetMidi - this.targetGuideMidi) * alpha;
    if (Math.abs(this.targetGuideMidi - this.stableTargetMidi) < 0.0005) {
      this.targetGuideMidi = this.stableTargetMidi;
    }
    return this.targetGuideMidi;
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

    let acSumSq = 0;
    for (let i = 0; i < source.length; i++) {
      const centered = source[i] - mean;
      acSumSq += centered * centered;
    }
    const rms = Math.sqrt(acSumSq / source.length);
    this.currentRms = rms;
    if (rms < 0.0035) {
      this.handleUnvoiced(true, deltaSeconds);
      return;
    }

    const sampleRate = this.rawCtx.sampleRate || 44100;
    const downsampleFactor = this.mode === 'hq' ? 2 : 4;
    const downLength = Math.floor(source.length / downsampleFactor);
    const down = this.downsampled;

    for (let i = 0; i < downLength; i++) {
      const base = i * downsampleFactor;
      let sum = 0;
      for (let j = 0; j < downsampleFactor; j++) sum += source[base + j] - mean;
      down[i] = sum / downsampleFactor;
    }

    const effectiveRate = sampleRate / downsampleFactor;
    const minHz = 55;
    const maxHz = 1050;
    const minTau = Math.max(2, Math.floor(effectiveRate / maxHz));
    const maxTau = Math.min(
      Math.floor(effectiveRate / minHz),
      Math.floor(downLength / 2) - 1,
      this.yinBuffer.length - 2,
    );
    if (maxTau <= minTau + 2) {
      this.handleUnvoiced(false, deltaSeconds);
      return;
    }

    const yin = this.yinBuffer;
    yin.fill(0, 0, maxTau + 2);
    const comparisonLength = downLength - maxTau - 1;
    for (let tau = 1; tau <= maxTau + 1; tau++) {
      let difference = 0;
      for (let i = 0; i < comparisonLength; i++) {
        const delta = down[i] - down[i + tau];
        difference += delta * delta;
      }
      yin[tau] = difference;
    }

    yin[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau <= maxTau + 1; tau++) {
      runningSum += yin[tau];
      yin[tau] = runningSum > 1e-12 ? (yin[tau] * tau) / runningSum : 1;
    }

    const threshold = this.mode === 'hq' ? 0.12 : 0.16;
    let tauEstimate = -1;
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (yin[tau] < threshold) {
        while (tau + 1 <= maxTau && yin[tau + 1] < yin[tau]) tau += 1;
        tauEstimate = tau;
        break;
      }
    }

    if (tauEstimate < 0) {
      let bestTau = minTau;
      let bestValue = yin[minTau];
      for (let tau = minTau + 1; tau <= maxTau; tau++) {
        if (yin[tau] < bestValue) {
          bestValue = yin[tau];
          bestTau = tau;
        }
      }
      if (bestValue <= 0.28) tauEstimate = bestTau;
    }

    if (tauEstimate < 0) {
      this.confidence *= 0.82;
      this.handleUnvoiced(false, deltaSeconds);
      return;
    }

    let refinedTau = tauEstimate;
    if (tauEstimate > 1 && tauEstimate < maxTau) {
      const left = yin[tauEstimate - 1];
      const center = yin[tauEstimate];
      const right = yin[tauEstimate + 1];
      const denominator = left - 2 * center + right;
      if (Math.abs(denominator) > 1e-9) refinedTau += 0.5 * (left - right) / denominator;
    }

    const pitchHz = effectiveRate / refinedTau;
    if (!Number.isFinite(pitchHz) || pitchHz < minHz || pitchHz > maxHz) {
      this.handleUnvoiced(false, deltaSeconds);
      return;
    }

    const confidence = clamp(1 - yin[tauEstimate], 0, 1);
    const recentlyVoiced = now - this.lastVoicedAt < 0.09;
    const minConfidence = recentlyVoiced ? 0.54 : 0.62;
    if (confidence < minConfidence) {
      this.confidence = confidence;
      this.handleUnvoiced(false, deltaSeconds);
      return;
    }

    let measuredMidi = 69 + 12 * Math.log2(pitchHz / this.referenceHz);
    measuredMidi = this.robustMeasuredMidi(measuredMidi);

    // Confidence controls how much a new observation may move the smoothed
    // pitch estimate. Crucially, it no longer multiplies correction depth every
    // frame, which previously made stable notes audibly breathe/flutter as the
    // detector confidence wandered.
    const confidenceQuality = clamp(
      (confidence - minConfidence) / Math.max(0.001, 1 - minConfidence),
      0,
      1,
    );
    const observationWeight = 0.22 + confidenceQuality * 0.78;

    const fastTau = this.mode === 'hq' ? 0.042 : 0.028;
    const fastAlpha = this.alphaForTimeConstant(deltaSeconds, fastTau) * observationWeight;
    this.smoothedMidi = this.smoothedMidi === null
      ? measuredMidi
      : this.smoothedMidi + (measuredMidi - this.smoothedMidi) * fastAlpha;

    const humanizeNorm = this.humanize / 100;
    const centerTau = 0.075 + humanizeNorm * 0.13;
    const centerAlpha = this.alphaForTimeConstant(deltaSeconds, centerTau) * (0.35 + confidenceQuality * 0.65);
    this.pitchCenterMidi = this.pitchCenterMidi === null
      ? this.smoothedMidi
      : this.pitchCenterMidi + (this.smoothedMidi - this.pitchCenterMidi) * centerAlpha;

    const continuousMidi = this.smoothedMidi;
    const centerMidi = this.pitchCenterMidi;
    const smoothedPitchHz = this.referenceHz * Math.pow(2, (continuousMidi - 69) / 12);
    this.pushPitchEstimateToWorklet(smoothedPitchHz, confidence);

    this.updateStableTarget(centerMidi, now, confidence);
    const guideMidi = this.advanceTargetGuide(deltaSeconds);
    if (guideMidi === null || this.stableTargetMidi === null) {
      this.handleUnvoiced(false, deltaSeconds);
      return;
    }

    const stableTarget = this.stableTargetMidi;
    const targetHz = this.referenceHz * Math.pow(2, (stableTarget - 69) / 12);
    const noteClass = ((stableTarget % 12) + 12) % 12;
    const noteAge = Number.isFinite(this.noteStartedAt) && this.noteStartedAt >= 0
      ? Math.max(0, now - this.noteStartedAt)
      : 0;
    const sustainRamp = clamp((noteAge - 0.12) / 0.42, 0, 1);

    const vibratoDeviation = continuousMidi - centerMidi;
    const vibratoPreserve = humanizeNorm * (0.25 + sustainRamp * 0.75);
    const correctionReferenceMidi = centerMidi + vibratoDeviation * (1 - vibratoPreserve);
    let correction = guideMidi - correctionReferenceMidi;

    const deadBand = 0.012 + humanizeNorm * (0.025 + sustainRamp * 0.085);
    const absCorrection = Math.abs(correction);
    if (absCorrection < deadBand) {
      const x = clamp(absCorrection / Math.max(0.0001, deadBand), 0, 1);
      correction *= x * x * (3 - 2 * x);
    }

    // Attack protection is musical; unlike confidence, it is intentionally a
    // correction-depth control for a very short onset window.
    const attackWindow = 0.018 + humanizeNorm * 0.07;
    const attackProgress = clamp(noteAge / Math.max(0.005, attackWindow), 0, 1);
    const attackStrength = 1 - humanizeNorm * 0.55 * (1 - attackProgress);
    correction *= attackStrength;

    this.detectedHz = pitchHz;
    this.targetHz = targetHz;
    this.closestNoteName = NOTE_NAMES[noteClass] || 'C';
    this.centsDeviation = clamp(Math.round((stableTarget - continuousMidi) * 100), -50, 50);
    this.isTracking = true;
    this.confidence = confidence;
    this.lastVoicedAt = now;
    this.applyPitchShift(correction, deltaSeconds, noteAge);
  }

  private handleUnvoiced(resetFrequency: boolean, deltaSeconds: number) {
    const now = this.rawCtx.currentTime;
    this.isTracking = false;
    this.confidence *= 0.88;
    if (resetFrequency) {
      this.detectedHz = 0;
      this.targetHz = 0;
    }

    const elapsed = now - this.lastVoicedAt;

    // Give normal consonants a longer hold. Releasing correction too early can
    // turn an S/T/K region into an audible miniature pitch sweep. Only after the
    // consonant-sized hold do we move gently toward neutral.
    if (elapsed >= 0.10) {
      const releaseAlpha = this.alphaForTimeConstant(deltaSeconds, 0.075);
      this.currentShiftSemitones += (0 - this.currentShiftSemitones) * releaseAlpha;
      if (Math.abs(this.currentShiftSemitones) < 0.001) this.currentShiftSemitones = 0;
      this.pushPitchShiftValue();
    }

    if (elapsed < 0.26) return;
    this.stableTargetMidi = null;
    this.candidateTargetMidi = null;
    this.candidateTargetFrames = 0;
    this.targetGuideMidi = null;
    this.smoothedMidi = null;
    this.pitchCenterMidi = null;
    this.measuredHistory = [];
    this.octaveCandidateMidi = null;
    this.octaveCandidateFrames = 0;
    this.noteStartedAt = -Infinity;
    this.centsDeviation = Math.round(this.centsDeviation * 0.6);
  }

  private applyPitchShift(targetSemitones: number, deltaSeconds: number, noteAgeSeconds: number) {
    const speedNorm = this.speed / 100;
    const humanizeNorm = this.humanize / 100;
    let retuneMs = 4 + Math.pow(1 - speedNorm, 2.15) * 190;
    const sustainRamp = clamp((noteAgeSeconds - 0.12) / 0.42, 0, 1);
    retuneMs += humanizeNorm * sustainRamp * 95;

    const alpha = this.alphaForTimeConstant(deltaSeconds, Math.max(0.003, retuneMs / 1000));
    const clampedTarget = clamp(targetSemitones, -1.25, 1.25);
    this.currentShiftSemitones += (clampedTarget - this.currentShiftSemitones) * alpha;
    if (Math.abs(this.currentShiftSemitones) < 0.0008) this.currentShiftSemitones = 0;
    this.pushPitchShiftValue();
  }

  private pushPitchShiftValue() {
    const value = clamp(this.currentShiftSemitones, -1.25, 1.25);
    if (this.workletNode) {
      const parameter = this.workletNode.parameters.get('semitones');
      if (parameter) {
        const now = this.rawCtx.currentTime;
        try { parameter.cancelAndHoldAtTime(now); } catch { parameter.cancelScheduledValues(now); }
        // AudioParam automation plus the worklet's sample-domain slew prevents
        // control-rate steps from reaching the grain read-head velocity.
        parameter.setTargetAtTime(value, now, 0.006);
      }
    }

    if (this.fallbackPitchShift && Math.abs(this.fallbackPitchShift.pitch - value) >= 0.01) {
      this.fallbackPitchShift.pitch = value;
    }
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
      correctionCents: this.currentShiftSemitones * 100,
      backend: this.backend,
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
    if (this.workletNode) {
      try { this.workletNode.port.close(); } catch {}
      try { this.workletNode.disconnect(); } catch {}
      this.workletNode = null;
    }
    try { this.fallbackPitchShift?.dispose(); } catch {}
    this.fallbackPitchShift = null;
    try { this.startupDryGain.dispose(); } catch {}
    try { this.correctedGain.dispose(); } catch {}
    try { this.colorFilter.dispose(); } catch {}
    super.dispose();
    return this;
  }
}
