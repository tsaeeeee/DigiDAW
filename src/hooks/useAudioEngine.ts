import { useEffect, useRef, useState, useCallback } from 'react';
import * as Tone from 'tone';
import { Track, TransportState, AudioClip, EffectSlot, EffectType } from '../types/daw';
import { audioBufferToWav } from '../lib/wavEncoder';
import { ProReverbNode } from '../dsp/reverb/ProReverbNode';
import { SaturationNode, SaturationMode } from '../dsp/saturator/SaturationNode';
import { PitchyNode } from '../dsp/pitchy/PitchyNode';

const INITIAL_TRACK_COUNT = 3;
const MAX_TRACKS = 25;
const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
const DELAY_SYNC_BEAT_FACTORS = [0.125, 0.25, 0.5, 1, 2, 4];

type AnalyserBundle = {
  meter: Tone.Meter;
  fft: Tone.Analyser;
  preFaderMeter: Tone.Meter;
};

type EffectInstance = {
  type: EffectType;
  nodes: any[];
};

type TrackParamsUpdate = Partial<Pick<Track, 'volume' | 'pan' | 'muted' | 'soloed' | 'color'>>;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createLimiterCurve(limitLinear: number, enabled: number, length = 2048): Float32Array {
  const curve = new Float32Array(length);
  const clampedLimit = clamp(limitLinear, 0.0001, 1.0);

  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1;
    curve[i] = enabled === 1 ? clamp(x, -clampedLimit, clampedLimit) : clamp(x, -1, 1);
  }

  return curve;
}

export const createDefaultEffects = (): EffectSlot[] =>
  Array.from({ length: 5 }).map(() => ({
    id: crypto.randomUUID(),
    type: null,
    bypassed: false,
  }));

function getAudioNodeInput(node: any): any {
  if (!node) return null;
  if (node.inputNode) return node.inputNode;
  if (node.input && typeof node.input.connect === 'function') return node.input;
  if ((node as any)._gainNode) return (node as any)._gainNode;
  return node;
}

function getAudioNodeOutput(node: any): any {
  if (!node) return null;
  if (node.outputNode) return node.outputNode;
  if (node.output && typeof node.output.connect === 'function') return node.output;
  if ((node as any)._gainNode) return (node as any)._gainNode;
  return node;
}

export function safeConnect(src: any, dst: any) {
  if (!src || !dst) return;

  try {
    Tone.connect(src, dst);
    return;
  } catch {}

  const srcOut = getAudioNodeOutput(src);
  const dstIn = getAudioNodeInput(dst);

  try {
    if (srcOut && typeof srcOut.connect === 'function') {
      srcOut.connect(dstIn);
      return;
    }
  } catch {}

  try {
    Tone.connect(srcOut, dstIn);
  } catch (err) {
    console.warn('safeConnect warning:', err);
  }
}

export function safeDisconnect(node: any) {
  if (!node) return;

  try {
    if (typeof node.disconnect === 'function') node.disconnect();
  } catch {}

  try {
    const srcOut = getAudioNodeOutput(node);
    if (srcOut && srcOut !== node && typeof srcOut.disconnect === 'function') {
      srcOut.disconnect();
    }
  } catch {}
}

function getDelayTimeSeconds(params: Record<string, number>): number {
  if ((params.syncMode ?? 0) === 1) {
    const bpm = clamp(Number(Tone.Transport.bpm.value) || 120, 20, 400);
    const index = clamp(Math.round(params.syncDivIndex ?? 2), 0, DELAY_SYNC_BEAT_FACTORS.length - 1);
    return clamp((60 / bpm) * DELAY_SYNC_BEAT_FACTORS[index], 0.005, 2.0);
  }

  return clamp((params.time ?? 240) / 1000, 0.005, 2.0);
}

function estimateEffectsTail(effects?: EffectSlot[]): number {
  if (!effects) return 0;
  let totalTail = 0;

  for (const slot of effects) {
    if (!slot?.type || slot.bypassed) continue;
    const p = slot.params || {};

    if (slot.type === 'Reverb') {
      const decay = clamp(p.decay ?? 2.5, 0.2, 20);
      const predelay = clamp(p.predelay ?? 20, 0, 250) / 1000;
      totalTail += predelay + decay * 1.15;
    } else if (slot.type === 'Delay') {
      const delaySeconds = getDelayTimeSeconds(p);
      const feedback = clamp((p.feedback ?? 40) / 100, 0, 0.95);
      const repeatsToMinus60 = feedback <= 0.001
        ? 1
        : clamp(Math.log(0.001) / Math.log(feedback), 1, 80);
      totalTail += delaySeconds * repeatsToMinus60 + 0.1;
    } else if (slot.type === 'Compressor') {
      totalTail += clamp((p.release ?? 100) / 1000, 0, 1);
    } else if (slot.type === 'Limiter') {
      totalTail += clamp((p.release ?? 50) / 1000, 0, 1);
    }
  }

  return clamp(totalTail, 0, 30);
}

export class StereoChannel {
  public input: Tone.Gain;
  public output: Tone.Gain;
  public preFaderNode: Tone.Gain;
  public preFaderMeter: Tone.Meter;
  public fft: Tone.Analyser;

  private panner: Tone.Panner;
  private volNode: Tone.Gain;
  private activeEffectInstances: EffectInstance[] = [];
  private lastEffectSlots: EffectSlot[] = [];
  private _volumeDb = 0;
  private _pan = 0;
  private _muted = false;
  private disposed = false;

