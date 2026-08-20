import * as Tone from 'tone';
import { ReverbParams, DEFAULT_REVERB_PARAMS } from './ReverbParameters';

export interface ReverbTelemetry {
  inputRms: number;
  reverbRms: number;
  feedbackRms: number;
  outputRms: number;
  isProcessing: boolean;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function forceStereo(node: any) {
  if (!node) return;
  const candidates = [node, node.input, node.output, node._gainNode];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { if ('channelCount' in candidate) candidate.channelCount = 2; } catch {}
    try { if ('channelCountMode' in candidate) candidate.channelCountMode = 'explicit'; } catch {}
    try { if ('channelInterpretation' in candidate) candidate.channelInterpretation = 'speakers'; } catch {}
  }
}

export class ProReverbNode extends Tone.ToneAudioNode<any> {
  readonly name = 'ProReverbNode';
  public static lastActiveInstance: ProReverbNode | null = null;
  public static instances = new Set<ProReverbNode>();

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
  private splitter: ChannelSplitterNode;
  private merger: ChannelMergerNode;
  private ll: GainNode;
  private lr: GainNode;
  private rl: GainNode;
  private rr: GainNode;
  private inputAnalyser: AnalyserNode;
  private wetAnalyser: AnalyserNode;
  private outputAnalyser: AnalyserNode;
  private inputMeterData: Float32Array;
  private wetMeterData: Float32Array;
  private outputMeterData: Float32Array;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private disposedInternal = false;

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
    this.lowCut = raw.createBiquadFilter(); this.lowCut.type = 'highpass';
    this.highCut = raw.createBiquadFilter(); this.highCut.type = 'lowpass';
    this.bassShelf = raw.createBiquadFilter(); this.bassShelf.type = 'lowshelf';
    this.dampingFilter = raw.createBiquadFilter(); this.dampingFilter.type = 'lowpass';
    this.convolver = raw.createConvolver(); this.convolver.normalize = true;
    this.splitter = raw.createChannelSplitter(2);
    this.merger = raw.createChannelMerger(2);
    this.ll = raw.createGain(); this.lr = raw.createGain(); this.rl = raw.createGain(); this.rr = raw.createGain();

    this.inputAnalyser = raw.createAnalyser(); this.inputAnalyser.fftSize = 512;
    this.wetAnalyser = raw.createAnalyser(); this.wetAnalyser.fftSize = 512;
    this.outputAnalyser = raw.createAnalyser(); this.outputAnalyser.fftSize = 512;
    this.inputMeterData = new Float32Array(this.inputAnalyser.fftSize);
    this.wetMeterData = new Float32Array(this.wetAnalyser.fftSize);
    this.outputMeterData = new Float32Array(this.outputAnalyser.fftSize);

    // A mono vocal should enter the reverb as an explicit stereo-speaker bus so
    // the two-channel IR and M/S-style width matrix can actually create a stereo
    // field. Stereo inputs keep their original L/R information.
    forceStereo(this.inputNode);
    forceStereo(this.outputNode);
    [this.dryGain, this.wetGain, this.preDelay, this.lowCut, this.highCut, this.bassShelf, this.dampingFilter].forEach(forceStereo);

    const nativeInput = this.inputNode.input as AudioNode;
    const nativeOutput = this.outputNode.input as AudioNode;
    forceStereo(nativeInput);
    forceStereo(nativeOutput);

    nativeInput.connect(this.dryGain); this.dryGain.connect(nativeOutput);
    nativeInput.connect(this.preDelay);
    this.preDelay.connect(this.lowCut);
    this.lowCut.connect(this.highCut);
    this.highCut.connect(this.bassShelf);
    this.bassShelf.connect(this.convolver);
    this.convolver.connect(this.dampingFilter);
    this.dampingFilter.connect(this.wetGain);
    this.wetGain.connect(this.splitter);

    this.splitter.connect(this.ll, 0); this.ll.connect(this.merger, 0, 0);
    this.splitter.connect(this.lr, 0); this.lr.connect(this.merger, 0, 1);
    this.splitter.connect(this.rl, 1); this.rl.connect(this.merger, 0, 0);
    this.splitter.connect(this.rr, 1); this.rr.connect(this.merger, 0, 1);
    this.merger.connect(nativeOutput);

    nativeInput.connect(this.inputAnalyser);
    this.merger.connect(this.wetAnalyser);
    nativeOutput.connect(this.outputAnalyser);

