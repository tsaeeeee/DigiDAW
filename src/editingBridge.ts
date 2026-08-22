import type { Track } from './types/daw';

export interface DigiDAWEditingApi {
  tracks: Track[];
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  splitClipAtTime: (trackId: string, atTime: number) => boolean;
  deleteClip: (trackId: string, clipId: string) => boolean;
  updateClipFades: (trackId: string, clipId: string, fadeIn: number, fadeOut: number) => void;
  getCurrentTime: () => number;
}

let currentApi: DigiDAWEditingApi | null = null;
const listeners = new Set<() => void>();

export function publishEditingApi(api: DigiDAWEditingApi | null) {
  currentApi = api;
  listeners.forEach(listener => listener());
}

export function getEditingApi() {
  return currentApi;
}

export function subscribeEditingApi(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