  constructor(_context?: BaseAudioContext) {
    this.input = new Tone.Gain({ gain: 1 });
    this.preFaderNode = new Tone.Gain({ gain: 1 });
    this.panner = new Tone.Panner(0);
    this.volNode = new Tone.Gain({ gain: 1 });
    this.output = new Tone.Gain({ gain: 1 });

    this.preFaderMeter = new Tone.Meter({ channelCount: 2 });
    this.fft = new Tone.Analyser({ type: 'fft', size: 128 });

    safeConnect(this.preFaderNode, this.preFaderMeter);
    safeConnect(this.preFaderNode, this.fft);
    safeConnect(this.input, this.preFaderNode);
    safeConnect(this.preFaderNode, this.panner);
    safeConnect(this.panner, this.volNode);
    safeConnect(this.volNode, this.output);

    this.updateVolume();
    this.updatePan();
  }

  public setPan(pan: number) {
    this._pan = clamp(pan, -1, 1);
    this.updatePan();
  }

  public setVolume(db: number) {
    this._volumeDb = clamp(db, -60, 6);
    this.updateVolume();
  }

  public setMute(muted: boolean) {
    this._muted = muted;
    this.updateVolume();
  }

  public refreshTempoSyncedEffects() {
    if (this.lastEffectSlots.length > 0) {
      this.setEffects(this.lastEffectSlots);
    }
  }

  public setEffects(effectSlots: EffectSlot[]) {
    if (this.disposed) return;

    this.lastEffectSlots = (effectSlots || []).map(slot => ({
      ...slot,
      params: slot.params ? { ...slot.params } : undefined,
    }));

    const activeSlots = this.lastEffectSlots.filter(slot => slot?.type && !slot.bypassed);
    const currentTypes = this.activeEffectInstances.map(instance => instance.type);
    const newTypes = activeSlots.map(slot => slot.type!);

    const sameStructure =
      currentTypes.length === newTypes.length &&
      currentTypes.every((type, index) => type === newTypes[index]);

    if (sameStructure && activeSlots.length > 0) {
      activeSlots.forEach((slot, index) => {
        const instance = this.activeEffectInstances[index];
        if (instance) this.updateEffectInstance(slot, instance);
      });
      return;
    }

    this.disposeEffects();

    safeDisconnect(this.input);
    safeDisconnect(this.preFaderNode);

    safeConnect(this.preFaderNode, this.preFaderMeter);
    safeConnect(this.preFaderNode, this.fft);
    safeConnect(this.preFaderNode, this.panner);
    safeConnect(this.panner, this.volNode);
    safeConnect(this.volNode, this.output);

    if (activeSlots.length === 0) {
      safeConnect(this.input, this.preFaderNode);
      return;
    }

    const allNodes: any[] = [];
    const newInstances: EffectInstance[] = [];

    for (const slot of activeSlots) {
      try {
        const nodes = this.createEffectNodes(slot);
        if (nodes.length > 0) {
          allNodes.push(...nodes);
          newInstances.push({ type: slot.type!, nodes });
        }
      } catch (err) {
        console.warn('Effect creation failed for type:', slot.type, err);
      }
    }

    this.activeEffectInstances = newInstances;

    if (allNodes.length === 0) {
      safeConnect(this.input, this.preFaderNode);
      return;
    }

    safeConnect(this.input, allNodes[0]);
    for (let index = 0; index < allNodes.length - 1; index++) {
      safeConnect(allNodes[index], allNodes[index + 1]);
    }
    safeConnect(allNodes[allNodes.length - 1], this.preFaderNode);
  }

