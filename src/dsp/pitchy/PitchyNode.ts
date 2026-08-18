import * as Tone from 'tone';

export interface PitchyOptions {
  referenceHz?: number;       // e.g. 440.0 Hz
  speed?: number;             // 0 - 100 (0 = natural/soft, 100 = hard auto-tune snap)
  humanize?: number;          // 0 - 100 (0 = tight/robotic, 100 = loose/natural vibrato)
  transition?: number;        // 0 - 100 (0 = instant snap, 100 = slow glide)
  color?: number;             // 0 - 100 (formant/presence tone)
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
 * 4-Point Hermite (Cubic) Interpolation for crystal clear audio resampling with zero phase distortion
 */
function interpolateHermite(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const c0 = p1;
  const c1 = 0.5 * (p2 - p0);
  const c2 = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
  const c3 = 0.5 * (p3 - p0) + 1.5 * (p1 - p2);
  return ((c3 * t + c2) * t + c1) * t + c0;
}

function readRingHermite(buffer: Float32Array, pos: number, size: number): number {
  let p = pos;
  while (p < 0) p += size;
  while (p >= size) p -= size;
  const i1 = Math.floor(p);
  const frac = p - i1;
  const i0 = (i1 - 1 + size) % size;
  const i2 = (i1 + 1) % size;
  const i3 = (i1 + 2) % size;
  return interpolateHermite(buffer[i0], buffer[i1], buffer[i2], buffer[i3], frac);
}

/**
 * Studio Auto-Tune DSP Processor
 *
 * Implements:
 * 1. Continuous YIN Fundamental Pitch Detection on chronological linear sliding window.
 * 2. 12-TET Chromatic note quantization relative to reference frequency (440.0 Hz).
 * 3. Dual-Head Hann-Windowed Granular Resampler with Hermite interpolation.
 * 4. Hard-tune snap & natural vocal polish speed/humanize/transition dynamics.
 * 5. Presence & formant tone shaping filter.
 * 6. Real-time telemetry for visual spectrum & cents meter tracking.
 */
export class PitchyNode extends Tone.ToneAudioNode<any> {
  readonly name: string = 'PitchyNode';
  public static lastActiveInstance: PitchyNode | null = null;
  public static instances: Set<PitchyNode> = new Set();
  public static activeProcessors: Set<ScriptProcessorNode> = new Set();

  public readonly input: Tone.Gain;
  public readonly output: Tone.Gain;
  public readonly inputNode: Tone.Gain;
  public readonly outputNode: Tone.Gain;
  public nativeFilter: BiquadFilterNode;
  public processorNode: ScriptProcessorNode;

  private rawCtx: AudioContext;
  private sampleRate: number;

  // Parameters
  public referenceHz: number = 440.0;
  public speed: number = 75;         // 0 - 100 (0 = natural/soft, 100 = hard auto-tune snap)
  public humanize: number = 20;      // 0 - 100 (0 = tight/robotic, 100 = loose/natural vibrato)
  public transition: number = 30;    // 0 - 100 (0 = instant snap, 100 = slow glide)
  public color: number = 50;         // 0 - 100 (formant/presence tone)
  public mode: 'realtime' | 'hq' = 'realtime';

  // Live pitch tracking state
  public detectedHz: number = 0;
  public targetHz: number = 0;
  public closestNoteName: string = 'C';
  public centsDeviation: number = 0;
  public isTracking: boolean = false;
  public currentRms: number = 0;

  // Circular Delay Ring Buffers
  private ringBufferSize: number = 65536;
  private ringL: Float32Array;
  private ringR: Float32Array;
  private writePos: number = 0;
  private readonly centerDelay: number = 4096;

  // Granular Pitch Shifting State
  private grainPhase1: number = 0.0;
  private grainPhase2: number = 0.5;
  private currentAlpha: number = 1.0;
  private targetAlpha: number = 1.0;
  private currentGrainSize: number = 1024;
  private readonly defaultGrainSize: number = 1024;

