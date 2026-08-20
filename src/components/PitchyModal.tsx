import React, { useEffect, useState } from 'react';
import { EffectSlot } from '../types/daw';
import { cn } from '../lib/utils';
import { PitchyNode } from '../dsp/pitchy/PitchyNode';
import { PluginFrame } from './PluginFrame';
import { PluginKnob } from './PluginKnob';

interface Props { slot?:EffectSlot; slotIndex:number; analyser?:any; isPlaying?:boolean; onUpdateParams:(slotIndex:number,bypassed:boolean,params:Record<string,number>)=>void; onClose:()=>void; zIndex?:number; onFocus?:()=>void; }
export function PitchyModal({slot,slotIndex,onUpdateParams,onClose,zIndex,onFocus}:Props){
 const p=slot?.params||{}; const bypassed=!!slot?.bypassed; const update=(k:string,v:number)=>onUpdateParams(slotIndex,bypassed,{...p,[k]:v});
 const speed=p.speed??75,humanize=p.humanize??20,transition=p.transition??30,color=p.color??50,referenceHz=p.referenceHz??440,modeHQ=p.modeHQ??0;
 const [telemetry,setTelemetry]=useState({note:'—',cents:0,hz:0,targetHz:0,confidence:0,tracking:false});
 useEffect(()=>{const timer=window.setInterval(()=>{const node=PitchyNode.lastActiveInstance;if(!node)return;const t=node.getTelemetry();setTelemetry({note:t.isTracking?t.closestNoteName:'—',cents:t.centsDeviation,hz:t.detectedHz,targetHz:t.targetHz,confidence:t.confidence,tracking:t.isTracking});},50);return()=>window.clearInterval(timer);},[]);
 return <PluginFrame title="Ditune" subtitle="Vocal pitch correction" accent="#f472b6" accent2="#c084fc" width={640} bypassed={bypassed} onToggleBypass={()=>onUpdateParams(slotIndex,!bypassed,p)} onClose={onClose} zIndex={zIndex} onFocus={onFocus}>
  <div className="p-4 grid grid-cols-12 gap-4">
   <div className="col-span-5 rounded-xl border border-[#302533] bg-[#111116] p-4 flex flex-col items-center justify-center min-h-[245px]">
    <div className="text-[9px] text-[#777]">Detected note</div><div className="text-6xl font-black text-[#f9a8d4] mt-1">{telemetry.note}</div>
    <div className={cn('text-[10px] font-mono mt-1',telemetry.tracking?'text-[#f472b6]':'text-[#666]')}>{telemetry.tracking?`${telemetry.cents>=0?'+':''}${telemetry.cents} cents`:'Waiting for voice'}</div>
    <div className="mt-5 w-full grid grid-cols-3 gap-2 text-center text-[9px]"><div className="bg-[#19191f] rounded p-2"><div className="text-[#666]">Input</div><div>{telemetry.hz?`${telemetry.hz.toFixed(1)} Hz`:'—'}</div></div><div className="bg-[#19191f] rounded p-2"><div className="text-[#666]">Target</div><div>{telemetry.targetHz?`${telemetry.targetHz.toFixed(1)} Hz`:'—'}</div></div><div className="bg-[#19191f] rounded p-2"><div className="text-[#666]">Confidence</div><div>{Math.round(telemetry.confidence*100)}%</div></div></div>
   </div>
   <div className="col-span-7 grid grid-cols-3 gap-3 justify-items-center content-center">
    <PluginKnob label="Speed" leftSubLabel="Soft" rightSubLabel="Hard" value={speed} min={0} max={100} step={1} defaultValue={75} displayValue={`${Math.round(speed)}%`} size="lg" onChange={v=>update('speed',v)} />
    <PluginKnob label="Humanize" leftSubLabel="Tight" rightSubLabel="Loose" value={humanize} min={0} max={100} step={1} defaultValue={20} displayValue={`${Math.round(humanize)}%`} size="lg" onChange={v=>update('humanize',v)} />
    <PluginKnob label="Transition" leftSubLabel="Snap" rightSubLabel="Glide" value={transition} min={0} max={100} step={1} defaultValue={30} displayValue={`${Math.round(transition)}%`} size="lg" onChange={v=>update('transition',v)} />
    <PluginKnob label="Color" leftSubLabel="Dark" rightSubLabel="Bright" value={color} min={0} max={100} step={1} defaultValue={50} displayValue={`${Math.round(color)}%`} onChange={v=>update('color',v)} />
    <PluginKnob label="Reference" leftSubLabel="415" rightSubLabel="466" value={referenceHz} min={415} max={466} step={0.1} defaultValue={440} displayValue={`${referenceHz.toFixed(1)} Hz`} onChange={v=>update('referenceHz',v)} />
    <div className="self-center w-full"><div className="text-[9px] text-[#777] mb-1 text-center">Processing mode</div><div className="flex bg-[#101014] rounded-full border border-[#333] p-0.5"><button className={cn('flex-1 h-7 rounded-full text-[9px] font-bold',modeHQ===0?'bg-[#f472b6] text-black':'text-[#777]')} onClick={()=>update('modeHQ',0)}>Real time</button><button className={cn('flex-1 h-7 rounded-full text-[9px] font-bold',modeHQ===1?'bg-[#f472b6] text-black':'text-[#777]')} onClick={()=>update('modeHQ',1)}>HQ</button></div></div>
   </div>
  </div>
 </PluginFrame>;
}
