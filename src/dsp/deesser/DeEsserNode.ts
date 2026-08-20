import * as Tone from 'tone';

export interface DeEsserParams {
  lowFreq?: number;
  highFreq?: number;
  threshold?: number;
  ratio?: number;
  attack?: number;
  release?: number;
  listen?: number;
  mode?: number;
}

export interface DeEsserTelemetry {
  reductionDb: number;
  detectorDb: number;
  backend: 'loading' | 'worklet' | 'native-fallback';
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class DeEsserNode extends Tone.ToneAudioNode<any> {
  readonly name = 'DeEsserNode';
  public static lastActiveInstance: DeEsserNode | null = null;
  public static instances = new Set<DeEsserNode>();
  private static workletLoads = new WeakMap<BaseAudioContext, Promise<void>>();

  public readonly input: Tone.Gain;
  public readonly output: Tone.Gain;
  public readonly inputNode: Tone.Gain;
  public readonly outputNode: Tone.Gain;

  private raw: BaseAudioContext;
  private dryGain: Tone.Gain;
  private processedGain: Tone.Gain;
  private workletNode: AudioWorkletNode | null = null;
  private backend: DeEsserTelemetry['backend'] = 'loading';
  private reductionDb = 0;
  private detectorDb = -120;
  private disposedInternal = false;
  private params: DeEsserParams = {};

  // Native fallback nodes. The normal Chromium path uses the AudioWorklet above.
  private fallbackFilters: BiquadFilterNode[] = [];
  private fallbackCompressor: DynamicsCompressorNode | null = null;
  private fallbackLowGain: GainNode | null = null;
  private fallbackSibGain: GainNode | null = null;
  private fallbackHighGain: GainNode | null = null;
  private fallbackNodes: AudioNode[] = [];

  constructor(params: DeEsserParams = {}) {
    super();
    this.raw = Tone.getContext().rawContext;

    this.inputNode = new Tone.Gain({ context: this.context });
    this.outputNode = new Tone.Gain({ context: this.context });
    this.input = this.inputNode;
    this.output = this.outputNode;

    // Worklet module loading is asynchronous. Pass clean audio until the DSP is
    // ready, then crossfade once into the latency-stable processed path.
    this.dryGain = new Tone.Gain({ context: this.context, gain: 1 });
    this.processedGain = new Tone.Gain({ context: this.context, gain: 0 });
    this.inputNode.connect(this.dryGain);
    this.dryGain.connect(this.outputNode);
    this.processedGain.connect(this.outputNode);

    this.update(params, true);
    void this.initializeProcessor();

    DeEsserNode.instances.add(this);
    DeEsserNode.lastActiveInstance = this;
  }

  private static getWorkletUrl() {
    const base = (((import.meta as any).env?.BASE_URL as string | undefined) || '/');
    const normalized = base.endsWith('/') ? base : `${base}/`;
    return `${normalized}dsp/disser-processor.js`;
  }

  private static ensureWorklet(context: BaseAudioContext) {
    const audioWorklet = (context as BaseAudioContext & { audioWorklet?: AudioWorklet }).audioWorklet;
    if (!audioWorklet || typeof AudioWorkletNode === 'undefined') {
      return Promise.reject(new Error('AudioWorklet is unavailable'));
    }

    const existing = DeEsserNode.workletLoads.get(context);
    if (existing) return existing;

    const load = audioWorklet.addModule(DeEsserNode.getWorkletUrl()).catch((error) => {
      DeEsserNode.workletLoads.delete(context);
      throw error;
    });
    DeEsserNode.workletLoads.set(context, load);
    return load;
  }

  private async initializeProcessor() {
    try {
      await DeEsserNode.ensureWorklet(this.raw);
      if (this.disposedInternal) return;

      const p = this.normalizedParams();
      const node = new AudioWorkletNode(this.raw, 'disser-dynamic-sibilance', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        parameterData: {
          lowFreq: p.lowFreq,
          highFreq: p.highFreq,
          threshold: p.threshold,
          ratio: p.ratio,
          attackMs: p.attack,
          releaseMs: p.release,
          listen: p.listen,
          mode: p.mode,
        },
      });

      node.port.onmessage = (event: MessageEvent) => {
        if (event.data?.type !== 'telemetry') return;
        this.reductionDb = Math.max(0, Number(event.data.reductionDb) || 0);
        this.detectorDb = Math.min(6, Number(event.data.detectorDb) || -120);
      };

      this.workletNode = node;
      this.backend = 'worklet';
      Tone.connect(this.inputNode, node);
      Tone.connect(node, this.processedGain);
      this.applyWorkletParams(true);
      this.fadeToProcessed();
    } catch (error) {
      if (this.disposedInternal) return;
      console.warn('Disser AudioWorklet unavailable; using native fallback.', error);
      this.buildNativeFallback();
      this.backend = 'native-fallback';
      this.applyNativeFallbackParams(true);
      this.fadeToProcessed();
    }
  }

