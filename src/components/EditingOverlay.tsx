import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Redo2, Undo2 } from 'lucide-react';
import { getEditingApi, subscribeEditingApi } from '../editingBridge';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getClassName(element: Element) {
  return typeof (element as HTMLElement).className === 'string' ? (element as HTMLElement).className : '';
}

function createScissorsButton(trackId: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'digidaw-cut-track-button';
  button.dataset.trackId = trackId;
  button.title = 'Cut clip at playhead';
  button.setAttribute('aria-label', 'Cut clip at playhead');
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="7" r="3"></circle>
      <path d="M8.7 8.3 20 14"></path>
      <circle cx="6" cy="17" r="3"></circle>
      <path d="m8.7 15.7 4.4-2.2"></path>
      <path d="M14.8 9.2 20 6"></path>
    </svg>`;

  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const api = getEditingApi();
    const id = button.dataset.trackId;
    if (!api || !id) return;
    const didSplit = api.splitClipAtTime(id, api.getCurrentTime());
    if (!didSplit) {
      button.classList.remove('is-miss');
      void button.offsetWidth;
      button.classList.add('is-miss');
      window.setTimeout(() => button.classList.remove('is-miss'), 260);
    }
  });
  return button;
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
    event.preventDefault();
    event.stopPropagation();
  };
  handle.addEventListener('mousedown', stopMouse);
  handle.addEventListener('click', stopMouse);

  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
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

function decorateWorkspace() {
  const api = getEditingApi();
  if (!api) return;

  const sidebar = document.querySelector<HTMLElement>('main > div > div > div:first-child');
  if (sidebar) {
    const headers = Array.from(sidebar.children)
      .slice(1, -1)
      .filter((element): element is HTMLElement => element instanceof HTMLElement);
    headers.forEach((header, index) => {
      const track = api.tracks[index];
      if (!track) return;
      let button = header.querySelector<HTMLButtonElement>(':scope > .digidaw-cut-track-button');
      if (!button) {
        button = createScissorsButton(track.id);
        header.appendChild(button);
      }
      button.dataset.trackId = track.id;
      button.disabled = track.clips.length === 0;
    });
  }

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
    });
  });
}

export function EditingOverlay() {
  const api = useSyncExternalStore(subscribeEditingApi, getEditingApi, getEditingApi);
  const [historyHost, setHistoryHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    const ensureHost = () => {
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
      decorateWorkspace();
    };

    ensureHost();
    const observer = new MutationObserver(ensureHost);
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener('resize', ensureHost);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', ensureHost);
    };
  }, []);

  useEffect(() => {
    decorateWorkspace();
  }, [api?.tracks, api?.canUndo, api?.canRedo]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;
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

  if (!historyHost || !api) return null;
  return createPortal(
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
  );
}
