import { useEffect } from 'react';
import '../zoom-wheel.css';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function setNativeRangeValue(input: HTMLInputElement, value: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, String(value));
  else input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function spinRoller(roller: HTMLElement, deltaPixels: number) {
  const step = 12;
  const current = Number(roller.dataset.rollPhase ?? 0);
  const next = ((current + deltaPixels) % step + step) % step;
  roller.dataset.rollPhase = String(next);
  roller.style.setProperty('--digidaw-roll-offset', `${next}px`);
}

function applyZoomDelta(input: HTMLInputElement, delta: number) {
  const minimum = Number(input.min || 10);
  const maximum = Number(input.max || 500);
  const current = Number(input.value);

  const residual = Number(input.dataset.rollResidual ?? 0) + delta;
  const whole = residual >= 0 ? Math.floor(residual) : Math.ceil(residual);
  input.dataset.rollResidual = String(residual - whole);
  if (whole === 0) return;

  const next = clamp(current + whole, minimum, maximum);
  if (next === current) return;
  setNativeRangeValue(input, next);
}

function bindRoller(input: HTMLInputElement, roller: HTMLElement) {
  if (roller.dataset.infiniteRollBound === '1') return () => {};
  roller.dataset.infiniteRollBound = '1';
  input.tabIndex = -1;

  roller.tabIndex = 0;
  roller.setAttribute('role', 'slider');
  roller.setAttribute('aria-label', 'Timeline zoom');
  roller.setAttribute('aria-valuemin', input.min || '10');
  roller.setAttribute('aria-valuemax', input.max || '500');
  roller.setAttribute('aria-valuenow', input.value);
  roller.title = 'Drag or scroll to zoom timeline';

  let activePointerId: number | null = null;
  let lastX = 0;

  const syncAria = () => {
    roller.setAttribute('aria-valuenow', input.value);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    lastX = event.clientX;
    roller.classList.add('is-rolling');
    try { roller.setPointerCapture(event.pointerId); } catch {}
  };

  const onPointerMove = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - lastX;
    lastX = event.clientX;
    if (deltaX === 0) return;

    // Visual roll is intentionally independent from the zoom value. It keeps
    // moving even after the zoom itself reaches its min/max clamp.
    spinRoller(roller, deltaX);
    applyZoomDelta(input, deltaX * 0.85);
  };

  const finishPointer = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    roller.classList.remove('is-rolling');
    try { roller.releasePointerCapture(event.pointerId); } catch {}
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : -event.deltaY;
    if (raw === 0) return;

    const visualDelta = clamp(raw * 0.14, -18, 18);
    spinRoller(roller, visualDelta);
    applyZoomDelta(input, clamp(raw * 0.08, -12, 12));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    let delta = 0;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = 4;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = -4;
    else return;

    event.preventDefault();
    spinRoller(roller, delta > 0 ? 6 : -6);
    applyZoomDelta(input, delta);
  };

  input.addEventListener('input', syncAria);
  roller.addEventListener('pointerdown', onPointerDown);
  roller.addEventListener('pointermove', onPointerMove);
  roller.addEventListener('pointerup', finishPointer);
  roller.addEventListener('pointercancel', finishPointer);
  roller.addEventListener('wheel', onWheel, { passive: false });
  roller.addEventListener('keydown', onKeyDown);

  return () => {
    input.removeEventListener('input', syncAria);
    roller.removeEventListener('pointerdown', onPointerDown);
    roller.removeEventListener('pointermove', onPointerMove);
    roller.removeEventListener('pointerup', finishPointer);
    roller.removeEventListener('pointercancel', finishPointer);
    roller.removeEventListener('wheel', onWheel);
    roller.removeEventListener('keydown', onKeyDown);
    delete roller.dataset.infiniteRollBound;
  };
}

export function ZoomWheelBehavior() {
  useEffect(() => {
    let cleanupBinding: (() => void) | null = null;

    const tryBind = () => {
      const input = document.querySelector<HTMLInputElement>('header input[title="Timeline Zoom"]');
      const roller = input?.parentElement?.querySelector<HTMLElement>(':scope > .digidaw-zoom-roller');
      if (!input || !roller || roller.dataset.infiniteRollBound === '1') return;
      cleanupBinding?.();
      cleanupBinding = bindRoller(input, roller);
    };

    tryBind();
    const root = document.getElementById('root');
    if (!root) return () => cleanupBinding?.();

    const observer = new MutationObserver(tryBind);
    observer.observe(root, { childList: true, subtree: true });
    window.addEventListener('resize', tryBind);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', tryBind);
      cleanupBinding?.();
    };
  }, []);

  return null;
}
