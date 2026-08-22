import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, MousePointer2, Redo2, Scissors, Undo2 } from 'lucide-react';
import { getEditingApi, subscribeEditingApi } from '../editingBridge';

type EditingTool = 'cursor' | 'cut';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getClassName(element: Element) {
  return typeof (element as HTMLElement).className === 'string' ? (element as HTMLElement).className : '';
}

function ensureFadeChild(clipElement: HTMLElement, className: string) {
  let element = clipElement.querySelector<HTMLElement>(`:scope > .${className}`);
  if (!element) {
    element = document.createElement('div');
    element.className = className;
    element.setAttribute('aria-hidden', 'true');
    clipElement.appendChild(element);
  }
  return element;
}

function bindFadeHandle(handle: HTMLElement, side: 'in' | 'out') {
  if (handle.dataset.bound === '1') return;
  handle.dataset.bound = '1';

  const stopMouse = (event: MouseEvent) => {
    if (document.body.dataset.digidawTool === 'cut') return;
    event.preventDefault();
    event.stopPropagation();
  };
  handle.addEventListener('mousedown', stopMouse);
  handle.addEventListener('click', stopMouse);

  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || document.body.dataset.digidawTool === 'cut') return;
    event.preventDefault();
    event.stopPropagation();

    const clipElement = handle.parentElement as HTMLElement | null;
    const api = getEditingApi();
    if (!clipElement || !api) return;
    const trackId = clipElement.dataset.digidawTrackId;
    const clipId = clipElement.dataset.digidawClipId;
    if (!trackId || !clipId) return;
    const track = api.tracks.find(item => item.id === trackId);
    const clip = track?.clips.find(item => item.id === clipId);
    if (!clip || clip.duration <= 0) return;

    const rect = clipElement.getBoundingClientRect();
    const pixelsPerSecond = Math.max(0.0001, rect.width / clip.duration);
    const startX = event.clientX;
    const initialFadeIn = clip.fadeIn ?? 0;
    const initialFadeOut = clip.fadeOut ?? 0;
    let finalFadeIn = initialFadeIn;
    let finalFadeOut = initialFadeOut;

    document.body.classList.add('digidaw-fade-dragging');
    clipElement.classList.add('is-fade-editing');
    try { handle.setPointerCapture(event.pointerId); } catch {}

    const updateVisual = () => {
      const inPercent = clip.duration > 0 ? (finalFadeIn / clip.duration) * 100 : 0;
      const outPercent = clip.duration > 0 ? (finalFadeOut / clip.duration) * 100 : 0;
      clipElement.style.setProperty('--digidaw-fade-in', `${inPercent}%`);
      clipElement.style.setProperty('--digidaw-fade-out', `${outPercent}%`);
      handle.title = `${side === 'in' ? 'Fade in' : 'Fade out'} ${side === 'in' ? finalFadeIn.toFixed(2) : finalFadeOut.toFixed(2)} s`;
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaSeconds = (moveEvent.clientX - startX) / pixelsPerSecond;
      if (side === 'in') {
        finalFadeIn = clamp(initialFadeIn + deltaSeconds, 0, Math.max(0, clip.duration - initialFadeOut));
      } else {
        finalFadeOut = clamp(initialFadeOut - deltaSeconds, 0, Math.max(0, clip.duration - initialFadeIn));
      }
      updateVisual();
    };

    const finish = () => {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
      document.body.classList.remove('digidaw-fade-dragging');
      clipElement.classList.remove('is-fade-editing');
      getEditingApi()?.updateClipFades(trackId, clipId, finalFadeIn, finalFadeOut);
    };

    const onPointerUp = () => finish();
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
  });
}

