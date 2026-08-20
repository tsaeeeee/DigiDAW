import React, { useId, useRef } from 'react';
import { cn } from '../lib/utils';

export type PluginKnobSize = 'sm' | 'md' | 'lg' | 'xl';

export interface PluginKnobProps {
  label: string;
  leftSubLabel?: string;
  rightSubLabel?: string;
  detail?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  displayValue?: string;
  size?: PluginKnobSize;
  disabled?: boolean;
  isLogarithmic?: boolean;
  onChange: (value: number) => void;
}

const SIZE_MAP: Record<PluginKnobSize, number> = { sm: 52, md: 64, lg: 76, xl: 86 };
const sentence = (text?: string) => text ? text.charAt(0).toUpperCase() + text.slice(1).toLowerCase() : '';

export function PluginKnob({ label, leftSubLabel = 'Min', rightSubLabel = 'Max', detail, value, min, max, step, defaultValue, displayValue, size = 'md', disabled = false, isLogarithmic = false, onChange }: PluginKnobProps) {
  const dragging = useRef(false);
  const startY = useRef(0);
  const id = useId().replace(/:/g, '');
  const dimension = SIZE_MAP[size];
  const scale = dimension / 86;
  const center = dimension / 2;
  const radius = 33 * scale;
  const innerRadius = 26 * scale;
  const needleDistance = 22 * scale;
  const accent = 'var(--plugin-accent, #f472b6)';
  const accent2 = 'var(--plugin-accent-2, #c084fc)';

  const clampStep = (raw: number) => {
    let next = Math.max(min, Math.min(max, raw));
    if (step >= 1) next = Math.round(next / step) * step;
    else next = Number(next.toFixed(Math.max(1, Math.round(-Math.log10(step)))));
    return Math.max(min, Math.min(max, next));
  };
  const normalize = (candidate: number) => {
    if (isLogarithmic && min > 0 && max > min) {
      const lo = Math.log10(min), hi = Math.log10(max);
      return Math.max(0, Math.min(1, (Math.log10(Math.max(min, candidate)) - lo) / (hi - lo)));
    }
    return Math.max(0, Math.min(1, (candidate - min) / Math.max(1e-12, max - min)));
  };
  const denormalize = (norm: number) => {
    const n = Math.max(0, Math.min(1, norm));
    if (isLogarithmic && min > 0 && max > min) {
      const lo = Math.log10(min), hi = Math.log10(max);
      return Math.pow(10, lo + n * (hi - lo));
    }
    return min + n * (max - min);
  };

  const onMouseDown = (event: React.MouseEvent) => {
    if (disabled) return;
    event.preventDefault(); event.stopPropagation();
    dragging.current = true; startY.current = event.clientY;
    const startNorm = normalize(value);
    const move = (e: MouseEvent) => {
      if (!dragging.current) return;
      const distance = e.shiftKey ? 600 : 160;
      onChange(clampStep(denormalize(startNorm + (startY.current - e.clientY) / distance)));
    };
    const up = () => { dragging.current = false; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  const norm = normalize(value);
  const angle = -135 + norm * 270;
  const start = -135 * Math.PI / 180, end = 135 * Math.PI / 180, current = angle * Math.PI / 180;
  const x = (a: number) => center + radius * Math.cos(a), y = (a: number) => center + radius * Math.sin(a);
  const bgPath = `M ${x(start)} ${y(start)} A ${radius} ${radius} 0 1 1 ${x(end)} ${y(end)}`;
  const activePath = norm > 0.003 ? `M ${x(start)} ${y(start)} A ${radius} ${radius} 0 ${angle + 135 > 180 ? 1 : 0} 1 ${x(current)} ${y(current)}` : '';
  const needleX = center + needleDistance * Math.cos(current), needleY = center + needleDistance * Math.sin(current);

  return <div className={cn('flex flex-col items-center select-none', disabled ? 'opacity-35 pointer-events-none' : 'cursor-pointer')} onMouseDown={onMouseDown} onWheel={(e) => { if (disabled) return; e.preventDefault(); e.stopPropagation(); onChange(clampStep(denormalize(norm + (e.deltaY < 0 ? 0.01 : -0.01)))); }} onDoubleClick={(e) => { if (disabled) return; e.preventDefault(); e.stopPropagation(); onChange(clampStep(defaultValue)); }} title={`${sentence(label)}: ${displayValue ?? value}`}>
    <svg width={dimension} height={dimension} className="transform -rotate-90 overflow-visible">
      <defs><linearGradient id={`arc-${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={accent} /><stop offset="100%" stopColor={accent2} /></linearGradient><linearGradient id={`dial-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#202027" /><stop offset="100%" stopColor="#101013" /></linearGradient></defs>
      <path d={bgPath} fill="none" stroke="#25252b" strokeWidth={Math.max(3, 4.5 * scale)} strokeLinecap="round" />
      {activePath && <path d={activePath} fill="none" stroke={`url(#arc-${id})`} strokeWidth={Math.max(3, 4.5 * scale)} strokeLinecap="round" />}
      <circle cx={center} cy={center} r={innerRadius} fill={`url(#dial-${id})`} stroke="#34343d" strokeWidth="1.2" />
      <circle cx={needleX} cy={needleY} r={Math.max(1.6, 2.1 * scale)} fill={accent} />
    </svg>
    <div className="w-full flex justify-between px-1 text-[7px] text-[#73737c] font-bold mt-0.5 gap-2"><span>{sentence(leftSubLabel)}</span><span>{sentence(rightSubLabel)}</span></div>
    <span className="text-[#f0f0f2] text-[9px] font-extrabold tracking-wide mt-0.5 text-center leading-tight">{sentence(label)}</span>
    {detail && <span className="text-[#777780] text-[8px] font-mono mt-0.5 text-center">{detail}</span>}
    {displayValue && <span className="text-[9px] font-mono font-bold mt-1 text-center tabular-nums" style={{ color: accent }}>{displayValue}</span>}
  </div>;
}