    this.applyRealtimeParams(true);
    this.rebuildImpulse();
    ProReverbNode.instances.add(this);
    ProReverbNode.lastActiveInstance = this;
  }

  setParams(next: Partial<ReverbParams>) {
    if (this.disposedInternal) return;
    const previous = this.params;
    this.params = { ...this.params, ...next };
    this.applyRealtimeParams(false);
    const structural = previous.size !== this.params.size || previous.decay !== this.params.decay || previous.diff !== this.params.diff || previous.mod !== this.params.mod || previous.speed !== this.params.speed || previous.er !== this.params.er;
    if (structural) this.scheduleImpulseRebuild();
  }

  private applyRealtimeParams(immediate: boolean) {
    const p = this.params;
    const now = this.rawCtx.currentTime;
    const set = (param: AudioParam, value: number, tc = 0.012) => {
      param.cancelScheduledValues(now);
      if (immediate) param.setValueAtTime(value, now); else param.setTargetAtTime(value, now, tc);
    };

    set(this.dryGain.gain, clamp((p.dry ?? 100) / 100, 0, 1));
    set(this.wetGain.gain, clamp((p.wet ?? 50) / 100, 0, 1));
    set(this.preDelay.delayTime, clamp((p.predelay ?? 20) / 1000, 0, 0.25));
    set(this.lowCut.frequency, clamp(p.lcut ?? 120, 20, 2000));
    set(this.highCut.frequency, clamp(p.hcut ?? 12000, 1000, 20000));
    const bass = clamp(p.bass ?? 1, 0.5, 2);
    set(this.bassShelf.frequency, clamp(p.cross ?? 500, 100, 2000));
    set(this.bassShelf.gain, 6 * Math.log2(bass));
    set(this.dampingFilter.frequency, clamp(p.damp ?? 5000, 500, 18000));
    this.lowCut.Q.value = this.highCut.Q.value = this.dampingFilter.Q.value = 0.707;

    const sep = clamp(p.sep ?? 0, -100, 100);
    let width = 1 + sep / 100;
    if ((p.mode ?? 0) === 1) width *= 1.22;
    width = clamp(width, 0, 2.25);
    const same = (1 + width) * 0.5;
    const cross = (1 - width) * 0.5;
    set(this.ll.gain, same); set(this.rr.gain, same);
    set(this.lr.gain, cross); set(this.rl.gain, cross);
  }

  private scheduleImpulseRebuild() {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => { this.rebuildTimer = null; if (!this.disposedInternal) this.rebuildImpulse(); }, 85);
  }

  private rebuildImpulse() {
    const p = this.params;
    const sr = this.rawCtx.sampleRate || 44100;
    const decay = clamp(p.decay ?? 2.5, 0.2, 20);
    const size = clamp(p.size ?? 65, 10, 100) / 100;
    const diffusion = clamp(p.diff ?? 80, 0, 100) / 100;
    const modulation = clamp(p.mod ?? 30, 0, 100) / 100;
    const speed = clamp(p.speed ?? 1.5, 0.1, 10);
    const early = clamp(p.er ?? 40, 0, 100) / 100;
    const duration = clamp(decay * (0.72 + size * 0.42), 0.25, 12);
    const length = Math.max(256, Math.floor(sr * duration));
    const impulse = this.rawCtx.createBuffer(2, length, sr);
    const left = impulse.getChannelData(0), right = impulse.getChannelData(1);

    let stateL = 0x12345678, stateR = 0x6d2b79f5;
    const rand = (rightCh: boolean) => {
      let x = rightCh ? stateR : stateL;
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      if (rightCh) stateR = x >>> 0; else stateL = x >>> 0;
      return ((x >>> 0) / 0xffffffff) * 2 - 1;
    };

    const density = 0.18 + diffusion * 0.82;
    const buildSeconds = 0.004 + (1 - size) * 0.035;
    const decorrelation = 0.62 + size * 0.26;
    const modDepth = modulation * 0.1;
    for (let i = 0; i < length; i++) {
      const t = i / sr;
      const envelope = Math.pow(10, (-3 * t) / decay);
      const build = Math.min(1, t / buildSeconds);
      const flutterL = 1 + modDepth * Math.sin(2 * Math.PI * speed * t);
      const flutterR = 1 + modDepth * Math.sin(2 * Math.PI * speed * 1.013 * t + 1.3);
      let nL = Math.abs(rand(false)) < density ? rand(false) : 0;
      let nR = Math.abs(rand(true)) < density ? rand(true) : 0;
      const common = (nL + nR) * 0.5;
      nL = common * (1 - decorrelation) + nL * decorrelation;
      nR = common * (1 - decorrelation) + nR * decorrelation;
      left[i] = nL * envelope * build * flutterL;
      right[i] = nR * envelope * build * flutterR;
    }

    const earlyMs = [5.3, 8.9, 13.7, 21.1, 34.7, 55.3, 79.1];
    earlyMs.forEach((ms, idx) => {
      const posL = Math.min(length - 1, Math.round((ms * (0.62 + size * 0.9) / 1000) * sr));
      const posR = Math.min(length - 1, posL + Math.round((1.2 + idx * 0.73) / 1000 * sr));
      const amp = early * (0.72 / Math.pow(idx + 1, 0.72));
      const polarity = idx % 2 === 0 ? 1 : -1;
      left[posL] += amp * polarity;
      right[posR] += amp * (idx % 3 === 0 ? -0.82 : 0.78) * polarity;
    });
    this.convolver.buffer = impulse;
  }

  private readRms(analyser: AnalyserNode, data: Float32Array) {
    analyser.getFloatTimeDomainData(data);
    let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  }

  getTelemetry(): ReverbTelemetry {
    const inputRms = this.readRms(this.inputAnalyser, this.inputMeterData);
    const reverbRms = this.readRms(this.wetAnalyser, this.wetMeterData);
    const outputRms = this.readRms(this.outputAnalyser, this.outputMeterData);
    return { inputRms, reverbRms, feedbackRms: reverbRms * clamp((this.params.size ?? 65) / 100, 0, 1), outputRms, isProcessing: inputRms > 0.0001 || reverbRms > 0.0001 || outputRms > 0.0001 };
  }

  dispose(): this {
    if (this.disposedInternal) return this;
    this.disposedInternal = true;
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    ProReverbNode.instances.delete(this);
    if (ProReverbNode.lastActiveInstance === this) ProReverbNode.lastActiveInstance = ProReverbNode.instances.values().next().value || null;
    [this.dryGain, this.wetGain, this.preDelay, this.lowCut, this.highCut, this.bassShelf, this.dampingFilter, this.convolver, this.splitter, this.merger, this.ll, this.lr, this.rl, this.rr, this.inputAnalyser, this.wetAnalyser, this.outputAnalyser].forEach(n => { try { n.disconnect(); } catch {} });
    super.dispose();
    return this;
  }
}
