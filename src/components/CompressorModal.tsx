import React from 'react';
import { EffectSlot } from '../types/daw';
import { PluginFrame } from './PluginFrame';
import { PluginKnob } from './PluginKnob';

interface Props {
  slot: EffectSlot; slotIndex: number; analyser?: any; isPlaying?: boolean;
  onUpdateParams: (slotIndex: number, bypassed: boolean, params: Record<string, number>) => void;
  onClose: () => void; zIndex?: number; onFocus?: () => void;
}

export function CompressorModal({ slot, slotIndex, onUpdateParams, onClose, zIndex, onFocus }: Props) {
  const p = slot.params || {}; const bypassed = !!slot.bypassed;
  const update = (key: string, value: number) => onUpdateParams(slotIndex, bypassed, { ...p, [key]: value });
  const threshold = p.threshold ?? -20, ratio = p.ratio ?? 4, attack = p.attack ?? 10, release = p.release ?? 100, output = p.output ?? 0;
  return <PluginFrame title="Dikompres" subtitle="Dynamic range control" accent="#fb923c" accent2="#fdba74" width={520} bypassed={bypassed} onToggleBypass={() => onUpdateParams(slotIndex, !bypassed, p)} onClose={onClose} zIndex={zIndex} onFocus={onFocus}>
    <div className="p-4 grid grid-cols-5 gap-3 justify-items-center">
      <PluginKnob label="Threshold" leftSubLabel="Low" rightSubLabel="High" value={threshold} min={-60} max={0} step={0.5} defaultValue={-20} displayValue={`${threshold.toFixed(1)} dB`} onChange={v => update('threshold', v)} />
      <PluginKnob label="Ratio" leftSubLabel="Soft" rightSubLabel="Hard" value={ratio} min={1} max={20} step={0.1} defaultValue={4} displayValue={`${ratio.toFixed(1)}:1`} onChange={v => update('ratio', v)} />
      <PluginKnob label="Attack" leftSubLabel="Fast" rightSubLabel="Slow" value={attack} min={0.1} max={200} step={0.1} defaultValue={10} displayValue={`${attack.toFixed(1)} ms`} isLogarithmic onChange={v => update('attack', v)} />
      <PluginKnob label="Release" leftSubLabel="Fast" rightSubLabel="Slow" value={release} min={10} max={1000} step={1} defaultValue={100} displayValue={`${Math.round(release)} ms`} isLogarithmic onChange={v => update('release', v)} />
      <PluginKnob label="Output" leftSubLabel="Down" rightSubLabel="Up" value={output} min={-24} max={24} step={0.5} defaultValue={0} displayValue={`${output > 0 ? '+' : ''}${output.toFixed(1)} dB`} onChange={v => update('output', v)} />
    </div>
  </PluginFrame>;
}
