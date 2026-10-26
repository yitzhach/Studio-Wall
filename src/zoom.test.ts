// @vitest-environment happy-dom
import {it, expect, vi} from 'vitest';
import {bindTouchZoom} from './zoom';
const touch = (stage: HTMLElement, type: string, id: number, x: number, y: number) =>
  stage.dispatchEvent(
    new PointerEvent(type, {
      pointerType: 'touch',
      pointerId: id,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
it('pinches to zoom within 100–400% and pans with one finger once zoomed', () => {
  const stage = document.createElement('div');
  let zoom = 1;
  const set = vi.fn((z: number) => {
    zoom = z;
  });
  const t = bindTouchZoom(stage, {get: () => zoom, set, doubleTap: vi.fn()});
  expect(stage.style.touchAction).toBe('pan-y');
  touch(stage, 'pointerdown', 1, 100, 100);
  touch(stage, 'pointerdown', 2, 200, 100);
  touch(stage, 'pointermove', 2, 300, 100);
  expect(zoom).toBe(2);
  expect(set).toHaveBeenLastCalledWith(2, {x: 200, y: 100});
  touch(stage, 'pointermove', 2, 1100, 100);
  expect(zoom).toBe(4);
  touch(stage, 'pointerup', 2, 1100, 100);
  touch(stage, 'pointerup', 1, 100, 100);
  expect(stage.style.touchAction).toBe('none');
  expect(t.isMultiTouch()).toBe(true);
  stage.scrollLeft = 300;
  stage.scrollTop = 300;
  touch(stage, 'pointerdown', 3, 150, 150);
  touch(stage, 'pointermove', 3, 100, 120);
  expect(stage.scrollLeft).toBe(350);
  expect(stage.scrollTop).toBe(330);
  touch(stage, 'pointerup', 3, 100, 120);
});
it('fires double-tap only for two quick taps in the same spot, never for mouse or after a pinch', () => {
  const stage = document.createElement('div');
  const doubleTap = vi.fn();
  bindTouchZoom(stage, {get: () => 1, set: vi.fn(), doubleTap});
  const tap = (x: number) => {
    touch(stage, 'pointerdown', 9, x, 50);
    touch(stage, 'pointerup', 9, x, 50);
  };
  tap(50);
  tap(200);
  expect(doubleTap).not.toHaveBeenCalled();
  tap(200);
  expect(doubleTap).toHaveBeenCalledWith({x: 200, y: 50});
  stage.dispatchEvent(new PointerEvent('pointerdown', {pointerType: 'mouse', pointerId: 4}));
  stage.dispatchEvent(new PointerEvent('pointerup', {pointerType: 'mouse', pointerId: 4}));
  touch(stage, 'pointerdown', 1, 10, 10);
  touch(stage, 'pointerdown', 2, 40, 10);
  touch(stage, 'pointerup', 2, 40, 10);
  touch(stage, 'pointerup', 1, 10, 10);
  tap(10);
  expect(doubleTap).toHaveBeenCalledTimes(1);
});
