import React, { useState, useRef, useEffect } from 'react';
import { Power, X, ChevronLeft, ChevronRight, ChevronDown, Zap, Activity } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';
import { ProReverbNode } from '../dsp/reverb/ProReverbNode';

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
  { name: 'Analog Box of Hall', hcut: 12000, lcut: 120, predelay: 25, size: 75, mod: 35, diff: 85, speed: 1.5, bass: 1.1, decay: 3.5, cross: 500, damp: 5000, dry: 100, er: 45, wet: 55, sep: 15 },
  { name: 'Belton Spring & Tank', hcut: 9000, lcut: 180, predelay: 10, size: 50, mod: 45, diff: 90, speed: 2.8, bass: 0.9, decay: 2.2, cross: 400, damp: 4200, dry: 100, er: 60, wet: 50, sep: 0 },
  { name: 'Vintage Plate NE5532', hcut: 15000, lcut: 100, predelay: 15, size: 65, mod: 25, diff: 80, speed: 1.2, bass: 1.0, decay: 2.8, cross: 450, damp: 6500, dry: 100, er: 30, wet: 45, sep: 20 },
  { name: 'Warm Acoustic Chamber', hcut: 11000, lcut: 90, predelay: 20, size: 55, mod: 15, diff: 70, speed: 0.9, bass: 1.0, decay: 1.8, cross: 350, damp: 6000, dry: 100, er: 40, wet: 35, sep: 10 },
  { name: 'Endless Space & Feedback', hcut: 16000, lcut: 60, predelay: 60, size: 95, mod: 60, diff: 95, speed: 0.8, bass: 1.3, decay: 8.5, cross: 600, damp: 3800, dry: 80, er: 35, wet: 75, sep: 40 },
];

interface KnobProps {
  label: string;
  subLabel?: string;
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

function Knob({
  label,
  subLabel,
  value,
  min,
  max,
  step,
  defaultValue,
  displayValue,
  size = 'md',
  color = '#38bdf8',
  onChange,
}: KnobProps) {
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

  const knobPx = size === 'sm' ? 28 : size === 'lg' ? 44 : 36;
  const svgPx = size === 'sm' ? 40 : size === 'lg' ? 58 : 48;
  const radius = size === 'sm' ? 15 : size === 'lg' ? 22 : 18;
  const strokeWidth = size === 'lg' ? 3.5 : 3;
  const center = svgPx / 2;

  const startAngle = (-135 * Math.PI) / 180;
  const endAngle = (135 * Math.PI) / 180;
  const currentAngle = (angle * Math.PI) / 180;

  const getX = (a: number) => center + radius * Math.cos(a);
  const getY = (a: number) => center + radius * Math.sin(a);

  const bgPath = `M ${getX(startAngle)} ${getY(startAngle)} A ${radius} ${radius} 0 1 1 ${getX(endAngle)} ${getY(endAngle)}`;
  const largeArcFlag = angle - -135 > 180 ? 1 : 0;
  const activePath =
    normVal > 0.01
      ? `M ${getX(startAngle)} ${getY(startAngle)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${getX(currentAngle)} ${getY(currentAngle)}`
      : '';

  return (
    <div
      className="flex flex-col items-center select-none group cursor-pointer"
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
    >
      <div className="flex flex-col items-center text-center mb-0.5">
        <span className="text-[#f3f4f6] text-[10px] font-bold tracking-wider uppercase font-mono">
          {label}
        </span>
        {subLabel && (
          <span className="text-[#9ca3af] text-[8px] font-mono tracking-tight font-medium">
            {subLabel}
          </span>
        )}
      </div>

      <div className="relative flex items-center justify-center" style={{ width: svgPx, height: svgPx }}>
        <svg style={{ width: svgPx, height: svgPx }} className="transform -rotate-90">
          <path
            d={bgPath}
            fill="none"
            stroke="#262730"
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
              style={{ filter: `drop-shadow(0 0 3px ${color}88)` }}
            />
          )}
        </svg>

