import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Power, RefreshCw, X } from 'lucide-react';
import * as Tone from 'tone';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';
import { PluginKnob } from './PluginKnob';

export interface EqualizerModalProps {
  slot: EffectSlot;
  slotIndex: number;
  analyser?: any;
  isPlaying?: boolean;
  onUpdateParams: (slotIndex: number, bypassed: boolean, params: Record<string, number>) => void;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
}

type FilterShape = 'peaking' | 'highpass' | 'lowpass' | 'lowshelf' | 'highshelf';
interface BandConfig {
  id: number;
  type: FilterShape;
  freq: number;
  gain: number;
  q: number;
  bypass: boolean;
  color: string;
}

const FILTER_TYPES: { id: FilterShape; short: string; label: string }[] = [
  { id: 'peaking', short: 'BELL', label: 'Bell / Peaking' },
  { id: 'highpass', short: 'HP', label: 'High Pass' },
  { id: 'lowpass', short: 'LP', label: 'Low Pass' },
  { id: 'lowshelf', short: 'LS', label: 'Low Shelf' },
  { id: 'highshelf', short: 'HS', label: 'High Shelf' },
];
const BAND_COLORS = ['#c084fc', '#f472b6', '#fb923c', '#4ade80', '#38bdf8'];
const DEFAULT_BANDS: BandConfig[] = [
  { id: 1, type: 'highpass', freq: 40, gain: 0, q: 0.707, bypass: false, color: BAND_COLORS[0] },
  { id: 2, type: 'peaking', freq: 250, gain: 0, q: 1, bypass: false, color: BAND_COLORS[1] },
  { id: 3, type: 'peaking', freq: 1000, gain: 0, q: 1, bypass: false, color: BAND_COLORS[2] },
  { id: 4, type: 'peaking', freq: 4000, gain: 0, q: 1, bypass: false, color: BAND_COLORS[3] },
  { id: 5, type: 'lowpass', freq: 15000, gain: 0, q: 0.707, bypass: false, color: BAND_COLORS[4] },
];
const PRESETS = [
  { name: 'Flat Default', bands: DEFAULT_BANDS },
  { name: 'Vocal Clarity', bands: [
    { ...DEFAULT_BANDS[0], freq: 80 },
    { ...DEFAULT_BANDS[1], freq: 300, gain: -2.5, q: 1.2 },
    { ...DEFAULT_BANDS[2], freq: 3000, gain: 3, q: 1 },
    { ...DEFAULT_BANDS[3], type: 'highshelf' as FilterShape, freq: 8000, gain: 2, q: 0.707 },
    { ...DEFAULT_BANDS[4], freq: 18000 },
  ] },
  { name: 'Bass & Sub Control', bands: [
    { ...DEFAULT_BANDS[0], freq: 30 },
    { ...DEFAULT_BANDS[1], type: 'lowshelf' as FilterShape, freq: 100, gain: 4.5, q: 0.8 },
    { ...DEFAULT_BANDS[2], freq: 500, gain: -1.5 },
    { ...DEFAULT_BANDS[3], freq: 2500, gain: 1.5 },
    { ...DEFAULT_BANDS[4], freq: 16000 },
  ] },
  { name: 'Smile Curve', bands: [
    { ...DEFAULT_BANDS[0], freq: 35 },
    { ...DEFAULT_BANDS[1], type: 'lowshelf' as FilterShape, freq: 120, gain: 3, q: 0.9 },
    { ...DEFAULT_BANDS[2], freq: 1200, gain: -3, q: 1.4 },
    { ...DEFAULT_BANDS[3], type: 'highshelf' as FilterShape, freq: 6000, gain: 3.5, q: 0.9 },
    { ...DEFAULT_BANDS[4], freq: 19000 },
  ] },
];