function bindCutGesture(clipElement: HTMLElement) {
  if (clipElement.dataset.cutBound === '1') return;
  clipElement.dataset.cutBound = '1';

  clipElement.addEventListener('mousedown', event => {
    if (event.button !== 0 || document.body.dataset.digidawTool !== 'cut') return;
    const api = getEditingApi();
    const trackId = clipElement.dataset.digidawTrackId;
    const clipId = clipElement.dataset.digidawClipId;
    if (!api || !trackId || !clipId) return;
    const track = api.tracks.find(item => item.id === trackId);
    const clip = track?.clips.find(item => item.id === clipId);
    if (!clip || clip.duration <= 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const rect = clipElement.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const atTime = clip.startTime + ratio * clip.duration;
    const didSplit = api.splitClipAtTime(trackId, atTime);
    if (!didSplit) {
      clipElement.classList.remove('digidaw-cut-miss');
      void clipElement.offsetWidth;
      clipElement.classList.add('digidaw-cut-miss');
      window.setTimeout(() => clipElement.classList.remove('digidaw-cut-miss'), 220);
    }
  }, true);
}

function bindZoomPivot(slider: HTMLInputElement) {
  slider.classList.add('digidaw-zoom-wheel');
  if (slider.dataset.zoomPivotBound === '1') return;
  slider.dataset.zoomPivotBound = '1';
  slider.dataset.zoomPivotValue = slider.value;

  slider.addEventListener('input', () => {
    const previousZoom = Number(slider.dataset.zoomPivotValue ?? slider.value);
    const nextZoom = Number(slider.value);
    slider.dataset.zoomPivotValue = String(nextZoom);
    if (!Number.isFinite(previousZoom) || !Number.isFinite(nextZoom) || previousZoom === nextZoom) return;

    const api = getEditingApi();
    const timeline = document.getElementById('timeline-column');
    const scrollContainer = timeline?.parentElement?.parentElement as HTMLElement | null;
    if (!api || !timeline || !scrollContainer) return;

    const pivotTime = api.getCurrentTime();
    const scrollDelta = pivotTime * (nextZoom - previousZoom);
    if (Math.abs(scrollDelta) < 0.01) return;

    requestAnimationFrame(() => {
      const maxScroll = Math.max(0, scrollContainer.scrollWidth - scrollContainer.clientWidth);
      scrollContainer.scrollLeft = clamp(scrollContainer.scrollLeft + scrollDelta, 0, maxScroll);
    });
  });
}

function decorateWorkspace() {
  const api = getEditingApi();
  if (!api) return;

  document.querySelectorAll('.digidaw-cut-track-button').forEach(element => element.remove());

  const timeline = document.getElementById('timeline-column');
  if (!timeline) return;
  const lanes = Array.from(timeline.children).filter((element): element is HTMLElement =>
    element instanceof HTMLElement && getClassName(element).includes('h-[80px]')
  );

  lanes.forEach((lane, trackIndex) => {
    const track = api.tracks[trackIndex];
    if (!track) return;
    const clipElements = Array.from(lane.children).filter((element): element is HTMLElement =>
      element instanceof HTMLElement && getClassName(element).includes('cursor-grab')
    );

    clipElements.forEach((clipElement, clipIndex) => {
      const clip = track.clips[clipIndex];
      if (!clip) return;
      clipElement.dataset.digidawTrackId = track.id;
      clipElement.dataset.digidawClipId = clip.id;
      clipElement.style.setProperty('--digidaw-fade-in', `${clip.duration > 0 ? ((clip.fadeIn ?? 0) / clip.duration) * 100 : 0}%`);
      clipElement.style.setProperty('--digidaw-fade-out', `${clip.duration > 0 ? ((clip.fadeOut ?? 0) / clip.duration) * 100 : 0}%`);

      ensureFadeChild(clipElement, 'digidaw-fade-visual-in');
      ensureFadeChild(clipElement, 'digidaw-fade-visual-out');
      const fadeInHandle = ensureFadeChild(clipElement, 'digidaw-fade-handle-in');
      const fadeOutHandle = ensureFadeChild(clipElement, 'digidaw-fade-handle-out');
      bindFadeHandle(fadeInHandle, 'in');
      bindFadeHandle(fadeOutHandle, 'out');
      bindCutGesture(clipElement);
    });
  });
}

function getSelectedClipElement() {
  const clips = Array.from(document.querySelectorAll<HTMLElement>('#timeline-column [data-digidaw-clip-id]'));
  return clips.find(element => element.classList.contains('ring-2') || getClassName(element).includes('border-[#ffd900]')) ?? null;
}

export function EditingOverlay() {
  const api = useSyncExternalStore(subscribeEditingApi, getEditingApi, getEditingApi);
  const [historyHost, setHistoryHost] = useState<HTMLElement | null>(null);
  const [toolHost, setToolHost] = useState<HTMLElement | null>(null);
  const [tool, setTool] = useState<EditingTool>('cursor');
  const [toolOpen, setToolOpen] = useState(false);

  useEffect(() => {
    document.body.dataset.digidawTool = tool;
    decorateWorkspace();
    return () => {
      if (document.body.dataset.digidawTool === tool) delete document.body.dataset.digidawTool;
    };
  }, [tool]);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    const ensureHosts = () => {
      const transport = document.querySelector<HTMLElement>('header > div:nth-child(2)');
      if (transport) {
        let host = transport.querySelector<HTMLElement>(':scope > .digidaw-history-host');
        if (!host) {
          host = document.createElement('div');
          host.className = 'digidaw-history-host';
          transport.prepend(host);
        }
        setHistoryHost(previous => previous === host ? previous : host);
      }

      const zoomSlider = document.querySelector<HTMLInputElement>('header input[title="Timeline Zoom"]');
      const zoomRow = zoomSlider?.parentElement;
      if (zoomSlider) bindZoomPivot(zoomSlider);
      if (zoomRow) {
        let host = zoomRow.querySelector<HTMLElement>(':scope > .digidaw-tool-host');
        if (!host) {
          host = document.createElement('div');
          host.className = 'digidaw-tool-host';
          zoomRow.appendChild(host);
        }
        setToolHost(previous => previous === host ? previous : host);
      }

      decorateWorkspace();
    };

    ensureHosts();
    const observer = new MutationObserver(ensureHosts);
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener('resize', ensureHosts);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', ensureHosts);
    };
  }, []);

  useEffect(() => {
    decorateWorkspace();
  }, [api?.tracks, api?.canUndo, api?.canRedo, tool]);

  useEffect(() => {
    if (!toolOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (toolHost && event.target instanceof Node && !toolHost.contains(event.target)) setToolOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => window.removeEventListener('pointerdown', handlePointerDown, true);
  }, [toolHost, toolOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        const selected = getSelectedClipElement();
        const trackId = selected?.dataset.digidawTrackId;
        const clipId = selected?.dataset.digidawClipId;
        if (trackId && clipId && getEditingApi()?.deleteClip(trackId, clipId)) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (event.key === 'Escape') {
        setToolOpen(false);
        return;
      }

      const command = event.metaKey || event.ctrlKey;
      if (!command) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) getEditingApi()?.redo();
        else getEditingApi()?.undo();
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        getEditingApi()?.redo();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  if (!api) return null;

  const historyPortal = historyHost ? createPortal(
    <>
      <button
        type="button"
        className="digidaw-history-button"
        disabled={!api.canUndo}
        onClick={() => api.undo()}
        title="Undo (Ctrl/Cmd + Z)"
        aria-label="Undo"
      >
        <Undo2 />
      </button>
      <button
        type="button"
        className="digidaw-history-button"
        disabled={!api.canRedo}
        onClick={() => api.redo()}
        title="Redo (Ctrl/Cmd + Shift + Z)"
        aria-label="Redo"
      >
        <Redo2 />
      </button>
      <span className="digidaw-history-divider" aria-hidden="true" />
    </>,
    historyHost,
  ) : null;

  const toolPortal = toolHost ? createPortal(
    <div className="digidaw-tool-select">
      <button
        type="button"
        className={tool === 'cut' ? 'digidaw-tool-button is-cut' : 'digidaw-tool-button'}
        onClick={() => setToolOpen(previous => !previous)}
        title="Timeline editing tool"
        aria-haspopup="menu"
        aria-expanded={toolOpen}
      >
        {tool === 'cut' ? <Scissors /> : <MousePointer2 />}
        <span>{tool === 'cut' ? 'Cut' : 'Cursor'}</span>
        <ChevronDown className="digidaw-tool-chevron" />
      </button>
      {toolOpen && (
        <div className="digidaw-tool-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className={tool === 'cursor' ? 'is-selected' : ''}
            onClick={() => { setTool('cursor'); setToolOpen(false); }}
          >
            <MousePointer2 />
            <span>Cursor</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={tool === 'cut' ? 'is-selected' : ''}
            onClick={() => { setTool('cut'); setToolOpen(false); }}
          >
            <Scissors />
            <span>Cut</span>
          </button>
        </div>
      )}
    </div>,
    toolHost,
  ) : null;

  return <>{historyPortal}{toolPortal}</>;
}
