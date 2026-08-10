import React, { useState, useRef, useEffect } from 'react';
import { Power, X, ChevronRight, Sliders, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot, EffectType } from '../types/daw';
import { CompressorModal } from './CompressorModal';
import { EqualizerModal } from './EqualizerModal';
import { BrickwallLimiterModal } from './BrickwallLimiterModal';
import { ReverbModal } from './ReverbModal';
import { DelayModal } from './DelayModal';
import { SaturatorModal } from './SaturatorModal';

const MIN_SLOTS = 4;
const MAX_SLOTS = 7;

export const DEDICATED_EFFECTS: { type: EffectType; name: string; shortCode: string; color: string; desc: string; icon: string }[] = [
  { type: 'Compressor', name: 'Compressor', shortCode: 'COMP', color: '#f59e0b', desc: 'Dynamic range & punch control', icon: '🎛️' },
  { type: 'EQ', name: '5-Band EQ', shortCode: 'EQ', color: '#06b6d4', desc: '5-Band parametric frequency shaping', icon: '🎚️' },
  { type: 'Reverb', name: 'Reverb', shortCode: 'REV', color: '#a855f7', desc: 'Spatial hall & acoustic decay', icon: '🌊' },
  { type: 'Delay', name: 'Stereo Delay', shortCode: 'DLY', color: '#10b981', desc: 'Stereo feedback echo & tempo sync', icon: '⏱️' },
  { type: 'Limiter', name: 'Limiter', shortCode: 'LIM', color: '#eab308', desc: 'Peak ceiling protection', icon: '🛡️' },
  { type: 'Saturator', name: 'Saturator', shortCode: 'SAT', color: '#f97316', desc: 'Analog op-amp saturation & wave-shaper', icon: '⚡' },
];

interface EffectRackProps {
  effects?: EffectSlot[];
  onUpdateEffect: (slotIndex: number, type: EffectType | null, bypassed?: boolean, params?: Record<string, number>) => void;
  isMaster?: boolean;
  analyser?: any;
  isPlaying?: boolean;
}

