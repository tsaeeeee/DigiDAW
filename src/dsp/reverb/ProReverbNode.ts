import * as Tone from 'tone';
import { ReverbParams, DEFAULT_REVERB_PARAMS } from './ReverbParameters';

export interface ReverbTelemetry {
  inputRms: number;
  reverbRms: number;
  feedbackRms: number;
  outputRms: number;
  isProcessing: boolean;
}

/**
 * Stable native Web Audio reverb node.
 *
 * The former implementation processed every sample in a ScriptProcessorNode,
 * which runs on the main thread and could silently fall back to a dry bypass.
 * This version keeps the same DigiDAW-facing API while using a native
 * ConvolverNode plus filter/gain stages, so the browser audio renderer owns the
 * realtime processing path.
 */
export class ProReverbNode extends Tone.ToneAudioNode<any> {
  readonly name = 'ProReverbNode';

  public static lastActiveInstance: ProReverbNode | null = null;
  public static instances: Set<ProReverbNode> = new Set();

  public readonly input: Tone.Gain;
  public readonly output: Tone.Gain;
  public readonly inputNode: Tone.Gain;
  public readonly outputNode: Tone.Gain;

  private rawCtx: BaseAudioContext;
  private params: ReverbParams;

  private dryGain: GainNode;
  private wetGain: GainNode;
  private preDelay: DelayNode;
  private lowCut: BiquadFilterNode;
  private highCut: BiquadFilterNode;
  private bassShelf: BiquadFilterNode;
  private convolver: ConvolverNode;
  private inputAnalyser: AnalyserNode;
  private outputAnalyser: AnalyserNode;
  private inputMeterData: Float32Array;
  private outputMeterData: Float32Array;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(context?: any, initialParams: Partial<ReverbParams> = {}) {
    super();

    const raw: BaseAudioContext =
      (context && typeof context.createGain === 'function' && context) ||
      (context && context.rawContext && context.rawContext) ||
      Tone.getContext().rawContext;

    this.rawCtx = raw;
    this.params = { ...DEFAULT_REVERB_PARAMS, ...initialParams };

    this.inputNode = new Tone.Gain({ context: this.context });
    this.outputNode = new Tone.Gain({ context: this.context });
    this.input = this.inputNode;
    this.output = this.outputNode;

    this.dryGain = raw.createGain();
    this.wetGain = raw.createGain();
    this.preDelay = raw.createDelay(0.3);
    this.lowCut = raw.createBiquadFilter();
    this.highCut = raw.createBiquadFilter();
    this.bassShelf = raw.createBiquadFilter();
    this.convolver = raw.createConvolver();

    this.lowCut.type = 'highpass';
    this.highCut.type = 'lowpass';
    this.bassShelf.type = 'lowshelf';
    this.convolver.normalize = true;

    this.inputAnalyser = raw.createAnalyser();
    this.outputAnalyser = raw.createAnalyser();
    this.inputAnalyser.fftSize = 512;
    this.outputAnalyser.fftSize = 512;
    this.inputMeterData = new Float32Array(this.inputAnalyser.fftSize);
    this.outputMeterData = new Float32Array(this.outputAnalyser.fftSize);

    const nativeIn = this.inputNode.input as AudioNode;
    const nativeOut = this.outputNode.input as AudioNode;

    // Dry path.
    nativeIn.connect(this.dryGain);
    this.dryGain.connect(nativeOut);

    // Wet path: pre-delay -> tone shaping -> convolution -> wet level.
    nativeIn.connect(this.preDelay);
    this.preDelay.connect(this.lowCut);
    this.lowCut.connect(this.highCut);
    this.highCut.connect(this.bassShelf);
    this.bassShelf.connect(this.convolver);
    this.convolver.connect(this.wetGain);
    this.wetGain.connect(nativeOut);

    // Meter taps do not affect the audible path.
    nativeIn.connect(this.inputAnalyser);
    nativeOut.connect(this.outputAnalyser);

    this.applyRealtimeParams();
    this.rebuildImpulse();

    ProReverbNode.instances.add(this);
    ProReverbNode.lastActiveInstance = this;
  }

  public setParams(newParams: Partial<ReverbParams>): void {
    const previous = this.params;
    this.params = { ...this.params, ...newParams };
    this.applyRealtimeParams();

    const impulseChanged =
      previous.size !== this.params.size ||
      previous.decay !== this.params.decay ||
      previous.diff !== this.params.diff ||
      previous.mod !== this.params.mod ||
      previous.speed !== this.params.speed ||
      previous.sep !== this.params.sep;

    if (impulseChanged) this.scheduleImpulseRebuild();
  }

