import * as Tone from 'tone';
import { ReverbParams, DEFAULT_REVERB_PARAMS } from './ReverbParameters';
import { PRO_REVERB_WORKLET_CODE } from './workletCode';
import { ReverbEngine } from './ReverbEngine';

const registeredContexts = new WeakSet<BaseAudioContext>();
let registrationPromise: Promise<void> | null = null;

export async function ensureReverbWorkletRegistered(context: BaseAudioContext): Promise<boolean> {
  if (registeredContexts.has(context)) {
    return true;
  }

  if (!context.audioWorklet) {
    return false;
  }

  try {
    if (!registrationPromise) {
      const blob = new Blob([PRO_REVERB_WORKLET_CODE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      registrationPromise = context.audioWorklet.addModule(url).then(() => {
        URL.revokeObjectURL(url);
      });
    }
    await registrationPromise;
    registeredContexts.add(context);
    return true;
  } catch (err) {
    console.warn('Failed to register ProReverb AudioWorklet, falling back to JS AudioNode:', err);
    return false;
  }
}

/**
 * Custom AudioWorkletNode / AudioNode Wrapper for the Pro Algorithmic Reverb DSP
 */
export class ProReverbNode {
  public inputNode: Tone.Gain;
  public outputNode: Tone.Gain;
  public input: Tone.Gain;
  public output: Tone.Gain;
  private workletNode: AudioWorkletNode | null = null;
  private jsEngine: ReverbEngine | null = null;
  private scriptNode: ScriptProcessorNode | null = null;
  private params: ReverbParams;
  public isWorkletReady: boolean = false;

  constructor(context: BaseAudioContext, initialParams: Partial<ReverbParams> = {}) {
    this.params = { ...DEFAULT_REVERB_PARAMS, ...initialParams };

    this.inputNode = new Tone.Gain(1);
    this.outputNode = new Tone.Gain(1);
    this.input = this.inputNode;
    this.output = this.outputNode;

    // Temporary dry pass-through until DSP node is attached
    Tone.connect(this.inputNode, this.outputNode);

    // Attempt to register AudioWorklet
    const rawCtx = context || Tone.getContext().rawContext;
    ensureReverbWorkletRegistered(rawCtx).then((registered) => {
      if (registered && rawCtx.audioWorklet) {
        try {
          this.workletNode = new AudioWorkletNode(rawCtx, 'pro-reverb-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
          });

          this.workletNode.port.postMessage({
            type: 'UPDATE_PARAMS',
            params: this.params,
          });

          try {
            this.inputNode.disconnect();
          } catch {
            // ignore
          }
          try {
            if ((this.inputNode as any).output) {
              (this.inputNode as any).output.connect(this.workletNode);
            } else {
              Tone.connect(this.inputNode, this.workletNode);
            }
          } catch {
            // ignore
          }
          try {
            const dest = (this.outputNode as any).input || (this.outputNode as any)._gainNode || (this.outputNode as any).output || this.outputNode;
            this.workletNode.connect(dest);
          } catch {
            // ignore
          }
          this.isWorkletReady = true;
          return;
        } catch (e) {
          console.warn('AudioWorkletNode instantiation failed:', e);
        }
      }

      // Fallback DSP Engine for Contexts that support ScriptProcessor
      if (typeof (rawCtx as any).createScriptProcessor === 'function') {
        try {
          this.jsEngine = new ReverbEngine(rawCtx.sampleRate, this.params);
          this.scriptNode = (rawCtx as any).createScriptProcessor(512, 2, 2);
          this.scriptNode.onaudioprocess = (e) => {
            if (!this.jsEngine) return;
            const inL = e.inputBuffer.getChannelData(0);
            const inR = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : inL;
            const outL = e.outputBuffer.getChannelData(0);
            const outR = e.outputBuffer.getChannelData(1);

            for (let i = 0; i < inL.length; i++) {
              const res = this.jsEngine.processSample(inL[i], inR[i]);
              outL[i] = res.outL;
              outR[i] = res.outR;
            }
          };

          try {
            this.inputNode.disconnect();
          } catch {
            // ignore
          }
          try {
            if ((this.inputNode as any).output) {
              (this.inputNode as any).output.connect(this.scriptNode);
            } else {
              Tone.connect(this.inputNode, this.scriptNode);
            }
          } catch {
            // ignore
          }
          try {
            const dest = (this.outputNode as any).input || (this.outputNode as any)._gainNode || (this.outputNode as any).output || this.outputNode;
            this.scriptNode.connect(dest);
          } catch {
            // ignore
          }
        } catch (err) {
          console.warn('ScriptProcessor fallback failed:', err);
        }
      }
    }).catch((err) => {
      console.warn('Reverb worklet registration catch:', err);
    });
  }

  public setParams(newParams: Partial<ReverbParams>): void {
    this.params = { ...this.params, ...newParams };
    if (this.workletNode) {
      this.workletNode.port.postMessage({
        type: 'UPDATE_PARAMS',
        params: this.params,
      });
    }
    if (this.jsEngine) {
      this.jsEngine.setParams(this.params);
    }
  }

  public connect(destination: any): any {
    return Tone.connect(this.outputNode, destination);
  }

  public dispose(): void {
    try {
      if (this.workletNode) {
        try { this.workletNode.disconnect(); } catch {}
        this.workletNode = null;
      }
      if (this.scriptNode) {
        try { this.scriptNode.disconnect(); } catch {}
        this.scriptNode.onaudioprocess = null;
        this.scriptNode = null;
      }
      if (this.inputNode && typeof (this.inputNode as any).dispose === 'function') {
        try { (this.inputNode as any).dispose(); } catch {}
      } else if (this.inputNode) {
        try { this.inputNode.disconnect(); } catch {}
      }
      if (this.outputNode && typeof (this.outputNode as any).dispose === 'function') {
        try { (this.outputNode as any).dispose(); } catch {}
      } else if (this.outputNode) {
        try { this.outputNode.disconnect(); } catch {}
      }
    } catch {
      // ignore
    }
  }
}
