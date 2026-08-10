import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Power, X, ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot } from '../types/daw';
import * as Tone from 'tone';

export interface EqualizerModalProps {
  slot: EffectSlot;
  slotIndex: number;
  analyser?: any;
  isPlaying?: boolean;
  onUpdateParams: (slotIndex: number, bypassed: boolean, params: Record<string, number>) => void;
  onClose: () => void;
}

export type FilterShape = 'peaking' | 'highpass' | 'lowpass' | 'lowshelf' | 'highshelf';

export interface BandConfig {
  id: number;
  type: FilterShape;
  freq: number;
  gain: number;
  q: number;
  bypass: boolean;
  color: string;
}

// Helper function to turn hex color (like #f59e0b) into rgba(..., alpha)
function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith('#')) {
    let c = hex.substring(1);
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  }
  return hex;
}

// Custom Filter Shape SVG Icons (no text labels)
const FILTER_TYPES: { id: FilterShape; label: string; renderIcon: (active: boolean) => React.ReactNode }[] = [
  {
    id: 'peaking',
    label: 'Bell (Peaking)',
    renderIcon: (active) => (
      <svg viewBox="0 0 24 24" className={cn("w-4 h-4 fill-none stroke-[2] stroke-current", active ? "text-white" : "text-[#888]")} strokeLinecap="round" strokeLinejoin="round">
        <path d="M 2 18 C 7 18, 9 6, 12 6 C 15 6, 17 18, 22 18" />
      </svg>
    ),
  },
  {
    id: 'highpass',
    label: 'High Pass (Low Cut)',
    renderIcon: (active) => (
      <svg viewBox="0 0 24 24" className={cn("w-4 h-4 fill-none stroke-[2] stroke-current", active ? "text-white" : "text-[#888]")} strokeLinecap="round" strokeLinejoin="round">
        <path d="M 2 18 C 7 18, 9 6, 16 6 L 22 6" />
      </svg>
    ),
  },
  {
    id: 'lowpass',
    label: 'Low Pass (High Cut)',
    renderIcon: (active) => (
      <svg viewBox="0 0 24 24" className={cn("w-4 h-4 fill-none stroke-[2] stroke-current", active ? "text-white" : "text-[#888]")} strokeLinecap="round" strokeLinejoin="round">
        <path d="M 2 6 L 8 6 C 15 6, 17 18, 22 18" />
      </svg>
    ),
  },
  {
    id: 'lowshelf',
    label: 'Low Shelf',
    renderIcon: (active) => (
      <svg viewBox="0 0 24 24" className={cn("w-4 h-4 fill-none stroke-[2] stroke-current", active ? "text-white" : "text-[#888]")} strokeLinecap="round" strokeLinejoin="round">
        <path d="M 2 8 L 7 8 C 11 8, 13 16, 17 16 L 22 16" />
      </svg>
    ),
  },
  {
    id: 'highshelf',
    label: 'High Shelf',
    renderIcon: (active) => (
      <svg viewBox="0 0 24 24" className={cn("w-4 h-4 fill-none stroke-[2] stroke-current", active ? "text-white" : "text-[#888]")} strokeLinecap="round" strokeLinejoin="round">
        <path d="M 2 16 L 7 16 C 11 16, 13 8, 17 8 L 22 8" />
      </svg>
    ),
  },
];

const BAND_COLORS = [
  '#c084fc', // 1: Purple
  '#f472b6', // 2: Pink/Magenta
  '#fb923c', // 3: Orange
  '#4ade80', // 4: Green
  '#38bdf8', // 5: Cyan
];

const DEFAULT_BANDS: BandConfig[] = [
  { id: 1, type: 'highpass', freq: 40, gain: 0, q: 0.707, bypass: false, color: BAND_COLORS[0] },
  { id: 2, type: 'peaking', freq: 250, gain: 0, q: 1.0, bypass: false, color: BAND_COLORS[1] },
  { id: 3, type: 'peaking', freq: 1000, gain: 0, q: 1.0, bypass: false, color: BAND_COLORS[2] },
  { id: 4, type: 'peaking', freq: 4000, gain: 0, q: 1.0, bypass: false, color: BAND_COLORS[3] },
  { id: 5, type: 'lowpass', freq: 15000, gain: 0, q: 0.707, bypass: false, color: BAND_COLORS[4] },
];