  private fadeToProcessed() {
    try {
      this.dryGain.gain.rampTo(0, 0.035);
      this.processedGain.gain.rampTo(1, 0.035);
    } catch {
      this.dryGain.gain.value = 0;
      this.processedGain.gain.value = 1;
    }
  }

  private normalizedParams() {
    const lowFreq = clamp(this.params.lowFreq ?? 4500, 2500, 10000);
    const highFreq = clamp(
      Math.max(lowFreq + 500, this.params.highFreq ?? 9500),
      lowFreq + 500,
      16000,
    );
    return {
      lowFreq,
      highFreq,
      threshold: clamp(this.params.threshold ?? -28, -60, -4),
      ratio: clamp(this.params.ratio ?? 6, 1, 20),
      attack: clamp(this.params.attack ?? 3, 0.5, 50),
      release: clamp(this.params.release ?? 80, 10, 500),
      listen: (this.params.listen ?? 0) === 1 ? 1 : 0,
      mode: (this.params.mode ?? 0) === 1 ? 1 : 0,
    };
  }

  update(next: DeEsserParams, immediate = false) {
    if (this.disposedInternal) return;
    this.params = { ...this.params, ...next };
    this.applyWorkletParams(immediate);
    this.applyNativeFallbackParams(immediate);
  }

  private setWorkletParam(name: string, value: number, immediate: boolean) {
    if (!this.workletNode) return;
    const parameter = this.workletNode.parameters.get(name);
    if (!parameter) return;
    const now = this.raw.currentTime;
    try { parameter.cancelAndHoldAtTime(now); } catch { parameter.cancelScheduledValues(now); }
    if (immediate) parameter.setValueAtTime(value, now);
    else parameter.setTargetAtTime(value, now, 0.015);
  }

  private applyWorkletParams(immediate: boolean) {
    if (!this.workletNode) return;
    const p = this.normalizedParams();
    this.setWorkletParam('lowFreq', p.lowFreq, immediate);
    this.setWorkletParam('highFreq', p.highFreq, immediate);
    this.setWorkletParam('threshold', p.threshold, immediate);
    this.setWorkletParam('ratio', p.ratio, immediate);
    this.setWorkletParam('attackMs', p.attack, immediate);
    this.setWorkletParam('releaseMs', p.release, immediate);
    this.setWorkletParam('listen', p.listen, immediate);
    this.setWorkletParam('mode', p.mode, immediate);
  }

