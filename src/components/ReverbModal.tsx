import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Power, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';
import { ProReverbNode } from '../dsp/reverb/ProReverbNode';
import { PluginKnob } from './PluginKnob';

interface ReverbPreset {
  name: string;
  hcut: number;
  lcut: number;
  predelay: number;
  size: number;
  mod: number;
  diff: number;
  speed: number;
  bass: number;
  decay: number;
  cross: number;
  damp: number;
  dry: number;
  er: number;
  wet: number;
  sep: number;
  mode: number;
}

const PRESETS: ReverbPreset[] = [
  { name: 'Studio Plate', hcut: 15000, lcut: 100, predelay: 18, size: 68, mod: 22, diff: 88, speed: 1.2, bass: 1.0, decay: 2.8, cross: 450, damp: 6800, dry: 100, er: 28, wet: 42, sep: 22, mode: 0 },
  { name: 'Warm Chamber', hcut: 11000, lcut: 90, predelay: 22, size: 56, mod: 14, diff: 74, speed: 0.8, bass: 1.08, decay: 1.9, cross: 380, damp: 5600, dry: 100, er: 48, wet: 36, sep: 12, mode: 0 },
  { name: 'Wide Hall', hcut: 13500, lcut: 120, predelay: 38, size: 88, mod: 34, diff: 92, speed: 0.65, bass: 1.1, decay: 4.9, cross: 520, damp: 4800, dry: 100, er: 36, wet: 52, sep: 52, mode: 0 },
  { name: 'Dark Vocal Space', hcut: 8200, lcut: 160, predelay: 55, size: 72, mod: 18, diff: 86, speed: 1.1, bass: 0.95, decay: 3.2, cross: 430, damp: 3600, dry: 100, er: 30, wet: 40, sep: 28, mode: 0 },
  { name: 'Endless Side Space', hcut: 16000, lcut: 70, predelay: 70, size: 98, mod: 62, diff: 96, speed: 0.45, bass: 1.18, decay: 9.5, cross: 650, damp: 3900, dry: 78, er: 32, wet: 76, sep: 72, mode: 1 },
];

interface ReverbModalProps {
  slot: EffectSlot;
  slotIndex: number;
  analyser?: any;
  isPlaying?: boolean;
  onUpdateParams: (slotIndex: number, bypassed: boolean, params: Record<string, number>) => void;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
}

