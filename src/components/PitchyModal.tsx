import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Power, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';
import { PitchyNode } from '../dsp/pitchy/PitchyNode';
import { PluginKnob } from './PluginKnob';
import { PluginModeSwitch } from './PluginModeSwitch';

interface PitchyPreset {
  name: string;
  referenceHz: number;
  speed: number;
  humanize: number;
  transition: number;
  color: number;
  modeHQ: number;
}

const PRESETS: PitchyPreset[] = [
  { name: 'Default Auto-Tune', referenceHz: 440, speed: 75, humanize: 20, transition: 30, color: 50, modeHQ: 0 },
  { name: 'Hard Tune Snap', referenceHz: 440, speed: 100, humanize: 0, transition: 0, color: 60, modeHQ: 0 },
  { name: 'Modern Lead', referenceHz: 440, speed: 94, humanize: 8, transition: 10, color: 68, modeHQ: 0 },
  { name: 'Natural Vocal Polish', referenceHz: 440, speed: 42, humanize: 72, transition: 55, color: 50, modeHQ: 1 },
  { name: 'Smooth R&B', referenceHz: 440, speed: 58, humanize: 48, transition: 72, color: 44, modeHQ: 1 },
  { name: 'Bright Lead', referenceHz: 440, speed: 84, humanize: 18, transition: 24, color: 84, modeHQ: 1 },
];

interface PitchyModalProps {
  slot?: EffectSlot;
  slotIndex: number;
  analyser?: any;
  isPlaying?: boolean;
  onUpdateParams: (slotIndex: number, bypassed: boolean, params: Record<string, number>) => void;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
}

