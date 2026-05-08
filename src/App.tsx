import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, Plus, Sliders, Upload, Volume2, Mic, Activity, Clock, Trash2, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAudioEngine } from './hooks/useAudioEngine';
import { cn, formatTime } from './lib/utils';
import { Track } from './types/daw';

const SNAP_THRESHOLD_PX = 12;
const MIN_ZOOM = 10;
const MAX_ZOOM = 500;

export default function App() {
  const audio = useAudioEngine();
  const [showMixer, setShowMixer] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [zoom, setZoom] = useState(50); // PX_PER_SECOND
  const [snapIndicator, setSnapIndicator] = useState<{ time: number, type: 'head' | 'tail' | 'grid' } | null>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  const canAddTrack = audio.tracks.length < 50;

  const getSnapPoints = React.useCallback((excludeClipId: string): number[] => {
    const points: number[] = [0, audio.currentTime];
    for (const track of audio.tracks) {
      for (const clip of track.clips) {
        if (clip.id === excludeClipId) continue;
        points.push(clip.startTime);
        points.push(clip.startTime + clip.duration);
      }
    }
    return points;
  }, [audio.tracks, audio.currentTime]);

  // Calculate dynamic timeline duration based on longest clip
  const maxTrackTime = audio.tracks.reduce((max, track) => {
    const trackMax = track.clips.reduce((tMax, clip) => Math.max(tMax, clip.startTime + clip.duration), 0);
    return Math.max(max, trackMax);
  }, 0);

  // Minimum visible duration of 30 seconds, expands with content and playhead
  const timelineDuration = Math.max(30, maxTrackTime + 10, audio.currentTime + 10);
  const timelineWidth = timelineDuration * zoom;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        audio.togglePlay();
      } else if (e.code === 'KeyM') {
        setShowMixer(prev => !prev);
      } else if (e.code === 'KeyS' && !e.metaKey && !e.ctrlKey) {
        // Toggle snapping unless it's a save shortcut
        setSnapEnabled(prev => !prev);
      } else if (e.code === 'KeyX') {
        audio.stop();
      } else if (e.code === 'KeyT' && canAddTrack) {
        audio.addTrack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [audio, canAddTrack]);

  const handleDeleteTrack = (id: string) => {
    audio.removeTrack(id);
  };

  if (!audio.isInitialized) {
    return (
      <div className="h-screen w-screen bg-[#151619] flex flex-col items-center justify-center text-white font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-4"
        >
          {/* Replace this SVG block with your own SVG code */}
          <div className="w-16 h-16 mx-auto text-[#ffd900] animate-pulse">
            <svg 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
              className="w-full h-full"
            >
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold tracking-tight uppercase">DigiDAW</h1>
          <p className="text-[#8e9299] max-w-xs mx-auto">Creative Linear Workflow Web DAW</p>
          <button 
            onClick={() => audio.init()}
            className="mt-8 px-8 py-3 bg-[#ffd900] hover:bg-[#ffd900]/80 transition-colors rounded-full font-bold uppercase tracking-widest text-sm text-black"
          >
            Launch
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-[#121212] text-[#e0e0e0] flex flex-col overflow-hidden font-sans select-none text-[11px]">
      {/* 1. Header / Transport */}
      <header className="h-[48px] border-b border-[#333] bg-[#2a2a2a] flex items-center px-4 gap-6 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 mr-2 group">
            {/* Replace this SVG block with your brand icon SVG */}
            <div className="w-5 h-5 text-[#ffd900]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-full h-full">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            </div>
            <span className="text-[#ffd900] font-display font-black text-lg tracking-tighter">DigiDAW</span>
          </div>
          
          <div className="flex items-center gap-1.5">
            <TransportButton 
              onClick={audio.stop} 
              icon={<Square className="w-3 h-3 fill-current" />} 
              active={false}
              label="Stop"
            />
            <TransportButton 
              onClick={audio.togglePlay} 
              icon={audio.transportState === 'started' ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />} 
              active={audio.transportState === 'started'}
              label={audio.transportState === 'started' ? "Pause" : "Play"}
            />
          </div>
        </div>

        <div className="flex items-center gap-4 bg-black border border-[#444] rounded-sm px-4 py-1 font-lcd text-[#ffd900] text-sm tracking-widest shadow-inner min-w-[140px] justify-center">
          <span>{formatTime(audio.currentTime)}</span>
        </div>

        <div className="flex-1 flex items-center justify-center px-8">
          <div className="flex items-center gap-3 w-full max-w-[200px] group">
            <Clock className="w-3 h-3 text-[#666] group-hover:text-[#ffd900] transition-colors" />
            <input 
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              value={zoom}
              onChange={(e) => setZoom(parseInt(e.target.value))}
              className="flex-1 h-1 bg-[#333] rounded-full appearance-none cursor-pointer accent-[#ffd900]"
              title="Timeline Zoom"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowMixer(!showMixer)}
            title="Toggle Mixer"
            className={cn(
              "flex items-center justify-center w-8 h-7 rounded-sm transition-all border",
              showMixer 
                ? "bg-[#ffd900]/75 text-black border-[#ffd900]" 
                : "bg-[#3a3a3a] border-[#ffd900]/40 text-[#ffd900] hover:bg-[#ffd900]/75 hover:text-black hover:border-[#ffd900]"
            )}
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>
          
          <button 
            onClick={audio.addTrack}
            disabled={!canAddTrack}
            title={canAddTrack ? "Add Track" : "Track limit reached (50)"}
            className={cn(
              "flex items-center justify-center w-8 h-7 transition-all border rounded-sm",
              canAddTrack 
                ? "bg-[#3a3a3a] text-[#ffd900] border-[#ffd900]/40 hover:bg-[#ffd900]/75 hover:text-black hover:border-[#ffd900]" 
                : "bg-[#252525] text-[#555] border-[#333] cursor-not-allowed opacity-50"
            )}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          <button 
            onClick={() => setSnapEnabled(!snapEnabled)}
            title={`Toggle Snapping (${snapEnabled ? 'On' : 'Off'}) - Press 'S'`}
            className={cn(
              "flex items-center justify-center w-8 h-7 rounded-sm transition-all border",
              snapEnabled 
                ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/50 hover:bg-cyan-500/30" 
                : "bg-[#3a3a3a] border-[#444] text-[#8e9299] hover:bg-[#444]"
            )}
          >
            <Activity className={cn("w-3.5 h-3.5", snapEnabled && "animate-pulse")} />
          </button>

          <button 
            onClick={audio.renderAudio}
            disabled={audio.isRendering}
            title={audio.isRendering ? "Rendering..." : "Render Audio"}
            className={cn(
              "flex items-center justify-center w-8 h-7 bg-[#3a3a3a] hover:bg-[#ffd900]/75 text-[#ffd900] hover:text-black rounded-sm transition-all border border-[#ffd900]/40 hover:border-[#ffd900] disabled:opacity-50 disabled:cursor-wait",
              audio.isRendering && "animate-pulse border-[#ffd900]"
            )}
          >
            <Download className={cn("w-3.5 h-3.5", audio.isRendering && "animate-bounce")} />
          </button>
        </div>
      </header>

      {/* 2. Main Area: Timeline */}
      <main className="flex-1 overflow-hidden relative">
        <div
          ref={scrollContainerRef}
          className="absolute inset-0 overflow-auto bg-[#121212]"
        >
          <div
            className="flex relative"
            style={{ minHeight: '100%', minWidth: 220 + timelineWidth }}
          >
            {/* Track Headers — sticky left */}
            <div className="w-[220px] shrink-0 flex flex-col bg-[#151515] sticky left-0 z-40 border-r border-[#333]">
              {audio.tracks.map(track => (
                <TrackHeader
                  key={track.id}
                  track={track}
                  updateParams={audio.updateTrackParams}
                  onUpload={(file) => audio.uploadClip(track.id, file)}
                  onDelete={() => handleDeleteTrack(track.id)}
                  onRename={(name) => audio.updateTrackName(track.id, name)}
                />
              ))}
              <div className="flex-1 bg-[#121212]" />
            </div>

            {/* Timeline column — flex-1 + align-stretch guarantees full height */}
            <div
              id="timeline-column"
              className="relative flex-1 cursor-crosshair"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                audio.seek(x / zoom);
              }}
            >
              {/* Vertical grid lines — absolute, fills full timeline */}
              <div className="absolute inset-0 opacity-10 pointer-events-none z-0"
                style={{
                  backgroundImage: 'linear-gradient(90deg, #333 1px, transparent 1px)',
                  backgroundSize: `${zoom}px 100%`
                }}
              />

              {/* Track lanes */}
              {audio.tracks.map(track => (
                <div key={track.id}
                  className="h-[80px] border-b border-[#333] relative group z-10"
                >
                  {track.clips.map(clip => (
                    <AudioClipItem
                      key={clip.id}
                      clip={clip}
                      color={track.color}
                    onMove={(newStart) => audio.updateClipPosition(track.id, clip.id, newStart)}
                    getSnapPoints={() => getSnapPoints(clip.id)}
                    onSnapIndicator={setSnapIndicator}
                    snapEnabled={snapEnabled}
                    zoom={zoom}
                  />
                ))}
              </div>
            ))}

            {/* Snap indicator — only visible during drag */}
            {snapIndicator !== null && (
              <div
                className="absolute top-0 bottom-0 w-px bg-cyan-400/80 z-30 pointer-events-none shadow-[0_0_8px_rgba(34,211,238,0.6)]"
                style={{ left: `${snapIndicator.time * zoom}px` }}
              />
            )}

              {/* Playhead — absolute, spans full timeline height */}
              <div
                 className="absolute top-0 bottom-0 w-px bg-[#ffd900] z-30 pointer-events-none shadow-[0_0_10px_rgba(255,217,0,0.8)]"
                 style={{ left: `${audio.currentTime * zoom}px` }}
              >
                <div className="sticky top-0 py-1">
                  <div className="w-1.5 h-1.5 bg-[#ffd900] rounded-full -ml-[2.5px] -mt-1 shadow-[0_0_8px_rgba(255,217,0,0.6)] z-30" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 3. Mixer Area */}
      <AnimatePresence>
        {showMixer && (
          <motion.footer 
            initial={{ height: 0 }}
            animate={{ height: 470 }}
            exit={{ height: 0 }}
            className="border-t border-black bg-[#1e1e1e] flex overflow-x-auto z-50"
          >
            {audio.tracks.map(track => (
              <ChannelStrip 
                key={track.id} 
                track={track} 
                updateParams={audio.updateTrackParams}
                analyser={audio.analysers.get(track.id)}
              />
            ))}
            
            {/* Master Strip */}
            <ChannelStrip 
              track={audio.master}
              updateParams={audio.updateMasterParams}
              analyser={audio.masterAnalyser}
              isMaster={true}
            />

            <button 
              onClick={audio.addTrack}
              disabled={!canAddTrack}
              className={cn(
                "min-w-[80px] h-full border-l border-[#333] border-dashed flex flex-col items-center justify-center transition-opacity cursor-pointer group",
                canAddTrack ? "opacity-20 hover:opacity-50" : "opacity-5 cursor-not-allowed"
              )}
              title={canAddTrack ? "Add Track" : "Track limit reached (50)"}
            >
              <Plus className={cn("w-6 h-6", canAddTrack ? "text-[#ffd900]" : "text-[#555]")} />
            </button>
          </motion.footer>
        )}
      </AnimatePresence>
    </div>
  );
}

