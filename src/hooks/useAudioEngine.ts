import { useCallback, useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import { Track, TransportState, AudioClip, EffectSlot, EffectType } from '../types/daw';
import { audioBufferToWav } from '../lib/wavEncoder';
import { StereoChannel, createDefaultEffects } from './useAudioEngineBase';
import { publishEditingApi } from '../editingBridge';

const INITIAL_TRACK_COUNT = 3;
const MAX_TRACKS = 25;
const HISTORY_LIMIT = 60;
const HISTORY_COALESCE_MS = 450;
const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
const DELAY_SYNC_BEAT_FACTORS = [0.125, 0.25, 0.5, 1, 2, 4];

type AnalyserBundle = { meter: Tone.Meter; fft: Tone.Analyser; preFaderMeter: Tone.Meter };
type TrackParamsUpdate = Partial<Pick<Track, 'volume' | 'pan' | 'muted' | 'soloed' | 'color'>>;
type MasterParams = { volume: number; pan: number; effects: EffectSlot[] };
type ProjectSnapshot = { tracks: Track[]; master: MasterParams; bpm: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

function cloneEffects(effects?: EffectSlot[]): EffectSlot[] | undefined {
  return effects?.map(slot => ({
    ...slot,
    params: slot.params ? { ...slot.params } : undefined,
  }));
}

function cloneTrack(track: Track): Track {
  return {
    ...track,
    clips: track.clips.map(clip => ({ ...clip })),
    effects: cloneEffects(track.effects),
  };
}

function cloneMaster(master: MasterParams): MasterParams {
  return {
    ...master,
    effects: cloneEffects(master.effects) || createDefaultEffects(),
  };
}

function getDelayTimeSeconds(params: Record<string, number>) {
  if ((params.syncMode ?? 0) === 1) {
    const bpm = clamp(Number(Tone.Transport.bpm.value) || 120, 20, 400);
    const index = clamp(Math.round(params.syncDivIndex ?? 2), 0, DELAY_SYNC_BEAT_FACTORS.length - 1);
    return clamp((60 / bpm) * DELAY_SYNC_BEAT_FACTORS[index], 0.005, 2);
  }
  return clamp((params.time ?? 240) / 1000, 0.005, 2);
}

function estimateEffectsTail(effects?: EffectSlot[]) {
  if (!effects) return 0;
  let total = 0;
  for (const slot of effects) {
    if (!slot?.type || slot.bypassed) continue;
    const p = slot.params || {};
    if (slot.type === 'Reverb') total += clamp(p.predelay ?? 20, 0, 250) / 1000 + clamp(p.decay ?? 2.5, 0.2, 20) * 1.15;
    else if (slot.type === 'Delay') {
      const delay = getDelayTimeSeconds(p);
      const feedback = clamp((p.feedback ?? 40) / 100, 0, 0.95);
      const repeats = feedback <= 0.001 ? 1 : clamp(Math.log(0.001) / Math.log(feedback), 1, 80);
      total += delay * repeats + 0.1;
    } else if (slot.type === 'Compressor') total += clamp((p.release ?? 100) / 1000, 0, 1);
    else if (slot.type === 'Limiter') total += clamp((p.release ?? 50) / 1000, 0, 1);
    else if (slot.type === 'DeEsser') total += clamp((p.release ?? 80) / 1000, 0, 0.5);
  }
  return clamp(total, 0, 30);
}

function sliceAudioBuffer(buffer: AudioBuffer, startSeconds: number, endSeconds: number) {
  const start = clamp(Math.round(startSeconds * buffer.sampleRate), 0, Math.max(0, buffer.length - 1));
  const end = clamp(Math.round(endSeconds * buffer.sampleRate), start + 1, buffer.length);
  const length = Math.max(1, end - start);
  const output = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length,
    sampleRate: buffer.sampleRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    output.getChannelData(channel).set(buffer.getChannelData(channel).subarray(start, end));
  }
  return output;
}

function makePlaybackBuffer(clip: AudioClip) {
  const source = clip.buffer;
  if (!source) return null;
  const fadeIn = clamp(clip.fadeIn ?? 0, 0, clip.duration);
  const fadeOut = clamp(clip.fadeOut ?? 0, 0, Math.max(0, clip.duration - fadeIn));
  if (fadeIn <= 0.0001 && fadeOut <= 0.0001) return source;

  const output = new AudioBuffer({
    numberOfChannels: source.numberOfChannels,
    length: source.length,
    sampleRate: source.sampleRate,
  });
  const fadeInSamples = Math.min(source.length, Math.round(fadeIn * source.sampleRate));
  const fadeOutSamples = Math.min(source.length, Math.round(fadeOut * source.sampleRate));

  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const input = source.getChannelData(channel);
    const target = output.getChannelData(channel);
    target.set(input);

    if (fadeInSamples > 1) {
      for (let i = 0; i < fadeInSamples; i++) {
        const phase = i / (fadeInSamples - 1);
        target[i] *= Math.sin(phase * Math.PI * 0.5);
      }
    }
    if (fadeOutSamples > 1) {
      const start = source.length - fadeOutSamples;
      for (let i = 0; i < fadeOutSamples; i++) {
        const phase = (fadeOutSamples - 1 - i) / (fadeOutSamples - 1);
        target[start + i] *= Math.sin(phase * Math.PI * 0.5);
      }
    }
  }
  return output;
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
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [masterParams, setMasterParams] = useState<MasterParams>({ volume: 0, pan: 0, effects: createDefaultEffects() });

  const tracksRef = useRef<Track[]>([]);
  const masterParamsRef = useRef<MasterParams>(masterParams);
  const bpmRef = useRef(120);
  const metronomeEnabledRef = useRef(false);
  const initializingRef = useRef(false);
  const metronomeEventIdRef = useRef<number | null>(null);
  const masterChannelRef = useRef<StereoChannel | null>(null);
  const channelsRef = useRef(new Map<string, StereoChannel>());
  const playersRef = useRef(new Map<string, Tone.Player[]>());
  const analysersRef = useRef(new Map<string, AnalyserBundle>());
  const masterAnalyserRef = useRef<AnalyserBundle | null>(null);
  const undoStackRef = useRef<ProjectSnapshot[]>([]);
  const redoStackRef = useRef<ProjectSnapshot[]>([]);
  const lastHistoryRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { masterParamsRef.current = masterParams; }, [masterParams]);

  const captureSnapshot = useCallback((): ProjectSnapshot => ({
    tracks: tracksRef.current.map(cloneTrack),
    master: cloneMaster(masterParamsRef.current),
    bpm: bpmRef.current,
  }), []);

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  const recordHistory = useCallback((key: string) => {
    const now = performance.now();
    const last = lastHistoryRef.current;
    if (last && last.key === key && now - last.at < HISTORY_COALESCE_MS) {
      lastHistoryRef.current = { key, at: now };
      return;
    }
    undoStackRef.current.push(captureSnapshot());
    if (undoStackRef.current.length > HISTORY_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
    lastHistoryRef.current = { key, at: now };
    syncHistoryFlags();
  }, [captureSnapshot, syncHistoryFlags]);

  const applySoloMute = useCallback((snapshotTracks: Track[]) => {
    const hasSolo = snapshotTracks.some(track => track.soloed);
    snapshotTracks.forEach(track => {
      const shouldPass = hasSolo ? track.soloed && !track.muted : !track.muted;
      channelsRef.current.get(track.id)?.setMute(!shouldPass);
    });
  }, []);

  const createTrackAudioNodes = useCallback((track: Track, master: StereoChannel) => {
    const channel = new StereoChannel();
    channel.setVolume(track.volume);
    channel.setPan(track.pan);
    channel.setEffects(track.effects || createDefaultEffects());
    channel.connect(master.input);
    const meter = new Tone.Meter({ channelCount: 2 });
    channel.connect(meter);
    channelsRef.current.set(track.id, channel);
    analysersRef.current.set(track.id, { meter, fft: channel.fft, preFaderMeter: channel.preFaderMeter });
  }, []);

  const disposeTrackPlayers = useCallback((trackId: string) => {
    playersRef.current.get(trackId)?.forEach(player => {
      try { player.stop(); } catch {}
      try { player.unsync(); } catch {}
      try { player.dispose(); } catch {}
    });
    playersRef.current.delete(trackId);
  }, []);

  const rebuildTrackPlayers = useCallback((trackId: string, clips: AudioClip[]) => {
    disposeTrackPlayers(trackId);
    const channel = channelsRef.current.get(trackId);
    if (!channel) return;
    const players: Tone.Player[] = [];
    for (const clip of clips) {
      const playbackBuffer = makePlaybackBuffer(clip);
      if (!playbackBuffer) continue;
      try {
        const player = new Tone.Player(playbackBuffer).sync().start(clip.startTime);
        player.connect(channel.input);
        players.push(player);
      } catch (error) {
        console.warn('Failed to schedule clip:', clip.name, error);
      }
    }
    playersRef.current.set(trackId, players);
  }, [disposeTrackPlayers]);

  const disposeAllTrackAudio = useCallback(() => {
    playersRef.current.forEach((_players, trackId) => disposeTrackPlayers(trackId));
    channelsRef.current.forEach(channel => channel.dispose());
    channelsRef.current.clear();
    analysersRef.current.forEach(bundle => { try { bundle.meter.dispose(); } catch {} });
    analysersRef.current.clear();
  }, [disposeTrackPlayers]);

  const restoreSnapshot = useCallback((snapshot: ProjectSnapshot) => {
    const restoredTracks = snapshot.tracks.map(cloneTrack);
    const restoredMaster = cloneMaster(snapshot.master);

    bpmRef.current = snapshot.bpm;
    setBpmState(snapshot.bpm);
    Tone.Transport.bpm.value = snapshot.bpm;

    masterParamsRef.current = restoredMaster;
    setMasterParams(restoredMaster);
    masterChannelRef.current?.setVolume(restoredMaster.volume);
    masterChannelRef.current?.setPan(restoredMaster.pan);
    masterChannelRef.current?.setEffects(restoredMaster.effects);

    disposeAllTrackAudio();
    if (masterChannelRef.current) {
      restoredTracks.forEach(track => createTrackAudioNodes(track, masterChannelRef.current!));
      restoredTracks.forEach(track => rebuildTrackPlayers(track.id, track.clips));
      applySoloMute(restoredTracks);
    }
    tracksRef.current = restoredTracks;
    setTracks(restoredTracks);
  }, [applySoloMute, createTrackAudioNodes, disposeAllTrackAudio, rebuildTrackPlayers]);

  const undo = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(captureSnapshot());
    restoreSnapshot(previous);
    lastHistoryRef.current = null;
    syncHistoryFlags();
  }, [captureSnapshot, restoreSnapshot, syncHistoryFlags]);

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(captureSnapshot());
    restoreSnapshot(next);
    lastHistoryRef.current = null;
    syncHistoryFlags();
  }, [captureSnapshot, restoreSnapshot, syncHistoryFlags]);

  const setBpm = useCallback((value: number) => {
    const next = clamp(Math.round(value), 60, 300);
    if (next === bpmRef.current) return;
    recordHistory('tempo');
    bpmRef.current = next;
    setBpmState(next);
    Tone.Transport.bpm.value = next;
    channelsRef.current.forEach(channel => channel.refreshTempoSyncedEffects());
    masterChannelRef.current?.refreshTempoSyncedEffects();
  }, [recordHistory]);

  const toggleMetronome = useCallback(() => setMetronomeEnabledState(previous => {
    const next = !previous;
    metronomeEnabledRef.current = next;
    return next;
  }), []);

  const setMetronomeEnabled = useCallback((value: boolean) => {
    metronomeEnabledRef.current = value;
    setMetronomeEnabledState(value);
  }, []);

  const init = useCallback(async () => {
    if (isInitialized || initializingRef.current) return;
    initializingRef.current = true;
    try {
      await Tone.start();
      if (Tone.context.state !== 'running') await Tone.context.resume();
      configureStereoBus(Tone.getDestination());
      Tone.Transport.bpm.value = bpmRef.current;

      if (metronomeEventIdRef.current === null) {
        metronomeEventIdRef.current = Tone.Transport.scheduleRepeat(time => {
          const beat = Math.floor(Math.round(Tone.Transport.ticks / (Tone.Transport.PPQ || 192))) % 4;
          setCurrentBeat(beat);
          if (!metronomeEnabledRef.current) return;
          const raw = Tone.getContext().rawContext;
          const oscillator = raw.createOscillator();
          const gain = raw.createGain();
          oscillator.type = 'triangle';
          oscillator.frequency.setValueAtTime(beat === 0 ? 1760 : 980, time);
          gain.gain.setValueAtTime(beat === 0 ? 0.85 : 0.6, time);
          gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
          oscillator.connect(gain);
          if (masterChannelRef.current) gain.connect(masterChannelRef.current.input.input as AudioNode);
          else gain.connect(raw.destination);
          oscillator.start(time);
          oscillator.stop(time + 0.05);
        }, '4n');
      }

      const master = new StereoChannel();
      master.setVolume(masterParamsRef.current.volume);
      master.setPan(masterParamsRef.current.pan);
      master.setEffects(masterParamsRef.current.effects);
      master.connect(Tone.getDestination());
      const meter = new Tone.Meter({ channelCount: 2 });
      master.connect(meter);
      masterChannelRef.current = master;
      masterAnalyserRef.current = { meter, fft: master.fft, preFaderMeter: master.preFaderMeter };

      const initial = Array.from({ length: INITIAL_TRACK_COUNT }, (_, index): Track => ({
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
      initial.forEach(track => createTrackAudioNodes(track, master));
      tracksRef.current = initial;
      setTracks(initial);
      setIsInitialized(true);
    } catch (error) {
      console.error('Failed to initialize audio engine:', error);
    } finally {
      initializingRef.current = false;
    }
  }, [createTrackAudioNodes, isInitialized]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (Tone.Transport.state === 'started') setCurrentTime(Tone.Transport.seconds);
    }, 50);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => () => {
    publishEditingApi(null);
    if (metronomeEventIdRef.current !== null) {
      try { Tone.Transport.clear(metronomeEventIdRef.current); } catch {}
      metronomeEventIdRef.current = null;
    }
    tracksRef.current.forEach(track => track.clips.forEach(clip => {
      if (clip.url?.startsWith('blob:')) URL.revokeObjectURL(clip.url);
    }));
    disposeAllTrackAudio();
    try { masterAnalyserRef.current?.meter.dispose(); } catch {}
    masterChannelRef.current?.dispose();
  }, [disposeAllTrackAudio]);

  const addTrack = useCallback(() => {
    if (tracksRef.current.length >= MAX_TRACKS || !masterChannelRef.current) return;
    recordHistory('add-track');
    const id = crypto.randomUUID();
    const track: Track = {
      id,
      name: `Track ${tracksRef.current.length + 1}`,
      color: COLORS[tracksRef.current.length % COLORS.length],
      clips: [], muted: false, soloed: false, volume: 0, pan: 0,
      effects: createDefaultEffects(),
    };
    createTrackAudioNodes(track, masterChannelRef.current);
    const next = [...tracksRef.current, track];
    tracksRef.current = next;
    setTracks(next);
  }, [createTrackAudioNodes, recordHistory]);

  const removeTrack = useCallback((id: string) => {
    const old = tracksRef.current.find(track => track.id === id);
    if (!old) return;
    recordHistory(`remove-track:${id}`);
    old.clips.forEach(clip => { if (clip.url?.startsWith('blob:')) URL.revokeObjectURL(clip.url); });
    disposeTrackPlayers(id);
    channelsRef.current.get(id)?.dispose();
    channelsRef.current.delete(id);
    try { analysersRef.current.get(id)?.meter.dispose(); } catch {}
    analysersRef.current.delete(id);
    const next = tracksRef.current.filter(track => track.id !== id);
    applySoloMute(next);
    tracksRef.current = next;
    setTracks(next);
  }, [applySoloMute, disposeTrackPlayers, recordHistory]);

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

  const updateTrackName = useCallback((id: string, name: string) => {
    const current = tracksRef.current.find(track => track.id === id);
    if (!current || current.name === name) return;
    recordHistory(`track-name:${id}`);
    const next = tracksRef.current.map(track => track.id === id ? { ...track, name } : track);
    tracksRef.current = next;
    setTracks(next);
  }, [recordHistory]);

  const uploadClip = useCallback(async (id: string, file: File) => {
    const url = URL.createObjectURL(file);
    try {
      const toneBuffer = await new Tone.ToneAudioBuffer().load(url);
      const channel = channelsRef.current.get(id);
      if (!channel) { URL.revokeObjectURL(url); return; }
      recordHistory(`upload:${id}`);
      const clip: AudioClip = {
        id: crypto.randomUUID(),
        name: file.name,
        url,
        startTime: Tone.Transport.seconds,
        duration: toneBuffer.duration,
        buffer: toneBuffer.get(),
        fadeIn: 0,
        fadeOut: 0,
      };
      const next = tracksRef.current.map(track => track.id === id ? { ...track, clips: [...track.clips, clip] } : track);
      tracksRef.current = next;
      setTracks(next);
      const updated = next.find(track => track.id === id);
      if (updated) rebuildTrackPlayers(id, updated.clips);
    } catch (error) {
      URL.revokeObjectURL(url);
      console.error('Failed to load audio clip:', error);
    }
  }, [rebuildTrackPlayers, recordHistory]);

  const updateClipPosition = useCallback((trackId: string, clipId: string, start: number) => {
    const safeStart = Math.max(0, start);
    const track = tracksRef.current.find(item => item.id === trackId);
    const clip = track?.clips.find(item => item.id === clipId);
    if (!track || !clip || Math.abs(clip.startTime - safeStart) < 0.0001) return;
    recordHistory(`clip-move:${clipId}`);
    const next = tracksRef.current.map(item => item.id === trackId
      ? { ...item, clips: item.clips.map(current => current.id === clipId ? { ...current, startTime: safeStart } : current) }
      : item);
    tracksRef.current = next;
    setTracks(next);
    const updated = next.find(item => item.id === trackId);
    if (updated) rebuildTrackPlayers(trackId, updated.clips);
  }, [rebuildTrackPlayers, recordHistory]);

  const splitClipAtTime = useCallback((trackId: string, atTime: number) => {
    const track = tracksRef.current.find(item => item.id === trackId);
    if (!track) return false;
    const clipIndex = track.clips.findIndex(clip => atTime > clip.startTime + 0.005 && atTime < clip.startTime + clip.duration - 0.005);
    if (clipIndex < 0) return false;
    const clip = track.clips[clipIndex];
    if (!clip.buffer) return false;

    const offset = atTime - clip.startTime;
    const rightDuration = clip.duration - offset;
    if (offset <= 0.005 || rightDuration <= 0.005) return false;

    recordHistory(`clip-split:${clip.id}`);
    const leftBuffer = sliceAudioBuffer(clip.buffer, 0, offset);
    const rightBuffer = sliceAudioBuffer(clip.buffer, offset, clip.duration);
    const left: AudioClip = {
      ...clip,
      id: crypto.randomUUID(),
      duration: offset,
      buffer: leftBuffer,
      fadeIn: Math.min(clip.fadeIn ?? 0, offset),
      fadeOut: 0,
    };
    const right: AudioClip = {
      ...clip,
      id: crypto.randomUUID(),
      startTime: atTime,
      duration: rightDuration,
      buffer: rightBuffer,
      fadeIn: 0,
      fadeOut: Math.min(clip.fadeOut ?? 0, rightDuration),
    };
    const clips = [...track.clips];
    clips.splice(clipIndex, 1, left, right);
    const next = tracksRef.current.map(item => item.id === trackId ? { ...item, clips } : item);
    tracksRef.current = next;
    setTracks(next);
    rebuildTrackPlayers(trackId, clips);
    return true;
  }, [rebuildTrackPlayers, recordHistory]);

  const deleteClip = useCallback((trackId: string, clipId: string) => {
    const track = tracksRef.current.find(item => item.id === trackId);
    const clip = track?.clips.find(item => item.id === clipId);
    if (!track || !clip) return false;
    recordHistory(`clip-delete:${clipId}`);
    const clips = track.clips.filter(item => item.id !== clipId);
    const next = tracksRef.current.map(item => item.id === trackId ? { ...item, clips } : item);
    tracksRef.current = next;
    setTracks(next);
    rebuildTrackPlayers(trackId, clips);
    return true;
  }, [rebuildTrackPlayers, recordHistory]);

  const updateClipFades = useCallback((trackId: string, clipId: string, fadeInValue: number, fadeOutValue: number) => {
    const track = tracksRef.current.find(item => item.id === trackId);
    const clip = track?.clips.find(item => item.id === clipId);
    if (!track || !clip) return;
    const fadeIn = clamp(fadeInValue, 0, clip.duration);
    const fadeOut = clamp(fadeOutValue, 0, Math.max(0, clip.duration - fadeIn));
    if (Math.abs((clip.fadeIn ?? 0) - fadeIn) < 0.0001 && Math.abs((clip.fadeOut ?? 0) - fadeOut) < 0.0001) return;
    recordHistory(`clip-fade:${clipId}`);
    const clips = track.clips.map(item => item.id === clipId ? { ...item, fadeIn, fadeOut } : item);
    const next = tracksRef.current.map(item => item.id === trackId ? { ...item, clips } : item);
    tracksRef.current = next;
    setTracks(next);
    rebuildTrackPlayers(trackId, clips);
  }, [rebuildTrackPlayers, recordHistory]);

  const updateTrackParams = useCallback((id: string, params: TrackParamsUpdate) => {
    const current = tracksRef.current.find(track => track.id === id);
    if (!current) return;
    recordHistory(`track-param:${id}:${Object.keys(params).sort().join(',')}`);
    const next = tracksRef.current.map(track => {
      if (track.id !== id) return track;
      const updated = { ...track, ...params };
      const channel = channelsRef.current.get(id);
      if (channel) {
        if (params.volume !== undefined) channel.setVolume(updated.volume);
        if (params.pan !== undefined) channel.setPan(updated.pan);
      }
      return updated;
    });
    applySoloMute(next);
    tracksRef.current = next;
    setTracks(next);
  }, [applySoloMute, recordHistory]);

  const updateTrackEffect = useCallback((id: string, index: number, type: EffectType | null, bypassed?: boolean, params?: Record<string, number>) => {
    recordHistory(`track-fx:${id}:${index}`);
    const next = tracksRef.current.map(track => {
      if (track.id !== id) return track;
      const effects = track.effects ? [...track.effects] : createDefaultEffects();
      while (effects.length <= index) effects.push({ id: crypto.randomUUID(), type: null, bypassed: false });
      const old = effects[index];
      effects[index] = {
        ...old,
        type,
        bypassed: bypassed !== undefined ? bypassed : old.bypassed,
        params: params !== undefined ? { ...(old.params || {}), ...params } : old.params,
      };
      channelsRef.current.get(id)?.setEffects(effects);
      return { ...track, effects };
    });
    tracksRef.current = next;
    setTracks(next);
  }, [recordHistory]);

  const updateMasterParams = useCallback((_id: string, params: Partial<{ volume: number; pan: number }>) => {
    recordHistory(`master-param:${Object.keys(params).sort().join(',')}`);
    setMasterParams(previous => {
      const updated = { ...previous, ...params };
      masterParamsRef.current = updated;
      if (params.volume !== undefined) masterChannelRef.current?.setVolume(updated.volume);
      if (params.pan !== undefined) masterChannelRef.current?.setPan(updated.pan);
      return updated;
    });
  }, [recordHistory]);

  const updateMasterEffect = useCallback((index: number, type: EffectType | null, bypassed?: boolean, params?: Record<string, number>) => {
    recordHistory(`master-fx:${index}`);
    setMasterParams(previous => {
      const effects = previous.effects ? [...previous.effects] : createDefaultEffects();
      while (effects.length <= index) effects.push({ id: crypto.randomUUID(), type: null, bypassed: false });
      const old = effects[index];
      effects[index] = {
        ...old,
        type,
        bypassed: bypassed !== undefined ? bypassed : old.bypassed,
        params: params !== undefined ? { ...(old.params || {}), ...params } : old.params,
      };
      masterChannelRef.current?.setEffects(effects);
      const updated = { ...previous, effects };
      masterParamsRef.current = updated;
      return updated;
    });
  }, [recordHistory]);

  const renderAudio = useCallback(async () => {
    if (isRendering) return;
    const snapshot = tracksRef.current.map(cloneTrack);
    let end = 0;
    let trackTail = 0;
    snapshot.forEach(track => {
      track.clips.forEach(clip => { end = Math.max(end, clip.startTime + clip.duration); });
      trackTail = Math.max(trackTail, estimateEffectsTail(track.effects));
    });
    if (end <= 0) return;
    const masterSnapshot = cloneMaster(masterParamsRef.current);
    const length = end + clamp(trackTail + estimateEffectsTail(masterSnapshot.effects), 0.25, 30) + 0.1;
    setIsRendering(true);
    try {
      const rendered = await Tone.Offline(async () => {
        configureStereoBus(Tone.getDestination());
        Tone.Transport.bpm.value = bpmRef.current;
        const master = new StereoChannel();
        master.setVolume(masterSnapshot.volume);
        master.setPan(masterSnapshot.pan);
        master.setEffects(masterSnapshot.effects);
        master.connect(Tone.getDestination());
        const hasSolo = snapshot.some(track => track.soloed);
        for (const track of snapshot) {
          if (!(hasSolo ? track.soloed && !track.muted : !track.muted)) continue;
          const channel = new StereoChannel();
          channel.setVolume(track.volume);
          channel.setPan(track.pan);
          channel.setEffects(track.effects || createDefaultEffects());
          channel.connect(master.input);
          for (const clip of track.clips) {
            const playbackBuffer = makePlaybackBuffer(clip);
            if (!playbackBuffer) continue;
            new Tone.Player(playbackBuffer).start(clip.startTime).connect(channel.input);
          }
        }
      }, length, 2);
      const raw = (rendered as any)?.get ? (rendered as any).get() : rendered as unknown as AudioBuffer;
      const wav = audioBufferToWav(raw);
      const blob = new Blob([wav], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.download = `DigiDAW-Rendered-${Date.now()}.wav`;
      anchor.href = url;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      console.error('Render failed:', error);
    } finally {
      setIsRendering(false);
    }
  }, [isRendering]);

  const normalizeGain = useCallback((trackIds: string[] = [], clipIds: string[] = [], targetPeakDb = -1) => {
    const hasTarget = tracksRef.current.some(track => {
      const wholeTrack = trackIds.includes(track.id) || (clipIds.length === 0 && trackIds.length === 0);
      return track.clips.some(clip => !!clip.buffer && (wholeTrack || clipIds.includes(clip.id)));
    });
    if (!hasTarget) return 0;
    recordHistory('normalize-gain');
    const target = Math.pow(10, targetPeakDb / 20);
    let count = 0;
    const changedTrackIds = new Set<string>();
    const next = tracksRef.current.map(track => {
      const targeted = trackIds.includes(track.id);
      const clips = track.clips.map(clip => {
        if (!(clipIds.includes(clip.id) || targeted || (clipIds.length === 0 && trackIds.length === 0)) || !clip.buffer) return clip;
        let peak = 0;
        for (let channel = 0; channel < clip.buffer.numberOfChannels; channel++) {
          const data = clip.buffer.getChannelData(channel);
          for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
        }
        if (peak < 1e-6) return clip;
        const output = new AudioBuffer({
          numberOfChannels: clip.buffer.numberOfChannels,
          length: clip.buffer.length,
          sampleRate: clip.buffer.sampleRate,
        });
        const scale = target / peak;
        for (let channel = 0; channel < clip.buffer.numberOfChannels; channel++) {
          const source = clip.buffer.getChannelData(channel);
          const destination = output.getChannelData(channel);
          for (let i = 0; i < source.length; i++) destination[i] = source[i] * scale;
        }
        count++;
        changedTrackIds.add(track.id);
        return { ...clip, buffer: output };
      });
      return { ...track, clips };
    });
    if (count) {
      tracksRef.current = next;
      setTracks(next);
      changedTrackIds.forEach(trackId => {
        const track = next.find(item => item.id === trackId);
        if (track) rebuildTrackPlayers(trackId, track.clips);
      });
    }
    return count;
  }, [rebuildTrackPlayers, recordHistory]);

  const getCurrentTime = useCallback(() => Math.max(0, Tone.Transport.seconds), []);

  useEffect(() => {
    publishEditingApi({
      tracks,
      canUndo,
      canRedo,
      undo,
      redo,
      splitClipAtTime,
      deleteClip,
      updateClipFades,
      getCurrentTime,
    });
  }, [canRedo, canUndo, deleteClip, getCurrentTime, redo, splitClipAtTime, tracks, undo, updateClipFades]);

  return {
    tracks,
    master: { ...masterParams, id: 'master', name: 'Master', color: '#ffd900' },
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
    updateClipFades,
    splitClipAtTime,
    deleteClip,
    undo,
    redo,
    canUndo,
    canRedo,
    updateTrackParams,
    updateMasterParams,
    updateTrackEffect,
    updateMasterEffect,
    analysers: analysersRef.current,
    masterAnalyser: masterAnalyserRef.current,
  };
}
