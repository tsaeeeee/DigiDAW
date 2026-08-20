import React, { useEffect, useState } from 'react';
import { EffectSlot } from '../types/daw';
import { DeEsserNode, DeEsserTelemetry } from '../dsp/deesser/DeEsserNode';
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

interface ActivityPoint {
  detectorDb: number;
  reductionDb: number;
}

const HISTORY_LENGTH = 64;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function buildActivityArea(history: ActivityPoint[], width: number, height: number) {
  if (history.length < 2) return '';
  const center = height / 2;
  const maxAmplitude = center - 8;
  const top: string[] = [];
  const bottom: string[] = [];

  history.forEach((point, index) => {
    const x = (index / Math.max(1, HISTORY_LENGTH - 1)) * width;
    const detector = clamp((point.detectorDb + 72) / 66, 0, 1);
    const reductionWeight = 1 - clamp(point.reductionDb / 18, 0, 0.72);
    const amplitude = Math.max(1.5, detector * maxAmplitude * reductionWeight);
    top.push(`${x.toFixed(1)},${(center - amplitude).toFixed(1)}`);
    bottom.unshift(`${x.toFixed(1)},${(center + amplitude).toFixed(1)}`);
  });

  return `M ${top.join(' L ')} L ${bottom.join(' L ')} Z`;
}

