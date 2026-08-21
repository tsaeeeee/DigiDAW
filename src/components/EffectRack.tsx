import React, { useEffect, useRef, useState } from 'react';
import { Power, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot, EffectType } from '../types/daw';
import { CompressorModal } from './CompressorModal';
import { EqualizerModal } from './EqualizerModal';
import { BrickwallLimiterModal } from './BrickwallLimiterModal';
import { ReverbModal } from './ReverbModal';
import { DelayModal } from './DelayModal';
import { SaturatorModal } from './SaturatorModal';
import { PitchyModal } from './PitchyModal';
import { DeEsserModal } from './DeEsserModal';

const SLOTS = 7;
let globalPluginZ = 310;
const nextPluginZ = () => ++globalPluginZ;

export const DEDICATED_EFFECTS: { type: EffectType; name: string; shortCode: string; color: string; desc: string }[] = [
  { type: 'Compressor', name: 'Dikompres', shortCode: 'COMP', color: '#fb923c', desc: 'Dynamic range control' },
  { type: 'EQ', name: 'Diequ', shortCode: 'EQ', color: '#38bdf8', desc: 'Five-band equalizer' },
  { type: 'Pitchy', name: 'Ditune', shortCode: 'TUNE', color: '#f472b6', desc: 'Vocal pitch correction' },
  { type: 'Reverb', name: 'Diecho', shortCode: 'ECHO', color: '#c084fc', desc: 'Spatial reverb' },
  { type: 'Delay', name: 'Dipantul', shortCode: 'DLY', color: '#34d399', desc: 'Stereo delay' },
  { type: 'Limiter', name: 'Dilimit', shortCode: 'LIM', color: '#facc15', desc: 'Peak ceiling protection' },
  { type: 'Saturator', name: 'Disaturasi', shortCode: 'SAT', color: '#f97316', desc: 'Harmonic saturation' },
  { type: 'DeEsser', name: 'Disser', shortCode: 'DESS', color: '#22d3ee', desc: 'Dynamic sibilance control' },
];

const SECONDARY_ACCENTS: Record<EffectType, string> = {
  Compressor: '#fdba74',
  EQ: '#60a5fa',
  Pitchy: '#c084fc',
  Reverb: '#e9d5ff',
  Delay: '#86efac',
  Limiter: '#fde047',
  Saturator: '#fb7185',
  DeEsser: '#67e8f9',
};

interface Props {
  effects?: EffectSlot[];
  onUpdateEffect: (slotIndex: number, type: EffectType | null, bypassed?: boolean, params?: Record<string, number>) => void;
  isMaster?: boolean;
  analyser?: any;
  isPlaying?: boolean;
}

interface OpenPluginWindow {
  index: number;
  type: EffectType;
  zIndex: number;
}