  /**
   * Fallback uses the same LR4 topology with two cascaded Butterworth biquads at
   * each crossover. The native compressor branch has browser-defined internal
   * latency, so this remains a compatibility fallback rather than the preferred
   * path; supported browsers should use the sample-aligned AudioWorklet.
   */
  private buildNativeFallback() {
    const raw = this.raw;
    const makeFilter = (type: BiquadFilterType) => {
      const filter = raw.createBiquadFilter();
      filter.type = type;
      filter.Q.value = Math.SQRT1_2;
      this.fallbackFilters.push(filter);
      this.fallbackNodes.push(filter);
      return filter;
    };

    const lowLp1 = makeFilter('lowpass');
    const lowLp2 = makeFilter('lowpass');
    const upperHp1 = makeFilter('highpass');
    const upperHp2 = makeFilter('highpass');
    const sibLp1 = makeFilter('lowpass');
    const sibLp2 = makeFilter('lowpass');
    const highHp1 = makeFilter('highpass');
    const highHp2 = makeFilter('highpass');

    const compressor = raw.createDynamicsCompressor();
    const lowGain = raw.createGain();
    const sibGain = raw.createGain();
    const highGain = raw.createGain();
    const lowDelay = raw.createDelay(0.02);
    const highDelay = raw.createDelay(0.02);

    // Chromium's compressor uses lookahead internally. A small matching delay
    // keeps the compatibility branches closer in time than the old topology.
    lowDelay.delayTime.value = 0.006;
    highDelay.delayTime.value = 0.006;

    this.fallbackCompressor = compressor;
    this.fallbackLowGain = lowGain;
    this.fallbackSibGain = sibGain;
    this.fallbackHighGain = highGain;
    this.fallbackNodes.push(compressor, lowGain, sibGain, highGain, lowDelay, highDelay);

    const nativeInput = this.inputNode.input as AudioNode;
    const nativeProcessed = this.processedGain.input as AudioNode;

    nativeInput.connect(lowLp1);
    lowLp1.connect(lowLp2);
    lowLp2.connect(lowDelay);
    lowDelay.connect(lowGain);
    lowGain.connect(nativeProcessed);

    nativeInput.connect(upperHp1);
    upperHp1.connect(upperHp2);

    upperHp2.connect(sibLp1);
    sibLp1.connect(sibLp2);
    sibLp2.connect(compressor);
    compressor.connect(sibGain);
    sibGain.connect(nativeProcessed);

    upperHp2.connect(highHp1);
    highHp1.connect(highHp2);
    highHp2.connect(highDelay);
    highDelay.connect(highGain);
    highGain.connect(nativeProcessed);
  }

  private applyNativeFallbackParams(_immediate: boolean) {
    if (!this.fallbackCompressor || this.fallbackFilters.length < 8) return;
    const p = this.normalizedParams();
    const [lowLp1, lowLp2, upperHp1, upperHp2, sibLp1, sibLp2, highHp1, highHp2] = this.fallbackFilters;

    [lowLp1, lowLp2, upperHp1, upperHp2].forEach((filter) => { filter.frequency.value = p.lowFreq; });
    [sibLp1, sibLp2, highHp1, highHp2].forEach((filter) => { filter.frequency.value = p.highFreq; });

    this.fallbackCompressor.threshold.value = p.threshold;
    this.fallbackCompressor.knee.value = 6;
    this.fallbackCompressor.ratio.value = p.ratio;
    this.fallbackCompressor.attack.value = p.attack / 1000;
    this.fallbackCompressor.release.value = p.release / 1000;

    const listen = p.listen === 1;
    if (this.fallbackLowGain) this.fallbackLowGain.gain.value = listen ? 0 : 1;
    if (this.fallbackHighGain) this.fallbackHighGain.gain.value = listen ? 0 : 1;
    if (this.fallbackSibGain) this.fallbackSibGain.gain.value = 1;
    this.reductionDb = Math.max(0, -(this.fallbackCompressor.reduction || 0));
  }

  getReductionDb() {
    if (this.fallbackCompressor) {
      this.reductionDb = Math.max(0, -(this.fallbackCompressor.reduction || 0));
    }
    return this.reductionDb;
  }

  getTelemetry(): DeEsserTelemetry {
    return {
      reductionDb: this.getReductionDb(),
      detectorDb: this.detectorDb,
      backend: this.backend,
    };
  }

  dispose(): this {
    if (this.disposedInternal) return this;
    this.disposedInternal = true;

    DeEsserNode.instances.delete(this);
    if (DeEsserNode.lastActiveInstance === this) {
      DeEsserNode.lastActiveInstance = DeEsserNode.instances.values().next().value || null;
    }

    if (this.workletNode) {
      try { this.workletNode.port.close(); } catch {}
      try { this.workletNode.disconnect(); } catch {}
      this.workletNode = null;
    }

    this.fallbackNodes.forEach((node) => { try { node.disconnect(); } catch {} });
    this.fallbackNodes = [];
    this.fallbackFilters = [];
    this.fallbackCompressor = null;

    try { this.dryGain.dispose(); } catch {}
    try { this.processedGain.dispose(); } catch {}

    super.dispose();
    return this;
  }
}
