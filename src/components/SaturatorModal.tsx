import React from 'react';
import { EffectSlot } from '../types/daw';
import { cn } from '../lib/utils';
import { PluginFrame } from './PluginFrame';
import { PluginKnob } from './PluginKnob';

interface Props { slot:EffectSlot; slotIndex:number; analyser?:any; isPlaying?:boolean; onUpdateParams:(slotIndex:number,bypassed:boolean,params:Record<string,number>)=>void; onClose:()=>void; zIndex?:number; onFocus?:()=>void; }
const MODES=['Clean','Normal','Hot','Redline'];
export function SaturatorModal({slot,slotIndex,onUpdateParams,onClose,zIndex,onFocus}:Props){
 const p=slot.params||{}; const bypassed=!!slot.bypassed; const update=(k:string,v:number)=>onUpdateParams(slotIndex,bypassed,{...p,[k]:v});
 const inputGain=p.inputGain??0, saturationDrive=p.saturationDrive??3, modeIndex=p.modeIndex??1, outputGain=p.outputGain??0;
 return <PluginFrame title="Disaturasi" subtitle="Harmonic saturation" accent="#f97316" accent2="#fb7185" width={470} bypassed={bypassed} onToggleBypass={()=>onUpdateParams(slotIndex,!bypassed,p)} onClose={onClose} zIndex={zIndex} onFocus={onFocus}>
  <div className="p-4 grid grid-cols-3 gap-4 justify-items-center">
   <PluginKnob label="Input" leftSubLabel="Down" rightSubLabel="Up" value={inputGain} min={-18} max={18} step={0.5} defaultValue={0} displayValue={`${inputGain>0?'+':''}${inputGain.toFixed(1)} dB`} onChange={v=>update('inputGain',v)} />
   <PluginKnob label="Drive" leftSubLabel="Clean" rightSubLabel="Hot" value={saturationDrive} min={0} max={10} step={0.1} defaultValue={3} displayValue={saturationDrive.toFixed(1)} onChange={v=>update('saturationDrive',v)} />
   <PluginKnob label="Output" leftSubLabel="Down" rightSubLabel="Up" value={outputGain} min={-18} max={18} step={0.5} defaultValue={0} displayValue={`${outputGain>0?'+':''}${outputGain.toFixed(1)} dB`} onChange={v=>update('outputGain',v)} />
  </div>
  <div className="px-4 pb-4"><div className="text-[9px] text-[#777] mb-1.5">Mode</div><div className="grid grid-cols-4 gap-1">{MODES.map((name,i)=><button key={name} type="button" onClick={()=>update('modeIndex',i)} className={cn('h-7 rounded-full border text-[9px] font-bold',modeIndex===i?'text-black border-transparent':'bg-[#111114] border-[#34343d] text-[#777]')} style={modeIndex===i?{backgroundColor:'#f97316'}:undefined}>{name}</button>)}</div></div>
 </PluginFrame>;
}
