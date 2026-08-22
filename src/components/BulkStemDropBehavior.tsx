import { useEffect, useRef, useState } from 'react';
import '../bulk-stem-drop.css';
import { getEditingApi } from '../editingBridge';

const MAX_TRACKS = 25;
const AUDIO_EXTENSION = /\.(wav|wave|mp3|aif|aiff|flac|m4a|aac|ogg|opus|webm)$/i;

function isFileDrag(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function isAudioFile(file: File) {
  return file.type.startsWith('audio/') || AUDIO_EXTENSION.test(file.name);
}

function getTrackFileInputs() {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"][accept="audio/*"]'));
}

function assignFileToInput(input: HTMLInputElement, file: File) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.value = '';
}

function waitForTrackInput(index: number, timeoutMs = 1200): Promise<HTMLInputElement | null> {
  return new Promise(resolve => {
    const started = performance.now();
    const check = () => {
      const input = getTrackFileInputs()[index];
      if (input) {
        resolve(input);
        return;
      }
      if (performance.now() - started >= timeoutMs) {
        resolve(null);
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

function getAddTrackButton() {
  return document.querySelector<HTMLButtonElement>('header button[title="Add Track"]');
}

export function BulkStemDropBehavior() {
  const [dragging, setDragging] = useState(false);
  const [dragCount, setDragCount] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const statusTimer = useRef<number | null>(null);
  const importing = useRef(false);

  useEffect(() => {
    const showStatus = (message: string) => {
      setStatus(message);
      if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
      statusTimer.current = window.setTimeout(() => {
        setStatus(null);
        statusTimer.current = null;
      }, 3200);
    };

    const workspaceReady = () => !!document.getElementById('timeline-column');

    const onDragEnter = (event: DragEvent) => {
      if (!workspaceReady() || !isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      const files = Array.from(event.dataTransfer?.items ?? []).filter(item => item.kind === 'file');
      setDragCount(files.length);
      setDragging(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!workspaceReady() || !isFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };

    const onDragLeave = (event: DragEvent) => {
      if (!workspaceReady() || !isFileDrag(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) {
        setDragging(false);
        setDragCount(0);
      }
    };

    const onDrop = async (event: DragEvent) => {
      if (!workspaceReady() || !isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      setDragCount(0);
      if (importing.current) {
        showStatus('Stem import is already running');
        return;
      }

      const dropped = Array.from(event.dataTransfer?.files ?? []);
      const audioFiles = dropped.filter(isAudioFile);
      if (audioFiles.length === 0) {
        showStatus('No supported audio files found');
        return;
      }

      const api = getEditingApi();
      if (!api) return;

      // Keep every asynchronously decoded stem aligned to one transport time.
      // If playback is running, pause it before dispatching the file imports.
      const pauseButton = document.querySelector<HTMLButtonElement>('header button[title^="Pause"]');
      const pausedForImport = !!pauseButton;
      pauseButton?.click();

      const emptyTrackIndexes = api.tracks
        .map((track, index) => ({ track, index }))
        .filter(({ track }) => track.clips.length === 0)
        .map(({ index }) => index);
      const newTrackCapacity = Math.max(0, MAX_TRACKS - api.tracks.length);
      const capacity = emptyTrackIndexes.length + newTrackCapacity;
      const files = audioFiles.slice(0, capacity);

      if (files.length === 0) {
        showStatus('Track limit reached — no empty track available');
        return;
      }

      importing.current = true;
      try {
        let imported = 0;
        let existingCursor = 0;

        for (const file of files) {
          let input: HTMLInputElement | null = null;

          if (existingCursor < emptyTrackIndexes.length) {
            input = getTrackFileInputs()[emptyTrackIndexes[existingCursor]] ?? null;
            existingCursor += 1;
          } else {
            const previousCount = getTrackFileInputs().length;
            const addButton = getAddTrackButton();
            if (!addButton || addButton.disabled) break;
            addButton.click();
            input = await waitForTrackInput(previousCount);
          }

          if (!input) break;
          assignFileToInput(input, file);
          imported += 1;
        }

        const skippedUnsupported = dropped.length - audioFiles.length;
        const skippedLimit = audioFiles.length - imported;
        const extras: string[] = [];
        if (skippedUnsupported > 0) extras.push(`${skippedUnsupported} non-audio skipped`);
        if (skippedLimit > 0) extras.push(`${skippedLimit} over track limit`);
        if (pausedForImport) extras.push('playback paused');

        showStatus(`Queued ${imported} stem${imported === 1 ? '' : 's'}${extras.length ? ` · ${extras.join(' · ')}` : ''}`);
      } finally {
        importing.current = false;
      }
    };

    window.addEventListener('dragenter', onDragEnter, true);
    window.addEventListener('dragover', onDragOver, true);
    window.addEventListener('dragleave', onDragLeave, true);
    window.addEventListener('drop', onDrop, true);

    return () => {
      window.removeEventListener('dragenter', onDragEnter, true);
      window.removeEventListener('dragover', onDragOver, true);
      window.removeEventListener('dragleave', onDragLeave, true);
      window.removeEventListener('drop', onDrop, true);
      if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    };
  }, []);

  return (
    <>
      {dragging && (
        <div className="digidaw-stem-drop-overlay" aria-hidden="true">
          <div className="digidaw-stem-drop-panel">
            <div className="digidaw-stem-drop-mark">+</div>
            <div className="digidaw-stem-drop-copy">
              <strong>Drop stems</strong>
              <span>{dragCount > 0 ? `${dragCount} file${dragCount === 1 ? '' : 's'} · one stem per track` : 'One stem per track'}</span>
            </div>
          </div>
        </div>
      )}
      {status && <div className="digidaw-stem-drop-status">{status}</div>}
    </>
  );
}
