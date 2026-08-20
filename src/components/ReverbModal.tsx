import React, { useEffect, useState } from 'react';
import { EffectSlot } from '../types/daw';
import { cn } from '../lib/utils';
import { ProReverbNode } from '../dsp/reverb/ProReverbNode';
import { PluginFrame } from './PluginFrame';
import { PluginKnob } from './PluginKnob';

interface Props { slot:EffectSlot; slotIndex:number; analyser?:any; isPlaying?:boolean; onUpdateParams:(slotIndex:number,bypassed:boolean,params:Record<string,number>)=>void; onClose:()=>void; zIndex?:number; onFocus?:()=>void; }
const rmsPct=(r:number)=>r<=0?0:Math.max(0,Math.min(100,((20*Math.log10(r)+60)/60)*100));
export function ReverbModal({slot,slotIndex,onUpdateParams,onClose,zIndex,onFocus}:Props){
 const p=slot.params||{}; const bypassed=!!slot.bypassed; const update=(k:string,v:number)=>onUpdateParams(slotIndex,bypassed,{...p,[k]:v});
 const [meters,setMeters]=useState({input:0,wet:0,output:0}); useEffect(()=>{const t=window.setInterval(()=>{const n=ProReverbNode.lastActiveInstance;if(!n)return;const m=n.getTelemetry();setMeters({input:rmsPct(m.inputRms),wet:rmsPct(m.reverbRms),output:rmsPct(m.outputRms)});},70);return()=>window.clearInterval(t);},[]);
 const get=(k:string,d:number)=>p[k]??d;
 return <PluginFrame title="Diecho" subtitle="Spatial reverb" accent="#c084fc" accent2="#ddd6fe" width={680} bypassed={bypassed} onToggleBypass={()=>onUpdateParams(slotIndex,!bypassed,p)} onClose={onClose} zIndex={zIndex} onFocus={onFocus}>
  <div className="px-4 pt-3 grid grid-cols-3 gap-3 text-[8px] text-[#777]">{Object.entries(meters).map(([k,v])=><div key={k}><div className="flex justify-between"><span>{k.charAt(0).toUpperCase()+k.slice(1)}</span><span>{Math.round(v)}%</span></div><div className="h-1 mt-1 bg-[#222] rounded overflow-hidden"><div className="h-full bg-[#c084fc]" style={{width:`${v}%`}}/></div></div>)}</div>
  <div className="p-4 grid grid-cols-5 gap-x-2 gap-y-3 justify-items-center">
   <PluginKnob label="Decay" leftSubLabel="Short" rightSubLabel="Long" value={get('decay',2.5)} min={0.2} max={20} step={0.1} defaultValue={2.5} displayValue={`${get('decay',2.5).toFixed(1)} s`} onChange={v=>update('decay',v)} />
   <PluginKnob label="Size" leftSubLabel="Tight" rightSubLabel="Huge" value={get('size',65)} min={10} max={100} step={1} defaultValue={65} displayValue={`${Math.round(get('size',65))}%`} onChange={v=>update('size',v)} />
   <PluginKnob label="Pre-delay" leftSubLabel="Short" rightSubLabel="Long" value={get('predelay',20)} min={0} max={200} step={1} defaultValue={20} displayValue={`${Math.round(get('predelay',20))} ms`} onChange={v=>update('predelay',v)} />
   <PluginKnob label="Diffusion" leftSubLabel="Sparse" rightSubLabel="Dense" value={get('diff',80)} min={0} max={100} step={1} defaultValue={80} displayValue={`${Math.round(get('diff',80))}%`} onChange={v=>update('diff',v)} />
   <PluginKnob label="Low cut" leftSubLabel="20" rightSubLabel="2k" value={get('lcut',120)} min={20} max={2000} step={1} defaultValue={120} displayValue={`${Math.round(get('lcut',120))} Hz`} isLogarithmic onChange={v=>update('lcut',v)} />
   <PluginKnob label="High cut" leftSubLabel="1k" rightSubLabel="20k" value={get('hcut',12000)} min={1000} max={20000} step={10} defaultValue={12000} displayValue={`${(get('hcut',12000)/1000).toFixed(1)} kHz`} isLogarithmic onChange={v=>update('hcut',v)} />
   <PluginKnob label="Damping" leftSubLabel="Dark" rightSubLabel="Open" value={get('damp',5000)} min={500} max={18000} step={50} defaultValue={5000} displayValue={`${(get('damp',5000)/1000).toFixed(1)} kHz`} isLogarithmic onChange={v=>update('damp',v)} />
   <PluginKnob label="Early reflections" leftSubLabel="Less" rightSubLabel="More" value={get('er',40)} min={0} max={100} step={1} defaultValue={40} displayValue={`${Math.round(get('er',40))}%`} onChange={v=>update('er',v)} />
   <PluginKnob label="Modulation" leftSubLabel="Still" rightSubLabel="Moving" value={get('mod',30)} min={0} max={100} step={1} defaultValue={30} displayValue={`${Math.round(get('mod',30))}%`} onChange={v=>update('mod',v)} />
   <PluginKnob label="Speed" leftSubLabel="Slow" rightSubLabel="Fast" value={get('speed',1.5)} min={0.1} max={10} step={0.1} defaultValue={1.5} displayValue={`${get('speed',1.5).toFixed(1)} Hz`} isLogarithmic onChange={v=>update('speed',v)} />
   <PluginKnob label="Bass" leftSubLabel="Lean" rightSubLabel="Full" value={get('bass',1)} min={0.5} max={2} step={0.01} defaultValue={1} displayValue={`${get('bass',1).toFixed(2)}x`} onChange={v=>update('bass',v)} />
   <PluginKnob label="Crossover" leftSubLabel="Low" rightSubLabel="High" value={get('cross',500)} min={100} max={2000} step={10} defaultValue={500} displayValue={`${Math.round(get('cross',500))} Hz`} isLogarithmic onChange={v=>update('cross',v)} />
   <PluginKnob label="Dry" leftSubLabel="0" rightSubLabel="100" value={get('dry',100)} min={0} max={100} step={1} defaultValue={100} displayValue={`${Math.round(get('dry',100))}%`} onChange={v=>update('dry',v)} />
   <PluginKnob label="Wet" leftSubLabel="0" rightSubLabel="100" value={get('wet',50)} min={0} max={100} step={1} defaultValue={50} displayValue={`${Math.round(get('wet',50))}%`} onChange={v=>update('wet',v)} />
   <PluginKnob label="Stereo" leftSubLabel="Narrow" rightSubLabel="Wide" value={get('sep',0)} min={-100} max={100} step={1} defaultValue={0} displayValue={`${get('sep',0)>0?'+':''}${Math.round(get('sep',0))}%`} onChange={v=>update('sep',v)} />
  </div>
  <div className="px-4 pb-4 flex justify-end"><div className="flex bg-[#101014] border border-[#333] rounded-full p-0.5"><button className={cn('h-7 px-4 rounded-full text-[9px] font-bold',get('mode',0)===0?'bg-[#c084fc] text-black':'text-[#777]')} onClick={()=>update('mode',0)}>Stereo</button><button className={cn('h-7 px-4 rounded-full text-[9px] font-bold',get('mode',0)===1?'bg-[#c084fc] text-black':'text-[#777]')} onClick={()=>update('mode',1)}>Side</button></div></div>
 </PluginFrame>;
}
