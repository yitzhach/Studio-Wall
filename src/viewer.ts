import type {Pin} from './data';

/** A viewport-filling dialog also works where browser fullscreen is unavailable. */
export function openGallery(pins:Pin[], image:(p:Pin)=>string|null|undefined, start:string){
 const items=pins.filter(p=>image(p));if(!items.length)return;
 let index=Math.max(0,items.findIndex(p=>p.id===start)),zoom=1;
 const d=document.createElement('dialog');d.className='gallery';
 d.innerHTML='<div class="gallery-bar"><span class="gallery-title"></span><button data-g="out" aria-label="Zoom out">−</button><button data-g="fit">Fit</button><button data-g="in" aria-label="Zoom in">+</button><button data-g="screen">Fullscreen</button><button data-g="close" aria-label="Close gallery">✕</button></div><div class="gallery-stage"><img draggable="false" alt=""></div><div class="gallery-nav"><button data-g="prev" aria-label="Previous image">← Previous</button><span aria-live="polite"></span><button data-g="next" aria-label="Next image">Next →</button></div>';
 document.body.append(d);const stage=d.querySelector<HTMLElement>('.gallery-stage')!,img=d.querySelector<HTMLImageElement>('img')!;
 const sizing=()=>{img.style.width=zoom===1?'100%':`${stage.clientWidth*zoom}px`;img.style.height=zoom===1?'100%':`${stage.clientHeight*zoom}px`;d.querySelector('[data-g=fit]')!.textContent=zoom===1?'Fit':`${Math.round(zoom*100)}% · Fit`;};
 const draw=()=>{const p=items[index];img.src=image(p)!;img.alt=p.meta.title||'Saved reference';d.querySelector('.gallery-title')!.textContent=p.meta.title||'Untitled reference';d.querySelector('.gallery-nav span')!.textContent=`${index+1} / ${items.length}`;zoom=1;sizing();stage.scrollTo?.(0,0);};
 const step=(n:number)=>{index=(index+n+items.length)%items.length;draw();};
 const scale=(n:number)=>{zoom=Math.min(4,Math.max(1,zoom+n));sizing();};
 d.querySelectorAll<HTMLButtonElement>('[data-g]').forEach(b=>b.onclick=()=>{switch(b.dataset.g){case 'close':d.close();break;case 'prev':step(-1);break;case 'next':step(1);break;case 'in':scale(.25);break;case 'out':scale(-.25);break;case 'fit':zoom=1;sizing();break;case 'screen':if(document.fullscreenElement===d)void document.exitFullscreen();else void d.requestFullscreen?.().catch(()=>{});}});
 if(!d.requestFullscreen)d.querySelector('[data-g=screen]')!.remove();
 d.onkeydown=e=>{if(['ArrowLeft','ArrowRight','+','=','-','0'].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==='ArrowLeft')step(-1);if(e.key==='ArrowRight')step(1);if(e.key==='+'||e.key==='=')scale(.25);if(e.key==='-')scale(-.25);if(e.key==='0'){zoom=1;sizing();}}};
 img.ondblclick=()=>{zoom=zoom===1?2:1;sizing();};
 let touchX=0,touchY=0;stage.addEventListener('touchstart',e=>{if(e.touches.length===1){touchX=e.touches[0].clientX;touchY=e.touches[0].clientY;}},{passive:true});stage.addEventListener('touchend',e=>{const t=e.changedTouches[0];if(zoom===1&&t&&Math.abs(t.clientX-touchX)>70&&Math.abs(t.clientY-touchY)<60)step(t.clientX<touchX?1:-1);},{passive:true});
 const resize=()=>sizing();window.addEventListener('resize',resize);d.addEventListener('close',()=>{window.removeEventListener('resize',resize);d.remove();},{once:true});d.showModal();draw();
}

export function openPresentation(pins:Pin[],image:(p:Pin)=>string|null|undefined,title:string){
 const d=document.createElement('dialog');d.className='presentation';
 const controls=document.createElement('div');controls.className='presentation-controls';
 const help=document.createElement('p');help.textContent='Client presentation · Titles, credits and text references included; image notes omitted. Choose Save as PDF in the print dialog, then attach it to your email.';
 const print=document.createElement('button');print.className='primary';print.textContent='Print / Save PDF';
 const close=document.createElement('button');close.textContent='Close';close.onclick=()=>d.close();controls.append(help,print,close);d.append(controls);
 const heading=document.createElement('h1');heading.textContent=title;d.append(heading);
 const sub=document.createElement('p');sub.textContent=`Studio Wall · ${pins.length} reference${pins.length===1?'':'s'}`;d.append(sub);
 const grid=document.createElement('div');grid.className='presentation-grid';d.append(grid);
 for(const p of pins){const figure=document.createElement('figure');const src=image(p);if(src){const img=document.createElement('img');img.src=src;img.alt=p.meta.title||'Reference';figure.append(img);}const caption=document.createElement('figcaption');const name=document.createElement('strong');name.textContent=p.meta.title||'Untitled reference';const credit=document.createElement('p');credit.textContent=p.is_own?'Artist’s own work':p.source_credit||'Credit not added';caption.append(name,credit);if(!src){const note=document.createElement('p');note.textContent=p.note||p.source_url;caption.append(note);}figure.append(caption);grid.append(figure);}
 print.onclick=async()=>{print.disabled=true;await Promise.all(Array.from(d.querySelectorAll('img')).map(img=>img.decode?.().catch(()=>{})));document.body.classList.add('printing-presentation');window.print();print.disabled=false;};
 const cleanup=()=>document.body.classList.remove('printing-presentation');window.addEventListener('afterprint',cleanup);d.addEventListener('close',()=>{cleanup();window.removeEventListener('afterprint',cleanup);d.remove();},{once:true});document.body.append(d);d.showModal();
}
