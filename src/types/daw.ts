export type EffectType =
  | 'Compressor'
  | 'EQ'
  | 'Reverb'
  | 'Delay'
  | 'Limiter'
  | 'Saturator'
  | 'Pitchy';

export interface EffectSlot {
  id: string;
  type: EffectType | null;
  bypassed?: boolean;
  params?: Record<string, number>;
}

export interface AudioClip {
  id: string;
  name: string;
  url: string;
  startTime: number;
  duration: number;
  buffer?: AudioBuffer;
}

export interface Track {
  id: string;
  name: string;
  color: string;
  clips: AudioClip[];
  muted: boolean;
  soloed: boolean;
  volume: number; // in dB
  pan: number; // -1 to 1
  effects?: EffectSlot[];
}

export type TransportState = 'started' | 'stopped' | 'paused';
