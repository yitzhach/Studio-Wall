/** Touch gestures for an overflow:auto image stage: two-finger pinch zoom, one-finger pan while zoomed, double-tap. */
export type ZoomTarget = {
  get(): number;
  set(zoom: number, anchor: {x: number; y: number}): void;
  doubleTap(point: {x: number; y: number}): void;
};
export const MIN_ZOOM = 1,
  MAX_ZOOM = 4;
const clamp = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Keeps the content point under `anchor` (client coords) fixed while content scales linearly with zoom. */
export function zoomAt(
  stage: HTMLElement,
  from: number,
  to: number,
  anchor: {x: number; y: number} | null,
  apply: () => void,
) {
  const r = stage.getBoundingClientRect(),
    ax = anchor ? anchor.x - r.left : stage.clientWidth / 2,
    ay = anchor ? anchor.y - r.top : stage.clientHeight / 2;
  const cx = (stage.scrollLeft + ax) / from,
    cy = (stage.scrollTop + ay) / from;
  apply();
  stage.scrollLeft = cx * to - ax;
  stage.scrollTop = cy * to - ay;
}

// iOS may also fire dblclick after a double-tap; callers ignore dblclick right after a touch double-tap.
let lastTouchDoubleTap = 0;
export const recentTouchDoubleTap = () => Date.now() - lastTouchDoubleTap < 700;

export function bindTouchZoom(stage: HTMLElement, t: ZoomTarget) {
  const pts = new Map<number, {x: number; y: number}>();
  let pinch: {dist: number; zoom: number} | null = null,
    pan: {x: number; y: number; left: number; top: number} | null = null,
    moved = false,
    multi = false,
    start = {x: 0, y: 0},
    lastTap = {at: 0, x: 0, y: 0};
  const pair = () => [...pts.values()].slice(0, 2);
  const dist = () => {
    const [a, b] = pair();
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  const mid = () => {
    const [a, b] = pair();
    return {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
  };
  // Fitted images keep native vertical scrolling of the surrounding view; zoomed images own every touch.
  const update = () => {
    stage.style.touchAction = t.get() > 1 ? 'none' : 'pan-y';
  };
  stage.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (pts.size === 1) {
      start = {x: e.clientX, y: e.clientY};
      moved = false;
      multi = false;
      pan = t.get() > 1 ? {x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop} : null;
    } else {
      multi = true;
      pan = null;
      pinch = {dist: dist(), zoom: t.get()};
      e.preventDefault();
    }
  });
  stage.addEventListener('pointermove', e => {
    if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (pinch && pts.size >= 2) {
      t.set(clamp((pinch.zoom * dist()) / pinch.dist), mid());
      e.preventDefault();
      return;
    }
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) moved = true;
    if (pan) {
      stage.scrollLeft = pan.left - (e.clientX - pan.x);
      stage.scrollTop = pan.top - (e.clientY - pan.y);
      e.preventDefault();
    }
  });
  const end = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 0) {
      pan = null;
      if (e.type === 'pointerup' && !moved && !multi) {
        const now = Date.now();
        if (now - lastTap.at < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
          lastTap.at = 0;
          lastTouchDoubleTap = now;
          t.doubleTap({x: e.clientX, y: e.clientY});
        } else lastTap = {at: now, x: e.clientX, y: e.clientY};
      }
      update();
    }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  update();
  return {update, isMultiTouch: () => multi};
}