  // Pitch Analysis Buffers (Continuous sliding chronological window)
  private analysisBufferSize: number = 2048;
  private analysisBuffer: Float32Array;
  private yinBuffer: Float32Array;

  private isDisposed: boolean = false;

  constructor(options: PitchyOptions = {}) {
    super();

    const rawContext: any =
      (this.context && (this.context as any).rawContext && typeof (this.context as any).rawContext.createScriptProcessor === 'function' && (this.context as any).rawContext) ||
      (Tone.getContext && Tone.getContext().rawContext && typeof (Tone.getContext().rawContext as any).createScriptProcessor === 'function' && Tone.getContext().rawContext) ||
      (Tone.context && (Tone.context as any).rawContext && typeof (Tone.context as any).rawContext.createScriptProcessor === 'function' && (Tone.context as any).rawContext) ||
      (this.context as any);

    this.rawCtx = rawContext;
    this.sampleRate = (rawContext && rawContext.sampleRate) || 44100;

    // Allocate ring buffers
    this.ringL = new Float32Array(this.ringBufferSize);
    this.ringR = new Float32Array(this.ringBufferSize);
    this.writePos = this.centerDelay;

    this.analysisBuffer = new Float32Array(this.analysisBufferSize);
    this.yinBuffer = new Float32Array(Math.floor(this.analysisBufferSize / 2));

    // Audio Graph Nodes
    this.inputNode = new Tone.Gain({ context: this.context });
    this.outputNode = new Tone.Gain({ context: this.context });
    this.input = this.inputNode;
    this.output = this.outputNode;

    // Presence / Formant color shaping via native BiquadFilterNode
    try {
      this.nativeFilter = this.rawCtx.createBiquadFilter();
      this.nativeFilter.type = 'peaking';
      this.nativeFilter.frequency.value = 3200;
      this.nativeFilter.gain.value = 0;
      this.nativeFilter.Q.value = 0.8;
    } catch {
      // fallback
    }

    // Create Real-time Audio DSP Processor Node (1024 sample buffer for reliable processing)
    try {
      const procSize = 1024;
      let proc: ScriptProcessorNode | null = null;
      if (this.rawCtx && typeof (this.rawCtx as any).createScriptProcessor === 'function') {
        proc = (this.rawCtx as any).createScriptProcessor(procSize, 2, 2);
      } else if (Tone.getContext && Tone.getContext().rawContext && typeof (Tone.getContext().rawContext as any).createScriptProcessor === 'function') {
        proc = (Tone.getContext().rawContext as any).createScriptProcessor(procSize, 2, 2);
      }

      if (proc) {
        this.processorNode = proc;
        this.processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
          this.processAudio(e);
        };
        PitchyNode.activeProcessors.add(this.processorNode);

        // Direct Native WebAudio Graph Routing:
        const nativeIn = (this.inputNode.input as GainNode) || (this.inputNode as any)._gainNode || this.inputNode.output;
        const nativeOut = (this.outputNode.input as GainNode) || (this.outputNode as any)._gainNode || this.outputNode.output;

        if (nativeIn && typeof nativeIn.connect === 'function') {
          nativeIn.connect(this.processorNode);
        }
        if (this.nativeFilter) {
          this.processorNode.connect(this.nativeFilter);
          if (nativeOut && typeof nativeOut.connect === 'function') {
            this.nativeFilter.connect(nativeOut);
          }
        } else if (nativeOut && typeof nativeOut.connect === 'function') {
          this.processorNode.connect(nativeOut);
        }
      } else {
        Tone.connect(this.inputNode, this.outputNode);
      }
    } catch (err) {
      console.warn('PitchyNode initialization bypass:', err);
      Tone.connect(this.inputNode, this.outputNode);
    }

    this.update(options);

    PitchyNode.instances.add(this);
    PitchyNode.lastActiveInstance = this;
  }

