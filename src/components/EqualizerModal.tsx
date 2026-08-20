import React, { useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import { EffectSlot } from '../types/daw';
import { cn } from '../lib/utils';
import { PluginFrame } from './PluginFrame';
import { PluginKnob } from './PluginKnob';

type FilterShape='peaking'|'highpass'|'lowpass'|'lowshelf'|'highshelf';
interface Band { id:number; type:FilterShape; freq:number; gain:number; q:number; bypass:boolean; color:string; }
interface Props { slot:EffectSlot; slotIndex:number; analyser?:any; isPlaying?:boolean; onUpdateParams:(slotIndex:number,bypassed:boolean,params:Record<string,number>)=>void; onClose:()=>void; zIndex?:number; onFocus?:()=>void; }
const TYPES:FilterShape[]=['peaking','highpass','lowpass','lowshelf','highshelf'];
const COLORS=['#38bdf8','#60a5fa','#22d3ee','#818cf8','#0ea5e9'];
const DEF:Band[]=[
 {id:1,type:'highpass',freq:40,gain:0,q:.707,bypass:false,color:COLORS[0]},
 {id:2,type:'peaking',freq:250,gain:0,q:1,bypass:false,color:COLORS[1]},
 {id:3,type:'peaking',freq:1000,gain:0,q:1,bypass:false,color:COLORS[2]},
 {id:4,type:'peaking',freq:4000,gain:0,q:1,bypass:false,color:COLORS[3]},
 {id:5,type:'lowpass',freq:15000,gain:0,q:.707,bypass:false,color:COLORS[4]},
];
const iconPath=(type:FilterShape)=>{
 if(type==='highpass') return 'M3 20 C7 20 8 8 13 6 H29';
 if(type==='lowpass') return 'M3 6 H19 C24 7 25 20 29 20';
 if(type==='lowshelf') return 'M3 19 H11 C14 19 15 8 20 7 H29';
 if(type==='highshelf') return 'M3 7 H12 C17 8 18 19 21 19 H29';
 return 'M3 14 C8 14 8 5 16 5 C24 5 24 14 29 14';
};
const freqToX=(f:number,w:number)=>(Math.log10(Math.max(20,Math.min(20000,f)))-Math.log10(20))/(Math.log10(20000)-Math.log10(20))*w;
const dbToY=(db:number,h:number)=>h*(1-(Math.max(-18,Math.min(18,db))+18)/36);
export function EqualizerModal({slot,slotIndex,analyser,isPlaying,onUpdateParams,onClose,zIndex,onFocus}:Props){
 const bypassed=!!slot.bypassed; const canvasRef=useRef<HTMLCanvasElement>(null); const [active,setActive]=useState(1);
 const [bands,setBands]=useState<Band[]>(()=>DEF.map((d,i)=>{const p:any=slot.params||{};const id=i+1;return {...d,type:(typeof p[`b${id}_type_str`]==='string'?p[`b${id}_type_str`]:TYPES[p[`b${id}_type`]])||d.type,freq:p[`b${id}_freq`]??d.freq,gain:p[`b${id}_gain`]??d.gain,q:p[`b${id}_q`]??d.q,bypass:p[`b${id}_bypass`]===1};}));
 const push=(next:Band[])=>{const params:Record<string,any>={};next.forEach(b=>{params[`b${b.id}_type`]=Math.max(0,TYPES.indexOf(b.type));params[`b${b.id}_type_str`]=b.type;params[`b${b.id}_freq`]=b.freq;params[`b${b.id}_gain`]=b.gain;params[`b${b.id}_q`]=b.q;params[`b${b.id}_bypass`]=b.bypass?1:0;});onUpdateParams(slotIndex,bypassed,params as Record<string,number>);};
 const update=(id:number,ch:Partial<Band>)=>{const n=bands.map(b=>b.id===id?{...b,...ch}:b);setBands(n);push(n);};
 useEffect(()=>{const c=canvasRef.current;if(!c)return;const ctx=c.getContext('2d');if(!ctx)return;let frame=0;let raw:AudioContext|null=null;try{raw=Tone.getContext().rawContext as AudioContext;}catch{}const filters=raw?bands.map(()=>raw!.createBiquadFilter()):[];const points=180;const freqs=new Float32Array(points),mag=new Float32Array(points),phase=new Float32Array(points),combined=new Float32Array(points);for(let i=0;i<points;i++)freqs[i]=20*Math.pow(1000,i/(points-1));const draw=()=>{const w=c.width,h=c.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#0d1117';ctx.fillRect(0,0,w,h);for(const f of [20,50,100,200,500,1000,2000,5000,10000,20000]){const x=freqToX(f,w);ctx.strokeStyle='#18202a';ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}for(const db of [12,6,0,-6,-12]){const y=dbToY(db,h);ctx.strokeStyle=db===0?'#27364a':'#171d27';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
 if(analyser?.fft&&isPlaying){try{const fft=analyser.fft.getValue();const ny=(Tone.getContext().sampleRate||44100)/2;ctx.beginPath();ctx.moveTo(0,h);for(let i=0;i<180;i++){const x=i/179*w;const f=20*Math.pow(1000,i/179);const bin=Math.min(fft.length-1,Math.max(0,Math.round(f/ny*(fft.length-1))));const db=Number(fft[bin])||-100;const y=h-Math.max(0,Math.min(1,(db+80)/80))*h*.72;ctx.lineTo(x,y);}ctx.lineTo(w,h);ctx.closePath();ctx.fillStyle='rgba(56,189,248,.10)';ctx.fill();}catch{}}
 combined.fill(1);if(!bypassed&&raw){bands.forEach((b,bi)=>{if(b.bypass)return;const f=filters[bi];f.type=b.type;f.frequency.value=b.freq;f.gain.value=b.gain;f.Q.value=b.q;f.getFrequencyResponse(freqs,mag,phase);for(let i=0;i<points;i++)combined[i]*=mag[i];});}ctx.beginPath();for(let i=0;i<points;i++){const x=i/(points-1)*w;const db=Math.max(-18,Math.min(18,20*Math.log10(Math.max(1e-6,combined[i]))));const y=dbToY(db,h);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.strokeStyle=bypassed?'#666':'#38bdf8';ctx.lineWidth=2;ctx.stroke();bands.forEach(b=>{const x=freqToX(b.freq,w),y=dbToY(b.type==='highpass'||b.type==='lowpass'?0:b.gain,h);ctx.beginPath();ctx.arc(x,y,b.id===active?10:8,0,Math.PI*2);ctx.fillStyle=b.color;ctx.globalAlpha=b.bypass?.3:.85;ctx.fill();ctx.globalAlpha=1;ctx.fillStyle='#071018';ctx.font='bold 9px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(b.id),x,y);});frame=requestAnimationFrame(draw);};draw();return()=>{cancelAnimationFrame(frame);filters.forEach(f=>{try{f.disconnect();}catch{}});};},[bands,bypassed,active,analyser,isPlaying]);
 const b=bands[active-1]; const gainDisabled=b.type==='highpass'||b.type==='lowpass';
 return <PluginFrame title="Diequ" subtitle="Five-band equalizer" accent="#38bdf8" accent2="#60a5fa" width={680} bypassed={bypassed} onToggleBypass={()=>onUpdateParams(slotIndex,!bypassed,slot.params||{})} onClose={onClose} zIndex={zIndex} onFocus={onFocus}>
  <div className="p-4"><canvas ref={canvasRef} width={648} height={210} className="w-full h-[210px] rounded-lg border border-[#263446] bg-[#0d1117]"/>
   <div className="mt-3 flex gap-1">{bands.map(x=><button key={x.id} onClick={()=>setActive(x.id)} className={cn('flex-1 h-7 rounded border text-[9px] font-bold',active===x.id?'bg-[#38bdf8] text-black border-transparent':'border-[#334155] text-[#7d8da3]')}>Band {x.id}</button>)}</div>
   <div className="mt-3 grid grid-cols-12 gap-4 items-center"><div className="col-span-4"><div className="text-[9px] text-[#777] mb-1.5">Filter shape</div><div className="grid grid-cols-5 gap-1">{TYPES.map(t=><button key={t} title={t} onClick={()=>update(b.id,{type:t,gain:t==='highpass'||t==='lowpass'?0:b.gain})} className={cn('h-9 rounded border flex items-center justify-center',b.type===t?'bg-[#38bdf8] text-black border-transparent':'border-[#334155] text-[#7d8da3]')}><svg viewBox="0 0 32 26" className="w-6 h-5" fill="none" stroke="currentColor" strokeWidth="2"><path d={iconPath(t)} /></svg></button>)}</div></div>
    <div className="col-span-8 grid grid-cols-4 gap-3 justify-items-center"><PluginKnob label="Frequency" leftSubLabel="20" rightSubLabel="20k" value={b.freq} min={20} max={20000} step={1} defaultValue={DEF[b.id-1].freq} displayValue={b.freq>=1000?`${(b.freq/1000).toFixed(2)} kHz`:`${Math.round(b.freq)} Hz`} isLogarithmic onChange={v=>update(b.id,{freq:v})}/><PluginKnob label="Gain" leftSubLabel="Cut" rightSubLabel="Boost" value={b.gain} min={-18} max={18} step={0.1} defaultValue={0} displayValue={gainDisabled?'N/A':`${b.gain>0?'+':''}${b.gain.toFixed(1)} dB`} disabled={gainDisabled} onChange={v=>update(b.id,{gain:v})}/><PluginKnob label="Q" leftSubLabel="Wide" rightSubLabel="Narrow" value={b.q} min={0.1} max={18} step={0.1} defaultValue={1} displayValue={b.q.toFixed(1)} isLogarithmic onChange={v=>update(b.id,{q:v})}/><button onClick={()=>update(b.id,{bypass:!b.bypass})} className={cn('self-center h-8 px-3 rounded-full border text-[9px] font-bold',b.bypass?'border-[#38bdf8] text-[#38bdf8]':'border-[#344154] text-[#777]')}>Band {b.bypass?'off':'on'}</button></div>
   </div>
  </div>
 </PluginFrame>;
}
