import React, { useState, useRef, useEffect } from 'react';
import { Power, X, ChevronLeft, ChevronRight, ChevronDown, Zap } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';
import {
  SaturationMode,
  createSaturationCurve,
  calculateSaturationParameters,
} from '../dsp/saturator/SaturationNode';

interface SaturatorPreset {
  name: string;
  inputGain: number;       // dB
  saturationDrive: number; // 0 - 10
  saturationMode: SaturationMode;
  outputGain: number;      // dB
}

const PRESETS: SaturatorPreset[] = [
  { name: 'Default', inputGain: 0, saturationDrive: 3.0, saturationMode: 'normal', outputGain: 0 },
  { name: 'Subtle Console', inputGain: 2.0, saturationDrive: 1.5, saturationMode: 'clean', outputGain: -1.0 },
  { name: 'Warm Tape', inputGain: 3.0, saturationDrive: 4.0, saturationMode: 'normal', outputGain: -1.5 },
  { name: 'Hot Tube', inputGain: 5.0, saturationDrive: 6.5, saturationMode: 'hot', outputGain: -3.0 },
  { name: 'Redline Crush', inputGain: 8.0, saturationDrive: 8.5, saturationMode: 'redline', outputGain: -5.0 },
  { name: 'Clean Boost', inputGain: 4.0, saturationDrive: 0.0, saturationMode: 'clean', outputGain: 0 },
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
              stroke="#f97316"
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

interface SaturatorModalProps {
  slot: EffectSlot;
  slotIndex: number;
  analyser?: any;
  isPlaying?: boolean;
  onUpdateParams: (slotIndex: number, bypassed: boolean, params: Record<string, number>) => void;
  onClose: () => void;
}

export function SaturatorModal({
  slot,
  slotIndex,
  analyser,
  isPlaying,
  onUpdateParams,
  onClose,
}: SaturatorModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [position, setPosition] = useState<{ x: number; y: number }>(() => ({
    x: Math.max(20, Math.round(window.innerWidth / 2 - 215)),
    y: Math.max(20, Math.round(window.innerHeight / 2 - 180)),
  }));

  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false);
  const [selectedPresetName, setSelectedPresetName] = useState<string>('Custom');

  // Parameter states
  const params = slot.params || {};
  const inputGain = params.inputGain ?? 0;          // dB (-20 to +20)
  const saturationDrive = params.saturationDrive ?? 3.0; // 0 to 10
  const modeIndex = params.modeIndex ?? 1;          // 0: clean, 1: normal, 2: hot, 3: redline
  const outputGain = params.outputGain ?? 0;        // dB (-12 to +12)
  const isBypassed = !!slot.bypassed;

  const modeKeys: SaturationMode[] = ['clean', 'normal', 'hot', 'redline'];
  const currentMode: SaturationMode = modeKeys[modeIndex] || 'normal';

  const updateParam = (key: string, val: number) => {
    onUpdateParams(slotIndex, isBypassed, {
      ...params,
      inputGain,
      saturationDrive,
      modeIndex,
      outputGain,
      [key]: val,
    });
    setSelectedPresetName('Custom');
  };

  const toggleBypass = () => {
    onUpdateParams(slotIndex, !isBypassed, {
      inputGain,
      saturationDrive,
      modeIndex,
      outputGain,
      ...params,
    });
  };

  const applyPreset = (preset: SaturatorPreset) => {
    setSelectedPresetName(preset.name);
    const mIdx = modeKeys.indexOf(preset.saturationMode);
    onUpdateParams(slotIndex, isBypassed, {
      inputGain: preset.inputGain,
      saturationDrive: preset.saturationDrive,
      modeIndex: mIdx >= 0 ? mIdx : 1,
      outputGain: preset.outputGain,
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

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
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

  // Canvas visualizer loop: renders the transfer curve & live audio activity
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;

      ctx.clearRect(0, 0, w, h);

      // Dark background
      ctx.fillStyle = '#161618';
      ctx.fillRect(0, 0, w, h);

      // Draw Grid lines
      ctx.strokeStyle = '#28282c';
      ctx.lineWidth = 1;
      
      // Center crosshair
      ctx.beginPath();
      ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h);
      ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Linear identity reference line (1:1 clean response)
      ctx.strokeStyle = '#383842';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(w, 0);
      ctx.stroke();
      ctx.setLineDash([]);

      // Compute Saturation Transfer Curve
      const { driveAmt, asymmetry } = calculateSaturationParameters(inputGain, saturationDrive, currentMode);
      const samples = 256;
      const curve = createSaturationCurve(driveAmt, asymmetry, samples);

      // Render Transfer Curve
      ctx.beginPath();
      for (let i = 0; i < samples; i++) {
        const xNorm = i / (samples - 1); // 0 to 1
        const yVal = curve[i];           // -1 to +1
        const xPx = xNorm * w;
        const yPx = (1 - (yVal + 1) / 2) * h;

        if (i === 0) ctx.moveTo(xPx, yPx);
        else ctx.lineTo(xPx, yPx);
      }

      ctx.strokeStyle = isBypassed ? '#666666' : '#f97316';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = isBypassed ? 'transparent' : 'rgba(249, 115, 22, 0.5)';
      ctx.shadowBlur = isBypassed ? 0 : 8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Render Live Signal Level Dot on Curve if audio is playing
      let liveInputDb = -100;
      const targetMeter = analyser?.preFaderMeter || analyser?.meter;
      if (targetMeter) {
        try {
          const val = targetMeter.getValue();
          if (Array.isArray(val) || val instanceof Float32Array) {
            liveInputDb = Math.max(val[0] || -100, val[1] || -100);
          } else if (typeof val === 'number') {
            liveInputDb = val;
          }
        } catch {
          liveInputDb = -100;
        }
      }

      if (isPlaying && liveInputDb > -60 && !isBypassed) {
        // Map dB (-60 to 0) to x-axis signal amplitude
        const normSig = Math.min(1, Math.max(0, (liveInputDb + 60) / 60));
        const sampleIdx = Math.floor(normSig * (samples - 1));
        const yVal = curve[sampleIdx] || 0;

        const xPx = normSig * w;
        const yPx = (1 - (yVal + 1) / 2) * h;

        ctx.fillStyle = '#ffd900';
        ctx.beginPath();
        ctx.arc(xPx, yPx, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Labels
      ctx.font = '9px Roboto, sans-serif';
      ctx.fillStyle = '#777780';
      ctx.textAlign = 'left';
      ctx.fillText(`Mode: ${currentMode.toUpperCase()}`, 8, 14);
      ctx.textAlign = 'right';
      ctx.fillText(`Drive: x${driveAmt.toFixed(2)}`, w - 8, 14);

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [analyser, isPlaying, inputGain, saturationDrive, currentMode, isBypassed]);

  return (
    <div className="fixed inset-0 z-[300] pointer-events-none">
      <div
        ref={modalRef}
        style={{ left: `${position.x}px`, top: `${position.y}px`, width: '430px' }}
        className="fixed z-[310] pointer-events-auto bg-[#222224] border border-[#3e3e42] rounded-lg shadow-[0_20px_50px_rgba(0,0,0,0.9)] flex flex-col overflow-hidden font-sans select-none animate-in fade-in zoom-in-95 duration-100"
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
                  ? "border-[#f97316] text-[#f97316] bg-[#f97316]/10 shadow-[0_0_8px_rgba(249,115,22,0.4)]"
                  : "border-[#555] text-[#777] bg-[#1a1a1a]"
              )}
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <span className="text-white font-medium text-sm tracking-wide flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-[#f97316]" />
              Saturator
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
                        selectedPresetName === p.name ? "text-[#f97316] font-bold bg-[#28282d]" : "text-[#ccc]"
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

        {/* Mode Selector Segmented Control */}
        <div className="px-4 pt-2.5 pb-1 bg-[#222224] flex items-center justify-center gap-1 border-t border-[#2d2d30]">
          {modeKeys.map((mKey, idx) => (
            <button
              key={mKey}
              type="button"
              onClick={() => updateParam('modeIndex', idx)}
              className={cn(
                "px-3 py-1 rounded text-[10px] font-mono font-bold uppercase transition-all tracking-wider border",
                modeIndex === idx
                  ? "bg-[#f97316] text-black border-[#f97316] shadow-[0_0_8px_rgba(249,115,22,0.3)]"
                  : "bg-[#18181a] text-[#888] border-[#333] hover:text-[#ccc] hover:bg-[#25252a]"
              )}
            >
              {mKey}
            </button>
          ))}
        </div>

        {/* Control Knobs Section */}
        <div className="px-6 py-3 bg-[#222224] grid grid-cols-3 gap-4 border-t border-[#2d2d30]">
          <Knob
            label="Input Gain"
            value={inputGain}
            min={-20}
            max={20}
            step={0.1}
            defaultValue={0}
            displayValue={`${inputGain > 0 ? '+' : ''}${inputGain.toFixed(1)}dB`}
            onChange={(v) => updateParam('inputGain', v)}
          />

          <Knob
            label="Saturation Drive"
            value={saturationDrive}
            min={0}
            max={10}
            step={0.1}
            defaultValue={3.0}
            displayValue={saturationDrive.toFixed(1)}
            onChange={(v) => updateParam('saturationDrive', v)}
          />

          <Knob
            label="Output Gain"
            value={outputGain}
            min={-12}
            max={12}
            step={0.1}
            defaultValue={0}
            displayValue={`${outputGain > 0 ? '+' : ''}${outputGain.toFixed(1)}dB`}
            onChange={(v) => updateParam('outputGain', v)}
          />
        </div>
      </div>
    </div>
  );
}