export function EffectRack({ effects = [], onUpdateEffect, isMaster, analyser, isPlaying }: EffectRackProps) {
  const [activeSlotPicker, setActiveSlotPicker] = useState<{ slotIndex: number; rect: DOMRect } | null>(null);
  const [activeCompressorSlotIndex, setActiveCompressorSlotIndex] = useState<number | null>(null);
  const [activeEQSlotIndex, setActiveEQSlotIndex] = useState<number | null>(null);
  const [activeLimiterSlotIndex, setActiveLimiterSlotIndex] = useState<number | null>(null);
  const [activeReverbSlotIndex, setActiveReverbSlotIndex] = useState<number | null>(null);
  const [activeDelaySlotIndex, setActiveDelaySlotIndex] = useState<number | null>(null);
  const [activeSaturatorSlotIndex, setActiveSaturatorSlotIndex] = useState<number | null>(null);

  const [modalZIndices, setModalZIndices] = useState<Record<string, number>>({
    Compressor: 310,
    EQ: 310,
    Limiter: 310,
    Reverb: 310,
    Delay: 310,
    Saturator: 310,
  });
  const highestZIndexRef = useRef<number>(310);

  const bringToFront = (type: EffectType) => {
    highestZIndexRef.current += 1;
    const newZ = highestZIndexRef.current;
    setModalZIndices(prev => ({
      ...prev,
      [type]: newZ,
    }));
  };

  // Find highest index with a chosen effect
  let lastFilledIndex = -1;
  for (let i = 0; i < effects.length; i++) {
    if (effects[i] && effects[i].type !== null) {
      lastFilledIndex = i;
    }
  }

  // Calculate displayed slots count: default 4, expands up to 7 when rack is almost full
  const displayedSlotCount = Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, lastFilledIndex + 3));

  const slotsToRender = Array.from({ length: displayedSlotCount }).map((_, idx) => {
    return effects[idx] || { id: `slot-${idx}`, type: null, bypassed: false };
  });

  const handleSlotClick = (e: React.MouseEvent, slotIndex: number, slot: EffectSlot) => {
    e.stopPropagation();
    if (slot.type === 'Compressor') {
      setActiveCompressorSlotIndex(slotIndex);
      bringToFront('Compressor');
    } else if (slot.type === 'EQ') {
      setActiveEQSlotIndex(slotIndex);
      bringToFront('EQ');
    } else if (slot.type === 'Limiter') {
      setActiveLimiterSlotIndex(slotIndex);
      bringToFront('Limiter');
    } else if (slot.type === 'Reverb') {
      setActiveReverbSlotIndex(slotIndex);
      bringToFront('Reverb');
    } else if (slot.type === 'Delay') {
      setActiveDelaySlotIndex(slotIndex);
      bringToFront('Delay');
    } else if (slot.type === 'Saturator') {
      setActiveSaturatorSlotIndex(slotIndex);
      bringToFront('Saturator');
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setActiveSlotPicker({ slotIndex, rect });
    }
  };

  return (
    <div className="w-full flex flex-col gap-1 my-1">
      <div className="w-full bg-[#111113] border border-black rounded p-0.5 flex flex-col gap-0.5 shadow-inner max-h-[83px] overflow-y-auto custom-scrollbar">
        {slotsToRender.map((slot, idx) => {
          const fxMeta = slot.type ? DEDICATED_EFFECTS.find(e => e.type === slot.type) : null;
          const isOccupied = !!slot.type;
          const isBypassed = !!slot.bypassed;

          return (
            <div
              key={slot.id || `slot-${idx}`}
              onClick={(e) => handleSlotClick(e, idx, slot)}
              className={cn(
                "h-[18px] w-full rounded-[2px] border text-[8px] font-mono flex items-center justify-between px-1 cursor-pointer transition-all select-none group relative",
                isOccupied
                  ? isBypassed
                    ? "bg-[#1c1c20] border-[#333] text-[#666]"
                    : "bg-[#1e1f26] border-[#3a3d4a] text-white hover:border-[#ffd900]/60 shadow-[0_1px_3px_rgba(0,0,0,0.5)]"
                  : "bg-[#151517] border-[#222226] text-[#444] hover:bg-[#1a1a1f] hover:border-[#333] hover:text-[#888]"
              )}
            >
              <div className="flex items-center gap-1 min-w-0 flex-1 pr-1">
                {isOccupied && fxMeta ? (
                  <div className="flex items-center gap-1 truncate">
                    <span
                      className={cn(
                        "px-1 py-[0.5px] rounded-[1px] text-[7px] font-black tracking-tight shrink-0",
                        isBypassed ? "bg-[#333] text-[#777]" : "text-black font-bold"
                      )}
                      style={{ backgroundColor: isBypassed ? undefined : fxMeta.color }}
                    >
                      {fxMeta.shortCode}
                    </span>
                    <span className={cn("truncate font-medium text-[8px]", isBypassed ? "line-through opacity-60" : "text-white")}>
                      {fxMeta.name}
                    </span>
                  </div>
                ) : (
                  <span className="text-[7px] italic text-[#444] group-hover:text-[#666]">
                    Insert FX
                  </span>
                )}
              </div>

              {isOccupied && (
                <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => onUpdateEffect(idx, slot.type, !slot.bypassed, slot.params)}
                    className={cn(
                      "p-0.5 rounded-[1px] transition-colors",
                      slot.bypassed
                        ? "text-[#555] hover:text-white hover:bg-[#333]"
                        : "text-[#ffd900] hover:bg-[#ffd900]/20"
                    )}
                  >
                    <Power className="w-2 h-2" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (activeCompressorSlotIndex === idx) setActiveCompressorSlotIndex(null);
                      if (activeEQSlotIndex === idx) setActiveEQSlotIndex(null);
                      if (activeLimiterSlotIndex === idx) setActiveLimiterSlotIndex(null);
                      if (activeReverbSlotIndex === idx) setActiveReverbSlotIndex(null);
                      if (activeDelaySlotIndex === idx) setActiveDelaySlotIndex(null);
                      if (activeSaturatorSlotIndex === idx) setActiveSaturatorSlotIndex(null);
                      onUpdateEffect(idx, null, false);
                    }}
                    className="p-0.5 rounded-[1px] text-[#555] hover:text-red-400 hover:bg-red-500/20 transition-colors"
                  >
                    <X className="w-2 h-2" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Floating Popover Portal */}
      {activeSlotPicker && (
        <EffectPickerModal
          slotIndex={activeSlotPicker.slotIndex}
          currentType={effects[activeSlotPicker.slotIndex]?.type || null}
          anchorRect={activeSlotPicker.rect}
          onClose={() => setActiveSlotPicker(null)}
          onSelect={(type) => {
            onUpdateEffect(activeSlotPicker.slotIndex, type, false);
            if (type) bringToFront(type);
            if (type === 'Compressor') {
              setActiveCompressorSlotIndex(activeSlotPicker.slotIndex);
            } else if (type === 'EQ') {
              setActiveEQSlotIndex(activeSlotPicker.slotIndex);
            } else if (type === 'Limiter') {
              setActiveLimiterSlotIndex(activeSlotPicker.slotIndex);
            } else if (type === 'Reverb') {
              setActiveReverbSlotIndex(activeSlotPicker.slotIndex);
            } else if (type === 'Delay') {
              setActiveDelaySlotIndex(activeSlotPicker.slotIndex);
            } else if (type === 'Saturator') {
              setActiveSaturatorSlotIndex(activeSlotPicker.slotIndex);
            }
            setActiveSlotPicker(null);
          }}
        />
      )}

      {/* Compressor Modal Popup Window */}
      {activeCompressorSlotIndex !== null && slotsToRender[activeCompressorSlotIndex]?.type === 'Compressor' && (
        <CompressorModal
          slot={slotsToRender[activeCompressorSlotIndex]}
          slotIndex={activeCompressorSlotIndex}
          analyser={analyser}
          isPlaying={isPlaying}
          onUpdateParams={(slotIdx, bypassed, params) => {
            onUpdateEffect(slotIdx, 'Compressor', bypassed, params);
          }}
          onClose={() => setActiveCompressorSlotIndex(null)}
          zIndex={modalZIndices.Compressor}
          onFocus={() => bringToFront('Compressor')}
        />
      )}

      {/* Equalizer Modal Popup Window */}
      {activeEQSlotIndex !== null && slotsToRender[activeEQSlotIndex]?.type === 'EQ' && (
        <EqualizerModal
          slot={slotsToRender[activeEQSlotIndex]}
          slotIndex={activeEQSlotIndex}
          analyser={analyser}
          isPlaying={isPlaying}
          onUpdateParams={(slotIdx, bypassed, params) => {
            onUpdateEffect(slotIdx, 'EQ', bypassed, params);
          }}
          onClose={() => setActiveEQSlotIndex(null)}
          zIndex={modalZIndices.EQ}
          onFocus={() => bringToFront('EQ')}
        />
      )}

      {/* Brickwall Limiter Modal Popup Window */}
      {activeLimiterSlotIndex !== null && slotsToRender[activeLimiterSlotIndex]?.type === 'Limiter' && (
        <BrickwallLimiterModal
          slot={slotsToRender[activeLimiterSlotIndex]}
          slotIndex={activeLimiterSlotIndex}
          analyser={analyser}
          isPlaying={isPlaying}
          onUpdateParams={(slotIdx, bypassed, params) => {
            onUpdateEffect(slotIdx, 'Limiter', bypassed, params);
          }}
          onClose={() => setActiveLimiterSlotIndex(null)}
          zIndex={modalZIndices.Limiter}
          onFocus={() => bringToFront('Limiter')}
        />
      )}

      {/* Reverb Modal Popup Window */}
      {activeReverbSlotIndex !== null && slotsToRender[activeReverbSlotIndex]?.type === 'Reverb' && (
        <ReverbModal
          slot={slotsToRender[activeReverbSlotIndex]}
          slotIndex={activeReverbSlotIndex}
          analyser={analyser}
          isPlaying={isPlaying}
          onUpdateParams={(slotIdx, bypassed, params) => {
            onUpdateEffect(slotIdx, 'Reverb', bypassed, params);
          }}
          onClose={() => setActiveReverbSlotIndex(null)}
          zIndex={modalZIndices.Reverb}
          onFocus={() => bringToFront('Reverb')}
        />
      )}

      {/* Delay Modal Popup Window */}
      {activeDelaySlotIndex !== null && slotsToRender[activeDelaySlotIndex]?.type === 'Delay' && (
        <DelayModal
          slot={slotsToRender[activeDelaySlotIndex]}
          slotIndex={activeDelaySlotIndex}
          analyser={analyser}
          isPlaying={isPlaying}
          onUpdateParams={(slotIdx, bypassed, params) => {
            onUpdateEffect(slotIdx, 'Delay', bypassed, params);
          }}
          onClose={() => setActiveDelaySlotIndex(null)}
          zIndex={modalZIndices.Delay}
          onFocus={() => bringToFront('Delay')}
        />
      )}

      {/* Saturator Modal Popup Window */}
      {activeSaturatorSlotIndex !== null && slotsToRender[activeSaturatorSlotIndex]?.type === 'Saturator' && (
        <SaturatorModal
          slot={slotsToRender[activeSaturatorSlotIndex]}
          slotIndex={activeSaturatorSlotIndex}
          analyser={analyser}
          isPlaying={isPlaying}
          onUpdateParams={(slotIdx, bypassed, params) => {
            onUpdateEffect(slotIdx, 'Saturator', bypassed, params);
          }}
          onClose={() => setActiveSaturatorSlotIndex(null)}
          zIndex={modalZIndices.Saturator}
          onFocus={() => bringToFront('Saturator')}
        />
      )}
    </div>
  );
}

interface EffectPickerModalProps {
  slotIndex: number;
  currentType: EffectType | null;
  anchorRect: DOMRect;
  onClose: () => void;
  onSelect: (type: EffectType | null) => void;
}

function EffectPickerModal({ slotIndex, currentType, anchorRect, onClose, onSelect }: EffectPickerModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Position popover safely relative to window viewport
  const popoverWidth = 220;
  let left = anchorRect.left + anchorRect.width + 6;
  if (left + popoverWidth > window.innerWidth - 10) {
    left = anchorRect.left - popoverWidth - 6;
  }
  if (left < 10) left = 10;

  let top = anchorRect.top - 10;
  if (top + 320 > window.innerHeight) {
    top = window.innerHeight - 330;
  }
  if (top < 10) top = 10;

  return (
    <div className="fixed inset-0 z-[200] pointer-events-auto">
      <div
        ref={modalRef}
        style={{ top: `${top}px`, left: `${left}px`, width: `${popoverWidth}px` }}
        className="fixed z-[210] bg-[#1a1b20] border border-[#ffd900]/40 rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.8)] p-2 font-sans text-xs text-[#e0e0e0] flex flex-col gap-1 animate-in fade-in zoom-in-95 duration-100"
      >
        <div className="flex items-center justify-between border-b border-[#333] pb-1.5 mb-1 px-1">
          <span className="text-[10px] font-bold tracking-wider text-[#ffd900] flex items-center gap-1">
            <Sliders className="w-3 h-3 text-[#ffd900]" />
            Insert Effect {slotIndex + 1}
          </span>
          <button
            onClick={onClose}
            className="text-[#888] hover:text-white p-0.5 rounded hover:bg-[#333]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Clear Option */}
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            "flex items-center justify-between px-2 py-1.5 rounded transition-colors text-left text-[11px]",
            currentType === null ? "bg-[#333] text-white font-bold" : "text-[#aaa] hover:bg-[#25262c] hover:text-white"
          )}
        >
          <span>Clear Slot</span>
          {currentType === null && <Check className="w-3.5 h-3.5 text-[#ffd900]" />}
        </button>

        <div className="w-full h-[1px] bg-[#2a2a30] my-0.5" />

        <div className="text-[9px] font-bold text-[#666] px-2 py-0.5">
          Built-in Effects
        </div>

        <div className="flex flex-col gap-0.5 max-h-[220px] overflow-y-auto custom-scrollbar pr-0.5">
          {DEDICATED_EFFECTS.map((fx) => {
            const isSelected = currentType === fx.type;
            return (
              <button
                key={fx.type}
                type="button"
                onClick={() => onSelect(fx.type)}
                className={cn(
                  "flex items-center justify-between px-2 py-1.5 rounded transition-all text-left group",
                  isSelected
                    ? "bg-[#ffd900]/20 border border-[#ffd900]/60 text-white"
                    : "hover:bg-[#262730] text-[#ccc] hover:text-white border border-transparent"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="text-[8px] font-black font-mono px-1 rounded-sm text-black shrink-0"
                    style={{ backgroundColor: fx.color }}
                  >
                    {fx.shortCode}
                  </span>
                  <span className="font-bold text-[11px] truncate">{fx.name}</span>
                </div>
                {isSelected && <Check className="w-3.5 h-3.5 text-[#ffd900] shrink-0 ml-1" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
