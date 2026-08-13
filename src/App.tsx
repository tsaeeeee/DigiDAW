import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, Plus, Sliders, Upload, Volume2, Mic, Activity, Clock, Trash2, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAudioEngine } from './hooks/useAudioEngine';
import { EffectRack } from './components/EffectRack';
import { SystemPerformanceDisplay } from './components/SystemPerformanceDisplay';
import { MetronomeBpmControl } from './components/MetronomeBpmControl';
import { TimelineRuler } from './components/TimelineRuler';
import { cn, formatTime, formatBarBeatTime } from './lib/utils';
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
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  const canAddTrack = audio.tracks.length < 25;

  const showToast = React.useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast(prev => (prev === msg ? null : prev));
    }, 3000);
  }, []);

  const handleNormalizeGain = React.useCallback(() => {
    let count = 0;
    let label = '';

    if (selectedClipId) {
      count = audio.normalizeGain([], [selectedClipId], -1);
      label = 'selected clip';
    } else if (selectedTrackId) {
      const track = audio.tracks.find(t => t.id === selectedTrackId);
      count = audio.normalizeGain([selectedTrackId], [], -1);
      label = track ? `track "${track.name}"` : 'selected track';
    } else {
      count = audio.normalizeGain([], [], -1);
      label = 'all tracks';
    }

    if (count > 0) {
      showToast(`Normalized ${label} (${count} clip${count > 1 ? 's' : ''}) to -1.0 dB peak`);
    } else {
      showToast(`No audio clip found to normalize in ${label}`);
    }
  }, [selectedClipId, selectedTrackId, audio, showToast]);

  // Calculate dynamic timeline duration based on longest clip
  const maxTrackTime = audio.tracks.reduce((max, track) => {
    const trackMax = track.clips.reduce((tMax, clip) => Math.max(tMax, clip.startTime + clip.duration), 0);
    return Math.max(max, trackMax);
  }, 0);

  // Minimum visible duration of 30 seconds, expands with content and playhead
  const timelineDuration = Math.max(30, maxTrackTime + 10, audio.currentTime + 10);
  const timelineWidth = timelineDuration * zoom;

  const getSnapPoints = React.useCallback((excludeClipId: string): number[] => {
    const points: number[] = [0, audio.currentTime];
    for (const track of audio.tracks) {
      for (const clip of track.clips) {
        if (clip.id === excludeClipId) continue;
        points.push(clip.startTime);
        points.push(clip.startTime + clip.duration);
      }
    }

    // Include beat grid snap points based on BPM
    const secondsPerBeat = 60 / audio.bpm;
    const totalBeats = Math.ceil(timelineDuration / secondsPerBeat);
    for (let b = 0; b <= totalBeats; b++) {
      points.push(b * secondsPerBeat);
    }

    return points;
  }, [audio.tracks, audio.currentTime, audio.bpm, timelineDuration]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G' || e.code === 'KeyG')) {
        e.preventDefault();
        handleNormalizeGain();
      } else if (e.code === 'Space') {
        e.preventDefault();
        audio.togglePlay();
      } else if (e.code === 'KeyM') {
        setShowMixer(prev => !prev);
      } else if (e.code === 'KeyC') {
        audio.toggleMetronome();
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
  }, [audio, canAddTrack, handleNormalizeGain]);

  const handleDeleteTrack = (id: string) => {
    audio.removeTrack(id);
    if (selectedTrackId === id) setSelectedTrackId(null);
  };

  if (!audio.isInitialized) {
    return (
      <div className="h-screen w-screen bg-[#151619] flex flex-col items-center justify-between py-12 px-6 text-white font-sans select-none">
        <div />
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-6 max-w-md"
        >
          <div className="w-20 h-20 mx-auto text-[#ffd900] animate-pulse">
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
          <div>
            <h1 className="text-3xl syncopate-regular font-normal tracking-tight text-white">DigiDAW</h1>
            <p className="text-[#8e9299] text-sm mt-2 font-medium">Professional Linear Audio Workstation for Mixing &amp; Mastering</p>
          </div>
          <button 
            onClick={() => audio.init()}
            className="mt-6 px-8 py-3.5 bg-[#ffd900] hover:bg-[#ffe55c] active:scale-95 transition-all rounded-full font-bold tracking-wider text-sm text-black shadow-lg shadow-[#ffd900]/20 cursor-pointer"
          >
            Launch
          </button>
        </motion.div>
        <div className="text-xs text-[#71717a] font-medium tracking-wide">
          Powered by Crescentials Record
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-[#121212] text-[#e0e0e0] flex flex-col overflow-hidden font-sans select-none text-[11px]">
      {/* 1. Header / Transport */}
      <header className="h-[48px] border-b border-[#2a2a2a] bg-[#1a1a1a] flex items-center px-4 gap-6 z-50">
        <div className="flex items-center gap-2 mr-2 group">
          {/* Replace this SVG block with your brand icon SVG */}
          <div className="w-5 h-5 text-[#ffd900]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-full h-full">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <span className="text-[#ffd900] syncopate-regular font-normal text-sm tracking-tight">DigiDAW</span>
        </div>

        <div className="flex items-center gap-3 bg-black rounded-sm px-3 py-1 text-[#ffd900] shadow-inner select-none">
          {/* 1. Transport controls including metronome */}
          <div className="flex items-center gap-1">
            <TransportButton 
              onClick={audio.stop} 
              icon={<Square className="w-3.5 h-3.5 fill-current shrink-0" />} 
              active={false}
              label="Stop (X)"
            />
            <TransportButton 
              onClick={audio.togglePlay} 
              icon={audio.transportState === 'started' ? <Pause className="w-3.5 h-3.5 fill-current shrink-0" /> : <Play className="w-3.5 h-3.5 fill-current shrink-0" />} 
              active={audio.transportState === 'started'}
              label={audio.transportState === 'started' ? "Pause (Space)" : "Play (Space)"}
            />
            <button
              type="button"
              onClick={audio.toggleMetronome}
              title={audio.metronomeEnabled ? "Turn Metronome Off (M)" : "Turn Metronome On (M)"}
              className={cn(
                "flex items-center justify-center p-1 rounded transition-all cursor-pointer border",
                audio.metronomeEnabled
                  ? "bg-[#ffd900] text-black border-[#ffd900] shadow-[0_0_8px_rgba(255,217,0,0.6)]"
                  : "bg-[#1f1f1f] text-[#888] border-[#333] hover:text-[#ffd900] hover:border-[#ffd900]/50"
              )}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 shrink-0">
                <path d="M12 2L4 22h16L12 2z" />
                <path d="M12 18l5-10" />
                <circle cx="17" cy="8" r="1.5" fill="currentColor" />
              </svg>
            </button>
          </div>

          <div className="w-[1px] h-4 bg-[#333]" />

          {/* 2. BPM Control */}
          <MetronomeBpmControl
            bpm={audio.bpm}
            onBpmChange={audio.setBpm}
            metronomeEnabled={audio.metronomeEnabled}
            onToggleMetronome={audio.toggleMetronome}
            currentBeat={audio.currentBeat}
            isPlaying={audio.transportState === 'started'}
            embedded
            hideToggle
          />

          <div className="w-[1px] h-4 bg-[#333]" />

          {/* 3. Timestamp */}
          <div className="flex flex-col items-center">
            <span className="text-xs font-bold tracking-widest major-mono-display-regular leading-none">{formatTime(audio.currentTime)}</span>
            <span className="text-[9px] tracking-wider text-[#aaa] major-mono-display-regular leading-none mt-0.5">{formatBarBeatTime(audio.currentTime, audio.bpm)}</span>
          </div>

          <div className="w-[1px] h-4 bg-[#333]" />

          {/* 4. Spectrum Audio Display */}
          <MiniAudioDisplay masterAnalyser={audio.masterAnalyser} isPlaying={audio.transportState === 'started'} />

          <div className="w-[1px] h-4 bg-[#333]" />

          {/* 5. Performance Display */}
          <SystemPerformanceDisplay tracksCount={audio.tracks.length} isPlaying={audio.transportState === 'started'} />
        </div>

        <div className="flex-1 flex items-center justify-center px-8">
          <div className="flex items-center gap-3 w-full max-w-[200px]">
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
            onClick={handleNormalizeGain}
            title="Normalize Gain to -1dB (Cmd+G / Ctrl+G)"
            className="flex items-center justify-center w-8 h-7 rounded-sm transition-all border bg-[#3a3a3a] border-[#ffd900]/40 text-[#ffd900] hover:bg-[#ffd900] hover:text-black hover:border-[#ffd900]"
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>

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
            title={canAddTrack ? "Add Track" : "Track limit reached (25)"}
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

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-14 left-1/2 -translate-x-1/2 z-[100] bg-[#1a1a1a] text-[#ffd900] border border-[#ffd900]/60 px-4 py-2 rounded-md shadow-2xl flex items-center gap-2 font-mono text-xs font-bold pointer-events-none"
          >
            <Volume2 className="w-4 h-4 text-[#ffd900] animate-pulse" />
            <span>{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>

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
              {/* Header Box aligned with Timeline Ruler */}
              <div 
                className="h-6 bg-[#1a1a1a] flex items-center justify-between px-3 text-[9px] font-mono font-bold text-[#888] select-none uppercase tracking-wider shrink-0"
                style={{ borderBottom: '0.7px solid #333' }}
              >
                <span>Tracks</span>
              </div>

              {audio.tracks.map(track => (
                <TrackHeader
                  key={track.id}
                  track={track}
                  isSelected={selectedTrackId === track.id}
                  onSelect={() => {
                    setSelectedTrackId(track.id);
                    setSelectedClipId(null);
                  }}
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
              className="relative flex-1 cursor-crosshair flex flex-col w-full min-w-full"
              style={{ minWidth: `${timelineWidth}px` }}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                audio.seek(x / zoom);
              }}
            >
              {/* Timeline Bar & Beat Ruler */}
              <TimelineRuler
                timelineDuration={timelineDuration}
                zoom={zoom}
                bpm={audio.bpm}
                currentTime={audio.currentTime}
                onSeek={audio.seek}
              />

              {/* Vertical Bar & Beat grid lines — absolute, fills full timeline */}
              <div
                className="absolute inset-0 pointer-events-none z-0"
                style={{
                  backgroundImage: `linear-gradient(90deg, rgba(255, 217, 0, 0.15) 0.7px, transparent 0.7px), linear-gradient(90deg, rgba(255, 255, 255, 0.05) 0.4px, transparent 0.4px)`,
                  backgroundSize: `${(240 / audio.bpm) * zoom}px 100%, ${(60 / audio.bpm) * zoom}px 100%`,
                }}
              />

              {/* Track lanes */}
              {audio.tracks.map(track => (
                <div 
                  key={track.id}
                  onClick={() => {
                    setSelectedTrackId(track.id);
                    setSelectedClipId(null);
                  }}
                  className={cn(
                    "h-[80px] relative group z-10 transition-colors",
                    selectedTrackId === track.id ? "bg-white/[0.02]" : ""
                  )}
                  style={{
                    borderBottom: selectedTrackId === track.id ? '0.7px solid rgba(255, 217, 0, 0.3)' : '0.7px solid #333'
                  }}
                >
                  {track.clips.map(clip => (
                    <AudioClipItem
                      key={clip.id}
                      clip={clip}
                      color={track.color}
                      isSelected={selectedClipId === clip.id}
                      onSelect={() => {
                        setSelectedClipId(clip.id);
                        setSelectedTrackId(track.id);
                      }}
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
                className="absolute top-0 bottom-0 bg-cyan-400/80 z-30 pointer-events-none shadow-[0_0_8px_rgba(34,211,238,0.6)]"
                style={{ left: `${snapIndicator.time * zoom}px`, width: '0.7px' }}
              />
            )}

              {/* Playhead — absolute, spans full timeline height */}
              <div
                 className="absolute top-0 bottom-0 bg-[#ffd900] z-30 pointer-events-none shadow-[0_0_10px_rgba(255,217,0,0.8)]"
                 style={{ left: `${audio.currentTime * zoom}px`, width: '0.7px' }}
              >
                <div className="sticky top-0">
                  <div className="w-2.5 h-2.5 bg-[#ffd900] rounded-full -ml-[4.65px] -mt-[5px] shadow-[0_0_8px_rgba(255,217,0,0.8)] border border-black/50 z-30" />
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
                updateEffect={(slotIndex, type, bypassed, params) => audio.updateTrackEffect(track.id, slotIndex, type, bypassed, params)}
                analyser={audio.analysers.get(track.id)}
                isPlaying={audio.transportState === 'started'}
              />
            ))}
            
            {/* Master Strip */}
            <ChannelStrip 
              track={audio.master}
              updateParams={audio.updateMasterParams}
              updateEffect={(slotIndex, type, bypassed, params) => audio.updateMasterEffect(slotIndex, type, bypassed, params)}
              analyser={audio.masterAnalyser}
              isMaster={true}
              isPlaying={audio.transportState === 'started'}
            />

            <button 
              onClick={audio.addTrack}
              disabled={!canAddTrack}
              className={cn(
                "min-w-[80px] h-full border-l border-[#333] border-dashed flex flex-col items-center justify-center transition-opacity cursor-pointer group",
                canAddTrack ? "opacity-20 hover:opacity-50" : "opacity-5 cursor-not-allowed"
              )}
              title={canAddTrack ? "Add Track" : "Track limit reached (25)"}
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
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "flex items-center justify-center p-1 rounded transition-all cursor-pointer border",
        active 
          ? "bg-[#ffd900] text-black border-[#ffd900] shadow-[0_0_8px_rgba(255,217,0,0.6)]" 
          : "bg-[#1f1f1f] text-[#888] border-[#333] hover:text-[#ffd900] hover:border-[#ffd900]/50"
      )}
    >
      {icon}
    </button>
  );
}

interface TrackHeaderProps {
  key?: React.Key;
  track: Track;
  isSelected?: boolean;
  onSelect?: () => void;
  updateParams: any;
  onUpload: (f: File) => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}

function TrackHeader({ track, isSelected, onSelect, updateParams, onUpload, onDelete, onRename }: TrackHeaderProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(track.name);

  return (
    <div 
      onClick={onSelect}
      className={cn(
        "h-[80px] flex group transition-all relative shrink-0 cursor-pointer",
        isSelected ? "bg-[#2d2a1d] shadow-[inset_0_0_10px_rgba(255,217,0,0.15)]" : "bg-[#252525] hover:bg-[#2a2a2a]"
      )}
      style={{
        borderBottom: isSelected ? '0.7px solid rgba(255, 217, 0, 0.8)' : '0.7px solid #333'
      }}
    >
      {/* Fixed color indicator on the far left */}
      <div className="w-1.5 shrink-0 h-full relative" style={{ backgroundColor: track.color }}>
        {isSelected && <div className="absolute inset-0 bg-[#ffd900] animate-pulse" />}
      </div>
      
      {/* Content with padding */}
      <div className="flex-1 flex flex-col justify-between p-2 pl-3">
        <div className="flex items-center justify-between">
          {isEditing ? (
            <input 
              autoFocus
              className="bg-black text-[11px] font-bold tracking-tight text-white px-1 rounded border border-[#3b82f6] outline-none w-full"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onBlur={() => { setIsEditing(false); onRename(tempName); }}
              onKeyDown={(e) => { if(e.key === 'Enter') { setIsEditing(false); onRename(tempName); } }}
            />
          ) : (
            <span 
              onDoubleClick={() => setIsEditing(true)}
              className={cn(
                "text-[11px] font-bold tracking-tight truncate max-w-[120px] cursor-text kumbh-sans",
                isSelected ? "text-[#ffd900]" : "text-[#e0e0e0]"
              )}
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
              onClick={(e) => { e.stopPropagation(); updateParams(track.id, { muted: !track.muted }); }}
              className={cn(
                "w-[22px] h-[22px] rounded-sm text-[9px] font-bold transition-all flex items-center justify-center border",
                track.muted ? "bg-[#facc15] text-black border-[#ca8a04]" : "bg-[#1a1a1a] text-[#8e9299] border-[#333]"
              )}
            >
              M
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); updateParams(track.id, { soloed: !track.soloed }); }}
              className={cn(
                "w-[22px] h-[22px] rounded-sm text-[9px] font-bold transition-all flex items-center justify-center border",
                track.soloed ? "bg-[#fb923c] text-black border-[#ea580c]" : "bg-[#1a1a1a] text-[#8e9299] border-[#333]"
              )}
            >
              S
            </button>
          </div>
          <div className="flex-1 text-[9px] text-[#666] font-mono mb-1 truncate flex items-center justify-between">
            <span>Audio Channel</span>
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
  isSelected?: boolean;
  onSelect?: () => void;
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

function AudioClipItem({ clip, color, isSelected, onSelect, onMove, getSnapPoints, onSnapIndicator, snapEnabled, zoom }: AudioClipItemProps) {
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
    ctx.strokeStyle = isSelected ? '#ffd900' : color;
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
  }, [clip.buffer, color, isSelected]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.();
    
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
        "absolute top-1 bottom-1 rounded border overflow-hidden flex flex-col bg-black/40 cursor-grab active:cursor-grabbing hover:bg-black/60 transition-colors z-20 origin-left select-none",
        isDragging.current && "opacity-80 border-white shadow-xl scale-[1.02]",
        isSelected && "border-[#ffd900] ring-2 ring-[#ffd900]/70 shadow-[0_0_12px_rgba(255,217,0,0.5)] z-30"
      )}
      style={{
        left: `${visualStartTime * zoom}px`,
        width: `${clip.duration * zoom}px`,
        borderColor: isSelected ? '#ffd900' : `${color}80`
      }}
      onMouseDown={handleMouseDown}
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        onSelect?.();
      }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full opacity-70 pointer-events-none"
        width={clip.duration * zoom}
        height={60}
      />
      <div className={cn(
        "absolute inset-x-0 bottom-0 h-4 flex items-center justify-between px-1 pointer-events-none transition-colors",
        isSelected ? "bg-[#ffd900]/20 font-bold" : "bg-black/40"
      )}>
        <span className={cn("text-[8px] font-medium truncate", isSelected ? "text-[#ffd900]" : "text-white/50")}>
          {clip.name}
        </span>
      </div>
    </motion.div>
  );
}

