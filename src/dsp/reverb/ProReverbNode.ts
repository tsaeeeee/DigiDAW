import * as Tone from 'tone';
import { ReverbParams, DEFAULT_REVERB_PARAMS } from './ReverbParameters';
import { ReverbEngine } from './ReverbEngine';

export interface ReverbTelemetry {
  inputRms: number;
  reverbRms: number;
  feedbackRms: number;
  outputRms: number;
  isProcessing: boolean;
}

/**
 * Analog Circuit Reverb Node (Tone.js AudioNode compatible)
 * Implements the NE5532 + PT2399 / Belton Brick circuit diagram.
 */
export class ProReverbNode extends Tone.ToneAudioNode<any> {
  readonly name: string = 'ProReverbNode';
  public static lastActiveInstance: ProReverbNode | null = null;
  public static instances: Set<ProReverbNode> = new Set();

  public readonly input: Tone.Gain;
  public readonly output: Tone.Gain;
  public readonly inputNode: Tone.Gain;
  public readonly outputNode: Tone.Gain;
  public processorNode: ScriptProcessorNode | null = null;

  private rawCtx: AudioContext | BaseAudioContext;
  private jsEngine: ReverbEngine;
  private params: ReverbParams;

  // Real-time circuit telemetry
  public telemetry: ReverbTelemetry = {
    inputRms: 0,
    reverbRms: 0,
    feedbackRms: 0,
    outputRms: 0,
    isProcessing: false,
  };

  constructor(context?: any, initialParams: Partial<ReverbParams> = {}) {
    super();

    // Safely extract the underlying native Web Audio AudioContext / BaseAudioContext
    const raw: any =
      (context && typeof context.createScriptProcessor === 'function' && context) ||
      (context && context.rawContext && typeof context.rawContext.createScriptProcessor === 'function' && context.rawContext) ||
      (context && context._context && typeof context._context.createScriptProcessor === 'function' && context._context) ||
      (this.context && (this.context as any).rawContext && typeof (this.context as any).rawContext.createScriptProcessor === 'function' && (this.context as any).rawContext) ||
      (Tone.getContext && Tone.getContext().rawContext && typeof (Tone.getContext().rawContext as any).createScriptProcessor === 'function' && Tone.getContext().rawContext) ||
      (Tone.context && (Tone.context as any).rawContext && typeof (Tone.context as any).rawContext.createScriptProcessor === 'function' && (Tone.context as any).rawContext) ||
      (Tone.context as any) ||
      context;

    this.rawCtx = raw;
    const sampleRate = (raw && raw.sampleRate) || 44100;

    this.params = { ...DEFAULT_REVERB_PARAMS, ...initialParams };
    this.jsEngine = new ReverbEngine(sampleRate, this.params);

    // Initialize Tone.Gain endpoints
    this.inputNode = new Tone.Gain({ context: this.context });
    this.outputNode = new Tone.Gain({ context: this.context });
    this.input = this.inputNode;
    this.output = this.outputNode;

    // Create synchronous audio processor node for 100% reliable real-time execution
    try {
      const bufferSize = 512;
      let procNode: ScriptProcessorNode | null = null;

      if (this.rawCtx && typeof (this.rawCtx as any).createScriptProcessor === 'function') {
        procNode = (this.rawCtx as any).createScriptProcessor(bufferSize, 2, 2);
      } else if (this.rawCtx && typeof (this.rawCtx as any).createJavaScriptNode === 'function') {
        procNode = (this.rawCtx as any).createJavaScriptNode(bufferSize, 2, 2);
      } else if (Tone.getContext && Tone.getContext().rawContext && typeof (Tone.getContext().rawContext as any).createScriptProcessor === 'function') {
        procNode = (Tone.getContext().rawContext as any).createScriptProcessor(bufferSize, 2, 2);
      }

      if (!procNode) {
        throw new Error('createScriptProcessor is unavailable in current context');
      }

      this.processorNode = procNode;

      let inSumSq = 0;
      let outSumSq = 0;
      let sampleCount = 0;

      this.processorNode.onaudioprocess = (e) => {
        const inL = e.inputBuffer.getChannelData(0);
        const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
        const outL = e.outputBuffer.getChannelData(0);
        const outR = e.outputBuffer.getChannelData(1);

        for (let i = 0; i < inL.length; i++) {
          const sInL = inL[i];
          const sInR = inR[i];
          const res = this.jsEngine.processSample(sInL, sInR);
          outL[i] = res.outL;
          outR[i] = res.outR;

          inSumSq += sInL * sInL + sInR * sInR;
          outSumSq += res.outL * res.outL + res.outR * res.outR;
          sampleCount += 2;
        }

        if (sampleCount >= 1024) {
          const inRms = Math.sqrt(inSumSq / sampleCount);
          const outRms = Math.sqrt(outSumSq / sampleCount);
          this.telemetry.inputRms = inRms;
          this.telemetry.outputRms = outRms;
          this.telemetry.isProcessing = inRms > 0.0001 || outRms > 0.0001;
          inSumSq = 0;
          outSumSq = 0;
          sampleCount = 0;
        }
      };

      // Native audio graph wiring: inputNode -> processorNode -> outputNode
      const nativeIn = (this.inputNode.input as GainNode) || (this.inputNode as any)._gainNode || this.inputNode.output;
      const nativeOut = (this.outputNode.input as GainNode) || (this.outputNode as any)._gainNode || this.outputNode.output;

      if (nativeIn && typeof (nativeIn as any).connect === 'function') {
        (nativeIn as any).connect(this.processorNode);
      }
      if (nativeOut && typeof (this.processorNode as any).connect === 'function') {
        this.processorNode.connect(nativeOut as any);
      }
    } catch (err) {
      console.warn('ScriptProcessor initialization failed, establishing bypass:', err);
      Tone.connect(this.inputNode, this.outputNode);
    }

    ProReverbNode.lastActiveInstance = this;
    ProReverbNode.instances.add(this);
  }

  public setParams(newParams: Partial<ReverbParams>): void {
    this.params = { ...this.params, ...newParams };
    this.jsEngine.setParams(this.params);
  }

  public getTelemetry(): ReverbTelemetry {
    return { ...this.telemetry };
  }

  public dispose(): this {
    ProReverbNode.instances.delete(this);
    if (ProReverbNode.lastActiveInstance === this) {
      ProReverbNode.lastActiveInstance = null;
    }

    try {
      if (this.processorNode) {
        try { this.processorNode.disconnect(); } catch {}
        this.processorNode.onaudioprocess = null;
        this.processorNode = null;
      }
      if (this.inputNode) {
        try { this.inputNode.dispose(); } catch {}
      }
      if (this.outputNode) {
        try { this.outputNode.dispose(); } catch {}
      }
    } catch {}

    super.dispose();
    return this;
  }
}
