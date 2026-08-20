import { useCallback, useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Track, TransportState, AudioClip, EffectSlot, EffectType } from '../types/daw';
import { audioBufferToWav } from '../lib/wavEncoder';
import { ProReverbNode } from '../dsp/reverb/ProReverbNode';
import { SaturationNode, SaturationMode } from '../dsp/saturator/SaturationNode';
import { PitchyNode } from '../dsp/pitchy/PitchyNode';
import { StereoDelayNode } from '../dsp/delay/StereoDelayNode';
import { DeEsserNode } from '../dsp/deesser/DeEsserNode';

const INITIAL_TRACK_COUNT = 3;
const MAX_TRACKS = 25;
const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
const DELAY_SYNC_BEAT_FACTORS = [0.125, 0.25, 0.5, 1, 2, 4];

type AnalyserBundle = { meter: Tone.Meter; fft: Tone.Analyser; preFaderMeter: Tone.Meter };
type EffectInstance = { type: EffectType; nodes: any[] };
type TrackParamsUpdate = Partial<Pick<Track, 'volume' | 'pan' | 'muted' | 'soloed' | 'color'>>;

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

function createLimiterCurve(limitLinear: number, enabled: number, length = 2048) {
  const curve = new Float32Array(length);
  const limit = clamp(limitLinear, 0.0001, 1);
  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1;
    curve[i] = enabled === 1 ? clamp(x, -limit, limit) : clamp(x, -1, 1);
  }
  return curve;
}

export const createDefaultEffects = (): EffectSlot[] => Array.from({ length: 7 }, () => ({ id: crypto.randomUUID(), type: null, bypassed: false }));

function getAudioNodeInput(node: any): any {
  if (!node) return null;
  if (node.inputNode) return node.inputNode;
  if (node.input && typeof node.input.connect === 'function') return node.input;
  if (node._gainNode) return node._gainNode;
  return node;
}
function getAudioNodeOutput(node: any): any {
  if (!node) return null;
  if (node.outputNode) return node.outputNode;
  if (node.output && typeof node.output.connect === 'function') return node.output;
  if (node._gainNode) return node._gainNode;
  return node;
}
export function safeConnect(src: any, dst: any) {
  if (!src || !dst) return;
  try { Tone.connect(src, dst); return; } catch {}
  const out = getAudioNodeOutput(src); const input = getAudioNodeInput(dst);
  try { if (out && typeof out.connect === 'function') { out.connect(input); return; } } catch {}
  try { Tone.connect(out, input); } catch (err) { console.warn('safeConnect warning:', err); }
}
export function safeDisconnect(node: any) {
  if (!node) return;
  try { if (typeof node.disconnect === 'function') node.disconnect(); } catch {}
  try { const out = getAudioNodeOutput(node); if (out && out !== node && typeof out.disconnect === 'function') out.disconnect(); } catch {}
}

function configureStereoBus(node: any) {
  if (!node) return;
  const candidates = [node, node.input, node.output, node._gainNode];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { if ('channelCount' in candidate) candidate.channelCount = 2; } catch {}
    try { if ('channelCountMode' in candidate) candidate.channelCountMode = 'explicit'; } catch {}
    try { if ('channelInterpretation' in candidate) candidate.channelInterpretation = 'speakers'; } catch {}
  }
}

function getDelayTimeSeconds(p: Record<string, number>) {
  if ((p.syncMode ?? 0) === 1) {
    const bpm = clamp(Number(Tone.Transport.bpm.value) || 120, 20, 400);
    const i = clamp(Math.round(p.syncDivIndex ?? 2), 0, DELAY_SYNC_BEAT_FACTORS.length - 1);
    return clamp((60 / bpm) * DELAY_SYNC_BEAT_FACTORS[i], 0.005, 2);
  }
  return clamp((p.time ?? 240) / 1000, 0.005, 2);
}

