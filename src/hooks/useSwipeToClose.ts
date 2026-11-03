import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const SLOP_PX = 10;
const CLOSE_RATIO = 0.3;
const FLICK_PX_PER_MS = 0.5;
const FLICK_MAX_PAUSE_MS = 100;
const CLICK_GUARD_MS = 400;
const SETTLING_CLASS = 'library-drawer--settling';

export function useSwipeToClose(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled: boolean,
) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;

    let touchId: number | null = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let offset = 0;
    let lastX = 0;
    let lastTime = 0;
    let velocity = 0;
    let dragEndedAt = -Infinity;
    let onCloseTransitionEnd: ((e: TransitionEvent) => void) | null = null;

    const findTouch = (list: TouchList) =>
      Array.from(list).find((touch) => touch.identifier === touchId);

    const settle = (close: boolean) => {
      el.classList.add(SETTLING_CLASS);
      el.style.transform = close ? 'translateX(-100%)' : '';
      if (!close) return;
      if (getComputedStyle(el).transitionDuration === '0s') {
        onCloseRef.current();
        return;
      }
      onCloseTransitionEnd = (e) => {
        if (e.target !== el || e.propertyName !== 'transform') return;
        clearCloseTransition();
        onCloseRef.current();
      };
      el.addEventListener('transitionend', onCloseTransitionEnd);
    };

    const clearCloseTransition = () => {
      if (onCloseTransitionEnd) el.removeEventListener('transitionend', onCloseTransitionEnd);
      onCloseTransitionEnd = null;
    };

    const reset = () => {
      clearCloseTransition();
      el.classList.remove(SETTLING_CLASS);
      el.style.transform = '';
    };

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.changedTouches[0];
      if (touchId !== null || e.touches.length !== 1 || !touch) return;
      touchId = touch.identifier;
      startX = lastX = touch.clientX;
      startY = touch.clientY;
      lastTime = e.timeStamp;
      dragging = false;
      offset = 0;
      velocity = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      const touch = findTouch(e.changedTouches);
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return;
        // Vertical moves scroll the list, and rightward moves have nowhere to go
        if (dx >= 0 || Math.abs(dx) <= Math.abs(dy)) {
          touchId = null;
          return;
        }
        dragging = true;
        clearCloseTransition();
        el.classList.remove(SETTLING_CLASS);
      }
      if (e.cancelable) e.preventDefault();
      if (e.timeStamp > lastTime) {
        velocity = (touch.clientX - lastX) / (e.timeStamp - lastTime);
      }
      lastX = touch.clientX;
      lastTime = e.timeStamp;
      offset = Math.min(0, dx);
      el.style.transform = `translateX(${offset}px)`;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!findTouch(e.changedTouches)) return;
      touchId = null;
      if (!dragging) return;
      dragging = false;
      dragEndedAt = e.timeStamp;
      const flicked = velocity < -FLICK_PX_PER_MS && e.timeStamp - lastTime < FLICK_MAX_PAUSE_MS;
      const close = e.type === 'touchend' && (offset < -el.offsetWidth * CLOSE_RATIO || flicked);
      settle(close);
    };

    // A drag that ends on a song must not open it
    const onClick = (e: MouseEvent) => {
      if (e.timeStamp - dragEndedAt < CLICK_GUARD_MS) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    el.addEventListener('click', onClick, { capture: true });
    el.addEventListener('close', reset);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('click', onClick, { capture: true });
      el.removeEventListener('close', reset);
      reset();
    };
  }, [ref, enabled]);
}