function freqToX(freq: number, width: number) {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  return ((Math.log10(Math.max(20, Math.min(20000, freq))) - min) / (max - min)) * width;
}
function xToFreq(x: number, width: number) {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  return Math.pow(10, min + Math.max(0, Math.min(1, x / width)) * (max - min));
}
function dbToY(db: number, height: number) {
  return height * (1 - (Math.max(-18, Math.min(18, db)) + 18) / 36);
}
function yToDb(y: number, height: number) {
  return -18 + (1 - Math.max(0, Math.min(1, y / height))) * 36;
}

export function EqualizerModal({
  slot,
  slotIndex,
  analyser,
  isPlaying,
  onUpdateParams,
  onClose,
  zIndex,
  onFocus,
}: EqualizerModalProps) {
  const isBypassed = !!slot.bypassed;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bandsRef = useRef<BandConfig[]>([]);
  const [activeBandId, setActiveBandId] = useState(1);
  const [selectedPresetName, setSelectedPresetName] = useState('Flat Default');
  const [presetOpen, setPresetOpen] = useState(false);
  const [position, setPosition] = useState(() => ({
    x: Math.max(20, Math.round(window.innerWidth / 2 - 340)),
    y: Math.max(20, Math.round(window.innerHeight / 2 - 270)),
  }));

  const [bands, setBands] = useState<BandConfig[]>(() => DEFAULT_BANDS.map((def, index) => {
    const id = index + 1;
    const params: any = slot.params || {};
    const typeString = params[`b${id}_type_str`];
    const typeIndex = params[`b${id}_type`];
    return {
      ...def,
      type: typeof typeString === 'string' ? typeString as FilterShape : FILTER_TYPES[typeIndex]?.id || def.type,
      freq: typeof params[`b${id}_freq`] === 'number' ? params[`b${id}_freq`] : def.freq,
      gain: typeof params[`b${id}_gain`] === 'number' ? params[`b${id}_gain`] : def.gain,
      q: typeof params[`b${id}_q`] === 'number' ? params[`b${id}_q`] : def.q,
      bypass: params[`b${id}_bypass`] === 1,
    };
  }));
  bandsRef.current = bands;

  const pushBands = (nextBands: BandConfig[], bypass = isBypassed) => {
    const nextParams: Record<string, any> = {};
    nextBands.forEach((band) => {
      const typeIndex = FILTER_TYPES.findIndex((type) => type.id === band.type);
      nextParams[`b${band.id}_type`] = Math.max(0, typeIndex);
      nextParams[`b${band.id}_type_str`] = band.type;
      nextParams[`b${band.id}_freq`] = Math.round(band.freq * 10) / 10;
      nextParams[`b${band.id}_gain`] = Math.round(band.gain * 10) / 10;
      nextParams[`b${band.id}_q`] = Math.round(band.q * 100) / 100;
      nextParams[`b${band.id}_bypass`] = band.bypass ? 1 : 0;
    });
    onUpdateParams(slotIndex, bypass, nextParams as Record<string, number>);
  };

  const updateBand = (id: number, changes: Partial<BandConfig>) => {
    const next = bandsRef.current.map((band) => band.id === id ? { ...band, ...changes } : band);
    setBands(next);
    pushBands(next);
    setSelectedPresetName('Custom');
  };

  const applyPreset = (preset: typeof PRESETS[number]) => {
    const next = preset.bands.map((band, index) => ({ ...band, color: BAND_COLORS[index] }));
    setBands(next);
    pushBands(next);
    setSelectedPresetName(preset.name);
    setPresetOpen(false);
  };

  const cyclePreset = (direction: -1 | 1) => {
    let index = PRESETS.findIndex((preset) => preset.name === selectedPresetName);
    if (index < 0) index = 0;
    index = (index + direction + PRESETS.length) % PRESETS.length;
    applyPreset(PRESETS[index]);
  };

  const handleHeaderMouseDown = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const startX = event.clientX - position.x;
    const startY = event.clientY - position.y;
    const move = (moveEvent: MouseEvent) => setPosition({
      x: Math.max(10, Math.min(window.innerWidth - 680, moveEvent.clientX - startX)),
      y: Math.max(10, Math.min(window.innerHeight - 540, moveEvent.clientY - startY)),
    });
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rawContext: AudioContext | null = null;
    try { rawContext = Tone.getContext().rawContext as AudioContext; } catch {}
    const responseFilters = rawContext ? bands.map(() => rawContext!.createBiquadFilter()) : [];
    const pointCount = 220;
    const frequencyPoints = new Float32Array(pointCount);
    const magnitude = new Float32Array(pointCount);
    const phase = new Float32Array(pointCount);
    const combined = new Float32Array(pointCount);
    for (let index = 0; index < pointCount; index++) frequencyPoints[index] = xToFreq((index / (pointCount - 1)) * canvas.width, canvas.width);

    let frame = 0;
    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#0d0e14';
      ctx.fillRect(0, 0, w, h);

      ctx.font = '9px "Kumbh Sans", sans-serif';
      for (const freq of [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
        const x = freqToX(freq, w);
        ctx.strokeStyle = '#1b1c25'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.fillStyle = '#4b5262'; ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : `${freq}`, x + 2, h - 4);
      }
      for (const db of [18, 12, 6, 0, -6, -12, -18]) {
        const y = dbToY(db, h);
        ctx.strokeStyle = db === 0 ? '#2d3345' : '#161722';
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      if (analyser?.fft && isPlaying) {
        try {
          const fft = analyser.fft.getValue();
          const nyquist = (Tone.getContext().sampleRate || 44100) / 2;
          if (fft && fft.length) {
            ctx.beginPath(); ctx.moveTo(0, h);
            for (let index = 0; index <= 220; index++) {
              const x = (index / 220) * w;
              const freq = xToFreq(x, w);
              const bin = Math.min(fft.length - 1, Math.max(0, Math.round((freq / nyquist) * (fft.length - 1))));
              const db = Number(fft[bin]) || -100;
              const y = h - Math.max(0, Math.min(1, (db + 80) / 80)) * h * 0.75;
              ctx.lineTo(x, y);
            }
            ctx.lineTo(w, h); ctx.closePath();
            const gradient = ctx.createLinearGradient(0, 0, 0, h);
            gradient.addColorStop(0, 'rgba(56,189,248,0.24)');
            gradient.addColorStop(1, 'rgba(96,165,250,0)');
            ctx.fillStyle = gradient; ctx.fill();
          }
        } catch {}
      }

      combined.fill(1);
      if (!isBypassed && rawContext) {
        bands.forEach((band, bandIndex) => {
          if (band.bypass) return;
          const filter = responseFilters[bandIndex];
          if (!filter) return;
          filter.type = band.type;
          filter.frequency.value = Math.max(20, Math.min(20000, band.freq));
          filter.Q.value = Math.max(0.1, Math.min(18, band.q));
          filter.gain.value = Math.max(-24, Math.min(24, band.gain));
          filter.getFrequencyResponse(frequencyPoints, magnitude, phase);
          for (let i = 0; i < pointCount; i++) combined[i] *= magnitude[i];
        });
      }

      ctx.beginPath();
      for (let i = 0; i < pointCount; i++) {
        const x = (i / (pointCount - 1)) * w;
        const db = Math.max(-24, Math.min(24, 20 * Math.log10(Math.max(0.000001, combined[i]))));
        const y = dbToY(db, h);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = isBypassed ? '#666' : '#38bdf8';
      ctx.lineWidth = 2;
      ctx.shadowColor = isBypassed ? 'transparent' : 'rgba(56,189,248,0.55)';
      ctx.shadowBlur = isBypassed ? 0 : 6;
      ctx.stroke(); ctx.shadowBlur = 0;

      bands.forEach((band) => {
        const x = freqToX(band.freq, w);
        const y = dbToY(band.type === 'highpass' || band.type === 'lowpass' ? 0 : band.gain, h);
        const active = band.id === activeBandId;
        ctx.beginPath(); ctx.arc(x, y, active ? 11 : 9, 0, Math.PI * 2);
        ctx.globalAlpha = band.bypass ? 0.3 : 0.75;
        ctx.fillStyle = band.color; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = active ? '#fff' : band.color; ctx.lineWidth = active ? 2 : 1; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 9px "Kumbh Sans", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(band.id), x, y);
      });
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      responseFilters.forEach((filter) => { try { filter.disconnect(); } catch {} });
    };
  }, [bands, activeBandId, isBypassed, analyser, isPlaying]);

  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = (event.clientX - rect.left) * (canvas.width / rect.width);
    const mouseY = (event.clientY - rect.top) * (canvas.height / rect.height);
    let target: BandConfig | undefined;
    let nearest = 26;
    bandsRef.current.forEach((band) => {
      const x = freqToX(band.freq, canvas.width);
      const y = dbToY(band.type === 'highpass' || band.type === 'lowpass' ? 0 : band.gain, canvas.height);
      const distance = Math.hypot(mouseX - x, mouseY - y);
      if (distance < nearest) { nearest = distance; target = band; }
    });
    if (!target) return;
    const targetId = target.id;
    setActiveBandId(targetId);

    const move = (moveEvent: MouseEvent) => {
      const nextRect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(canvas.width, (moveEvent.clientX - nextRect.left) * (canvas.width / nextRect.width)));
      const y = Math.max(0, Math.min(canvas.height, (moveEvent.clientY - nextRect.top) * (canvas.height / nextRect.height)));
      const current = bandsRef.current.find((band) => band.id === targetId);
      if (!current) return;
      const cut = current.type === 'highpass' || current.type === 'lowpass';
      const next = bandsRef.current.map((band) => band.id === targetId ? { ...band, freq: xToFreq(x, canvas.width), gain: cut ? 0 : yToDb(y, canvas.height) } : band);
      bandsRef.current = next;
      setBands(next);
      pushBands(next);
      setSelectedPresetName('Custom');
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const activeBand = bands.find((band) => band.id === activeBandId) || bands[0];
  const gainDisabled = activeBand.type === 'highpass' || activeBand.type === 'lowpass';

  return (
    <div
      onMouseDown={() => onFocus?.()}
      style={{ left: position.x, top: position.y, width: 680, zIndex: zIndex ?? 310 }}
      className="fixed overflow-hidden rounded-xl border border-[#2e2e36] bg-[#141416] shadow-[0_25px_60px_rgba(0,0,0,0.95)] select-none"
    >
      <div onMouseDown={handleHeaderMouseDown} className="h-10 px-3 flex items-center justify-between bg-[#1c1c22] border-b border-[#2d2d38] cursor-move">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => pushBands(bands, !isBypassed)} className={cn('w-6 h-6 rounded-full flex items-center justify-center', !isBypassed ? 'bg-[#ec4899] text-black shadow-[0_0_10px_rgba(236,72,153,0.7)]' : 'bg-[#25252c] text-[#777]')}><Power className="w-3.5 h-3.5" /></button>
          <span className="font-black text-sm tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-[#f472b6] via-[#e879f9] to-[#c084fc]">Equalizer</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex items-center h-6 px-1 rounded bg-[#111114] border border-[#2d2d38]">
            <button type="button" onClick={() => cyclePreset(-1)} className="text-[#888] hover:text-white"><ChevronLeft className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => setPresetOpen((open) => !open)} className="min-w-[115px] px-2 flex items-center justify-between text-[10px] text-[#ccc]"><span className="truncate">{selectedPresetName}</span><ChevronDown className="w-3 h-3" /></button>
            <button type="button" onClick={() => cyclePreset(1)} className="text-[#888] hover:text-white"><ChevronRight className="w-3.5 h-3.5" /></button>
            {presetOpen && <div className="absolute top-7 left-0 right-0 z-[350] py-1 rounded border border-[#3e3e4a] bg-[#18181e] shadow-xl">{PRESETS.map((preset) => <button key={preset.name} type="button" onClick={() => applyPreset(preset)} className="w-full px-2 py-1.5 text-left text-[10px] text-[#ccc] hover:text-[#f472b6] hover:bg-[#282834]">{preset.name}</button>)}</div>}
          </div>
          <button type="button" onClick={() => applyPreset(PRESETS[0])} title="Reset EQ" className="w-6 h-6 flex items-center justify-center text-[#888] hover:text-white"><RefreshCw className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={onClose} className="w-6 h-6 flex items-center justify-center text-[#888] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      </div>

      <canvas ref={canvasRef} width={680} height={245} onMouseDown={handleCanvasMouseDown} className="w-full h-[245px] bg-[#0d0e14] cursor-crosshair border-b border-[#292934]" />

      <div className="p-3 bg-[#18181e]">
        <div className="flex items-center justify-between pb-2 border-b border-[#292934]">
          <div className="flex gap-1.5">{bands.map((band) => <button key={band.id} type="button" onClick={() => setActiveBandId(band.id)} className={cn('px-3 py-1 rounded-full text-[10px] font-black border flex items-center gap-1.5', activeBandId === band.id ? 'bg-[#282834] text-white border-[#e879f9]/60' : 'bg-[#111114] text-[#777] border-[#2d2d38]')}><span className="w-2 h-2 rounded-full" style={{ backgroundColor: band.bypass ? '#555' : band.color }} />B{band.id}</button>)}</div>
          <button type="button" onClick={() => updateBand(activeBand.id, { bypass: !activeBand.bypass })} className={cn('px-3 h-7 rounded-full text-[9px] font-black border', !activeBand.bypass ? 'border-[#f472b6] bg-[#f472b6]/15 text-[#f472b6]' : 'border-[#383842] bg-[#111114] text-[#666]')}>Band {activeBand.bypass ? 'off' : 'on'}</button>
        </div>

        <div className="pt-3 flex items-center gap-5">
          <div className="w-[210px]">
            <div className="text-[8px] text-[#666] font-black tracking-widest mb-1.5">Filter shape</div>
            <div className="grid grid-cols-5 gap-1">{FILTER_TYPES.map((type) => <button key={type.id} type="button" title={type.label} onClick={() => updateBand(activeBand.id, { type: type.id, gain: type.id === 'highpass' || type.id === 'lowpass' ? 0 : activeBand.gain })} className={cn('h-8 rounded text-[8px] font-black border', activeBand.type === type.id ? 'bg-gradient-to-r from-[#f472b6] to-[#e879f9] text-black border-[#f472b6]' : 'bg-[#111114] text-[#777] border-[#33333d]')}>{type.short}</button>)}</div>
          </div>
          <div className="w-px h-20 bg-[#292934]" />
          <div className="flex-1 grid grid-cols-3 gap-5 justify-items-center">
            <PluginKnob label="FREQUENCY" leftSubLabel="20" rightSubLabel="20K" value={activeBand.freq} min={20} max={20000} step={1} defaultValue={DEFAULT_BANDS[activeBand.id - 1]?.freq || 1000} displayValue={activeBand.freq >= 1000 ? `${(activeBand.freq / 1000).toFixed(2)}kHz` : `${Math.round(activeBand.freq)}Hz`} size="md" isLogarithmic onChange={(v) => updateBand(activeBand.id, { freq: v })} />
            <PluginKnob label="GAIN" leftSubLabel="-18" rightSubLabel="+18" value={activeBand.gain} min={-18} max={18} step={0.1} defaultValue={0} displayValue={gainDisabled ? 'N/A' : `${activeBand.gain > 0 ? '+' : ''}${activeBand.gain.toFixed(1)}dB`} size="md" disabled={gainDisabled} onChange={(v) => updateBand(activeBand.id, { gain: v })} />
            <PluginKnob label="Q FACTOR" leftSubLabel="WIDE" rightSubLabel="NARROW" value={activeBand.q} min={0.1} max={12} step={0.05} defaultValue={DEFAULT_BANDS[activeBand.id - 1]?.q || 1} displayValue={activeBand.q.toFixed(2)} size="md" isLogarithmic onChange={(v) => updateBand(activeBand.id, { q: v })} />
          </div>
        </div>
      </div>
    </div>
  );
}
