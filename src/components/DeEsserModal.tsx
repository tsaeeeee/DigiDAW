import React, { useEffect, useState } from 'react';
import { EffectSlot } from '../types/daw';
import { cn } from '../lib/utils';
import { DeEsserNode } from '../dsp/deesser/DeEsserNode';
import { PluginFrame } from './PluginFrame';
import { PluginKnob } from './PluginKnob';

interface Props { slot:EffectSlot; slotIndex:number; analyser?:any; isPlaying?:boolean; onUpdateParams:(slotIndex:number,bypassed:boolean,params:Record<string,number>)=>void; onClose:()=>void; zIndex?:number; onFocus?:()=>void; }
export function DeEsserModal({slot,slotIndex,onUpdateParams,onClose,zIndex,onFocus}:Props){
 const p=slot.params||{}; const bypassed=!!slot.bypassed; const update=(k:string,v:number)=>onUpdateParams(slotIndex,bypassed,{...p,[k]:v}); const get=(k:string,d:number)=>p[k]??d;
 const [reduction,setReduction]=useState(0); useEffect(()=>{const t=window.setInterval(()=>setReduction(DeEsserNode.lastActiveInstance?.getReductionDb()||0),60);return()=>window.clearInterval(t);},[]);
 return <PluginFrame title="Disser" subtitle="Dynamic sibilance control" accent="#22d3ee" accent2="#67e8f9" width={560} bypassed={bypassed} onToggleBypass={()=>onUpdateParams(slotIndex,!bypassed,p)} onClose={onClose} zIndex={zIndex} onFocus={onFocus}>
  <div className="px-4 pt-4"><div className="flex justify-between text-[9px] text-[#777]"><span>Sibilance reduction</span><span>{reduction.toFixed(1)} dB</span></div><div className="h-2 mt-1 rounded bg-[#222] overflow-hidden"><div className="h-full bg-[#22d3ee] transition-[width] duration-75" style={{width:`${Math.min(100,reduction/12*100)}%`}}/></div></div>
  <div className="p-4 grid grid-cols-3 gap-4 justify-items-center">
   <PluginKnob label="Range low" leftSubLabel="2.5k" rightSubLabel="10k" value={get('lowFreq',4500)} min={2500} max={10000} step={50} defaultValue={4500} displayValue={`${(get('lowFreq',4500)/1000).toFixed(1)} kHz`} isLogarithmic onChange={v=>update('lowFreq',Math.min(v,get('highFreq',9500)-500))} />
   <PluginKnob label="Range high" leftSubLabel="3.5k" rightSubLabel="16k" value={get('highFreq',9500)} min={3500} max={16000} step={50} defaultValue={9500} displayValue={`${(get('highFreq',9500)/1000).toFixed(1)} kHz`} isLogarithmic onChange={v=>update('highFreq',Math.max(v,get('lowFreq',4500)+500))} />
   <PluginKnob label="Threshold" leftSubLabel="More" rightSubLabel="Less" value={get('threshold',-28)} min={-60} max={-4} step={0.5} defaultValue={-28} displayValue={`${get('threshold',-28).toFixed(1)} dB`} onChange={v=>update('threshold',v)} />
   <PluginKnob label="Reduction" leftSubLabel="Gentle" rightSubLabel="Firm" value={get('ratio',6)} min={1} max={20} step={0.1} defaultValue={6} displayValue={`${get('ratio',6).toFixed(1)}:1`} onChange={v=>update('ratio',v)} />
   <PluginKnob label="Attack" leftSubLabel="Fast" rightSubLabel="Slow" value={get('attack',3)} min={0.5} max={50} step={0.1} defaultValue={3} displayValue={`${get('attack',3).toFixed(1)} ms`} isLogarithmic onChange={v=>update('attack',v)} />
   <PluginKnob label="Release" leftSubLabel="Fast" rightSubLabel="Slow" value={get('release',80)} min={10} max={500} step={1} defaultValue={80} displayValue={`${Math.round(get('release',80))} ms`} isLogarithmic onChange={v=>update('release',v)} />
  </div>
  <div className="px-4 pb-4 flex justify-end"><button type="button" onClick={()=>update('listen',get('listen',0)===1?0:1)} className={cn('h-7 px-4 rounded-full border text-[9px] font-bold',get('listen',0)===1?'bg-[#22d3ee] text-black border-transparent':'bg-[#111114] border-[#34343d] text-[#777]')}>Listen {get('listen',0)===1?'on':'off'}</button></div>
 </PluginFrame>;
}