interface ChannelStripProps {
  key?: React.Key;
  track: any; // Can be Track or Master object
  updateParams: any;
  updateEffect: (slotIndex: number, type: any, bypassed?: boolean, params?: Record<string, number>) => void;
  analyser?: any;
  isMaster?: boolean;
  isPlaying?: boolean;
}

function ChannelStrip({ track, updateParams, updateEffect, analyser, isMaster, isPlaying }: ChannelStripProps) {
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
      const colW = Math.floor((meterW - 1) / 2);
      
      const dbL = meterLevels[0] !== undefined ? meterLevels[0] : -100;
      const dbR = meterLevels[1] !== undefined ? meterLevels[1] : dbL;

      const levelL = dbToLevel(dbL);
      const levelR = dbToLevel(dbR);

      const hL = levelL * meterH;
      const hR = levelR * meterH;

      // Draw Left channel (x: 0 to colW)
      meterCtx.fillRect(0, meterH - hL, colW, hL);

      // Draw Right channel (x: meterW - colW to meterW)
      meterCtx.fillRect(meterW - colW, meterH - hR, colW, hR);

      // Draw 1px middle gap/divider
      meterCtx.fillStyle = '#000';
      meterCtx.fillRect(colW, 0, meterW - colW * 2, meterH);

      frameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(frameId);
  }, [analyser]);

  const ticks = [6, 0, -3, -6, -12, -18, -24, -30, -40, -60];

  return (
    <div className={cn(
      "min-w-[100px] w-[100px] h-full border-r border-black flex flex-col p-1.5 items-center gap-1 relative shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]",
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
      
      {/* Dynamic Effect Rack */}
      <EffectRack
        effects={track.effects}
        onUpdateEffect={updateEffect}
        isMaster={isMaster}
        analyser={analyser}
        isPlaying={isPlaying}
      />

      {/* Immersive Panning Slider */}
      <div className="w-full h-8 flex flex-col items-center justify-center relative mb-1 px-1">
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
          <span className="text-[6px] text-[#444] font-bold major-mono-display-regular">L</span>
          <span className="text-[8px] major-mono-display-regular font-bold text-[#ffd900]/80 leading-none">
            {track.pan === 0 ? 'C' : `${Math.abs(Math.round(track.pan * 100))}${track.pan < 0 ? 'L' : 'R'}`}
          </span>
          <span className="text-[6px] text-[#444] font-bold major-mono-display-regular">R</span>
        </div>
      </div>

      {/* Main Control Section: Logic Style Fader & Meter */}
      <div className="flex-1 flex flex-col w-full pt-0 pb-1 px-1">
        {/* Numeric Volume Readout */}
        <div 
          className="w-full bg-[#111] border border-[#444] rounded-sm py-0.5 mb-2 flex items-center justify-center shadow-inner cursor-pointer"
          onDoubleClick={() => updateParams(track.id, { volume: 0 })}
        >
          <span className="text-[10px] major-mono-display-regular text-[#ffd900] font-bold leading-none">
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
                  "absolute right-0 h-0 flex items-center justify-end text-[6px] major-mono-display-regular",
                  val === 6 ? "text-[#ffd900]/60" : "text-[#444]"
                )}
                style={{ bottom: `${dbToLevel(val) * 100}%` }}
              >
                <span className="pr-0.5 major-mono-display-regular">{val > 0 ? `+${val}` : val}</span>
                <div className="w-0.5 h-[1px] bg-white/20" />
              </div>
            ))}
          </div>

          <div className="flex-1 flex gap-2 justify-center h-full">
            {/* Level Meter (Inline Stereo L/R) */}
            <div className="h-full flex relative flex-1 max-w-[12px]">
              <canvas 
                ref={meterCanvasRef} 
                width={12} 
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
            <span className="text-[9px] font-bold truncate px-1 tracking-tighter kumbh-sans">{track.name}</span>
        </div>
      </div>
    </div>
  );
}

