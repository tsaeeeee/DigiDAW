import React, { useState, useRef, useEffect } from 'react';
import { Power, X, ChevronLeft, ChevronRight, ChevronDown, Save } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';
import { NOTE_NAMES, PitchyNode } from '../dsp/pitchy/PitchyNode';

interface PitchyPreset {
  name: string;
  referenceHz: number;
  speed: number;       // 0 - 100
  humanize: number;    // 0 - 100
  transition: number;  // 0 - 100
  color: number;       // 0 - 100
  modeHQ: number;      // 0 or 1
}

const PRESETS: PitchyPreset[] = [
  { name: 'Default Auto-Tune', referenceHz: 440.0, speed: 75, humanize: 20, transition: 30, color: 50, modeHQ: 0 },
  { name: 'Hard Tune Snap', referenceHz: 440.0, speed: 100, humanize: 0, transition: 5, color: 65, modeHQ: 0 },
  { name: 'Modern Trap Lead', referenceHz: 440.0, speed: 95, humanize: 10, transition: 15, color: 75, modeHQ: 1 },
  { name: 'Natural Vocal Polish', referenceHz: 440.0, speed: 35, humanize: 70, transition: 60, color: 50, modeHQ: 1 },
  { name: 'Smooth R&B Glide', referenceHz: 440.0, speed: 55, humanize: 45, transition: 75, color: 45, modeHQ: 1 },
  { name: 'Formant Shift Warm', referenceHz: 440.0, speed: 80, humanize: 25, transition: 35, color: 20, modeHQ: 0 },
  { name: 'Bright Lead Vocal', referenceHz: 440.0, speed: 85, humanize: 15, transition: 25, color: 85, modeHQ: 1 },
];

interface ArcKnobProps {
  label: string;
  leftSubLabel: string;
  rightSubLabel: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  displayValue?: string;
  onChange: (val: number) => void;
}