export function PitchyModal({
  slot,
  slotIndex,
  onUpdateParams,
  onClose,
  zIndex = 310,
  onFocus,
}: PitchyModalProps) {
  const params = slot?.params || {};
  const isBypassed = !!slot?.bypassed;
  const referenceHz = params.referenceHz ?? 440;
  const speed = params.speed ?? 75;
  const humanize = params.humanize ?? 20;
  const transition = params.transition ?? 30;
  const color = params.color ?? 50;
  const modeHQ = params.modeHQ ?? 0;

  const [selectedPresetName, setSelectedPresetName] = useState('Default Auto-Tune');
  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false);
  const [telemetry, setTelemetry] = useState({
    note: '—',
    cents: 0,
    hz: 0,
    targetHz: 0,
    confidence: 0,
    tracking: false,
  });

  const [position, setPosition] = useState(() => ({
    x: Math.max(20, Math.round(window.innerWidth / 2 - 350)),
    y: Math.max(20, Math.round(window.innerHeight / 2 - 225)),
  }));
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const updateParams = (changes: Record<string, number>, bypass = isBypassed) => {
    onUpdateParams(slotIndex, bypass, { ...params, ...changes });
    setSelectedPresetName('Custom');
  };

  const applyPreset = (preset: PitchyPreset) => {
    setSelectedPresetName(preset.name);
    setIsPresetDropdownOpen(false);
    onUpdateParams(slotIndex, isBypassed, {
      ...params,
      referenceHz: preset.referenceHz,
      speed: preset.speed,
      humanize: preset.humanize,
      transition: preset.transition,
      color: preset.color,
      modeHQ: preset.modeHQ,
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
    onFocus?.();
    dragging.current = true;
    dragOffset.current = { x: event.clientX - position.x, y: event.clientY - position.y };

    const move = (moveEvent: MouseEvent) => {
      if (!dragging.current) return;
      setPosition({
        x: Math.max(10, Math.min(window.innerWidth - 700, moveEvent.clientX - dragOffset.current.x)),
        y: Math.max(10, Math.min(window.innerHeight - 450, moveEvent.clientY - dragOffset.current.y)),
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
      const node = PitchyNode.lastActiveInstance;
      if (!node) {
        setTelemetry((previous) => previous.tracking ? { ...previous, tracking: false } : previous);
        return;
      }
      const next = node.getTelemetry();
      setTelemetry({
        note: next.isTracking ? next.closestNoteName : '—',
        cents: next.centsDeviation,
        hz: next.detectedHz,
        targetHz: next.targetHz,
        confidence: next.confidence ?? 0,
        tracking: next.isTracking,
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, []);

  const cents = Math.max(-50, Math.min(50, telemetry.cents));
  const needleX = 50 + cents;

  return (
    <div className="fixed inset-0 z-[300] pointer-events-none">
      <div
        onMouseDown={() => onFocus?.()}
        style={{ left: position.x, top: position.y, width: 700, zIndex }}
        className="fixed pointer-events-auto overflow-hidden rounded-xl border border-[#2e2e36] bg-[#141416] shadow-[0_25px_60px_rgba(0,0,0,0.95)] font-sans select-none"
      >
        <div
          onMouseDown={handleHeaderMouseDown}
          className="h-10 px-3.5 flex items-center justify-between bg-[#1c1c22] border-b border-[#2d2d38] cursor-move"
        >
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => updateParams({}, !isBypassed)}
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
                Pitchy
              </span>
              <span className="text-[9px] text-[#6b7280] font-mono tracking-widest">CHROMATIC AUTO-TUNE</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex items-center h-6.5 px-1 bg-[#111114] border border-[#2d2d38] rounded-md">
              <button type="button" onClick={() => cyclePreset(-1)} className="p-0.5 text-[#888] hover:text-white">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsPresetDropdownOpen((open) => !open)}
                className="min-w-[145px] px-2 flex items-center justify-between gap-2 text-[10px] font-bold tracking-wide uppercase text-[#d1d5db]"
              >
                <span className="truncate">{selectedPresetName}</span>
                <ChevronDown className="w-3 h-3 text-[#777]" />
              </button>
              <button type="button" onClick={() => cyclePreset(1)} className="p-0.5 text-[#888] hover:text-white">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              {isPresetDropdownOpen && (
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

        <div className="p-5 flex gap-5">
          <div className="w-[330px] rounded-2xl border border-[#f472b6]/25 bg-gradient-to-br from-[#1c1a26] via-[#14131c] to-[#121118] p-4 shadow-[0_0_25px_rgba(244,114,182,0.13)]">
            <div className="h-[245px] flex flex-col justify-center items-center rounded-xl bg-[#111116] border border-[#27232f] relative overflow-hidden">
              <div className="absolute inset-x-8 top-16 h-24 rounded-full bg-[#ec4899]/10 blur-3xl" />

              <div className="text-[9px] font-black tracking-[0.25em] text-[#73737c]">DETECTED NOTE</div>
              <div className="mt-2 text-6xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-[#e9d5ff] drop-shadow-[0_0_14px_rgba(192,132,252,0.5)]">
                {telemetry.note}
              </div>
              <div className={cn('mt-1 text-[10px] font-mono font-bold', telemetry.tracking ? 'text-[#f472b6]' : 'text-[#666]')}>
                {telemetry.tracking ? `${cents >= 0 ? '+' : ''}${cents} CENTS` : 'WAITING FOR VOICE'}
              </div>

              <div className="mt-5 w-[230px]">
                <div className="relative h-2 rounded-full bg-[#262630] overflow-visible">
                  <div className="absolute left-1/2 top-[-4px] h-4 w-[2px] bg-[#f472b6] shadow-[0_0_6px_rgba(244,114,182,0.8)]" />
                  <div
                    className="absolute top-[-4px] w-3 h-4 rounded-full bg-gradient-to-r from-[#f472b6] to-[#c084fc] shadow-[0_0_10px_rgba(244,114,182,0.8)] transition-[left] duration-75"
                    style={{ left: `calc(${needleX}% - 6px)` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[8px] font-mono text-[#666]">
                  <span>-50</span><span>0</span><span>+50</span>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-3 gap-2 w-[260px] text-center">
                <div className="rounded-md bg-[#17171d] border border-[#282833] px-2 py-1.5">
                  <div className="text-[8px] text-[#666]">INPUT</div>
                  <div className="text-[10px] font-mono text-[#ddd]">{telemetry.hz > 0 ? `${telemetry.hz.toFixed(1)}Hz` : '—'}</div>
                </div>
                <div className="rounded-md bg-[#17171d] border border-[#282833] px-2 py-1.5">
                  <div className="text-[8px] text-[#666]">TARGET</div>
                  <div className="text-[10px] font-mono text-[#ddd]">{telemetry.targetHz > 0 ? `${telemetry.targetHz.toFixed(1)}Hz` : '—'}</div>
                </div>
                <div className="rounded-md bg-[#17171d] border border-[#282833] px-2 py-1.5">
                  <div className="text-[8px] text-[#666]">CONF</div>
                  <div className="text-[10px] font-mono text-[#ddd]">{`${Math.round(telemetry.confidence * 100)}%`}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col justify-between">
            <div className="grid grid-cols-2 gap-x-5 gap-y-3 justify-items-center">
              <PluginKnob
                label="SPEED"
                leftSubLabel="SOFT"
                rightSubLabel="HARD"
                value={speed}
                min={0}
                max={100}
                step={1}
                defaultValue={75}
                displayValue={`${Math.round(speed)}%`}
                size="lg"
                onChange={(value) => updateParams({ speed: value })}
              />
              <PluginKnob
                label="HUMANIZE"
                leftSubLabel="TIGHT"
                rightSubLabel="LOOSE"
                value={humanize}
                min={0}
                max={100}
                step={1}
                defaultValue={20}
                displayValue={`${Math.round(humanize)}%`}
                size="lg"
                onChange={(value) => updateParams({ humanize: value })}
              />
              <PluginKnob
                label="TRANSITION"
                leftSubLabel="SNAP"
                rightSubLabel="GLIDE"
                value={transition}
                min={0}
                max={100}
                step={1}
                defaultValue={30}
                displayValue={`${Math.round(transition)}%`}
                size="lg"
                onChange={(value) => updateParams({ transition: value })}
              />
              <PluginKnob
                label="COLOR"
                leftSubLabel="DARK"
                rightSubLabel="BRIGHT"
                value={color}
                min={0}
                max={100}
                step={1}
                defaultValue={50}
                displayValue={`${Math.round(color)}%`}
                size="lg"
                onChange={(value) => updateParams({ color: value })}
              />
            </div>

            <div className="mt-3 pt-3 border-t border-[#262630] flex items-end justify-between gap-3">
              <PluginKnob
                label="REFERENCE"
                leftSubLabel="415"
                rightSubLabel="466"
                value={referenceHz}
                min={415}
                max={466}
                step={0.1}
                defaultValue={440}
                displayValue={`${referenceHz.toFixed(1)}Hz`}
                size="sm"
                onChange={(value) => updateParams({ referenceHz: value })}
              />

              <PluginModeSwitch
                label="Processing mode"
                value={modeHQ}
                options={[{ value: 0, label: 'Real time' }, { value: 1, label: 'HQ' }]}
                onChange={(value) => updateParams({ modeHQ: value })}
                className="flex-1"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
