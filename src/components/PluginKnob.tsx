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

const SIZE_MAP: Record<PluginKnobSize, number> = {
  sm: 56,
  md: 68,
  lg: 78,
  xl: 88,
};

function sentenceCase(text?: string) {
  if (!text) return '';
  if (!/[A-Za-z]/.test(text)) return text;
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * Shared DigiDAW plugin knob.
 *
 * Geometry, interaction and spacing stay identical to the Pitchy dial language.
 * Only the accent colors are inherited from the currently opened plugin theme.
 */
export function PluginKnob({
  label,
  leftSubLabel = 'MIN',
  rightSubLabel = 'MAX',
  detail,
  value,
  min,
  max,
  step,
  defaultValue,
  displayValue,
  size = 'md',
  disabled = false,
  isLogarithmic = false,
  onChange,
}: PluginKnobProps) {
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(value);
  const reactId = useId().replace(/:/g, '');
  const arcGradientId = `digidaw-knob-arc-${reactId}`;
  const dialGradientId = `digidaw-knob-dial-${reactId}`;

  const dimension = SIZE_MAP[size];
  const scale = dimension / 88;
  const center = dimension / 2;
  const radius = 34 * scale;
  const strokeWidth = Math.max(3, 5 * scale);
  const innerRadius = 27 * scale;
  const needleDistance = 23 * scale;
  const needleRadius = Math.max(1.6, 2.2 * scale);
  const accent = 'var(--plugin-accent, #f472b6)';
  const accent2 = 'var(--plugin-accent-2, #c084fc)';

  const clampAndStep = (rawValue: number) => {
    let next = Math.max(min, Math.min(max, rawValue));
    if (step >= 1) {
      next = Math.round(next / step) * step;
    } else {
      const decimals = Math.max(1, Math.round(-Math.log10(step)));
      next = Number(next.toFixed(decimals));
    }
    return Math.max(min, Math.min(max, next));
  };

  const normalise = (candidate: number) => {
    if (isLogarithmic && min > 0 && max > min) {
      const minLog = Math.log10(min);
      const maxLog = Math.log10(max);
      const currentLog = Math.log10(Math.max(min, Math.min(max, candidate)));
      return Math.max(0, Math.min(1, (currentLog - minLog) / (maxLog - minLog)));
    }
    return Math.max(0, Math.min(1, (candidate - min) / Math.max(1e-12, max - min)));
  };

  const valueFromNormalised = (normalised: number) => {
    const norm = Math.max(0, Math.min(1, normalised));
    if (isLogarithmic && min > 0 && max > min) {
      const minLog = Math.log10(min);
      const maxLog = Math.log10(max);
      return Math.pow(10, minLog + norm * (maxLog - minLog));
    }
    return min + norm * (max - min);
  };

  const handleMouseDown = (event: React.MouseEvent) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    isDragging.current = true;
    startY.current = event.clientY;
    startVal.current = value;

    const startNorm = normalise(value);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      const deltaY = startY.current - moveEvent.clientY;
      const dragDistance = moveEvent.shiftKey ? 600 : 150;
      const nextNorm = startNorm + deltaY / dragDistance;
      onChange(clampAndStep(valueFromNormalised(nextNorm)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleWheel = (event: React.WheelEvent) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextNorm = normalise(value) + direction * 0.01;
    onChange(clampAndStep(valueFromNormalised(nextNorm)));
  };

  const handleDoubleClick = (event: React.MouseEvent) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    onChange(clampAndStep(defaultValue));
  };

  const normVal = normalise(value);
  const angle = -135 + normVal * 270;
  const startAngle = (-135 * Math.PI) / 180;
  const endAngle = (135 * Math.PI) / 180;
  const currentAngle = (angle * Math.PI) / 180;
  const getX = (a: number) => center + radius * Math.cos(a);
  const getY = (a: number) => center + radius * Math.sin(a);
  const bgPath = `M ${getX(startAngle)} ${getY(startAngle)} A ${radius} ${radius} 0 1 1 ${getX(endAngle)} ${getY(endAngle)}`;
  const largeArcFlag = angle + 135 > 180 ? 1 : 0;
  const activePath = normVal > 0.005
    ? `M ${getX(startAngle)} ${getY(startAngle)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${getX(currentAngle)} ${getY(currentAngle)}`
    : '';
  const needleX = center + needleDistance * Math.cos(currentAngle);
  const needleY = center + needleDistance * Math.sin(currentAngle);

  return (
    <div
      className={cn(
        'flex flex-col items-center select-none group',
        disabled ? 'opacity-35 cursor-not-allowed pointer-events-none' : 'cursor-pointer',
      )}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      title={`${sentenceCase(label)}: ${displayValue ?? value}`}
    >
      <div className="relative flex items-center justify-center" style={{ width: dimension, height: dimension }}>
        <svg width={dimension} height={dimension} className="transform -rotate-90 overflow-visible">
          <defs>
            <linearGradient id={arcGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={accent} />
              <stop offset="50%" stopColor={accent} />
              <stop offset="100%" stopColor={accent2} />
            </linearGradient>
            <linearGradient id={dialGradientId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#1e1e24" />
              <stop offset="100%" stopColor="#121215" />
            </linearGradient>
          </defs>

          <path
            d={bgPath}
            fill="none"
            stroke="#232328"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {activePath && (
            <path
              d={activePath}
              fill="none"
              stroke={`url(#${arcGradientId})`}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 5px ${accent})` }}
            />
          )}

          <circle
            cx={center}
            cy={center}
            r={innerRadius}
            fill={`url(#${dialGradientId})`}
            stroke="#2d2d34"
            strokeWidth={Math.max(1, 1.5 * scale)}
          />

          <circle
            cx={needleX}
            cy={needleY}
            r={needleRadius}
            fill={accent}
            style={{ filter: `drop-shadow(0 0 4px ${accent})` }}
          />
        </svg>
      </div>

      <div className="w-full flex items-center justify-between px-1 text-[8px] tracking-wider text-[#73737c] font-bold mt-0.5 gap-2">
        <span className="truncate">{sentenceCase(leftSubLabel)}</span>
        <span className="truncate text-right">{sentenceCase(rightSubLabel)}</span>
      </div>

      <span className="text-[#f1f1f4] text-[10px] font-extrabold tracking-widest mt-0.5 text-center leading-tight">
        {sentenceCase(label)}
      </span>

      {detail && (
        <span className="text-[#73737c] text-[8px] font-mono mt-0.5 text-center leading-none">
          {sentenceCase(detail)}
        </span>
      )}

      {displayValue && (
        <span className="text-[9.5px] font-mono font-bold mt-1 text-center tabular-nums" style={{ color: accent2 }}>
          {displayValue}
        </span>
      )}
    </div>
  );
}
