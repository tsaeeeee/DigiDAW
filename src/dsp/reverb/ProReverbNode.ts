import * as Tone from 'tone';
import { ReverbParams, DEFAULT_REVERB_PARAMS } from './ReverbParameters';

export interface ReverbTelemetry {
  inputRms: number;
  reverbRms: number;
  feedbackRms: number;
  outputRms: number;
  isProcessing: boolean;
}

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
  private dampingFilter: BiquadFilterNode;
  private convolver: ConvolverNode;
  private inputAnalyser: AnalyserNode;
  private wetAnalyser: AnalyserNode;
  private outputAnalyser: AnalyserNode;
  private inputMeterData: Float32Array;
  private wetMeterData: Float32Array;
  private outputMeterData: Float32Array;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private isDisposedInternal = false;

  constructor(context?: BaseAudioContext, initialParams: Partial<ReverbParams> = {}) {
    super();
    this.rawCtx = context || Tone.getContext().rawContext;
    this.params = { ...DEFAULT_REVERB_PARAMS, ...initialParams };
    this.inputNode = new Tone.Gain({ context: this.context });
    this.outputNode = new Tone.Gain({ context: this.context });
    this.input = this.inputNode;
    this.output = this.outputNode;

    const raw = this.rawCtx;
    this.dryGain = raw.createGain();
    this.wetGain = raw.createGain();
    this.preDelay = raw.createDelay(0.3);
    this.lowCut = raw.createBiquadFilter();
    this.highCut = raw.createBiquadFilter();
    this.bassShelf = raw.createBiquadFilter();
    this.dampingFilter = raw.createBiquadFilter();
    this.convolver = raw.createConvolver();
    this.lowCut.type = 'highpass';
    this.highCut.type = 'lowpass';
    this.bassShelf.type = 'lowshelf';
    this.dampingFilter.type = 'lowpass';
    this.convolver.normalize = true;

    this.inputAnalyser = raw.createAnalyser();
    this.wetAnalyser = raw.createAnalyser();
    this.outputAnalyser = raw.createAnalyser();
    this.inputAnalyser.fftSize = 512;
    this.wetAnalyser.fftSize = 512;
    this.outputAnalyser.fftSize = 512;
    this.inputMeterData = new Float32Array(this.inputAnalyser.fftSize);
    this.wetMeterData = new Float32Array(this.wetAnalyser.fftSize);
    this.outputMeterData = new Float32Array(this.outputAnalyser.fftSize);

    const nativeInput = this.inputNode.input as AudioNode;
    const nativeOutput = this.outputNode.input as AudioNode;
    nativeInput.connect(this.dryGain);
    this.dryGain.connect(nativeOutput);
    nativeInput.connect(this.preDelay);
    this.preDelay.connect(this.lowCut);
    this.lowCut.connect(this.highCut);
    this.highCut.connect(this.bassShelf);
    this.bassShelf.connect(this.convolver);
    this.convolver.connect(this.dampingFilter);
    this.dampingFilter.connect(this.wetGain);
    this.wetGain.connect(nativeOutput);
    nativeInput.connect(this.inputAnalyser);
    this.wetGain.connect(this.wetAnalyser);
    nativeOutput.connect(this.outputAnalyser);

    this.applyRealtimeParams(true);
    this.rebuildImpulse();
    ProReverbNode.instances.add(this);
    ProReverbNode.lastActiveInstance = this;
  }

  public setParams(next: Partial<ReverbParams>): void {
    if (this.isDisposedInternal) return;
    const previous = this.params;
    this.params = { ...this.params, ...next };
    this.applyRealtimeParams(false);
    const structuralChange = previous.size !== this.params.size || previous.decay !== this.params.decay || previous.diff !== this.params.diff || previous.mod !== this.params.mod || previous.speed !== this.params.speed || previous.sep !== this.params.sep || previous.er !== this.params.er || previous.mode !== this.params.mode;
    if (structuralChange) this.scheduleImpulseRebuild();
  }

  private applyRealtimeParams(immediate: boolean) {
    const p = this.params;
    const now = this.rawCtx.currentTime;
    const set = (param: AudioParam, value: number, timeConstant = 0.012) => {
      if (immediate) param.setValueAtTime(value, now);
      else {
        param.cancelScheduledValues(now);
        param.setTargetAtTime(value, now, timeConstant);
      }
    };
    set(this.dryGain.gain, this.clamp((p.dry ?? 100) / 100, 0, 1));
    set(this.wetGain.gain, this.clamp((p.wet ?? 50) / 100, 0, 1));
    set(this.preDelay.delayTime, this.clamp((p.predelay ?? 20) / 1000, 0, 0.25));
    set(this.lowCut.frequency, this.clamp(p.lcut ?? 120, 20, 2000));
    set(this.lowCut.Q, 0.707);
    set(this.highCut.frequency, this.clamp(p.hcut ?? 12000, 1000, 20000));
    set(this.highCut.Q, 0.707);
    const bassMultiplier = this.clamp(p.bass ?? 1, 0.5, 2);
    set(this.bassShelf.frequency, this.clamp(p.cross ?? 500, 100, 2000));
    set(this.bassShelf.gain, 6 * Math.log2(bassMultiplier));
    set(this.dampingFilter.frequency, this.clamp(p.damp ?? 5000, 500, 18000));
    set(this.dampingFilter.Q, 0.707);
  }

  private scheduleImpulseRebuild() {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      if (!this.isDisposedInternal) this.rebuildImpulse();
    }, 80);
  }

  private rebuildImpulse() {
    if (this.isDisposedInternal) return;
    const p = this.params;
    const sampleRate = this.rawCtx.sampleRate || 44100;
    const decay = this.clamp(p.decay ?? 2.5, 0.2, 20);
    const size = this.clamp(p.size ?? 65, 10, 100) / 100;
    const diffusion = this.clamp(p.diff ?? 80, 0, 100) / 100;
    const modulation = this.clamp(p.mod ?? 30, 0, 100) / 100;
    const modulationSpeed = this.clamp(p.speed ?? 1.5, 0.1, 10);
    const separation = this.clamp(p.sep ?? 0, -100, 100) / 100;
    const earlyAmount = this.clamp(p.er ?? 40, 0, 100) / 100;
    const sideMode = (p.mode ?? 0) === 1;
    const duration = this.clamp(decay * (0.72 + size * 0.42), 0.25, 12);
    const length = Math.max(256, Math.floor(sampleRate * duration));
    const impulse = this.rawCtx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    let stateL = 0x12345678;
    let stateR = 0x6d2b79f5;
    const random = (rightChannel: boolean) => {
      let x = rightChannel ? stateR : stateL;
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      if (rightChannel) stateR = x >>> 0; else stateL = x >>> 0;
      return ((x >>> 0) / 0xffffffff) * 2 - 1;
    };

    const density = 0.18 + diffusion * 0.82;
    const buildSeconds = 0.004 + (1 - size) * 0.035;
    const decorrelation = this.clamp(0.3 + Math.abs(separation) * 0.65 + (sideMode ? 0.2 : 0), 0, 1);
    const modulationDepth = modulation * 0.11;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const envelope = Math.pow(10, (-3 * t) / decay);
      const build = Math.min(1, t / buildSeconds);
      const flutter = 1 + modulationDepth * Math.sin(2 * Math.PI * modulationSpeed * t);
      let noiseL = Math.abs(random(false)) < density ? random(false) : 0;
      let noiseR = Math.abs(random(true)) < density ? random(true) : 0;
      const common = (noiseL + noiseR) * 0.5;
      noiseL = common * (1 - decorrelation) + noiseL * decorrelation;
      noiseR = common * (1 - decorrelation) + noiseR * decorrelation;
      if (sideMode) noiseR *= -1;
      left[i] = noiseL * envelope * build * flutter;
      right[i] = noiseR * envelope * build * flutter;
    }

    const earlyMs = [5.3, 8.9, 13.7, 21.1, 34.7, 55.3, 79.1];
    for (let index = 0; index < earlyMs.length; index++) {
      const scaledMs = earlyMs[index] * (0.62 + size * 0.9);
      const position = Math.min(length - 1, Math.round((scaledMs / 1000) * sampleRate));
      const amplitude = earlyAmount * (0.72 / Math.pow(index + 1, 0.72));
      const polarity = index % 2 === 0 ? 1 : -1;
      left[position] += amplitude * polarity;
      right[position] += amplitude * (index % 3 === 0 ? -polarity : polarity * 0.78) * (sideMode ? -1 : 1);
    }
    this.convolver.buffer = impulse;
  }

  private clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
  private readRms(analyser: AnalyserNode, data: Float32Array): number {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  }
  public getTelemetry(): ReverbTelemetry {
    const inputRms = this.readRms(this.inputAnalyser, this.inputMeterData);
    const reverbRms = this.readRms(this.wetAnalyser, this.wetMeterData);
    const outputRms = this.readRms(this.outputAnalyser, this.outputMeterData);
    return { inputRms, reverbRms, feedbackRms: reverbRms * this.clamp((this.params.size ?? 65) / 100, 0, 1), outputRms, isProcessing: inputRms > 0.0001 || reverbRms > 0.0001 || outputRms > 0.0001 };
  }
  public dispose(): this {
    if (this.isDisposedInternal) return this;
    this.isDisposedInternal = true;
    if (this.rebuildTimer) { clearTimeout(this.rebuildTimer); this.rebuildTimer = null; }
    ProReverbNode.instances.delete(this);
    if (ProReverbNode.lastActiveInstance === this) ProReverbNode.lastActiveInstance = ProReverbNode.instances.values().next().value || null;
    const nativeNodes: AudioNode[] = [this.dryGain, this.wetGain, this.preDelay, this.lowCut, this.highCut, this.bassShelf, this.dampingFilter, this.convolver, this.inputAnalyser, this.wetAnalyser, this.outputAnalyser];
    nativeNodes.forEach((node) => { try { node.disconnect(); } catch {} });
    super.dispose();
    return this;
  }
}
