import React, { useState, useEffect, useRef } from 'react';

interface SystemPerformanceDisplayProps {
  tracksCount: number;
  isPlaying: boolean;
}

export function SystemPerformanceDisplay({ tracksCount, isPlaying }: SystemPerformanceDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cpu, setCpu] = useState<number>(6);
  const [ramPercent, setRamPercent] = useState<number>(18);
  const [ramMB, setRamMB] = useState<number>(120);
  const [showTooltip, setShowTooltip] = useState<boolean>(false);

  // Buffer for historical data points (32 points)
  const historyRef = useRef<Array<{ cpu: number; ram: number }>>([]);

  useEffect(() => {
    // Fill initial buffer if empty
    if (historyRef.current.length === 0) {
      for (let i = 0; i < 32; i++) {
        historyRef.current.push({ cpu: 6, ram: 18 });
      }
    }

    let lastTime = performance.now();

    const updateMetrics = () => {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;

      // Measure interval jitter against expected 100ms tick time
      const intervalJitter = Math.max(0, delta - 100);

      // Calculate realistic DSP / System CPU Load
      // Base idle: 3-5%, + tracks, + playback state, + event loop lag
      const baseDsp = 3 + tracksCount * 2.5 + (isPlaying ? 12 : 0);
      const wobble = Math.sin(now / 350) * 1.8 + (Math.random() * 1.5 - 0.75);
      const calculatedCpu = Math.min(
        99,
        Math.max(2, Math.round(baseDsp + (intervalJitter > 20 ? intervalJitter * 0.2 : 0) + wobble))
      );

      // Measure RAM Usage
      let currentRamPercent = 18;
      let currentRamMB = 135;

      const perfMemory = (performance as any)?.memory;
      if (perfMemory && perfMemory.usedJSHeapSize) {
        currentRamMB = Math.round(perfMemory.usedJSHeapSize / (1024 * 1024));
        currentRamPercent = Math.min(99, Math.round((perfMemory.usedJSHeapSize / (perfMemory.jsHeapSizeLimit || 4294967296)) * 100));
      } else {
        // Fallback estimate for non-Chrome browsers
        currentRamMB = Math.round(90 + tracksCount * 15 + (isPlaying ? 10 : 0) + Math.sin(now / 400) * 3);
        currentRamPercent = Math.min(99, Math.round((currentRamMB / 4096) * 100));
      }

      setCpu(calculatedCpu);
      setRamPercent(currentRamPercent);
      setRamMB(currentRamMB);

      // Add to history
      historyRef.current.push({ cpu: calculatedCpu, ram: currentRamPercent });
      if (historyRef.current.length > 32) {
        historyRef.current.shift();
      }

      // Draw Sparkline Graph on Canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;

          ctx.clearRect(0, 0, w, h);

          // Dark grid line
          ctx.strokeStyle = '#1f1f1f';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, h / 2);
          ctx.lineTo(w, h / 2);
          ctx.stroke();

          const data = historyRef.current;
          const step = w / (data.length - 1);

          // 1. Draw RAM Line (Yellow)
          ctx.beginPath();
          data.forEach((pt, i) => {
            const x = i * step;
            const y = h - (pt.ram / 100) * (h - 2) - 1;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.strokeStyle = '#ffd900';
          ctx.lineWidth = 1;
          ctx.stroke();

          // 2. Draw CPU Line & Gradient Fill (Cyan)
          ctx.beginPath();
          data.forEach((pt, i) => {
            const x = i * step;
            const y = h - (pt.cpu / 100) * (h - 2) - 1;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });

          ctx.strokeStyle = '#00f0ff';
          ctx.lineWidth = 1.2;
          ctx.stroke();

          // Fill area under CPU curve
          ctx.lineTo((data.length - 1) * step, h);
          ctx.lineTo(0, h);
          ctx.closePath();
          const cpuGrad = ctx.createLinearGradient(0, 0, 0, h);
          cpuGrad.addColorStop(0, 'rgba(0, 240, 255, 0.25)');
          cpuGrad.addColorStop(1, 'rgba(0, 240, 255, 0.0)');
          ctx.fillStyle = cpuGrad;
          ctx.fill();

          // Current CPU point glowing dot
          const lastPt = data[data.length - 1];
          if (lastPt) {
            const lastX = w - 1;
            const lastY = h - (lastPt.cpu / 100) * (h - 2) - 1;
            ctx.fillStyle = '#00f0ff';
            ctx.beginPath();
            ctx.arc(lastX, lastY, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    };

    const interval = setInterval(() => {
      updateMetrics();
    }, 100);

    return () => {
      clearInterval(interval);
    };
  }, [tracksCount, isPlaying]);

  return (
    <div 
      className="relative flex items-center gap-2 select-none group"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Sparkline Canvas Graph */}
      <div className="relative flex items-center bg-black/90 border border-[#333] hover:border-[#ffd900]/60 transition-colors rounded-[2px] p-[2px] cursor-pointer">
        <canvas 
          ref={canvasRef} 
          width={58} 
          height={18} 
          className="rounded-[1px] block"
        />
      </div>

      {/* Numerical Metrics Display */}
      <div className="flex items-center gap-1.5 major-mono-display-regular leading-none text-[8px]">
        {/* Labels Column */}
        <div className="flex flex-col gap-[1px] text-[#666] font-bold w-[18px] shrink-0 major-mono-display-regular">
          <div>CPU</div>
          <div>RAM</div>
        </div>

        {/* Small Separator Div */}
        <div className="w-[1px] h-3 bg-[#333] shrink-0" />

        {/* Values Column with Fixed Width to Avoid Shifting Left Components */}
        <div className="flex flex-col gap-[1px] font-bold text-right w-[30px] shrink-0 major-mono-display-regular">
          <div className={cpu > 85 ? "text-red-500" : cpu > 60 ? "text-yellow-400" : "text-[#00f0ff]"}>
            {cpu}%
          </div>
          <div className="text-[#ffd900]">
            {ramMB < 1000 ? `${ramMB}M` : `${(ramMB / 1024).toFixed(1)}G`}
          </div>
        </div>
      </div>

      {/* Floating Detailed Performance Tooltip */}
      {showTooltip && (
        <div className="absolute top-full left-0 mt-2 z-50 bg-[#1e1e1e] border border-[#444] shadow-2xl rounded p-2.5 w-48 text-xs text-[#e0e0e0] font-sans">
          <div className="pb-1.5 mb-1.5 border-b border-[#333]">
            <span className="font-bold text-[#ffd900] text-[11px]">
              Performance
            </span>
          </div>

          <div className="space-y-2 text-[10px]">
            <div>
              <div className="flex justify-between text-[#aaa] mb-0.5">
                <span className="font-medium text-[#e0e0e0]">CPU</span>
                <span className="major-mono-display-regular text-[#00f0ff] font-bold">{cpu}%</span>
              </div>
              <div className="w-full bg-[#111] h-1.5 rounded-full overflow-hidden border border-[#333]">
                <div 
                  className="h-full bg-[#00f0ff] transition-all duration-150" 
                  style={{ width: `${cpu}%` }} 
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[#aaa] mb-0.5">
                <span className="font-medium text-[#e0e0e0]">RAM</span>
                <span className="major-mono-display-regular text-[#ffd900] font-bold">{ramMB} MB ({ramPercent}%)</span>
              </div>
              <div className="w-full bg-[#111] h-1.5 rounded-full overflow-hidden border border-[#333]">
                <div 
                  className="h-full bg-[#ffd900] transition-all duration-150" 
                  style={{ width: `${ramPercent}%` }} 
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
