import React, { useEffect, useState } from 'react';
import { EffectSlot } from '../types/daw';
import { Ditune2Node, Ditune2Telemetry } from '../dsp/ditune2/Ditune2Node';
import { PluginFrame } from './PluginFrame';
import { PluginKnob } from './PluginKnob';
import { PluginModeSwitch } from './PluginModeSwitch';

interface Props {
  slot: EffectSlot;
  slotIndex: number;
  analyser?: any;
  isPlaying?: boolean;
  onUpdateParams: (slotIndex: number, bypassed: boolean, params: Record<string, number>) => void;
  onClose: () => void;
  zIndex?: number;
  onFocus?: () => void;
}

const EMPTY: Ditune2Telemetry = {
  detectedHz: 0, targetHz: 0, confidence: 0, centsDeviation: 0,
  correctionCents: 0, targetMidi: 0, isTracking: false, backend: 'loading',
};
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiToName = (midi: number) => {
  if (!Number.isFinite(midi) || midi <= 0) return '—';
  const rounded = Math.round(midi);
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function Ditune2Modal({ slot, slotIndex, onUpdateParams, onClose, zIndex, onFocus }: Props) {
  const params = slot.params || {};
  const bypassed = !!slot.bypassed;
  const get = (key: string, fallback: number) => params[key] ?? fallback;
  const update = (key: string, value: number) => onUpdateParams(slotIndex, bypassed, { ...params, [key]: value });
  const referenceHz = get('referenceHz', 440);
  const speed = get('speed', 75);
  const humanize = get('humanize', 20);
  const transition = get('transition', 30);
  const color = get('color', 50);
  const modeHQ = get('modeHQ', 0);
  const [telemetry, setTelemetry] = useState<Ditune2Telemetry>(EMPTY);

  useEffect(() => {
    const timer = window.setInterval(() => setTelemetry(Ditune2Node.lastActiveInstance?.getTelemetry() || EMPTY), 45);
    return () => window.clearInterval(timer);
  }, []);

  const cents = clamp(telemetry.centsDeviation, -50, 50);
  const correction = clamp(telemetry.correctionCents, -175, 175);
  const note = telemetry.isTracking ? midiToName(telemetry.targetMidi) : '—';
  const backendLabel = telemetry.backend === 'wasm'
    ? 'C++ WASM • JUCE shared core'
    : telemetry.backend === 'passthrough'
      ? 'Transparent fallback • WASM unavailable'
      : 'Loading C++ core…';

  return (
    <PluginFrame
      title="Ditune2"
      subtitle="Experimental vocal tuner • shared C++ core / JUCE native twin"
      accent="#e879f9"
      accent2="#a78bfa"
      width={680}
      bypassed={bypassed}
      onToggleBypass={() => onUpdateParams(slotIndex, !bypassed, params)}
      onClose={onClose}
      zIndex={zIndex}
      onFocus={onFocus}
    >
      <div className="p-4">
        <div className="grid grid-cols-[300px_1fr] gap-4">
          <div className="rounded-2xl border border-[#422c4b] bg-gradient-to-br from-[#201724] to-[#111116] p-4">
            <div className="h-[250px] rounded-xl border border-[#302438] bg-[#0f0f14] flex flex-col items-center justify-center relative overflow-hidden">
              <div className="absolute w-44 h-44 rounded-full bg-fuchsia-500/10 blur-3xl" />
              <div className="relative text-[8px] font-black tracking-[0.24em] text-[#777381]">TARGET NOTE</div>
              <div className="relative mt-1 text-6xl font-black text-[#f5e9ff] drop-shadow-[0_0_16px_rgba(232,121,249,0.38)]">{note}</div>
              <div className="relative mt-1 text-[10px] font-mono font-bold" style={{ color: telemetry.isTracking ? '#e879f9' : '#666' }}>
                {telemetry.isTracking ? `${cents >= 0 ? '+' : ''}${cents.toFixed(1)} cents input` : 'WAITING FOR VOICE'}
              </div>

              <div className="relative mt-5 w-[220px]">
                <div className="h-2 rounded-full bg-[#26232c] relative">
                  <div className="absolute left-1/2 top-[-4px] h-4 w-px bg-[#e879f9]" />
                  <div className="absolute top-[-3px] h-3.5 w-3.5 rounded-full bg-[#e879f9] shadow-[0_0_10px_rgba(232,121,249,0.8)] transition-[left] duration-75" style={{ left: `calc(${50 + cents}% - 7px)` }} />
                </div>
                <div className="flex justify-between mt-1 text-[7px] font-mono text-[#5f5a66]"><span>-50</span><span>0</span><span>+50</span></div>
              </div>

              <div className="relative grid grid-cols-2 gap-2 mt-4 w-[250px] text-center">
                <div className="rounded-md border border-[#292531] bg-[#17151c] py-1.5"><div className="text-[7px] text-[#6d6873]">INPUT</div><div className="text-[10px] font-mono text-[#ddd]">{telemetry.detectedHz > 0 ? `${telemetry.detectedHz.toFixed(1)} Hz` : '—'}</div></div>
                <div className="rounded-md border border-[#292531] bg-[#17151c] py-1.5"><div className="text-[7px] text-[#6d6873]">TARGET</div><div className="text-[10px] font-mono text-[#ddd]">{telemetry.targetHz > 0 ? `${telemetry.targetHz.toFixed(1)} Hz` : '—'}</div></div>
                <div className="rounded-md border border-[#292531] bg-[#17151c] py-1.5"><div className="text-[7px] text-[#6d6873]">CORRECTION</div><div className="text-[10px] font-mono text-[#f0abfc]">{`${correction >= 0 ? '+' : ''}${correction.toFixed(1)} ct`}</div></div>
                <div className="rounded-md border border-[#292531] bg-[#17151c] py-1.5"><div className="text-[7px] text-[#6d6873]">CONFIDENCE</div><div className="text-[10px] font-mono text-[#ddd]">{`${Math.round(telemetry.confidence * 100)}%`}</div></div>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between text-[8px] font-bold">
              <span className={telemetry.backend === 'wasm' ? 'text-[#c4b5fd]' : telemetry.backend === 'passthrough' ? 'text-amber-300' : 'text-[#777]'}>{backendLabel}</span>
              <span className="text-[#625d69]">v0.1 pitch-sync</span>
            </div>
          </div>

          <div className="rounded-2xl border border-[#2d2b34] bg-[#17171b] p-4 flex flex-col justify-between">
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 justify-items-center">
              <PluginKnob label="SPEED" leftSubLabel="SOFT" rightSubLabel="HARD" value={speed} min={0} max={100} step={1} defaultValue={75} displayValue={`${Math.round(speed)}%`} size="lg" onChange={(v) => update('speed', v)} />
              <PluginKnob label="HUMANIZE" leftSubLabel="TIGHT" rightSubLabel="LOOSE" value={humanize} min={0} max={100} step={1} defaultValue={20} displayValue={`${Math.round(humanize)}%`} size="lg" onChange={(v) => update('humanize', v)} />
              <PluginKnob label="TRANSITION" leftSubLabel="SNAP" rightSubLabel="GLIDE" value={transition} min={0} max={100} step={1} defaultValue={30} displayValue={`${Math.round(transition)}%`} size="lg" onChange={(v) => update('transition', v)} />
              <PluginKnob label="COLOR" leftSubLabel="DARK" rightSubLabel="BRIGHT" value={color} min={0} max={100} step={1} defaultValue={50} displayValue={`${Math.round(color)}%`} size="lg" onChange={(v) => update('color', v)} />
            </div>
            <div className="mt-4 pt-3 border-t border-[#292731] flex items-end gap-4">
              <PluginKnob label="REFERENCE" leftSubLabel="415" rightSubLabel="466" value={referenceHz} min={415} max={466} step={0.1} defaultValue={440} displayValue={`${referenceHz.toFixed(1)}Hz`} size="sm" onChange={(v) => update('referenceHz', v)} />
              <PluginModeSwitch label="Processing mode" value={modeHQ} options={[{ value: 0, label: 'Real time' }, { value: 1, label: 'HQ' }]} onChange={(v) => update('modeHQ', v)} className="flex-1" />
            </div>
            <div className="mt-3 rounded-lg border border-[#30283a] bg-[#121116] px-3 py-2 text-[8px] leading-relaxed text-[#81798a]">
              <span className="font-black text-[#d8b4fe]">A/B engine:</span> Ditune2 does not reuse Ditune v1's shifter. Pitch detection, target tracking and pitch-synchronous resynthesis run inside the C++ core.
            </div>
          </div>
        </div>
      </div>
    </PluginFrame>
  );
}