function ArcKnob({
  label,
  leftSubLabel,
  rightSubLabel,
  value,
  min,
  max,
  step,
  defaultValue,
  displayValue,
  onChange,
}: ArcKnobProps) {
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

  const radius = 34;
  const strokeWidth = 5;
  const center = 44;
  const startAngle = (-135 * Math.PI) / 180;
  const endAngle = (135 * Math.PI) / 180;
  const currentAngle = (angle * Math.PI) / 180;

  const getX = (a: number) => center + radius * Math.cos(a);
  const getY = (a: number) => center + radius * Math.sin(a);

  const bgPath = `M ${getX(startAngle)} ${getY(startAngle)} A ${radius} ${radius} 0 1 1 ${getX(endAngle)} ${getY(endAngle)}`;
  const largeArcFlag = angle - (-135) > 180 ? 1 : 0;
  const activePath = normVal > 0.005
    ? `M ${getX(startAngle)} ${getY(startAngle)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${getX(currentAngle)} ${getY(currentAngle)}`
    : '';

  // Needle dot indicator position
  const needleDist = 23;
  const needleX = center + needleDist * Math.cos(currentAngle);
  const needleY = center + needleDist * Math.sin(currentAngle);

  return (
    <div
      className="flex flex-col items-center select-none group cursor-pointer"
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      title={`${label}: ${displayValue || value.toString()}`}
    >
      {/* Knob Dial Graphic */}
      <div className="relative w-[88px] h-[88px] flex items-center justify-center">
        <svg className="w-[88px] h-[88px] transform -rotate-90">
          <defs>
            <linearGradient id="pinkArcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f472b6" />
              <stop offset="50%" stopColor="#e879f9" />
              <stop offset="100%" stopColor="#c084fc" />
            </linearGradient>
            <linearGradient id="innerDialGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#1e1e24" />
              <stop offset="100%" stopColor="#121215" />
            </linearGradient>
          </defs>

          {/* Background Outer Arc */}
          <path
            d={bgPath}
            fill="none"
            stroke="#232328"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Glowing Active Arc */}
          {activePath && (
            <path
              d={activePath}
              fill="none"
              stroke="url(#pinkArcGrad)"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              className="filter drop-shadow-[0_0_6px_rgba(244,114,182,0.6)]"
            />
          )}

          {/* Inner Circular Cap */}
          <circle
            cx={center}
            cy={center}
            r={radius - 7}
            fill="url(#innerDialGrad)"
            stroke="#2d2d34"
            strokeWidth="1.5"
          />

          {/* Center Indicator Dot */}
          <circle
            cx={needleX}
            cy={needleY}
            r="2.2"
            fill="#f9a8d4"
            className="filter drop-shadow-[0_0_4px_rgba(244,114,182,0.9)]"
          />
        </svg>
      </div>

      {/* Sub Labels (e.g. SOFT - HARD) */}
      <div className="w-full flex items-center justify-between px-1 text-[8px] tracking-wider text-[#73737c] font-bold mt-0.5">
        <span>{leftSubLabel}</span>
        <span>{rightSubLabel}</span>
      </div>

      {/* Main Title Label */}
      <span className="text-[#f1f1f4] text-[11px] font-extrabold tracking-widest uppercase mt-0.5">
        {label}
      </span>
    </div>
  );
}

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
  analyser,
  isPlaying,
  onUpdateParams,
  onClose,
  zIndex = 310,
  onFocus,
}: PitchyModalProps) {
  const isBypassed = slot?.bypassed || false;
  const p = slot?.params || {};

  // Parameters
  const [referenceHz, setReferenceHz] = useState<number>(p.referenceHz ?? 440.0);
  const [speed, setSpeed] = useState<number>(p.speed ?? 75);
  const [humanize, setHumanize] = useState<number>(p.humanize ?? 20);
  const [transition, setTransition] = useState<number>(p.transition ?? 30);
  const [color, setColor] = useState<number>(p.color ?? 50);
  const [modeHQ, setModeHQ] = useState<number>(p.modeHQ ?? 0);

  // A/B Comparison state
  const [activeAB, setActiveAB] = useState<'A' | 'B'>('A');
  const [presetStateA, setPresetStateA] = useState<PitchyPreset | null>(null);
  const [presetStateB, setPresetStateB] = useState<PitchyPreset | null>(null);

  // Preset management
  const [selectedPresetName, setSelectedPresetName] = useState<string>('Default Auto-Tune');
  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false);

  // Live pitch detection monitoring from active DSP node
  const [liveDetectedNote, setLiveDetectedNote] = useState<string>('C');
  const [liveCentsDeviation, setLiveCentsDeviation] = useState<number>(0);
  const [isActivelyTracking, setIsActivelyTracking] = useState<boolean>(false);

  // Modal Dragging State
  const modalRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const w = 660;
    const h = 430;
    const left = Math.max(20, Math.round((window.innerWidth - w) / 2));
    const top = Math.max(20, Math.round((window.innerHeight - h) / 2));
    return { x: left, y: top };
  });

  const isDraggingModal = useRef(false);
  const dragOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    onFocus?.();
    isDraggingModal.current = true;
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingModal.current) return;
      const newX = Math.max(10, Math.min(window.innerWidth - 670, moveEvent.clientX - dragOffset.current.x));
      const newY = Math.max(10, Math.min(window.innerHeight - 440, moveEvent.clientY - dragOffset.current.y));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      isDraggingModal.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Sync parameters upstream to audio engine
  const emitParams = (overrides?: Partial<PitchyPreset>, bypassOverride?: boolean) => {
    const updated = {
      referenceHz: overrides?.referenceHz ?? referenceHz,
      speed: overrides?.speed ?? speed,
      humanize: overrides?.humanize ?? humanize,
      transition: overrides?.transition ?? transition,
      color: overrides?.color ?? color,
      modeHQ: overrides?.modeHQ ?? modeHQ,
    };
    onUpdateParams(slotIndex, bypassOverride !== undefined ? bypassOverride : isBypassed, updated);
  };

  const toggleBypass = () => {
    const nextBypass = !isBypassed;
    emitParams(undefined, nextBypass);
  };

  const applyPreset = (preset: PitchyPreset) => {
    setSelectedPresetName(preset.name);
    setReferenceHz(preset.referenceHz);
    setSpeed(preset.speed);
    setHumanize(preset.humanize);
    setTransition(preset.transition);
    setColor(preset.color);
    setModeHQ(preset.modeHQ);

    emitParams(preset);
    setIsPresetDropdownOpen(false);
  };

  const cyclePreset = (direction: 'next' | 'prev') => {
    const currentIndex = PRESETS.findIndex(p => p.name === selectedPresetName);
    let nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (nextIndex < 0) nextIndex = PRESETS.length - 1;
    if (nextIndex >= PRESETS.length) nextIndex = 0;
    applyPreset(PRESETS[nextIndex]);
  };

  const handleABToggle = (slotChoice: 'A' | 'B') => {
    if (slotChoice === activeAB) return;
    const currentSnapshot: PitchyPreset = {
      name: selectedPresetName,
      referenceHz,
      speed,
      humanize,
      transition,
      color,
      modeHQ,
    };

    if (activeAB === 'A') {
      setPresetStateA(currentSnapshot);
      if (presetStateB) {
        applyPreset(presetStateB);
      }
    } else {
      setPresetStateB(currentSnapshot);
      if (presetStateA) {
        applyPreset(presetStateA);
      }
    }
    setActiveAB(slotChoice);
  };

  // Real-time Visual Note & Deviation Telemetry Loop
  useEffect(() => {
    let animId: number;

    const render = () => {
      const activeNode = PitchyNode.lastActiveInstance;

      if (activeNode && activeNode.isTracking) {
        const telemetry = activeNode.getTelemetry();
        setLiveDetectedNote(telemetry.closestNoteName || 'C');
        setLiveCentsDeviation(telemetry.centsDeviation);
        setIsActivelyTracking(true);
      } else {
        setIsActivelyTracking(false);
        setLiveCentsDeviation(0);
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, []);

  // Tuning arc gauge calculations
  const centsClamped = Math.max(-50, Math.min(50, liveCentsDeviation));

  return (
    <div className="fixed inset-0 z-[300] pointer-events-none">
      <div
        ref={modalRef}
        onMouseDown={() => onFocus?.()}
        style={{ left: `${position.x}px`, top: `${position.y}px`, width: '660px', zIndex: zIndex ?? 310 }}
        className="fixed pointer-events-auto bg-[#141416] border border-[#2e2e36] rounded-xl shadow-[0_25px_60px_rgba(0,0,0,0.95)] flex flex-col overflow-hidden font-sans select-none animate-in fade-in zoom-in-95 duration-100"
      >
        {/* Top Header Bar */}
        <div
          onMouseDown={handleHeaderMouseDown}
          className="h-10 bg-[#1c1c22] border-b border-[#2d2d38] px-3.5 flex items-center justify-between cursor-move"
        >
          {/* Plugin Title & Bypass */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={toggleBypass}
              title={isBypassed ? "Activate Pitchy" : "Bypass Pitchy"}
              className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer",
                !isBypassed
                  ? "bg-[#ec4899] text-black shadow-[0_0_10px_rgba(236,72,153,0.7)]"
                  : "bg-[#25252c] text-[#777] hover:text-[#aaa]"
              )}
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-baseline gap-1.5">
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#f472b6] via-[#e879f9] to-[#c084fc] font-black text-sm tracking-wider kumbh-sans">
                Pitchy
              </span>
              <span className="text-[9px] text-[#6b7280] font-mono tracking-widest">
                DIGIDAW DSP
              </span>
            </div>
          </div>

          {/* Center Preset Selector Bar */}
          <div className="flex items-center gap-1.5">
            <div className="relative flex items-center bg-[#111114] border border-[#2d2d38] rounded-md px-1.5 h-6.5 shadow-inner">
              <button
                type="button"
                onClick={() => cyclePreset('prev')}
                className="p-0.5 text-[#888] hover:text-white transition-colors cursor-pointer"
                title="Previous Preset"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <div
                onClick={() => setIsPresetDropdownOpen(!isPresetDropdownOpen)}
                className="px-2 text-xs text-[#d1d5db] hover:text-white cursor-pointer flex items-center gap-2 min-w-[125px] justify-between"
              >
                <span className="truncate text-[11px] font-bold tracking-wide uppercase">{selectedPresetName}</span>
                <ChevronDown className="w-3 h-3 text-[#777]" />
              </div>

              <button
                type="button"
                onClick={() => cyclePreset('next')}
                className="p-0.5 text-[#888] hover:text-white transition-colors cursor-pointer"
                title="Next Preset"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              {/* Preset Dropdown Menu */}
              {isPresetDropdownOpen && (
                <div className="absolute top-8 left-0 right-0 z-[350] bg-[#18181e] border border-[#3e3e4a] rounded-md shadow-2xl py-1 flex flex-col gap-0.5 max-h-52 overflow-y-auto custom-scrollbar">
                  {PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className={cn(
                        "px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-[#282834] cursor-pointer flex items-center justify-between",
                        selectedPresetName === p.name ? "text-[#f472b6] font-bold bg-[#22222c]" : "text-[#ccc]"
                      )}
                    >
                      <span>{p.name}</span>
                      {selectedPresetName === p.name && <span className="w-1.5 h-1.5 rounded-full bg-[#f472b6]" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Save Icon */}
            <button
              type="button"
              className="p-1 text-[#777] hover:text-[#f472b6] transition-colors cursor-pointer rounded"
              title="Save User Preset"
            >
              <Save className="w-3.5 h-3.5" />
            </button>

            {/* A / B Toggle */}
            <div className="flex items-center bg-[#111114] border border-[#2d2d38] rounded p-0.5">
              <button
                type="button"
                onClick={() => handleABToggle('A')}
                className={cn(
                  "w-5 h-4.5 rounded-[2px] text-[9px] font-bold flex items-center justify-center transition-all cursor-pointer",
                  activeAB === 'A' ? "bg-[#c084fc] text-black" : "text-[#777] hover:text-white"
                )}
              >
                A
              </button>
              <button
                type="button"
                onClick={() => handleABToggle('B')}
                className={cn(
                  "w-5 h-4.5 rounded-[2px] text-[9px] font-bold flex items-center justify-center transition-all cursor-pointer",
                  activeAB === 'B' ? "bg-[#c084fc] text-black" : "text-[#777] hover:text-white"
                )}
              >
                B
              </button>
            </div>

            {/* BYPASS Button */}
            <button
              type="button"
              onClick={toggleBypass}
              className={cn(
                "px-2 h-6 rounded text-[9px] font-extrabold uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center",
                isBypassed
                  ? "bg-[#f472b6] text-black font-black"
                  : "bg-[#25252e] text-[#888] hover:text-white"
              )}
            >
              BYPASS
            </button>
          </div>

          {/* Close Window X Button */}
          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center text-[#888] hover:text-white hover:bg-[#282834] transition-colors cursor-pointer"
            title="Close Plugin"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Plugin Main Body Layout */}
        <div className="p-5 flex gap-6 bg-[#141416]">
          {/* Left Column: Visual Screen Display & Moving Tune Spectrum */}
          <div className="flex-1 flex flex-col gap-3">
            {/* Main Visualizer Container */}
            <div className="relative h-[290px] rounded-2xl bg-gradient-to-br from-[#1c1a26] via-[#14131c] to-[#121118] p-[1.5px] shadow-[0_0_25px_rgba(244,114,182,0.15)] flex flex-col">
              <div className="w-full h-full rounded-[14.5px] bg-[#121218] border border-[#f472b6]/25 p-3.5 flex flex-col justify-between relative overflow-hidden">
                {/* Background Ambient Glow */}
                <div className="absolute -top-16 -left-16 w-36 h-36 bg-[#ec4899]/10 rounded-full blur-2xl pointer-events-none" />
                <div className="absolute -bottom-16 -right-16 w-36 h-36 bg-[#c084fc]/10 rounded-full blur-2xl pointer-events-none" />

                {/* Center Glowing Target Note with Arc Meter */}
                <div className="flex-1 flex flex-col items-center justify-center relative z-10 px-1 py-4">
                  <div className="relative w-52 h-36 flex items-center justify-center">
                    <svg className="w-52 h-36" viewBox="0 0 160 100">
                      <defs>
                        <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#f472b6" />
                          <stop offset="50%" stopColor="#e879f9" />
                          <stop offset="100%" stopColor="#c084fc" />
                        </linearGradient>
                      </defs>

                      {/* Gauge Base Track (Semi-Circle Arc) */}
                      <path
                        d="M 20 85 A 60 60 0 0 1 140 85"
                        fill="none"
                        stroke="#262630"
                        strokeWidth="6.5"
                        strokeLinecap="round"
                      />

                      {/* Active Deviation Glow Needle Path */}
                      <path
                        d="M 20 85 A 60 60 0 0 1 140 85"
                        fill="none"
                        stroke="url(#gaugeGrad)"
                        strokeWidth="6.5"
                        strokeDasharray="188"
                        strokeDashoffset={`${188 - ((centsClamped + 50) / 100) * 188}`}
                        strokeLinecap="round"
                        className="filter drop-shadow-[0_0_8px_rgba(244,114,182,0.8)] transition-all duration-75"
                      />

                      {/* Center Zero In-Tune Marker */}
                      <line
                        x1="80"
                        y1="18"
                        x2="80"
                        y2="28"
                        stroke="#f472b6"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                      />
                    </svg>

                    {/* Big Center Note Letter */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pt-3 pointer-events-none">
                      <span className="text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-[#ffffff] to-[#e9d5ff] drop-shadow-[0_0_14px_rgba(192,132,252,0.6)] kumbh-sans">
                        {liveDetectedNote}
                      </span>
                      <span className="text-[10px] font-mono font-bold tracking-widest text-[#c084fc] mt-1">
                        {isActivelyTracking
                          ? (centsClamped >= 0 ? `+${centsClamped} CENTS` : `${centsClamped} CENTS`)
                          : 'IN TUNE'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: 4 Circular Arc Knobs & Bottom Mode Switches */}
          <div className="w-[270px] flex flex-col justify-between">
            {/* 2x2 Knobs Grid */}
            <div className="grid grid-cols-2 gap-y-4 gap-x-3 justify-items-center">
              {/* SPEED Knob */}
              <ArcKnob
                label="SPEED"
                leftSubLabel="SOFT"
                rightSubLabel="HARD"
                value={speed}
                min={0}
                max={100}
                step={1}
                defaultValue={75}
                displayValue={`${speed}%`}
                onChange={(val) => {
                  setSpeed(val);
                  emitParams({ speed: val });
                }}
              />

              {/* HUMANIZE Knob */}
              <ArcKnob
                label="HUMANIZE"
                leftSubLabel="TIGHT"
                rightSubLabel="LOOSE"
                value={humanize}
                min={0}
                max={100}
                step={1}
                defaultValue={20}
                displayValue={`${humanize}%`}
                onChange={(val) => {
                  setHumanize(val);
                  emitParams({ humanize: val });
                }}
              />

              {/* TRANSITION Knob */}
              <ArcKnob
                label="TRANSITION"
                leftSubLabel="SNAP"
                rightSubLabel="GLIDE"
                value={transition}
                min={0}
                max={100}
                step={1}
                defaultValue={30}
                displayValue={`${transition}%`}
                onChange={(val) => {
                  setTransition(val);
                  emitParams({ transition: val });
                }}
              />

              {/* COLOR Knob */}
              <ArcKnob
                label="COLOR"
                leftSubLabel="DARK"
                rightSubLabel="BRIGHT"
                value={color}
                min={0}
                max={100}
                step={1}
                defaultValue={50}
                displayValue={`${color}%`}
                onChange={(val) => {
                  setColor(val);
                  emitParams({ color: val });
                }}
              />
            </div>

            {/* Bottom Row Mode Switch */}
            <div className="mt-3 pt-3 border-t border-[#262630] flex flex-col items-center gap-1.5">
              <div className="flex items-center bg-[#101014] border border-[#2a2a34] rounded-full p-0.5 w-full max-w-[200px]">
                <button
                  type="button"
                  onClick={() => {
                    setModeHQ(0);
                    emitParams({ modeHQ: 0 });
                  }}
                  className={cn(
                    "flex-1 h-6 rounded-full text-[9px] font-extrabold tracking-wider transition-all cursor-pointer flex items-center justify-center",
                    modeHQ === 0
                      ? "bg-gradient-to-r from-[#f472b6] to-[#e879f9] text-black shadow-[0_0_8px_rgba(244,114,182,0.5)]"
                      : "text-[#777] hover:text-[#ccc]"
                  )}
                >
                  REAL TIME
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModeHQ(1);
                    emitParams({ modeHQ: 1 });
                  }}
                  className={cn(
                    "flex-1 h-6 rounded-full text-[9px] font-extrabold tracking-wider transition-all cursor-pointer flex items-center justify-center",
                    modeHQ === 1
                      ? "bg-gradient-to-r from-[#f472b6] to-[#e879f9] text-black shadow-[0_0_8px_rgba(244,114,182,0.5)]"
                      : "text-[#777] hover:text-[#ccc]"
                  )}
                >
                  HQ
                </button>
              </div>
              <span className="text-[9px] font-extrabold tracking-widest text-[#73737c] uppercase">
                PROCESSING MODE
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
