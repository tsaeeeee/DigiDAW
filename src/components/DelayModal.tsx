import React from 'react';
import { EffectSlot } from '../types/daw';
import { cn } from '../lib/utils';
import { PluginFrame } from './PluginFrame';
import { PluginKnob } from './PluginKnob';

const DIVS=['1/32','1/16','1/8','1/4','1/2','1/1'];
interface Props { slot:EffectSlot; slotIndex:number; analyser?:any; isPlaying?:boolean; onUpdateParams:(slotIndex:number,bypassed:boolean,params:Record<string,number>)=>void; onClose:()=>void; zIndex?:number; onFocus?:()=>void; }
function IOSSwitch({on,label,onChange}:{on:boolean;label:string;onChange:()=>void}){return <button type="button" onClick={onChange} className="flex items-center gap-2 text-[9px] text-[#bbb]"><span>{label}</span><span className={cn('w-10 h-5 rounded-full p-0.5 transition-all',on?'bg-[#34d399]':'bg-[#34343d]')}><span className={cn('block w-4 h-4 bg-white rounded-full transition-transform',on?'translate-x-5':'translate-x-0')}/></span></button>}
export function DelayModal({slot,slotIndex,onUpdateParams,onClose,zIndex,onFocus}:Props){
 const p=slot.params||{}; const bypassed=!!slot.bypassed; const update=(k:string,v:number)=>onUpdateParams(slotIndex,bypassed,{...p,[k]:v});
 const get=(k:string,d:number)=>p[k]??d; const sync=get('syncMode',0)===1,ping=get('pingPong',0)===1;
 return <PluginFrame title="Dipantul" subtitle="Stereo delay" accent="#34d399" accent2="#86efac" width={620} bypassed={bypassed} onToggleBypass={()=>onUpdateParams(slotIndex,!bypassed,p)} onClose={onClose} zIndex={zIndex} onFocus={onFocus}>
  <div className="p-4 grid grid-cols-12 gap-3">
   <section className="col-span-4 rounded-xl border border-[#29322f] bg-[#171b1a] p-3"><div className="text-[9px] text-[#8a9a94] mb-3">Wet color</div><div className="grid grid-cols-2 gap-3 justify-items-center">
    <PluginKnob label="Wobble" leftSubLabel="Stable" rightSubLabel="Moving" value={get('mod',50)} min={0} max={100} step={1} defaultValue={50} displayValue={`${Math.round(get('mod',50))}%`} onChange={v=>update('mod',v)} />
    <PluginKnob label="Tone" leftSubLabel="Dark" rightSubLabel="Bright" value={get('tone',5)} min={1} max={10} step={0.1} defaultValue={5} displayValue={get('tone',5).toFixed(1)} onChange={v=>update('tone',v)} />
   </div><div className="mt-3 flex gap-2"><IOSSwitch label="Low cut" on={get('lowCut',0)===1} onChange={()=>update('lowCut',get('lowCut',0)===1?0:1)}/><IOSSwitch label="Drive" on={get('drive',0)===1} onChange={()=>update('drive',get('drive',0)===1?0:1)}/></div></section>
   <section className="col-span-5 rounded-xl border border-[#29322f] bg-[#171b1a] p-3"><div className="flex items-center justify-between mb-3"><div className="text-[9px] text-[#8a9a94]">Time and mix</div><IOSSwitch label={sync?'Tempo sync':'Milliseconds'} on={sync} onChange={()=>update('syncMode',sync?0:1)}/></div>
    <div className="flex justify-center">{sync?<div className="w-full"><div className="text-3xl text-center font-black text-[#34d399]">{DIVS[get('syncDivIndex',2)]||'1/8'}</div><div className="grid grid-cols-6 gap-1 mt-3">{DIVS.map((d,i)=><button key={d} onClick={()=>update('syncDivIndex',i)} className={cn('h-7 rounded text-[9px] border',get('syncDivIndex',2)===i?'bg-[#34d399] text-black border-transparent':'border-[#33403b] text-[#777]')}>{d}</button>)}</div></div>:<PluginKnob label="Time" leftSubLabel="10 ms" rightSubLabel="2 s" value={get('time',240)} min={10} max={2000} step={1} defaultValue={240} displayValue={`${Math.round(get('time',240))} ms`} size="xl" isLogarithmic onChange={v=>update('time',v)} />}</div>
    <div className="grid grid-cols-2 mt-3 gap-4 justify-items-center"><PluginKnob label="Wet mix" leftSubLabel="Dry" rightSubLabel="Wet" value={get('wetMix',50)} min={0} max={100} step={1} defaultValue={50} displayValue={`${Math.round(get('wetMix',50))}%`} size="sm" onChange={v=>update('wetMix',v)} /><PluginKnob label="Output" leftSubLabel="Down" rightSubLabel="Up" value={get('outGain',0)} min={-24} max={12} step={0.5} defaultValue={0} displayValue={`${get('outGain',0)>0?'+':''}${get('outGain',0).toFixed(1)} dB`} size="sm" onChange={v=>update('outGain',v)} /></div>
   </section>
   <section className="col-span-3 rounded-xl border border-[#29322f] bg-[#171b1a] p-3"><div className="text-[9px] text-[#8a9a94] mb-3">Repeats</div><div className="flex flex-col items-center gap-3"><PluginKnob label="Feedback" leftSubLabel="Short" rightSubLabel="Long" value={get('feedback',40)} min={0} max={94} step={1} defaultValue={40} displayValue={`${Math.round(get('feedback',40))}%`} onChange={v=>update('feedback',v)} /><PluginKnob label="Stereo offset" leftSubLabel="Left" rightSubLabel="Right" value={get('lrOffset',0)} min={-50} max={50} step={1} defaultValue={0} displayValue={`${get('lrOffset',0)>0?'+':''}${Math.round(get('lrOffset',0))}%`} onChange={v=>update('lrOffset',v)} /><IOSSwitch label="Ping-pong" on={ping} onChange={()=>update('pingPong',ping?0:1)}/></div></section>
  </div>
 </PluginFrame>;
}
