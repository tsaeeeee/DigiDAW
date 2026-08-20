import React, { useRef, useState } from 'react';
import { Power, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface PluginFrameProps {
  title: string;
  subtitle?: string;
  accent: string;
  accent2?: string;
  width?: number;
  bypassed: boolean;
  onToggleBypass: () => void;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
  children: React.ReactNode;
}

export function PluginFrame({
  title,
  subtitle,
  accent,
  accent2,
  width = 620,
  bypassed,
  onToggleBypass,
  onClose,
  zIndex = 310,
  onFocus,
  children,
}: PluginFrameProps) {
  const [position, setPosition] = useState(() => ({
    x: Math.max(12, Math.round(window.innerWidth / 2 - width / 2)),
    y: Math.max(12, Math.round(window.innerHeight / 2 - 210)),
  }));
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });

  const handleMouseDown = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('button, input, select')) return;
    event.preventDefault();
    onFocus?.();
    dragging.current = true;
    offset.current = { x: event.clientX - position.x, y: event.clientY - position.y };

    const move = (moveEvent: MouseEvent) => {
      if (!dragging.current) return;
      setPosition({
        x: Math.max(8, Math.min(window.innerWidth - width - 8, moveEvent.clientX - offset.current.x)),
        y: Math.max(8, Math.min(window.innerHeight - 80, moveEvent.clientY - offset.current.y)),
      });
    };
    const up = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const style = {
    left: position.x,
    top: position.y,
    width,
    zIndex,
    '--plugin-accent': accent,
    '--plugin-accent-2': accent2 || accent,
  } as React.CSSProperties;

  return (
    <div className="fixed inset-0 z-[300] pointer-events-none">
      <div
        onMouseDown={() => onFocus?.()}
        style={style}
        className="fixed pointer-events-auto overflow-hidden rounded-xl border border-[#303038] bg-[#141416] shadow-[0_25px_65px_rgba(0,0,0,0.92)] select-none"
      >
        <div onMouseDown={handleMouseDown} className="h-10 px-3 flex items-center justify-between bg-[#1c1c22] border-b border-[#2d2d38] cursor-move">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={onToggleBypass}
              className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center transition-all shrink-0',
                !bypassed ? 'text-black' : 'bg-[#25252c] text-[#777]',
              )}
              style={!bypassed ? { backgroundColor: accent, boxShadow: `0 0 10px ${accent}88` } : undefined}
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <div className="min-w-0">
              <div className="font-black text-sm tracking-wide truncate" style={{ color: accent }}>{title}</div>
              {subtitle && <div className="text-[8px] text-[#74747d] tracking-wide truncate">{subtitle}</div>}
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded text-[#888] hover:text-white hover:bg-[#292932]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="bg-[#141416]">{children}</div>
      </div>
    </div>
  );
}
