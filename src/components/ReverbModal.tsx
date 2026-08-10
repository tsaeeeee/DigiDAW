import React, { useState, useRef, useEffect } from 'react';
import { Power, X, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';

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
}

const PRESETS: ReverbPreset[] = [
  { name: 'Cathedral Hall', hcut: 12000, lcut: 120, predelay: 45, size: 85, mod: 35, diff: 80, speed: 1.2, bass: 1.2, decay: 4.5, cross: 600, damp: 4500, dry: 100, er: 40, wet: 55, sep: 20 },
  { name: 'Vocal Plate', hcut: 16000, lcut: 180, predelay: 15, size: 55, mod: 45, diff: 90, speed: 2.5, bass: 0.9, decay: 2.1, cross: 450, damp: 6500, dry: 100, er: 25, wet: 45, sep: 10 },
  { name: 'Small Acoustic Room', hcut: 10000, lcut: 80, predelay: 8, size: 30, mod: 10, diff: 60, speed: 0.8, bass: 1.0, decay: 0.9, cross: 300, damp: 8000, dry: 100, er: 60, wet: 30, sep: 0 },
  { name: 'Lush Chamber', hcut: 14000, lcut: 100, predelay: 25, size: 70, mod: 50, diff: 85, speed: 1.8, bass: 1.1, decay: 3.2, cross: 500, damp: 5000, dry: 100, er: 35, wet: 50, sep: 30 },
  { name: 'Ambient Space', hcut: 18000, lcut: 60, predelay: 80, size: 98, mod: 75, diff: 95, speed: 0.5, bass: 1.4, decay: 8.5, cross: 800, damp: 3200, dry: 85, er: 20, wet: 75, sep: 50 },
];

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  displayValue: string;
  size?: 'sm' | 'md' | 'lg';
  color?: string;
  onChange: (val: number) => void;
}

function Knob({ label, value, min, max, step, defaultValue, displayValue, size = 'md', color = '#38bdf8', onChange }: KnobProps) {
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

  const knobPx = size === 'sm' ? 28 : size === 'lg' ? 42 : 34;
  const svgPx = size === 'sm' ? 40 : size === 'lg' ? 56 : 46;
  const radius = size === 'sm' ? 15 : size === 'lg' ? 21 : 17;
  const strokeWidth = 3;
  const center = svgPx / 2;

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
      <span className="text-[#888] text-[9.5px] font-medium tracking-wide mb-0.5 capitalize">
        {label}
      </span>

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
              stroke="#38bdf8"
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

interface FaderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  displayValue: string;
  onChange: (val: number) => void;
}

function VerticalFader({ label, value, min, max, defaultValue, displayValue, onChange }: FaderProps) {
  const isDragging = useRef(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const normVal = Math.max(0, Math.min(1, (value - min) / (max - min)));

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;

    const updateFromMouse = (clientY: number) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const relativeY = rect.bottom - clientY;
      const ratio = Math.max(0, Math.min(1, relativeY / rect.height));
      const rawVal = min + ratio * (max - min);
      onChange(Math.round(rawVal));
    };

    updateFromMouse(e.clientY);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      updateFromMouse(moveEvent.clientY);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="flex flex-col items-center select-none cursor-pointer group">
      <span className="text-[#888] text-[9.5px] font-medium tracking-wide mb-0.5 capitalize">
        {label}
      </span>

      <div
        ref={trackRef}
        onMouseDown={handleMouseDown}
        onDoubleClick={() => onChange(defaultValue)}
        className="relative w-6 h-28 bg-[#141518] border border-[#2e2e34] rounded flex justify-center items-center py-1.5 shadow-inner"
      >
        {/* Track Line */}
        <div className="w-[3px] h-full bg-[#282830] rounded relative">
          <div
            className="absolute bottom-0 w-full bg-[#38bdf8] rounded"
            style={{ height: `${normVal * 100}%` }}
          />
        </div>

        {/* Fader Handle */}
        <div
          className="absolute w-5 h-3.5 bg-gradient-to-b from-[#3a3c44] via-[#282930] to-[#1a1b20] border border-[#4a4c56] rounded shadow-md flex items-center justify-center cursor-grab active:cursor-grabbing hover:border-[#38bdf8] transition-colors"
          style={{ bottom: `calc(${normVal * 100}% - 7px)` }}
        >
          <div className="w-full h-[2px] bg-[#38bdf8] shadow-[0_0_4px_#38bdf8]" />
        </div>
      </div>

      <span className="text-[#e0e0e0] text-[10px] font-mono font-medium mt-1">
        {displayValue}
      </span>
    </div>
  );
}

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

