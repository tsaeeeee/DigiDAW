import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Power, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';
import { SaturationMode, calculateSaturationParameters, createSaturationCurve } from '../dsp/saturator/SaturationNode';
import { PluginKnob } from './PluginKnob';

interface SaturatorPreset {
  name: string;
  inputGain: number;
  saturationDrive: number;
  saturationMode: SaturationMode;
  outputGain: number;
}

const PRESETS: SaturatorPreset[] = [
  { name: 'Default', inputGain: 0, saturationDrive: 3, saturationMode: 'normal', outputGain: 0 },
  { name: 'Subtle Console', inputGain: 2, saturationDrive: 1.5, saturationMode: 'clean', outputGain: -1 },
  { name: 'Warm Tape', inputGain: 3, saturationDrive: 4, saturationMode: 'normal', outputGain: -1.5 },
  { name: 'Hot Tube', inputGain: 5, saturationDrive: 6.5, saturationMode: 'hot', outputGain: -3 },
  { name: 'Redline Crush', inputGain: 8, saturationDrive: 8.5, saturationMode: 'redline', outputGain: -5 },
  { name: 'Clean Boost', inputGain: 4, saturationDrive: 0, saturationMode: 'clean', outputGain: 0 },
];

interface SaturatorModalProps {
  slot: EffectSlot;
  slotIndex: number;
  analyser?: any;
  isPlaying?: boolean;
  onUpdateParams: (slotIndex: number, bypassed: boolean, params: Record<string, number>) => void;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
}

