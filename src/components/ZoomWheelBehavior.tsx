import { useEffect } from 'react';
import '../zoom-wheel.css';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function snapToDevicePixel(value: number) {
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  return Math.round(value * ratio) / ratio;
}

function setNativeRangeValue(input: HTMLInputElement, value: number) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, String(value));
  else input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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

  const minimum = Number(input.min || 10);
  const maximum = Number(input.max || 500);

  let activePointerId: number | null = null;
  let lastX = 0;
  let targetZoom = Number(input.value);
  let targetRoll = Number(roller.dataset.rollPhase ?? 0);
  let renderedRoll = targetRoll;
  let animationFrame = 0;
  let isInternalInput = false;

  const syncAria = () => {
    roller.setAttribute('aria-valuenow', input.value);
    if (!isInternalInput) targetZoom = clamp(Number(input.value), minimum, maximum);
  };

  const paintRoll = () => {
    roller.dataset.rollPhase = String(renderedRoll);
    const alignedRoll = snapToDevicePixel(renderedRoll);
    roller.style.setProperty('--digidaw-roll-offset', `${alignedRoll}px`);
  };

  const scheduleAnimation = () => {
    if (animationFrame) return;

    const tick = () => {
      animationFrame = 0;

      // Smooth the visible roller independently from the clamped zoom value.
      // The exact 12px texture repeats forever; only the painted offset is
      // snapped to the physical pixel grid so every rib stays equally crisp.
      const rollError = targetRoll - renderedRoll;
      if (Math.abs(rollError) > 0.01) {
        renderedRoll += rollError * 0.34;
      } else {
        renderedRoll = targetRoll;
      }
      paintRoll();

      // Zoom follows the user's intent with damping instead of jumping once per
      // pointer/wheel event. Integer steps are still used because AppBase stores
      // zoom as an integer PX_PER_SECOND value.
      const currentZoom = Number(input.value);
      const zoomError = targetZoom - currentZoom;
      if (Math.abs(zoomError) >= 0.5) {
        const easedStep = clamp(zoomError * 0.24, -5, 5);
        let nextZoom = Math.round(currentZoom + easedStep);
        if (nextZoom === currentZoom) nextZoom += zoomError > 0 ? 1 : -1;
        nextZoom = clamp(nextZoom, minimum, maximum);

        if (nextZoom !== currentZoom) {
          isInternalInput = true;
          setNativeRangeValue(input, nextZoom);
          isInternalInput = false;
        }
      }

      const rollerStillMoving = Math.abs(targetRoll - renderedRoll) > 0.02;
      const zoomStillMoving = Math.abs(targetZoom - Number(input.value)) >= 0.5;
      if (rollerStillMoving || zoomStillMoving) animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
  };

  const addIntent = (rollDelta: number, zoomDelta: number) => {
    // Visual motion never clamps. Zoom intent does.
    targetRoll += rollDelta;
    targetZoom = clamp(targetZoom + zoomDelta, minimum, maximum);
    scheduleAnimation();
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    lastX = event.clientX;
    targetZoom = Number(input.value);
    roller.classList.add('is-rolling');
    try { roller.setPointerCapture(event.pointerId); } catch {}
  };

  const onPointerMove = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - lastX;
    lastX = event.clientX;
    if (deltaX === 0) return;

    // Slightly reduced sensitivity + rAF damping makes fine zoom adjustments
    // much easier while keeping long drags fast enough.
    addIntent(deltaX, deltaX * 0.62);
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

    // Wheel/trackpad deltas vary wildly by browser/device, so cap one event's
    // contribution and let the animation loop blend consecutive events.
    const rollDelta = clamp(raw * 0.16, -20, 20);
    const zoomDelta = clamp(raw * 0.055, -8, 8);
    addIntent(rollDelta, zoomDelta);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    let direction = 0;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') direction = 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') direction = -1;
    else return;

    event.preventDefault();
    addIntent(direction * 8, direction * 4);
  };

  input.addEventListener('input', syncAria);
  roller.addEventListener('pointerdown', onPointerDown);
  roller.addEventListener('pointermove', onPointerMove);
  roller.addEventListener('pointerup', finishPointer);
  roller.addEventListener('pointercancel', finishPointer);
  roller.addEventListener('wheel', onWheel, { passive: false });
  roller.addEventListener('keydown', onKeyDown);

  return () => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
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