export function ReverbModal({
  slot,
  slotIndex,
  onUpdateParams,
  onClose,
  zIndex,
  onFocus,
}: ReverbModalProps) {
  const isDraggingWindow = useRef(false);
  const windowDragStart = useRef({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [position, setPosition] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(20, Math.round(window.innerWidth / 2 - 315)),
    y: Math.max(20, Math.round(window.innerHeight / 2 - 160)),
  }));

  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false);

  // Parameter states
  const params = slot.params || {};
  const isBypassed = !!slot.bypassed;

  const mode = params.mode ?? 0; // 0: Mid, 1: Side
  const hcut = params.hcut ?? 12000;
  const lcut = params.lcut ?? 120;
  const predelay = params.predelay ?? 20;
  const tempoSync = params.tempoSync ?? 0;
  const size = params.size ?? 65;
  const mod = params.mod ?? 30;
  const diff = params.diff ?? 80;
  const speed = params.speed ?? 1.5;
  const bass = params.bass ?? 1.0;
  const decay = params.decay ?? 2.5;
  const cross = params.cross ?? 500;
  const damp = params.damp ?? 5000;
  const dry = params.dry ?? 100;
  const er = params.er ?? 40;
  const wet = params.wet ?? 50;
  const sep = params.sep ?? 0;

  const updateParam = (key: string, value: number) => {
    const newParams = { ...params, [key]: value };
    onUpdateParams(slotIndex, isBypassed, newParams);
  };

  const toggleBypass = () => {
    onUpdateParams(slotIndex, !isBypassed, params);
  };

  const applyPreset = (preset: ReverbPreset) => {
    const newParams = {
      ...params,
      hcut: preset.hcut,
      lcut: preset.lcut,
      predelay: preset.predelay,
      size: preset.size,
      mod: preset.mod,
      diff: preset.diff,
      speed: preset.speed,
      bass: preset.bass,
      decay: preset.decay,
      cross: preset.cross,
      damp: preset.damp,
      dry: preset.dry,
      er: preset.er,
      wet: preset.wet,
      sep: preset.sep,
    };
    onUpdateParams(slotIndex, isBypassed, newParams);
    setIsPresetDropdownOpen(false);
  };

  const selectedPreset = PRESETS.find(
    p => p.size === size && p.decay === decay && p.wet === wet
  );
  const selectedPresetName = selectedPreset ? selectedPreset.name : 'Custom';

  const cyclePreset = (direction: 'prev' | 'next') => {
    let currIdx = PRESETS.findIndex(p => p.name === selectedPresetName);
    if (currIdx === -1) currIdx = 0;
    const nextIdx = direction === 'next' 
      ? (currIdx + 1) % PRESETS.length
      : (currIdx - 1 + PRESETS.length) % PRESETS.length;
    applyPreset(PRESETS[nextIdx]);
  };

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
      const newX = Math.max(10, Math.min(window.innerWidth - 820, moveEvent.clientX - windowDragStart.current.x));
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

  // 3D Wireframe Room Chamber visualizer rendering loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let angle = 0;

    const render = () => {
      angle += 0.015 * speed;

      // Handle full height canvas sizing
      const parent = canvas.parentElement;
      if (parent) {
        const pWidth = parent.clientWidth || 160;
        const pHeight = parent.clientHeight || 190;
        if (canvas.width !== pWidth || canvas.height !== pHeight) {
          canvas.width = pWidth;
          canvas.height = pHeight;
        }
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Background Radial Glow
      const bgGrad = ctx.createRadialGradient(w / 2, h / 2, 5, w / 2, h / 2, Math.max(w, h) / 1.2);
      bgGrad.addColorStop(0, '#1a2230');
      bgGrad.addColorStop(1, '#0e1117');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Wireframe Room Parameters
      const baseDim = Math.min(w, h);
      const roomRadius = baseDim * 0.28 + (size / 100) * (baseDim * 0.12);
      const roomHeight = baseDim * 0.35 + (decay / 20) * (baseDim * 0.2);
      const segments = Math.max(8, Math.round(12 + (diff / 100) * 12));

      // Perfect Center Alignment
      const cx = w / 2;
      const cy = h / 2;

      ctx.save();
      ctx.translate(cx, cy);

      // Project 3D Cylinder
      const topY = -roomHeight / 2;
      const botY = roomHeight / 2;

      ctx.strokeStyle = isBypassed ? '#444' : '#38bdf8';
      ctx.lineWidth = 1.2;
      ctx.shadowColor = isBypassed ? 'transparent' : '#38bdf8';
      ctx.shadowBlur = Math.min(15, decay * 1.5);

      // Top Ring
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2 + angle;
        const x = Math.cos(theta) * roomRadius;
        const z = Math.sin(theta) * (roomRadius * 0.4);
        if (i === 0) ctx.moveTo(x, topY + z);
        else ctx.lineTo(x, topY + z);
      }
      ctx.stroke();

      // Bottom Ring
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2 + angle;
        const x = Math.cos(theta) * roomRadius;
        const z = Math.sin(theta) * (roomRadius * 0.4);
        if (i === 0) ctx.moveTo(x, botY + z);
        else ctx.lineTo(x, botY + z);
      }
      ctx.stroke();

      // Middle Ring
      ctx.strokeStyle = isBypassed ? '#333' : 'rgba(56, 189, 248, 0.4)';
      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2 + angle;
        const x = Math.cos(theta) * (roomRadius * 1.05);
        const z = Math.sin(theta) * (roomRadius * 0.42);
        if (i === 0) ctx.moveTo(x, z);
        else ctx.lineTo(x, z);
      }
      ctx.stroke();

      // Vertical Spokes
      ctx.strokeStyle = isBypassed ? '#333' : 'rgba(56, 189, 248, 0.7)';
      for (let i = 0; i < segments; i++) {
        const theta = (i / segments) * Math.PI * 2 + angle;
        const x = Math.cos(theta) * roomRadius;
        const z = Math.sin(theta) * (roomRadius * 0.4);

        ctx.beginPath();
        ctx.moveTo(x, topY + z);
        ctx.lineTo(x, botY + z);
        ctx.stroke();
      }

      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [size, diff, decay, speed, isBypassed]);

  return (
    <div className="fixed inset-0 z-[300] pointer-events-none">
      <div
        onMouseDown={() => onFocus?.()}
        style={{ left: `${position.x}px`, top: `${position.y}px`, width: '630px', zIndex: zIndex ?? 310 }}
        className="fixed pointer-events-auto bg-[#222224] border border-[#3e3e42] rounded-lg shadow-[0_20px_50px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden font-sans select-none animate-in fade-in zoom-in-95 duration-100"
      >
        {/* Top Header Bar */}
        <div
          onMouseDown={handleWindowHeaderMouseDown}
          className="h-10 bg-[#2d2d30] border-b border-[#3a3a3e] px-3 flex items-center justify-between cursor-move"
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
              Reverb
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Preset Selector */}
            <div className="relative flex items-center bg-[#1a1a1c] border border-[#38383c] rounded px-1 h-5.5">
              <button
                type="button"
                onClick={() => cyclePreset('prev')}
                className="p-0.5 text-[#888] hover:text-white transition-colors"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>

              <div
                onClick={() => setIsPresetDropdownOpen(!isPresetDropdownOpen)}
                className="px-1.5 text-xs text-[#ccc] hover:text-white cursor-pointer flex items-center gap-1 min-w-[95px] justify-between"
              >
                <span className="truncate text-[10.5px] font-medium">{selectedPresetName}</span>
                <ChevronDown className="w-2.5 h-2.5 text-[#777]" />
              </div>

              <button
                type="button"
                onClick={() => cyclePreset('next')}
                className="p-0.5 text-[#888] hover:text-white transition-colors"
              >
                <ChevronRight className="w-3 h-3" />
              </button>

              {isPresetDropdownOpen && (
                <div className="absolute top-6 left-0 right-0 z-[350] bg-[#1c1c1f] border border-[#444] rounded shadow-xl py-1 flex flex-col gap-0.5 max-h-48 overflow-y-auto custom-scrollbar">
                  {PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className={cn(
                        "px-2 py-0.5 text-left text-[10.5px] transition-colors hover:bg-[#333] hover:text-white",
                        selectedPresetName === p.name ? "text-[#38bdf8] font-semibold bg-[#2a2a2e]" : "text-[#ccc]"
                      )}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-0.5 rounded text-[#888] hover:text-white hover:bg-[#38383c] transition-colors ml-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Main Plugin Body divided into compact sections */}
        <div className="p-2 bg-[#18181b] flex items-stretch gap-1.5 min-h-[200px]">
          {/* Section 1: Full Height 3D Room Wireframe Canvas */}
          <div className="w-[125px] bg-[#121316] border border-[#2d2e36] rounded p-1.5 flex flex-col items-center justify-between shrink-0 shadow-inner">
            <div className="flex-1 w-full h-full flex items-center justify-center relative min-h-[140px]">
              <canvas
                ref={canvasRef}
                className="w-full h-full rounded border border-[#23252d]"
              />
            </div>
            <div className="text-[9px] text-[#888] font-mono tracking-wider capitalize mt-1.5 font-semibold text-center">
              3D Room Chamber
            </div>
          </div>

          {/* Section 2: Mode & Filter */}
          <div className="flex flex-col justify-between items-center bg-[#1e1e22] border border-[#303138] rounded p-1.5 w-[75px] shrink-0">
            {/* Mid / Side Switch */}
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[#888] text-[9.5px] font-medium tracking-wide capitalize">
                Mode
              </span>
              <button
                type="button"
                onClick={() => updateParam('mode', mode === 0 ? 1 : 0)}
                className={cn(
                  "w-8 h-4 rounded-full p-0.5 border flex items-center transition-colors cursor-pointer",
                  mode === 1 ? "bg-[#38bdf8]/20 border-[#38bdf8]" : "bg-[#141518] border-[#383b48]"
                )}
              >
                <div
                  className={cn(
                    "w-3 h-3 rounded-full transition-transform",
                    mode === 1 ? "translate-x-3.5 bg-[#38bdf8]" : "translate-x-0 bg-[#888]"
                  )}
                />
              </button>
              <span className="text-[9px] font-semibold text-[#38bdf8] capitalize">
                {mode === 0 ? 'Mid' : 'Side'}
              </span>
            </div>

            <Knob
              label="H. Cut"
              value={hcut}
              min={1000}
              max={20000}
              step={100}
              defaultValue={12000}
              displayValue={`${(hcut / 1000).toFixed(1)} kHz`}
              onChange={(v) => updateParam('hcut', v)}
            />

            <Knob
              label="L. Cut"
              value={lcut}
              min={20}
              max={2000}
              step={10}
              defaultValue={120}
              displayValue={`${lcut} Hz`}
              onChange={(v) => updateParam('lcut', v)}
            />
          </div>

          {/* Section 3: Delay & Room */}
          <div className="grid grid-cols-2 gap-1.5 bg-[#1e1e22] border border-[#303138] rounded p-1.5 w-[130px] shrink-0">
            <Knob
              label="Pre Delay"
              value={predelay}
              min={0}
              max={200}
              step={1}
              defaultValue={20}
              displayValue={`${predelay} ms`}
              onChange={(v) => updateParam('predelay', v)}
            />

            <div className="flex flex-col items-center justify-center">
              <span className="text-[#888] text-[9.5px] font-medium tracking-wide mb-0.5 capitalize">
                Tempo
              </span>
              <button
                type="button"
                onClick={() => updateParam('tempoSync', tempoSync === 0 ? 1 : 0)}
                className={cn(
                  "w-5 h-5 rounded-full border flex items-center justify-center transition-colors cursor-pointer",
                  tempoSync === 1 ? "bg-[#38bdf8] text-black border-[#38bdf8] shadow-[0_0_8px_#38bdf8]" : "bg-[#141518] text-[#777] border-[#383b48]"
                )}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-current" />
              </button>
            </div>

            <Knob
              label="Size"
              value={size}
              min={10}
              max={100}
              step={1}
              defaultValue={65}
              displayValue={`${size}%`}
              onChange={(v) => updateParam('size', v)}
            />

            <Knob
              label="Modulation"
              value={mod}
              min={0}
              max={100}
              step={1}
              defaultValue={30}
              displayValue={`${mod}%`}
              onChange={(v) => updateParam('mod', v)}
            />

            <Knob
              label="Diffusion"
              value={diff}
              min={0}
              max={100}
              step={1}
              defaultValue={80}
              displayValue={`${diff}%`}
              onChange={(v) => updateParam('diff', v)}
            />

            <Knob
              label="Speed"
              value={speed}
              min={0.1}
              max={10.0}
              step={0.1}
              defaultValue={1.5}
              displayValue={`${speed.toFixed(1)} Hz`}
              onChange={(v) => updateParam('speed', v)}
            />
          </div>

          {/* Section 4: Decay & Damp */}
          <div className="grid grid-cols-2 gap-1.5 bg-[#1e1e22] border border-[#303138] rounded p-1.5 w-[125px] shrink-0">
            <Knob
              label="Bass"
              value={bass}
              min={0.5}
              max={2.0}
              step={0.1}
              defaultValue={1.0}
              displayValue={`${bass.toFixed(1)}x`}
              onChange={(v) => updateParam('bass', v)}
            />

            <Knob
              label="Decay"
              value={decay}
              min={0.2}
              max={20.0}
              step={0.1}
              defaultValue={2.5}
              displayValue={`${decay.toFixed(1)}s`}
              onChange={(v) => updateParam('decay', v)}
            />

            <Knob
              label="Crossover"
              value={cross}
              min={100}
              max={2000}
              step={50}
              defaultValue={500}
              displayValue={`${cross} Hz`}
              onChange={(v) => updateParam('cross', v)}
            />

            <Knob
              label="Damping"
              value={damp}
              min={500}
              max={18000}
              step={100}
              defaultValue={5000}
              displayValue={`${(damp / 1000).toFixed(1)} kHz`}
              onChange={(v) => updateParam('damp', v)}
            />
          </div>

          {/* Section 5: Faders & Output Mix */}
          <div className="flex flex-col justify-between items-center bg-[#1e1e22] border border-[#303138] rounded p-1.5 w-[125px] shrink-0">
            <div className="flex items-center gap-1.5 justify-center w-full">
              <VerticalFader
                label="Dry"
                value={dry}
                min={0}
                max={100}
                defaultValue={100}
                displayValue={`${dry}%`}
                onChange={(v) => updateParam('dry', v)}
              />

              <VerticalFader
                label="Early Ref"
                value={er}
                min={0}
                max={100}
                defaultValue={40}
                displayValue={`${er}%`}
                onChange={(v) => updateParam('er', v)}
              />

              <VerticalFader
                label="Wet"
                value={wet}
                min={0}
                max={100}
                defaultValue={50}
                displayValue={`${wet}%`}
                onChange={(v) => updateParam('wet', v)}
              />
            </div>

            <div className="mt-0.5 flex items-center justify-center">
              <Knob
                label="Stereo Sep"
                value={sep}
                min={-100}
                max={100}
                step={1}
                defaultValue={0}
                size="sm"
                displayValue={`${sep > 0 ? '+' : ''}${sep}%`}
                onChange={(v) => updateParam('sep', v)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