  public update(options: PitchyOptions) {
    if (options.referenceHz !== undefined) this.referenceHz = options.referenceHz;
    if (options.speed !== undefined) this.speed = Math.max(0, Math.min(100, options.speed));
    if (options.humanize !== undefined) this.humanize = Math.max(0, Math.min(100, options.humanize));
    if (options.transition !== undefined) this.transition = Math.max(0, Math.min(100, options.transition));
    if (options.color !== undefined) {
      this.color = Math.max(0, Math.min(100, options.color));
      const colorGain = (this.color - 50) * 0.24;
      const colorFreq = 1200 + (this.color / 100) * 3800;
      if (this.nativeFilter) {
        if (this.nativeFilter.gain) this.nativeFilter.gain.value = colorGain;
        if (this.nativeFilter.frequency) this.nativeFilter.frequency.value = colorFreq;
      }
    }
    if (options.mode !== undefined) this.mode = options.mode;
  }

  /**
   * Gold-Standard YIN Fundamental Pitch Detection Algorithm
   * Applied over a continuous, chronologically ordered sliding window
   */
  private detectPitchYIN(buffer: Float32Array, length: number): { pitchHz: number; periodSamples: number; confidence: number; rms: number } {
    let sumSq = 0;
    for (let i = 0; i < length; i++) {
      sumSq += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sumSq / length);

    // RMS noise floor check
    if (rms < 0.001) {
      return { pitchHz: 0, periodSamples: 0, confidence: 0, rms };
    }

    const halfLen = Math.floor(length / 2);
    const minPeriod = Math.max(16, Math.floor(this.sampleRate / 1600)); // ~1600 Hz max
    const maxPeriod = Math.min(halfLen - 1, Math.ceil(this.sampleRate / 55)); // ~55 Hz min

    const yin = this.yinBuffer;
    yin[0] = 1.0;

    // Step 1: Difference Function d(tau) = sum((x[j] - x[j+tau])^2)
    for (let tau = 1; tau <= maxPeriod; tau++) {
      let deltaSum = 0;
      for (let j = 0; j < halfLen; j++) {
        const diff = buffer[j] - buffer[j + tau];
        deltaSum += diff * diff;
      }
      yin[tau] = deltaSum;
    }

    // Step 2: Cumulative Mean Normalized Difference Function d'(tau)
    let runningSum = 0;
    for (let tau = 1; tau <= maxPeriod; tau++) {
      runningSum += yin[tau];
      if (runningSum > 0) {
        yin[tau] = (yin[tau] * tau) / runningSum;
      } else {
        yin[tau] = 1.0;
      }
    }

    // Step 3: Absolute Thresholding (Find first dip below threshold)
    const threshold = 0.18;
    let chosenTau = 0;

    for (let tau = minPeriod; tau <= maxPeriod; tau++) {
      if (yin[tau] < threshold) {
        // Find local minimum
        while (tau + 1 <= maxPeriod && yin[tau + 1] < yin[tau]) {
          tau++;
        }
        chosenTau = tau;
        break;
      }
    }

    // If no dip was below threshold, find global minimum below 0.40
    if (chosenTau === 0) {
      let minVal = 1.0;
      let bestTau = 0;
      for (let tau = minPeriod; tau <= maxPeriod; tau++) {
        if (yin[tau] < minVal) {
          minVal = yin[tau];
          bestTau = tau;
        }
      }
      if (minVal < 0.40 && bestTau > 0) {
        chosenTau = bestTau;
      }
    }

    if (chosenTau === 0) {
      return { pitchHz: 0, periodSamples: 0, confidence: 0, rms };
    }

    // Step 4: Parabolic Sub-sample Interpolation
    const x0 = chosenTau > 1 ? chosenTau - 1 : chosenTau;
    const x2 = chosenTau < maxPeriod ? chosenTau + 1 : chosenTau;
    let delta = 0;

    if (x0 !== chosenTau && x2 !== chosenTau) {
      const s0 = yin[x0];
      const s1 = yin[chosenTau];
      const s2 = yin[x2];
      const denom = 2 * (2 * s1 - s0 - s2);
      if (Math.abs(denom) > 1e-6) {
        delta = (s2 - s0) / denom;
        delta = Math.max(-0.5, Math.min(0.5, delta));
      }
    }

    const exactPeriod = chosenTau + delta;
    const exactHz = this.sampleRate / exactPeriod;
    const confidence = Math.max(0, Math.min(1, 1 - yin[chosenTau]));

    if (exactHz >= 50 && exactHz <= 1600) {
      return { pitchHz: exactHz, periodSamples: exactPeriod, confidence, rms };
    }

    return { pitchHz: 0, periodSamples: 0, confidence, rms };
  }

