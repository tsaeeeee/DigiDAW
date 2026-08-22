import { useEffect } from 'react';
import { getEditingApi } from '../editingBridge';
import '../multi-select.css';

type SelectedClip = {
  trackId: string;
  clipId: string;
};

function clipKey(trackId: string, clipId: string) {
  return `${trackId}::${clipId}`;
}

function getClipElement(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>('#timeline-column [data-digidaw-clip-id]');
}

function isNativeSelected(element: HTMLElement) {
  const className = typeof element.className === 'string' ? element.className : '';
  return element.classList.contains('ring-2') || className.includes('border-[#ffd900]');
}

export function MultiSelectBehavior() {
  useEffect(() => {
    const selected = new Map<string, SelectedClip>();
    let multiMode = false;

    const getAllClipElements = () => Array.from(
      document.querySelectorAll<HTMLElement>('#timeline-column [data-digidaw-clip-id]')
    );

    const getRef = (element: HTMLElement): SelectedClip | null => {
      const trackId = element.dataset.digidawTrackId;
      const clipId = element.dataset.digidawClipId;
      return trackId && clipId ? { trackId, clipId } : null;
    };

    const applyVisuals = () => {
      const liveKeys = new Set<string>();
      for (const element of getAllClipElements()) {
        const ref = getRef(element);
        if (!ref) continue;
        const key = clipKey(ref.trackId, ref.clipId);
        liveKeys.add(key);
        element.classList.toggle('digidaw-multi-selected', multiMode && selected.has(key));
      }

      for (const key of Array.from(selected.keys())) {
        if (!liveKeys.has(key)) selected.delete(key);
      }

      if (multiMode && selected.size > 1) {
        document.body.dataset.digidawMultiSelect = '1';
        document.body.dataset.digidawMultiSelectCount = String(selected.size);
      } else {
        delete document.body.dataset.digidawMultiSelect;
        delete document.body.dataset.digidawMultiSelectCount;
        if (selected.size <= 1) multiMode = false;
      }
    };

    const clearMultiSelection = () => {
      selected.clear();
      multiMode = false;
      applyVisuals();
    };

    const seedNativeSelection = () => {
      if (selected.size) return;
      for (const element of getAllClipElements()) {
        if (!isNativeSelected(element)) continue;
        const ref = getRef(element);
        if (!ref) continue;
        selected.set(clipKey(ref.trackId, ref.clipId), ref);
        break;
      }
    };

    const syncNativeSelection = (preferredElement?: HTMLElement | null) => {
      let element = preferredElement ?? null;
      const preferredRef = element ? getRef(element) : null;
      if (!preferredRef || !selected.has(clipKey(preferredRef.trackId, preferredRef.clipId))) {
        element = getAllClipElements().find(candidate => {
          const ref = getRef(candidate);
          return !!ref && selected.has(clipKey(ref.trackId, ref.clipId));
        }) ?? null;
      }
      if (!element) return;

      queueMicrotask(() => {
        if (!element?.isConnected) return;
        element.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          button: 0,
        }));
      });
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (document.body.dataset.digidawTool === 'cut') return;

      const clip = getClipElement(event.target);
      const modifier = event.ctrlKey || event.metaKey;
      const targetElement = event.target instanceof Element ? event.target : null;
      const isFadeHandle = !!targetElement?.closest('.digidaw-fade-handle-in, .digidaw-fade-handle-out');
      if (isFadeHandle) return;

      if (clip && modifier) {
        const ref = getRef(clip);
        if (!ref) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        seedNativeSelection();
        multiMode = true;

        const key = clipKey(ref.trackId, ref.clipId);
        if (selected.has(key)) {
          // Keep at least one clip selected; a normal click elsewhere clears it.
          if (selected.size > 1) selected.delete(key);
        } else {
          selected.set(key, ref);
        }

        applyVisuals();
        syncNativeSelection(selected.has(key) ? clip : null);
        return;
      }

      if (!modifier && multiMode) clearMultiSelection();
    };

    const onClick = (event: MouseEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (!getClipElement(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const onContextMenu = (event: MouseEvent) => {
      if (!event.ctrlKey || !getClipElement(event.target)) return;
      event.preventDefault();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;

      if (event.key === 'Escape' && multiMode) {
        clearMultiSelection();
        return;
      }

      if ((event.key !== 'Delete' && event.key !== 'Backspace') || !multiMode || selected.size < 2) return;

      const api = getEditingApi();
      if (!api) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const refs = Array.from(selected.values());
      clearMultiSelection();
      refs.forEach(ref => api.deleteClip(ref.trackId, ref.clipId));
    };

    const observer = new MutationObserver(() => {
      if (multiMode) applyVisuals();
    });
    const root = document.getElementById('root');
    if (root) observer.observe(root, { childList: true, subtree: true });

    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('keydown', onKeyDown, true);

    return () => {
      observer.disconnect();
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('keydown', onKeyDown, true);
      clearMultiSelection();
    };
  }, []);

  return null;
}
