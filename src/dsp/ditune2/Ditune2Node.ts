import * as Tone from 'tone';

export interface Ditune2Params {
  referenceHz?: number;
  speed?: number;
  humanize?: number;
  transition?: number;
  color?: number;
  modeHQ?: number;
}

export interface Ditune2Telemetry {
  detectedHz: number;
  targetHz: number;
  confidence: number;
  centsDeviation: number;
  correctionCents: number;
  targetMidi: number;
  isTracking: boolean;
  backend: 'loading' | 'wasm' | 'passthrough';
}

type Ditune2Context = BaseAudioContext & {
  audioWorklet?: AudioWorklet;
  __digidawDitune2Resources?: Promise<{ wasmBytes: Uint8Array; addModuleError: unknown | null }>;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class Ditune2Node extends Tone.ToneAudioNode<any> {
  readonly name = 'Ditune2Node';
  public static lastActiveInstance: Ditune2Node | null = null;
  public static instances = new Set<Ditune2Node>();

  public readonly input: Tone.Gain;
  public readonly output: Tone.Gain;
  public readonly inputNode: Tone.Gain;
  public readonly outputNode: Tone.Gain;

  private raw: BaseAudioContext;
  private startupDry: Tone.Gain | null;
  private processed: Tone.Gain;
  private workletNode: AudioWorkletNode | null = null;
  private passthroughNode: Tone.Gain | null = null;
  private activationTimer: ReturnType<typeof setTimeout> | null = null;
  private disposedInternal = false;
  private params: Ditune2Params = {};
  private backend: Ditune2Telemetry['backend'] = 'loading';
  private telemetry: Omit<Ditune2Telemetry, 'backend'> = {
    detectedHz: 0,
    targetHz: 0,
    confidence: 0,
    centsDeviation: 0,
    correctionCents: 0,
    targetMidi: 0,
    isTracking: false,
  };

  constructor(params: Ditune2Params = {}) {
    super();
    this.raw = Tone.getContext().rawContext;
    this.inputNode = new Tone.Gain({ context: this.context });
    this.outputNode = new Tone.Gain({ context: this.context });
    this.input = this.inputNode;
    this.output = this.outputNode;

    this.startupDry = new Tone.Gain({ context: this.context, gain: 1 });
    this.processed = new Tone.Gain({ context: this.context, gain: 0 });
    this.inputNode.connect(this.startupDry);
    this.startupDry.connect(this.outputNode);
    this.processed.connect(this.outputNode);

    this.update(params, true);
    void this.initialize();
    Ditune2Node.instances.add(this);
    Ditune2Node.lastActiveInstance = this;
  }

  private static baseUrl() {
    const base = (((import.meta as any).env?.BASE_URL as string | undefined) || '/');
    return base.endsWith('/') ? base : `${base}/`;
  }

  private static ensureResources(context: BaseAudioContext) {
    const ctx = context as Ditune2Context;
    if (ctx.__digidawDitune2Resources) return ctx.__digidawDitune2Resources;
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      return Promise.reject(new Error('AudioWorklet is unavailable in this context'));
    }

    const base = Ditune2Node.baseUrl();
    const promise = (async () => {
      const response = await fetch(`${base}dsp/ditune2-core.wasm`);
      if (!response.ok) throw new Error(`Ditune2 WASM fetch failed: HTTP ${response.status}`);
      const wasmBytes = new Uint8Array(await response.arrayBuffer());
      let addModuleError: unknown | null = null;
      try {
        await ctx.audioWorklet!.addModule(`${base}dsp/ditune2-processor.js`);
      } catch (error) {
        addModuleError = error;
      }
      return { wasmBytes, addModuleError };
    })().catch((error) => {
      delete ctx.__digidawDitune2Resources;
      throw error;
    });

    ctx.__digidawDitune2Resources = promise;
    return promise;
  }

  private async initialize() {
    let resources: { wasmBytes: Uint8Array; addModuleError: unknown | null } | null = null;
    try {
      resources = await Ditune2Node.ensureResources(this.raw);
      if (this.disposedInternal) return;
      const p = this.normalizedParams();
      const node = new AudioWorkletNode(this.raw, 'ditune2-wasm-v1', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { wasmBytes: resources.wasmBytes },
        parameterData: {
          referenceHz: p.referenceHz,
          speed: p.speed,
          humanize: p.humanize,
          transition: p.transition,
          color: p.color,
          modeHQ: p.modeHQ,
        },
      });

      node.port.onmessage = (event: MessageEvent) => {
        if (event.data?.type === 'ready') return;
        if (event.data?.type === 'error') {
          console.error('Ditune2 WASM processor initialization error:', event.data.message);
          return;
        }
        if (event.data?.type !== 'telemetry') return;
        this.telemetry = {
          detectedHz: Math.max(0, Number(event.data.detectedHz) || 0),
          targetHz: Math.max(0, Number(event.data.targetHz) || 0),
          confidence: clamp(Number(event.data.confidence) || 0, 0, 1),
          centsDeviation: clamp(Number(event.data.centsDeviation) || 0, -100, 100),
          correctionCents: clamp(Number(event.data.correctionCents) || 0, -200, 200),
          targetMidi: Number(event.data.targetMidi) || 0,
          isTracking: !!event.data.isTracking,
        };
      };
      node.onprocessorerror = () => console.error('Ditune2 WASM AudioWorklet processor error.');

      this.workletNode = node;
      this.backend = 'wasm';
      Tone.connect(this.inputNode, node);
      Tone.connect(node, this.processed);
      this.applyWorkletParams(true);
      this.activateProcessedPath();
      return;
    } catch (error) {
      if (this.disposedInternal) return;
      console.warn(
        'Ditune2 C++/WASM backend unavailable; using transparent passthrough. Existing Ditune is unaffected.',
        error,
        resources?.addModuleError || '',
      );
    }

    this.passthroughNode = new Tone.Gain({ context: this.context, gain: 1 });
    this.inputNode.connect(this.passthroughNode);
    this.passthroughNode.connect(this.processed);
    this.backend = 'passthrough';
    this.activateProcessedPath();
  }

  private activateProcessedPath() {
    const dry = this.startupDry;
    const now = this.raw.currentTime;
    try {
      this.processed.gain.cancelScheduledValues(now);
      this.processed.gain.setValueAtTime(this.processed.gain.value, now);
      this.processed.gain.linearRampToValueAtTime(1, now + 0.018);
      if (dry) {
        dry.gain.cancelScheduledValues(now);
        dry.gain.setValueAtTime(dry.gain.value, now);
        dry.gain.linearRampToValueAtTime(0, now + 0.018);
      }
    } catch {
      this.processed.gain.value = 1;
      if (dry) dry.gain.value = 0;
    }

    if (this.activationTimer) clearTimeout(this.activationTimer);
    this.activationTimer = setTimeout(() => {
      this.activationTimer = null;
      if (!this.disposedInternal) this.disconnectStartupDry();
    }, 40);
  }

  private disconnectStartupDry() {
    const dry = this.startupDry;
    if (!dry) return;
    try { dry.gain.value = 0; } catch {}
    try { dry.disconnect(); } catch {}
    try { this.inputNode.disconnect(dry); } catch {}
    try { dry.dispose(); } catch {}
    this.startupDry = null;
  }

  private normalizedParams() {
    return {
      referenceHz: clamp(this.params.referenceHz ?? 440, 415, 466),
      speed: clamp(this.params.speed ?? 75, 0, 100),
      humanize: clamp(this.params.humanize ?? 20, 0, 100),
      transition: clamp(this.params.transition ?? 30, 0, 100),
      color: clamp(this.params.color ?? 50, 0, 100),
      modeHQ: (this.params.modeHQ ?? 0) >= 0.5 ? 1 : 0,
    };
  }

  update(next: Ditune2Params, immediate = false) {
    if (this.disposedInternal) return;
    this.params = { ...this.params, ...next };
    this.applyWorkletParams(immediate);
  }

  private setParam(name: string, value: number, immediate: boolean) {
    if (!this.workletNode) return;
    const param = this.workletNode.parameters.get(name);
    if (!param) return;
    const now = this.raw.currentTime;
    try { param.cancelAndHoldAtTime(now); } catch { param.cancelScheduledValues(now); }
    if (immediate) param.setValueAtTime(value, now);
    else param.setTargetAtTime(value, now, 0.012);
  }

  private applyWorkletParams(immediate: boolean) {
    if (!this.workletNode) return;
    const p = this.normalizedParams();
    this.setParam('referenceHz', p.referenceHz, immediate);
    this.setParam('speed', p.speed, immediate);
    this.setParam('humanize', p.humanize, immediate);
    this.setParam('transition', p.transition, immediate);
    this.setParam('color', p.color, immediate);
    this.setParam('modeHQ', p.modeHQ, immediate);
  }

  getTelemetry(): Ditune2Telemetry {
    return { ...this.telemetry, backend: this.backend };
  }

  dispose(): this {
    if (this.disposedInternal) return this;
    this.disposedInternal = true;
    if (this.activationTimer) clearTimeout(this.activationTimer);
    this.activationTimer = null;

    Ditune2Node.instances.delete(this);
    if (Ditune2Node.lastActiveInstance === this) {
      Ditune2Node.lastActiveInstance = Ditune2Node.instances.values().next().value || null;
    }

    if (this.workletNode) {
      try { this.workletNode.port.close(); } catch {}
      try { this.workletNode.disconnect(); } catch {}
      this.workletNode = null;
    }
    if (this.passthroughNode) {
      try { this.passthroughNode.dispose(); } catch {}
      this.passthroughNode = null;
    }
    this.disconnectStartupDry();
    try { this.processed.dispose(); } catch {}
    super.dispose();
    return this;
  }
}
