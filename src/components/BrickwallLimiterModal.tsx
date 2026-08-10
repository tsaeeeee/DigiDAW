import React, { useState, useRef, useEffect } from 'react';
import { Power, X, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';

interface LimiterPreset {
  name: string;
  ceiling: number;   // in dBFS (-24 to 0)
  drive: number;     // in dB (0 to 24)
  release: number;   // in ms (5 to 1000)
  diodeSat: number;  // % (0 to 100)
  truePeak: number;  // 1 or 0
}

const PRESETS: LimiterPreset[] = [
  { name: 'Mastering -0.1dB', ceiling: -0.1, drive: 3.0, release: 50, diodeSat: 15, truePeak: 1 },
  { name: 'Analog Slam', ceiling: -0.3, drive: 10.0, release: 35, diodeSat: 65, truePeak: 1 },
  { name: 'Streaming -0.5dB', ceiling: -0.5, drive: 5.0, release: 60, diodeSat: 20, truePeak: 1 },
  { name: 'Transparent Wall', ceiling: -0.1, drive: 0.0, release: 20, diodeSat: 0, truePeak: 1 },
  { name: 'Heavy Brickwall', ceiling: -3.0, drive: 8.0, release: 80, diodeSat: 30, truePeak: 1 },
  { name: 'Diode Limiter', ceiling: -0.2, drive: 12.0, release: 40, diodeSat: 80, truePeak: 1 },
];

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  displayValue: string;
  onChange: (val: number) => void;
}

function Knob({ label, value, min, max, step, defaultValue, displayValue, onChange }: KnobProps) {
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
    return newVal;
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

  const radius = 18;
  const strokeWidth = 3;
  const center = 24;
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
      <span className="text-[#888] text-[10px] font-medium tracking-wide mb-1">
        {label}
      </span>

      <div className="relative w-12 h-12 flex items-center justify-center">
        <svg className="w-12 h-12 transform -rotate-90">
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
              stroke="#eab308"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          )}
        </svg>

        <div 
          className="absolute w-8 h-8 rounded-full bg-[#1e1e22] border border-[#383842] shadow-md flex items-center justify-center"
          style={{ transform: `rotate(${angle + 90}deg)` }}
        />
      </div>

      <span className="text-[#e0e0e0] text-[11px] font-mono font-medium mt-1">
        {displayValue}
      </span>
    </div>
  );
}

interface BrickwallLimiterModalProps {
  slot: EffectSlot;
  slotIndex: number;
  analyser?: any;
  isPlaying?: boolean;
  onUpdateParams: (slotIndex: number, bypassed: boolean, params: Record<string, number>) => void;
  onClose: () => void;
}

