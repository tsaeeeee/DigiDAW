import React, { useState, useRef, useEffect } from 'react';
import { Power, X, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';

interface CompressorPreset {
  name: string;
  attack: number;    // in ms
  release: number;   // in ms
  ratio: number;     // ratio value (1 - 20)
  threshold: number; // in dB
  output: number;    // in dB
}

const PRESETS: CompressorPreset[] = [
  { name: 'Default', attack: 10, release: 100, ratio: 4, threshold: -20, output: 0 },
  { name: 'Punchy Drums', attack: 15, release: 80, ratio: 6, threshold: -18, output: 3 },
  { name: 'Smooth Vocal', attack: 5, release: 150, ratio: 3, threshold: -22, output: 2 },
  { name: 'Bass Control', attack: 25, release: 120, ratio: 4, threshold: -16, output: 2 },
  { name: 'Hard Slam', attack: 0.5, release: 40, ratio: 12, threshold: -28, output: 6 },
  { name: 'Master Bus', attack: 30, release: 100, ratio: 2, threshold: -12, output: 1 },
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
      // 150px drag distance for full range, 4x finer with Shift
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

  // Calculate angle for knob pointer (-135deg to +135deg)
  const normVal = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const angle = -135 + normVal * 270;

  // Arc calculations for SVG
  const radius = 18;
  const strokeWidth = 3;
  const center = 24;
  const startAngle = (-135 * Math.PI) / 180;
  const endAngle = (135 * Math.PI) / 180;
  const currentAngle = (angle * Math.PI) / 180;

  const getX = (a: number) => center + radius * Math.cos(a);
  const getY = (a: number) => center + radius * Math.sin(a);

  // Background arc path
  const bgPath = `M ${getX(startAngle)} ${getY(startAngle)} A ${radius} ${radius} 0 1 1 ${getX(endAngle)} ${getY(endAngle)}`;
  
  // Active arc path
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
          {/* Background Arc Track */}
          <path
            d={bgPath}
            fill="none"
            stroke="#2a2a2e"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          {/* Active Arc Track */}
          {activePath && (
            <path
              d={activePath}
              fill="none"
              stroke="#ffffff"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          )}
        </svg>

        {/* Inner Knob Body */}
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
  const modalRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Position state for dragging
  const [position, setPosition] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(20, Math.round(window.innerWidth / 2 - 215)),
    y: Math.max(20, Math.round(window.innerHeight / 2 - 180)),
  }));

  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false);
  const [selectedPresetName, setSelectedPresetName] = useState<string>('Custom');

  // Parameter states
  const params = slot.params || {};
  const attack = params.attack ?? 10;         // ms
  const release = params.release ?? 100;      // ms
  const ratio = params.ratio ?? 4;           // ratio multiplier
  const threshold = params.threshold ?? -20; // dB
  const output = params.output ?? 0;         // dB
  const isBypassed = !!slot.bypassed;

  const updateParam = (key: string, val: number) => {
    onUpdateParams(slotIndex, isBypassed, {
      ...params,
      attack,
      release,
      ratio,
      threshold,
      output,
      [key]: val,
    });
    setSelectedPresetName('Custom');
  };

  const toggleBypass = () => {
    onUpdateParams(slotIndex, !isBypassed, {
      attack,
      release,
      ratio,
      threshold,
      output,
      ...params,
    });
  };

  const applyPreset = (preset: CompressorPreset) => {
    setSelectedPresetName(preset.name);
    onUpdateParams(slotIndex, isBypassed, {
      attack: preset.attack,
      release: preset.release,
      ratio: preset.ratio,
      threshold: preset.threshold,
      output: preset.output,
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

  // Window dragging handler
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    // Only drag when clicking header bar, not buttons
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('select')) return;
    e.preventDefault();

    const startX = e.clientX - position.x;
    const startY = e.clientY - position.y;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newX = Math.max(10, Math.min(window.innerWidth - 420, moveEvent.clientX - startX));
      const newY = Math.max(10, Math.min(window.innerHeight - 320, moveEvent.clientY - startY));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Canvas visualizer rendering loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const historyLength = 120;
    const history: { db: number; gr: number }[] = Array.from({ length: historyLength }).map(() => ({ db: -100, gr: 0 }));

    let currentGr = 0;

    const render = () => {
      let inputDb = -100;

      // Always prefer isolated pre-fader meter so channel mixer volume gain does not trigger or affect the compressor input
      const targetMeter = analyser?.preFaderMeter || analyser?.meter;
      if (targetMeter) {
        try {
          const val = targetMeter.getValue();
          if (Array.isArray(val) || val instanceof Float32Array) {
            const l = typeof val[0] === 'number' && !isNaN(val[0]) ? val[0] : -100;
            const r = typeof val[1] === 'number' && !isNaN(val[1]) ? val[1] : -100;
            inputDb = Math.max(l, r);
          } else if (typeof val === 'number' && !isNaN(val)) {
            inputDb = val;
          }
        } catch {
          inputDb = -100;
        }
      }

      // Calculate gain reduction in dB
      let targetGr = 0;
      if (!isBypassed && inputDb > threshold && ratio > 1) {
        targetGr = (inputDb - threshold) * (1 - 1 / ratio);
      }

      // Smooth envelope decay based on attack/release
      const attackCoeff = Math.min(1, 10 / Math.max(0.1, attack));
      const releaseCoeff = Math.min(1, 10 / Math.max(10, release));
      if (targetGr > currentGr) {
        currentGr += (targetGr - currentGr) * attackCoeff;
      } else {
        currentGr += (targetGr - currentGr) * releaseCoeff;
      }

      history.shift();
      history.push({ db: inputDb, gr: currentGr });

      // Draw canvas
      const w = canvas.width;
      const h = canvas.height;
      const plotRightMargin = 45;
      const plotWidth = w - plotRightMargin;
      const plotTop = 14;
      const plotBottom = h - 10;
      const plotHeight = plotBottom - plotTop;

      ctx.clearRect(0, 0, w, h);

      // Dark background
      ctx.fillStyle = '#161618';
      ctx.fillRect(0, 0, w, h);

      // Grid dB lines (0, -20, -40, -60)
      const dbSteps = [0, -20, -40, -60];
      ctx.strokeStyle = '#28282c';
      ctx.lineWidth = 1;
      ctx.font = '9px Roboto, sans-serif';
      ctx.fillStyle = '#777780';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      dbSteps.forEach((db) => {
        const normY = (0 - db) / 60; // 0dB = top (0), -60dB = bottom (1)
        const y = plotTop + normY * plotHeight;

        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotWidth, y);
        ctx.stroke();

        ctx.fillText(`${db}dB`, w - 6, y);
      });

      // Threshold line & label
      const threshNormY = Math.max(0, Math.min(1, (0 - threshold) / 60));
      const threshY = plotTop + threshNormY * plotHeight;

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, threshY);
      ctx.lineTo(plotWidth, threshY);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText('Threshold', 8, threshY - 6 > plotTop + 8 ? threshY - 6 : threshY + 8);

      // Render Waveform Envelope (Grey solid fill rising from bottom)
      ctx.beginPath();
      ctx.moveTo(0, plotBottom);

      for (let i = 0; i < historyLength; i++) {
        const x = (i / (historyLength - 1)) * plotWidth;
        const normDb = Math.max(0, Math.min(1, (history[i].db + 60) / 60));
        const y = plotBottom - normDb * plotHeight;
        ctx.lineTo(x, y);
      }

      ctx.lineTo(plotWidth, plotBottom);
      ctx.closePath();

      const waveGrad = ctx.createLinearGradient(0, plotTop, 0, plotBottom);
      waveGrad.addColorStop(0, '#a0a0a8');
      waveGrad.addColorStop(1, '#505058');
      ctx.fillStyle = waveGrad;
      ctx.fill();

      // Render Gain Reduction Curve (Orange Line dipping from top)
      ctx.beginPath();
      for (let i = 0; i < historyLength; i++) {
        const x = (i / (historyLength - 1)) * plotWidth;
        const grDb = history[i].gr;
        // Map 0 to 30dB gain reduction onto plotHeight
        const normGr = Math.min(1, Math.max(0, grDb / 30));
        const y = plotTop + normGr * plotHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.strokeStyle = '#ff6600';
      ctx.lineWidth = 2;
      ctx.stroke();

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [analyser, isPlaying, threshold, ratio, attack, release, isBypassed]);

  return (
    <div className="fixed inset-0 z-[300] pointer-events-none">
      <div
        ref={modalRef}
        onMouseDown={() => onFocus?.()}
        style={{ left: `${position.x}px`, top: `${position.y}px`, width: '430px', zIndex: zIndex ?? 310 }}
        className="fixed pointer-events-auto bg-[#222224] border border-[#3e3e42] rounded-lg shadow-[0_20px_50px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden font-sans select-none animate-in fade-in zoom-in-95 duration-100"
      >
        {/* Header Bar */}
        <div
          onMouseDown={handleHeaderMouseDown}
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
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <span className="text-white font-medium text-sm tracking-wide">
              Compressor
            </span>
          </div>

          {/* Preset Selector */}
          <div className="flex items-center gap-1.5">
            <div className="relative flex items-center bg-[#1a1a1c] border border-[#38383c] rounded px-1 h-6">
              <button
                type="button"
                onClick={() => cyclePreset('prev')}
                className="p-0.5 text-[#888] hover:text-white transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <div
                onClick={() => setIsPresetDropdownOpen(!isPresetDropdownOpen)}
                className="px-2 text-xs text-[#ccc] hover:text-white cursor-pointer flex items-center gap-1 min-w-[70px] justify-between"
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

              {/* Preset Dropdown Menu */}
              {isPresetDropdownOpen && (
                <div className="absolute top-7 left-0 right-0 z-[350] bg-[#1c1c1f] border border-[#444] rounded shadow-xl py-1 flex flex-col gap-0.5 max-h-48 overflow-y-auto custom-scrollbar">
                  {PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className={cn(
                        "px-2 py-1 text-left text-[11px] transition-colors hover:bg-[#333] hover:text-white",
                        selectedPresetName === p.name ? "text-[#ffd900] font-bold bg-[#28282d]" : "text-[#ccc]"
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
        <div className="p-3 bg-[#18181a] flex justify-center">
          <canvas
            ref={canvasRef}
            width={404}
            height={135}
            className="rounded border border-[#2d2d32] bg-[#161618] shadow-inner"
          />
        </div>

        {/* 5 Control Knobs Section */}
        <div className="px-4 py-3 bg-[#222224] border-t border-[#2d2d30] grid grid-cols-5 gap-2">
          <Knob
            label="Attack"
            value={attack}
            min={0.1}
            max={100}
            step={0.1}
            defaultValue={10}
            displayValue={`${attack < 10 ? attack.toFixed(1) : Math.round(attack)}ms`}
            onChange={(v) => updateParam('attack', v)}
          />

          <Knob
            label="Release"
            value={release}
            min={10}
            max={1000}
            step={1}
            defaultValue={100}
            displayValue={`${Math.round(release)}ms`}
            onChange={(v) => updateParam('release', v)}
          />

          <Knob
            label="Ratio"
            value={ratio}
            min={1}
            max={20}
            step={0.1}
            defaultValue={4}
            displayValue={`${ratio.toFixed(1)}:1`}
            onChange={(v) => updateParam('ratio', v)}
          />

          <Knob
            label="Threshold"
            value={threshold}
            min={-60}
            max={0}
            step={0.1}
            defaultValue={-20}
            displayValue={`${threshold.toFixed(1)}dB`}
            onChange={(v) => updateParam('threshold', v)}
          />

          <Knob
            label="Output"
            value={output}
            min={-12}
            max={24}
            step={0.1}
            defaultValue={0}
            displayValue={`${output > 0 ? '+' : ''}${output.toFixed(1)}dB`}
            onChange={(v) => updateParam('output', v)}
          />
        </div>
      </div>
    </div>
  );
}
