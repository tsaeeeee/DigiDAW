import React from 'react';
import { EffectSlot } from '../types/daw';
import { cn } from '../lib/utils';
import { PluginFrame } from './PluginFrame';
import { PluginKnob } from './PluginKnob';

interface Props { slot: EffectSlot; slotIndex: number; analyser?: any; isPlaying?: boolean; onUpdateParams: (slotIndex:number,bypassed:boolean,params:Record<string,number>)=>void; onClose:()=>void; zIndex?:number; onFocus?:()=>void; }

export function BrickwallLimiterModal({ slot, slotIndex, onUpdateParams, onClose, zIndex, onFocus }: Props) {
  const p=slot.params||{}; const bypassed=!!slot.bypassed;
  const update=(key:string,value:number)=>onUpdateParams(slotIndex,bypassed,{...p,[key]:value});
  const drive=p.drive??4, ceiling=p.ceiling??-0.5, release=p.release??50, diodeSat=p.diodeSat??15, truePeak=p.truePeak??1;
  return <PluginFrame title="Dilimit" subtitle="Peak ceiling protection" accent="#facc15" accent2="#fde047" width={500} bypassed={bypassed} onToggleBypass={()=>onUpdateParams(slotIndex,!bypassed,p)} onClose={onClose} zIndex={zIndex} onFocus={onFocus}>
    <div className="p-4 grid grid-cols-4 gap-4 justify-items-center">
      <PluginKnob label="Drive" leftSubLabel="Clean" rightSubLabel="Push" value={drive} min={-12} max={18} step={0.5} defaultValue={4} displayValue={`${drive>0?'+':''}${drive.toFixed(1)} dB`} onChange={v=>update('drive',v)} />
      <PluginKnob label="Ceiling" leftSubLabel="Low" rightSubLabel="High" value={ceiling} min={-6} max={-0.01} step={0.01} defaultValue={-0.5} displayValue={`${ceiling.toFixed(2)} dB`} onChange={v=>update('ceiling',v)} />
      <PluginKnob label="Release" leftSubLabel="Fast" rightSubLabel="Slow" value={release} min={5} max={500} step={1} defaultValue={50} displayValue={`${Math.round(release)} ms`} isLogarithmic onChange={v=>update('release',v)} />
      <PluginKnob label="Saturation" leftSubLabel="Clean" rightSubLabel="Warm" value={diodeSat} min={0} max={100} step={1} defaultValue={15} displayValue={`${Math.round(diodeSat)}%`} onChange={v=>update('diodeSat',v)} />
    </div>
    <div className="px-4 pb-4 flex justify-end"><button type="button" onClick={()=>update('truePeak',truePeak===1?0:1)} className={cn('h-7 px-4 rounded-full border text-[9px] font-bold transition-all',truePeak===1?'text-black border-transparent':'bg-[#111114] border-[#3a3a42] text-[#777]')} style={truePeak===1?{backgroundColor:'#facc15'}:undefined}>True peak {truePeak===1?'on':'off'}</button></div>
  </PluginFrame>;
}