export function BrickwallLimiterModal({
  slot,
  slotIndex,
  analyser,
  isPlaying,
  onUpdateParams,
  onClose,
}: BrickwallLimiterModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [position, setPosition] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(20, Math.round(window.innerWidth / 2 - 220)),
    y: Math.max(20, Math.round(window.innerHeight / 2 - 180)),
  }));

  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false);
  const [selectedPresetName, setSelectedPresetName] = useState<string>('Custom');

  // States for live meter text overlay
  const [liveMetrics, setLiveMetrics] = useState({ inPeak: -100, outPeak: -100, grDb: 0, isClipping: false });

  // Parameter states
  const params = slot.params || {};
  const ceiling = params.ceiling ?? -0.5;    // dBFS (-24 to 0)
  const drive = params.drive ?? 4.0;        // dB (0 to 24)
  const release = params.release ?? 50;     // ms (5 to 1000)
  const diodeSat = params.diodeSat ?? 15;   // % (0 to 100)
  const truePeak = params.truePeak ?? 1;    // 1 or 0
  const isBypassed = !!slot.bypassed;

  const updateParam = (key: string, val: number) => {
    onUpdateParams(slotIndex, isBypassed, {
      ceiling,
      drive,
      release,
      diodeSat,
      truePeak,
      ...params,
      [key]: val,
    });
    setSelectedPresetName('Custom');
  };

  const toggleBypass = () => {
    onUpdateParams(slotIndex, !isBypassed, {
      ceiling,
      drive,
      release,
      diodeSat,
      truePeak,
      ...params,
    });
  };

  const applyPreset = (preset: LimiterPreset) => {
    setSelectedPresetName(preset.name);
    onUpdateParams(slotIndex, isBypassed, {
      ceiling: preset.ceiling,
      drive: preset.drive,
      release: preset.release,
      diodeSat: preset.diodeSat,
      truePeak: preset.truePeak,
    });
    setIsPresetDropdownOpen(false);
  };

  const cyclePreset = (direction: 'prev' | 'next') => {
    let currIdx = PRESETS.findIndex(p => p.name === selectedPresetName);
    if (currIdx === -1) currIdx = 0;
    const nextIdx = direction === 'next' 
      ? (currIdx + 1) % PRESETS.length
      : (currIdx - 1 + PRESETS.length) % PRESETS.length;
    applyPreset(PRESETS[nextIdx]);
  };

  // Drag handler
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('select')) return;
    e.preventDefault();

    const startX = e.clientX - position.x;
    const startY = e.clientY - position.y;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newX = Math.max(10, Math.min(window.innerWidth - 440, moveEvent.clientX - startX));
      const newY = Math.max(10, Math.min(window.innerHeight - 340, moveEvent.clientY - startY));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Canvas Limiter Spectrum Visualizer rendering loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const historyLength = 120;
    const history: { rawIn: number; drivenIn: number; outDb: number; gr: number }[] = Array.from({ length: historyLength }).map(() => ({
      rawIn: -100,
      drivenIn: -100,
      outDb: -100,
      gr: 0,
    }));

    let currentGr = 0;
    let clipHoldTimer = 0;

    const render = () => {
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

      // Drive input signal boost
      const drivenInDb = isBypassed ? rawInDb : rawInDb + drive;

      // Limiter action
      let targetGr = 0;
      let outDb = drivenInDb;

      if (!isBypassed && drivenInDb > ceiling) {
        targetGr = drivenInDb - ceiling;
        outDb = ceiling; // Hard limit at set ceiling
      }

      // Smooth release
      const attackCoeff = 0.95;
      const releaseCoeff = Math.min(1, 10 / Math.max(5, release));
      if (targetGr > currentGr) {
        currentGr += (targetGr - currentGr) * attackCoeff;
      } else {
        currentGr += (targetGr - currentGr) * releaseCoeff;
      }

      const isClippingNow = !isBypassed && targetGr > 0.1;
      if (isClippingNow) {
        clipHoldTimer = 15; // Hold red flash for 15 frames
      } else if (clipHoldTimer > 0) {
        clipHoldTimer--;
      }

      history.shift();
      history.push({
        rawIn: rawInDb,
        drivenIn: drivenInDb,
        outDb,
        gr: currentGr,
      });

      // Update react metrics state
      setLiveMetrics({
        inPeak: drivenInDb,
        outPeak: outDb,
        grDb: currentGr,
        isClipping: clipHoldTimer > 0,
      });

      // Canvas dimensions
      const w = canvas.width;
      const h = canvas.height;
      const plotRightMargin = 55;
      const plotWidth = w - plotRightMargin;
      const plotTop = 14;
      const plotBottom = h - 10;
      const plotHeight = plotBottom - plotTop;

      ctx.clearRect(0, 0, w, h);

      // Dark chassis background
      ctx.fillStyle = '#141416';
      ctx.fillRect(0, 0, w, h);

      // Grid dB lines
      const dbSteps = [0, -6, -12, -24, -36, -48, -60];
      ctx.strokeStyle = '#252528';
      ctx.lineWidth = 1;
      ctx.font = '9px monospace, sans-serif';
      ctx.fillStyle = '#666670';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      dbSteps.forEach((db) => {
        const normY = (0 - db) / 60;
        const y = plotTop + normY * plotHeight;

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotWidth, y);
        ctx.stroke();

        ctx.fillText(`${db}dB`, w - 6, y);
      });

      // 1. Driven Input Waveform
      ctx.beginPath();
      ctx.moveTo(0, plotBottom);

      for (let i = 0; i < historyLength; i++) {
        const x = (i / (historyLength - 1)) * plotWidth;
        const normDb = Math.max(0, Math.min(1, (history[i].drivenIn + 60) / 60));
        const y = plotBottom - normDb * plotHeight;
        ctx.lineTo(x, y);
      }

      ctx.lineTo(plotWidth, plotBottom);
      ctx.closePath();

      const inGrad = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
      inGrad.addColorStop(0, 'rgba(234, 179, 8, 0.45)');
      inGrad.addColorStop(1, 'rgba(234, 179, 8, 0.05)');
      ctx.fillStyle = inGrad;
      ctx.fill();

      // 2. Output Limited Waveform
      ctx.beginPath();
      for (let i = 0; i < historyLength; i++) {
        const x = (i / (historyLength - 1)) * plotWidth;
        const normDb = Math.max(0, Math.min(1, (history[i].outDb + 60) / 60));
        const y = plotBottom - normDb * plotHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 3. Ceiling Line
      const ceilNormY = Math.max(0, Math.min(1, (0 - ceiling) / 60));
      const ceilY = plotTop + ceilNormY * plotHeight;

      if (clipHoldTimer > 0) {
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 10;
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2.0;
      } else {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 1.5;
      }

      ctx.beginPath();
      ctx.setLineDash([4, 2]);
      ctx.moveTo(0, ceilY);
      ctx.lineTo(plotWidth, ceilY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;

      // Ceiling Tag
      ctx.fillStyle = clipHoldTimer > 0 ? '#ef4444' : '#eab308';
      ctx.font = 'bold 9px font-mono, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`Ceiling ${ceiling.toFixed(1)} dBFS`, 6, ceilY - 5 > plotTop + 8 ? ceilY - 5 : ceilY + 10);

      // 4. Gain Reduction Curve
      ctx.beginPath();
      for (let i = 0; i < historyLength; i++) {
        const x = (i / (historyLength - 1)) * plotWidth;
        const grDb = history[i].gr;
        const normGr = Math.min(1, Math.max(0, grDb / 20));
        const y = plotTop + normGr * (plotHeight * 0.6);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 2.0;
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [analyser, isPlaying, ceiling, drive, release, isBypassed]);

  return (
    <div className="fixed inset-0 z-[300] pointer-events-none">
      <div
        ref={modalRef}
        style={{ left: `${position.x}px`, top: `${position.y}px`, width: '440px' }}
        className="fixed z-[310] pointer-events-auto bg-[#202023] border border-[#3e3e44] rounded-lg shadow-[0_20px_50px_rgba(0,0,0,0.95)] flex flex-col overflow-hidden font-sans select-none animate-in fade-in zoom-in-95 duration-100"
      >
        {/* Header Bar */}
        <div
          onMouseDown={handleHeaderMouseDown}
          className="h-10 bg-[#2a2a2d] border-b border-[#38383d] px-3 flex items-center justify-between cursor-move"
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleBypass}
              className={cn(
                "w-6 h-6 rounded-full border flex items-center justify-center transition-all",
                !isBypassed
                  ? "border-[#eab308] text-[#eab308] bg-[#eab308]/15 shadow-[0_0_8px_rgba(234,179,8,0.4)]"
                  : "border-[#555] text-[#777] bg-[#1a1a1a]"
              )}
            >
              <Power className="w-3.5 h-3.5" />
            </button>

            <span className="text-white font-bold text-sm tracking-wide">
              Limiter
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Preset Selector */}
            <div className="relative flex items-center bg-[#18181a] border border-[#38383c] rounded px-1 h-6">
              <button
                type="button"
                onClick={() => cyclePreset('prev')}
                className="p-0.5 text-[#888] hover:text-white transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <div
                onClick={() => setIsPresetDropdownOpen(!isPresetDropdownOpen)}
                className="px-2 text-xs text-[#ccc] hover:text-white cursor-pointer flex items-center gap-1 min-w-[85px] justify-between"
              >
                <span className="truncate text-[11px] font-medium">{selectedPresetName}</span>
                <ChevronDown className="w-3 h-3 text-[#777]" />
              </div>

              <button
                type="button"
                onClick={() => cyclePreset('next')}
                className="p-0.5 text-[#888] hover:text-white transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>

              {/* Preset Dropdown */}
              {isPresetDropdownOpen && (
                <div className="absolute top-7 left-0 right-0 z-[350] bg-[#1a1a1d] border border-[#444] rounded shadow-xl py-1 flex flex-col gap-0.5 max-h-48 overflow-y-auto custom-scrollbar">
                  {PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className={cn(
                        "px-2 py-1 text-left text-[11px] transition-colors hover:bg-[#333] hover:text-white",
                        selectedPresetName === p.name ? "text-[#eab308] font-bold bg-[#28282d]" : "text-[#ccc]"
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
              className="w-6 h-6 rounded flex items-center justify-center text-[#999] hover:text-white hover:bg-[#3a3a3e] transition-colors ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Display Canvas Section */}
        <div className="p-3 bg-[#151517] flex flex-col gap-2 relative">
          <canvas
            ref={canvasRef}
            width={414}
            height={135}
            className="rounded border border-[#2a2a2f] bg-[#141416] shadow-inner"
          />

          {/* Meter Bar: Separate, non-moving UI panels for Drive In and Limited Out */}
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
            {/* 1. Drive In Panel */}
            <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#1c1c1f] border border-[#2d2d32] rounded text-[11px]">
              <span className="text-[#888] font-sans font-medium">Drive In</span>
              <span className="text-[#eab308] font-bold font-mono tabular-nums text-right w-16">
                {liveMetrics.inPeak > -90 ? `${liveMetrics.inPeak.toFixed(1)} dB` : '-∞ dB'}
              </span>
            </div>

            {/* 2. Limited Out Panel */}
            <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#1c1c1f] border border-[#2d2d32] rounded text-[11px]">
              <span className="text-[#888] font-sans font-medium">Limited Out</span>
              <span className="text-[#06b6d4] font-bold font-mono tabular-nums text-right w-16">
                {liveMetrics.outPeak > -90 ? `${liveMetrics.outPeak.toFixed(1)} dB` : '-∞ dB'}
              </span>
            </div>

            {/* 3. Clip Indicator */}
            <div
              className="flex items-center justify-center h-full px-2.5 bg-[#1c1c1f] border border-[#2d2d32] rounded"
              title="Clip / Peak Indicator"
            >
              <div
                className={cn(
                  "w-2.5 h-2.5 rounded-full transition-all border shrink-0",
                  liveMetrics.isClipping
                    ? "bg-red-500 border-red-300 shadow-[0_0_8px_#ef4444] animate-pulse"
                    : "bg-[#222] border-[#444]"
                )}
              />
            </div>
          </div>
        </div>

        {/* 5 Control Knobs Section */}
        <div className="px-3 py-3 bg-[#202023] border-t border-[#2a2a2e] grid grid-cols-5 gap-1.5">
          <Knob
            label="Ceiling"
            value={ceiling}
            min={-24.0}
            max={0.0}
            step={0.1}
            defaultValue={-0.5}
            displayValue={`${ceiling.toFixed(1)} dB`}
            onChange={(v) => updateParam('ceiling', v)}
          />

          <Knob
            label="Input Drive"
            value={drive}
            min={0.0}
            max={24.0}
            step={0.1}
            defaultValue={4.0}
            displayValue={`+${drive.toFixed(1)} dB`}
            onChange={(v) => updateParam('drive', v)}
          />

          <Knob
            label="Release"
            value={release}
            min={5}
            max={1000}
            step={1}
            defaultValue={50}
            displayValue={`${Math.round(release)} ms`}
            onChange={(v) => updateParam('release', v)}
          />

          <Knob
            label="Analog Sat"
            value={diodeSat}
            min={0}
            max={100}
            step={1}
            defaultValue={15}
            displayValue={`${Math.round(diodeSat)}%`}
            onChange={(v) => updateParam('diodeSat', v)}
          />

          {/* ISP True Peak Switch Control */}
          <div className="flex flex-col items-center select-none cursor-pointer" onClick={() => updateParam('truePeak', truePeak === 1 ? 0 : 1)}>
            <span className="text-[#888] text-[10px] font-medium tracking-wide mb-1">
              True Peak
            </span>

            <div className="w-12 h-12 flex items-center justify-center">
              <div
                className={cn(
                  "w-10 h-7 rounded-full p-1 transition-all border flex items-center",
                  truePeak === 1
                    ? "bg-[#eab308]/20 border-[#eab308] justify-end"
                    : "bg-[#18181b] border-[#38383d] justify-start"
                )}
              >
                <div
                  className={cn(
                    "w-5 h-5 rounded-full shadow-md transition-all flex items-center justify-center text-[8px] font-mono font-bold",
                    truePeak === 1 ? "bg-[#eab308] text-black" : "bg-[#444] text-[#888]"
                  )}
                >
                  {truePeak === 1 ? 'On' : 'Off'}
                </div>
              </div>
            </div>

            <span className="text-[#e0e0e0] text-[11px] font-mono font-medium mt-1">
              {truePeak === 1 ? 'Enabled' : 'Bypass'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

