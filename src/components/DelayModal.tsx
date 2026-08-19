import React, { useRef, useState } from 'react';
import { ChevronDown, Power, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';
import { PluginKnob } from './PluginKnob';

interface DelayPreset {
  name: string;
  time: number;
  syncMode: number;
  syncDiv: string;
  feedback: number;
  wetMix: number;
  outGain: number;
  mod: number;
  tone: number;
  lowCut: number;
  lrOffset: number;
  drive: number;
}

const PRESETS: DelayPreset[] = [
  { name: 'Slapback 120ms', time: 120, syncMode: 0, syncDiv: '1/16', feedback: 20, wetMix: 35, outGain: 0, mod: 15, tone: 6, lowCut: 1, lrOffset: 0, drive: 0 },
  { name: 'Vocal Echo 240ms', time: 240, syncMode: 0, syncDiv: '1/8', feedback: 45, wetMix: 40, outGain: 0, mod: 30, tone: 5, lowCut: 1, lrOffset: 5, drive: 1 },
  { name: 'Ping-Pong Quarter', time: 375, syncMode: 1, syncDiv: '1/4', feedback: 60, wetMix: 50, outGain: 0, mod: 50, tone: 4.5, lowCut: 1, lrOffset: 25, drive: 0 },
  { name: 'Warm Tape Echo', time: 300, syncMode: 0, syncDiv: '1/8', feedback: 65, wetMix: 45, outGain: 0, mod: 70, tone: 3.5, lowCut: 1, lrOffset: 10, drive: 1 },
  { name: 'Ambient Space 500ms', time: 500, syncMode: 0, syncDiv: '1/2', feedback: 80, wetMix: 60, outGain: -1, mod: 80, tone: 7, lowCut: 0, lrOffset: 15, drive: 1 },
];

const SYNC_DIVISIONS = ['1/32', '1/16', '1/8', '1/4', '1/2', '1/1'];

interface DelayModalProps {
  slot: EffectSlot;
  slotIndex: number;
  analyser?: any;
  isPlaying?: boolean;
  onUpdateParams: (slotIndex: number, bypassed: boolean, params: Record<string, number>) => void;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
}

export function DelayModal({ slot, slotIndex, onUpdateParams, onClose, zIndex, onFocus }: DelayModalProps) {
  const params = slot.params || {};
  const isBypassed = !!slot.bypassed;
  const mod = params.mod ?? 50;
  const tone = params.tone ?? 5;
  const lowCut = params.lowCut ?? 0;
  const time = params.time ?? 240;
  const syncMode = params.syncMode ?? 0;
  const syncDivIndex = params.syncDivIndex ?? 2;
  const wetMix = params.wetMix ?? 50;
  const outGain = params.outGain ?? 0;
  const feedback = params.feedback ?? 40;
  const lrOffset = params.lrOffset ?? 0;
  const drive = params.drive ?? 0;

  const [position, setPosition] = useState(() => ({
    x: Math.max(20, Math.round(window.innerWidth / 2 - 310)),
    y: Math.max(20, Math.round(window.innerHeight / 2 - 205)),
  }));
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const [presetOpen, setPresetOpen] = useState(false);

  const updateParam = (key: string, value: number) => onUpdateParams(slotIndex, isBypassed, { ...params, [key]: value });

  const applyPreset = (preset: DelayPreset) => {
    const divisionIndex = Math.max(0, SYNC_DIVISIONS.indexOf(preset.syncDiv));
    onUpdateParams(slotIndex, isBypassed, {
      ...params,
      time: preset.time,
      syncMode: preset.syncMode,
      syncDivIndex: divisionIndex,
      feedback: preset.feedback,
      wetMix: preset.wetMix,
      outGain: preset.outGain,
      mod: preset.mod,
      tone: preset.tone,
      lowCut: preset.lowCut,
      lrOffset: preset.lrOffset,
      drive: preset.drive,
    });
    setPresetOpen(false);
  };

  const selectedPreset = PRESETS.find((preset) => preset.time === time && preset.feedback === feedback && preset.syncMode === syncMode);
  const selectedName = selectedPreset?.name || 'Custom';

  const handleHeaderMouseDown = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    dragging.current = true;
    dragOffset.current = { x: event.clientX - position.x, y: event.clientY - position.y };
    const move = (moveEvent: MouseEvent) => {
      if (!dragging.current) return;
      setPosition({
        x: Math.max(10, Math.min(window.innerWidth - 620, moveEvent.clientX - dragOffset.current.x)),
        y: Math.max(10, Math.min(window.innerHeight - 410, moveEvent.clientY - dragOffset.current.y)),
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

  return (
    <div
      onMouseDown={() => onFocus?.()}
      style={{ left: position.x, top: position.y, width: 620, zIndex: zIndex ?? 310 }}
      className="fixed overflow-hidden rounded-xl border border-[#2e2e36] bg-[#141416] shadow-[0_25px_60px_rgba(0,0,0,0.95)] select-none"
    >
      <div onMouseDown={handleHeaderMouseDown} className="h-10 px-3 flex items-center justify-between bg-[#1c1c22] border-b border-[#2d2d38] cursor-move">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => onUpdateParams(slotIndex, !isBypassed, params)} className={cn('w-6 h-6 rounded-full flex items-center justify-center', !isBypassed ? 'bg-[#ec4899] text-black shadow-[0_0_10px_rgba(236,72,153,0.7)]' : 'bg-[#25252c] text-[#777]')}>
            <Power className="w-3.5 h-3.5" />
          </button>
          <span className="font-black text-sm tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-[#f472b6] via-[#e879f9] to-[#c084fc]">Delay</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex items-center h-6 px-1 rounded bg-[#111114] border border-[#2d2d38]">
            <button type="button" onClick={() => setPresetOpen((open) => !open)} className="min-w-[155px] px-2 flex items-center justify-between text-[10px] text-[#ccc]"><span className="truncate">{selectedName}</span><ChevronDown className="w-3 h-3" /></button>
            {presetOpen && <div className="absolute top-7 right-0 w-48 z-[350] py-1 rounded border border-[#3e3e4a] bg-[#18181e] shadow-xl">{PRESETS.map((preset) => <button key={preset.name} type="button" onClick={() => applyPreset(preset)} className="w-full px-2 py-1.5 text-left text-[10px] text-[#ccc] hover:text-[#f472b6] hover:bg-[#282834]">{preset.name}</button>)}</div>}
          </div>
          <button type="button" onClick={onClose} className="w-6 h-6 flex items-center justify-center text-[#888] hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="p-4 grid grid-cols-12 gap-3 bg-[#141416]">
        <section className="col-span-3 rounded-xl border border-[#292934] bg-[#18181e] p-3">
          <div className="text-[9px] font-black tracking-[0.18em] text-[#a78bfa] mb-3">COLOR</div>
          <div className="flex flex-col items-center gap-4">
            <PluginKnob label="MOD" leftSubLabel="STABLE" rightSubLabel="WOBBLE" value={mod} min={0} max={100} step={1} defaultValue={50} displayValue={`${Math.round(mod)}%`} size="md" onChange={(v) => updateParam('mod', v)} />
            <PluginKnob label="TONE" leftSubLabel="DARK" rightSubLabel="BRIGHT" value={tone} min={1} max={10} step={0.1} defaultValue={5} displayValue={tone.toFixed(1)} size="md" onChange={(v) => updateParam('tone', v)} />
            <button type="button" onClick={() => updateParam('lowCut', lowCut === 1 ? 0 : 1)} className={cn('w-full h-7 rounded-full text-[9px] font-black tracking-widest border transition-all', lowCut === 1 ? 'bg-[#f472b6]/15 border-[#f472b6] text-[#f472b6]' : 'bg-[#111114] border-[#34343d] text-[#666]')}>LOW CUT {lowCut === 1 ? 'ON' : 'OFF'}</button>
          </div>
        </section>

        <section className="col-span-6 rounded-xl border border-[#292934] bg-[#18181e] p-3">
          <div className="text-[9px] font-black tracking-[0.18em] text-[#f472b6] mb-3 text-center">TIME / MIX</div>
          <div className="flex justify-center">
            {syncMode === 0 ? (
              <PluginKnob label="TIME" leftSubLabel="10ms" rightSubLabel="2s" value={time} min={10} max={2000} step={1} defaultValue={240} displayValue={`${Math.round(time)}ms`} size="xl" isLogarithmic onChange={(v) => updateParam('time', v)} />
            ) : (
              <div className="w-full flex flex-col items-center py-2">
                <div className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#f472b6] to-[#c084fc]">{SYNC_DIVISIONS[syncDivIndex] || '1/8'}</div>
                <div className="mt-3 flex flex-wrap justify-center gap-1">
                  {SYNC_DIVISIONS.map((division, index) => <button key={division} type="button" onClick={() => updateParam('syncDivIndex', index)} className={cn('px-2 py-1 rounded text-[9px] font-mono font-bold border', syncDivIndex === index ? 'bg-gradient-to-r from-[#f472b6] to-[#e879f9] text-black border-[#f472b6]' : 'bg-[#111114] text-[#777] border-[#33333d]')}>{division}</button>)}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-center mt-2">
            <button type="button" onClick={() => updateParam('syncMode', syncMode === 1 ? 0 : 1)} className="px-4 h-7 rounded-full bg-[#111114] border border-[#34343d] text-[9px] font-black tracking-widest text-[#e879f9]">{syncMode === 1 ? 'TEMPO SYNC' : 'MILLISECONDS'}</button>
          </div>
          <div className="mt-4 pt-3 border-t border-[#292934] grid grid-cols-2 gap-5 justify-items-center">
            <PluginKnob label="WET MIX" leftSubLabel="DRY" rightSubLabel="WET" value={wetMix} min={0} max={99.9} step={1} defaultValue={50} displayValue={`${Math.round(wetMix)}%`} size="sm" onChange={(v) => updateParam('wetMix', v)} />
            <PluginKnob label="OUTPUT" leftSubLabel="-24" rightSubLabel="+12" value={outGain} min={-24} max={12} step={0.5} defaultValue={0} displayValue={`${outGain > 0 ? '+' : ''}${outGain.toFixed(1)}dB`} size="sm" onChange={(v) => updateParam('outGain', v)} />
          </div>
        </section>

        <section className="col-span-3 rounded-xl border border-[#292934] bg-[#18181e] p-3">
          <div className="text-[9px] font-black tracking-[0.18em] text-[#c084fc] mb-3">REPEATS</div>
          <div className="flex flex-col items-center gap-4">
            <PluginKnob label="FEEDBACK" leftSubLabel="1 TAP" rightSubLabel="LONG" value={feedback} min={0} max={95} step={1} defaultValue={40} displayValue={`${Math.round(feedback)}%`} size="md" onChange={(v) => updateParam('feedback', v)} />
            <PluginKnob label="STEREO" leftSubLabel="LEFT" rightSubLabel="RIGHT" value={lrOffset} min={-50} max={50} step={1} defaultValue={0} displayValue={`${lrOffset > 0 ? '+' : ''}${Math.round(lrOffset)}%`} size="md" onChange={(v) => updateParam('lrOffset', v)} />
            <button type="button" onClick={() => updateParam('drive', drive === 1 ? 0 : 1)} className={cn('w-full h-7 rounded-full text-[9px] font-black tracking-widest border transition-all', drive === 1 ? 'bg-[#f472b6]/15 border-[#f472b6] text-[#f472b6]' : 'bg-[#111114] border-[#34343d] text-[#666]')}>DRIVE {drive === 1 ? 'ON' : 'OFF'}</button>
          </div>
        </section>
      </div>
    </div>
  );
}