  /**
   * Quantizes detected input frequency to the closest chromatic musical note based on reference tuning (440Hz)
   */
  private quantizeChromaticPitch(hz: number): { targetHz: number; noteName: string; semitonesDiff: number } {
    if (hz <= 35) {
      return { targetHz: this.referenceHz, noteName: 'A', semitonesDiff: 0 };
    }

    // Continuous MIDI note calculation relative to referenceHz (MIDI 69 = A4)
    const semitonesFromRef = 12 * Math.log2(hz / this.referenceHz);
    const continuousMidi = 69 + semitonesFromRef;
    const closestMidi = Math.round(continuousMidi);

    const targetHz = this.referenceHz * Math.pow(2, (closestMidi - 69) / 12);
    const noteClass = ((closestMidi % 12) + 12) % 12;
    const noteName = NOTE_NAMES[noteClass] || 'C';
    const semitonesDiff = closestMidi - continuousMidi;

    return { targetHz, noteName, semitonesDiff };
  }

  /**
   * Real-time Audio Processing Callback (Granular Pitch Shifting with Equal-Power Crossfade)
   */
  private processAudio(e: AudioProcessingEvent) {
    if (this.isDisposed) return;

    const inL = e.inputBuffer.getChannelData(0);
    const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
    const outL = e.outputBuffer.getChannelData(0);
    const outR = e.outputBuffer.numberOfChannels > 1 ? e.outputBuffer.getChannelData(1) : outL;
    const blockLen = inL.length;

    // 1. Maintain continuous chronological sliding analysis window
    this.analysisBuffer.copyWithin(0, blockLen);
    const offset = this.analysisBufferSize - blockLen;
    for (let i = 0; i < blockLen; i++) {
      this.analysisBuffer[offset + i] = (inL[i] + inR[i]) * 0.5;
    }

    // 2. Fundamental pitch analysis via YIN
    const detection = this.detectPitchYIN(this.analysisBuffer, this.analysisBufferSize);
    this.currentRms = detection.rms;

    if (detection.pitchHz > 45) {
      this.detectedHz = detection.pitchHz;
      this.isTracking = true;

      const { targetHz, noteName, semitonesDiff } = this.quantizeChromaticPitch(detection.pitchHz);
      this.targetHz = targetHz;
      this.closestNoteName = noteName;
      this.centsDeviation = Math.max(-50, Math.min(50, Math.round(semitonesDiff * 100)));

      // Auto-Tune Speed & Humanize calculations:
      const speedRatio = this.speed / 100; // 0 = natural, 1.0 = instant hard snap

      let effectiveShiftSemitones = semitonesDiff * speedRatio;
      if (this.humanize > 0) {
        // Preserve natural micro-vibrato deadband
        const vibratoDeadband = (this.humanize / 100) * 0.25;
        if (Math.abs(semitonesDiff) < vibratoDeadband) {
          effectiveShiftSemitones *= (1 - (this.humanize / 100) * 0.90);
        }
      }

      // Desired frequency ratio: alpha = f_target / f_in
      const pitchRatio = Math.pow(2, effectiveShiftSemitones / 12);
      this.targetAlpha = pitchRatio;
    } else {
      // Unvoiced or silence: smoothly decay to 1.0 (unity pass-through)
      this.isTracking = false;
      this.targetAlpha = 1.0;
      this.centsDeviation = Math.round(this.centsDeviation * 0.85);
    }

    // Transition portamento smoothing rate
    const smoothingRate = Math.max(0.02, 1 - (this.transition / 100) * 0.92);

    // 3. Pitch-Synchronous Resampler with Hann Overlap-Add Windowing
    const detectedPeriod = detection.periodSamples > 0 ? detection.periodSamples : 256;
    const targetGrain = detection.pitchHz > 45 
      ? Math.max(256, Math.min(1536, Math.round(detectedPeriod * 2.5)))
      : 1024;
    this.currentGrainSize += (targetGrain - this.currentGrainSize) * 0.1;
    const grainSize = Math.max(256, Math.min(2048, Math.round(this.currentGrainSize)));
    const phaseInc = 1.0 / grainSize;

    const ringSize = this.ringBufferSize;
    const ringL = this.ringL;
    const ringR = this.ringR;
    const centerDelay = this.centerDelay;

    for (let i = 0; i < blockLen; i++) {
      // Write incoming samples into circular ring buffers
      ringL[this.writePos] = inL[i];
      ringR[this.writePos] = inR[i];

      // Smoothly update current pitch alpha ratio
      this.currentAlpha += (this.targetAlpha - this.currentAlpha) * (smoothingRate * 0.05);
      const alpha = this.currentAlpha;

      // Update Phase for Head 1 & Head 2
      this.grainPhase1 += phaseInc;
      if (this.grainPhase1 >= 1.0) this.grainPhase1 -= 1.0;

      this.grainPhase2 = (this.grainPhase1 + 0.5);
      if (this.grainPhase2 >= 1.0) this.grainPhase2 -= 1.0;

      // Hann Windowing (w1 + w2 = 1.0 for phase offset 0.5)
      const w1 = 0.5 * (1 - Math.cos(2 * Math.PI * this.grainPhase1));
      const w2 = 0.5 * (1 - Math.cos(2 * Math.PI * this.grainPhase2));

      // Delay modulations for Head 1 & Head 2
      const delayOffset1 = (this.grainPhase1 - 0.5) * grainSize * (1.0 - alpha);
      const delayOffset2 = (this.grainPhase2 - 0.5) * grainSize * (1.0 - alpha);

      const readPos1 = (this.writePos - centerDelay - delayOffset1 + ringSize * 2) % ringSize;
      const readPos2 = (this.writePos - centerDelay - delayOffset2 + ringSize * 2) % ringSize;

      // Read audio with 4-point Hermite cubic interpolation
      const s1L = readRingHermite(ringL, readPos1, ringSize);
      const s1R = readRingHermite(ringR, readPos1, ringSize);
      const s2L = readRingHermite(ringL, readPos2, ringSize);
      const s2R = readRingHermite(ringR, readPos2, ringSize);

      outL[i] = s1L * w1 + s2L * w2;
      outR[i] = s1R * w1 + s2R * w2;

      this.writePos = (this.writePos + 1) % ringSize;
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
      pitchRatio: this.currentAlpha,
    };
  }

  public dispose(): this {
    this.isDisposed = true;
    PitchyNode.instances.delete(this);
    PitchyNode.activeProcessors.delete(this.processorNode);
    if (PitchyNode.lastActiveInstance === this) {
      PitchyNode.lastActiveInstance = PitchyNode.instances.values().next().value || null;
    }

    try {
      this.processorNode.disconnect();
      this.processorNode.onaudioprocess = null;
    } catch {}

    try {
      this.nativeFilter.disconnect();
    } catch {}

    try {
      this.inputNode.disconnect();
      this.outputNode.disconnect();
    } catch {}

    try {
      this.inputNode.dispose();
      this.outputNode.dispose();
    } catch {}

    super.dispose();
    return this;
  }
}