  private updateEffectInstance(slot: EffectSlot, instance: EffectInstance) {
    const p = slot.params || {};

    if (slot.type === 'Compressor' && instance.nodes.length >= 2) {
      const comp = instance.nodes[0] as Tone.Compressor;
      const output = instance.nodes[1] as Tone.Volume;

      comp.threshold.value = clamp(p.threshold ?? -20, -100, 0);
      comp.ratio.value = clamp(p.ratio ?? 4, 1, 20);
      comp.attack.value = clamp((p.attack ?? 10) / 1000, 0.0001, 0.999);
      comp.release.value = clamp((p.release ?? 100) / 1000, 0.001, 0.999);
      output.volume.value = clamp(p.output ?? 0, -60, 24);
      return;
    }

    if (slot.type === 'EQ' && instance.nodes.length >= 5) {
      const filterTypes: BiquadFilterType[] = ['peaking', 'highpass', 'lowpass', 'lowshelf', 'highshelf'];
      const defaultTypes: BiquadFilterType[] = ['highpass', 'peaking', 'peaking', 'peaking', 'lowpass'];
      const defaultFreqs = [40, 250, 1000, 4000, 15000];

      for (let band = 1; band <= 5; band++) {
        const filter = instance.nodes[band - 1] as Tone.BiquadFilter;
        let desiredType = defaultTypes[band - 1];

        if (typeof (p as any)[`b${band}_type_str`] === 'string') {
          desiredType = (p as any)[`b${band}_type_str`] as BiquadFilterType;
        } else if (typeof p[`b${band}_type`] === 'number') {
          desiredType = filterTypes[p[`b${band}_type`]] || defaultTypes[band - 1];
        }

        const bypassed = p[`b${band}_bypass`] === 1;
        filter.type = bypassed ? 'allpass' : desiredType;
        filter.frequency.value = clamp(p[`b${band}_freq`] ?? defaultFreqs[band - 1], 20, 20000);
        filter.gain.value = clamp(p[`b${band}_gain`] ?? 0, -24, 24);
        filter.Q.value = clamp(
          p[`b${band}_q`] ?? (desiredType === 'highpass' || desiredType === 'lowpass' ? 0.707 : 1),
          0.1,
          18,
        );
      }
      return;
    }

    if (slot.type === 'Limiter' && instance.nodes.length >= 4) {
      const inputDrive = instance.nodes[0] as Tone.Volume;
      const dist = instance.nodes[1] as Tone.Distortion;
      const limiter = instance.nodes[2] as Tone.Compressor;
      const hardClipper = instance.nodes[3] as Tone.WaveShaper;

      const ceiling = clamp(p.ceiling ?? -0.5, -60, -0.01);
      const drive = clamp(p.drive ?? 4, -24, 24);
      const release = clamp((p.release ?? 50) / 1000, 0.005, 0.999);
      const sat = clamp((p.diodeSat ?? 15) / 100, 0, 0.999);
      const truePeak = p.truePeak ?? 1;

      inputDrive.volume.value = drive;
      dist.distortion = clamp(sat * 0.8, 0.001, 0.999);
      dist.wet.value = sat;
      limiter.threshold.value = ceiling;
      limiter.release.value = release;
      hardClipper.curve = createLimiterCurve(Math.pow(10, ceiling / 20), truePeak);
      hardClipper.oversample = truePeak === 1 ? '4x' : 'none';
      return;
    }

    if (slot.type === 'Reverb' && instance.nodes.length >= 1) {
      const reverb = instance.nodes[0] as ProReverbNode;
      reverb.setParams(p);
      return;
    }

    if (slot.type === 'Delay' && instance.nodes.length >= 7) {
      const lowCutFilter = instance.nodes[1] as Tone.BiquadFilter;
      const toneFilter = instance.nodes[2] as Tone.BiquadFilter;
      const distNode = instance.nodes[3] as Tone.Distortion;
      const chorus = instance.nodes[4] as Tone.Chorus;
      const delayNode = instance.nodes[5] as Tone.FeedbackDelay;
      const outputVol = instance.nodes[6] as Tone.Volume;

      const lowCut = p.lowCut ?? 0;
      const tone = clamp(p.tone ?? 5, 1, 10);
      const drive = p.drive ?? 0;
      const feedback = clamp((p.feedback ?? 40) / 100, 0, 0.95);
      const wetMix = clamp((p.wetMix ?? 50) / 100, 0, 0.999);
      const mod = clamp((p.mod ?? 50) / 100, 0, 1);
      const lrOffset = clamp(p.lrOffset ?? 0, -50, 50);

      lowCutFilter.frequency.value = lowCut === 1 ? 200 : 20;
      toneFilter.frequency.value = clamp(1000 + (tone / 10) * 15000, 200, 20000);
      distNode.distortion = drive === 1 ? 0.35 : 0.001;
      distNode.wet.value = drive === 1 ? 0.6 : 0;

      chorus.frequency.value = 0.12 + mod * 1.6;
      chorus.delayTime = 2 + mod * 6 + Math.abs(lrOffset) * 0.04;
      chorus.depth = 0.08 + mod * 0.32;
      chorus.spread = clamp(120 + lrOffset, 60, 180);
      chorus.wet.value = clamp(mod * 0.22 + Math.abs(lrOffset) / 50 * 0.08, 0, 0.3);

      delayNode.delayTime.value = getDelayTimeSeconds(p);
      delayNode.feedback.value = feedback;
      delayNode.wet.value = wetMix;
      outputVol.volume.value = clamp(p.outGain ?? 0, -24, 12);
      return;
    }

    if (slot.type === 'Saturator' && instance.nodes.length >= 1) {
      const satNode = instance.nodes[0] as SaturationNode;
      const modes: SaturationMode[] = ['clean', 'normal', 'hot', 'redline'];
      satNode.update({
        inputGain: p.inputGain ?? 0,
        saturationDrive: p.saturationDrive ?? 3,
        saturationMode: modes[p.modeIndex ?? 1] || 'normal',
        outputGain: p.outputGain ?? 0,
      });
      return;
    }

    if (slot.type === 'Pitchy' && instance.nodes.length >= 1) {
      const pitchNode = instance.nodes[0] as PitchyNode;
      pitchNode.update({
        referenceHz: p.referenceHz ?? 440,
        speed: p.speed ?? 75,
        humanize: p.humanize ?? 20,
        transition: p.transition ?? 30,
        color: p.color ?? 50,
        mode: p.modeHQ === 1 ? 'hq' : 'realtime',
      });
    }
  }