export function EffectRack({ effects = [], onUpdateEffect, isMaster = false, analyser, isPlaying }: Props) {
  const [picker, setPicker] = useState<number | null>(null);
  const [openWindows, setOpenWindows] = useState<OpenPluginWindow[]>([]);
  const lastFocusedSlot = useRef<number | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const slots = Array.from({ length: SLOTS }, (_, i) => effects[i] || { id: `slot-${i}`, type: null, bypassed: false });

  useEffect(() => {
    if (picker === null) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!pickerRef.current?.contains(target)) setPicker(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPicker(null);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [picker]);

  const focusWindow = (index: number) => {
    const zIndex = nextPluginZ();
    lastFocusedSlot.current = index;
    setOpenWindows((previous) => previous.map((window) => window.index === index ? { ...window, zIndex } : window));
  };

  const openPluginWindow = (index: number, type: EffectType) => {
    const zIndex = nextPluginZ();
    lastFocusedSlot.current = index;
    setOpenWindows((previous) => {
      const existing = previous.find((window) => window.index === index);
      if (existing) return previous.map((window) => window.index === index ? { index, type, zIndex } : window);
      return [...previous, { index, type, zIndex }];
    });
  };

  const closePluginWindow = (index: number) => {
    setOpenWindows((previous) => previous.filter((window) => window.index !== index));
    if (lastFocusedSlot.current === index) lastFocusedSlot.current = null;
  };

  const openSlot = (index: number, slot: EffectSlot) => {
    if (slot.type) openPluginWindow(index, slot.type);
    else setPicker(index);
  };

  const modalProps = (window: OpenPluginWindow) => ({
    slot: slots[window.index],
    slotIndex: window.index,
    analyser,
    isPlaying,
    onUpdateParams: (i: number, b: boolean, p: Record<string, number>) => onUpdateEffect(i, window.type, b, p),
    onClose: () => closePluginWindow(window.index),
    zIndex: window.zIndex,
    onFocus: () => focusWindow(window.index),
  });

  const themeStyle = (type: EffectType) => {
    const meta = DEDICATED_EFFECTS.find(effect => effect.type === type);
    return {
      '--plugin-title': JSON.stringify(meta?.name || type),
      '--plugin-accent': meta?.color || '#f472b6',
      '--plugin-accent-2': SECONDARY_ACCENTS[type],
    } as React.CSSProperties;
  };

  const themeClass = (type: EffectType) => `plugin-title-patch plugin-themed plugin-theme-${type.toLowerCase()}`;
  const validWindows = openWindows.filter((window) => slots[window.index]?.type === window.type);

  return <div className={cn('daw-effect-rack w-full flex flex-col gap-1 my-1 relative', isMaster && 'daw-effect-rack-master')}>
    <div className="w-full bg-[#111113] border border-black rounded p-0.5 flex flex-col gap-0.5 shadow-inner max-h-[83px] overflow-y-auto custom-scrollbar">
      {slots.map((slot, i) => {
        const meta = slot.type ? DEDICATED_EFFECTS.find(x => x.type === slot.type) : null;
        const bypass = !!slot.bypassed;
        return <div key={slot.id || i} onClick={() => openSlot(i, slot)} className={cn('h-[18px] shrink-0 rounded-[2px] border text-[8px] flex items-center justify-between px-1 cursor-pointer', meta ? 'bg-[#1e1f26] border-[#3a3d4a] text-white' : 'bg-[#151517] border-[#222226] text-[#555]')}>
          <div className="flex items-center gap-1 min-w-0">{meta ? <><span className="px-1 rounded-[1px] text-[7px] font-black text-black" style={{ backgroundColor: bypass ? '#444' : meta.color }}>{meta.shortCode}</span><span className={cn('truncate font-medium', bypass && 'line-through opacity-50')}>{meta.name}</span></> : <span className="italic">Insert fx</span>}</div>
          {meta && <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}><button onClick={() => onUpdateEffect(i, slot.type, !bypass, slot.params)} className="p-0.5" style={{ color: bypass ? '#666' : meta.color }}><Power className="w-2 h-2" /></button><button onClick={() => { closePluginWindow(i); onUpdateEffect(i, null, false); }} className="p-0.5 text-[#666] hover:text-red-400"><X className="w-2 h-2" /></button></div>}
        </div>;
      })}
    </div>

    {isMaster && <MasterMixerAnalysis analyser={analyser} isPlaying={!!isPlaying} />}

    {picker !== null && <div ref={pickerRef} className="absolute top-[86px] left-0 z-[420] w-44 rounded-md border border-[#34343d] bg-[#17171d] p-1.5 shadow-2xl">
      <div className="mb-1 flex items-center justify-between border-b border-[#292932] px-1 pb-1">
        <span className="text-[7px] font-black tracking-[0.16em] text-[#696975]">SELECT EFFECT</span>
        <button
          type="button"
          aria-label="Close effect picker"
          onClick={() => setPicker(null)}
          className="rounded p-0.5 text-[#72727d] hover:bg-[#282832] hover:text-white"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </div>
      {DEDICATED_EFFECTS.map(meta => <button key={meta.type} onClick={() => { onUpdateEffect(picker, meta.type, false); openPluginWindow(picker, meta.type); setPicker(null); }} className="w-full flex items-center gap-2 px-1.5 py-1 rounded hover:bg-[#282832] text-left"><span className="min-w-[38px] px-1 py-0.5 rounded-[2px] text-center text-[7px] font-black text-black" style={{ backgroundColor: meta.color }}>{meta.shortCode}</span><span className="text-[9px] text-white font-bold truncate">{meta.name}</span></button>)}
    </div>}

    {validWindows.map((window) => {
      const props = modalProps(window);
      return <div key={`${window.index}-${window.type}`} className={themeClass(window.type)} style={themeStyle(window.type)}>
        {window.type === 'Compressor' && <CompressorModal {...props} />}
        {window.type === 'EQ' && <EqualizerModal {...props} />}
        {window.type === 'Pitchy' && <PitchyModal {...props} />}
        {window.type === 'Reverb' && <ReverbModal {...props} />}
        {window.type === 'Delay' && <DelayModal {...props} />}
        {window.type === 'Limiter' && <BrickwallLimiterModal {...props} />}
        {window.type === 'Saturator' && <SaturatorModal {...props} />}
        {window.type === 'DeEsser' && <DeEsserModal {...props} />}
      </div>;
    })}
  </div>;
}

