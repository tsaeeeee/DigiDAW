import * as Tone from 'tone';

export interface StereoDelayParams {
  time?: number;
  syncMode?: number;
  syncDivIndex?: number;
  feedback?: number;
  wetMix?: number;
  outGain?: number;
  mod?: number;
  tone?: number;
  lowCut?: number;
  lrOffset?: number;
  drive?: number;
  pingPong?: number;
}

const BEAT_FACTORS = [0.125, 0.25, 0.5, 1, 2, 4];
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export class StereoDelayNode extends Tone.ToneAudioNode<any> {
  readonly name = 'StereoDelayNode';
  public readonly input: Tone.Gain;
  public readonly output: Tone.Gain;
  public readonly inputNode: Tone.Gain;
  public readonly outputNode: Tone.Gain;

  private raw: BaseAudioContext;
  private dryGain: GainNode;
  private wetInput: GainNode;
  private lowCut: BiquadFilterNode;
  private tone: BiquadFilterNode;
  private drive: WaveShaperNode;
  private splitter: ChannelSplitterNode;
  private merger: ChannelMergerNode;
  private delayL: DelayNode;
  private delayR: DelayNode;
  private feedbackLL: GainNode;
  private feedbackRR: GainNode;
  private feedbackLR: GainNode;
  private feedbackRL: GainNode;
  private wetGain: GainNode;
  private outputGain: GainNode;
  private lfoL: OscillatorNode;
  private lfoR: OscillatorNode;
  private lfoDepthL: GainNode;
  private lfoDepthR: GainNode;
  private params: StereoDelayParams = {};
  private disposedInternal = false;

  constructor(params: StereoDelayParams = {}) {
    super();
    this.raw = Tone.getContext().rawContext;
    this.inputNode = new Tone.Gain({ context: this.context });
    this.outputNode = new Tone.Gain({ context: this.context });
    this.input = this.inputNode;
    this.output = this.outputNode;

    const raw = this.raw;
    this.dryGain = raw.createGain();
    this.wetInput = raw.createGain();
    this.lowCut = raw.createBiquadFilter(); this.lowCut.type = 'highpass';
    this.tone = raw.createBiquadFilter(); this.tone.type = 'lowpass';
    this.drive = raw.createWaveShaper(); this.drive.oversample = '4x';
    this.splitter = raw.createChannelSplitter(2);
    this.merger = raw.createChannelMerger(2);
    this.delayL = raw.createDelay(2.2);
    this.delayR = raw.createDelay(2.2);
    this.feedbackLL = raw.createGain();
    this.feedbackRR = raw.createGain();
    this.feedbackLR = raw.createGain();
    this.feedbackRL = raw.createGain();
    this.wetGain = raw.createGain();
    this.outputGain = raw.createGain();
    this.lfoL = raw.createOscillator();
    this.lfoR = raw.createOscillator();
    this.lfoDepthL = raw.createGain();
    this.lfoDepthR = raw.createGain();

    const nativeInput = this.inputNode.input as AudioNode;
    const nativeOutput = this.outputNode.input as AudioNode;

    nativeInput.connect(this.dryGain);
    this.dryGain.connect(this.outputGain);
    nativeInput.connect(this.wetInput);
    this.wetInput.connect(this.lowCut);
    this.lowCut.connect(this.tone);
    this.tone.connect(this.drive);
    this.drive.connect(this.splitter);
    this.splitter.connect(this.delayL, 0);
    this.splitter.connect(this.delayR, 1);
    this.delayL.connect(this.merger, 0, 0);
    this.delayR.connect(this.merger, 0, 1);
    this.merger.connect(this.wetGain);
    this.wetGain.connect(this.outputGain);
    this.outputGain.connect(nativeOutput);

    this.delayL.connect(this.feedbackLL); this.feedbackLL.connect(this.delayL);
    this.delayR.connect(this.feedbackRR); this.feedbackRR.connect(this.delayR);
    this.delayL.connect(this.feedbackLR); this.feedbackLR.connect(this.delayR);
    this.delayR.connect(this.feedbackRL); this.feedbackRL.connect(this.delayL);

    this.lfoL.connect(this.lfoDepthL); this.lfoDepthL.connect(this.delayL.delayTime);
    this.lfoR.connect(this.lfoDepthR); this.lfoDepthR.connect(this.delayR.delayTime);
    this.lfoL.frequency.value = 0.45;
    this.lfoR.frequency.value = 0.53;
    this.lfoL.start(); this.lfoR.start();
    this.update(params, true);
  }

  private delaySeconds(p: StereoDelayParams) {
    if ((p.syncMode ?? 0) === 1) {
      const bpm = clamp(Number(Tone.Transport.bpm.value) || 120, 20, 400);
      const idx = clamp(Math.round(p.syncDivIndex ?? 2), 0, BEAT_FACTORS.length - 1);
      return clamp((60 / bpm) * BEAT_FACTORS[idx], 0.01, 2.0);
    }
    return clamp((p.time ?? 240) / 1000, 0.01, 2.0);
  }

  private makeCurve(amount: number) {
    const n = 2048;
    const curve = new Float32Array(n);
    const k = 1 + amount * 10;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  }

  update(next: StereoDelayParams, immediate = false) {
    if (this.disposedInternal) return;
    this.params = { ...this.params, ...next };
    const p = this.params;
    const now = this.raw.currentTime;
    const set = (param: AudioParam, value: number, tc = 0.015) => {
      param.cancelScheduledValues(now);
      if (immediate) param.setValueAtTime(value, now);
      else param.setTargetAtTime(value, now, tc);
    };

    const mix = clamp((p.wetMix ?? 50) / 100, 0, 1);
    set(this.dryGain.gain, Math.cos(mix * Math.PI * 0.5));
    set(this.wetGain.gain, Math.sin(mix * Math.PI * 0.5));
    set(this.outputGain.gain, Math.pow(10, clamp(p.outGain ?? 0, -24, 12) / 20));
    set(this.lowCut.frequency, (p.lowCut ?? 0) === 1 ? 180 : 20);
    set(this.tone.frequency, clamp(900 + (clamp(p.tone ?? 5, 1, 10) / 10) * 17000, 900, 18000));
    this.drive.curve = this.makeCurve((p.drive ?? 0) === 1 ? 0.42 : 0.01);

    const base = this.delaySeconds(p);
    const offset = clamp(p.lrOffset ?? 0, -50, 50) / 50 * 0.012;
    set(this.delayL.delayTime, clamp(base - offset, 0.005, 2.05));
    set(this.delayR.delayTime, clamp(base + offset, 0.005, 2.05));

    const mod = clamp((p.mod ?? 50) / 100, 0, 1);
    const depth = 0.00015 + mod * 0.0045;
    set(this.lfoDepthL.gain, depth);
    set(this.lfoDepthR.gain, -depth);
    this.lfoL.frequency.setTargetAtTime(0.18 + mod * 1.35, now, 0.03);
    this.lfoR.frequency.setTargetAtTime(0.21 + mod * 1.29, now, 0.03);

    const fb = clamp((p.feedback ?? 40) / 100, 0, 0.94);
    const ping = (p.pingPong ?? 0) === 1;
    set(this.feedbackLL.gain, ping ? 0 : fb);
    set(this.feedbackRR.gain, ping ? 0 : fb);
    set(this.feedbackLR.gain, ping ? fb : 0);
    set(this.feedbackRL.gain, ping ? fb : 0);
  }

  dispose(): this {
    if (this.disposedInternal) return this;
    this.disposedInternal = true;
    try { this.lfoL.stop(); } catch {}
    try { this.lfoR.stop(); } catch {}
    const nodes: AudioNode[] = [this.dryGain, this.wetInput, this.lowCut, this.tone, this.drive, this.splitter, this.merger, this.delayL, this.delayR, this.feedbackLL, this.feedbackRR, this.feedbackLR, this.feedbackRL, this.wetGain, this.outputGain, this.lfoL, this.lfoR, this.lfoDepthL, this.lfoDepthR];
    nodes.forEach(n => { try { n.disconnect(); } catch {} });
    super.dispose();
    return this;
  }
}
