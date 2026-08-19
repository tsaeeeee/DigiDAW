import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Power, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';
import { PluginKnob } from './PluginKnob';

interface LimiterPreset {
  name: string;
  ceiling: number;
  drive: number;
  release: number;
  diodeSat: number;
  truePeak: number;
}

const PRESETS: LimiterPreset[] = [
  { name: 'Mastering -0.1dB', ceiling: -0.1, drive: 3, release: 50, diodeSat: 15, truePeak: 1 },
  { name: 'Analog Slam', ceiling: -0.3, drive: 10, release: 35, diodeSat: 65, truePeak: 1 },
  { name: 'Streaming -0.5dB', ceiling: -0.5, drive: 5, release: 60, diodeSat: 20, truePeak: 1 },
  { name: 'Transparent Wall', ceiling: -0.1, drive: 0, release: 20, diodeSat: 0, truePeak: 1 },
  { name: 'Heavy Brickwall', ceiling: -3, drive: 8, release: 80, diodeSat: 30, truePeak: 1 },
  { name: 'Diode Limiter', ceiling: -0.2, drive: 12, release: 40, diodeSat: 80, truePeak: 1 },
];

interface BrickwallLimiterModalProps {
  slot: EffectSlot;
  slotIndex: number;
  analyser?: any;
  isPlaying?: boolean;
  onUpdateParams: (slotIndex: number, bypassed: boolean, params: Record<string, number>) => void;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
}

