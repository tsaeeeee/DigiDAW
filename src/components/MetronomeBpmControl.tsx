import React, { useState, useEffect, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '../lib/utils';

interface MetronomeBpmControlProps {
  bpm: number;
  onBpmChange: (newBpm: number) => void;
  metronomeEnabled: boolean;
  onToggleMetronome: () => void;
  currentBeat: number;
  isPlaying: boolean;
  embedded?: boolean;
}

export function MetronomeBpmControl({
  bpm,
  onBpmChange,
  metronomeEnabled,
  onToggleMetronome,
  currentBeat,
  isPlaying,
  embedded = false,
}: MetronomeBpmControlProps) {
  const [isEditingBpm, setIsEditingBpm] = useState(false);
  const [tempBpmStr, setTempBpmStr] = useState(bpm.toString());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTempBpmStr(bpm.toString());
  }, [bpm]);

  useEffect(() => {
    if (isEditingBpm && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingBpm]);

  const handleBpmCommit = () => {
    setIsEditingBpm(false);
    const parsed = parseInt(tempBpmStr, 10);
    if (!isNaN(parsed)) {
      onBpmChange(parsed);
    } else {
      setTempBpmStr(bpm.toString());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBpmCommit();
    } else if (e.key === 'Escape') {
      setIsEditingBpm(false);
      setTempBpmStr(bpm.toString());
    }
  };

  return (
    <div className={cn(
      "flex items-center gap-2 text-[#ffd900] font-mono select-none",
      !embedded && "bg-black border border-[#444] rounded-sm px-2.5 py-1 shadow-inner"
    )}>
      {/* Metronome Toggle Button */}
      <button
        type="button"
        onClick={onToggleMetronome}
        title={metronomeEnabled ? "Turn Metronome Off" : "Turn Metronome On"}
        className={cn(
          "flex items-center justify-center p-1 rounded transition-all cursor-pointer border",
          metronomeEnabled
            ? "bg-[#ffd900] text-black border-[#ffd900] shadow-[0_0_8px_rgba(255,217,0,0.6)]"
            : "bg-[#1f1f1f] text-[#888] border-[#333] hover:text-[#ffd900] hover:border-[#ffd900]/50"
        )}
      >
        {/* Metronome Icon SVG */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 shrink-0">
          <path d="M12 2L4 22h16L12 2z" />
          <path d="M12 18l5-10" />
          <circle cx="17" cy="8" r="1.5" fill="currentColor" />
        </svg>
      </button>

      <div className="w-[1px] h-4 bg-[#333]" />

      {/* BPM Adjustment Group */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onBpmChange(bpm - 1)}
          disabled={bpm <= 60}
          title="Decrease BPM (Min 60)"
          className="w-4 h-4 rounded-xs bg-[#222] hover:bg-[#ffd900] hover:text-black border border-[#444] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors text-[10px]"
        >
          <Minus className="w-2.5 h-2.5" />
        </button>

        {/* BPM Value Display / Edit Input */}
        {isEditingBpm ? (
          <input
            ref={inputRef}
            type="number"
            min={60}
            max={300}
            value={tempBpmStr}
            onChange={(e) => setTempBpmStr(e.target.value)}
            onBlur={handleBpmCommit}
            onKeyDown={handleKeyDown}
            className="w-12 bg-[#1a1a1a] text-[#ffd900] text-center border border-[#ffd900] rounded text-xs font-bold font-lcd outline-none py-0.5"
          />
        ) : (
          <div
            onDoubleClick={() => setIsEditingBpm(true)}
            onClick={() => setIsEditingBpm(true)}
            title="Click or double-click to edit BPM (60 - 300)"
            className="flex items-center gap-1 cursor-pointer hover:bg-white/10 px-1 py-0.5 rounded transition-colors group"
          >
            <span className="text-xs font-bold tracking-widest font-lcd text-[#ffd900] group-hover:text-white">
              {bpm}
            </span>
            <span className="text-[9px] text-[#888] font-semibold tracking-tight">BPM</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => onBpmChange(bpm + 1)}
          disabled={bpm >= 300}
          title="Increase BPM (Max 300)"
          className="w-4 h-4 rounded-xs bg-[#222] hover:bg-[#ffd900] hover:text-black border border-[#444] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors text-[10px]"
        >
          <Plus className="w-2.5 h-2.5" />
        </button>
      </div>

      <div className="w-[1px] h-4 bg-[#333]" />

      {/* Beat LED Indicator (1, 2, 3, 4) */}
      <div className="flex items-center gap-1 px-0.5" title="4/4 Beat Pulse">
        {[0, 1, 2, 3].map((b) => {
          const isActive = isPlaying && currentBeat === b;
          const isAccent = b === 0;
          return (
            <div
              key={b}
              className={cn(
                "w-2 h-2 rounded-full border transition-all duration-75",
                isActive
                  ? isAccent
                    ? "bg-[#ffd900] border-[#ffd900] shadow-[0_0_8px_rgba(255,217,0,0.9)] scale-125"
                    : "bg-[#00f0ff] border-[#00f0ff] shadow-[0_0_6px_rgba(0,240,255,0.8)] scale-110"
                  : "bg-[#222] border-[#444] opacity-40"
              )}
            />
          );
        })}
      </div>
    </div>
  );
}