  private createEffectNodes(slot: EffectSlot): any[] {
    const p = slot.params || {};

    if (slot.type === 'Compressor') {
      return [
        new Tone.Compressor({
          threshold: clamp(p.threshold ?? -20, -100, 0),
          ratio: clamp(p.ratio ?? 4, 1, 20),
          attack: clamp((p.attack ?? 10) / 1000, 0.0001, 0.999),
          release: clamp((p.release ?? 100) / 1000, 0.001, 0.999),
          knee: 3,
        }),
        new Tone.Volume(clamp(p.output ?? 0, -60, 24)),
      ];
    }

    if (slot.type === 'EQ') {
      const filterTypes: BiquadFilterType[] = ['peaking', 'highpass', 'lowpass', 'lowshelf', 'highshelf'];
      const defaultTypes: BiquadFilterType[] = ['highpass', 'peaking', 'peaking', 'peaking', 'lowpass'];
      const defaultFreqs = [40, 250, 1000, 4000, 15000];

      return Array.from({ length: 5 }, (_, index) => {
        const band = index + 1;
        let desiredType = defaultTypes[index];

        if (typeof (p as any)[`b${band}_type_str`] === 'string') {
          desiredType = (p as any)[`b${band}_type_str`] as BiquadFilterType;
        } else if (typeof p[`b${band}_type`] === 'number') {
          desiredType = filterTypes[p[`b${band}_type`]] || defaultTypes[index];
        }

        const bypassed = p[`b${band}_bypass`] === 1;
        return new Tone.BiquadFilter({
          type: bypassed ? 'allpass' : desiredType,
          frequency: clamp(p[`b${band}_freq`] ?? defaultFreqs[index], 20, 20000),
          gain: clamp(p[`b${band}_gain`] ?? 0, -24, 24),
          Q: clamp(
            p[`b${band}_q`] ?? (desiredType === 'highpass' || desiredType === 'lowpass' ? 0.707 : 1),
            0.1,
            18,
          ),
        });
      });
    }

    if (slot.type === 'Reverb') {
      return [new ProReverbNode(Tone.getContext().rawContext, p)];
    }

    if (slot.type === 'Delay') {
      const mod = clamp((p.mod ?? 50) / 100, 0, 1);
      const lrOffset = clamp(p.lrOffset ?? 0, -50, 50);
      const chorus = new Tone.Chorus({
        frequency: 0.12 + mod * 1.6,
        delayTime: 2 + mod * 6 + Math.abs(lrOffset) * 0.04,
        depth: 0.08 + mod * 0.32,
        spread: clamp(120 + lrOffset, 60, 180),
        wet: clamp(mod * 0.22 + Math.abs(lrOffset) / 50 * 0.08, 0, 0.3),
        feedback: 0,
      }).start();

      const delay = new Tone.FeedbackDelay({
        delayTime: getDelayTimeSeconds(p),
        maxDelay: 2.1,
        feedback: clamp((p.feedback ?? 40) / 100, 0, 0.95),
        wet: clamp((p.wetMix ?? 50) / 100, 0, 0.999),
      });

      return [
        new Tone.Volume(0),
        new Tone.BiquadFilter({
          type: 'highpass',
          frequency: (p.lowCut ?? 0) === 1 ? 200 : 20,
        }),
        new Tone.BiquadFilter({
          type: 'lowpass',
          frequency: clamp(1000 + (clamp(p.tone ?? 5, 1, 10) / 10) * 15000, 200, 20000),
        }),
        new Tone.Distortion({
          distortion: (p.drive ?? 0) === 1 ? 0.35 : 0.001,
          wet: (p.drive ?? 0) === 1 ? 0.6 : 0,
        }),
        chorus,
        delay,
        new Tone.Volume(clamp(p.outGain ?? 0, -24, 12)),
      ];
    }

    if (slot.type === 'Limiter') {
      const ceiling = clamp(p.ceiling ?? -0.5, -60, -0.01);
      const sat = clamp((p.diodeSat ?? 15) / 100, 0, 0.999);
      const truePeak = p.truePeak ?? 1;

      const shaper = new Tone.WaveShaper({
        curve: createLimiterCurve(Math.pow(10, ceiling / 20), truePeak),
      });
      shaper.oversample = truePeak === 1 ? '4x' : 'none';

      return [
        new Tone.Volume(clamp(p.drive ?? 4, -24, 24)),
        new Tone.Distortion({
          distortion: clamp(sat * 0.8, 0.001, 0.999),
          wet: sat,
        }),
        new Tone.Compressor({
          threshold: ceiling,
          ratio: 20,
          attack: 0.001,
          release: clamp((p.release ?? 50) / 1000, 0.005, 0.999),
          knee: 0,
        }),
        shaper,
      ];
    }

    if (slot.type === 'Saturator') {
      const modes: SaturationMode[] = ['clean', 'normal', 'hot', 'redline'];
      return [
        new SaturationNode({
          inputGain: p.inputGain ?? 0,
          saturationDrive: p.saturationDrive ?? 3,
          saturationMode: modes[p.modeIndex ?? 1] || 'normal',
          outputGain: p.outputGain ?? 0,
        }),
      ];
    }

    if (slot.type === 'Pitchy') {
      return [
        new PitchyNode({
          referenceHz: p.referenceHz ?? 440,
          speed: p.speed ?? 75,
          humanize: p.humanize ?? 20,
          transition: p.transition ?? 30,
          color: p.color ?? 50,
          mode: p.modeHQ === 1 ? 'hq' : 'realtime',
        }),
      ];
    }

    return [];
  }

  private disposeEffects() {
    this.activeEffectInstances.forEach(instance => {
      instance.nodes.forEach(node => {
        try {
          safeDisconnect(node);
          if (node && typeof node.dispose === 'function') node.dispose();
        } catch {}
      });
    });

    this.activeEffectInstances = [];
  }