export function SaturatorModal({
  slot,
  slotIndex,
  analyser,
  isPlaying,
  onUpdateParams,
  onClose,
  zIndex,
  onFocus,
}: SaturatorModalProps) {
  const params = slot.params || {};
  const inputGain = params.inputGain ?? 0;
  const saturationDrive = params.saturationDrive ?? 3;
  const modeIndex = params.modeIndex ?? 1;
  const outputGain = params.outputGain ?? 0;
  const isBypassed = !!slot.bypassed;
  const modes: SaturationMode[] = ['clean', 'normal', 'hot', 'redline'];
  const currentMode = modes[modeIndex] || 'normal';

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [position, setPosition] = useState(() => ({
    x: Math.max(20, Math.round(window.innerWidth / 2 - 235)),
    y: Math.max(20, Math.round(window.innerHeight / 2 - 215)),
  }));
  const [presetOpen, setPresetOpen] = useState(false);
  const [selectedPresetName, setSelectedPresetName] = useState('Custom');

  const updateParam = (key: string, value: number) => {
    onUpdateParams(slotIndex, isBypassed, { ...params, inputGain, saturationDrive, modeIndex, outputGain, [key]: value });
    setSelectedPresetName('Custom');
  };

  const applyPreset = (preset: SaturatorPreset) => {
    const nextMode = Math.max(0, modes.indexOf(preset.saturationMode));
    setSelectedPresetName(preset.name);
    setPresetOpen(false);
    onUpdateParams(slotIndex, isBypassed, {
      inputGain: preset.inputGain,
      saturationDrive: preset.saturationDrive,
      modeIndex: nextMode,
      outputGain: preset.outputGain,
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
      x: Math.max(10, Math.min(window.innerWidth - 470, moveEvent.clientX - startX)),
      y: Math.max(10, Math.min(window.innerHeight - 420, moveEvent.clientY - startY)),
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
    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#111116';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = '#292934';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
      ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
      ctx.stroke();

      ctx.strokeStyle = '#3a3a44';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(w, 0); ctx.stroke();
      ctx.setLineDash([]);

      const { driveAmt, asymmetry } = calculateSaturationParameters(inputGain, saturationDrive, currentMode);
      const curve = createSaturationCurve(driveAmt, asymmetry, 320);
      ctx.beginPath();
      for (let i = 0; i < curve.length; i++) {
        const x = (i / (curve.length - 1)) * w;
        const y = (1 - (curve[i] + 1) / 2) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = isBypassed ? '#666' : '#f97316';
      ctx.shadowColor = isBypassed ? 'transparent' : 'rgba(249,115,22,0.55)';
      ctx.shadowBlur = isBypassed ? 0 : 7;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.shadowBlur = 0;

      let inputDb = -80;
      const meter = analyser?.preFaderMeter || analyser?.meter;
      if (meter && isPlaying) {
        try {
          const value = meter.getValue();
          if (Array.isArray(value) || value instanceof Float32Array) inputDb = Math.max(Number(value[0]) || -80, Number(value[1]) || -80);
          else if (typeof value === 'number') inputDb = value;
        } catch {}
      }
      if (!isBypassed && inputDb > -60) {
        const norm = Math.max(0, Math.min(1, (inputDb + 60) / 60));
        const index = Math.min(curve.length - 1, Math.round(norm * (curve.length - 1)));
        ctx.fillStyle = '#fb7185';
        ctx.beginPath();
        ctx.arc(norm * w, (1 - (curve[index] + 1) / 2) * h, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#777';
      ctx.font = '9px monospace';
      ctx.fillText(`${currentMode} · Drive x${driveAmt.toFixed(2)}`, 8, 14);
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [analyser, isPlaying, inputGain, saturationDrive, currentMode, isBypassed]);

  return (
    <div className="fixed inset-0 z-[300] pointer-events-none">
      <div
        onMouseDown={() => onFocus?.()}
        style={{ left: position.x, top: position.y, width: 470, zIndex: zIndex ?? 310 }}
        className="fixed pointer-events-auto overflow-hidden rounded-xl border border-[#2e2e36] bg-[#141416] shadow-[0_25px_60px_rgba(0,0,0,0.95)] select-none"
      >
        <div onMouseDown={handleHeaderMouseDown} className="h-10 px-3 flex items-center justify-between bg-[#1c1c22] border-b border-[#2d2d38] cursor-move">
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={() => onUpdateParams(slotIndex, !isBypassed, params)} className={cn('w-6 h-6 rounded-full flex items-center justify-center', !isBypassed ? 'bg-[#ec4899] text-black shadow-[0_0_10px_rgba(236,72,153,0.7)]' : 'bg-[#25252c] text-[#777]')}>
              <Power className="w-3.5 h-3.5" />
            </button>
            <span className="font-black text-sm tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-[#f472b6] via-[#e879f9] to-[#c084fc]">Saturator</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex items-center h-6 px-1 rounded bg-[#111114] border border-[#2d2d38]">
              <button type="button" onClick={() => cyclePreset(-1)} className="text-[#888] hover:text-white"><ChevronLeft className="w-3.5 h-3.5" /></button>
              <button type="button" onClick={() => setPresetOpen((open) => !open)} className="min-w-[105px] px-2 flex items-center justify-between text-[10px] text-[#ccc]">
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

        <div className="p-3 bg-[#111115]"><canvas ref={canvasRef} width={444} height={140} className="w-full h-[140px] rounded-lg border border-[#282832]" /></div>

        <div className="px-4 py-2.5 flex items-center justify-center gap-1 bg-[#18181e] border-t border-[#292934]">
          {modes.map((mode, index) => (
            <button
              key={mode}
              type="button"
              onClick={() => updateParam('modeIndex', index)}
              className={cn('px-4 py-1.5 rounded-full text-[9px] font-black tracking-wider border transition-all', modeIndex === index ? 'bg-gradient-to-r from-[#f472b6] to-[#e879f9] border-[#f472b6] text-black shadow-[0_0_8px_rgba(244,114,182,0.35)]' : 'bg-[#111114] border-[#2d2d38] text-[#777] hover:text-white')}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        <div className="px-6 py-4 grid grid-cols-3 gap-4 bg-[#18181e] border-t border-[#292934] justify-items-center">
          <PluginKnob label="INPUT GAIN" leftSubLabel="-20" rightSubLabel="+20" value={inputGain} min={-20} max={20} step={0.1} defaultValue={0} displayValue={`${inputGain > 0 ? '+' : ''}${inputGain.toFixed(1)}dB`} size="md" onChange={(v) => updateParam('inputGain', v)} />
          <PluginKnob label="DRIVE" leftSubLabel="CLEAN" rightSubLabel="CRUSH" value={saturationDrive} min={0} max={10} step={0.1} defaultValue={3} displayValue={saturationDrive.toFixed(1)} size="md" onChange={(v) => updateParam('saturationDrive', v)} />
          <PluginKnob label="OUTPUT" leftSubLabel="-12" rightSubLabel="+12" value={outputGain} min={-12} max={12} step={0.1} defaultValue={0} displayValue={`${outputGain > 0 ? '+' : ''}${outputGain.toFixed(1)}dB`} size="md" onChange={(v) => updateParam('outputGain', v)} />
        </div>
      </div>
    </div>
  );
}
