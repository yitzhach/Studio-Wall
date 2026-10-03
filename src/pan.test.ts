// @vitest-environment happy-dom
import {it,expect,vi} from 'vitest';
import {bindImagePan} from './pan';
it('pans zoomed images with mouse deltas and releases capture on cancellation and Fit',()=>{
 const stage=document.createElement('div');let zoomed=true;
 stage.setPointerCapture=vi.fn();stage.hasPointerCapture=()=>true;stage.releasePointerCapture=vi.fn();
 stage.scrollLeft=200;stage.scrollTop=100;
 const pan=bindImagePan(stage,()=>zoomed);
 const send=(type:string,x:number,y:number)=>stage.dispatchEvent(new PointerEvent(type,{pointerType:'mouse',pointerId:1,button:0,buttons:1,clientX:x,clientY:y}));
 send('pointerdown',100,100);send('pointermove',130,120);
 expect(stage.scrollLeft).toBe(170);expect(stage.scrollTop).toBe(80);expect(stage.classList.contains('is-panning')).toBe(true);
 send('pointercancel',130,120);expect(stage.releasePointerCapture).toHaveBeenCalledWith(1);
 send('pointermove',150,150);expect(stage.scrollLeft).toBe(170);
 send('pointerdown',100,100);zoomed=false;pan.update();expect(stage.classList.contains('can-pan')).toBe(false);expect(stage.classList.contains('is-panning')).toBe(false);
});
it('leaves fit images, touch and right-click gestures alone',()=>{
 const stage=document.createElement('div');let zoomed=false;stage.setPointerCapture=vi.fn();const pan=bindImagePan(stage,()=>zoomed);
 const down=(pointerType:string,button:number)=>stage.dispatchEvent(new PointerEvent('pointerdown',{pointerType,button,pointerId:1}));
 down('mouse',0);zoomed=true;pan.update();down('touch',0);down('mouse',2);
 expect(stage.setPointerCapture).not.toHaveBeenCalled();
});