function MasterMixerAnalysis({ analyser, isPlaying }: { analyser?: any; isPlaying: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId = 0;
    const dbToLevel = (db: number) => {
      if (!Number.isFinite(db)) return 0;
      return Math.max(0, Math.min(1, (db + 60) / 60));
    };

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = '#0b0c0e';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = 'rgba(255,255,255,0.055)';
      ctx.lineWidth = 1;
      for (let y = 16; y < height - 28; y += 18) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
        ctx.stroke();
      }
      for (let x = 18; x < width; x += 22) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height - 28);
        ctx.stroke();
      }

      let spectrum: ArrayLike<number> | null = null;
      try {
        const raw = analyser?.fft?.getValue?.();
        if (raw instanceof Float32Array) spectrum = raw;
        else if (Array.isArray(raw) && raw.length && typeof raw[0] === 'number') spectrum = raw as number[];
        else if (Array.isArray(raw) && raw[0] instanceof Float32Array) spectrum = raw[0];
      } catch {
        spectrum = null;
      }

      const spectrumHeight = height - 36;
      const bars = 22;
      const gap = 2;
      const barWidth = (width - gap * (bars - 1)) / bars;
      for (let i = 0; i < bars; i++) {
        let level = 0;
        if (spectrum && spectrum.length) {
          const start = Math.floor(Math.pow(i / bars, 1.8) * spectrum.length);
          const end = Math.max(start + 1, Math.floor(Math.pow((i + 1) / bars, 1.8) * spectrum.length));
          let peak = -120;
          for (let b = start; b < Math.min(end, spectrum.length); b++) {
            const value = Number(spectrum[b]);
            if (Number.isFinite(value)) peak = Math.max(peak, value);
          }
          level = Math.max(0, Math.min(1, (peak + 78) / 72));
        }
        const barHeight = Math.max(1, level * spectrumHeight);
        const x = i * (barWidth + gap);
        const y = spectrumHeight - barHeight;
        const alpha = 0.28 + level * 0.72;
        ctx.fillStyle = `rgba(255, 217, 0, ${alpha})`;
        ctx.fillRect(x, y, Math.max(1, barWidth), barHeight);
      }

      let dbL = -60;
      let dbR = -60;
      try {
        const meter = analyser?.meter?.getValue?.();
        if (Array.isArray(meter) || meter instanceof Float32Array) {
          dbL = Number.isFinite(Number(meter[0])) ? Number(meter[0]) : -60;
          dbR = Number.isFinite(Number(meter[1])) ? Number(meter[1]) : dbL;
        } else if (Number.isFinite(Number(meter))) {
          dbL = Number(meter);
          dbR = Number(meter);
        }
      } catch {
        dbL = -60;
        dbR = -60;
      }

      const l = dbToLevel(dbL);
      const r = dbToLevel(dbR);
      const meterTop = height - 23;
      const meterWidth = width - 18;
      ctx.fillStyle = '#17191d';
      ctx.fillRect(9, meterTop, meterWidth, 5);
      ctx.fillRect(9, meterTop + 9, meterWidth, 5);
      ctx.fillStyle = '#ffd900';
      ctx.fillRect(9, meterTop, meterWidth * l, 5);
      ctx.fillRect(9, meterTop + 9, meterWidth * r, 5);
      ctx.fillStyle = '#777b83';
      ctx.font = '7px Kumbh Sans, sans-serif';
      ctx.fillText('L', 1, meterTop + 5);
      ctx.fillText('R', 1, meterTop + 14);

      frameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(frameId);
  }, [analyser]);

  return (
    <div className="daw-master-analysis pointer-events-none" aria-hidden="true">
      <div className="daw-master-analysis-head">
        <span>Master analysis</span>
        <span className={cn('daw-master-analysis-dot', isPlaying && 'is-live')} />
      </div>
      <canvas ref={canvasRef} width={112} height={174} className="daw-master-analysis-canvas" />
      <div className="daw-master-analysis-footer"><span>40 Hz</span><span>20 kHz</span></div>
    </div>
  );
}