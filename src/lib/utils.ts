import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${ms.toString().padStart(2, '0')}`;
}

export function formatBarBeatTime(seconds: number, bpm: number): string {
  const secondsPerBeat = 60 / bpm;
  const secondsPerBar = 4 * secondsPerBeat;
  
  const bar = Math.floor(seconds / secondsPerBar) + 1;
  const beat = Math.floor((seconds % secondsPerBar) / secondsPerBeat) + 1;
  const sixteenth = Math.floor(((seconds % secondsPerBeat) / secondsPerBeat) * 4) + 1;
  
  return `${bar.toString().padStart(3, '0')}.${beat}.${sixteenth}`;
}