interface MiniAudioDisplayProps {
  masterAnalyser: { meter: any; fft: any } | null;
  isPlaying: boolean;
}

function MiniAudioDisplay({ masterAnalyser, isPlaying }: MiniAudioDisplayProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'spectrum' | 'peak'>('peak');

  const dbToLevel = (db: number) => {
    if (!isFinite(db) || isNaN(db)) return 0;
    return Math.pow(Math.max(0, (db + 60) / 66), 1.5);
  };

  React.useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let peakL = 0;
    let peakR = 0;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (mode === 'spectrum') {
        const numBars = 12;
        const barGap = 1.5;
        const barWidth = (canvas.width - (numBars - 1) * barGap) / numBars;

        let values: Float32Array | number[] | null = null;
        if (masterAnalyser?.fft) {
          try {
            const raw = masterAnalyser.fft.getValue();
            if (raw instanceof Float32Array || Array.isArray(raw)) {
              values = raw;
            }
          } catch {
            values = null;
          }
        }

        for (let i = 0; i < numBars; i++) {
          let heightPercent = 0;

          if (values && values.length > 0) {
            const totalBins = values.length;
            const fMin = 40;
            const fMax = 16000;
            const nyquist = 22050;

            const f1 = fMin * Math.pow(fMax / fMin, i / numBars);
            const f2 = fMin * Math.pow(fMax / fMin, (i + 1) / numBars);

            const bin1 = Math.max(0, Math.floor((f1 / nyquist) * totalBins));
            const bin2 = Math.min(totalBins - 1, Math.max(bin1 + 1, Math.floor((f2 / nyquist) * totalBins)));

            let maxDb = -120;
            for (let b = bin1; b <= bin2; b++) {
              const val = values[b] as number;
              if (typeof val === 'number' && isFinite(val) && val > maxDb) {
                maxDb = val;
              }
            }

            if (maxDb > -100) {
              const tiltOffset = (i - 2) * 1.8;
              const compensatedDb = maxDb + tiltOffset;
              heightPercent = dbToLevel(compensatedDb);
            }
          }

          const barHeight = Math.max(0, heightPercent * canvas.height);
          const x = i * (barWidth + barGap);
          const y = canvas.height - barHeight;

          const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
          grad.addColorStop(0, '#15803d');
          grad.addColorStop(0.4, '#22c55e');
          grad.addColorStop(0.75, '#facc15');
          grad.addColorStop(1, '#ef4444');

          if (barHeight > 0) {
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, barWidth, barHeight);
          } else {
            ctx.fillStyle = '#222';
            ctx.fillRect(x, canvas.height - 1, barWidth, 1);
          }
        }
      } else {
        // Peak Meter Mode (Stereo L / R)
        let dbL = -100;
        let dbR = -100;
        if (masterAnalyser?.meter) {
          try {
            const val = masterAnalyser.meter.getValue();
            if (Array.isArray(val) || val instanceof Float32Array) {
              dbL = typeof val[0] === 'number' && !isNaN(val[0]) ? val[0] : -100;
              dbR = typeof val[1] === 'number' && !isNaN(val[1]) ? val[1] : -100;
            } else if (typeof val === 'number' && !isNaN(val)) {
              dbL = val;
              dbR = val;
            }
          } catch {
            dbL = -100;
            dbR = -100;
          }
        }

        let targetL = dbToLevel(dbL);
        let targetR = dbToLevel(dbR);

        // Smooth decay matching master channel meter
        peakL = Math.max(targetL, peakL * 0.85);
        peakR = Math.max(targetR, peakR * 0.85);

        const meterHeight = (canvas.height - 3) / 2;
        const labelWidth = 7;
        const startX = labelWidth + 2;
        const barWidth = canvas.width - startX - 1;

        const labels = ['L', 'R'];
        const levels = [peakL, peakR];

        levels.forEach((level, idx) => {
          const y = 1 + idx * (meterHeight + 1);
          const fillWidth = level * barWidth;

          // Channel Label (L / R)
          ctx.fillStyle = '#888';
          ctx.font = 'bold 7px Roboto, sans-serif';
          ctx.textBaseline = 'middle';
          ctx.fillText(labels[idx], 1, y + meterHeight / 2);

          // Background bar track
          ctx.fillStyle = '#151515';
          ctx.fillRect(startX, y, barWidth, meterHeight);

          // Gradient fill identical to Master Channel Strip (Green -> Yellow -> Red)
          const grad = ctx.createLinearGradient(startX, 0, startX + barWidth, 0);
          grad.addColorStop(0, '#15803d');
          grad.addColorStop(0.4, '#22c55e');
          grad.addColorStop(0.75, '#facc15');
          grad.addColorStop(1, '#ef4444');

          ctx.fillStyle = fillWidth > 0.5 ? grad : '#222';
          ctx.fillRect(startX, y, Math.max(0, fillWidth), meterHeight);
        });
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [masterAnalyser, isPlaying, mode]);

  return (
    <div className="flex items-center gap-1.5 select-none">
      <div className="relative flex items-center bg-black/90 border border-[#333] hover:border-[#ffd900]/60 transition-colors rounded-[2px] p-[2px] cursor-pointer">
        <canvas 
          ref={canvasRef} 
          width={58} 
          height={18} 
          onClick={() => setMode(m => m === 'spectrum' ? 'peak' : 'spectrum')}
          className="rounded-[1px] block"
          title={`Master ${mode === 'spectrum' ? 'Real-Time Spectrum (RTA)' : 'Peak Meter (VU)'} - Click canvas to toggle mode`}
        />
      </div>
      <div className="flex flex-col gap-[1px] justify-center">
        <button
          type="button"
          onClick={() => setMode('spectrum')}
          className={cn(
            "px-1 py-[1px] text-[7px] font-mono font-bold leading-none rounded-[1px] transition-all cursor-pointer border",
            mode === 'spectrum'
              ? "bg-[#ffd900] text-black border-[#ffd900]"
              : "bg-[#1f1f1f] text-[#666] border-[#333] hover:text-[#aaa] hover:bg-[#2a2a2a]"
          )}
          title="Switch to Real-Time Spectrum (RTA)"
        >
          RTA
        </button>
        <button
          type="button"
          onClick={() => setMode('peak')}
          className={cn(
            "px-1 py-[1px] text-[7px] font-mono font-bold leading-none rounded-[1px] transition-all cursor-pointer border",
            mode === 'peak'
              ? "bg-[#ffd900] text-black border-[#ffd900]"
              : "bg-[#1f1f1f] text-[#666] border-[#333] hover:text-[#aaa] hover:bg-[#2a2a2a]"
          )}
          title="Switch to Peak Meter (VU)"
        >
          VU
        </button>
      </div>
    </div>
  );
}
