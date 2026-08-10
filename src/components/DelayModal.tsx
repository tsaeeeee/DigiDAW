import React, { useState, useRef, useEffect } from 'react';
import { Power, X, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';

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
  { name: 'Slapback 120ms', time: 120, syncMode: 0, syncDiv: '1/16', feedback: 20, wetMix: 35, outGain: 0, mod: 15, tone: 6.0, lowCut: 1, lrOffset: 0, drive: 0 },
  { name: 'Vocal Echo 240ms', time: 240, syncMode: 0, syncDiv: '1/8', feedback: 45, wetMix: 40, outGain: 0, mod: 30, tone: 5.0, lowCut: 1, lrOffset: 5, drive: 1 },
  { name: 'Ping-Pong Quarter', time: 375, syncMode: 1, syncDiv: '1/4', feedback: 60, wetMix: 50, outGain: 0, mod: 50, tone: 4.5, lowCut: 1, lrOffset: 25, drive: 0 },
  { name: 'Warm Tape Echo', time: 300, syncMode: 0, syncDiv: '1/8d', feedback: 65, wetMix: 45, outGain: 0, mod: 70, tone: 3.5, lowCut: 1, lrOffset: 10, drive: 1 },
  { name: 'Ambient Space 500ms', time: 500, syncMode: 0, syncDiv: '1/2', feedback: 80, wetMix: 60, outGain: -1, mod: 80, tone: 7.0, lowCut: 0, lrOffset: 15, drive: 1 },
];

const SYNC_DIVISIONS = ['1/32', '1/16', '1/8', '1/4', '1/2', '1/1'];

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  displayValue: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: string;
  onChange: (val: number) => void;
}

function Knob({ label, value, min, max, step, defaultValue, displayValue, size = 'md', color = '#f59e0b', onChange }: KnobProps) {
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(value);

  const clampAndStep = (rawVal: number) => {
    let newVal = Math.max(min, Math.min(max, rawVal));
    if (step >= 1) {
      newVal = Math.round(newVal / step) * step;
    } else {
      const decimals = Math.max(1, Math.round(-Math.log10(step)));
      newVal = parseFloat(newVal.toFixed(decimals));
    }
    return Math.max(min, Math.min(max, newVal));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    startY.current = e.clientY;
    startVal.current = value;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      const deltaY = startY.current - moveEvent.clientY;
      const range = max - min;
      const dragFactor = moveEvent.shiftKey ? 600 : 150;
      const rawVal = startVal.current + (deltaY / dragFactor) * range;
      onChange(clampAndStep(rawVal));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    const range = max - min;
    const direction = e.deltaY < 0 ? 1 : -1;
    const increment = (range / 100) * direction;
    onChange(clampAndStep(value + increment));
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(defaultValue);
  };

  const normVal = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const angle = -135 + normVal * 270;

  const knobPx = size === 'sm' ? 28 : size === 'lg' ? 42 : size === 'xl' ? 52 : 34;
  const svgPx = size === 'sm' ? 40 : size === 'lg' ? 56 : size === 'xl' ? 68 : 46;
  const radius = size === 'sm' ? 15 : size === 'lg' ? 21 : size === 'xl' ? 26 : 17;
  const center = svgPx / 2;
  const strokeWidth = size === 'xl' ? 4 : 3;

  const startAngle = (-135 * Math.PI) / 180;
  const endAngle = (135 * Math.PI) / 180;
  const currentAngle = (angle * Math.PI) / 180;

  const getX = (a: number) => center + radius * Math.cos(a);
  const getY = (a: number) => center + radius * Math.sin(a);

  const bgPath = `M ${getX(startAngle)} ${getY(startAngle)} A ${radius} ${radius} 0 1 1 ${getX(endAngle)} ${getY(endAngle)}`;
  const largeArcFlag = angle - (-135) > 180 ? 1 : 0;
  const activePath = normVal > 0.01 
    ? `M ${getX(startAngle)} ${getY(startAngle)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${getX(currentAngle)} ${getY(currentAngle)}`
    : '';

  return (
    <div 
      className="flex flex-col items-center select-none group cursor-pointer" 
      onMouseDown={handleMouseDown} 
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
    >
      {label && (
        <span className="text-[#888] text-[9.5px] font-medium tracking-wide mb-1 uppercase">
          {label}
        </span>
      )}

      <div className="relative flex items-center justify-center" style={{ width: svgPx, height: svgPx }}>
        <svg style={{ width: svgPx, height: svgPx }} className="transform -rotate-90">
          <path
            d={bgPath}
            fill="none"
            stroke="#2a2a2e"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          {activePath && (
            <path
              d={activePath}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          )}
        </svg>

        <div 
          className="absolute rounded-full bg-[#1e1e22] border border-[#383842] shadow-md flex items-center justify-center"
          style={{ 
            width: knobPx, 
            height: knobPx, 
            transform: `rotate(${angle + 90}deg)` 
          }}
        />
      </div>

      <span className="text-[#e0e0e0] text-[11px] font-mono font-medium mt-1">
        {displayValue}
      </span>
    </div>
  );
}

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