  private updateVolume() {
    this.volNode.gain.value = this._muted || this._volumeDb <= -59.5
      ? 0
      : Math.pow(10, this._volumeDb / 20);
  }

  private updatePan() {
    this.panner.pan.value = this._pan;
  }

  public connect(destination: any) {
    safeConnect(this.output, destination);
    return this;
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;

    this.disposeEffects();
    this.lastEffectSlots = [];

    try { this.preFaderMeter.dispose(); } catch {}
    try { this.fft.dispose(); } catch {}

    [this.input, this.preFaderNode, this.panner, this.volNode, this.output].forEach(node => {
      try { safeDisconnect(node); } catch {}
      try { node.dispose(); } catch {}
    });
  }
}

export function useAudioEngine() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [transportState, setTransportState] = useState<TransportState>('stopped');
  const [currentTime, setCurrentTime] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  const [bpm, setBpmState] = useState(120);
  const [metronomeEnabled, setMetronomeEnabledState] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);

  const tracksRef = useRef<Track[]>([]);
  const bpmRef = useRef(120);
  const metronomeEnabledRef = useRef(false);
  const initializingRef = useRef(false);
  const metronomeEventIdRef = useRef<number | null>(null);

  const masterChannelRef = useRef<StereoChannel | null>(null);
  const channelsRef = useRef<Map<string, StereoChannel>>(new Map());
  const playersRef = useRef<Map<string, Tone.Player[]>>(new Map());
  const analysersRef = useRef<Map<string, AnalyserBundle>>(new Map());
  const masterAnalyserRef = useRef<AnalyserBundle | null>(null);

  const [masterParams, setMasterParams] = useState<{ volume: number; pan: number; effects: EffectSlot[] }>({
    volume: 0,
    pan: 0,
    effects: createDefaultEffects(),
  });

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  const setBpm = useCallback((newBpm: number) => {
    const clampedBpm = clamp(Math.round(newBpm), 60, 300);
    bpmRef.current = clampedBpm;
    setBpmState(clampedBpm);

    Tone.Transport.bpm.value = clampedBpm;
    channelsRef.current.forEach(channel => channel.refreshTempoSyncedEffects());
    masterChannelRef.current?.refreshTempoSyncedEffects();
  }, []);

  const toggleMetronome = useCallback(() => {
    setMetronomeEnabledState(previous => {
      const next = !previous;
      metronomeEnabledRef.current = next;
      return next;
    });
  }, []);

  const setMetronomeEnabled = useCallback((enabled: boolean) => {
    metronomeEnabledRef.current = enabled;
    setMetronomeEnabledState(enabled);
  }, []);

  const createTrackAudioNodes = useCallback((track: Track, masterChannel: StereoChannel) => {
    const channel = new StereoChannel(Tone.getContext().rawContext);
    channel.setVolume(track.volume);
    channel.setPan(track.pan);
    channel.setEffects(track.effects || createDefaultEffects());
    channel.connect(masterChannel.input);

    const meter = new Tone.Meter({ channelCount: 2 });
    channel.connect(meter);

    channelsRef.current.set(track.id, channel);
    analysersRef.current.set(track.id, {
      meter,
      fft: channel.fft,
      preFaderMeter: channel.preFaderMeter,
    });
  }, []);

  const init = useCallback(async () => {
    if (isInitialized || initializingRef.current) return;

    initializingRef.current = true;
    try {
      await Tone.start();
      if (Tone.context.state !== 'running') {
        await Tone.context.resume();
      }

      Tone.Transport.bpm.value = bpmRef.current;

      if (metronomeEventIdRef.current === null) {
        const eventId = Tone.Transport.scheduleRepeat((time) => {
          const ticks = Tone.Transport.ticks;
          const ppq = Tone.Transport.PPQ || 192;
          const beat = Math.floor(Math.round(ticks / ppq)) % 4;
          setCurrentBeat(beat);

          if (!metronomeEnabledRef.current) return;

          const rawCtx = Tone.getContext().rawContext;
          try {
            const osc = rawCtx.createOscillator();
            const gain = rawCtx.createGain();
            const firstBeat = beat === 0;
            const frequency = firstBeat ? 1760 : 980;
            const volume = firstBeat ? 0.85 : 0.6;

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(frequency, time);
            osc.frequency.exponentialRampToValueAtTime(frequency * 0.5, time + 0.04);
            gain.gain.setValueAtTime(volume, time);
            gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);

            osc.connect(gain);
            if (masterChannelRef.current) gain.connect(masterChannelRef.current.input.input);
            else gain.connect(rawCtx.destination);

            osc.onended = () => {
              try { osc.disconnect(); } catch {}
              try { gain.disconnect(); } catch {}
            };

            osc.start(time);
            osc.stop(time + 0.05);
          } catch (err) {
            console.warn('Metronome click error:', err);
          }
        }, '4n');

        metronomeEventIdRef.current = eventId;
      }

      const masterChannel = new StereoChannel(Tone.getContext().rawContext);
      masterChannel.setVolume(masterParams.volume);
      masterChannel.setPan(masterParams.pan);
      masterChannel.setEffects(masterParams.effects);
      masterChannel.connect(Tone.getDestination());

      const masterMeter = new Tone.Meter({ channelCount: 2 });
      masterChannel.connect(masterMeter);

      masterChannelRef.current = masterChannel;
      masterAnalyserRef.current = {
        meter: masterMeter,
        fft: masterChannel.fft,
        preFaderMeter: masterChannel.preFaderMeter,
      };

      const initialTracks: Track[] = Array.from({ length: INITIAL_TRACK_COUNT }, (_, index) => ({
        id: crypto.randomUUID(),
        name: `Track ${index + 1}`,
        color: COLORS[index % COLORS.length],
        clips: [],
        muted: false,
        soloed: false,
        volume: 0,
        pan: 0,
        effects: createDefaultEffects(),
      }));

      initialTracks.forEach(track => createTrackAudioNodes(track, masterChannel));
      tracksRef.current = initialTracks;
      setTracks(initialTracks);
      setIsInitialized(true);
    } catch (err) {
      console.error('Failed to initialize audio engine:', err);
    } finally {
      initializingRef.current = false;
    }
  }, [createTrackAudioNodes, isInitialized, masterParams]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (Tone.Transport.state === 'started') {
        setCurrentTime(Tone.Transport.seconds);
      }
    }, 50);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (metronomeEventIdRef.current !== null) {
        try { Tone.Transport.clear(metronomeEventIdRef.current); } catch {}
        metronomeEventIdRef.current = null;
      }

      tracksRef.current.forEach(track => {
        track.clips.forEach(clip => {
          if (clip.url?.startsWith('blob:')) URL.revokeObjectURL(clip.url);
        });
      });

      playersRef.current.forEach(players => {
        players.forEach(player => {
          try { player.stop(); } catch {}
          try { player.unsync(); } catch {}
          try { player.dispose(); } catch {}
        });
      });
      playersRef.current.clear();

      analysersRef.current.forEach(bundle => {
        try { bundle.meter.dispose(); } catch {}
      });
      analysersRef.current.clear();

      channelsRef.current.forEach(channel => channel.dispose());
      channelsRef.current.clear();

      if (masterAnalyserRef.current) {
        try { masterAnalyserRef.current.meter.dispose(); } catch {}
        masterAnalyserRef.current = null;
      }

      masterChannelRef.current?.dispose();
      masterChannelRef.current = null;
    };
  }, []);

  const addTrack = useCallback(() => {
    const currentTracks = tracksRef.current;
    if (currentTracks.length >= MAX_TRACKS || !masterChannelRef.current) return;

    const id = crypto.randomUUID();
    const newTrack: Track = {
      id,
      name: `Track ${currentTracks.length + 1}`,
      color: COLORS[currentTracks.length % COLORS.length],
      clips: [],
      muted: false,
      soloed: false,
      volume: 0,
      pan: 0,
      effects: createDefaultEffects(),
    };

    createTrackAudioNodes(newTrack, masterChannelRef.current);

    const hasSolo = currentTracks.some(track => track.soloed);
    const channel = channelsRef.current.get(id);
    if (channel) channel.setMute(hasSolo);

    const nextTracks = [...currentTracks, newTrack];
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
  }, [createTrackAudioNodes]);

  const removeTrack = useCallback((trackId: string) => {
    const removedTrack = tracksRef.current.find(track => track.id === trackId);
    removedTrack?.clips.forEach(clip => {
      if (clip.url?.startsWith('blob:')) URL.revokeObjectURL(clip.url);
    });

    const channel = channelsRef.current.get(trackId);
    if (channel) {
      channel.dispose();
      channelsRef.current.delete(trackId);
    }

    const players = playersRef.current.get(trackId);
    if (players) {
      players.forEach(player => {
        try { player.stop(); } catch {}
        try { player.unsync(); } catch {}
        try { player.dispose(); } catch {}
      });
      playersRef.current.delete(trackId);
    }

    const analyser = analysersRef.current.get(trackId);
    if (analyser) {
      try { analyser.meter.dispose(); } catch {}
      analysersRef.current.delete(trackId);
    }

    const nextTracks = tracksRef.current.filter(track => track.id !== trackId);
    const hasSolo = nextTracks.some(track => track.soloed);

    nextTracks.forEach(track => {
      const trackChannel = channelsRef.current.get(track.id);
      if (!trackChannel) return;
      const audible = hasSolo ? track.soloed && !track.muted : !track.muted;
      trackChannel.setMute(!audible);
    });

    tracksRef.current = nextTracks;
    setTracks(nextTracks);
  }, []);

  const togglePlay = useCallback(() => {
    if (Tone.Transport.state === 'started') {
      Tone.Transport.pause();
      setTransportState('paused');
    } else {
      Tone.Transport.start();
      setTransportState('started');
    }
  }, []);

  const stop = useCallback(() => {
    Tone.Transport.stop();
    setCurrentTime(0);
    setCurrentBeat(0);
    setTransportState('stopped');
  }, []);

  const seek = useCallback((time: number) => {
    Tone.Transport.seconds = Math.max(0, time);
    setCurrentTime(Tone.Transport.seconds);
  }, []);

  const updateTrackName = useCallback((trackId: string, name: string) => {
    const nextTracks = tracksRef.current.map(track =>
      track.id === trackId ? { ...track, name } : track,
    );
    tracksRef.current = nextTracks;
    setTracks(nextTracks);
  }, []);

  const uploadClip = useCallback(async (trackId: string, file: File) => {
    const objectUrl = URL.createObjectURL(file);

    try {
      const toneBuffer = await new Tone.ToneAudioBuffer().load(objectUrl);
      const channel = channelsRef.current.get(trackId);
      if (!channel) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      const clip: AudioClip = {
        id: crypto.randomUUID(),
        name: file.name,
        url: objectUrl,
        startTime: Tone.Transport.seconds,
        duration: toneBuffer.duration,
        buffer: toneBuffer.get(),
      };

      const player = new Tone.Player(toneBuffer).sync().start(clip.startTime);
      player.connect(channel.input);

      const existingPlayers = playersRef.current.get(trackId) || [];
      playersRef.current.set(trackId, [...existingPlayers, player]);

      const nextTracks = tracksRef.current.map(track =>
        track.id === trackId ? { ...track, clips: [...track.clips, clip] } : track,
      );
      tracksRef.current = nextTracks;
      setTracks(nextTracks);
    } catch (err) {
      URL.revokeObjectURL(objectUrl);
      console.error('Failed to load audio clip:', err);
    }
  }, []);

  const updateClipPosition = useCallback((trackId: string, clipId: string, newStartTime: number) => {
    const clampedStart = Math.max(0, newStartTime);

    const nextTracks = tracksRef.current.map(track => {
      if (track.id !== trackId) return track;

      const clipIndex = track.clips.findIndex(clip => clip.id === clipId);
      if (clipIndex >= 0) {
        const players = playersRef.current.get(trackId);
        const player = players?.[clipIndex];

        if (player) {
          try {
            player.stop();
            player.unsync();
            player.sync().start(clampedStart);
          } catch (err) {
            console.warn('Player resync failed:', err);
          }
        }
      }

      return {
        ...track,
        clips: track.clips.map(clip =>
          clip.id === clipId ? { ...clip, startTime: clampedStart } : clip,
        ),
      };
    });

    tracksRef.current = nextTracks;
    setTracks(nextTracks);
  }, []);

  const updateTrackParams = useCallback((trackId: string, params: TrackParamsUpdate) => {
    const nextTracks = tracksRef.current.map(track => {
      if (track.id !== trackId) return track;

      const updated = { ...track, ...params };
      const channel = channelsRef.current.get(trackId);

      if (channel) {
        if (params.volume !== undefined) channel.setVolume(updated.volume);
        if (params.pan !== undefined) channel.setPan(updated.pan);
      }

      return updated;
    });

    const hasSolo = nextTracks.some(track => track.soloed);
    nextTracks.forEach(track => {
      const channel = channelsRef.current.get(track.id);
      if (!channel) return;

      const audible = hasSolo ? track.soloed && !track.muted : !track.muted;
      channel.setMute(!audible);
    });

    tracksRef.current = nextTracks;
    setTracks(nextTracks);
  }, []);

  const updateTrackEffect = useCallback((
    trackId: string,
    slotIndex: number,
    type: EffectType | null,
    bypassed?: boolean,
    params?: Record<string, number>,
  ) => {
    const nextTracks = tracksRef.current.map(track => {
      if (track.id !== trackId) return track;

      const effects = track.effects ? [...track.effects] : createDefaultEffects();
      while (effects.length <= slotIndex) {
        effects.push({ id: crypto.randomUUID(), type: null, bypassed: false });
      }

      const existing = effects[slotIndex] || {
        id: crypto.randomUUID(),
        type: null,
        bypassed: false,
      };

      effects[slotIndex] = {
        ...existing,
        type,
        bypassed: bypassed !== undefined ? bypassed : existing.bypassed,
        params: params !== undefined ? { ...(existing.params || {}), ...params } : existing.params,
      };

      channelsRef.current.get(trackId)?.setEffects(effects);
      return { ...track, effects };
    });

    tracksRef.current = nextTracks;
    setTracks(nextTracks);
  }, []);

  const updateMasterParams = useCallback((_id: string, params: Partial<{ volume: number; pan: number }>) => {
    setMasterParams(previous => {
      const updated = { ...previous, ...params };
      if (params.volume !== undefined) masterChannelRef.current?.setVolume(updated.volume);
      if (params.pan !== undefined) masterChannelRef.current?.setPan(updated.pan);
      return updated;
    });
  }, []);

  const updateMasterEffect = useCallback((
    slotIndex: number,
    type: EffectType | null,
    bypassed?: boolean,
    params?: Record<string, number>,
  ) => {
    setMasterParams(previous => {
      const effects = previous.effects ? [...previous.effects] : createDefaultEffects();
      while (effects.length <= slotIndex) {
        effects.push({ id: crypto.randomUUID(), type: null, bypassed: false });
      }

      const existing = effects[slotIndex] || {
        id: crypto.randomUUID(),
        type: null,
        bypassed: false,
      };

      effects[slotIndex] = {
        ...existing,
        type,
        bypassed: bypassed !== undefined ? bypassed : existing.bypassed,
        params: params !== undefined ? { ...(existing.params || {}), ...params } : existing.params,
      };

      masterChannelRef.current?.setEffects(effects);
      return { ...previous, effects };
    });
  }, []);

  const renderAudio = useCallback(async () => {
    if (isRendering) return;

    const snapshotTracks = tracksRef.current;
    let maxClipEnd = 0;
    let maxTrackTail = 0;

    snapshotTracks.forEach(track => {
      track.clips.forEach(clip => {
        maxClipEnd = Math.max(maxClipEnd, clip.startTime + clip.duration);
      });
      maxTrackTail = Math.max(maxTrackTail, estimateEffectsTail(track.effects));
    });

    if (maxClipEnd <= 0) {
      console.warn('Nothing to render');
      return;
    }

    const masterTail = estimateEffectsTail(masterParams.effects);
    const renderTail = clamp(maxTrackTail + masterTail, 0.25, 30);
    const renderLength = maxClipEnd + renderTail + 0.1;

    setIsRendering(true);
    try {
      const rendered = await Tone.Offline(async () => {
        Tone.Transport.bpm.value = bpmRef.current;

        const masterBus = new StereoChannel(Tone.getContext().rawContext);
        masterBus.setVolume(masterParams.volume);
        masterBus.setPan(masterParams.pan);
        masterBus.setEffects(masterParams.effects);
        masterBus.connect(Tone.getDestination());

        const hasSolo = snapshotTracks.some(track => track.soloed);

        for (const track of snapshotTracks) {
          const audible = hasSolo ? track.soloed && !track.muted : !track.muted;
          if (!audible) continue;

          const channel = new StereoChannel(Tone.getContext().rawContext);
          channel.setVolume(track.volume);
          channel.setPan(track.pan);
          channel.setEffects(track.effects || createDefaultEffects());
          channel.connect(masterBus.input);

          for (const clip of track.clips) {
            if (!clip.buffer) continue;
            const player = new Tone.Player(clip.buffer).start(clip.startTime);
            player.connect(channel.input);
          }
        }
      }, renderLength);

      const rawBuffer = (rendered as any)?.get
        ? rendered.get()
        : rendered as unknown as AudioBuffer;

      const wav = audioBufferToWav(rawBuffer);
      const blob = new Blob([wav], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);

      try {
        const anchor = document.createElement('a');
        anchor.download = `DigiDAW-Rendered-${Date.now()}.wav`;
        anchor.href = url;
        anchor.click();
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } catch (err) {
      console.error('Render failed:', err);
    } finally {
      setIsRendering(false);
    }
  }, [isRendering, masterParams]);

  const normalizeGain = useCallback((
    targetTrackIds?: string[],
    targetClipIds?: string[],
    targetPeakDb = -1,
  ) => {
    const trackIds = targetTrackIds || [];
    const clipIds = targetClipIds || [];
    const targetPeakLinear = Math.pow(10, targetPeakDb / 20);

    // Run from the current snapshot (not inside a deferred React state updater).
    // The previous version returned before React executed its updater, so the
    // caller almost always received 0 even when normalization succeeded.
    let processedCount = 0;

    const nextTracks = tracksRef.current.map(track => {
      const trackTargeted = trackIds.length > 0 && trackIds.includes(track.id);

      const clips = track.clips.map((clip, clipIndex) => {
        const clipTargeted = clipIds.length > 0 && clipIds.includes(clip.id);
        const shouldProcess =
          clipTargeted ||
          trackTargeted ||
          (clipIds.length === 0 && trackIds.length === 0);

        if (!shouldProcess || !clip.buffer) return clip;

        const buffer = clip.buffer;
        let maxPeak = 0;

        for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex++) {
          const data = buffer.getChannelData(channelIndex);
          for (let sampleIndex = 0; sampleIndex < data.length; sampleIndex++) {
            const absolute = Math.abs(data[sampleIndex]);
            if (absolute > maxPeak) maxPeak = absolute;
          }
        }

        if (maxPeak <= 0.000001) return clip;

        const scaleFactor = targetPeakLinear / maxPeak;
        const normalized = new AudioBuffer({
          numberOfChannels: buffer.numberOfChannels,
          length: buffer.length,
          sampleRate: buffer.sampleRate,
        });

        for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex++) {
          const source = buffer.getChannelData(channelIndex);
          const destination = normalized.getChannelData(channelIndex);
          for (let sampleIndex = 0; sampleIndex < source.length; sampleIndex++) {
            destination[sampleIndex] = source[sampleIndex] * scaleFactor;
          }
        }

        const player = playersRef.current.get(track.id)?.[clipIndex];
        if (player) {
          try {
            player.buffer.set(normalized);
          } catch (err) {
            console.warn('Failed to update normalized player buffer:', err);
          }
        }

        processedCount++;
        return { ...clip, buffer: normalized };
      });

      return { ...track, clips };
    });

    if (processedCount > 0) {
      tracksRef.current = nextTracks;
      setTracks(nextTracks);
    }
    return processedCount;
  }, []);

  return {
    tracks,
    master: {
      ...masterParams,
      id: 'master',
      name: 'Master',
      color: '#ffd900',
    },
    transportState,
    currentTime,
    bpm,
    setBpm,
    metronomeEnabled,
    toggleMetronome,
    setMetronomeEnabled,
    currentBeat,
    isInitialized,
    isRendering,
    renderAudio,
    normalizeGain,
    init,
    togglePlay,
    stop,
    seek,
    addTrack,
    removeTrack,
    updateTrackName,
    uploadClip,
    updateClipPosition,
    updateTrackParams,
    updateMasterParams,
    updateTrackEffect,
    updateMasterEffect,
    analysers: analysersRef.current,
    masterAnalyser: masterAnalyserRef.current,
  };
}
