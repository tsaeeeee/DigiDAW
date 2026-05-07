import { useEffect, useRef, useState, useCallback } from 'react';
import * as Tone from 'tone';
import { Track, TransportState, AudioClip } from '../types/daw';
import { audioBufferToWav } from '../lib/wavEncoder';

const INITIAL_TRACK_COUNT = 3;
const COLORS = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

export function useAudioEngine() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [transportState, setTransportState] = useState<TransportState>('stopped');
  const [currentTime, setCurrentTime] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  // Use refs for Tone objects to keep track of them without triggering re-renders
  const masterChannelRef = useRef<Tone.Channel | null>(null);
  const channelsRef = useRef<Map<string, Tone.Channel>>(new Map());
  const playersRef = useRef<Map<string, Tone.Player[]>>(new Map());
  const analysersRef = useRef<Map<string, { meter: Tone.Meter, fft: Tone.Analyser }>>(new Map());
  const masterAnalyserRef = useRef<{ meter: Tone.Meter, fft: Tone.Analyser } | null>(null);

  const [masterParams, setMasterParams] = useState({ volume: 0, pan: 0 });

  const init = useCallback(async () => {
    if (isInitialized) return;
    try {
      await Tone.start();
      console.log('Tone.js started, context state:', Tone.context.state);
      
      if (Tone.context.state !== 'running') {
        await Tone.context.resume();
      }

      // Initialize Master Channel
      const masterChannel = new Tone.Channel({ volume: 0, pan: 0 }).toDestination();
      const masterMeter = new Tone.Meter();
      const masterFFT = new Tone.Analyser('fft', 256);
      masterChannel.connect(masterMeter);
      masterChannel.connect(masterFFT);
      
      masterChannelRef.current = masterChannel;
      masterAnalyserRef.current = { meter: masterMeter, fft: masterFFT };

      const initialTracks: Track[] = Array.from({ length: INITIAL_TRACK_COUNT }).map((_, i) => ({
        id: crypto.randomUUID(),
        name: `Track ${i + 1}`,
        color: COLORS[i % COLORS.length],
        clips: [],
        muted: false,
        soloed: false,
        volume: 0,
        pan: 0,
      }));

      initialTracks.forEach(track => {
        const channel = new Tone.Channel({
          volume: 0,
          pan: 0,
        }).connect(masterChannel);
        
        const meter = new Tone.Meter();
        const fft = new Tone.Analyser('fft', 32);
        channel.connect(meter);
        channel.connect(fft);
        
        channelsRef.current.set(track.id, channel);
        analysersRef.current.set(track.id, { meter, fft });
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
    };

    if (masterChannelRef.current) {
      const channel = new Tone.Channel({ volume: 0, pan: 0 }).connect(masterChannelRef.current);
      const meter = new Tone.Meter();
      const fft = new Tone.Analyser('fft', 32);
      channel.connect(meter);
      channel.connect(fft);

      channelsRef.current.set(id, channel);
      analysersRef.current.set(id, { meter, fft });
      setTracks(prev => [...prev, newTrack]);
    }
  }, [tracks.length]);

  const removeTrack = useCallback((trackId: string) => {
    const channel = channelsRef.current.get(trackId);
    if (channel) {
      channel.dispose();
      channelsRef.current.delete(trackId);
    }
    const players = playersRef.current.get(trackId);
    if (players) {
      players.forEach(p => p.dispose());
      playersRef.current.delete(trackId);
    }
    const data = analysersRef.current.get(trackId);
    if (data) {
      data.meter.dispose();
      data.fft.dispose();
      analysersRef.current.delete(trackId);
    }

    setTracks(prev => prev.filter(t => t.id !== trackId));
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
      player.connect(channel);
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
              player.stop().unsync().sync().start(newStartTime);
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
    setTracks(prev => prev.map(t => {
      if (t.id === trackId) {
        const updated = { ...t, ...params };
        const channel = channelsRef.current.get(trackId);
        if (channel) {
          if (params.volume !== undefined) channel.volume.value = params.volume;
          if (params.pan !== undefined) channel.pan.value = params.pan;
          if (params.muted !== undefined) channel.mute = params.muted;
          // Solo logic is simplified here; usually it needs to mute others
        }
        return updated;
      }
      return t;
    }));
  }, []);

  const updateMasterParams = useCallback((_id: string, params: Partial<{ volume: number, pan: number }>) => {
    setMasterParams(prev => {
      const updated = { ...prev, ...params };
      if (masterChannelRef.current) {
        if (params.volume !== undefined) masterChannelRef.current.volume.value = params.volume;
        if (params.pan !== undefined) masterChannelRef.current.pan.value = params.pan;
      }
      return updated;
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
        // Create Master Bus in offline context
        const masterBus = new Tone.Channel({
          volume: masterParams.volume,
          pan: masterParams.pan
        }).toDestination();

        for (const track of tracks) {
          if (track.muted) continue;

          const channel = new Tone.Channel({
            volume: track.volume,
            pan: track.pan,
          }).connect(masterBus);

          for (const clip of track.clips) {
            if (clip.buffer) {
              const player = new Tone.Player(clip.buffer).start(clip.startTime);
              player.connect(channel);
            }
          }
        }
      }, renderLength);

      const wav = audioBufferToWav(buffer.get());
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
  }, [tracks, isRendering]);

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
    isInitialized,
    isRendering,
    renderAudio,
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
    analysers: analysersRef.current,
    masterAnalyser: masterAnalyserRef.current,
  };
}
