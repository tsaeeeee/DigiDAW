import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Power, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';
import { PluginKnob } from './PluginKnob';

interface CompressorPreset {
  name: string;
  attack: number;
  release: number;
  ratio: number;
  threshold: number;
  output: number;
}

const PRESETS: CompressorPreset[] = [
  { name: 'Default', attack: 10, release: 100, ratio: 4, threshold: -20, output: 0 },
  { name: 'Punchy Drums', attack: 15, release: 80, ratio: 6, threshold: -18, output: 3 },
  { name: 'Smooth Vocal', attack: 5, release: 150, ratio: 3, threshold: -22, output: 2 },
  { name: 'Bass Control', attack: 25, release: 120, ratio: 4, threshold: -16, output: 2 },
  { name: 'Hard Slam', attack: 0.5, release: 40, ratio: 12, threshold: -28, output: 6 },
  { name: 'Master Bus', attack: 30, release: 100, ratio: 2, threshold: -12, output: 1 },
];

interface CompressorModalProps {
  slot: EffectSlot;
  slotIndex: number;
  analyser?: any;
  isPlaying?: boolean;
  onUpdateParams: (slotIndex: number, bypassed: boolean, params: Record<string, number>) => void;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
}

export function CompressorModal({
  slot,
  slotIndex,
  analyser,
  isPlaying,
  onUpdateParams,
  onClose,
  zIndex,
  onFocus,
}: CompressorModalProps) {
  const params = slot.params || {};
  const attack = params.attack ?? 10;
  const release = params.release ?? 100;
  const ratio = params.ratio ?? 4;
  const threshold = params.threshold ?? -20;
  const output = params.output ?? 0;
  const isBypassed = !!slot.bypassed;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [position, setPosition] = useState(() => ({
    x: Math.max(20, Math.round(window.innerWidth / 2 - 245)),
    y: Math.max(20, Math.round(window.innerHeight / 2 - 205)),
  }));
  const [presetOpen, setPresetOpen] = useState(false);
  const [selectedPresetName, setSelectedPresetName] = useState('Custom');

  const updateParam = (key: string, value: number) => {
    onUpdateParams(slotIndex, isBypassed, { ...params, attack, release, ratio, threshold, output, [key]: value });
    setSelectedPresetName('Custom');
  };

  const applyPreset = (preset: CompressorPreset) => {
    setSelectedPresetName(preset.name);
    setPresetOpen(false);
    onUpdateParams(slotIndex, isBypassed, {
      attack: preset.attack,
      release: preset.release,
      ratio: preset.ratio,
      threshold: preset.threshold,
      output: preset.output,
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
      x: Math.max(10, Math.min(window.innerWidth - 490, moveEvent.clientX - startX)),
      y: Math.max(10, Math.min(window.innerHeight - 400, moveEvent.clientY - startY)),
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
    let currentGr = 0;
    const history = Array.from({ length: 140 }, () => ({ input: -80, gr: 0 }));

    const draw = () => {
      let inputDb = -80;
      const meter = analyser?.preFaderMeter || analyser?.meter;
      if (meter && isPlaying) {
        try {
          const value = meter.getValue();
          if (Array.isArray(value) || value instanceof Float32Array) inputDb = Math.max(Number(value[0]) || -80, Number(value[1]) || -80);
          else if (typeof value === 'number' && Number.isFinite(value)) inputDb = value;
        } catch {}
      }

      const targetGr = !isBypassed && inputDb > threshold && ratio > 1
        ? (inputDb - threshold) * (1 - 1 / ratio)
        : 0;
      const coeff = targetGr > currentGr
        ? Math.min(1, 8 / Math.max(0.1, attack))
        : Math.min(1, 8 / Math.max(10, release));
      currentGr += (targetGr - currentGr) * coeff;
      history.shift();
      history.push({ input: inputDb, gr: currentGr });

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#111116';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#25252d';
      ctx.lineWidth = 1;
      for (const db of [0, -20, -40, -60]) {
        const y = ((0 - db) / 60) * h;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      const thresholdY = Math.max(0, Math.min(h, ((0 - threshold) / 60) * h));
      ctx.strokeStyle = '#fb923c';
      ctx.beginPath(); ctx.moveTo(0, thresholdY); ctx.lineTo(w, thresholdY); ctx.stroke();

      ctx.beginPath();
      history.forEach((item, index) => {
        const x = (index / (history.length - 1)) * w;
        const y = h - Math.max(0, Math.min(1, (item.input + 60) / 60)) * h;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#9ca3af';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      history.forEach((item, index) => {
        const x = (index / (history.length - 1)) * w;
        const y = 8 + Math.min(1, item.gr / 24) * (h - 16);
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#fdba74';
      ctx.lineWidth = 2;
      ctx.stroke();

      frame = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(frame);
  }, [analyser, isPlaying, threshold, ratio, attack, release, isBypassed]);

  return (
    <div className="fixed inset-0 z-[300] pointer-events-none">
      <div
        onMouseDown={() => onFocus?.()}
        style={{ left: position.x, top: position.y, width: 490, zIndex: zIndex ?? 310 }}
        className="fixed pointer-events-auto overflow-hidden rounded-xl border border-[#2e2e36] bg-[#141416] shadow-[0_25px_60px_rgba(0,0,0,0.95)] select-none"
      >
        <div onMouseDown={handleHeaderMouseDown} className="h-10 px-3 flex items-center justify-between bg-[#1c1c22] border-b border-[#2d2d38] cursor-move">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => onUpdateParams(slotIndex, !isBypassed, params)}
              className={cn('w-6 h-6 rounded-full flex items-center justify-center', !isBypassed ? 'bg-[#ec4899] text-black shadow-[0_0_10px_rgba(236,72,153,0.7)]' : 'bg-[#25252c] text-[#777]')}
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <span className="font-black text-sm tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-[#f472b6] via-[#e879f9] to-[#c084fc]">Compressor</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex items-center h-6 px-1 rounded bg-[#111114] border border-[#2d2d38]">
              <button type="button" onClick={() => cyclePreset(-1)} className="text-[#888] hover:text-white"><ChevronLeft className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => setPresetOpen((open) => !open)} className="min-w-[110px] px-2 flex items-center justify-between text-[10px] text-[#ccc]">
                <span className="truncate">{selectedPresetName}</span><ChevronDown className="w-3 h-3" />
              </button>
              <button type="button" onClick={() => cyclePreset(1)} className="text-[#888] hover:text-white"><ChevronRight className="w-3.5 h-3.5" /></button>
              {presetOpen && (
                <div className="absolute top-7 left-0 right-0 z-[350] py-1 rounded border border-[#3e3e4a] bg-[#18181e] shadow-xl">
                  {PRESETS.map((preset) => <button key={preset.name} type="button" onClick={() => applyPreset(preset)} className="w-full px-2 py-1.5 text-left text-[10px] text-[#ccc] hover:text-[#f472b6] hover:bg-[#282834]">{preset.name}</button>)}
                </div>
              )}
            </div>
            <button type="button" onClick={onClose} className="w-6 h-6 flex items-center justify-center text-[#888] hover:text-white"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="p-3 bg-[#111115]">
          <canvas ref={canvasRef} width={464} height={130} className="w-full h-[130px] rounded-lg border border-[#282832]" />
        </div>

        <div className="px-3 py-4 grid grid-cols-5 gap-1 bg-[#18181e] border-t border-[#292934]">
          <PluginKnob label="ATTACK" leftSubLabel="FAST" rightSubLabel="SLOW" value={attack} min={0.1} max={100} step={0.1} defaultValue={10} displayValue={`${attack < 10 ? attack.toFixed(1) : Math.round(attack)}ms`} size="sm" isLogarithmic onChange={(v) => updateParam('attack', v)} />
          <PluginKnob label="RELEASE" leftSubLabel="FAST" rightSubLabel="SLOW" value={release} min={10} max={1000} step={1} defaultValue={100} displayValue={`${Math.round(release)}ms`} size="sm" isLogarithmic onChange={(v) => updateParam('release', v)} />
          <PluginKnob label="RATIO" leftSubLabel="1:1" rightSubLabel="20:1" value={ratio} min={1} max={20} step={0.1} defaultValue={4} displayValue={`${ratio.toFixed(1)}:1`} size="sm" onChange={(v) => updateParam('ratio', v)} />
          <PluginKnob label="THRESHOLD" leftSubLabel="-60" rightSubLabel="0" value={threshold} min={-60} max={0} step={0.1} defaultValue={-20} displayValue={`${threshold.toFixed(1)}dB`} size="sm" onChange={(v) => updateParam('threshold', v)} />
          <PluginKnob label="OUTPUT" leftSubLabel="-12" rightSubLabel="+24" value={output} min={-12} max={24} step={0.1} defaultValue={0} displayValue={`${output > 0 ? '+' : ''}${output.toFixed(1)}dB`} size="sm" onChange={(v) => updateParam('output', v)} />
        </div>
      </div>
    </div>
  );
}