function TransportButton({ icon, onClick, active, label }: { icon: React.ReactNode, onClick: () => void, active: boolean, label: string }) {
  return (
    <button 
      onClick={onClick}
      title={label}
      className={cn(
        "w-8 h-7 flex items-center justify-center rounded-sm transition-all border",
        active 
          ? "bg-[#ffd900]/75 text-black border-[#ffd900]" 
          : "bg-[#3a3a3a] border-[#ffd900]/40 text-[#ffd900] hover:bg-[#ffd900]/75 hover:text-black hover:border-[#ffd900]"
      )}
    >
      {icon}
    </button>
  );
}

interface TrackHeaderProps {
  key?: React.Key;
  track: Track;
  updateParams: any;
  onUpload: (f: File) => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}

function TrackHeader({ track, updateParams, onUpload, onDelete, onRename }: TrackHeaderProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(track.name);

  return (
    <div className="h-[80px] border-b border-[#333] flex group bg-[#252525] transition-colors relative shrink-0">
      {/* Fixed color indicator on the far left */}
      <div className="w-1.5 shrink-0 h-full" style={{ backgroundColor: track.color }} />
      
      {/* Content with padding */}
      <div className="flex-1 flex flex-col justify-between p-2 pl-3">
        <div className="flex items-center justify-between">
          {isEditing ? (
            <input 
              autoFocus
              className="bg-black text-[11px] font-bold uppercase tracking-tight text-white px-1 rounded border border-[#3b82f6] outline-none w-full"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onBlur={() => { setIsEditing(false); onRename(tempName); }}
              onKeyDown={(e) => { if(e.key === 'Enter') { setIsEditing(false); onRename(tempName); } }}
            />
          ) : (
            <span 
              onDoubleClick={() => setIsEditing(true)}
              className="text-[11px] font-bold uppercase tracking-tight text-[#e0e0e0] truncate max-w-[120px] cursor-text"
            >
              {track.name}
            </span>
          )}
          <div className="flex items-center gap-1">
            <button 
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              className="p-1 hover:bg-[#3a3a3a] rounded text-[#999] hover:text-white transition-all opacity-40 group-hover:opacity-100"
              title="Upload Audio"
            >
              <Upload className="w-3 h-3" />
            </button>
            <button 
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1 hover:bg-red-500/20 rounded text-[#999] hover:text-red-500 transition-all opacity-40 group-hover:opacity-100 cursor-pointer relative z-[60]"
              title="Delete Track"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          <input 
            ref={fileInputRef} 
            type="file" 
            accept="audio/*" 
            className="hidden" 
            onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
          />
        </div>

        <div className="flex items-end gap-2">
          <div className="flex gap-1">
            <button 
              onClick={() => updateParams(track.id, { muted: !track.muted })}
              className={cn(
                "w-[22px] h-[22px] rounded-sm text-[9px] font-bold transition-all flex items-center justify-center border",
                track.muted ? "bg-[#facc15] text-black border-[#ca8a04]" : "bg-[#1a1a1a] text-[#8e9299] border-[#333]"
              )}
            >
              M
            </button>
            <button 
              onClick={() => updateParams(track.id, { soloed: !track.soloed })}
              className={cn(
                "w-[22px] h-[22px] rounded-sm text-[9px] font-bold transition-all flex items-center justify-center border",
                track.soloed ? "bg-[#fb923c] text-black border-[#ea580c]" : "bg-[#1a1a1a] text-[#8e9299] border-[#333]"
              )}
            >
              S
            </button>
          </div>
          <div className="flex-1 text-[9px] text-[#666] font-mono mb-1 truncate">
            Audio Channel
          </div>
        </div>
      </div>
    </div>
  );
}

interface AudioClipItemProps {
  key?: React.Key;
  clip: any;
  color: string;
  onMove: (newStartTime: number) => void;
  getSnapPoints: () => number[];
  onSnapIndicator: (snap: { time: number, type: 'head' | 'tail' | 'grid' } | null) => void;
  snapEnabled: boolean;
  zoom: number;
}

interface SnapResult {
  time: number;
  snappedAt: { time: number, type: 'head' | 'tail' | 'grid' } | null;
}

function applySnap(
  rawStartTime: number,
  _duration: number,
  points: number[],
  thresholdSeconds: number,
  snapEnabled: boolean,
  _grabOffsetSeconds: number
): SnapResult {
  if (!snapEnabled) return { time: rawStartTime, snappedAt: null };

  // Only the head (start edge) snaps. The cyan indicator therefore always
  // appears at the clip's left edge, never `duration` away.
  const allPoints = [...points];
  const gridInterval = 1;
  const gHead = Math.round(rawStartTime / gridInterval) * gridInterval;
  allPoints.push(gHead);

  let best: { time: number, delta: number } | null = null;
  for (const point of allPoints) {
    const delta = Math.abs(rawStartTime - point);
    if (delta < thresholdSeconds && (!best || delta < best.delta)) {
      best = { time: point, delta };
    }
  }

  if (!best) return { time: Math.max(0, rawStartTime), snappedAt: null };
  return {
    time: Math.max(0, best.time),
    snappedAt: { time: best.time, type: 'head' },
  };
}

function AudioClipItem({ clip, color, onMove, getSnapPoints, onSnapIndicator, snapEnabled, zoom }: AudioClipItemProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [visualStartTime, setVisualStartTime] = useState(clip.startTime);
  const isDragging = React.useRef(false);
  const startX = React.useRef(0);
  const startStartTime = React.useRef(0);

  useEffect(() => {
    setVisualStartTime(clip.startTime);
  }, [clip.startTime]);

  useEffect(() => {
    if (!canvasRef.current || !clip.buffer) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    const buffer = clip.buffer as AudioBuffer;
    const data = buffer.getChannelData(0);
    const step = Math.ceil(data.length / canvas.width);
    const amp = canvas.height / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.moveTo(0, amp);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;

    for (let i = 0; i < canvas.width; i++) {
      let min = 1.0;
      let max = -1.0;
      for (let j = 0; j < step; j++) {
        const datum = data[(i * step) + j];
        if (datum < min) min = datum;
        if (datum > max) max = datum;
      }
      ctx.moveTo(i, amp + (min * amp));
      ctx.lineTo(i, amp + (max * amp));
    }
    ctx.stroke();
  }, [clip.buffer, color]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    const timeline = document.getElementById('timeline-column');
    if (!timeline) return;
    const timelineRect = timeline.getBoundingClientRect();
    
    isDragging.current = true;
    
    // Use local coordinates relative to the timeline column itself.
    // This is immune to sidebar width, viewport position, and scroll offsets.
    const startXLocal = e.clientX - timelineRect.left;
    const startStartTimeVal = clip.startTime;
    startStartTime.current = startStartTimeVal;
    
    const grabOffsetSeconds = (startXLocal - (startStartTimeVal * zoom)) / zoom;

    // Include the clip's own starting position as a snap point
    const points = [...getSnapPoints(), startStartTimeVal];
    const thresholdSeconds = SNAP_THRESHOLD_PX / zoom;

    let didMove = false;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      
      const currentXLocal = moveEvent.clientX - timelineRect.left;
      const delta = (currentXLocal - startXLocal) / zoom;
      
      if (Math.abs(moveEvent.clientX - e.clientX) > 2) {
        didMove = true;
      }
      
      if (!didMove) return;
      
      const rawTime = Math.max(0, startStartTime.current + delta);
      // Snap during drag: when within threshold of a snap target, the clip
      // head visually locks onto the cyan line; outside, it follows the mouse.
      const { time, snappedAt } = applySnap(rawTime, clip.duration, points, thresholdSeconds, snapEnabled, grabOffsetSeconds);

      setVisualStartTime(time);
      onSnapIndicator(snappedAt);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      if (isDragging.current && didMove) {
        const currentXLocal = upEvent.clientX - timelineRect.left;
        const delta = (currentXLocal - startXLocal) / zoom;
        const rawTime = Math.max(0, startStartTime.current + delta);
        
        const { time } = applySnap(rawTime, clip.duration, points, thresholdSeconds, snapEnabled, grabOffsetSeconds);
        onMove(time);
        
        const suppressClick = (clickEvent: MouseEvent) => {
          clickEvent.stopPropagation();
          clickEvent.preventDefault();
          window.removeEventListener('click', suppressClick, true);
        };
        window.addEventListener('click', suppressClick, true);
      } else if (isDragging.current) {
        setVisualStartTime(clip.startTime);
      }
      isDragging.current = false;
      onSnapIndicator(null);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        "absolute top-1 bottom-1 rounded border overflow-hidden flex flex-col bg-black/40 cursor-grab active:cursor-grabbing hover:bg-black/60 transition-colors z-20 origin-left",
        isDragging.current && "opacity-80 border-white shadow-xl scale-[1.02]"
      )}
      style={{
        left: `${visualStartTime * zoom}px`,
        width: `${clip.duration * zoom}px`,
        borderColor: `${color}80`
      }}
      onMouseDown={handleMouseDown}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full opacity-60 pointer-events-none"
        width={clip.duration * zoom}
        height={60}
      />
      <div className="absolute inset-x-0 bottom-0 h-4 bg-black/40 flex items-center px-1 pointer-events-none">
        <span className="text-[8px] text-white/50 font-medium truncate">{clip.name}</span>
      </div>
    </motion.div>
  );
}