function estimateEffectsTail(effects?: EffectSlot[]) {
  if (!effects) return 0;
  let total = 0;
  for (const slot of effects) {
    if (!slot?.type || slot.bypassed) continue;
    const p = slot.params || {};
    if (slot.type === 'Reverb') total += clamp(p.predelay ?? 20, 0, 250) / 1000 + clamp(p.decay ?? 2.5, 0.2, 20) * 1.15;
    else if (slot.type === 'Delay') {
      const d = getDelayTimeSeconds(p), fb = clamp((p.feedback ?? 40) / 100, 0, 0.95);
      const repeats = fb <= 0.001 ? 1 : clamp(Math.log(0.001) / Math.log(fb), 1, 80);
      total += d * repeats + 0.1;
    } else if (slot.type === 'Compressor') total += clamp((p.release ?? 100) / 1000, 0, 1);
    else if (slot.type === 'Limiter') total += clamp((p.release ?? 50) / 1000, 0, 1);
    else if (slot.type === 'DeEsser') total += clamp((p.release ?? 80) / 1000, 0, 0.5);
  }
  return clamp(total, 0, 30);
}

export class StereoChannel {
  public input = new Tone.Gain({ gain: 1 });
  public output = new Tone.Gain({ gain: 1 });
  public preFaderNode = new Tone.Gain({ gain: 1 });
  public preFaderMeter = new Tone.Meter({ channelCount: 2 });
  public fft = new Tone.Analyser({ type: 'fft', size: 128 });
  private panner = new Tone.Panner(0);
  private volNode = new Tone.Gain({ gain: 1 });
  private activeEffectInstances: EffectInstance[] = [];
  private lastEffectSlots: EffectSlot[] = [];
  private _volumeDb = 0;
  private _pan = 0;
  private _muted = false;
  private disposedInternal = false;

  constructor(_context?: BaseAudioContext) {
    // Track and master buses are explicitly stereo. Mono sources are upmixed
    // using speaker semantics at the bus boundary, while native stereo files
    // and stereo-generating effects preserve independent L/R channels.
    [this.input, this.output, this.preFaderNode, this.panner, this.volNode].forEach(configureStereoBus);

    safeConnect(this.preFaderNode, this.preFaderMeter);
    safeConnect(this.preFaderNode, this.fft);
    safeConnect(this.input, this.preFaderNode);
    safeConnect(this.preFaderNode, this.panner);
    safeConnect(this.panner, this.volNode);
    safeConnect(this.volNode, this.output);
  }

  setPan(pan: number) { this._pan = clamp(pan, -1, 1); this.panner.pan.value = this._pan; }
  setVolume(db: number) { this._volumeDb = clamp(db, -60, 6); this.updateVolume(); }
  setMute(muted: boolean) { this._muted = muted; this.updateVolume(); }
  private updateVolume() { this.volNode.gain.value = this._muted || this._volumeDb <= -59.5 ? 0 : Math.pow(10, this._volumeDb / 20); }
  refreshTempoSyncedEffects() { if (this.lastEffectSlots.length) this.setEffects(this.lastEffectSlots); }

