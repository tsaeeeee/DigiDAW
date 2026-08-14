import { useEffect, useRef, useState, useCallback } from 'react';
import * as Tone from 'tone';
import { Track, TransportState, AudioClip, EffectSlot, EffectType } from '../types/daw';
import { audioBufferToWav } from '../lib/wavEncoder';
import { ProReverbNode } from '../dsp/reverb/ProReverbNode';
import { SaturationNode, SaturationMode } from '../dsp/saturator/SaturationNode';
import { PitchyNode } from '../dsp/pitchy/PitchyNode';

function createLimiterCurve(limitLinear: number, enabled: number, length = 1024): Float32Array {
  const curve = new Float32Array(length);
  const clampedLimit = Math.max(0.0001, Math.min(1.0, limitLinear));
  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1;
    if (enabled === 1) {
      curve[i] = Math.max(-1, Math.min(1, Math.max(-clampedLimit, Math.min(clampedLimit, x))));
    } else {
      curve[i] = Math.max(-1, Math.min(1, x));
    }
  }
  return curve;
}

const INITIAL_TRACK_COUNT = 3;
const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

export const createDefaultEffects = (): EffectSlot[] =>
  Array.from({ length: 4 }).map(() => ({
    id: crypto.randomUUID(),
    type: null,
    bypassed: false,
  }));

export class StereoChannel {
  public input: GainNode;
  public output: GainNode;
  public preFaderNode: GainNode;
  public preFaderMeter: Tone.Meter;
  public fft: Tone.Analyser;
  private panner: StereoPannerNode;
  private volNode: GainNode;
  private effectsNodes: any[] = [];
  private activeEffectInstances: { type: EffectType; nodes: any[] }[] = [];
  private _volumeDb: number = 0;
  private _pan: number = 0;
  private _muted: boolean = false;

  constructor(context: BaseAudioContext) {
    this.input = context.createGain();
    this.input.channelCount = 2;
    this.input.channelCountMode = "explicit";
    this.input.channelInterpretation = "speakers";

    this.preFaderNode = context.createGain();
    this.preFaderNode.channelCount = 2;
    this.preFaderNode.channelCountMode = "explicit";
    this.preFaderNode.channelInterpretation = "speakers";

    this.preFaderMeter = new Tone.Meter({ channelCount: 2, context: context as any });
    this.fft = new Tone.Analyser({ type: 'fft', size: 128, context: context as any });

    Tone.connect(this.preFaderNode, this.preFaderMeter);
    Tone.connect(this.preFaderNode, this.fft);

    this.panner = context.createStereoPanner();

    this.volNode = context.createGain();
    this.volNode.channelCount = 2;
    this.volNode.channelCountMode = "explicit";
    this.volNode.channelInterpretation = "speakers";

    this.output = context.createGain();
    this.output.channelCount = 2;
    this.output.channelCountMode = "explicit";
    this.output.channelInterpretation = "speakers";

    this.input.connect(this.preFaderNode);
    this.preFaderNode.connect(this.panner);
    this.panner.connect(this.volNode);
    this.volNode.connect(this.output);

    this.updateVolume();
    this.updatePan();
  }

  public setPan(p: number) {
    this._pan = Math.max(-1, Math.min(1, p));
    this.updatePan();
  }

  public setVolume(db: number) {
    this._volumeDb = db;
    this.updateVolume();
  }

  public setMute(muted: boolean) {
    this._muted = muted;
    this.updateVolume();
  }