  private applyRealtimeParams() {
    const p = this.params;
    const now = (this.rawCtx as AudioContext).currentTime || 0;

    const dry = Math.max(0, Math.min(1.25, (p.dry ?? 100) / 100));
    const wet = Math.max(0, Math.min(1.5, (p.wet ?? 50) / 100));

    this.dryGain.gain.setTargetAtTime(dry, now, 0.01);
    this.wetGain.gain.setTargetAtTime(wet, now, 0.01);
    this.preDelay.delayTime.setTargetAtTime(
      Math.max(0, Math.min(0.25, (p.predelay ?? 20) / 1000)),
      now,
      0.01,
    );

    this.lowCut.frequency.setTargetAtTime(Math.max(20, Math.min(2000, p.lcut ?? 120)), now, 0.01);
    this.lowCut.Q.setTargetAtTime(0.707, now, 0.01);
    this.highCut.frequency.setTargetAtTime(Math.max(1000, Math.min(20000, p.hcut ?? 12000)), now, 0.01);
    this.highCut.Q.setTargetAtTime(0.707, now, 0.01);

    const bass = Math.max(0.5, Math.min(2, p.bass ?? 1));
    this.bassShelf.frequency.setTargetAtTime(Math.max(100, Math.min(2000, p.cross ?? 500)), now, 0.01);
    this.bassShelf.gain.setTargetAtTime(12 * Math.log2(bass), now, 0.01);
  }

  private scheduleImpulseRebuild() {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      if (!this.disposed) this.rebuildImpulse();
    }, 70);
  }

  private rebuildImpulse() {
    const sr = this.rawCtx.sampleRate || 44100;
    const p = this.params;
    const decay = Math.max(0.2, Math.min(20, p.decay ?? 2.5));
    const size = Math.max(10, Math.min(100, p.size ?? 65)) / 100;
    const diffusion = Math.max(0, Math.min(100, p.diff ?? 80)) / 100;
    const mod = Math.max(0, Math.min(100, p.mod ?? 30)) / 100;
    const separation = Math.max(-1, Math.min(1, (p.sep ?? 0) / 100));

    const duration = Math.max(0.25, Math.min(12, decay * (0.6 + size * 0.65)));
    const length = Math.max(256, Math.floor(sr * duration));
    const impulse = this.rawCtx.createBuffer(2, length, sr);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    // Deterministic pseudo-random generator keeps the room character stable
    // while parameters are changed.
    let seedL = 0x12345678;
    let seedR = 0x6d2b79f5;
    const rand = (rightChannel: boolean) => {
      let x = rightChannel ? seedR : seedL;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      if (rightChannel) seedR = x >>> 0;
      else seedL = x >>> 0;
      return ((x >>> 0) / 0xffffffff) * 2 - 1;
    };

    const density = 0.14 + diffusion * 0.86;
    const modulationDepth = mod * 0.12;
    const decorrelation = 0.35 + Math.abs(separation) * 0.45;

    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const envelope = Math.pow(10, (-3 * t) / decay);
      const build = Math.min(1, t / Math.max(0.005, 0.035 * (1.1 - size * 0.7)));
      const flutter = 1 + modulationDepth * Math.sin(2 * Math.PI * (0.17 + (p.speed ?? 1.5) * 0.07) * t);

      const gateL = Math.abs(rand(false)) < density ? 1 : 0;
      const gateR = Math.abs(rand(true)) < density ? 1 : 0;
      const noiseL = rand(false) * gateL;
      const noiseR = rand(true) * gateR;
      const common = (noiseL + noiseR) * 0.5;

      left[i] = (common * (1 - decorrelation) + noiseL * decorrelation) * envelope * build * flutter;
      right[i] = (common * (1 - decorrelation) + noiseR * decorrelation) * envelope * build * flutter;
    }

    // Add a few deterministic early reflections so short settings still sound
    // like a room rather than plain filtered noise.
    const earlyMs = [7, 13, 23, 37, 53, 79];
    const earlyAmount = Math.max(0, Math.min(1, (p.er ?? 40) / 100));
    earlyMs.forEach((ms, index) => {
      const pos = Math.min(length - 1, Math.floor((ms / 1000) * sr * (0.65 + size * 0.8)));
      const amp = earlyAmount * (0.7 / (index + 1));
      left[pos] += amp * (index % 2 === 0 ? 1 : -0.75);
      right[pos] += amp * (index % 2 === 0 ? 0.72 : -1);
    });

    this.convolver.buffer = impulse;
  }

  private readRms(analyser: AnalyserNode, data: Float32Array): number {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  }

  public getTelemetry(): ReverbTelemetry {
    const inputRms = this.readRms(this.inputAnalyser, this.inputMeterData);
    const outputRms = this.readRms(this.outputAnalyser, this.outputMeterData);
    const wetRatio = Math.max(0, Math.min(1, (this.params.wet ?? 50) / 100));

    return {
      inputRms,
      reverbRms: outputRms * wetRatio,
      feedbackRms: outputRms * wetRatio * Math.min(0.95, (this.params.decay ?? 2.5) / 20),
      outputRms,
      isProcessing: inputRms > 0.0001 || outputRms > 0.0001,
    };
  }

  public dispose(): this {
    this.disposed = true;
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);

    ProReverbNode.instances.delete(this);
    if (ProReverbNode.lastActiveInstance === this) {
      ProReverbNode.lastActiveInstance = ProReverbNode.instances.values().next().value || null;
    }

    const nodes: AudioNode[] = [
      this.dryGain,
      this.wetGain,
      this.preDelay,
      this.lowCut,
      this.highCut,
      this.bassShelf,
      this.convolver,
      this.inputAnalyser,
      this.outputAnalyser,
    ];
    nodes.forEach(node => {
      try { node.disconnect(); } catch {}
    });

    try { this.inputNode.dispose(); } catch {}
    try { this.outputNode.dispose(); } catch {}

    super.dispose();
    return this;
  }
}