function buildReductionPath(history: ActivityPoint[], width: number, height: number) {
  if (history.length < 2) return '';
  return history.map((point, index) => {
    const x = (index / Math.max(1, HISTORY_LENGTH - 1)) * width;
    const normalized = clamp(point.reductionDb / 18, 0, 1);
    const y = 8 + normalized * (height - 16);
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

export function DeEsserModal({
  slot,
  slotIndex,
  onUpdateParams,
  onClose,
  zIndex,
  onFocus,
}: Props) {
  const params = slot.params || {};
  const bypassed = !!slot.bypassed;
  const get = (key: string, defaultValue: number) => params[key] ?? defaultValue;
  const update = (key: string, value: number) => {
    onUpdateParams(slotIndex, bypassed, { ...params, [key]: value });
  };

  const [telemetry, setTelemetry] = useState<DeEsserTelemetry>({
    reductionDb: 0,
    detectorDb: -120,
    backend: 'loading',
  });
  const [history, setHistory] = useState<ActivityPoint[]>(() =>
    Array.from({ length: HISTORY_LENGTH }, () => ({ detectorDb: -120, reductionDb: 0 })),
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = DeEsserNode.lastActiveInstance?.getTelemetry() || {
        reductionDb: 0,
        detectorDb: -120,
        backend: 'loading' as const,
      };
      setTelemetry(next);
      setHistory((previous) => [
        ...previous.slice(-(HISTORY_LENGTH - 1)),
        { detectorDb: next.detectorDb, reductionDb: next.reductionDb },
      ]);
    }, 45);
    return () => window.clearInterval(timer);
  }, []);

  const lowFreq = get('lowFreq', 4500);
  const highFreq = get('highFreq', 9500);
  const threshold = get('threshold', -28);
  const ratio = get('ratio', 6);
  const attack = get('attack', 3);
  const release = get('release', 80);
  const mode = get('mode', 0);
  const listen = get('listen', 0);

  const activityPath = buildActivityArea(history, 580, 128);
  const reductionPath = buildReductionPath(history, 580, 128);
  const reductionPercent = clamp(telemetry.reductionDb / 18, 0, 1) * 100;
  const detectorActive = telemetry.detectorDb > threshold;

  return (
    <PluginFrame
      title="Disser"
      subtitle="Dynamic sibilance control"
      accent="#22d3ee"
      accent2="#67e8f9"
      width={620}
      bypassed={bypassed}
      onToggleBypass={() => onUpdateParams(slotIndex, !bypassed, params)}
      onClose={onClose}
      zIndex={zIndex}
      onFocus={onFocus}
    >
      <div className="p-4 pb-3">
        <div className="overflow-hidden rounded-xl border border-[#28353a] bg-[#0d1215] shadow-inner">
          <div className="h-8 px-3 flex items-center justify-between border-b border-[#223138] bg-[#11191d]">
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full transition-all"
                style={{
                  backgroundColor: detectorActive ? '#22d3ee' : '#33434a',
                  boxShadow: detectorActive ? '0 0 9px rgba(34,211,238,0.75)' : 'none',
                }}
              />
              <span className="text-[9px] font-extrabold tracking-wider text-[#a7b6bc]">Sibilance activity</span>
            </div>
            <div className="flex items-center gap-4 text-[8px] font-bold tabular-nums">
              <span className="text-[#697a82]">{`${(lowFreq / 1000).toFixed(1)}–${(highFreq / 1000).toFixed(1)} kHz`}</span>
              <span style={{ color: '#67e8f9' }}>{`${telemetry.reductionDb.toFixed(1)} dB GR`}</span>
            </div>
          </div>

          <div className="relative h-[128px]">
            <svg viewBox="0 0 580 128" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
              <defs>
                <linearGradient id={`disser-activity-${slotIndex}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.48" />
                  <stop offset="50%" stopColor="#22d3ee" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.48" />
                </linearGradient>
              </defs>

              {[0.25, 0.5, 0.75].map((position) => (
                <line
                  key={position}
                  x1="0"
                  x2="580"
                  y1={128 * position}
                  y2={128 * position}
                  stroke="#1d3036"
                  strokeWidth="1"
                />
              ))}
              <line x1="0" x2="580" y1="64" y2="64" stroke="#31515b" strokeWidth="1" />

              {activityPath && (
                <path d={activityPath} fill={`url(#disser-activity-${slotIndex})`} stroke="#22d3ee" strokeWidth="1.25" />
              )}
              {reductionPath && (
                <path
                  d={reductionPath}
                  fill="none"
                  stroke="#a5f3fc"
                  strokeOpacity="0.8"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                />
              )}
            </svg>

            <div className="absolute left-3 bottom-2 flex gap-3 text-[8px] font-bold text-[#53646b]">
              <span>Detector</span>
              <span className="text-[#9fb0b6]">{telemetry.detectorDb > -100 ? `${telemetry.detectorDb.toFixed(1)} dB` : '—'}</span>
            </div>
            <div className="absolute right-3 bottom-2 text-[8px] font-bold text-[#53646b]">
              {telemetry.backend === 'worklet' ? 'Dynamic split engine' : telemetry.backend === 'native-fallback' ? 'Compatibility engine' : 'Loading DSP…'}
            </div>
          </div>

          <div className="h-1.5 bg-[#131c20]">
            <div
              className="h-full transition-[width] duration-75"
              style={{
                width: `${reductionPercent}%`,
                background: 'linear-gradient(90deg, #22d3ee, #67e8f9)',
                boxShadow: reductionPercent > 1 ? '0 0 8px rgba(34,211,238,0.55)' : 'none',
              }}
            />
          </div>
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="grid grid-cols-[150px_1fr_205px] gap-3 items-stretch">
          <div className="rounded-xl border border-[#292d32] bg-[#17191d] p-3 flex flex-col items-center justify-center">
            <div className="text-[8px] font-extrabold tracking-widest text-[#667078] mb-2">Control</div>
            <PluginKnob
              label="Reduction"
              leftSubLabel="Gentle"
              rightSubLabel="Firm"
              value={ratio}
              min={1}
              max={20}
              step={0.1}
              defaultValue={6}
              displayValue={`${ratio.toFixed(1)}:1`}
              size="lg"
              onChange={(value) => update('ratio', value)}
            />
          </div>

          <div className="rounded-xl border border-[#2a3a40] bg-gradient-to-b from-[#171e22] to-[#14171a] p-3 flex flex-col items-center justify-center shadow-[inset_0_0_22px_rgba(34,211,238,0.035)]">
            <div className="text-[8px] font-extrabold tracking-widest text-[#667078] mb-1">Main threshold</div>
            <PluginKnob
              label="Threshold"
              leftSubLabel="Sensitive"
              rightSubLabel="Selective"
              value={threshold}
              min={-60}
              max={-4}
              step={0.5}
              defaultValue={-28}
              displayValue={`${threshold.toFixed(1)} dB`}
              size="xl"
              onChange={(value) => update('threshold', value)}
            />
            <div className="mt-1 text-[8px] font-bold text-[#65747b]">
              Current reduction <span className="text-[#67e8f9]">{telemetry.reductionDb.toFixed(1)} dB</span>
            </div>
          </div>

          <div className="rounded-xl border border-[#292d32] bg-[#17191d] p-3 flex flex-col justify-between">
            <div>
              <div className="text-[8px] font-extrabold tracking-widest text-[#667078] text-center mb-1">Sibilance range</div>
              <div className="flex items-start justify-center gap-4">
                <PluginKnob
                  label="Range low"
                  leftSubLabel="2.5k"
                  rightSubLabel="10k"
                  value={lowFreq}
                  min={2500}
                  max={10000}
                  step={50}
                  defaultValue={4500}
                  displayValue={`${(lowFreq / 1000).toFixed(1)} kHz`}
                  size="sm"
                  isLogarithmic
                  onChange={(value) => update('lowFreq', Math.min(value, highFreq - 500))}
                />
                <PluginKnob
                  label="Range high"
                  leftSubLabel="3.5k"
                  rightSubLabel="16k"
                  value={highFreq}
                  min={3500}
                  max={16000}
                  step={50}
                  defaultValue={9500}
                  displayValue={`${(highFreq / 1000).toFixed(1)} kHz`}
                  size="sm"
                  isLogarithmic
                  onChange={(value) => update('highFreq', Math.max(value, lowFreq + 500))}
                />
              </div>
            </div>

            <PluginModeSwitch
              label="Mode"
              value={mode}
              options={[
                { value: 0, label: 'Split' },
                { value: 1, label: 'Wide' },
              ]}
              onChange={(value) => update('mode', value)}
              className="w-full mt-2"
            />
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-[#292d32] flex items-end justify-between gap-4">
          <div className="flex items-start gap-5 pl-2">
            <PluginKnob
              label="Attack"
              leftSubLabel="Fast"
              rightSubLabel="Slow"
              value={attack}
              min={0.5}
              max={50}
              step={0.1}
              defaultValue={3}
              displayValue={`${attack.toFixed(1)} ms`}
              size="sm"
              isLogarithmic
              onChange={(value) => update('attack', value)}
            />
            <PluginKnob
              label="Release"
              leftSubLabel="Fast"
              rightSubLabel="Slow"
              value={release}
              min={10}
              max={500}
              step={1}
              defaultValue={80}
              displayValue={`${Math.round(release)} ms`}
              size="sm"
              isLogarithmic
              onChange={(value) => update('release', value)}
            />
          </div>

          <PluginModeSwitch
            label="Monitor"
            value={listen}
            options={[
              { value: 0, label: 'Normal' },
              { value: 1, label: 'Listen' },
            ]}
            onChange={(value) => update('listen', value)}
            className="w-[190px]"
          />
        </div>
      </div>
    </PluginFrame>
  );
}