const PRESETS: { name: string; bands: BandConfig[] }[] = [
  { name: 'Flat Default', bands: DEFAULT_BANDS },
  {
    name: 'Vocal Clarity',
    bands: [
      { id: 1, type: 'highpass', freq: 80, gain: 0, q: 0.707, bypass: false, color: BAND_COLORS[0] },
      { id: 2, type: 'peaking', freq: 300, gain: -2.5, q: 1.2, bypass: false, color: BAND_COLORS[1] },
      { id: 3, type: 'peaking', freq: 3000, gain: 3.0, q: 1.0, bypass: false, color: BAND_COLORS[2] },
      { id: 4, type: 'highshelf', freq: 8000, gain: 2.0, q: 0.707, bypass: false, color: BAND_COLORS[3] },
      { id: 5, type: 'lowpass', freq: 18000, gain: 0, q: 0.707, bypass: false, color: BAND_COLORS[4] },
    ],
  },
  {
    name: 'Bass Boost & Sub Cut',
    bands: [
      { id: 1, type: 'highpass', freq: 30, gain: 0, q: 0.707, bypass: false, color: BAND_COLORS[0] },
      { id: 2, type: 'lowshelf', freq: 100, gain: 4.5, q: 0.8, bypass: false, color: BAND_COLORS[1] },
      { id: 3, type: 'peaking', freq: 500, gain: -1.5, q: 1.0, bypass: false, color: BAND_COLORS[2] },
      { id: 4, type: 'peaking', freq: 2500, gain: 1.5, q: 1.0, bypass: false, color: BAND_COLORS[3] },
      { id: 5, type: 'lowpass', freq: 16000, gain: 0, q: 0.707, bypass: false, color: BAND_COLORS[4] },
    ],
  },
  {
    name: 'Smile Curve (Punchy)',
    bands: [
      { id: 1, type: 'highpass', freq: 35, gain: 0, q: 0.707, bypass: false, color: BAND_COLORS[0] },
      { id: 2, type: 'lowshelf', freq: 120, gain: 3.0, q: 0.9, bypass: false, color: BAND_COLORS[1] },
      { id: 3, type: 'peaking', freq: 1200, gain: -3.0, q: 1.4, bypass: false, color: BAND_COLORS[2] },
      { id: 4, type: 'highshelf', freq: 6000, gain: 3.5, q: 0.9, bypass: false, color: BAND_COLORS[3] },
      { id: 5, type: 'lowpass', freq: 19000, gain: 0, q: 0.707, bypass: false, color: BAND_COLORS[4] },
    ],
  },
];

// Helper: map frequency (20Hz..20000Hz) <-> X coordinate (0..width) logarithmically
function freqToX(freq: number, width: number): number {
  const minF = Math.log10(20);
  const maxF = Math.log10(20000);
  const val = Math.log10(Math.max(20, Math.min(20000, freq)));
  return ((val - minF) / (maxF - minF)) * width;
}

function xToFreq(x: number, width: number): number {
  const minF = Math.log10(20);
  const maxF = Math.log10(20000);
  const norm = Math.max(0, Math.min(1, x / width));
  const logF = minF + norm * (maxF - minF);
  return Math.pow(10, logF);
}

// Helper: map dB (-18dB..+18dB) <-> Y coordinate (0..height)
function dbToY(db: number, height: number): number {
  const minDb = -18;
  const maxDb = 18;
  const norm = (db - minDb) / (maxDb - minDb);
  return height * (1 - Math.max(0, Math.min(1, norm)));
}

function yToDb(y: number, height: number): number {
  const minDb = -18;
  const maxDb = 18;
  const norm = 1 - Math.max(0, Math.min(1, y / height));
  return minDb + norm * (maxDb - minDb);
}

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  displayValue: string;
  disabled?: boolean;
  isLogarithmic?: boolean;
  onChange: (val: number) => void;
}

