import * as Tone from 'tone';

export interface DeEsserParams {
  lowFreq?: number;
  highFreq?: number;
  threshold?: number;
  detection?: number;
  amountDb?: number;
  /** Legacy project compatibility from the original compressor-style UI. */
  ratio?: number;
  attack?: number;
  release?: number;
  listen?: number;
  mode?: number;
}

export interface DeEsserTelemetry {
  reductionDb: number;
  detectorDb: number;
  rawSibilanceDb: number;
  broadbandDb: number;
  prominenceDb: number;
  triggerExcessDb: number;
  backend: 'loading' | 'worklet' | 'native-fallback';
}

type DisserWorkletContext = BaseAudioContext & {
  audioWorklet?: AudioWorklet;
  __digidawDisserWorkletLoad?: Promise<void>;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const dbToGain = (db: number) => Math.pow(10, db / 20);
const gainToDb = (gain: number) => 20 * Math.log10(Math.max(1e-9, gain));

export class DeEsserNode extends Tone.ToneAudioNode<any> {
  readonly name = 'DeEsserNode';
  public static lastActiveInstance: DeEsserNode | null = null;
  public static instances = new Set<DeEsserNode>();

  public readonly input: Tone.Gain;
  public readonly output: Tone.Gain;
  public readonly inputNode: Tone.Gain;
  public readonly outputNode: Tone.Gain;

  private raw: BaseAudioContext;
  private startupDryGain: Tone.Gain | null;
  private processedGain: Tone.Gain;
  private workletNode: AudioWorkletNode | null = null;
  private activationTimer: ReturnType<typeof setTimeout> | null = null;
  private backend: DeEsserTelemetry['backend'] = 'loading';

  private reductionDb = 0;
  private detectorDb = -120;
  private rawSibilanceDb = -120;
  private broadbandDb = -120;
  private prominenceDb = -120;
  private triggerExcessDb = 0;
  private disposedInternal = false;
  private params: DeEsserParams = {};

  // Native compatibility path. It deliberately mirrors the routing principle of
  // the worklet: ONE main audio path plus a detector-only sidechain. There is no
  // low + compressed-S + high reconstruction anymore.
  private fallbackNodes: AudioNode[] = [];
  private fallbackDetectorFilters: BiquadFilterNode[] = [];
  private fallbackShelf: BiquadFilterNode | null = null;
  private fallbackWideGain: GainNode | null = null;
  private fallbackMainRouteGain: GainNode | null = null;
  private fallbackListenRouteGain: GainNode | null = null;
  private fallbackSibAnalyser: AnalyserNode | null = null;
  private fallbackBroadAnalyser: AnalyserNode | null = null;
  private fallbackSibData: Float32Array | null = null;
  private fallbackBroadData: Float32Array | null = null;
  private fallbackTimer: ReturnType<typeof setInterval> | null = null;
  private fallbackSibEnvelope = 0;
  private fallbackBroadEnvelope = 0;

  constructor(params: DeEsserParams = {}) {
    super();
    this.raw = Tone.getContext().rawContext;

    this.inputNode = new Tone.Gain({ context: this.context });
    this.outputNode = new Tone.Gain({ context: this.context });
    this.input = this.inputNode;
    this.output = this.outputNode;

    // Only while the async backend initializes:
    // input -> startupDryGain -> output.
    // Once the backend is ready this node is physically disconnected and
    // disposed, so a later automation/HMR issue cannot leak clean audio in
    // parallel with the processed signal.
    this.startupDryGain = new Tone.Gain({ context: this.context, gain: 1 });
    this.processedGain = new Tone.Gain({ context: this.context, gain: 0 });
    this.inputNode.connect(this.startupDryGain);
    this.startupDryGain.connect(this.outputNode);
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

  /**
   * Cache the addModule promise on the AudioContext itself, not only on this TS
   * module. The context often survives Vite HMR while module statics do not.
   */
  private static ensureWorklet(context: BaseAudioContext) {
    const workletContext = context as DisserWorkletContext;
    const audioWorklet = workletContext.audioWorklet;
    if (!audioWorklet || typeof AudioWorkletNode === 'undefined') {
      return Promise.reject(new Error('AudioWorklet is unavailable'));
    }

    if (workletContext.__digidawDisserWorkletLoad) {
      return workletContext.__digidawDisserWorkletLoad;
    }

    const load = audioWorklet.addModule(DeEsserNode.getWorkletUrl()).catch((error) => {
      delete workletContext.__digidawDisserWorkletLoad;
      throw error;
    });
    workletContext.__digidawDisserWorkletLoad = load;
    return load;
  }

  private async initializeProcessor() {
    let moduleLoadError: unknown = null;

    try {
      await DeEsserNode.ensureWorklet(this.raw);
    } catch (error) {
      moduleLoadError = error;
    }

    if (this.disposedInternal) return;

    // HMR can leave an already-registered processor in a still-live AudioContext.
    // In that case addModule may reject on duplicate registration even though the
    // processor itself is perfectly usable. Always try constructing the node
    // before deciding that we need the compatibility backend.
    try {
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
          detection: p.detection,
          amountDb: p.amountDb,
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
        this.rawSibilanceDb = Math.min(6, Number(event.data.rawSibilanceDb) || -120);
        this.broadbandDb = Math.min(6, Number(event.data.broadbandDb) || -120);
        this.prominenceDb = Math.min(24, Number(event.data.prominenceDb) || -120);
        this.triggerExcessDb = Math.max(0, Number(event.data.triggerExcessDb) || 0);
      };
      node.onprocessorerror = () => {
        console.error('Disser AudioWorklet processor error. Recreate the audio context before continuing.');
      };

      this.workletNode = node;
      this.backend = 'worklet';
      Tone.connect(this.inputNode, node);
      Tone.connect(node, this.processedGain);
      this.applyWorkletParams(true);
      this.activateProcessedRoute();
      return;
    } catch (nodeError) {
      if (moduleLoadError) {
        console.warn('Disser AudioWorklet module could not be activated; using safe serial fallback.', moduleLoadError, nodeError);
      } else {
        console.warn('Disser AudioWorklet node could not be created; using safe serial fallback.', nodeError);
      }
    }

    if (this.disposedInternal) return;
    this.buildNativeFallback();
    this.backend = 'native-fallback';
    this.applyNativeFallbackParams(true);
    this.startNativeFallbackDetector();
    this.activateProcessedRoute();
  }

  /**
   * Short startup crossfade, then physically remove the clean branch from the
   * graph. After this method finishes the only route to output is processedGain.
   */
  private activateProcessedRoute() {
    const dry = this.startupDryGain;
    const now = this.raw.currentTime;

    try {
      this.processedGain.gain.cancelScheduledValues(now);
      this.processedGain.gain.setValueAtTime(this.processedGain.gain.value, now);
      this.processedGain.gain.linearRampToValueAtTime(1, now + 0.018);

      if (dry) {
        dry.gain.cancelScheduledValues(now);
        dry.gain.setValueAtTime(dry.gain.value, now);
        dry.gain.linearRampToValueAtTime(0, now + 0.018);
      }
    } catch {
      this.processedGain.gain.value = 1;
      if (dry) dry.gain.value = 0;
    }

    if (this.activationTimer) clearTimeout(this.activationTimer);
    this.activationTimer = setTimeout(() => {
      this.activationTimer = null;
      if (this.disposedInternal) return;
      this.processedGain.gain.value = 1;
      this.disconnectStartupDryPath();
    }, 36);
  }

  private disconnectStartupDryPath() {
    const dry = this.startupDryGain;
    if (!dry) return;

    try { dry.gain.value = 0; } catch {}
    // The critical operation is disconnecting dry's OUTPUT from outputNode.
    // Even if inputNode -> dry survives, it can no longer reach the plugin output.
    try { dry.disconnect(); } catch {}
    try { this.inputNode.disconnect(dry); } catch {}
    try { dry.dispose(); } catch {}
    this.startupDryGain = null;
  }

  private normalizedParams() {
    const lowFreq = clamp(this.params.lowFreq ?? 4500, 2500, 10000);
    const highFreq = clamp(
      Math.max(lowFreq + 500, this.params.highFreq ?? 9500),
      lowFreq + 500,
      16000,
    );

    const legacyRatio = clamp(this.params.ratio ?? 6, 1, 20);
    const legacyAmount = clamp((legacyRatio - 1) * 1.4, 0, 18);

    return {
      lowFreq,
      highFreq,
      threshold: clamp(this.params.threshold ?? -28, -60, -4),
      detection: clamp(this.params.detection ?? 65, 0, 100),
      amountDb: clamp(this.params.amountDb ?? legacyAmount, 0, 18),
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
    this.setWorkletParam('detection', p.detection, immediate);
    this.setWorkletParam('amountDb', p.amountDb, immediate);
    this.setWorkletParam('attackMs', p.attack, immediate);
    this.setWorkletParam('releaseMs', p.release, immediate);
    this.setWorkletParam('listen', p.listen, immediate);
    this.setWorkletParam('mode', p.mode, immediate);
  }

  private nativeInputNode() {
    return (((this.inputNode as any).output ?? (this.inputNode as any).input) as AudioNode);
  }

  private nativeProcessedInput() {
    return (((this.processedGain as any).input ?? (this.processedGain as any).output) as AudioNode);
  }

  /**
   * Safe compatibility backend:
   *
   * main audio: input -> dynamic subtractive high shelf -> wide gain -> route -> output
   * detector:   input -> HP -> HP -> LP -> LP -> analyser (sidechain only)
   * listen:     detector band -> listen route -> output
   *
   * Normal audio never sums low/mid/high frequency branches.
   */
  private buildNativeFallback() {
    const raw = this.raw;
    const nativeInput = this.nativeInputNode();
    const nativeProcessed = this.nativeProcessedInput();

    const makeFilter = (type: BiquadFilterType) => {
      const filter = raw.createBiquadFilter();
      filter.type = type;
      filter.Q.value = Math.SQRT1_2;
      this.fallbackNodes.push(filter);
      return filter;
    };

    const hp1 = makeFilter('highpass');
    const hp2 = makeFilter('highpass');
    const lp1 = makeFilter('lowpass');
    const lp2 = makeFilter('lowpass');
    this.fallbackDetectorFilters = [hp1, hp2, lp1, lp2];

    const shelf = raw.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.gain.value = 0;
    const wideGain = raw.createGain();
    const mainRoute = raw.createGain();
    const listenRoute = raw.createGain();
    const sibAnalyser = raw.createAnalyser();
    const broadAnalyser = raw.createAnalyser();
    sibAnalyser.fftSize = 512;
    broadAnalyser.fftSize = 512;
    sibAnalyser.smoothingTimeConstant = 0;
    broadAnalyser.smoothingTimeConstant = 0;

    this.fallbackShelf = shelf;
    this.fallbackWideGain = wideGain;
    this.fallbackMainRouteGain = mainRoute;
    this.fallbackListenRouteGain = listenRoute;
    this.fallbackSibAnalyser = sibAnalyser;
    this.fallbackBroadAnalyser = broadAnalyser;
    this.fallbackSibData = new Float32Array(sibAnalyser.fftSize);
    this.fallbackBroadData = new Float32Array(broadAnalyser.fftSize);
    this.fallbackNodes.push(shelf, wideGain, mainRoute, listenRoute, sibAnalyser, broadAnalyser);

    // ONE normal audio path.
    nativeInput.connect(shelf);
    shelf.connect(wideGain);
    wideGain.connect(mainRoute);
    mainRoute.connect(nativeProcessed);

    // Detector-only sidechain.
    nativeInput.connect(hp1);
    hp1.connect(hp2);
    hp2.connect(lp1);
    lp1.connect(lp2);
    lp2.connect(sibAnalyser);
    lp2.connect(listenRoute);
    listenRoute.connect(nativeProcessed);

    // Broadband envelope reference; never routed to audio output.
    nativeInput.connect(broadAnalyser);
  }

  private applyNativeFallbackParams(_immediate: boolean) {
    if (!this.fallbackShelf || this.fallbackDetectorFilters.length < 4) return;
    const p = this.normalizedParams();
    const [hp1, hp2, lp1, lp2] = this.fallbackDetectorFilters;
    [hp1, hp2].forEach((filter) => { filter.frequency.value = p.lowFreq; });
    [lp1, lp2].forEach((filter) => { filter.frequency.value = p.highFreq; });

    this.fallbackShelf.frequency.value = Math.sqrt(p.lowFreq * p.highFreq);

    const now = this.raw.currentTime;
    const listen = p.listen === 1;
    if (this.fallbackMainRouteGain) {
      this.fallbackMainRouteGain.gain.cancelScheduledValues(now);
      this.fallbackMainRouteGain.gain.setTargetAtTime(listen ? 0 : 1, now, 0.006);
    }
    if (this.fallbackListenRouteGain) {
      this.fallbackListenRouteGain.gain.cancelScheduledValues(now);
      this.fallbackListenRouteGain.gain.setTargetAtTime(listen ? 1 : 0, now, 0.006);
    }
  }

  private startNativeFallbackDetector() {
    if (this.fallbackTimer) clearInterval(this.fallbackTimer);
    const intervalSeconds = 0.016;

    this.fallbackTimer = setInterval(() => {
      if (
        this.disposedInternal ||
        !this.fallbackSibAnalyser ||
        !this.fallbackBroadAnalyser ||
        !this.fallbackSibData ||
        !this.fallbackBroadData ||
        !this.fallbackShelf ||
        !this.fallbackWideGain
      ) return;

      this.fallbackSibAnalyser.getFloatTimeDomainData(this.fallbackSibData);
      this.fallbackBroadAnalyser.getFloatTimeDomainData(this.fallbackBroadData);

      let sibPeak = 1e-9;
      let broadPeak = 1e-9;
      for (let i = 0; i < this.fallbackSibData.length; i++) {
        sibPeak = Math.max(sibPeak, Math.abs(this.fallbackSibData[i]));
      }
      for (let i = 0; i < this.fallbackBroadData.length; i++) {
        broadPeak = Math.max(broadPeak, Math.abs(this.fallbackBroadData[i]));
      }

      const p = this.normalizedParams();
      const sibTau = sibPeak > this.fallbackSibEnvelope ? p.attack / 1000 : p.release / 1000;
      const broadTau = broadPeak > this.fallbackBroadEnvelope ? 0.0015 : 0.075;
      const sibAlpha = 1 - Math.exp(-intervalSeconds / Math.max(0.0005, sibTau));
      const broadAlpha = 1 - Math.exp(-intervalSeconds / Math.max(0.0005, broadTau));
      this.fallbackSibEnvelope += (sibPeak - this.fallbackSibEnvelope) * sibAlpha;
      this.fallbackBroadEnvelope += (broadPeak - this.fallbackBroadEnvelope) * broadAlpha;

      this.rawSibilanceDb = gainToDb(this.fallbackSibEnvelope);
      this.broadbandDb = gainToDb(this.fallbackBroadEnvelope);
      this.prominenceDb = this.rawSibilanceDb - this.broadbandDb;

      const detectionNorm = p.detection / 100;
      const prominenceThresholdDb = -8 - detectionNorm * 22;
      const absoluteGateDb = p.threshold - (4 + detectionNorm * 18);
      const levelExcess = this.rawSibilanceDb - absoluteGateDb;
      const prominenceExcess = this.prominenceDb - prominenceThresholdDb;
      this.triggerExcessDb = Math.max(0, Math.min(levelExcess, prominenceExcess + 6));

      const targetReductionDb = this.triggerExcessDb > 0
        ? p.amountDb * (1 - Math.exp(-this.triggerExcessDb / 5))
        : 0;
      const reductionTau = targetReductionDb > this.reductionDb
        ? Math.max(0.0005, (p.attack / 1000) * 0.55)
        : Math.max(0.012, (p.release / 1000) * 0.8);
      const reductionAlpha = 1 - Math.exp(-intervalSeconds / reductionTau);
      this.reductionDb += (targetReductionDb - this.reductionDb) * reductionAlpha;
      this.detectorDb = absoluteGateDb + this.triggerExcessDb;

      const now = this.raw.currentTime;
      if (p.mode === 1) {
        // Wide: sidechain triggers broadband attenuation.
        this.fallbackShelf.gain.setTargetAtTime(0, now, 0.006);
        this.fallbackWideGain.gain.setTargetAtTime(dbToGain(-this.reductionDb), now, 0.006);
      } else {
        // Split: sidechain triggers a subtractive high shelf on the ONE main path.
        this.fallbackShelf.gain.setTargetAtTime(-this.reductionDb, now, 0.006);
        this.fallbackWideGain.gain.setTargetAtTime(1, now, 0.006);
      }
    }, Math.round(intervalSeconds * 1000));
  }

  getReductionDb() {
    return this.reductionDb;
  }

  getTelemetry(): DeEsserTelemetry {
    return {
      reductionDb: this.reductionDb,
      detectorDb: this.detectorDb,
      rawSibilanceDb: this.rawSibilanceDb,
      broadbandDb: this.broadbandDb,
      prominenceDb: this.prominenceDb,
      triggerExcessDb: this.triggerExcessDb,
      backend: this.backend,
    };
  }

  dispose(): this {
    if (this.disposedInternal) return this;
    this.disposedInternal = true;

    if (this.activationTimer) {
      clearTimeout(this.activationTimer);
      this.activationTimer = null;
    }
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
      this.fallbackTimer = null;
    }

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
    this.fallbackDetectorFilters = [];
    this.fallbackShelf = null;
    this.fallbackWideGain = null;
    this.fallbackMainRouteGain = null;
    this.fallbackListenRouteGain = null;
    this.fallbackSibAnalyser = null;
    this.fallbackBroadAnalyser = null;
    this.fallbackSibData = null;
    this.fallbackBroadData = null;

    this.disconnectStartupDryPath();
    try { this.processedGain.dispose(); } catch {}

    super.dispose();
    return this;
  }
}