  public setEffects(effectSlots: EffectSlot[]) {
    const activeSlots = (effectSlots || []).filter(s => s && s.type && !s.bypassed);

    // Check if structure matches current active instances
    const currentTypes = this.activeEffectInstances.map(i => i.type);
    const newTypes = activeSlots.map(s => s.type!);

    const isSameStructure =
      currentTypes.length === newTypes.length &&
      currentTypes.every((t, idx) => t === newTypes[idx]);

    if (isSameStructure && activeSlots.length > 0) {
      // Smoothly update parameters without rebuilding audio graph
      activeSlots.forEach((slot, slotIdx) => {
        const instance = this.activeEffectInstances[slotIdx];
        if (!instance) return;

        if (slot.type === 'Compressor' && instance.nodes.length >= 2) {
          const comp = instance.nodes[0] as Tone.Compressor;
          const gainNode = instance.nodes[1] as Tone.Volume;
          const p = slot.params || {};
          const thresh = Math.max(-100, Math.min(0, p.threshold ?? -20));
          const rat = Math.max(1, Math.min(20, p.ratio ?? 4));
          const att = Math.max(0.0001, Math.min(0.999, (p.attack ?? 10) / 1000));
          const rel = Math.max(0.001, Math.min(0.999, (p.release ?? 100) / 1000));
          const outGain = Math.max(-60, Math.min(24, p.output ?? 0));

          if (comp) {
            if (comp.threshold) comp.threshold.value = thresh;
            if (comp.ratio) comp.ratio.value = rat;
            if (comp.attack) comp.attack.value = att;
            if (comp.release) comp.release.value = rel;
          }
          if (gainNode && gainNode.volume) {
            gainNode.volume.value = outGain;
          }
        } else if (slot.type === 'EQ' && instance.nodes.length >= 5) {
          const p = slot.params || {};
          const filterTypes: BiquadFilterType[] = ['peaking', 'highpass', 'lowpass', 'lowshelf', 'highshelf'];
          const defaultTypes: BiquadFilterType[] = ['highpass', 'peaking', 'peaking', 'peaking', 'lowpass'];
          const defaultFreqs = [40, 250, 1000, 4000, 15000];

          for (let b = 1; b <= 5; b++) {
            const filter = instance.nodes[b - 1] as Tone.BiquadFilter;
            if (!filter) continue;

            let targetType: BiquadFilterType = defaultTypes[b - 1];
            if (typeof (p as any)[`b${b}_type_str`] === 'string') {
              targetType = (p as any)[`b${b}_type_str`] as BiquadFilterType;
            } else if (typeof p[`b${b}_type`] === 'number') {
              targetType = filterTypes[p[`b${b}_type`]] || defaultTypes[b - 1];
            }

            const freq = p[`b${b}_freq`] ?? defaultFreqs[b - 1];
            const gain = p[`b${b}_gain`] ?? 0;
            const q = p[`b${b}_q`] ?? (targetType === 'highpass' || targetType === 'lowpass' ? 0.707 : 1.0);
            const bypassed = p[`b${b}_bypass`] === 1;

            if (filter.type !== targetType) {
              filter.type = targetType;
            }
            if (filter.frequency) filter.frequency.value = Math.max(20, Math.min(20000, freq));
            if (filter.gain) filter.gain.value = bypassed ? 0 : Math.max(-24, Math.min(24, gain));
            if (filter.Q) filter.Q.value = Math.max(0.1, Math.min(18, q));
          }
        } else if (slot.type === 'Limiter' && instance.nodes.length >= 4) {
          const inputDrive = instance.nodes[0] as Tone.Volume;
          const dist = instance.nodes[1] as Tone.Distortion;
          const limiter = instance.nodes[2] as Tone.Compressor;
          const hardClipper = instance.nodes[3] as Tone.WaveShaper;

          const p = slot.params || {};
          const ceiling = Math.max(-60, Math.min(-0.01, p.ceiling ?? -0.5));
          const drive = Math.max(-24, Math.min(24, p.drive ?? 4.0));
          const release = Math.max(0.005, Math.min(0.999, (p.release ?? 50) / 1000));
          const sat = Math.max(0, Math.min(0.999, (p.diodeSat ?? 15) / 100));
          const truePeak = p.truePeak ?? 1;

          if (inputDrive && inputDrive.volume) {
            inputDrive.volume.value = drive;
          }
          if (dist) {
            dist.distortion = Math.max(0.001, Math.min(0.999, sat * 0.8));
            if (dist.wet) dist.wet.value = Math.max(0, Math.min(0.999, sat));
          }
          if (limiter) {
            if (limiter.threshold) limiter.threshold.value = ceiling;
            if (limiter.release) limiter.release.value = release;
          }
          if (hardClipper) {
            const limitLinear = Math.pow(10, ceiling / 20);
            hardClipper.curve = createLimiterCurve(limitLinear, truePeak);
          }
        } else if (slot.type === 'Reverb' && instance.nodes.length >= 1) {
          const reverbNode = instance.nodes[0] as ProReverbNode;
          if (reverbNode && typeof reverbNode.setParams === 'function') {
            reverbNode.setParams(slot.params || {});
          }
        } else if (slot.type === 'Delay' && instance.nodes.length >= 6) {
          const lowCutFilter = instance.nodes[1] as Tone.BiquadFilter;
          const toneFilter = instance.nodes[2] as Tone.BiquadFilter;
          const distNode = instance.nodes[3] as Tone.Distortion;
          const delayNode = instance.nodes[4] as Tone.FeedbackDelay;
          const outputVol = instance.nodes[5] as Tone.Volume;

          const p = slot.params || {};
          const lowCut = p.lowCut ?? 0;
          const tone = p.tone ?? 5.0;
          const drive = p.drive ?? 0;
          const timeMs = p.time ?? 240;
          const feedback = p.feedback ?? 40;
          const wetMix = p.wetMix ?? 50;
          const outGain = p.outGain ?? 0;

          if (lowCutFilter && lowCutFilter.frequency) {
            lowCutFilter.frequency.value = lowCut === 1 ? 200 : 20;
          }
          if (toneFilter && toneFilter.frequency) {
            const toneFreq = 1000 + (tone / 10) * 15000;
            toneFilter.frequency.value = Math.max(200, Math.min(20000, toneFreq));
          }
          if (distNode) {
            distNode.distortion = drive === 1 ? 0.35 : 0.001;
            if (distNode.wet) distNode.wet.value = drive === 1 ? 0.6 : 0;
          }
          if (delayNode) {
            if (delayNode.delayTime) delayNode.delayTime.value = Math.max(0.001, Math.min(2.0, timeMs / 1000));
            if (delayNode.feedback) delayNode.feedback.value = Math.max(0, Math.min(0.95, feedback / 100));
            if (delayNode.wet) delayNode.wet.value = Math.max(0, Math.min(0.999, wetMix / 100));
          }
          if (outputVol && outputVol.volume) {
            outputVol.volume.value = outGain;
          }
        } else if (slot.type === 'Saturator' && instance.nodes.length >= 1) {
          const satNode = instance.nodes[0] as SaturationNode;
          if (satNode && typeof satNode.update === 'function') {
            const p = slot.params || {};
            const modeKeys: SaturationMode[] = ['clean', 'normal', 'hot', 'redline'];
            const mode = modeKeys[p.modeIndex ?? 1] || 'normal';
            satNode.update({
              inputGain: p.inputGain ?? 0,
              saturationDrive: p.saturationDrive ?? 3.0,
              saturationMode: mode,
              outputGain: p.outputGain ?? 0,
            });
          }
        } else if (slot.type === 'Pitchy' && instance.nodes.length >= 1) {
          const pitchNode = instance.nodes[0] as PitchyNode;
          if (pitchNode && typeof pitchNode.update === 'function') {
            const p = slot.params || {};
            pitchNode.update({
              referenceHz: p.referenceHz ?? 440.0,
              speed: p.speed ?? 75,
              humanize: p.humanize ?? 20,
              transition: p.transition ?? 30,
              color: p.color ?? 50,
              mode: p.modeHQ === 1 ? 'hq' : 'realtime',
            });
          }
        }
      });
      return;
    }

    // Dispose previous effects
    this.activeEffectInstances.forEach(inst => {
      inst.nodes.forEach(node => {
        try {
          if (node && typeof node.dispose === 'function') {
            node.dispose();
          } else if (node && typeof node.disconnect === 'function') {
            node.disconnect();
          }
        } catch {
          // ignore
        }
      });
    });
    this.effectsNodes = [];
    this.activeEffectInstances = [];

    try {
      this.input.disconnect();
    } catch {
      // ignore
    }
    try {
      this.preFaderNode.disconnect();
    } catch {
      // ignore
    }

    if (this.preFaderNode) {
      try {
        Tone.connect(this.preFaderNode, this.preFaderMeter);
        Tone.connect(this.preFaderNode, this.fft);
        Tone.connect(this.preFaderNode, this.panner);
      } catch {}
    }

    if (activeSlots.length === 0) {
      Tone.connect(this.input, this.preFaderNode);
      return;
    }

    const nodes: any[] = [];
    const newInstances: { type: EffectType; nodes: any[] }[] = [];

    for (const slot of activeSlots) {
      try {
        let createdNodes: any[] = [];
        switch (slot.type) {
          case 'Compressor': {
            const p = slot.params || {};
            const thresh = Math.max(-100, Math.min(0, p.threshold ?? -20));
            const rat = Math.max(1, Math.min(20, p.ratio ?? 4));
            const att = Math.max(0.0001, Math.min(0.999, (p.attack ?? 10) / 1000));
            const rel = Math.max(0.001, Math.min(0.999, (p.release ?? 100) / 1000));
            const outGain = Math.max(-60, Math.min(24, p.output ?? 0));

            const comp = new Tone.Compressor({
              threshold: thresh,
              ratio: rat,
              attack: att,
              release: rel,
              knee: 3,
            });
            const gainNode = new Tone.Volume(outGain);
            createdNodes = [comp, gainNode];
            break;
          }
          case 'EQ': {
            const p = slot.params || {};
            const filterTypes: BiquadFilterType[] = ['peaking', 'highpass', 'lowpass', 'lowshelf', 'highshelf'];
            const defaultTypes: BiquadFilterType[] = ['highpass', 'peaking', 'peaking', 'peaking', 'lowpass'];
            const defaultFreqs = [40, 250, 1000, 4000, 15000];
            const eqFilters: Tone.BiquadFilter[] = [];

            for (let b = 1; b <= 5; b++) {
              let targetType: BiquadFilterType = defaultTypes[b - 1];
              if (typeof (p as any)[`b${b}_type_str`] === 'string') {
                targetType = (p as any)[`b${b}_type_str`] as BiquadFilterType;
              } else if (typeof p[`b${b}_type`] === 'number') {
                targetType = filterTypes[p[`b${b}_type`]] || defaultTypes[b - 1];
              }

              const freq = p[`b${b}_freq`] ?? defaultFreqs[b - 1];
              const gain = p[`b${b}_gain`] ?? 0;
              const q = p[`b${b}_q`] ?? (targetType === 'highpass' || targetType === 'lowpass' ? 0.707 : 1.0);
              const bypassed = p[`b${b}_bypass`] === 1;

              const filter = new Tone.BiquadFilter({
                type: targetType,
                frequency: Math.max(20, Math.min(20000, freq)),
                gain: bypassed ? 0 : Math.max(-24, Math.min(24, gain)),
                Q: Math.max(0.1, Math.min(18, q)),
              });
              eqFilters.push(filter);
            }

            createdNodes = eqFilters;
            break;
          }
          case 'Reverb': {
            const rawCtx = Tone.getContext().rawContext;
            const reverbNode = new ProReverbNode(rawCtx, slot.params || {});
            createdNodes = [reverbNode];
            break;
          }
          case 'Delay': {
            const p = slot.params || {};
            const lowCut = p.lowCut ?? 0;
            const tone = p.tone ?? 5.0;
            const drive = p.drive ?? 0;
            const timeMs = p.time ?? 240;
            const feedback = p.feedback ?? 40;
            const wetMix = p.wetMix ?? 50;
            const outGain = p.outGain ?? 0;

            const inputVol = new Tone.Volume(0);
            const lowCutFilter = new Tone.BiquadFilter({
              type: 'highpass',
              frequency: lowCut === 1 ? 200 : 20,
            });
            const toneFilter = new Tone.BiquadFilter({
              type: 'lowpass',
              frequency: Math.max(200, Math.min(20000, 1000 + (tone / 10) * 15000)),
            });
            const distNode = new Tone.Distortion({
              distortion: drive === 1 ? 0.35 : 0.001,
              wet: drive === 1 ? 0.6 : 0,
            });
            const delayNode = new Tone.FeedbackDelay({
              delayTime: Math.max(0.001, Math.min(2.0, timeMs / 1000)),
              feedback: Math.max(0, Math.min(0.95, feedback / 100)),
              wet: Math.max(0, Math.min(0.999, wetMix / 100)),
            });
            const outputVol = new Tone.Volume(outGain);

            createdNodes = [inputVol, lowCutFilter, toneFilter, distNode, delayNode, outputVol];
            break;
          }
          case 'Limiter': {
            const p = slot.params || {};
            const ceiling = Math.max(-60, Math.min(-0.01, p.ceiling ?? -0.5));
            const drive = Math.max(-24, Math.min(24, p.drive ?? 4.0));
            const release = Math.max(0.005, Math.min(0.999, (p.release ?? 50) / 1000));
            const sat = Math.max(0, Math.min(0.999, (p.diodeSat ?? 15) / 100));
            const truePeak = p.truePeak ?? 1;

            const inputDrive = new Tone.Volume(drive);
            const dist = new Tone.Distortion({
              distortion: Math.max(0.001, Math.min(0.999, sat * 0.8)),
              wet: Math.max(0, Math.min(0.999, sat)),
            });
            const limiter = new Tone.Compressor({
              threshold: ceiling,
              ratio: 20,
              attack: 0.001,
              release: release,
              knee: 0,
            });
            const limitLinear = Math.pow(10, ceiling / 20);
            const hardClipper = new Tone.WaveShaper({
              curve: createLimiterCurve(limitLinear, truePeak),
            });

            createdNodes = [inputDrive, dist, limiter, hardClipper];
            break;
          }
          case 'Saturator': {
            const p = slot.params || {};
            const modeKeys: SaturationMode[] = ['clean', 'normal', 'hot', 'redline'];
            const mode = modeKeys[p.modeIndex ?? 1] || 'normal';
            const satNode = new SaturationNode({
              inputGain: p.inputGain ?? 0,
              saturationDrive: p.saturationDrive ?? 3.0,
              saturationMode: mode,
              outputGain: p.outputGain ?? 0,
            });
            createdNodes = [satNode];
            break;
          }
          case 'Pitchy': {
            const p = slot.params || {};
            const pitchNode = new PitchyNode({
              referenceHz: p.referenceHz ?? 440.0,
              speed: p.speed ?? 75,
              humanize: p.humanize ?? 20,
              transition: p.transition ?? 30,
              color: p.color ?? 50,
              mode: p.modeHQ === 1 ? 'hq' : 'realtime',
            });
            createdNodes = [pitchNode];
            break;
          }
        }

        if (createdNodes.length > 0) {
          nodes.push(...createdNodes);
          newInstances.push({ type: slot.type!, nodes: createdNodes });
        }
      } catch (e) {
        console.warn('Effect creation failed:', slot.type, e);
      }
    }

    this.effectsNodes = nodes;
    this.activeEffectInstances = newInstances;

    if (nodes.length === 0) {
      try {
        Tone.connect(this.input, this.preFaderNode);
      } catch {}
      return;
    }

    try {
      Tone.connect(this.input, nodes[0]);
      for (let i = 0; i < nodes.length - 1; i++) {
        Tone.connect(nodes[i], nodes[i + 1]);
      }
      Tone.connect(nodes[nodes.length - 1], this.preFaderNode);
    } catch (err) {
      console.warn('Error connecting effect chain nodes:', err);
      try {
        Tone.connect(this.input, this.preFaderNode);
      } catch {}
    }
  }

