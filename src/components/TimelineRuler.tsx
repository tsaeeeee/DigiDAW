import React from 'react';

interface TimelineRulerProps {
  timelineDuration: number;
  zoom: number; // pixels per second
  bpm: number;
  currentTime: number;
  onSeek: (time: number) => void;
}

export function TimelineRuler({
  timelineDuration,
  zoom,
  bpm,
  currentTime,
  onSeek,
}: TimelineRulerProps) {
  const secondsPerBeat = 60 / bpm;
  const secondsPerBar = 4 * secondsPerBeat;
  const barWidthPx = secondsPerBar * zoom;
  const beatWidthPx = secondsPerBeat * zoom;

  const totalBars = Math.max(
    Math.ceil(timelineDuration / secondsPerBar) + 10,
    Math.ceil(4000 / barWidthPx)
  );
  const totalWidth = timelineDuration * zoom;

  // Adaptive label step: if bar width is small (< 30px), label every 2, 4, 8, or 16 bars
  let labelStepBars = 1;
  if (barWidthPx < 25) labelStepBars = 8;
  else if (barWidthPx < 50) labelStepBars = 4;
  else if (barWidthPx < 80) labelStepBars = 2;

  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const time = Math.max(0, x / zoom);
    onSeek(time);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    handleRulerClick(e);

    const container = e.currentTarget;
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = moveEvent.clientX - rect.left;
      const time = Math.max(0, x / zoom);
      onSeek(time);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const bars = [];
  for (let b = 0; b < totalBars; b++) {
    const barNum = b + 1;
    const barLeft = b * barWidthPx;

    const showLabel = (b % labelStepBars) === 0;

    bars.push(
      <div
        key={`bar-${b}`}
        className="absolute top-0 bottom-0 flex flex-col justify-between border-l border-[#555] pointer-events-none select-none"
        style={{ left: `${barLeft}px` }}
      >
        {/* Bar Label */}
        {showLabel && (
          <span className="text-[9px] font-mono font-bold text-[#aaa] pl-1 pt-0.5 leading-none">
            {barNum}
          </span>
        )}

        {/* Beats inside bar */}
        {barWidthPx >= 40 && (
          <div className="absolute top-0 bottom-0 left-0 right-0 pointer-events-none">
            {[1, 2, 3].map((beatIdx) => {
              const beatLeft = beatIdx * beatWidthPx;
              return (
                <div
                  key={`beat-${b}-${beatIdx}`}
                  className="absolute bottom-0 h-2 border-l border-[#3a3a3a]"
                  style={{ left: `${beatLeft}px` }}
                />
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      className="h-6 bg-[#18181c] border-b border-[#333] relative overflow-hidden cursor-pointer select-none group z-20 w-full min-w-full"
      style={{ minWidth: `${totalWidth}px` }}
      title="Click or drag to position playhead"
    >
      {bars}
    </div>
  );
}
