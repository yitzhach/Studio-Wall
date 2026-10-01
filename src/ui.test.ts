// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import {it,expect,vi} from 'vitest';
import {snapshot} from './data';
it('creates a board, saves and edits an idea, searches, and previews feedback',async()=>{
 document.body.innerHTML='<div id="app"></div>';
 HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
 await import('./main');
 await vi.waitFor(()=>expect(document.querySelector('h1')?.textContent).toContain('All inspiration'));
 const click=(selector:string)=>{const el=document.querySelector<HTMLElement>(selector);expect(el).toBeTruthy();el!.click();};
 click('[data-action="theme"]');expect(document.documentElement.dataset.theme).toBe('light');
 click('[data-action="new-board"]');
 (document.querySelector('[name=name]') as HTMLInputElement).value='Client study';
 document.querySelector('dialog form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 await vi.waitFor(()=>expect(document.querySelector('h1')?.textContent).toContain('Client study'));
 click('[data-action="save"]');(document.querySelector('[name=title]') as HTMLInputElement).value='Warm texture';(document.querySelector('[name=note]') as HTMLTextAreaElement).value='A pale plaster study';
 document.querySelector('#save-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 await vi.waitFor(()=>expect(document.querySelector('[data-pin]')?.textContent).toContain('Warm texture'));
 click('[data-pin]');(document.querySelector('[name=note]') as HTMLTextAreaElement).value='A revised direction';
 document.querySelector('#edit-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 await vi.waitFor(async()=>expect((await snapshot()).pins[0].note).toBe('A revised direction'));
 click('[data-action="share"]');click('#client-preview');expect(document.querySelector('.preview-banner')?.textContent).toContain('local demonstration');
 (document.querySelector('#feedback-text') as HTMLTextAreaElement).value='Try a little more blue.';
 document.querySelector('#feedback-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 await vi.waitFor(()=>expect(document.querySelector('.feedback article')?.textContent).toContain('more blue'));
 const search=document.querySelector<HTMLInputElement>('#search')!;search.value='nonexistent';search.dispatchEvent(new Event('input'));expect(document.querySelectorAll('[data-pin]')).toHaveLength(0);
});
