// @vitest-environment happy-dom
import {it,expect} from 'vitest';
import {openGallery,openPresentation} from './viewer';
import type {Pin} from './data';
const pins=[{id:'a',meta:{title:'First',kind:'image'},note:'PRIVATE',source_credit:'Artist A'},{id:'b',meta:{title:'Second',kind:'image'},note:'PRIVATE',source_credit:'Artist B'}] as Pin[];
it('navigates the image carousel, resets zoom between images and scopes presentations',()=>{
 HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new Event('close'));};
 openGallery(pins,()=>'/sample-plaster.webp','a');
 const d=document.querySelector<HTMLDialogElement>('.gallery')!;
 d.querySelector<HTMLButtonElement>('[data-g=in]')!.click();expect(d.querySelector('[data-g=fit]')!.textContent).toContain('125');
 d.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));expect(d.querySelector('.gallery-title')!.textContent).toBe('Second');expect(d.querySelector('[data-g=fit]')!.textContent).toBe('Fit');
 d.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));expect(d.querySelector('.gallery-title')!.textContent).toBe('First');d.close();expect(document.querySelector('.gallery')).toBeNull();
 openPresentation([pins[1]],()=>'/sample-plaster.webp','Client selection');const presentation=document.querySelector<HTMLDialogElement>('.presentation')!;expect(presentation.querySelectorAll('figure')).toHaveLength(1);expect(presentation.textContent).toContain('Artist B');expect(presentation.textContent).not.toContain('PRIVATE');presentation.close();
});
