// @vitest-environment happy-dom
import {it,expect} from 'vitest';
import {openGallery,openPresentation,buildPdf} from './viewer';
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

it('builds a compact valid JPEG PDF container',async()=>{const pdf=buildPdf([{bytes:new Uint8Array([255,216,255,217]),width:10,height:10}]);expect(pdf.type).toBe('application/pdf');const text=new TextDecoder().decode(await pdf.arrayBuffer());expect(text.startsWith('%PDF-1.4')).toBe(true);expect(text).toContain('/Filter /DCTDecode');expect(text).toContain('startxref');expect(text.endsWith('%%EOF')).toBe(true);});