  setEffects(effectSlots: EffectSlot[]) {
    if (this.disposedInternal) return;
    this.lastEffectSlots = (effectSlots || []).map(s => ({ ...s, params: s.params ? { ...s.params } : undefined }));
    const active = this.lastEffectSlots.filter(s => s?.type && !s.bypassed);
    const same = active.length === this.activeEffectInstances.length && active.every((s, i) => s.type === this.activeEffectInstances[i]?.type);
    if (same && active.length) { active.forEach((s, i) => this.updateEffectInstance(s, this.activeEffectInstances[i])); return; }

    this.disposeEffects();
    safeDisconnect(this.input); safeDisconnect(this.preFaderNode);
    safeConnect(this.preFaderNode, this.preFaderMeter); safeConnect(this.preFaderNode, this.fft); safeConnect(this.preFaderNode, this.panner); safeConnect(this.panner, this.volNode); safeConnect(this.volNode, this.output);
    if (!active.length) { safeConnect(this.input, this.preFaderNode); return; }

    const flat: any[] = []; const instances: EffectInstance[] = [];
    for (const slot of active) {
      try {
        const nodes = this.createEffectNodes(slot);
        // Every serial insert is explicitly stereo-preserving. This prevents a
        // generic insert after Diecho/Dipantul from collapsing an already-wide
        // signal back to mono before the pre-fader/pan/master path.
        nodes.forEach(configureStereoBus);
        if (nodes.length) { flat.push(...nodes); instances.push({ type: slot.type!, nodes }); }
      }
      catch (err) { console.warn('Effect creation failed for type:', slot.type, err); }
    }
    this.activeEffectInstances = instances;
    if (!flat.length) { safeConnect(this.input, this.preFaderNode); return; }
    safeConnect(this.input, flat[0]);
    for (let i = 0; i < flat.length - 1; i++) safeConnect(flat[i], flat[i + 1]);
    safeConnect(flat[flat.length - 1], this.preFaderNode);
  }

  private updateEffectInstance(slot: EffectSlot, instance: EffectInstance) {
    const p = slot.params || {};
    if (slot.type === 'Compressor' && instance.nodes.length >= 2) {
      const comp = instance.nodes[0] as Tone.Compressor, out = instance.nodes[1] as Tone.Volume;
      comp.threshold.value = clamp(p.threshold ?? -20, -100, 0); comp.ratio.value = clamp(p.ratio ?? 4, 1, 20); comp.attack.value = clamp((p.attack ?? 10) / 1000, 0.0001, .999); comp.release.value = clamp((p.release ?? 100) / 1000, .001, .999); out.volume.value = clamp(p.output ?? 0, -60, 24); return;
    }
    if (slot.type === 'EQ' && instance.nodes.length >= 5) {
      const types: BiquadFilterType[] = ['peaking','highpass','lowpass','lowshelf','highshelf']; const defs: BiquadFilterType[] = ['highpass','peaking','peaking','peaking','lowpass']; const freqs=[40,250,1000,4000,15000];
      for (let b=1;b<=5;b++) { const f=instance.nodes[b-1] as Tone.BiquadFilter; const desired=(typeof (p as any)[`b${b}_type_str`]==='string'?(p as any)[`b${b}_type_str`]:types[p[`b${b}_type`]])||defs[b-1]; f.type=p[`b${b}_bypass`]===1?'allpass':desired; f.frequency.value=clamp(p[`b${b}_freq`]??freqs[b-1],20,20000); f.gain.value=clamp(p[`b${b}_gain`]??0,-24,24); f.Q.value=clamp(p[`b${b}_q`]??.707,.1,18); } return;
    }
    if (slot.type === 'Reverb') { (instance.nodes[0] as ProReverbNode).setParams(p); return; }
    if (slot.type === 'Delay') { (instance.nodes[0] as StereoDelayNode).update(p); return; }
    if (slot.type === 'DeEsser') { (instance.nodes[0] as DeEsserNode).update(p); return; }
    if (slot.type === 'Limiter' && instance.nodes.length >= 4) {
      const drive=instance.nodes[0] as Tone.Volume, dist=instance.nodes[1] as Tone.Distortion, lim=instance.nodes[2] as Tone.Compressor, shaper=instance.nodes[3] as Tone.WaveShaper; const ceiling=clamp(p.ceiling??-.5,-60,-.01),sat=clamp((p.diodeSat??15)/100,0,.999),tp=p.truePeak??1; drive.volume.value=clamp(p.drive??4,-24,24);dist.distortion=clamp(sat*.8,.001,.999);dist.wet.value=sat;lim.threshold.value=ceiling;lim.release.value=clamp((p.release??50)/1000,.005,.999);shaper.curve=createLimiterCurve(Math.pow(10,ceiling/20),tp);shaper.oversample=tp===1?'4x':'none'; return;
    }
    if (slot.type === 'Saturator') { const modes:SaturationMode[]=['clean','normal','hot','redline']; (instance.nodes[0] as SaturationNode).update({inputGain:p.inputGain??0,saturationDrive:p.saturationDrive??3,saturationMode:modes[p.modeIndex??1]||'normal',outputGain:p.outputGain??0}); return; }
    if (slot.type === 'Pitchy') { (instance.nodes[0] as PitchyNode).update({referenceHz:p.referenceHz??440,speed:p.speed??75,humanize:p.humanize??20,transition:p.transition??30,color:p.color??50,mode:p.modeHQ===1?'hq':'realtime'}); }
  }

