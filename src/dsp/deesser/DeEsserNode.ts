import * as Tone from 'tone';

export interface DeEsserParams {
  lowFreq?: number;
  highFreq?: number;
  threshold?: number;
  ratio?: number;
  attack?: number;
  release?: number;
  listen?: number;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export class DeEsserNode extends Tone.ToneAudioNode<any> {
  readonly name = 'DeEsserNode';
  public static lastActiveInstance: DeEsserNode | null = null;
  public static instances = new Set<DeEsserNode>();

  public readonly input: Tone.Gain;
  public readonly output: Tone.Gain;
  public readonly inputNode: Tone.Gain;
  public readonly outputNode: Tone.Gain;

  private raw: BaseAudioContext;
  private lowBand: BiquadFilterNode;
  private sibHP: BiquadFilterNode;
  private sibLP: BiquadFilterNode;
  private sibComp: DynamicsCompressorNode;
  private highBand: BiquadFilterNode;
  private lowGain: GainNode;
  private sibGain: GainNode;
  private highGain: GainNode;
  private disposedInternal = false;
  private params: DeEsserParams = {};

  constructor(params: DeEsserParams = {}) {
    super();
    this.raw = Tone.getContext().rawContext;
    this.inputNode = new Tone.Gain({ context: this.context });
    this.outputNode = new Tone.Gain({ context: this.context });
    this.input = this.inputNode;
    this.output = this.outputNode;

    const raw = this.raw;
    this.lowBand = raw.createBiquadFilter(); this.lowBand.type = 'lowpass';
    this.sibHP = raw.createBiquadFilter(); this.sibHP.type = 'highpass';
    this.sibLP = raw.createBiquadFilter(); this.sibLP.type = 'lowpass';
    this.sibComp = raw.createDynamicsCompressor();
    this.highBand = raw.createBiquadFilter(); this.highBand.type = 'highpass';
    this.lowGain = raw.createGain(); this.sibGain = raw.createGain(); this.highGain = raw.createGain();

    const nativeInput = this.inputNode.input as AudioNode;
    const nativeOutput = this.outputNode.input as AudioNode;

    nativeInput.connect(this.lowBand); this.lowBand.connect(this.lowGain); this.lowGain.connect(nativeOutput);
    nativeInput.connect(this.sibHP); this.sibHP.connect(this.sibLP); this.sibLP.connect(this.sibComp); this.sibComp.connect(this.sibGain); this.sibGain.connect(nativeOutput);
    nativeInput.connect(this.highBand); this.highBand.connect(this.highGain); this.highGain.connect(nativeOutput);

    this.update(params, true);
    DeEsserNode.instances.add(this);
    DeEsserNode.lastActiveInstance = this;
  }

  update(next: DeEsserParams, immediate = false) {
    if (this.disposedInternal) return;
    this.params = { ...this.params, ...next };
    const p = this.params;
    const now = this.raw.currentTime;
    const set = (param: AudioParam, value: number) => {
      param.cancelScheduledValues(now);
      if (immediate) param.setValueAtTime(value, now); else param.setTargetAtTime(value, now, 0.012);
    };

    const low = clamp(p.lowFreq ?? 4500, 2500, 10000);
    const high = clamp(Math.max(low + 500, p.highFreq ?? 9500), 3500, 16000);
    set(this.lowBand.frequency, low);
    set(this.sibHP.frequency, low);
    set(this.sibLP.frequency, high);
    set(this.highBand.frequency, high);
    [this.lowBand, this.sibHP, this.sibLP, this.highBand].forEach(f => f.Q.value = 0.707);

    this.sibComp.threshold.value = clamp(p.threshold ?? -28, -60, -4);
    this.sibComp.knee.value = 9;
    this.sibComp.ratio.value = clamp(p.ratio ?? 6, 1, 20);
    this.sibComp.attack.value = clamp((p.attack ?? 3) / 1000, 0.0005, 0.1);
    this.sibComp.release.value = clamp((p.release ?? 80) / 1000, 0.01, 0.5);

    const listen = (p.listen ?? 0) === 1;
    set(this.lowGain.gain, listen ? 0 : 1);
    set(this.highGain.gain, listen ? 0 : 1);
    set(this.sibGain.gain, 1);
  }

  getReductionDb() { return Math.max(0, -(this.sibComp.reduction || 0)); }

  dispose(): this {
    if (this.disposedInternal) return this;
    this.disposedInternal = true;
    DeEsserNode.instances.delete(this);
    if (DeEsserNode.lastActiveInstance === this) DeEsserNode.lastActiveInstance = DeEsserNode.instances.values().next().value || null;
    [this.lowBand, this.sibHP, this.sibLP, this.sibComp, this.highBand, this.lowGain, this.sibGain, this.highGain].forEach(n => { try { n.disconnect(); } catch {} });
    super.dispose();
    return this;
  }
}