export function DelayModal({
  slot,
  slotIndex,
  analyser,
  isPlaying,
  onUpdateParams,
  onClose,
  zIndex,
  onFocus,
}: DelayModalProps) {
  const isDraggingWindow = useRef(false);
  const windowDragStart = useRef({ x: 0, y: 0 });

  const [position, setPosition] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(20, Math.round(window.innerWidth / 2 - 280)),
    y: Math.max(20, Math.round(window.innerHeight / 2 - 160)),
  }));

  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false);
  const [levelMeter, setLevelMeter] = useState({ inLevel: 0, outLevel: 0 });

  // Parameter states
  const params = slot.params || {};
  const isBypassed = !!slot.bypassed;

  const mod = params.mod ?? 50;
  const tone = params.tone ?? 5.0;
  const lowCut = params.lowCut ?? 0; // 0 or 1
  const time = params.time ?? 240; // ms
  const syncMode = params.syncMode ?? 0; // 0: MSec, 1: Sync
  const syncDivIndex = params.syncDivIndex ?? 2; // default '1/8'
  const wetMix = params.wetMix ?? 50;
  const outGain = params.outGain ?? 0;
  const feedback = params.feedback ?? 40;
  const lrOffset = params.lrOffset ?? 0;
  const drive = params.drive ?? 0; // 0 or 1

  const updateParam = (key: string, value: number) => {
    const newParams = { ...params, [key]: value };
    onUpdateParams(slotIndex, isBypassed, newParams);
  };

  const toggleBypass = () => {
    onUpdateParams(slotIndex, !isBypassed, params);
  };

  const applyPreset = (preset: DelayPreset) => {
    const newParams = {
      ...params,
      time: preset.time,
      syncMode: preset.syncMode,
      feedback: preset.feedback,
      wetMix: preset.wetMix,
      outGain: preset.outGain,
      mod: preset.mod,
      tone: preset.tone,
      lowCut: preset.lowCut,
      lrOffset: preset.lrOffset,
      drive: preset.drive,
    };
    onUpdateParams(slotIndex, isBypassed, newParams);
    setIsPresetDropdownOpen(false);
  };

  const selectedPreset = PRESETS.find(p => p.time === time && p.feedback === feedback);
  const selectedPresetName = selectedPreset ? selectedPreset.name : 'Custom';

  // Window drag handler
  const handleWindowHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) return;
    isDraggingWindow.current = true;
    windowDragStart.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingWindow.current) return;
      const newX = Math.max(10, Math.min(window.innerWidth - 560, moveEvent.clientX - windowDragStart.current.x));
      const newY = Math.max(10, Math.min(window.innerHeight - 320, moveEvent.clientY - windowDragStart.current.y));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      isDraggingWindow.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Live LED Level meters animation loop
  useEffect(() => {
    if (!analyser || !isPlaying) {
      setLevelMeter({ inLevel: 0, outLevel: 0 });
      return;
    }

    let animId: number;

    const checkLevel = () => {
      let rawInDb = -100;
      const targetMeter = analyser?.preFaderMeter || analyser?.meter;
      if (targetMeter) {
        try {
          const val = targetMeter.getValue();
          if (Array.isArray(val) || val instanceof Float32Array) {
            const l = typeof val[0] === 'number' && !isNaN(val[0]) ? val[0] : -100;
            const r = typeof val[1] === 'number' && !isNaN(val[1]) ? val[1] : -100;
            rawInDb = Math.max(l, r);
          } else if (typeof val === 'number' && !isNaN(val)) {
            rawInDb = val;
          }
        } catch {
          rawInDb = -100;
        }
      }

      const norm = rawInDb <= -60 ? 0 : Math.min(1, Math.max(0, (rawInDb + 60) / 60));

      setLevelMeter({
        inLevel: isBypassed ? norm : norm * 0.9,
        outLevel: isBypassed ? norm : Math.min(1, norm * (1 + wetMix / 80)),
      });

      animId = requestAnimationFrame(checkLevel);
    };

    checkLevel();
    return () => cancelAnimationFrame(animId);
  }, [analyser, isPlaying, wetMix, isBypassed]);

  return (
    <div
      onMouseDown={() => onFocus?.()}
      style={{ left: `${position.x}px`, top: `${position.y}px`, zIndex: zIndex ?? 310 }}
      className="fixed w-[580px] bg-[#141518] border border-[#2e3038] rounded-xl shadow-2xl overflow-hidden font-sans select-none animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Top Window Header */}
      <div
        onMouseDown={handleWindowHeaderMouseDown}
        className="h-10 bg-[#1a1b20] border-b border-[#2d3038] px-3 flex items-center justify-between cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={toggleBypass}
            className={cn(
              "w-6 h-6 rounded-full border flex items-center justify-center transition-all",
              !isBypassed
                ? "border-[#ffd900] text-[#ffd900] bg-[#ffd900]/10 shadow-[0_0_8px_rgba(255,217,0,0.4)]"
                : "border-[#555] text-[#777] bg-[#1a1a1a]"
            )}
            title="Bypass / Power Switch"
          >
            <Power className="w-3.5 h-3.5" />
          </button>

          <span className="text-white font-medium text-sm tracking-wide">
            Delay
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Preset Selector */}
          <div className="relative flex items-center bg-[#1c1f26] border border-[#333742] rounded px-1 h-6">
            <button
              onClick={() => setIsPresetDropdownOpen(!isPresetDropdownOpen)}
              className="px-2 text-xs text-[#ccc] hover:text-white cursor-pointer flex items-center gap-1 min-w-[120px] justify-between"
            >
              <span className="truncate text-[11px] font-medium">{selectedPresetName}</span>
              <ChevronDown className="w-3 h-3 text-[#777]" />
            </button>

            {isPresetDropdownOpen && (
              <div className="absolute right-0 top-7 w-44 bg-[#181a20] border border-[#383d4a] rounded shadow-xl z-50 py-1">
                {PRESETS.map(p => (
                  <div
                    key={p.name}
                    onClick={() => applyPreset(p)}
                    className="px-3 py-1 text-[11px] text-[#ccc] hover:bg-amber-400 hover:text-black cursor-pointer font-medium"
                  >
                    {p.name}
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-[#888] hover:text-white p-1 rounded hover:bg-[#282a32] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main 3 Section Panel */}
      <div className="p-3 bg-[#0f1012] grid grid-cols-[150px_1fr_150px] gap-3 items-stretch">
        {/* Panel 1: COLOR */}
        <div className="bg-[#18191d] border border-[#2a2c34] rounded-lg p-3 flex flex-col items-center justify-between shadow-md">
          <span className="text-[#a0a5b5] font-black text-xs tracking-widest uppercase border-b border-[#2a2c34] pb-1 w-full text-center">
            Color
          </span>

          <div className="flex flex-col gap-3 my-2 items-center">
            <Knob
              label="Mod"
              value={mod}
              min={0}
              max={100}
              step={1}
              defaultValue={50}
              displayValue={`${mod.toFixed(1)} %`}
              onChange={(v) => updateParam('mod', v)}
            />

            <Knob
              label="Tone"
              value={tone}
              min={1.0}
              max={10.0}
              step={0.1}
              defaultValue={5.0}
              displayValue={`${tone.toFixed(1)} Tn`}
              onChange={(v) => updateParam('tone', v)}
            />
          </div>

          {/* Low Cut Switch */}
          <div className="flex flex-col items-center gap-1 mt-1">
            <button
              type="button"
              onClick={() => updateParam('lowCut', lowCut === 0 ? 1 : 0)}
              className={cn(
                "w-9 h-5 rounded-full p-0.5 border flex items-center transition-colors",
                lowCut === 1 ? "bg-amber-400/20 border-amber-400" : "bg-[#22242b] border-[#383a44]"
              )}
            >
              <div
                className={cn(
                  "w-4 h-4 rounded-full transition-transform",
                  lowCut === 1 ? "translate-x-4 bg-amber-400" : "translate-x-0 bg-[#777]"
                )}
              />
            </button>
            <span className="text-[10px] font-bold text-[#8b92a5] uppercase">
              Low Cut
            </span>
          </div>
        </div>

        {/* Panel 2: TIME (Center Main) */}
        <div className="bg-[#18191d] border border-[#2a2c34] rounded-lg p-3 flex flex-col items-center justify-between shadow-md relative">
          <span className="text-[#a0a5b5] font-black text-xs tracking-widest uppercase border-b border-[#2a2c34] pb-1 w-full text-center">
            Time
          </span>

          {/* Central Time Area with Meters */}
          <div className="flex items-center gap-3 my-2 w-full justify-center">
            {/* Input LED Level Meter Bar */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-[8px] font-mono text-[#777]">IN</span>
              <div className="w-1.5 h-16 bg-[#111215] border border-[#282a32] rounded flex flex-col justify-end p-[1px]">
                <div
                  className="w-full bg-gradient-to-t from-emerald-500 via-amber-400 to-red-500 rounded-sm transition-all"
                  style={{ height: `${levelMeter.inLevel * 100}%` }}
                />
              </div>
            </div>

            {/* Central Main Knob & Readout */}
            <div className="flex flex-col items-center">
              {syncMode === 0 ? (
                <Knob
                  label="Time"
                  value={time}
                  min={10}
                  max={2000}
                  step={1}
                  defaultValue={240}
                  size="xl"
                  displayValue={`${time} ms`}
                  onChange={(v) => updateParam('time', v)}
                />
              ) : (
                <div className="flex flex-col items-center py-2">
                  <div className="w-20 h-12 bg-[#101114] border border-amber-500/40 rounded-md flex items-center justify-center font-mono font-bold text-amber-400 text-lg shadow-inner">
                    {SYNC_DIVISIONS[syncDivIndex]}
                  </div>
                  <div className="flex gap-1 mt-2">
                    {SYNC_DIVISIONS.map((div, idx) => (
                      <button
                        key={div}
                        onClick={() => updateParam('syncDivIndex', idx)}
                        className={cn(
                          "px-1 py-0.5 rounded text-[8px] font-mono font-bold border",
                          syncDivIndex === idx
                            ? "bg-amber-400 text-black border-amber-400"
                            : "bg-[#20222a] text-[#888] border-[#383a44]"
                        )}
                      >
                        {div}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Sync Mode Toggle Button */}
              <button
                type="button"
                onClick={() => updateParam('syncMode', syncMode === 0 ? 1 : 0)}
                className="mt-1 px-3 py-0.5 bg-[#22242a] border border-[#383b46] hover:border-amber-400 rounded-md text-[10px] font-mono font-bold text-amber-400 tracking-wider shadow"
              >
                {syncMode === 0 ? 'MSec' : 'Sync'}
              </button>
            </div>

            {/* Output LED Level Meter Bar */}
            <div className="flex flex-col items-center gap-1">
              <span className="text-[8px] font-mono text-[#777]">OUT</span>
              <div className="w-1.5 h-16 bg-[#111215] border border-[#282a32] rounded flex flex-col justify-end p-[1px]">
                <div
                  className="w-full bg-gradient-to-t from-emerald-500 via-amber-400 to-red-500 rounded-sm transition-all"
                  style={{ height: `${levelMeter.outLevel * 100}%` }}
                />
              </div>
            </div>
          </div>

          {/* Wet Mix & Out Gain Knobs */}
          <div className="flex items-center gap-6 justify-center w-full mt-1 border-t border-[#262830] pt-2">
            <Knob
              label="Wet Mix"
              value={wetMix}
              min={0}
              max={100}
              step={1}
              defaultValue={50}
              size="sm"
              displayValue={`${wetMix.toFixed(1)} %`}
              onChange={(v) => updateParam('wetMix', v)}
            />

            <Knob
              label="Out Gain"
              value={outGain}
              min={-24}
              max={12}
              step={0.5}
              defaultValue={0}
              size="sm"
              displayValue={`${outGain > 0 ? '+' : ''}${outGain.toFixed(1)} dB`}
              onChange={(v) => updateParam('outGain', v)}
            />
          </div>
        </div>

        {/* Panel 3: DELAY */}
        <div className="bg-[#18191d] border border-[#2a2c34] rounded-lg p-3 flex flex-col items-center justify-between shadow-md">
          <span className="text-[#a0a5b5] font-black text-xs tracking-widest uppercase border-b border-[#2a2c34] pb-1 w-full text-center">
            Delay
          </span>

          <div className="flex flex-col gap-3 my-2 items-center">
            <Knob
              label="Feedback"
              value={feedback}
              min={0}
              max={95}
              step={1}
              defaultValue={40}
              displayValue={`${feedback.toFixed(1)} %`}
              onChange={(v) => updateParam('feedback', v)}
            />

            <Knob
              label="L/R Offset"
              value={lrOffset}
              min={-50}
              max={50}
              step={1}
              defaultValue={0}
              displayValue={`${lrOffset > 0 ? '+' : ''}${lrOffset.toFixed(1)} ms`}
              onChange={(v) => updateParam('lrOffset', v)}
            />
          </div>

          {/* Drive Switch */}
          <div className="flex flex-col items-center gap-1 mt-1">
            <button
              type="button"
              onClick={() => updateParam('drive', drive === 0 ? 1 : 0)}
              className={cn(
                "w-9 h-5 rounded-full p-0.5 border flex items-center transition-colors",
                drive === 1 ? "bg-amber-400/20 border-amber-400" : "bg-[#22242b] border-[#383a44]"
              )}
            >
              <div
                className={cn(
                  "w-4 h-4 rounded-full transition-transform",
                  drive === 1 ? "translate-x-4 bg-amber-400" : "translate-x-0 bg-[#777]"
                )}
              />
            </button>
            <span className="text-[10px] font-bold text-[#8b92a5] uppercase">
              Drive
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
