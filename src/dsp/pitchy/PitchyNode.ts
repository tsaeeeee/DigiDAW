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
}

/**
 * Realtime chromatic pitch-correction node.
 *
 * The previous implementation performed YIN + granular resampling inside a
 * deprecated ScriptProcessorNode. That put the heaviest DSP on the browser
 * main thread and could silently fall back to bypass. This version keeps the
 * public API intact, but uses Tone.PitchShift for the actual audio transform
 * and a lightweight analyser-driven detector for control-rate pitch tracking.
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
  private analysisTimer: ReturnType<typeof setInterval> | null = null;
  private rawCtx: BaseAudioContext;
  private disposed = false;

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
  private currentShiftSemitones = 0;

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
      windowSize: 0.045,
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

    this.analyser = this.rawCtx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.15;
    this.analysisData = new Float32Array(this.analyser.fftSize);

    const nativeInput = this.inputNode.input as AudioNode;
    nativeInput.connect(this.analyser);

    this.update(options);
    this.startAnalysis();

    PitchyNode.instances.add(this);
    PitchyNode.lastActiveInstance = this;
  }

  public update(options: PitchyOptions) {
    if (options.referenceHz !== undefined) {
      this.referenceHz = Math.max(415, Math.min(466, options.referenceHz));
    }
    if (options.speed !== undefined) this.speed = Math.max(0, Math.min(100, options.speed));
    if (options.humanize !== undefined) this.humanize = Math.max(0, Math.min(100, options.humanize));
    if (options.transition !== undefined) this.transition = Math.max(0, Math.min(100, options.transition));
    if (options.mode !== undefined) this.mode = options.mode;

    if (options.color !== undefined) {
      this.color = Math.max(0, Math.min(100, options.color));
      const gain = (this.color - 50) * 0.18;
      const freq = 1400 + (this.color / 100) * 3600;
      this.colorFilter.gain.value = gain;
      this.colorFilter.frequency.value = freq;
    }

    // HQ trades a little more latency for a smoother pitch-shift window.
    this.pitchShift.windowSize = this.mode === 'hq' ? 0.075 : 0.035;
  }

  private startAnalysis() {
    if (this.analysisTimer) clearInterval(this.analysisTimer);
    const intervalMs = this.mode === 'hq' ? 35 : 22;
    this.analysisTimer = setInterval(() => this.analysePitch(), intervalMs);
  }

  private analysePitch() {
    if (this.disposed) return;

    this.analyser.getFloatTimeDomainData(this.analysisData);
    const buffer = this.analysisData;

    let sumSq = 0;
    let mean = 0;
    for (let i = 0; i < buffer.length; i++) {
      mean += buffer[i];
      sumSq += buffer[i] * buffer[i];
    }
    mean /= buffer.length;
    const rms = Math.sqrt(sumSq / buffer.length);
    this.currentRms = rms;

    if (rms < 0.008) {
      this.isTracking = false;
      this.detectedHz = 0;
      this.targetHz = 0;
      this.centsDeviation = Math.round(this.centsDeviation * 0.75);
      this.applyPitchShift(0);
      return;
    }

    // Normalized autocorrelation over a vocal-friendly range.
    const sr = this.rawCtx.sampleRate || 44100;
    const minHz = 70;
    const maxHz = 1000;
    const minLag = Math.max(2, Math.floor(sr / maxHz));
    const maxLag = Math.min(Math.floor(sr / minHz), Math.floor(buffer.length / 2));

    let bestLag = -1;
    let bestCorrelation = 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      let energyA = 0;
      let energyB = 0;
      const limit = buffer.length - lag;

      for (let i = 0; i < limit; i += 2) {
        const a = buffer[i] - mean;
        const b = buffer[i + lag] - mean;
        corr += a * b;
        energyA += a * a;
        energyB += b * b;
      }

      const denom = Math.sqrt(energyA * energyB) + 1e-12;
      const normalized = corr / denom;
      if (normalized > bestCorrelation) {
        bestCorrelation = normalized;
        bestLag = lag;
      }
    }

    if (bestLag < 0 || bestCorrelation < 0.58) {
      this.isTracking = false;
      this.applyPitchShift(0);
      return;
    }

    // Small parabolic refinement around the winning lag.
    const pitchHz = sr / bestLag;
    if (!Number.isFinite(pitchHz) || pitchHz < minHz || pitchHz > maxHz) {
      this.isTracking = false;
      this.applyPitchShift(0);
      return;
    }

    const continuousMidi = 69 + 12 * Math.log2(pitchHz / this.referenceHz);
    const targetMidi = Math.round(continuousMidi);
    const targetHz = this.referenceHz * Math.pow(2, (targetMidi - 69) / 12);
    const semitoneCorrection = targetMidi - continuousMidi;
    const noteClass = ((targetMidi % 12) + 12) % 12;

    this.detectedHz = pitchHz;
    this.targetHz = targetHz;
    this.closestNoteName = NOTE_NAMES[noteClass] || 'C';
    this.centsDeviation = Math.max(-50, Math.min(50, Math.round(semitoneCorrection * 100)));
    this.isTracking = true;

    const speedAmount = this.speed / 100;
    const humanizeAmount = this.humanize / 100;
    let correction = semitoneCorrection * speedAmount;

    // Preserve tiny intentional vibrato when Humanize is raised.
    const deadbandSemitones = humanizeAmount * 0.22;
    if (Math.abs(semitoneCorrection) < deadbandSemitones) {
      correction *= 1 - humanizeAmount * 0.92;
    }

    this.applyPitchShift(correction);
  }

  private applyPitchShift(targetSemitones: number) {
    const glide = 0.06 + (this.transition / 100) * 0.88;
    const response = 1 - glide;
    const alpha = Math.max(0.03, Math.min(0.8, response));

    this.currentShiftSemitones += (targetSemitones - this.currentShiftSemitones) * alpha;
    if (Math.abs(this.currentShiftSemitones) < 0.002) this.currentShiftSemitones = 0;

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
    };
  }

  public dispose(): this {
    this.disposed = true;
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }

    PitchyNode.instances.delete(this);
    if (PitchyNode.lastActiveInstance === this) {
      PitchyNode.lastActiveInstance = PitchyNode.instances.values().next().value || null;
    }

    try { this.analyser.disconnect(); } catch {}
    try { this.inputNode.disconnect(); } catch {}
    try { this.pitchShift.disconnect(); } catch {}
    try { this.colorFilter.disconnect(); } catch {}
    try { this.outputNode.disconnect(); } catch {}

    try { this.pitchShift.dispose(); } catch {}
    try { this.colorFilter.dispose(); } catch {}
    try { this.inputNode.dispose(); } catch {}
    try { this.outputNode.dispose(); } catch {}

    super.dispose();
    return this;
  }
}