  private createEffectNodes(slot: EffectSlot): any[] {
    const p = slot.params || {};
    if (slot.type === 'Compressor') return [new Tone.Compressor({threshold:clamp(p.threshold??-20,-100,0),ratio:clamp(p.ratio??4,1,20),attack:clamp((p.attack??10)/1000,.0001,.999),release:clamp((p.release??100)/1000,.001,.999),knee:3}),new Tone.Volume(clamp(p.output??0,-60,24))];
    if (slot.type === 'EQ') { const types:BiquadFilterType[]=['peaking','highpass','lowpass','lowshelf','highshelf'];const defs:BiquadFilterType[]=['highpass','peaking','peaking','peaking','lowpass'];const freqs=[40,250,1000,4000,15000];return Array.from({length:5},(_,i)=>{const b=i+1;const desired=(typeof (p as any)[`b${b}_type_str`]==='string'?(p as any)[`b${b}_type_str`]:types[p[`b${b}_type`]])||defs[i];return new Tone.BiquadFilter({type:p[`b${b}_bypass`]===1?'allpass':desired,frequency:clamp(p[`b${b}_freq`]??freqs[i],20,20000),gain:clamp(p[`b${b}_gain`]??0,-24,24),Q:clamp(p[`b${b}_q`]??.707,.1,18)});}); }
    if (slot.type === 'Reverb') return [new ProReverbNode(Tone.getContext().rawContext,p)];
    if (slot.type === 'Delay') return [new StereoDelayNode(p)];
    if (slot.type === 'DeEsser') return [new DeEsserNode(p)];
    if (slot.type === 'Limiter') { const ceiling=clamp(p.ceiling??-.5,-60,-.01),sat=clamp((p.diodeSat??15)/100,0,.999),tp=p.truePeak??1;const shaper=new Tone.WaveShaper({curve:createLimiterCurve(Math.pow(10,ceiling/20),tp)});shaper.oversample=tp===1?'4x':'none';return [new Tone.Volume(clamp(p.drive??4,-24,24)),new Tone.Distortion({distortion:clamp(sat*.8,.001,.999),wet:sat}),new Tone.Compressor({threshold:ceiling,ratio:20,attack:.001,release:clamp((p.release??50)/1000,.005,.999),knee:0}),shaper]; }
    if (slot.type === 'Saturator') { const modes:SaturationMode[]=['clean','normal','hot','redline']; return [new SaturationNode({inputGain:p.inputGain??0,saturationDrive:p.saturationDrive??3,saturationMode:modes[p.modeIndex??1]||'normal',outputGain:p.outputGain??0})]; }
    if (slot.type === 'Pitchy') return [new PitchyNode({referenceHz:p.referenceHz??440,speed:p.speed??75,humanize:p.humanize??20,transition:p.transition??30,color:p.color??50,mode:p.modeHQ===1?'hq':'realtime'})];
    return [];
  }