export function BrickwallLimiterModal({
  slot,
  slotIndex,
  analyser,
  isPlaying,
  onUpdateParams,
  onClose,
  zIndex,
  onFocus,
}: BrickwallLimiterModalProps) {
  const params = slot.params || {};
  const ceiling = params.ceiling ?? -0.5;
  const drive = params.drive ?? 4;
  const release = params.release ?? 50;
  const diodeSat = params.diodeSat ?? 15;
  const truePeak = params.truePeak ?? 1;
  const isBypassed = !!slot.bypassed;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [position, setPosition] = useState(() => ({
    x: Math.max(20, Math.round(window.innerWidth / 2 - 250)),
    y: Math.max(20, Math.round(window.innerHeight / 2 - 215)),
  }));
  const [presetOpen, setPresetOpen] = useState(false);
  const [selectedPresetName, setSelectedPresetName] = useState('Custom');
  const [metrics, setMetrics] = useState({ input: -80, output: -80, gr: 0, limiting: false });

  const updateParam = (key: string, value: number) => {
    onUpdateParams(slotIndex, isBypassed, { ...params, ceiling, drive, release, diodeSat, truePeak, [key]: value });
    setSelectedPresetName('Custom');
  };

  const applyPreset = (preset: LimiterPreset) => {
    setSelectedPresetName(preset.name);
    setPresetOpen(false);
    onUpdateParams(slotIndex, isBypassed, {
      ceiling: preset.ceiling,
      drive: preset.drive,
      release: preset.release,
      diodeSat: preset.diodeSat,
      truePeak: preset.truePeak,
    });
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
      x: Math.max(10, Math.min(window.innerWidth - 500, moveEvent.clientX - startX)),
      y: Math.max(10, Math.min(window.innerHeight - 430, moveEvent.clientY - startY)),
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

    let frame = 0;
    let smoothGr = 0;
    const history = Array.from({ length: 150 }, () => ({ input: -80, output: -80, gr: 0 }));

    const draw = () => {
      let rawDb = -80;
      const meter = analyser?.preFaderMeter || analyser?.meter;
      if (meter && isPlaying) {
        try {
          const value = meter.getValue();
          if (Array.isArray(value) || value instanceof Float32Array) rawDb = Math.max(Number(value[0]) || -80, Number(value[1]) || -80);
          else if (typeof value === 'number' && Number.isFinite(value)) rawDb = value;
        } catch {}
      }

      const driven = isBypassed ? rawDb : rawDb + drive;
      const targetGr = !isBypassed && driven > ceiling ? driven - ceiling : 0;
      const coeff = targetGr > smoothGr ? 0.9 : Math.min(1, 8 / Math.max(5, release));
      smoothGr += (targetGr - smoothGr) * coeff;
      const out = isBypassed ? rawDb : Math.min(driven, ceiling);
      history.shift();
      history.push({ input: driven, output: out, gr: smoothGr });
      setMetrics({ input: driven, output: out, gr: smoothGr, limiting: targetGr > 0.1 });

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#111116';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#25252d';
      for (const db of [0, -12, -24, -36, -48, -60]) {
        const y = ((0 - db) / 60) * h;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      const ceilY = Math.max(0, Math.min(h, ((0 - ceiling) / 60) * h));
      ctx.strokeStyle = metrics.limiting ? '#ef4444' : '#e879f9';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, ceilY); ctx.lineTo(w, ceilY); ctx.stroke();

      const drawHistory = (key: 'input' | 'output', color: string, lineWidth: number) => {
        ctx.beginPath();
        history.forEach((item, index) => {
          const x = (index / (history.length - 1)) * w;
          const db = item[key];
          const y = h - Math.max(0, Math.min(1, (db + 60) / 60)) * h;
          if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      };
      drawHistory('input', '#9ca3af', 1.2);
      drawHistory('output', '#f472b6', 2);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [analyser, isPlaying, ceiling, drive, release, isBypassed]);

  return (
    <div className="fixed inset-0 z-[300] pointer-events-none">
      <div
        onMouseDown={() => onFocus?.()}
        style={{ left: position.x, top: position.y, width: 500, zIndex: zIndex ?? 310 }}
        className="fixed pointer-events-auto overflow-hidden rounded-xl border border-[#2e2e36] bg-[#141416] shadow-[0_25px_60px_rgba(0,0,0,0.95)] select-none"
      >
        <div onMouseDown={handleHeaderMouseDown} className="h-10 px-3 flex items-center justify-between bg-[#1c1c22] border-b border-[#2d2d38] cursor-move">
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={() => onUpdateParams(slotIndex, !isBypassed, params)} className={cn('w-6 h-6 rounded-full flex items-center justify-center', !isBypassed ? 'bg-[#ec4899] text-black shadow-[0_0_10px_rgba(236,72,153,0.7)]' : 'bg-[#25252c] text-[#777]')}>
              <Power className="w-3.5 h-3.5" />
            </button>
            <span className="font-black text-sm tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-[#f472b6] via-[#e879f9] to-[#c084fc]">Limiter</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex items-center h-6 px-1 rounded bg-[#111114] border border-[#2d2d38]">
              <button type="button" onClick={() => cyclePreset(-1)} className="text-[#888] hover:text-white"><ChevronLeft className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => setPresetOpen((open) => !open)} className="min-w-[120px] px-2 flex items-center justify-between text-[10px] text-[#ccc]"><span className="truncate">{selectedPresetName}</span><ChevronDown className="w-3 h-3" /></button>
              <button type="button" onClick={() => cyclePreset(1)} className="text-[#888] hover:text-white"><ChevronRight className="w-3.5 h-3.5" /></button>
              {presetOpen && <div className="absolute top-7 left-0 right-0 z-[350] py-1 rounded border border-[#3e3e4a] bg-[#18181e] shadow-xl">{PRESETS.map((preset) => <button key={preset.name} type="button" onClick={() => applyPreset(preset)} className="w-full px-2 py-1.5 text-left text-[10px] text-[#ccc] hover:text-[#f472b6] hover:bg-[#282834]">{preset.name}</button>)}</div>}
            </div>
            <button type="button" onClick={onClose} className="w-6 h-6 flex items-center justify-center text-[#888] hover:text-white"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="p-3 bg-[#111115]">
          <canvas ref={canvasRef} width={474} height={135} className="w-full h-[135px] rounded-lg border border-[#282832]" />
          <div className="mt-2 grid grid-cols-3 gap-2 text-[9px] font-mono">
            <div className="rounded bg-[#18181e] border border-[#292934] px-2 py-1.5"><span className="text-[#666]">DRIVEN</span><div className="text-[#ddd]">{metrics.input > -75 ? `${metrics.input.toFixed(1)}dB` : '-∞'}</div></div>
            <div className="rounded bg-[#18181e] border border-[#292934] px-2 py-1.5"><span className="text-[#666]">OUTPUT</span><div className="text-[#f472b6]">{metrics.output > -75 ? `${metrics.output.toFixed(1)}dB` : '-∞'}</div></div>
            <div className="rounded bg-[#18181e] border border-[#292934] px-2 py-1.5"><span className="text-[#666]">GAIN RED.</span><div className={metrics.limiting ? 'text-red-400' : 'text-[#ddd]'}>{`${metrics.gr.toFixed(1)}dB`}</div></div>
          </div>
        </div>

        <div className="px-4 py-4 grid grid-cols-5 gap-2 bg-[#18181e] border-t border-[#292934] justify-items-center">
          <PluginKnob label="CEILING" leftSubLabel="-24" rightSubLabel="0" value={ceiling} min={-24} max={0} step={0.1} defaultValue={-0.5} displayValue={`${ceiling.toFixed(1)}dB`} size="sm" onChange={(v) => updateParam('ceiling', v)} />
          <PluginKnob label="DRIVE" leftSubLabel="0" rightSubLabel="+24" value={drive} min={0} max={24} step={0.1} defaultValue={4} displayValue={`+${drive.toFixed(1)}dB`} size="sm" onChange={(v) => updateParam('drive', v)} />
          <PluginKnob label="RELEASE" leftSubLabel="FAST" rightSubLabel="SLOW" value={release} min={5} max={1000} step={1} defaultValue={50} displayValue={`${Math.round(release)}ms`} size="sm" isLogarithmic onChange={(v) => updateParam('release', v)} />
          <PluginKnob label="SAT" leftSubLabel="CLEAN" rightSubLabel="ANALOG" value={diodeSat} min={0} max={100} step={1} defaultValue={15} displayValue={`${Math.round(diodeSat)}%`} size="sm" onChange={(v) => updateParam('diodeSat', v)} />

          <button type="button" onClick={() => updateParam('truePeak', truePeak === 1 ? 0 : 1)} className="flex flex-col items-center justify-center gap-2">
            <div className={cn('w-14 h-8 rounded-full border p-1 flex items-center transition-all', truePeak === 1 ? 'justify-end border-[#f472b6] bg-[#f472b6]/15' : 'justify-start border-[#383842] bg-[#111114]')}>
              <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-black', truePeak === 1 ? 'bg-gradient-to-r from-[#f472b6] to-[#e879f9] text-black' : 'bg-[#333] text-[#777]')}>{truePeak === 1 ? 'ON' : 'OFF'}</div>
            </div>
            <div className="text-[9px] text-[#f1f1f4] font-extrabold tracking-widest">TRUE PEAK</div>
            <div className="text-[8px] text-[#73737c] font-mono">4x OS</div>
          </button>
        </div>
      </div>
    </div>
  );
}