  private updateVolume() {
    if (this._muted || this._volumeDb <= -59.5) {
      this.volNode.gain.value = 0;
    } else {
      this.volNode.gain.value = Math.pow(10, this._volumeDb / 20);
    }
  }

  private updatePan() {
    this.panner.pan.value = this._pan;
  }

  public connect(destination: any) {
    Tone.connect(this.output, destination);
    return this;
  }

  public dispose() {
    try {
      if (this.preFaderMeter) {
        try {
          this.preFaderMeter.dispose();
        } catch {}
      }
      if (this.fft) {
        try {
          this.fft.dispose();
        } catch {}
      }
      this.effectsNodes.forEach(node => {
        try {
          if (node && typeof node.dispose === 'function') {
            node.dispose();
          } else if (node && typeof node.disconnect === 'function') {
            node.disconnect();
          }
        } catch {}
      });
      this.input.disconnect();
      this.preFaderNode.disconnect();
      this.panner.disconnect();
      this.volNode.disconnect();
      this.output.disconnect();
    } catch {
      // ignore
    }
  }
}

export function useAudioEngine() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [transportState, setTransportState] = useState<TransportState>('stopped');
  const [currentTime, setCurrentTime] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  // BPM & Metronome state
  const [bpm, setBpmState] = useState<number>(120);
  const [metronomeEnabled, setMetronomeEnabledState] = useState<boolean>(false);
  const [currentBeat, setCurrentBeat] = useState<number>(0);

  const metronomeEnabledRef = useRef<boolean>(false);
  const bpmRef = useRef<number>(120);

  // Use refs for Tone objects to keep track of them without triggering re-renders
  const masterChannelRef = useRef<StereoChannel | null>(null);
  const channelsRef = useRef<Map<string, StereoChannel>>(new Map());
  const playersRef = useRef<Map<string, Tone.Player[]>>(new Map());
  const analysersRef = useRef<Map<string, { meter: Tone.Meter, fft: Tone.Analyser }>>(new Map());
  const masterAnalyserRef = useRef<{ meter: Tone.Meter, fft: Tone.Analyser } | null>(null);

  const [masterParams, setMasterParams] = useState<{ volume: number; pan: number; effects: EffectSlot[] }>({
    volume: 0,
    pan: 0,
    effects: createDefaultEffects(),
  });

  const setBpm = useCallback((newBpm: number) => {
    const clampedBpm = Math.max(60, Math.min(300, Math.round(newBpm)));
    setBpmState(clampedBpm);
    bpmRef.current = clampedBpm;
    if (typeof Tone !== 'undefined' && Tone.Transport) {
      Tone.Transport.bpm.value = clampedBpm;
    }
  }, []);

  const toggleMetronome = useCallback(() => {
    setMetronomeEnabledState(prev => {
      const next = !prev;
      metronomeEnabledRef.current = next;
      return next;
    });
  }, []);

  const setMetronomeEnabled = useCallback((enabled: boolean) => {
    setMetronomeEnabledState(enabled);
    metronomeEnabledRef.current = enabled;
  }, []);

  const init = useCallback(async () => {
    if (isInitialized) return;
    try {
      await Tone.start();
      console.log('Tone.js started, context state:', Tone.context.state);
      
      if (Tone.context.state !== 'running') {
        await Tone.context.resume();
      }

      // Sync initial BPM to Tone.Transport
      Tone.Transport.bpm.value = bpmRef.current;

      // Metronome Click repeat schedule
      Tone.Transport.scheduleRepeat((time) => {
        const ticks = Tone.Transport.ticks;
        const ppq = Tone.Transport.PPQ || 192;
        const beat = Math.floor(Math.round(ticks / ppq)) % 4;
        setCurrentBeat(beat);

        if (metronomeEnabledRef.current) {
          const rawCtx = Tone.context.rawContext;
          if (rawCtx) {
            try {
              const osc = rawCtx.createOscillator();
              const gain = rawCtx.createGain();

              const isFirstBeat = (beat === 0);
              const freq = isFirstBeat ? 1760 : 980;
              const vol = isFirstBeat ? 0.85 : 0.60;

              osc.type = 'triangle';
              osc.frequency.setValueAtTime(freq, time);
              osc.frequency.exponentialRampToValueAtTime(freq * 0.5, time + 0.04);

              gain.gain.setValueAtTime(vol, time);
              gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);

              osc.connect(gain);
              if (masterChannelRef.current) {
                gain.connect(masterChannelRef.current.input);
              } else {
                gain.connect(rawCtx.destination);
              }

              osc.start(time);
              osc.stop(time + 0.05);
            } catch (err) {
              console.warn('Metronome click play error:', err);
            }
          }
        }
      }, "4n");

      // Initialize Master Channel with True Stereo Panner
      const masterChannel = new StereoChannel(Tone.context.rawContext);
      masterChannel.connect(Tone.getDestination());

      const masterMeter = new Tone.Meter({ channelCount: 2 });
      masterChannel.connect(masterMeter);
      
      masterChannelRef.current = masterChannel;
      masterAnalyserRef.current = { meter: masterMeter, fft: masterChannel.fft, preFaderMeter: masterChannel.preFaderMeter };

      const initialTracks: Track[] = Array.from({ length: INITIAL_TRACK_COUNT }).map((_, i) => ({
        id: crypto.randomUUID(),
        name: `Track ${i + 1}`,
        color: COLORS[i % COLORS.length],
        clips: [],
        muted: false,
        soloed: false,
        volume: 0,
        pan: 0,
        effects: createDefaultEffects(),
      }));

      initialTracks.forEach(track => {
        const channel = new StereoChannel(Tone.context.rawContext);
        channel.connect(masterChannel.input);
        
        const meter = new Tone.Meter({ channelCount: 2 });
        channel.connect(meter);
        
        channelsRef.current.set(track.id, channel);
        analysersRef.current.set(track.id, { meter, fft: channel.fft, preFaderMeter: channel.preFaderMeter });
      });

      setTracks(initialTracks);
      setIsInitialized(true);
    } catch (err) {
      console.error('Failed to initialize audio engine:', err);
    }
  }, [isInitialized]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (Tone.Transport.state === 'started') {
        setCurrentTime(Tone.Transport.seconds);
      }
    }, 50);
    return () => clearInterval(interval);
  }, []);

  const addTrack = useCallback(() => {
    if (tracks.length >= 25) return;
    const id = crypto.randomUUID();
    const newTrack: Track = {
      id,
      name: `Track ${tracks.length + 1}`,
      color: COLORS[tracks.length % COLORS.length],
      clips: [],
      muted: false,
      soloed: false,
      volume: 0,
      pan: 0,
      effects: createDefaultEffects(),
    };

    if (masterChannelRef.current) {
      const channel = new StereoChannel(Tone.context.rawContext);
      channel.connect(masterChannelRef.current.input);
      const meter = new Tone.Meter({ channelCount: 2 });

      channel.connect(meter);

      const hasSolo = tracks.some(t => t.soloed);
      const isAudible = hasSolo ? (newTrack.soloed && !newTrack.muted) : !newTrack.muted;
      channel.setMute(!isAudible);

      channelsRef.current.set(id, channel);
      analysersRef.current.set(id, { meter, fft: channel.fft, preFaderMeter: channel.preFaderMeter });
      setTracks(prev => [...prev, newTrack]);
    }
  }, [tracks]);

  const removeTrack = useCallback((trackId: string) => {
    const channel = channelsRef.current.get(trackId);
    if (channel) {
      try {
        channel.dispose();
      } catch (e) {
        // ignore
      }
      channelsRef.current.delete(trackId);
    }
    const players = playersRef.current.get(trackId);
    if (players) {
      players.forEach(p => {
        try {
          p.stop();
          p.unsync();
          p.dispose();
        } catch (e) {
          // ignore
        }
      });
      playersRef.current.delete(trackId);
    }
    const data = analysersRef.current.get(trackId);
    if (data) {
      try {
        data.meter.dispose();
      } catch (e) {
        // ignore
      }
      analysersRef.current.delete(trackId);
    }

    setTracks(prev => {
      const nextTracks = prev.filter(t => t.id !== trackId);
      const hasSolo = nextTracks.some(t => t.soloed);
      nextTracks.forEach(t => {
        const ch = channelsRef.current.get(t.id);
        if (ch) {
          const isAudible = hasSolo ? (t.soloed && !t.muted) : !t.muted;
          ch.setMute(!isAudible);
        }
      });
      return nextTracks;
    });
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
    setTransportState('stopped');
  }, []);

  const seek = useCallback((time: number) => {
    Tone.Transport.seconds = Math.max(0, time);
    setCurrentTime(Tone.Transport.seconds);
  }, []);

  const updateTrackName = useCallback((trackId: string, name: string) => {
    setTracks(prev => prev.map(t => t.id === trackId ? { ...t, name } : t));
  }, []);

  const uploadClip = useCallback(async (trackId: string, file: File) => {
    const url = URL.createObjectURL(file);
    const buffer = await new Tone.ToneAudioBuffer().load(url);
    
    const clipId = crypto.randomUUID();
    const newClip: AudioClip = {
      id: clipId,
      name: file.name,
      url,
      startTime: Tone.Transport.seconds,
      duration: buffer.duration,
      buffer: buffer.get(),
    };

    // Create player
    const player = new Tone.Player(buffer).sync().start(newClip.startTime);
    const channel = channelsRef.current.get(trackId);
    if (channel) {
      player.connect(channel.input);
    }

    const existingPlayers = playersRef.current.get(trackId) || [];
    playersRef.current.set(trackId, [...existingPlayers, player]);

    setTracks(prev => prev.map(t => 
      t.id === trackId ? { ...t, clips: [...t.clips, newClip] } : t
    ));
  }, []);

  const updateClipPosition = useCallback((trackId: string, clipId: string, newStartTime: number) => {
    setTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        const clips = t.clips.map(c => {
          if (c.id === clipId) {
            // Update Tone Player synchronization safely
            const players = playersRef.current.get(trackId);
            const clipIndex = t.clips.findIndex(item => item.id === clipId);
            if (players && players[clipIndex]) {
              const player = players[clipIndex];
              // Stop, unsync and restart to avoid scheduling conflicts
              try {
                player.stop().unsync().sync().start(Math.max(0, newStartTime));
              } catch (e) {
                console.warn('Player resync failed:', e);
              }
            }
            return { ...c, startTime: Math.max(0, newStartTime) };
          }
          return c;
        });
        return { ...t, clips };
      }
      return t;
    }));
  }, []);

  const updateTrackParams = useCallback((trackId: string, params: Partial<Pick<Track, 'volume' | 'pan' | 'muted' | 'soloed'>>) => {
    setTracks(prev => {
      const nextTracks = prev.map(t => {
        if (t.id === trackId) {
          const updated = { ...t, ...params };
          const channel = channelsRef.current.get(trackId);
          if (channel) {
            if (params.volume !== undefined) channel.setVolume(updated.volume);
            if (params.pan !== undefined) channel.setPan(updated.pan);
          }
          return updated;
        }
        return t;
      });

      const hasSolo = nextTracks.some(t => t.soloed);
      nextTracks.forEach(t => {
        const channel = channelsRef.current.get(t.id);
        if (channel) {
          const isAudible = hasSolo ? (t.soloed && !t.muted) : !t.muted;
          channel.setMute(!isAudible);
        }
      });

      return nextTracks;
    });
  }, []);

  const updateTrackEffect = useCallback((trackId: string, slotIndex: number, type: EffectType | null, bypassed?: boolean, params?: Record<string, number>) => {
    setTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        const currentEffects = t.effects ? [...t.effects] : createDefaultEffects();
        while (currentEffects.length <= slotIndex) {
          currentEffects.push({ id: crypto.randomUUID(), type: null, bypassed: false });
        }
        const existing = currentEffects[slotIndex] || { id: crypto.randomUUID(), type: null, bypassed: false };
        currentEffects[slotIndex] = {
          ...existing,
          type: type !== undefined ? type : existing.type,
          bypassed: bypassed !== undefined ? bypassed : existing.bypassed,
          params: params !== undefined ? { ...(existing.params || {}), ...params } : existing.params,
        };

        const channel = channelsRef.current.get(trackId);
        if (channel) {
          channel.setEffects(currentEffects);
        }

        return { ...t, effects: currentEffects };
      }
      return t;
    }));
  }, []);

  const updateMasterParams = useCallback((_id: string, params: Partial<{ volume: number, pan: number }>) => {
    setMasterParams(prev => {
      const updated = { ...prev, ...params };
      if (masterChannelRef.current) {
        if (params.volume !== undefined) masterChannelRef.current.setVolume(params.volume);
        if (params.pan !== undefined) masterChannelRef.current.setPan(params.pan);
      }
      return updated;
    });
  }, []);

  const updateMasterEffect = useCallback((slotIndex: number, type: EffectType | null, bypassed?: boolean, params?: Record<string, number>) => {
    setMasterParams(prev => {
      const currentEffects = prev.effects ? [...prev.effects] : createDefaultEffects();
      while (currentEffects.length <= slotIndex) {
        currentEffects.push({ id: crypto.randomUUID(), type: null, bypassed: false });
      }
      const existing = currentEffects[slotIndex] || { id: crypto.randomUUID(), type: null, bypassed: false };
      currentEffects[slotIndex] = {
        ...existing,
        type: type !== undefined ? type : existing.type,
        bypassed: bypassed !== undefined ? bypassed : existing.bypassed,
        params: params !== undefined ? { ...(existing.params || {}), ...params } : existing.params,
      };

      if (masterChannelRef.current) {
        masterChannelRef.current.setEffects(currentEffects);
      }

      return { ...prev, effects: currentEffects };
    });
  }, []);

  const renderAudio = useCallback(async () => {
    if (isRendering) return;
    
    // Find the end of the last clip to determine duration
    let maxDuration = 0;
    tracks.forEach(t => {
      t.clips.forEach(c => {
        maxDuration = Math.max(maxDuration, c.startTime + c.duration);
      });
    });

    if (maxDuration === 0) {
      console.warn('Nothing to render');
      return;
    }

    setIsRendering(true);
    
    try {
      const renderLength = maxDuration + 1;
      
      const buffer = await Tone.Offline(async () => {
        const rawCtx = Tone.getContext().rawContext;
        // Create Master Bus in offline context
        const masterBus = new StereoChannel(rawCtx);
        masterBus.setVolume(masterParams.volume);
        masterBus.setPan(masterParams.pan);
        if (masterParams.effects) {
          masterBus.setEffects(masterParams.effects);
        }
        masterBus.connect(Tone.getDestination());

        const hasSolo = tracks.some(t => t.soloed);

        for (const track of tracks) {
          const isAudible = hasSolo ? (track.soloed && !track.muted) : !track.muted;
          if (!isAudible) continue;

          const channel = new StereoChannel(rawCtx);
          channel.setVolume(track.volume);
          channel.setPan(track.pan);
          if (track.effects) {
            channel.setEffects(track.effects);
          }
          channel.connect(masterBus.input);

          for (const clip of track.clips) {
            if (clip.buffer) {
              const player = new Tone.Player(clip.buffer).start(clip.startTime);
              player.connect(channel.input);
            }
          }
        }
      }, renderLength);

      const rawBuffer = (buffer as any)?.get ? buffer.get() : (buffer as unknown as AudioBuffer);
      const wav = audioBufferToWav(rawBuffer);
      const blob = new Blob([wav], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.download = `LogicGen-Rendered-${new Date().getTime()}.wav`;
      anchor.href = url;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Render failed:', err);
    } finally {
      setIsRendering(false);
    }
  }, [tracks, masterParams, isRendering]);


  const normalizeGain = useCallback((targetTrackIds?: string[], targetClipIds?: string[], targetPeakDb: number = -1) => {
    const targetPeakLinear = Math.pow(10, targetPeakDb / 20); // -1 dBFS ~ 0.89125
    let count = 0;

    setTracks(prevTracks => {
      return prevTracks.map(track => {
        const isTrackTargeted = targetTrackIds && targetTrackIds.length > 0 && targetTrackIds.includes(track.id);

        const updatedClips = track.clips.map((clip, clipIndex) => {
          const isClipTargeted = targetClipIds && targetClipIds.length > 0 && targetClipIds.includes(clip.id);

          const shouldProcess =
            isClipTargeted ||
            isTrackTargeted ||
            ((!targetClipIds || targetClipIds.length === 0) && (!targetTrackIds || targetTrackIds.length === 0));

          if (!shouldProcess || !clip.buffer) {
            return clip;
          }

          const buffer = clip.buffer as AudioBuffer;
          let maxPeak = 0;

          for (let c = 0; c < buffer.numberOfChannels; c++) {
            const channelData = buffer.getChannelData(c);
            for (let i = 0; i < channelData.length; i++) {
              const abs = Math.abs(channelData[i]);
              if (abs > maxPeak) maxPeak = abs;
            }
          }

          if (maxPeak <= 0.000001) {
            return clip; // Silent clip
          }

          const scaleFactor = targetPeakLinear / maxPeak;

          // Create normalized AudioBuffer without quality loss
          const newAudioBuffer = new AudioBuffer({
            numberOfChannels: buffer.numberOfChannels,
            length: buffer.length,
            sampleRate: buffer.sampleRate,
          });

          for (let c = 0; c < buffer.numberOfChannels; c++) {
            const srcData = buffer.getChannelData(c);
            const dstData = newAudioBuffer.getChannelData(c);
            for (let i = 0; i < srcData.length; i++) {
              dstData[i] = srcData[i] * scaleFactor;
            }
          }

          // Update existing player buffer in Tone.js
          const players = playersRef.current.get(track.id);
          if (players && players[clipIndex]) {
            try {
              if (players[clipIndex].buffer && typeof players[clipIndex].buffer.set === 'function') {
                players[clipIndex].buffer.set(newAudioBuffer);
              } else {
                players[clipIndex].buffer = new Tone.ToneAudioBuffer(newAudioBuffer);
              }
            } catch (e) {
              console.warn('Failed to update player buffer:', e);
            }
          }

          count++;
          return {
            ...clip,
            buffer: newAudioBuffer,
          };
        });

        return {
          ...track,
          clips: updatedClips,
        };
      });
    });

    return count;
  }, []);

  return {
    tracks,
    master: {
      ...masterParams,
      id: 'master', // Virtual ID for master strip
      name: 'Master',
      color: '#ffd900', // Yellow for master
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