  private disposeEffects() { this.activeEffectInstances.forEach(inst=>inst.nodes.forEach(node=>{try{safeDisconnect(node);if(node&&typeof node.dispose==='function')node.dispose();}catch{}})); this.activeEffectInstances=[]; }
  connect(destination:any){safeConnect(this.output,destination);return this;}
  dispose(){if(this.disposedInternal)return;this.disposedInternal=true;this.disposeEffects();this.lastEffectSlots=[];try{this.preFaderMeter.dispose();}catch{}try{this.fft.dispose();}catch{}[this.input,this.preFaderNode,this.panner,this.volNode,this.output].forEach(n=>{try{safeDisconnect(n);}catch{}try{n.dispose();}catch{}});}
}

export function useAudioEngine() {
  const [tracks,setTracks]=useState<Track[]>([]); const [transportState,setTransportState]=useState<TransportState>('stopped'); const [currentTime,setCurrentTime]=useState(0); const [isInitialized,setIsInitialized]=useState(false); const [isRendering,setIsRendering]=useState(false); const [bpm,setBpmState]=useState(120); const [metronomeEnabled,setMetronomeEnabledState]=useState(false); const [currentBeat,setCurrentBeat]=useState(0);
  const tracksRef=useRef<Track[]>([]),bpmRef=useRef(120),metronomeEnabledRef=useRef(false),initializingRef=useRef(false),metronomeEventIdRef=useRef<number|null>(null);
  const masterChannelRef=useRef<StereoChannel|null>(null),channelsRef=useRef(new Map<string,StereoChannel>()),playersRef=useRef(new Map<string,Tone.Player[]>()),analysersRef=useRef(new Map<string,AnalyserBundle>()),masterAnalyserRef=useRef<AnalyserBundle|null>(null);
  const [masterParams,setMasterParams]=useState<{volume:number;pan:number;effects:EffectSlot[]}>({volume:0,pan:0,effects:createDefaultEffects()});
  useEffect(()=>{tracksRef.current=tracks;},[tracks]);

  const setBpm=useCallback((v:number)=>{const n=clamp(Math.round(v),60,300);bpmRef.current=n;setBpmState(n);Tone.Transport.bpm.value=n;channelsRef.current.forEach(c=>c.refreshTempoSyncedEffects());masterChannelRef.current?.refreshTempoSyncedEffects();},[]);
  const toggleMetronome=useCallback(()=>setMetronomeEnabledState(prev=>{const n=!prev;metronomeEnabledRef.current=n;return n;}),[]);
  const setMetronomeEnabled=useCallback((v:boolean)=>{metronomeEnabledRef.current=v;setMetronomeEnabledState(v);},[]);
  const createTrackAudioNodes=useCallback((track:Track,master:StereoChannel)=>{const c=new StereoChannel();c.setVolume(track.volume);c.setPan(track.pan);c.setEffects(track.effects||createDefaultEffects());c.connect(master.input);const meter=new Tone.Meter({channelCount:2});c.connect(meter);channelsRef.current.set(track.id,c);analysersRef.current.set(track.id,{meter,fft:c.fft,preFaderMeter:c.preFaderMeter});},[]);

  const init=useCallback(async()=>{if(isInitialized||initializingRef.current)return;initializingRef.current=true;try{await Tone.start();if(Tone.context.state!=='running')await Tone.context.resume();configureStereoBus(Tone.getDestination());Tone.Transport.bpm.value=bpmRef.current;if(metronomeEventIdRef.current===null){metronomeEventIdRef.current=Tone.Transport.scheduleRepeat((time)=>{const beat=Math.floor(Math.round(Tone.Transport.ticks/(Tone.Transport.PPQ||192)))%4;setCurrentBeat(beat);if(!metronomeEnabledRef.current)return;const raw=Tone.getContext().rawContext;const osc=raw.createOscillator(),gain=raw.createGain();osc.type='triangle';osc.frequency.setValueAtTime(beat===0?1760:980,time);gain.gain.setValueAtTime(beat===0?.85:.6,time);gain.gain.exponentialRampToValueAtTime(.0001,time+.045);osc.connect(gain);if(masterChannelRef.current)gain.connect(masterChannelRef.current.input.input as AudioNode);else gain.connect(raw.destination);osc.start(time);osc.stop(time+.05);},'4n');}
   const master=new StereoChannel();master.setVolume(masterParams.volume);master.setPan(masterParams.pan);master.setEffects(masterParams.effects);master.connect(Tone.getDestination());const meter=new Tone.Meter({channelCount:2});master.connect(meter);masterChannelRef.current=master;masterAnalyserRef.current={meter,fft:master.fft,preFaderMeter:master.preFaderMeter};const initial=Array.from({length:INITIAL_TRACK_COUNT},(_,i):Track=>({id:crypto.randomUUID(),name:`Track ${i+1}`,color:COLORS[i%COLORS.length],clips:[],muted:false,soloed:false,volume:0,pan:0,effects:createDefaultEffects()}));initial.forEach(t=>createTrackAudioNodes(t,master));tracksRef.current=initial;setTracks(initial);setIsInitialized(true);}catch(err){console.error('Failed to initialize audio engine:',err);}finally{initializingRef.current=false;}},[createTrackAudioNodes,isInitialized,masterParams]);

  useEffect(()=>{const id=window.setInterval(()=>{if(Tone.Transport.state==='started')setCurrentTime(Tone.Transport.seconds);},50);return()=>window.clearInterval(id);},[]);
  useEffect(()=>()=>{if(metronomeEventIdRef.current!==null){try{Tone.Transport.clear(metronomeEventIdRef.current);}catch{}metronomeEventIdRef.current=null;}tracksRef.current.forEach(t=>t.clips.forEach(c=>{if(c.url?.startsWith('blob:'))URL.revokeObjectURL(c.url);}));playersRef.current.forEach(ps=>ps.forEach(p=>{try{p.stop();p.unsync();p.dispose();}catch{}}));analysersRef.current.forEach(a=>{try{a.meter.dispose();}catch{}});channelsRef.current.forEach(c=>c.dispose());try{masterAnalyserRef.current?.meter.dispose();}catch{}masterChannelRef.current?.dispose();},[]);

  const addTrack=useCallback(()=>{if(tracksRef.current.length>=MAX_TRACKS||!masterChannelRef.current)return;const id=crypto.randomUUID();const t:Track={id,name:`Track ${tracksRef.current.length+1}`,color:COLORS[tracksRef.current.length%COLORS.length],clips:[],muted:false,soloed:false,volume:0,pan:0,effects:createDefaultEffects()};createTrackAudioNodes(t,masterChannelRef.current);const next=[...tracksRef.current,t];tracksRef.current=next;setTracks(next);},[createTrackAudioNodes]);
  const removeTrack=useCallback((id:string)=>{const old=tracksRef.current.find(t=>t.id===id);old?.clips.forEach(c=>{if(c.url?.startsWith('blob:'))URL.revokeObjectURL(c.url);});channelsRef.current.get(id)?.dispose();channelsRef.current.delete(id);playersRef.current.get(id)?.forEach(p=>{try{p.stop();p.unsync();p.dispose();}catch{}});playersRef.current.delete(id);try{analysersRef.current.get(id)?.meter.dispose();}catch{}analysersRef.current.delete(id);const next=tracksRef.current.filter(t=>t.id!==id);const solo=next.some(t=>t.soloed);next.forEach(t=>channelsRef.current.get(t.id)?.setMute(!(solo?t.soloed&&!t.muted:!t.muted)));tracksRef.current=next;setTracks(next);},[]);
  const togglePlay=useCallback(()=>{if(Tone.Transport.state==='started'){Tone.Transport.pause();setTransportState('paused');}else{Tone.Transport.start();setTransportState('started');}},[]);
  const stop=useCallback(()=>{Tone.Transport.stop();setCurrentTime(0);setCurrentBeat(0);setTransportState('stopped');},[]);
  const seek=useCallback((t:number)=>{Tone.Transport.seconds=Math.max(0,t);setCurrentTime(Tone.Transport.seconds);},[]);
  const updateTrackName=useCallback((id:string,name:string)=>{const next=tracksRef.current.map(t=>t.id===id?{...t,name}:t);tracksRef.current=next;setTracks(next);},[]);
  const uploadClip=useCallback(async(id:string,file:File)=>{const url=URL.createObjectURL(file);try{const tb=await new Tone.ToneAudioBuffer().load(url);const c=channelsRef.current.get(id);if(!c){URL.revokeObjectURL(url);return;}const clip:AudioClip={id:crypto.randomUUID(),name:file.name,url,startTime:Tone.Transport.seconds,duration:tb.duration,buffer:tb.get()};const player=new Tone.Player(tb).sync().start(clip.startTime);player.connect(c.input);playersRef.current.set(id,[...(playersRef.current.get(id)||[]),player]);const next=tracksRef.current.map(t=>t.id===id?{...t,clips:[...t.clips,clip]}:t);tracksRef.current=next;setTracks(next);}catch(err){URL.revokeObjectURL(url);console.error('Failed to load audio clip:',err);}},[]);
  const updateClipPosition=useCallback((tid:string,cid:string,start:number)=>{const s=Math.max(0,start);const next=tracksRef.current.map(t=>{if(t.id!==tid)return t;const idx=t.clips.findIndex(c=>c.id===cid);const player=playersRef.current.get(tid)?.[idx];if(player){try{player.stop();player.unsync();player.sync().start(s);}catch{}}return{...t,clips:t.clips.map(c=>c.id===cid?{...c,startTime:s}:c)};});tracksRef.current=next;setTracks(next);},[]);
  const updateTrackParams=useCallback((id:string,params:TrackParamsUpdate)=>{const next=tracksRef.current.map(t=>{if(t.id!==id)return t;const u={...t,...params};const c=channelsRef.current.get(id);if(c){if(params.volume!==undefined)c.setVolume(u.volume);if(params.pan!==undefined)c.setPan(u.pan);}return u;});const solo=next.some(t=>t.soloed);next.forEach(t=>channelsRef.current.get(t.id)?.setMute(!(solo?t.soloed&&!t.muted:!t.muted)));tracksRef.current=next;setTracks(next);},[]);
  const updateTrackEffect=useCallback((id:string,index:number,type:EffectType|null,bypassed?:boolean,params?:Record<string,number>)=>{const next=tracksRef.current.map(t=>{if(t.id!==id)return t;const fx=t.effects?[...t.effects]:createDefaultEffects();while(fx.length<=index)fx.push({id:crypto.randomUUID(),type:null,bypassed:false});const old=fx[index];fx[index]={...old,type,bypassed:bypassed!==undefined?bypassed:old.bypassed,params:params!==undefined?{...(old.params||{}),...params}:old.params};channelsRef.current.get(id)?.setEffects(fx);return{...t,effects:fx};});tracksRef.current=next;setTracks(next);},[]);
  const updateMasterParams=useCallback((_id:string,params:Partial<{volume:number;pan:number}>)=>setMasterParams(prev=>{const u={...prev,...params};if(params.volume!==undefined)masterChannelRef.current?.setVolume(u.volume);if(params.pan!==undefined)masterChannelRef.current?.setPan(u.pan);return u;}),[]);
  const updateMasterEffect=useCallback((index:number,type:EffectType|null,bypassed?:boolean,params?:Record<string,number>)=>setMasterParams(prev=>{const fx=prev.effects?[...prev.effects]:createDefaultEffects();while(fx.length<=index)fx.push({id:crypto.randomUUID(),type:null,bypassed:false});const old=fx[index];fx[index]={...old,type,bypassed:bypassed!==undefined?bypassed:old.bypassed,params:params!==undefined?{...(old.params||{}),...params}:old.params};masterChannelRef.current?.setEffects(fx);return{...prev,effects:fx};}),[]);

  const renderAudio=useCallback(async()=>{if(isRendering)return;const snap=tracksRef.current;let end=0,trackTail=0;snap.forEach(t=>{t.clips.forEach(c=>end=Math.max(end,c.startTime+c.duration));trackTail=Math.max(trackTail,estimateEffectsTail(t.effects));});if(end<=0)return;const len=end+clamp(trackTail+estimateEffectsTail(masterParams.effects),.25,30)+.1;setIsRendering(true);try{const rendered=await Tone.Offline(async()=>{configureStereoBus(Tone.getDestination());Tone.Transport.bpm.value=bpmRef.current;const master=new StereoChannel();master.setVolume(masterParams.volume);master.setPan(masterParams.pan);master.setEffects(masterParams.effects);master.connect(Tone.getDestination());const solo=snap.some(t=>t.soloed);for(const t of snap){if(!(solo?t.soloed&&!t.muted:!t.muted))continue;const c=new StereoChannel();c.setVolume(t.volume);c.setPan(t.pan);c.setEffects(t.effects||createDefaultEffects());c.connect(master.input);for(const clip of t.clips){if(!clip.buffer)continue;new Tone.Player(clip.buffer).start(clip.startTime).connect(c.input);}}},len,2);const raw=(rendered as any)?.get?(rendered as any).get():rendered as unknown as AudioBuffer;const wav=audioBufferToWav(raw);const blob=new Blob([wav],{type:'audio/wav'}),url=URL.createObjectURL(blob);const a=document.createElement('a');a.download=`DigiDAW-Rendered-${Date.now()}.wav`;a.href=url;a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}catch(err){console.error('Render failed:',err);}finally{setIsRendering(false);}},[isRendering,masterParams]);
  const normalizeGain=useCallback((trackIds:string[]=[],clipIds:string[]=[],targetPeakDb=-1)=>{const target=Math.pow(10,targetPeakDb/20);let count=0;const next=tracksRef.current.map(t=>{const targeted=trackIds.includes(t.id);const clips=t.clips.map((c,idx)=>{if(!(clipIds.includes(c.id)||targeted||(clipIds.length===0&&trackIds.length===0))||!c.buffer)return c;let peak=0;for(let ch=0;ch<c.buffer.numberOfChannels;ch++){const d=c.buffer.getChannelData(ch);for(let i=0;i<d.length;i++)peak=Math.max(peak,Math.abs(d[i]));}if(peak<1e-6)return c;const out=new AudioBuffer({numberOfChannels:c.buffer.numberOfChannels,length:c.buffer.length,sampleRate:c.buffer.sampleRate}),scale=target/peak;for(let ch=0;ch<c.buffer.numberOfChannels;ch++){const src=c.buffer.getChannelData(ch),dst=out.getChannelData(ch);for(let i=0;i<src.length;i++)dst[i]=src[i]*scale;}try{playersRef.current.get(t.id)?.[idx]?.buffer.set(out);}catch{}count++;return{...c,buffer:out};});return{...t,clips};});if(count){tracksRef.current=next;setTracks(next);}return count;},[]);

  return {tracks,master:{...masterParams,id:'master',name:'Master',color:'#ffd900'},transportState,currentTime,bpm,setBpm,metronomeEnabled,toggleMetronome,setMetronomeEnabled,currentBeat,isInitialized,isRendering,renderAudio,normalizeGain,init,togglePlay,stop,seek,addTrack,removeTrack,updateTrackName,uploadClip,updateClipPosition,updateTrackParams,updateMasterParams,updateTrackEffect,updateMasterEffect,analysers:analysersRef.current,masterAnalyser:masterAnalyserRef.current};
}