        <div
          className="absolute rounded-full bg-gradient-to-b from-[#2a2b34] to-[#16171d] border border-[#3f4150] shadow-md flex items-center justify-center"
          style={{
            width: knobPx,
            height: knobPx,
            transform: `rotate(${angle + 90}deg)`,
          }}
        >
          <div
            className="w-[2px] h-[7px] rounded-full absolute top-1"
            style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}` }}
          />
        </div>
      </div>

      <span className="text-[#e2e8f0] text-[10.5px] font-mono font-bold mt-1 tracking-tight">
        {displayValue}
      </span>
    </div>
  );
}

interface FaderProps {
  label: string;
  subLabel?: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  displayValue: string;
  color?: string;
  onChange: (val: number) => void;
}

function VerticalFader({
  label,
  subLabel,
  value,
  min,
  max,
  defaultValue,
  displayValue,
  color = '#38bdf8',
  onChange,
}: FaderProps) {
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
      <div className="flex flex-col items-center text-center mb-1">
        <span className="text-[#f3f4f6] text-[10px] font-bold tracking-wider uppercase font-mono">
          {label}
        </span>
        {subLabel && (
          <span className="text-[#9ca3af] text-[8px] font-mono tracking-tight font-medium">
            {subLabel}
          </span>
        )}
      </div>

      <div
        ref={trackRef}
        onMouseDown={handleMouseDown}
        onDoubleClick={() => onChange(defaultValue)}
        className="relative w-7 h-28 bg-[#101116] border border-[#2b2d38] rounded flex justify-center items-center py-1.5 shadow-inner"
      >
        <div className="w-[3px] h-full bg-[#20222a] rounded relative">
          <div
            className="absolute bottom-0 w-full rounded"
            style={{
              height: `${normVal * 100}%`,
              backgroundColor: color,
              boxShadow: `0 0 6px ${color}88`,
            }}
          />
        </div>

        <div
          className="absolute w-5.5 h-4 bg-gradient-to-b from-[#3a3c48] via-[#242630] to-[#14151b] border border-[#4d5060] rounded shadow-md flex items-center justify-center cursor-grab active:cursor-grabbing hover:border-[#38bdf8] transition-colors"
          style={{ bottom: `calc(${normVal * 100}% - 8px)` }}
        >
          <div className="w-full h-[2px] shadow-[0_0_4px_#38bdf8]" style={{ backgroundColor: color }} />
        </div>
      </div>

      <span className="text-[#e2e8f0] text-[10px] font-mono font-bold mt-1">
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
  analyser,
  isPlaying,
  onUpdateParams,
  onClose,
  zIndex,
  onFocus,
}: ReverbModalProps) {
  const p = slot.params || {};

  // Parameters
  const mode = p.mode ?? 0;
  const hcut = p.hcut ?? 12000;
  const lcut = p.lcut ?? 120;
  const predelay = p.predelay ?? 20;
  const tempoSync = p.tempoSync ?? 0;
  const size = p.size ?? 65;
  const mod = p.mod ?? 30;
  const diff = p.diff ?? 80;
  const speed = p.speed ?? 1.5;
  const bass = p.bass ?? 1.0;
  const decay = p.decay ?? 2.5;
  const cross = p.cross ?? 500;
  const damp = p.damp ?? 5000;
  const dry = p.dry ?? 100;
  const er = p.er ?? 40;
  const wet = p.wet ?? 50;
  const sep = p.sep ?? 0;

  const isBypassed = !!slot.bypassed;
  const [selectedPresetName, setSelectedPresetName] = useState('Analog Box of Hall');
  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false);

  // Live Circuit Telemetry Animation
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Window drag state
  const modalRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const defaultX = typeof window !== 'undefined' ? Math.max(40, window.innerWidth / 2 - 340) : 100;
    const defaultY = typeof window !== 'undefined' ? Math.max(60, window.innerHeight / 2 - 200) : 120;
    return { x: defaultX, y: defaultY };
  });
  const isDraggingWindow = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleWindowHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    isDraggingWindow.current = true;
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingWindow.current) return;
      setPosition({
        x: Math.max(10, Math.min(window.innerWidth - 680, moveEvent.clientX - dragOffset.current.x)),
        y: Math.max(10, Math.min(window.innerHeight - 380, moveEvent.clientY - dragOffset.current.y)),
      });
    };

    const handleMouseUp = () => {
      isDraggingWindow.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const updateParam = (key: string, val: number) => {
    const newParams = { ...p, [key]: val };
    onUpdateParams(slotIndex, isBypassed, newParams);
  };

  const toggleBypass = () => {
    onUpdateParams(slotIndex, !isBypassed, p);
  };

  const applyPreset = (preset: ReverbPreset) => {
    setSelectedPresetName(preset.name);
    setIsPresetDropdownOpen(false);
    const newParams = {
      ...p,
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
  };

  const cyclePreset = (direction: 'next' | 'prev') => {
    const curIdx = PRESETS.findIndex((pr) => pr.name === selectedPresetName);
    let nextIdx = direction === 'next' ? curIdx + 1 : curIdx - 1;
    if (nextIdx >= PRESETS.length) nextIdx = 0;
    if (nextIdx < 0) nextIdx = PRESETS.length - 1;
    applyPreset(PRESETS[nextIdx]);
  };

  // Real-time Circuit Flow & Oscilloscope Canvas Animation
  useEffect(() => {
    let animId: number;
    let time = 0;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animId = requestAnimationFrame(render);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animId = requestAnimationFrame(render);
        return;
      }

      const activeNode = ProReverbNode.lastActiveInstance;
      const telemetry = activeNode ? activeNode.getTelemetry() : { isProcessing: false, inputRms: 0, outputRms: 0 };
      const isLive = telemetry.isProcessing && !isBypassed;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Dark Chassis Background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#0c0d12');
      bgGrad.addColorStop(1, '#08090d');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Subtle Circuit Grid
      ctx.strokeStyle = '#181a24';
      ctx.lineWidth = 1;
      const gridSize = 16;
      for (let x = 0; x < w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      time += 0.05;

      // Draw Animated Circuit Schematic Nodes
      const midY = h / 2;
      const nodes = [
        { name: 'IN', x: 28, y: midY - 24, label: 'C1/R2' },
        { name: 'X1', x: 68, y: midY - 24, label: 'NE5532' },
        { name: 'TANK', x: 118, y: midY - 24, label: 'PT2399' },
        { name: 'X2', x: 168, y: midY - 24, label: 'SUM/GAIN' },
        { name: 'OUT', x: 206, y: midY - 24, label: 'R7/C5' },
      ];

      // Draw connection lines
      ctx.strokeStyle = isBypassed ? '#2d2e38' : '#38bdf866';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(nodes[0].x, nodes[0].y);
      for (let i = 1; i < nodes.length; i++) {
        ctx.lineTo(nodes[i].x, nodes[i].y);
      }
      ctx.stroke();

      // Feedback loop line from X2 back to Tank
      ctx.strokeStyle = isBypassed ? '#2d2e38' : '#f59e0b66';
      ctx.beginPath();
      ctx.moveTo(nodes[3].x, nodes[3].y + 6);
      ctx.lineTo(nodes[3].x, nodes[3].y + 22);
      ctx.lineTo(nodes[2].x, nodes[2].y + 22);
      ctx.lineTo(nodes[2].x, nodes[2].y + 6);
      ctx.stroke();

      // Draw Schematic Nodes
      nodes.forEach((n, idx) => {
        const isTank = n.name === 'TANK';
        const isOpAmp = n.name === 'X1' || n.name === 'X2';

        ctx.fillStyle = isBypassed ? '#1a1b22' : isTank ? '#0284c7' : isOpAmp ? '#ea580c' : '#1e293b';
        ctx.strokeStyle = isBypassed ? '#333544' : isTank ? '#38bdf8' : isOpAmp ? '#fb923c' : '#64748b';
        ctx.lineWidth = 1.2;

        ctx.beginPath();
        if (isOpAmp) {
          // Triangle for Op-Amp
          ctx.moveTo(n.x - 10, n.y - 8);
          ctx.lineTo(n.x + 10, n.y);
          ctx.lineTo(n.x - 10, n.y + 8);
          ctx.closePath();
        } else {
          ctx.arc(n.x, n.y, 9, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 7px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.name, n.x, n.y);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '6px monospace';
        ctx.fillText(n.label, n.x, n.y + 13);
      });

      // Draw Real-Time Reverb Waveform Oscilloscope Trace
      const oscY = h - 26;
      ctx.strokeStyle = isBypassed ? '#2c2d38' : '#38bdf8';
      ctx.lineWidth = 1.8;
      ctx.beginPath();

      const waveAmp = isLive ? 12 : 3;
      const decaySpread = Math.min(20, Math.max(1, decay));

      for (let x = 10; x < w - 10; x++) {
        const normX = (x - 10) / (w - 20);
        const env = Math.exp(-normX * (5.0 / decaySpread));
        const freq1 = 0.15 * (1 + (speed / 10));
        const freq2 = 0.08 * (1 + (size / 100));
        const yOffset =
          (Math.sin((x * freq1) + time * 4) * 0.6 +
            Math.sin((x * freq2) - time * 2) * 0.4) *
          waveAmp *
          env;

        const plotY = oscY + yOffset;
        if (x === 10) ctx.moveTo(x, plotY);
        else ctx.lineTo(x, plotY);
      }
      ctx.stroke();

      // Zero axis reference
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(10, oscY);
      ctx.lineTo(w - 10, oscY);
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [decay, speed, size, isBypassed]);

  return (
    <div className="fixed inset-0 z-[300] pointer-events-none">
      <div
        ref={modalRef}
        onMouseDown={() => onFocus?.()}
        style={{ left: `${position.x}px`, top: `${position.y}px`, width: '680px', zIndex: zIndex ?? 310 }}
        className="fixed pointer-events-auto bg-[#1a1b22] border border-[#373948] rounded-xl shadow-[0_25px_60px_rgba(0,0,0,0.95)] flex flex-col overflow-hidden font-sans select-none animate-in fade-in zoom-in-95 duration-100"
      >
        {/* Top Header Bar */}
        <div
          onMouseDown={handleWindowHeaderMouseDown}
          className="h-10 bg-[#22242e] border-b border-[#343746] px-3.5 flex items-center justify-between cursor-move"
        >
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={toggleBypass}
              className={cn(
                "w-6 h-6 rounded-full border flex items-center justify-center transition-all cursor-pointer",
                !isBypassed
                  ? "border-[#ffd900] text-[#ffd900] bg-[#ffd900]/15 shadow-[0_0_10px_rgba(255,217,0,0.5)]"
                  : "border-[#4a4c5a] text-[#717382] bg-[#14151a]"
              )}
              title="Bypass / Power Switch"
            >
              <Power className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-sm tracking-wide">
                Analog Circuit Reverb
              </span>
              <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-[#38bdf8]/10 text-[#38bdf8] border border-[#38bdf8]/30">
                NE5532 · PT2399
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Preset Selector */}
            <div className="relative flex items-center bg-[#14151b] border border-[#383a48] rounded-md px-1 h-6">
              <button
                type="button"
                onClick={() => cyclePreset('prev')}
                className="p-0.5 text-[#888] hover:text-white transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>

              <div
                onClick={() => setIsPresetDropdownOpen(!isPresetDropdownOpen)}
                className="px-2 text-xs text-[#ccc] hover:text-white cursor-pointer flex items-center gap-1.5 min-w-[125px] justify-between"
              >
                <span className="truncate text-[11px] font-medium">{selectedPresetName}</span>
                <ChevronDown className="w-3 h-3 text-[#777]" />
              </div>

              <button
                type="button"
                onClick={() => cyclePreset('next')}
                className="p-0.5 text-[#888] hover:text-white transition-colors cursor-pointer"
              >
                <ChevronRight className="w-3 h-3" />
              </button>

              {isPresetDropdownOpen && (
                <div className="absolute top-7 left-0 right-0 z-[350] bg-[#181922] border border-[#3e4152] rounded-md shadow-2xl py-1 flex flex-col gap-0.5 max-h-52 overflow-y-auto custom-scrollbar">
                  {PRESETS.map((pr) => (
                    <button
                      key={pr.name}
                      type="button"
                      onClick={() => applyPreset(pr)}
                      className={cn(
                        "px-2.5 py-1 text-left text-[11px] transition-colors hover:bg-[#282a38] hover:text-white cursor-pointer",
                        selectedPresetName === pr.name
                          ? "text-[#38bdf8] font-bold bg-[#222432]"
                          : "text-[#cbd5e1]"
                      )}
                    >
                      {pr.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded text-[#888] hover:text-white hover:bg-[#343746] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Plugin Body Divided into Circuit Sections */}
        <div className="p-3 bg-[#13141a] flex flex-col gap-2.5">
          {/* Top Row: Circuit Diagram Schematic Scope & Core Pots */}
          <div className="grid grid-cols-12 gap-2.5">
            {/* Left Block: Circuit Trace Scope & Telemetry */}
            <div className="col-span-4 bg-[#181a24] border border-[#2d2f3d] rounded-lg p-2 flex flex-col justify-between shadow-inner">
              <div className="flex items-center justify-between mb-1 px-0.5">
                <div className="flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-[#38bdf8]" />
                  <span className="text-[9px] font-bold font-mono tracking-widest text-[#cbd5e1] uppercase">
                    CIRCUIT STAGES
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
                  <span className="text-[8px] font-mono text-[#94a3b8]">8.4V RAIL</span>
                </div>
              </div>

              <div className="h-[95px] w-full rounded border border-[#252834] overflow-hidden bg-[#090a0e] shadow-inner">
                <canvas ref={canvasRef} width={230} height={95} className="w-full h-full block" />
              </div>

              <div className="flex items-center justify-between mt-1 px-1 text-[8.5px] font-mono text-[#94a3b8]">
                <span>VR6: Direct</span>
                <span className="text-[#38bdf8] font-bold">VR4: Reverb</span>
                <span>VR2: Effekt</span>
              </div>
            </div>

            {/* Middle Block 1: Input & Attack Filter Stage (VR5 "Attack", C1/C7/R9) */}
            <div className="col-span-4 bg-[#181a24] border border-[#2d2f3d] rounded-lg p-2.5 flex flex-col justify-between">
              <div className="text-[9px] font-mono font-bold text-[#f59e0b] tracking-wider uppercase flex items-center gap-1 mb-1">
                <Zap className="w-3 h-3" />
                <span>INPUT & ATTACK STAGE</span>
              </div>

              <div className="grid grid-cols-3 gap-1">
                <Knob
                  label="ATTACK"
                  subLabel="VR5 · 100k"
                  value={er}
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={40}
                  color="#f59e0b"
                  displayValue={`${er}%`}
                  onChange={(v) => updateParam('er', v)}
                />

                <Knob
                  label="PRE-DLY"
                  subLabel="Attack Time"
                  value={predelay}
                  min={0}
                  max={200}
                  step={1}
                  defaultValue={20}
                  color="#f59e0b"
                  displayValue={`${predelay}ms`}
                  onChange={(v) => updateParam('predelay', v)}
                />

                <Knob
                  label="L. CUT"
                  subLabel="C1 · 220n"
                  value={lcut}
                  min={20}
                  max={2000}
                  step={10}
                  defaultValue={120}
                  color="#f59e0b"
                  displayValue={`${lcut}Hz`}
                  onChange={(v) => updateParam('lcut', v)}
                />
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-[#252834] mt-1 text-[8.5px] font-mono text-[#94a3b8]">
                <span>X1 BUFFER: -1.0 GAIN</span>
                <span>FC: 15.9 kHz</span>
              </div>
            </div>

            {/* Middle Block 2: Reverb Core & Feedback (VR4 "Reverb", VR3 "Feedback") */}
            <div className="col-span-4 bg-[#181a24] border border-[#2d2f3d] rounded-lg p-2.5 flex flex-col justify-between">
              <div className="text-[9px] font-mono font-bold text-[#38bdf8] tracking-wider uppercase flex items-center gap-1 mb-1">
                <Activity className="w-3 h-3" />
                <span>REVERB & FEEDBACK TANK</span>
              </div>

              <div className="grid grid-cols-3 gap-1">
                <Knob
                  label="REVERB"
                  subLabel="VR4 · 10k"
                  value={decay}
                  min={0.2}
                  max={20.0}
                  step={0.1}
                  defaultValue={2.5}
                  size="md"
                  color="#38bdf8"
                  displayValue={`${decay.toFixed(1)}s`}
                  onChange={(v) => updateParam('decay', v)}
                />

                <Knob
                  label="FEEDBACK"
                  subLabel="VR3 · 100k"
                  value={size}
                  min={10}
                  max={100}
                  step={1}
                  defaultValue={65}
                  color="#38bdf8"
                  displayValue={`${size}%`}
                  onChange={(v) => updateParam('size', v)}
                />

                <Knob
                  label="DAMPING"
                  subLabel="C12 · 1n"
                  value={damp}
                  min={500}
                  max={18000}
                  step={100}
                  defaultValue={5000}
                  color="#38bdf8"
                  displayValue={`${(damp / 1000).toFixed(1)}k`}
                  onChange={(v) => updateParam('damp', v)}
                />
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-[#252834] mt-1 text-[8.5px] font-mono text-[#94a3b8]">
                <span>PIN 6 VCO TIMING</span>
                <span>C11 + R13 LOOP</span>
              </div>
            </div>
          </div>

          {/* Bottom Row: De-Emphasis, Modulation & Summing Mixer Faders */}
          <div className="grid grid-cols-12 gap-2.5">
            {/* Tone & Clock Modulation */}
            <div className="col-span-6 bg-[#181a24] border border-[#2d2f3d] rounded-lg p-2.5 flex flex-col justify-between">
              <div className="text-[9px] font-mono font-bold text-[#c084fc] tracking-wider uppercase flex items-center justify-between mb-1">
                <span>TONE SHAPING & CLOCK MODULATION</span>
                <div className="flex items-center gap-1">
                  <span className="text-[8px] text-[#94a3b8]">MODE:</span>
                  <button
                    type="button"
                    onClick={() => updateParam('mode', mode === 0 ? 1 : 0)}
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[8px] font-bold border transition-colors cursor-pointer",
                      mode === 1
                        ? "bg-[#c084fc]/20 border-[#c084fc] text-[#c084fc]"
                        : "bg-[#14151b] border-[#373a48] text-[#94a3b8]"
                    )}
                  >
                    {mode === 0 ? 'STEREO' : 'SIDE'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-1.5 py-0.5">
                <Knob
                  label="H. CUT"
                  subLabel="C4 · 220p"
                  value={hcut}
                  min={1000}
                  max={20000}
                  step={100}
                  defaultValue={12000}
                  color="#c084fc"
                  displayValue={`${(hcut / 1000).toFixed(1)}k`}
                  onChange={(v) => updateParam('hcut', v)}
                />

                <Knob
                  label="DIFFUSE"
                  subLabel="4-Allpass"
                  value={diff}
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={80}
                  color="#c084fc"
                  displayValue={`${diff}%`}
                  onChange={(v) => updateParam('diff', v)}
                />

                <Knob
                  label="MOD JITTER"
                  subLabel="VCO Drift"
                  value={mod}
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={30}
                  color="#c084fc"
                  displayValue={`${mod}%`}
                  onChange={(v) => updateParam('mod', v)}
                />

                <Knob
                  label="CLOCK RATE"
                  subLabel="Speed Hz"
                  value={speed}
                  min={0.1}
                  max={10.0}
                  step={0.1}
                  defaultValue={1.5}
                  color="#c084fc"
                  displayValue={`${speed.toFixed(1)}Hz`}
                  onChange={(v) => updateParam('speed', v)}
                />
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-[#252834] mt-1 text-[8.5px] font-mono text-[#94a3b8]">
                <span>DE-EMPHASIS: R14-R18</span>
                <span>INTEGRATION: C23-C26</span>
              </div>
            </div>

            {/* Summing Stage Mixer (VR6 Direct, VR2 Effekt, VR1 Gain) */}
            <div className="col-span-6 bg-[#181a24] border border-[#2d2f3d] rounded-lg p-2.5 flex flex-col justify-between">
              <div className="text-[9px] font-mono font-bold text-[#22c55e] tracking-wider uppercase flex items-center justify-between mb-1">
                <span>X2 SUMMING AMP & OUTPUT MIXER</span>
                <span className="text-[8px] text-[#94a3b8]">VR1 + R5 FEEDBACK</span>
              </div>

              <div className="flex items-center justify-around gap-2 py-0.5">
                <VerticalFader
                  label="DIRECT"
                  subLabel="VR6 · 100k"
                  value={dry}
                  min={0}
                  max={100}
                  defaultValue={100}
                  color="#60a5fa"
                  displayValue={`${dry}%`}
                  onChange={(v) => updateParam('dry', v)}
                />

                <VerticalFader
                  label="EFFEKT"
                  subLabel="VR2 · 100k"
                  value={wet}
                  min={0}
                  max={100}
                  defaultValue={50}
                  color="#22c55e"
                  displayValue={`${wet}%`}
                  onChange={(v) => updateParam('wet', v)}
                />

                <div className="flex flex-col items-center justify-center gap-1 pl-2 border-l border-[#272936]">
                  <Knob
                    label="GAIN"
                    subLabel="VR1 · 200k"
                    value={bass}
                    min={0.5}
                    max={2.0}
                    step={0.1}
                    defaultValue={1.0}
                    color="#22c55e"
                    displayValue={`${bass.toFixed(1)}x`}
                    onChange={(v) => updateParam('bass', v)}
                  />

                  <Knob
                    label="STEREO"
                    subLabel="Spread"
                    value={sep}
                    min={-100}
                    max={100}
                    step={1}
                    defaultValue={0}
                    size="sm"
                    color="#22c55e"
                    displayValue={`${sep > 0 ? '+' : ''}${sep}%`}
                    onChange={(v) => updateParam('sep', v)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-[#252834] mt-1 text-[8.5px] font-mono text-[#94a3b8]">
                <span>X2 SUMMING: -(DIRECT + EFFEKT)</span>
                <span>OUT: R6 + C6 → R7 || C5</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