function Knob({ label, value, min, max, step, defaultValue, displayValue, disabled, isLogarithmic, onChange }: KnobProps) {
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
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    startY.current = e.clientY;
    startVal.current = value;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      const deltaY = startY.current - moveEvent.clientY;
      const dragFactor = moveEvent.shiftKey ? 600 : 150;

      if (isLogarithmic) {
        const minLog = Math.log10(min);
        const maxLog = Math.log10(max);
        const startLog = Math.log10(Math.max(min, Math.min(max, startVal.current)));
        const startNorm = (startLog - minLog) / (maxLog - minLog);
        const newNorm = Math.max(0, Math.min(1, startNorm + deltaY / dragFactor));
        const newLog = minLog + newNorm * (maxLog - minLog);
        const rawVal = Math.pow(10, newLog);
        onChange(clampAndStep(rawVal));
      } else {
        const range = max - min;
        const rawVal = startVal.current + (deltaY / dragFactor) * range;
        onChange(clampAndStep(rawVal));
      }
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
    if (disabled) return;
    e.stopPropagation();
    const direction = e.deltaY < 0 ? 1 : -1;

    if (isLogarithmic) {
      const minLog = Math.log10(min);
      const maxLog = Math.log10(max);
      const currentLog = Math.log10(Math.max(min, Math.min(max, value)));
      const norm = (currentLog - minLog) / (maxLog - minLog);
      const newNorm = Math.max(0, Math.min(1, norm + direction * 0.02));
      const rawVal = Math.pow(10, minLog + newNorm * (maxLog - minLog));
      onChange(clampAndStep(rawVal));
    } else {
      const range = max - min;
      const increment = (range / 100) * direction;
      onChange(clampAndStep(value + increment));
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (disabled) return;
    e.stopPropagation();
    onChange(defaultValue);
  };

  let normVal = 0;
  if (isLogarithmic) {
    const minLog = Math.log10(min);
    const maxLog = Math.log10(max);
    const currentLog = Math.log10(Math.max(min, Math.min(max, value)));
    normVal = Math.max(0, Math.min(1, (currentLog - minLog) / (maxLog - minLog)));
  } else {
    normVal = Math.max(0, Math.min(1, (value - min) / (max - min)));
  }

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
  const activePath = normVal > 0.001 
    ? `M ${getX(startAngle)} ${getY(startAngle)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${getX(currentAngle)} ${getY(currentAngle)}`
    : '';

  return (
    <div 
      className={cn(
        "flex flex-col items-center select-none group cursor-pointer transition-opacity",
        disabled && "opacity-35 pointer-events-none cursor-not-allowed"
      )} 
      onMouseDown={handleMouseDown} 
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
    >
      <span className="text-[#888] text-[10px] font-medium tracking-wider uppercase mb-1">
        {label}
      </span>

      <div className="relative w-12 h-12 flex items-center justify-center">
        <svg className="w-12 h-12 transform -rotate-90">
          <path
            d={bgPath}
            fill="none"
            stroke="#2e2e34"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          {activePath && (
            <path
              d={activePath}
              fill="none"
              stroke="#06b6d4"
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

export function EqualizerModal({
  slot,
  slotIndex,
  analyser,
  isPlaying,
  onUpdateParams,
  onClose,
}: EqualizerModalProps) {
  // Modal Drag state
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const left = Math.max(20, window.innerWidth / 2 - 340);
    const top = Math.max(20, window.innerHeight / 2 - 260);
    return { x: left, y: top };
  });
  const isDraggingModal = useRef(false);
  const dragStartOffset = useRef({ x: 0, y: 0 });

  const [activeBandId, setActiveBandId] = useState<number>(1);
  const [draggedBandId, setDraggedBandId] = useState<number | null>(null);
  const [isPresetDropdownOpen, setIsPresetDropdownOpen] = useState(false);
  const [selectedPresetName, setSelectedPresetName] = useState<string>('Flat Default');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Extract initial parameters from slot
  const slotParams = slot.params || {};
  const isBypassed = !!slot.bypassed;

  const [bands, setBands] = useState<BandConfig[]>(() => {
    const params = slot.params || {};
    return DEFAULT_BANDS.map((def, idx) => {
      const b = idx + 1;
      const typeStr = params[`b${b}_type_str`];
      const freq = params[`b${b}_freq`];
      const gain = params[`b${b}_gain`];
      const q = params[`b${b}_q`];
      const bypass = params[`b${b}_bypass`];

      let typeVal: FilterShape = def.type;
      if (typeStr && typeof typeStr === 'string') {
        typeVal = typeStr as FilterShape;
      } else if (typeof params[`b${b}_type`] === 'number') {
        const typeIdx = params[`b${b}_type`];
        typeVal = FILTER_TYPES[typeIdx]?.id || def.type;
      }

      return {
        id: b,
        type: typeVal,
        freq: typeof freq === 'number' ? freq : def.freq,
        gain: typeof gain === 'number' ? gain : def.gain,
        q: typeof q === 'number' ? q : def.q,
        bypass: typeof bypass === 'number' ? bypass === 1 : (typeof bypass === 'boolean' ? bypass : def.bypass),
        color: BAND_COLORS[idx],
      };
    });
  });

  const bandsRef = useRef(bands);
  bandsRef.current = bands;

  const applyPreset = (preset: typeof PRESETS[number]) => {
    setSelectedPresetName(preset.name);
    setBands(preset.bands);
    pushParamsToAudioEngine(preset.bands);
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

  // Emit updated params to audio engine
  const pushParamsToAudioEngine = (newBands: BandConfig[], bypassed: boolean = isBypassed) => {
    const updatedParams: Record<string, number> = {};
    newBands.forEach((b) => {
      const typeIdx = FILTER_TYPES.findIndex((t) => t.id === b.type);
      updatedParams[`b${b.id}_type`] = typeIdx >= 0 ? typeIdx : 0;
      updatedParams[`b${b.id}_freq`] = Math.round(b.freq * 10) / 10;
      updatedParams[`b${b.id}_gain`] = Math.round(b.gain * 10) / 10;
      updatedParams[`b${b.id}_q`] = Math.round(b.q * 100) / 100;
      updatedParams[`b${b.id}_bypass`] = b.bypass ? 1 : 0;
    });
    // Store type string in params as well
    newBands.forEach((b) => {
      (updatedParams as any)[`b${b.id}_type_str`] = b.type;
    });
    onUpdateParams(slotIndex, bypassed, updatedParams);
  };

  const updateSingleBand = (bandId: number, changes: Partial<BandConfig>) => {
    const updated = bands.map((b) => (b.id === bandId ? { ...b, ...changes } : b));
    setBands(updated);
    pushParamsToAudioEngine(updated);
    setSelectedPresetName('Custom');
  };

  // Modal Dragging Handlers
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    isDraggingModal.current = true;
    dragStartOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };

    const handleMouseMove = (me: MouseEvent) => {
      if (!isDraggingModal.current) return;
      const newX = Math.max(10, Math.min(window.innerWidth - 650, me.clientX - dragStartOffset.current.x));
      const newY = Math.max(10, Math.min(window.innerHeight - 450, me.clientY - dragStartOffset.current.y));
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

  // Canvas Drawing & Realtime Spectrum + Filter Curves
  useEffect(() => {
    let animId: number;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Create temporary AudioContext biquad filter nodes to accurately measure frequency response
    let rawCtx: AudioContext | null = null;
    try {
      rawCtx = Tone.getContext().rawContext as AudioContext;
    } catch {
      rawCtx = null;
    }

    const numPoints = 250;
    const freqPoints = new Float32Array(numPoints);
    for (let i = 0; i < numPoints; i++) {
      freqPoints[i] = xToFreq((i / (numPoints - 1)) * width, width);
    }

    const magResponse = new Float32Array(numPoints);
    const phaseResponse = new Float32Array(numPoints);

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // 1. Draw Grid Background
      ctx.fillStyle = '#0d0e14';
      ctx.fillRect(0, 0, width, height);

      // Grid frequency lines
      const gridFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
      const gridLabels = ['20', '50', '100', '200', '500', '1k', '2k', '5k', '10k', '20k'];

      ctx.strokeStyle = '#1a1c26';
      ctx.lineWidth = 0.5;
      ctx.font = '9px sans-serif';
      ctx.fillStyle = '#4b5262';

      gridFreqs.forEach((f, idx) => {
        const x = freqToX(f, width);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();

        ctx.fillText(gridLabels[idx], x + 2, height - 4);
      });

      // Grid dB lines (-18..+18 dB)
      const dbLines = [18, 12, 6, 0, -6, -12, -18];
      dbLines.forEach((db) => {
        const y = dbToY(db, height);
        ctx.beginPath();
        ctx.strokeStyle = db === 0 ? '#2d3345' : '#141622';
        ctx.lineWidth = db === 0 ? 1 : 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();

        ctx.fillStyle = db === 0 ? '#8a92a3' : '#4b5262';
        ctx.fillText(`${db > 0 ? '+' : ''}${db}dB`, 4, y - 3);
      });

      // 2. Draw Realtime Post-EQ Spectrum Visualizer
      if (analyser?.fft) {
        try {
          const fftValues = analyser.fft.getValue();
          if (fftValues && (fftValues instanceof Float32Array || Array.isArray(fftValues)) && fftValues.length > 0) {
            const totalBins = fftValues.length;
            const nyquist = 22050;
            const numPoints = 256;

            // Fill RTA graph
            ctx.beginPath();
            ctx.moveTo(0, height);

            for (let i = 0; i <= numPoints; i++) {
              const x = (i / numPoints) * width;
              const freq = xToFreq(x, width);

              const binIndex = Math.min(
                totalBins - 1,
                Math.max(0, Math.floor((freq / nyquist) * totalBins))
              );

              const b1 = Math.max(0, binIndex - 1);
              const b2 = Math.min(totalBins - 1, binIndex + 1);
              let maxDb = -120;
              for (let b = b1; b <= b2; b++) {
                const val = fftValues[b] as number;
                if (typeof val === 'number' && isFinite(val) && val > maxDb) {
                  maxDb = val;
                }
              }

              const clampedDb = Math.max(-80, Math.min(0, maxDb));
              const y = height - ((clampedDb + 80) / 80) * (height * 0.75);

              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }

            ctx.lineTo(width, height);
            ctx.closePath();

            const specGrad = ctx.createLinearGradient(0, 0, 0, height);
            specGrad.addColorStop(0, 'rgba(56, 189, 248, 0.30)');
            specGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.08)');
            specGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
            ctx.fillStyle = specGrad;
            ctx.fill();

            // Spectrum curve outline stroke
            ctx.beginPath();
            for (let i = 0; i <= numPoints; i++) {
              const x = (i / numPoints) * width;
              const freq = xToFreq(x, width);

              const binIndex = Math.min(
                totalBins - 1,
                Math.max(0, Math.floor((freq / nyquist) * totalBins))
              );

              const b1 = Math.max(0, binIndex - 1);
              const b2 = Math.min(totalBins - 1, binIndex + 1);
              let maxDb = -120;
              for (let b = b1; b <= b2; b++) {
                const val = fftValues[b] as number;
                if (typeof val === 'number' && isFinite(val) && val > maxDb) {
                  maxDb = val;
                }
              }

              const clampedDb = Math.max(-80, Math.min(0, maxDb));
              const y = height - ((clampedDb + 80) / 80) * (height * 0.75);

              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
        } catch {
          // ignore FFT read errors
        }
      }

      // 3. Compute combined magnitude response of all 5 bands
      const totalMag = new Float32Array(numPoints);
      for (let i = 0; i < numPoints; i++) totalMag[i] = 1.0;

      if (!isBypassed && rawCtx) {
        bands.forEach((b) => {
          if (b.bypass) return;
          try {
            const filterNode = rawCtx!.createBiquadFilter();
            filterNode.type = b.type;
            filterNode.frequency.value = Math.max(20, Math.min(20000, b.freq));
            filterNode.Q.value = Math.max(0.1, Math.min(18, b.q));
            filterNode.gain.value = Math.max(-24, Math.min(24, b.gain));

            filterNode.getFrequencyResponse(freqPoints, magResponse, phaseResponse);

            for (let i = 0; i < numPoints; i++) {
              totalMag[i] *= magResponse[i];
            }
          } catch {
            // fallback
          }
        });
      }

      // 4. Plot Combined EQ Response Curve
      ctx.beginPath();
      for (let i = 0; i < numPoints; i++) {
        const x = (i / (numPoints - 1)) * width;
        const mag = totalMag[i];
        const db = Math.max(-24, Math.min(24, 20 * Math.log10(Math.max(0.00001, mag))));
        const y = dbToY(db, height);

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      // Curve Fill Gradient
      ctx.lineTo(width, dbToY(0, height));
      ctx.lineTo(0, dbToY(0, height));
      ctx.closePath();

      const curveGrad = ctx.createLinearGradient(0, 0, 0, height);
      curveGrad.addColorStop(0, 'rgba(6, 182, 212, 0.25)');
      curveGrad.addColorStop(0.5, 'rgba(6, 182, 212, 0.02)');
      curveGrad.addColorStop(1, 'rgba(6, 182, 212, 0.18)');
      ctx.fillStyle = curveGrad;
      ctx.fill();

      // Stroke EQ Line (Thinner 1.5px stroke)
      ctx.beginPath();
      for (let i = 0; i < numPoints; i++) {
        const x = (i / (numPoints - 1)) * width;
        const mag = totalMag[i];
        const db = Math.max(-24, Math.min(24, 20 * Math.log10(Math.max(0.00001, mag))));
        const y = dbToY(db, height);

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = isBypassed ? '#6b7280' : '#06b6d4';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = isBypassed ? 'transparent' : 'rgba(6, 182, 212, 0.6)';
      ctx.shadowBlur = isBypassed ? 0 : 5;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 5. Draw Individual Band Handles (50% transparent fill)
      bands.forEach((b) => {
        const x = freqToX(b.freq, width);
        const y = dbToY(b.type === 'highpass' || b.type === 'lowpass' ? 0 : b.gain, height);
        const isActive = b.id === activeBandId;

        // Connecting vertical line to 0dB baseline
        const zeroY = dbToY(0, height);
        ctx.beginPath();
        ctx.strokeStyle = b.bypass ? '#4b5563' : b.color;
        ctx.globalAlpha = isActive ? 0.5 : 0.2;
        ctx.setLineDash([2, 2]);
        ctx.moveTo(x, zeroY);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1.0;

        // Band Handle Badge Circle (50% Transparent Fill)
        ctx.beginPath();
        const radius = isActive ? 11 : 9;
        ctx.arc(x, y, radius, 0, Math.PI * 2);

        // 50% transparent fill
        ctx.fillStyle = b.bypass ? 'rgba(55, 65, 81, 0.5)' : hexToRgba(b.color, 0.5);
        ctx.fill();

        // Thin handle outline stroke
        ctx.strokeStyle = isActive ? '#ffffff' : hexToRgba(b.color, 0.9);
        ctx.lineWidth = isActive ? 1.5 : 1.0;
        ctx.stroke();

        // Handle text number
        ctx.fillStyle = isActive ? '#ffffff' : '#e0e0e0';
        ctx.font = `bold ${isActive ? 10 : 9}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(b.id), x, y);
      });

      animId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [bands, activeBandId, isBypassed, analyser, isPlaying]);

  // Interactive Dragging on Canvas Handles
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Find nearest handle point
    let nearestBandId: number | null = null;
    let minDistance = 24; // click tolerance radius

    bands.forEach((b) => {
      const hx = freqToX(b.freq, canvas.width);
      const hy = dbToY(b.type === 'highpass' || b.type === 'lowpass' ? 0 : b.gain, canvas.height);
      const dist = Math.hypot(mouseX - hx, mouseY - hy);
      if (dist < minDistance) {
        minDistance = dist;
        nearestBandId = b.id;
      }
    });

    if (nearestBandId !== null) {
      setActiveBandId(nearestBandId);
      setDraggedBandId(nearestBandId);

      const handleMouseMove = (me: MouseEvent) => {
        const currentRect = canvas.getBoundingClientRect();
        const mX = Math.max(0, Math.min(canvas.width, (me.clientX - currentRect.left) * (canvas.width / currentRect.width)));
        const mY = Math.max(0, Math.min(canvas.height, (me.clientY - currentRect.top) * (canvas.height / currentRect.height)));

        const newFreq = xToFreq(mX, canvas.width);
        const newDb = yToDb(mY, canvas.height);

        const updated = bandsRef.current.map((b) => {
          if (b.id === nearestBandId) {
            const isCutFilter = b.type === 'highpass' || b.type === 'lowpass';
            return {
              ...b,
              freq: Math.max(20, Math.min(20000, newFreq)),
              gain: isCutFilter ? 0 : Math.max(-18, Math.min(18, newDb)),
            };
          }
          return b;
        });
        setBands(updated);
        pushParamsToAudioEngine(updated);
        setSelectedPresetName('Custom');
      };

      const handleMouseUp = () => {
        setDraggedBandId(null);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
  };

  // Wheel event on canvas for Q adjust
  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);

    // Find nearest band handle or use activeBandId
    let targetId = activeBandId;
    let minDistance = 30;

    bands.forEach((b) => {
      const hx = freqToX(b.freq, canvas.width);
      const hy = dbToY(b.type === 'highpass' || b.type === 'lowpass' ? 0 : b.gain, canvas.height);
      const dist = Math.hypot(mouseX - hx, mouseY - hy);
      if (dist < minDistance) {
        minDistance = dist;
        targetId = b.id;
      }
    });

    const band = bands.find((b) => b.id === targetId);
    if (!band) return;

    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    const newQ = Math.max(0.1, Math.min(12, band.q + delta));

    updateSingleBand(targetId, { q: newQ });
  };

  const activeBand = bands.find((b) => b.id === activeBandId) || bands[0];

  return (
    <div
      style={{ top: `${position.y}px`, left: `${position.x}px` }}
      className="fixed z-[300] w-[640px] bg-[#222224] border border-[#3e3e42] rounded-lg shadow-[0_20px_50px_rgba(0,0,0,0.9)] flex flex-col select-none overflow-hidden font-sans text-xs text-[#e0e0e0] animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Title Bar - Draggable Header */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className="h-10 bg-[#2d2d30] border-b border-[#3a3a3e] px-3 flex items-center justify-between cursor-move"
      >
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => pushParamsToAudioEngine(bands, !isBypassed)}
            className={cn(
              "w-6 h-6 rounded-full border flex items-center justify-center transition-all",
              !isBypassed
                ? "border-[#22c55e] text-[#22c55e] bg-[#22c55e]/10 shadow-[0_0_8px_rgba(34,197,94,0.4)]"
                : "border-[#555] text-[#777] bg-[#1a1a1a]"
            )}
          >
            <Power className="w-3.5 h-3.5" />
          </button>
          <span className="text-white font-medium text-sm tracking-wide">
            Equalizer
          </span>
        </div>

        {/* Preset Selector & Controls */}
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
              <div className="absolute top-7 left-0 right-0 z-[350] bg-[#1c1c1f] border border-[#444] rounded shadow-xl py-1 flex flex-col gap-0.5 max-h-48 overflow-y-auto custom-scrollbar min-w-[120px]">
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
            onClick={() => {
              setBands(DEFAULT_BANDS);
              pushParamsToAudioEngine(DEFAULT_BANDS);
              setSelectedPresetName('Flat Default');
            }}
            title="Reset EQ"
            className="p-1 rounded text-[#888] hover:text-white hover:bg-[#3a3a3e] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center text-[#999] hover:text-white hover:bg-[#3a3a3e] transition-colors ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Spectrum & EQ Curve Canvas Display */}
      <div className="relative w-full h-[240px] bg-[#0f1117] border-b border-[#252834]">
        <canvas
          ref={canvasRef}
          width={640}
          height={240}
          onMouseDown={handleCanvasMouseDown}
          onWheel={handleCanvasWheel}
          className="w-full h-full cursor-crosshair block"
        />
      </div>

      {/* Bottom Band Selection Tabs & Detailed Parameter Controls */}
      <div className="p-3 bg-[#161822] flex flex-col gap-3">
        {/* Band Selector Tabs */}
        <div className="flex items-center justify-between gap-1 border-b border-[#252834] pb-2">
          <div className="flex items-center gap-1.5">
            {bands.map((b) => {
              const isActive = b.id === activeBandId;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setActiveBandId(b.id)}
                  className={cn(
                    'px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1.5 transition-all border',
                    isActive
                      ? 'bg-[#222638] text-white border-[#06b6d4]/60 shadow-[0_2px_8px_rgba(0,0,0,0.5)]'
                      : 'bg-[#12131a] text-[#888] border-[#222533] hover:text-[#ccc] hover:bg-[#1a1c28]'
                  )}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block"
                    style={{ backgroundColor: b.bypass ? '#6b7280' : b.color }}
                  />
                  <span>Band {b.id}</span>
                </button>
              );
            })}
          </div>

          {/* Band Power Toggle: Text ONLY 'Band', state indicated ONLY by color */}
          <button
            type="button"
            onClick={() => updateSingleBand(activeBandId, { bypass: !activeBand.bypass })}
            title={activeBand.bypass ? "Band Bypassed - Click to Enable" : "Band Active - Click to Bypass"}
            className={cn(
              'px-2.5 py-1 rounded text-xs font-semibold border transition-all flex items-center gap-1.5',
              !activeBand.bypass
                ? 'bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/40 shadow-[0_0_8px_rgba(34,197,94,0.3)]'
                : 'bg-[#1a1a1c] text-[#666] border-[#38383c]'
            )}
          >
            <Power className="w-3.5 h-3.5" />
            <span>Band</span>
          </button>
        </div>

        {/* Detailed Controls for Selected Band */}
        <div className="flex items-center justify-around pt-1 px-3">
          {/* 1. Filter Type Selector (Shifted slightly to right) */}
          <div className="flex flex-col items-center gap-1 pl-2">
            <span className="text-[10px] text-[#888] font-medium uppercase tracking-wider mb-1">
              Filter Shape
            </span>
            <div className="flex items-center gap-1 bg-[#12131a] p-1.5 rounded border border-[#2a2d3a]">
              {FILTER_TYPES.map((ft) => {
                const isSelected = activeBand.type === ft.id;
                return (
                  <button
                    key={ft.id}
                    type="button"
                    title={ft.label}
                    onClick={() => updateSingleBand(activeBandId, { type: ft.id })}
                    className={cn(
                      'w-8 h-8 rounded flex items-center justify-center transition-all',
                      isSelected
                        ? 'bg-[#282d42] border border-[#06b6d4]/60 shadow-[0_0_6px_rgba(6,182,212,0.3)]'
                        : 'hover:bg-[#1f2230] text-[#777] hover:text-[#ccc]'
                    )}
                  >
                    {ft.renderIcon(isSelected)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div className="h-10 w-[1px] bg-[#282a38]/80 self-center opacity-60" />

          {/* 2, 3, 4. Knobs grouped near each other */}
          <div className="flex items-center gap-5">
            {/* Frequency Knob */}
            <Knob
              label="Frequency"
              value={activeBand.freq}
              min={20}
              max={20000}
              step={1}
              isLogarithmic
              defaultValue={DEFAULT_BANDS[activeBandId - 1]?.freq || 1000}
              displayValue={
                activeBand.freq >= 1000
                  ? `${(activeBand.freq / 1000).toFixed(2)} kHz`
                  : `${Math.round(activeBand.freq)} Hz`
              }
              onChange={(val) => updateSingleBand(activeBandId, { freq: val })}
            />

            {/* Gain Knob */}
            <Knob
              label="Gain"
              value={activeBand.gain}
              min={-18}
              max={18}
              step={0.1}
              disabled={activeBand.type === 'highpass' || activeBand.type === 'lowpass'}
              defaultValue={DEFAULT_BANDS[activeBandId - 1]?.gain || 0}
              displayValue={
                activeBand.type === 'highpass' || activeBand.type === 'lowpass'
                  ? 'N/A'
                  : `${activeBand.gain > 0 ? '+' : ''}${activeBand.gain.toFixed(1)} dB`
              }
              onChange={(val) => updateSingleBand(activeBandId, { gain: val })}
            />

            {/* Q Factor Knob */}
            <Knob
              label="Q Factor"
              value={activeBand.q}
              min={0.1}
              max={12}
              step={0.05}
              defaultValue={DEFAULT_BANDS[activeBandId - 1]?.q || 1.0}
              displayValue={activeBand.q.toFixed(2)}
              onChange={(val) => updateSingleBand(activeBandId, { q: val })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
