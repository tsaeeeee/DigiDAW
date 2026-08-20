import React from 'react';
import { cn } from '../lib/utils';

type ModeValue = string | number;

export interface PluginModeOption<T extends ModeValue = ModeValue> {
  value: T;
  label: string;
}

interface PluginModeSwitchProps<T extends ModeValue = ModeValue> {
  value: T;
  options: readonly PluginModeOption<T>[];
  onChange: (value: T) => void;
  label?: string;
  className?: string;
}

function sentenceCase(text: string) {
  if (!/[A-Za-z]/.test(text)) return text;
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * Shared segmented mode selector for DigiDAW plugins.
 * Visual language intentionally matches Diecho's original Wet field mode.
 */
export function PluginModeSwitch<T extends ModeValue>({
  value,
  options,
  onChange,
  label,
  className,
}: PluginModeSwitchProps<T>) {
  return (
    <div className={cn('w-full', className)}>
      {label && (
        <div className="text-[8px] text-[#666] font-black tracking-widest mb-1.5 text-center">
          {sentenceCase(label)}
        </div>
      )}
      <div className="flex p-0.5 rounded-full bg-[#101014] border border-[#2a2a34]">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                'flex-1 min-w-0 h-7 px-2 rounded-full text-[9px] font-extrabold tracking-wider transition-all truncate',
                active ? 'text-black' : 'text-[#777] hover:text-[#ccc]',
              )}
              style={active ? {
                backgroundImage: 'linear-gradient(to right, var(--plugin-accent, #f472b6), var(--plugin-accent-2, #e879f9))',
                boxShadow: '0 0 8px color-mix(in srgb, var(--plugin-accent, #f472b6) 38%, transparent)',
              } : undefined}
              title={sentenceCase(option.label)}
            >
              {sentenceCase(option.label)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