function rmsToPercent(rms: number) {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1">
      <div className="flex items-center justify-between text-[8px] font-mono text-[#777] mb-1">
        <span>{label}</span>
        <span>{Math.round(value)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-[#22232a] overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#f472b6] via-[#e879f9] to-[#c084fc] shadow-[0_0_7px_rgba(232,121,249,0.5)] transition-[width] duration-75"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

export function ReverbModal({
  slot,
  slotIndex,
  onUpdateParams,
  onClose,
  zIndex,
  onFocus,
}: ReverbModalProps) {
  const params = slot.params || {};
  const isBypassed = !!slot.bypassed;

  const hcut = params.hcut ?? 12000;
  const lcut = params.lcut ?? 120;
  const predelay = params.predelay ?? 20;
  const size = params.size ?? 65;
  const mod = params.mod ?? 30;
  const diff = params.diff ?? 80;
  const speed = params.speed ?? 1.5;
  const bass = params.bass ?? 1;
  const decay = params.decay ?? 2.5;
  const cross = params.cross ?? 500;
  const damp = params.damp ?? 5000;
  const dry = params.dry ?? 100;
  const er = params.er ?? 40;
  const wet = params.wet ?? 50;
  const sep = params.sep ?? 0;
  const mode = params.mode ?? 0;

  const [selectedPresetName, setSelectedPresetName] = useState('Custom');
  const [presetOpen, setPresetOpen] = useState(false);
  const [meters, setMeters] = useState({ input: 0, wet: 0, output: 0, active: false });
  const [position, setPosition] = useState(() => ({
    x: Math.max(20, Math.round(window.innerWidth / 2 - 390)),
    y: Math.max(20, Math.round(window.innerHeight / 2 - 245)),
  }));
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const updateParam = (key: string, value: number) => {
    onUpdateParams(slotIndex, isBypassed, { ...params, [key]: value });
    setSelectedPresetName('Custom');
  };

  const toggleBypass = () => onUpdateParams(slotIndex, !isBypassed, params);

  const applyPreset = (preset: ReverbPreset) => {
    setSelectedPresetName(preset.name);
    setPresetOpen(false);
    onUpdateParams(slotIndex, isBypassed, { ...params, ...preset, name: undefined } as any);
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
    onFocus?.();
    dragging.current = true;
    dragOffset.current = { x: event.clientX - position.x, y: event.clientY - position.y };

    const move = (moveEvent: MouseEvent) => {
      if (!dragging.current) return;
      setPosition({
        x: Math.max(10, Math.min(window.innerWidth - 780, moveEvent.clientX - dragOffset.current.x)),
        y: Math.max(10, Math.min(window.innerHeight - 490, moveEvent.clientY - dragOffset.current.y)),
      });
    };
    const up = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      const node = ProReverbNode.lastActiveInstance;
      if (!node) {
        setMeters({ input: 0, wet: 0, output: 0, active: false });
        return;
      }
      const telemetry = node.getTelemetry();
      setMeters({
        input: rmsToPercent(telemetry.inputRms),
        wet: rmsToPercent(telemetry.reverbRms),
        output: rmsToPercent(telemetry.outputRms),
        active: telemetry.isProcessing,
      });
    }, 60);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-[300] pointer-events-none">
      <div
        onMouseDown={() => onFocus?.()}
        style={{ left: position.x, top: position.y, width: 780, zIndex: zIndex ?? 310 }}
        className="fixed pointer-events-auto overflow-hidden rounded-xl border border-[#2e2e36] bg-[#141416] shadow-[0_25px_60px_rgba(0,0,0,0.95)] font-sans select-none"
      >
        <div
          onMouseDown={handleHeaderMouseDown}
          className="h-10 px-3.5 flex items-center justify-between bg-[#1c1c22] border-b border-[#2d2d38] cursor-move"
        >
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={toggleBypass}
              className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center transition-all',
                !isBypassed
                  ? 'bg-[#ec4899] text-black shadow-[0_0_10px_rgba(236,72,153,0.7)]'
                  : 'bg-[#25252c] text-[#777]',
              )}
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-baseline gap-2">
              <span className="font-black text-sm tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-[#f472b6] via-[#e879f9] to-[#c084fc]">
                DigiVerb
              </span>
              <span className="text-[9px] text-[#6b7280] font-mono tracking-widest">CONVOLUTION REVERB</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex items-center h-6.5 px-1 bg-[#111114] border border-[#2d2d38] rounded-md">
              <button type="button" onClick={() => cyclePreset(-1)} className="p-0.5 text-[#888] hover:text-white">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPresetOpen((open) => !open)}
                className="min-w-[145px] px-2 flex items-center justify-between gap-2 text-[10px] font-bold tracking-wide uppercase text-[#d1d5db]"
              >
                <span className="truncate">{selectedPresetName}</span>
                <ChevronDown className="w-3 h-3 text-[#777]" />
              </button>
              <button type="button" onClick={() => cyclePreset(1)} className="p-0.5 text-[#888] hover:text-white">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              {presetOpen && (
                <div className="absolute top-8 left-0 right-0 z-[350] py-1 rounded-md border border-[#3e3e4a] bg-[#18181e] shadow-2xl">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="w-full px-2.5 py-1.5 text-left text-[10px] text-[#ccc] hover:text-[#f472b6] hover:bg-[#282834]"
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded text-[#888] hover:text-white hover:bg-[#282834]">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-3 bg-[#111115] border-b border-[#25252d] flex items-center gap-5">
          <div className={cn('flex items-center gap-2 text-[9px] font-black tracking-widest', meters.active && !isBypassed ? 'text-[#f472b6]' : 'text-[#555]')}>
            <span className={cn('w-2 h-2 rounded-full', meters.active && !isBypassed ? 'bg-[#f472b6] shadow-[0_0_8px_rgba(244,114,182,0.8)]' : 'bg-[#333]')} />
            {isBypassed ? 'BYPASSED' : meters.active ? 'PROCESSING' : 'IDLE'}
          </div>
          <Meter label="INPUT" value={meters.input} />
          <Meter label="WET" value={meters.wet} />
          <Meter label="OUTPUT" value={meters.output} />
        </div>

        <div className="p-4 grid grid-cols-12 gap-3 bg-[#141416]">
          <section className="col-span-5 rounded-xl border border-[#292934] bg-[#18181e] p-3">
            <div className="text-[9px] font-black tracking-[0.18em] text-[#a78bfa] mb-3">ROOM / TAIL</div>
            <div className="grid grid-cols-3 gap-x-3 gap-y-4 justify-items-center">
              <PluginKnob label="DECAY" leftSubLabel="SHORT" rightSubLabel="LONG" value={decay} min={0.2} max={20} step={0.1} defaultValue={2.5} displayValue={`${decay.toFixed(1)}s`} size="md" onChange={(v) => updateParam('decay', v)} />
              <PluginKnob label="SIZE" leftSubLabel="TIGHT" rightSubLabel="HUGE" value={size} min={10} max={100} step={1} defaultValue={65} displayValue={`${Math.round(size)}%`} size="md" onChange={(v) => updateParam('size', v)} />
              <PluginKnob label="PRE-DELAY" leftSubLabel="0" rightSubLabel="200" value={predelay} min={0} max={200} step={1} defaultValue={20} displayValue={`${Math.round(predelay)}ms`} size="md" onChange={(v) => updateParam('predelay', v)} />
              <PluginKnob label="DIFFUSION" leftSubLabel="SPARSE" rightSubLabel="DENSE" value={diff} min={0} max={100} step={1} defaultValue={80} displayValue={`${Math.round(diff)}%`} size="md" onChange={(v) => updateParam('diff', v)} />
              <PluginKnob label="EARLY REF" leftSubLabel="LESS" rightSubLabel="MORE" value={er} min={0} max={100} step={1} defaultValue={40} displayValue={`${Math.round(er)}%`} size="md" onChange={(v) => updateParam('er', v)} />
              <PluginKnob label="DAMPING" leftSubLabel="DARK" rightSubLabel="OPEN" value={damp} min={500} max={18000} step={100} defaultValue={5000} displayValue={`${(damp / 1000).toFixed(1)}k`} size="md" isLogarithmic onChange={(v) => updateParam('damp', v)} />
            </div>
          </section>

          <section className="col-span-4 rounded-xl border border-[#292934] bg-[#18181e] p-3">
            <div className="text-[9px] font-black tracking-[0.18em] text-[#f472b6] mb-3">TONE / MOVEMENT</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-4 justify-items-center">
              <PluginKnob label="LOW CUT" leftSubLabel="20" rightSubLabel="2K" value={lcut} min={20} max={2000} step={10} defaultValue={120} displayValue={`${Math.round(lcut)}Hz`} size="md" isLogarithmic onChange={(v) => updateParam('lcut', v)} />
              <PluginKnob label="HIGH CUT" leftSubLabel="1K" rightSubLabel="20K" value={hcut} min={1000} max={20000} step={100} defaultValue={12000} displayValue={`${(hcut / 1000).toFixed(1)}k`} size="md" isLogarithmic onChange={(v) => updateParam('hcut', v)} />
              <PluginKnob label="MOD" leftSubLabel="STILL" rightSubLabel="MOVING" value={mod} min={0} max={100} step={1} defaultValue={30} displayValue={`${Math.round(mod)}%`} size="md" onChange={(v) => updateParam('mod', v)} />
              <PluginKnob label="MOD RATE" leftSubLabel="SLOW" rightSubLabel="FAST" value={speed} min={0.1} max={10} step={0.1} defaultValue={1.5} displayValue={`${speed.toFixed(1)}Hz`} size="md" isLogarithmic onChange={(v) => updateParam('speed', v)} />
              <PluginKnob label="BASS" leftSubLabel="LEAN" rightSubLabel="FULL" value={bass} min={0.5} max={2} step={0.1} defaultValue={1} displayValue={`${bass.toFixed(1)}x`} size="md" onChange={(v) => updateParam('bass', v)} />
              <PluginKnob label="CROSSOVER" leftSubLabel="100" rightSubLabel="2K" value={cross} min={100} max={2000} step={10} defaultValue={500} displayValue={`${Math.round(cross)}Hz`} size="md" isLogarithmic onChange={(v) => updateParam('cross', v)} />
            </div>
          </section>

          <section className="col-span-3 rounded-xl border border-[#292934] bg-[#18181e] p-3 flex flex-col">
            <div className="text-[9px] font-black tracking-[0.18em] text-[#e879f9] mb-3">MIX / IMAGE</div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-4 justify-items-center">
              <PluginKnob label="DRY" leftSubLabel="0" rightSubLabel="100" value={dry} min={0} max={100} step={1} defaultValue={100} displayValue={`${Math.round(dry)}%`} size="sm" onChange={(v) => updateParam('dry', v)} />
              <PluginKnob label="WET" leftSubLabel="0" rightSubLabel="100" value={wet} min={0} max={100} step={1} defaultValue={50} displayValue={`${Math.round(wet)}%`} size="sm" onChange={(v) => updateParam('wet', v)} />
              <div className="col-span-2">
                <PluginKnob label="STEREO" leftSubLabel="NARROW" rightSubLabel="WIDE" value={sep} min={-100} max={100} step={1} defaultValue={0} displayValue={`${sep > 0 ? '+' : ''}${Math.round(sep)}%`} size="md" onChange={(v) => updateParam('sep', v)} />
              </div>
            </div>

            <div className="mt-auto pt-3 border-t border-[#292934]">
              <div className="text-[8px] text-[#666] font-black tracking-widest mb-1.5 text-center">WET FIELD MODE</div>
              <div className="flex p-0.5 rounded-full bg-[#101014] border border-[#2a2a34]">
                <button
                  type="button"
                  onClick={() => updateParam('mode', 0)}
                  className={cn('flex-1 h-7 rounded-full text-[9px] font-extrabold tracking-wider', mode === 0 ? 'bg-gradient-to-r from-[#f472b6] to-[#e879f9] text-black' : 'text-[#777]')}
                >
                  STEREO
                </button>
                <button
                  type="button"
                  onClick={() => updateParam('mode', 1)}
                  className={cn('flex-1 h-7 rounded-full text-[9px] font-extrabold tracking-wider', mode === 1 ? 'bg-gradient-to-r from-[#e879f9] to-[#c084fc] text-black' : 'text-[#777]')}
                >
                  SIDE
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
