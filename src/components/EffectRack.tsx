import React, { useRef, useState } from 'react';
import { Power, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { EffectSlot, EffectType } from '../types/daw';
import { CompressorModal } from './CompressorModal';
import { EqualizerModal } from './EqualizerModal';
import { BrickwallLimiterModal } from './BrickwallLimiterModal';
import { ReverbModal } from './ReverbModal';
import { DelayModal } from './DelayModal';
import { SaturatorModal } from './SaturatorModal';
import { PitchyModal } from './PitchyModal';
import { DeEsserModal } from './DeEsserModal';

const SLOTS = 5;
export const DEDICATED_EFFECTS: { type: EffectType; name: string; shortCode: string; color: string; desc: string }[] = [
  { type: 'Compressor', name: 'Dikompres', shortCode: 'COMP', color: '#fb923c', desc: 'Dynamic range control' },
  { type: 'EQ', name: 'Diequ', shortCode: 'EQ', color: '#38bdf8', desc: 'Five-band equalizer' },
  { type: 'Pitchy', name: 'Ditune', shortCode: 'TUNE', color: '#f472b6', desc: 'Vocal pitch correction' },
  { type: 'Reverb', name: 'Diecho', shortCode: 'ECHO', color: '#c084fc', desc: 'Spatial reverb' },
  { type: 'Delay', name: 'Dipantul', shortCode: 'DLY', color: '#34d399', desc: 'Stereo delay' },
  { type: 'Limiter', name: 'Dilimit', shortCode: 'LIM', color: '#facc15', desc: 'Peak ceiling protection' },
  { type: 'Saturator', name: 'Disaturasi', shortCode: 'SAT', color: '#f97316', desc: 'Harmonic saturation' },
  { type: 'DeEsser', name: 'Disser', shortCode: 'DESS', color: '#22d3ee', desc: 'Dynamic sibilance control' },
];

interface Props {
  effects?: EffectSlot[];
  onUpdateEffect: (slotIndex: number, type: EffectType | null, bypassed?: boolean, params?: Record<string, number>) => void;
  isMaster?: boolean;
  analyser?: any;
  isPlaying?: boolean;
}

export function EffectRack({ effects = [], onUpdateEffect, analyser, isPlaying }: Props) {
  const [picker, setPicker] = useState<number | null>(null);
  const [open, setOpen] = useState<{ type: EffectType; index: number } | null>(null);
  const [z, setZ] = useState(310);
  const zRef = useRef(310);
  const front = () => { zRef.current += 1; setZ(zRef.current); };
  const slots = Array.from({ length: SLOTS }, (_, i) => effects[i] || { id: `slot-${i}`, type: null, bypassed: false });
  const openSlot = (index: number, slot: EffectSlot) => { if (slot.type) { setOpen({ type: slot.type, index }); front(); } else setPicker(index); };
  const modalProps = (type: EffectType) => ({
    slot: slots[open!.index],
    slotIndex: open!.index,
    analyser,
    isPlaying,
    onUpdateParams: (i: number, b: boolean, p: Record<string, number>) => onUpdateEffect(i, type, b, p),
    onClose: () => setOpen(null),
    zIndex: z,
    onFocus: front,
  });
  const titleStyle = (type: EffectType) => ({ '--plugin-title': JSON.stringify(DEDICATED_EFFECTS.find(effect => effect.type === type)?.name || type) } as React.CSSProperties);

  return <div className="w-full flex flex-col gap-1 my-1 relative">
    <div className="w-full bg-[#111113] border border-black rounded p-0.5 flex flex-col gap-0.5 shadow-inner max-h-[83px] overflow-y-auto custom-scrollbar">
      {slots.map((slot, i) => {
        const meta = slot.type ? DEDICATED_EFFECTS.find(x => x.type === slot.type) : null;
        const bypass = !!slot.bypassed;
        return <div key={slot.id || i} onClick={() => openSlot(i, slot)} className={cn('h-[18px] rounded-[2px] border text-[8px] flex items-center justify-between px-1 cursor-pointer', meta ? 'bg-[#1e1f26] border-[#3a3d4a] text-white' : 'bg-[#151517] border-[#222226] text-[#555]')}>
          <div className="flex items-center gap-1 min-w-0">{meta ? <><span className="px-1 rounded-[1px] text-[7px] font-black text-black" style={{ backgroundColor: bypass ? '#444' : meta.color }}>{meta.shortCode}</span><span className={cn('truncate font-medium', bypass && 'line-through opacity-50')}>{meta.name}</span></> : <span className="italic">Insert fx</span>}</div>
          {meta && <div className="flex items-center gap-0.5" onClick={e => e.stopPropagation()}><button onClick={() => onUpdateEffect(i, slot.type, !bypass, slot.params)} className="p-0.5" style={{ color: bypass ? '#666' : meta.color }}><Power className="w-2 h-2" /></button><button onClick={() => { if (open?.index === i) setOpen(null); onUpdateEffect(i, null, false); }} className="p-0.5 text-[#666] hover:text-red-400"><X className="w-2 h-2" /></button></div>}
        </div>;
      })}
    </div>

    {picker !== null && <div className="absolute top-[86px] left-0 z-[420] w-60 rounded-lg border border-[#34343d] bg-[#17171d] p-2 shadow-2xl">
      <div className="text-[9px] text-[#777] px-1 pb-1.5">Choose effect</div>
      {DEDICATED_EFFECTS.map(meta => <button key={meta.type} onClick={() => { onUpdateEffect(picker, meta.type, false); setOpen({ type: meta.type, index: picker }); setPicker(null); front(); }} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#282832] text-left"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: meta.color }} /><div><div className="text-[10px] text-white font-bold">{meta.name}</div><div className="text-[8px] text-[#666]">{meta.desc}</div></div></button>)}
    </div>}

    {open?.type === 'Compressor' && <div className="plugin-title-patch" style={titleStyle('Compressor')}><CompressorModal {...modalProps('Compressor')} /></div>}
    {open?.type === 'EQ' && <div className="plugin-title-patch" style={titleStyle('EQ')}><EqualizerModal {...modalProps('EQ')} /></div>}
    {open?.type === 'Pitchy' && <div className="plugin-title-patch" style={titleStyle('Pitchy')}><PitchyModal {...modalProps('Pitchy')} /></div>}
    {open?.type === 'Reverb' && <div className="plugin-title-patch" style={titleStyle('Reverb')}><ReverbModal {...modalProps('Reverb')} /></div>}
    {open?.type === 'Delay' && <div className="plugin-title-patch" style={titleStyle('Delay')}><DelayModal {...modalProps('Delay')} /></div>}
    {open?.type === 'Limiter' && <div className="plugin-title-patch" style={titleStyle('Limiter')}><BrickwallLimiterModal {...modalProps('Limiter')} /></div>}
    {open?.type === 'Saturator' && <div className="plugin-title-patch" style={titleStyle('Saturator')}><SaturatorModal {...modalProps('Saturator')} /></div>}
    {open?.type === 'DeEsser' && <DeEsserModal {...modalProps('DeEsser')} />}
  </div>;
}