interface ChannelStripProps {
  key?: React.Key;
  track: any; // Can be Track or Master object
  updateParams: any;
  analyser?: any;
  isMaster?: boolean;
}

function ChannelStrip({ track, updateParams, analyser, isMaster }: ChannelStripProps) {
  const meterCanvasRef = React.useRef<HTMLCanvasElement>(null);

  const dbToLevel = (db: number) => {
    return Math.pow(Math.max(0, (db + 60) / 66), 1.5);
  };

  useEffect(() => {
    if (!analyser || !meterCanvasRef.current) return;
    const meterCtx = meterCanvasRef.current.getContext('2d')!;
    let frameId: number;

    const render = () => {
      if (!analyser) return;
      
      const meterData = analyser.meter.getValue();
      const meterLevels = Array.isArray(meterData) ? meterData : [meterData as number, meterData as number];
      
      // Vertical Stereo Level Meter Render
      const meterW = meterCanvasRef.current!.width;
      const meterH = meterCanvasRef.current!.height;
      meterCtx.clearRect(0, 0, meterW, meterH);
      meterCtx.fillStyle = '#111';
      meterCtx.fillRect(0, 0, meterW, meterH);
      
      const gradient = meterCtx.createLinearGradient(0, 0, 0, meterH);
      gradient.addColorStop(0, '#ef4444');
      gradient.addColorStop(0.2, '#facc15');
      gradient.addColorStop(0.5, '#22c55e');
      gradient.addColorStop(1, '#15803d');
      
      meterCtx.fillStyle = gradient;
      
      // Left and Right channels - Logarithmic scaling
      meterLevels.forEach((db, index) => {
        const level = dbToLevel(db);
        const h = level * meterH;
        const x = index * (meterW / 2);
        meterCtx.fillRect(x + 1, meterH - h, (meterW / 2) - 2, h);
      });

      frameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(frameId);
  }, [analyser]);

  const ticks = [6, 0, -3, -6, -12, -18, -24, -30, -40, -60];

  return (
    <div className={cn(
      "min-w-[100px] w-[100px] h-full border-r border-black flex flex-col p-1.5 items-center gap-1.5 relative shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]",
      isMaster ? "bg-[#3a351a] border-l-2 border-l-[#ffd900]/20" : "bg-[#2a2a2a]"
    )}>
      {!isMaster && (
        <label 
          className="absolute top-0 left-0 right-0 h-1 cursor-pointer hover:h-2 transition-all z-40" 
          style={{ backgroundColor: track.color }}
          title="Change Track Color"
        >
          <input 
            type="color" 
            className="sr-only" 
            value={track.color}
            onChange={(e) => updateParams(track.id, { color: e.target.value })}
          />
        </label>
      )}
      
      {/* Effect Rack */}
      <div className="w-full h-20 bg-[#151515] border border-black rounded-sm p-1 flex flex-col gap-0.5 mt-2 mb-4">
        {['Comp', 'EQ', 'Rev'].map(fx => (
          <div key={fx} className="h-4 bg-[#25262b] border border-[#333] text-[8px] flex items-center px-1 text-[#888] rounded-[1px] hover:bg-[#2c2d33] cursor-pointer transition-colors tracking-wide">{fx}</div>
        ))}
      </div>

      {/* Immersive Panning Slider */}
      <div className="w-full h-8 flex flex-col items-center justify-center relative mb-4 px-1">
        <div className="w-full h-4 bg-[#111] rounded-full border border-black/50 relative overflow-hidden flex items-center shadow-inner">
          <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-[#ffd900] -translate-x-1/2 z-0" />
          
          <input 
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={track.pan}
            onChange={(e) => updateParams(track.id, { pan: parseFloat(e.target.value) })}
            onDoubleClick={() => updateParams(track.id, { pan: 0 })}
            className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
          />
          
          <div 
            className="absolute top-0 bottom-0 z-10 transition-all duration-75"
            style={{ 
              left: track.pan < 0 ? `calc(50% + ${track.pan * 50}%)` : '50%',
              right: track.pan > 0 ? `calc(50% - ${track.pan * 50}%)` : '50%',
              backgroundColor: 'rgba(255, 217, 0, 0.3)',
              borderLeft: track.pan < 0 ? '1px solid #ffd900' : 'none',
              borderRight: track.pan > 0 ? '1px solid #ffd900' : 'none',
              boxShadow: track.pan !== 0 ? '0 0 10px rgba(255, 217, 0, 0.2)' : 'none'
            }}
          />
          

        </div>
        
        <div className="flex justify-between w-full px-1.5 mt-1">
          <span className="text-[6px] text-[#444] font-bold">L</span>
          <span className="text-[8px] font-mono font-bold text-[#ffd900]/80 leading-none">
            {track.pan === 0 ? 'C' : `${Math.abs(Math.round(track.pan * 100))}${track.pan < 0 ? 'L' : 'R'}`}
          </span>
          <span className="text-[6px] text-[#444] font-bold">R</span>
        </div>
      </div>

      {/* Main Control Section: Logic Style Fader & Meter */}
      <div className="flex-1 flex flex-col w-full py-2 px-1">
        {/* Numeric Volume Readout */}
        <div 
          className="w-full bg-[#111] border border-[#444] rounded-sm py-0.5 mb-3 flex items-center justify-center shadow-inner cursor-pointer"
          onDoubleClick={() => updateParams(track.id, { volume: 0 })}
        >
          <span className="text-[10px] font-mono text-[#ffd900] font-bold leading-none">
            {track.volume <= -59.5 ? '-∞' : track.volume.toFixed(1)}
          </span>
        </div>

        <div className="flex-1 flex justify-center relative min-h-0 mb-3">
          {/* Level Scale Ticks (Log Spaced) */}
          <div className="relative h-full w-6 pr-0.5 pointer-events-none">
            {ticks.map(val => (
              <div 
                key={val} 
                className={cn(
                  "absolute right-0 h-0 flex items-center justify-end text-[6px] font-mono",
                  val === 6 ? "text-[#ffd900]/60" : "text-[#444]"
                )}
                style={{ bottom: `${dbToLevel(val) * 100}%` }}
              >
                <span className="pr-0.5">{val > 0 ? `+${val}` : val}</span>
                <div className="w-0.5 h-[1px] bg-white/20" />
              </div>
            ))}
          </div>

          <div className="flex-1 flex gap-2 justify-center h-full">
            {/* Level Meter (Inline) */}
            <div className="h-full flex relative flex-1 max-w-[8px]">
              <canvas 
                ref={meterCanvasRef} 
                width={8} 
                height={210} 
                className="w-full h-full bg-black/60 rounded-sm border border-black/80" 
              />
            </div>

            {/* Fader Track & Thumb (Right) */}
            <div className="relative h-full flex justify-center group flex-1 max-w-[32px]">
              <div className="absolute inset-y-0 w-[2px] bg-black/80 rounded-full" />
              
              <input 
                type="range"
                min="-60"
                max="6"
                step="0.1"
                value={track.volume}
                onChange={(e) => updateParams(track.id, { volume: parseFloat(e.target.value) })}
                onDoubleClick={() => updateParams(track.id, { volume: 0 })}
                // @ts-ignore
                orient="vertical"
                style={{ 
                  WebkitAppearance: 'slider-vertical',
                  writingMode: 'bt-lr',
                  width: '32px',
                  height: '100%'
                } as any}
                className="absolute inset-0 w-full h-full opacity-0 cursor-ns-resize z-30 appearance-none select-none"
              />

              {/* Visual Fader Thumb (Logic Style) */}
              <div 
                className="absolute w-6 h-2 bg-gradient-to-b from-[#d1b376] via-[#f7e2a9] to-[#d1b376] border border-[#a38043] rounded-sm shadow-xl pointer-events-none z-20 flex flex-col items-center justify-center -translate-x-1/2 left-1/2 transition-shadow group-active:shadow-2xl"
                style={{ 
                  bottom: `calc(${dbToLevel(track.volume) * 100}% - 4px)`,
                }}
              >
                <div className="w-full h-[1px] bg-black/40" />
              </div>
              
              {/* Ticks on track - perfectly matched to scale and meter */}
              <div className="absolute inset-y-0 -left-1 w-1 pointer-events-none opacity-20">
                {ticks.map(val => (
                  <div 
                    key={val}
                    className="absolute left-0 w-full h-[1px] bg-white"
                    style={{ bottom: `${dbToLevel(val) * 100}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="w-full flex flex-col gap-1.5 pb-1">
        {!isMaster && (
          <div className="flex gap-1">
            <button 
              onClick={() => updateParams(track.id, { muted: !track.muted })}
               className={cn(
                "flex-1 h-6 rounded-sm text-[9px] font-bold transition-all border shadow-sm",
                track.muted ? "bg-[#facc15] text-black border-[#ca8a04]" : "bg-[#333] text-[#999] border-[#444]"
              )}
            >M</button>
            <button 
              onClick={() => updateParams(track.id, { soloed: !track.soloed })}
              className={cn(
                "flex-1 h-6 rounded-sm text-[9px] font-bold transition-all border shadow-sm",
                track.soloed ? "bg-[#fb923c] text-black border-[#ea580c]" : "bg-[#333] text-[#999] border-[#444]"
              )}
            >S</button>
          </div>
        )}
        <div className={cn(
          "h-6 w-full border border-black rounded-sm flex items-center justify-center",
          isMaster ? "bg-[#ffd900] text-black" : "bg-[#151515] text-[#e0e0e0]"
        )}>
            <span className="text-[9px] font-bold truncate px-1 uppercase tracking-tighter">{track.name}</span>
        </div>
      </div>
    </div>
  );
}
