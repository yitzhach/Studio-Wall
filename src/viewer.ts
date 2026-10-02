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

const enc=new TextEncoder();
function concat(parts:Uint8Array[]){const size=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(size);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}
/** Minimal JPEG-only PDF writer: one compressed contact-sheet JPEG per page. */
export function buildPdf(pages:{bytes:Uint8Array;width:number;height:number}[]):Blob{
 const objects:Uint8Array[]=[];const add=(body:Uint8Array|string)=>{objects.push(typeof body==='string'?enc.encode(body):body);return objects.length;};
 const catalog=add('<< /Type /Catalog /Pages 2 0 R >>');void catalog;add('');
 const kids:number[]=[];
 for(const page of pages){
  const imageId=objects.length+2,contentId=objects.length+3,pageId=objects.length+1;kids.push(pageId);
  add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im${pageId} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
  const prefix=enc.encode(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\\nstream\\n`);
  const suffix=enc.encode('\\nendstream');add(concat([prefix,page.bytes,suffix]));
  const command=`q 612 0 0 792 0 0 cm /Im${pageId} Do Q`;add(`<< /Length ${command.length} >>\\nstream\\n${command}\\nendstream`);
 }
 objects[1]=enc.encode(`<< /Type /Pages /Kids [${kids.map(id=>id+' 0 R').join(' ')}] /Count ${kids.length} >>`);
 const header=enc.encode('%PDF-1.4\\n%StudioWall\\n'),parts=[header],offsets=[0];let offset=header.length;
 objects.forEach((body,i)=>{offsets[i+1]=offset;const pre=enc.encode(`${i+1} 0 obj\\n`),post=enc.encode('\\nendobj\\n');parts.push(pre,body,post);offset+=pre.length+body.length+post.length;});
 const xref=offset;let table=`xref\\n0 ${objects.length+1}\\n0000000000 65535 f \\n`;for(let i=1;i<=objects.length;i++)table+=String(offsets[i]).padStart(10,'0')+' 00000 n \\n';
 parts.push(enc.encode(table+`trailer\\n<< /Size ${objects.length+1} /Root 1 0 R >>\\nstartxref\\n${xref}\\n%%EOF`));return new Blob(parts as BlobPart[],{type:'application/pdf'});
}
function loadImage(src:string){return new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(Error('One of the board images could not be prepared for PDF.'));img.src=src;});}
function fit(ctx:CanvasRenderingContext2D,img:HTMLImageElement,x:number,y:number,w:number,h:number){const s=Math.min(w/img.naturalWidth,h/img.naturalHeight),dw=img.naturalWidth*s,dh=img.naturalHeight*s;ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);}
function cleanText(value:string,max=62){const s=value.replace(/\\s+/g,' ').trim();return s.length>max?s.slice(0,max-1)+'…':s;}
async function exportSmallPdf(pins:Pin[],image:(p:Pin)=>string|null|undefined,title:string){
 const width=1275,height=1650,perPage=4,pages:{bytes:Uint8Array;width:number;height:number}[]=[];
 for(let pageStart=0;pageStart<pins.length;pageStart+=perPage){const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d')!;ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);ctx.fillStyle='#171717';ctx.font='600 42px Arial, sans-serif';ctx.fillText(cleanText(title,45),70,75);ctx.font='22px Arial, sans-serif';ctx.fillStyle='#666666';ctx.fillText(`Studio Wall · ${pins.length} reference${pins.length===1?'':'s'}`,70,112);
  const items=pins.slice(pageStart,pageStart+perPage);
  for(let i=0;i<items.length;i++){const p=items[i],col=i%2,row=Math.floor(i/2),x=70+col*585,y=155+row*720,w=535,h=535;ctx.fillStyle='#f3f3f3';ctx.fillRect(x,y,w,h);const src=image(p);if(src){const img=await loadImage(src);fit(ctx,img,x,y,w,h);}else{ctx.fillStyle='#444';ctx.font='28px Arial, sans-serif';ctx.fillText(cleanText(p.note||p.source_url||'Reference',32),x+25,y+70);}ctx.fillStyle='#171717';ctx.font='600 25px Arial, sans-serif';ctx.fillText(cleanText(p.meta.title||'Untitled reference',38),x,y+h+42);ctx.fillStyle='#666';ctx.font='20px Arial, sans-serif';ctx.fillText(cleanText(p.is_own?'Artist’s own work':p.source_credit||'Credit not added',45),x,y+h+76);}
  const jpeg=await new Promise<Blob>((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('Could not compress the PDF page.')),'image/jpeg',.76));pages.push({bytes:new Uint8Array(await jpeg.arrayBuffer()),width,height});
 }
 const pdf=buildPdf(pages),url=URL.createObjectURL(pdf),a=document.createElement('a');a.href=url;a.download=(title.replace(/[^a-z0-9_-]/gi,'-')||'studio-wall')+'-small.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);return pdf.size;
}

export function openPresentation(pins:Pin[],image:(p:Pin)=>string|null|undefined,title:string){
 const d=document.createElement('dialog');d.className='presentation';
 const controls=document.createElement('div');controls.className='presentation-controls';
 const help=document.createElement('p');help.textContent='Sharing a live board link will be the primary client workflow once the backend is connected. For attachments, Small PDF makes a compressed contact-sheet PDF; Print keeps the browser’s full-quality print workflow.';
 const small=document.createElement('button');small.className='primary';small.textContent='Download small PDF';
 const print=document.createElement('button');print.textContent='Print / full-quality PDF';
 const close=document.createElement('button');close.textContent='Close';close.onclick=()=>d.close();controls.append(help,small,print,close);d.append(controls);
 const heading=document.createElement('h1');heading.textContent=title;d.append(heading);
 const sub=document.createElement('p');sub.textContent=`Studio Wall · ${pins.length} reference${pins.length===1?'':'s'}`;d.append(sub);
 const grid=document.createElement('div');grid.className='presentation-grid';d.append(grid);
 for(const p of pins){const figure=document.createElement('figure');const src=image(p);if(src){const img=document.createElement('img');img.src=src;img.alt=p.meta.title||'Reference';figure.append(img);}const caption=document.createElement('figcaption');const name=document.createElement('strong');name.textContent=p.meta.title||'Untitled reference';const credit=document.createElement('p');credit.textContent=p.is_own?'Artist’s own work':p.source_credit||'Credit not added';caption.append(name,credit);if(!src){const note=document.createElement('p');note.textContent=p.note||p.source_url;caption.append(note);}figure.append(caption);grid.append(figure);}
 small.onclick=async()=>{small.disabled=true;small.textContent='Building small PDF…';try{const bytes=await exportSmallPdf(pins,image,title);small.textContent=`Downloaded · ${(bytes/1024/1024).toFixed(1)} MB`;}catch(e){small.textContent=(e as Error).message||'PDF failed';}finally{setTimeout(()=>{small.disabled=false;small.textContent='Download small PDF';},3500);}};
 print.onclick=async()=>{print.disabled=true;await Promise.all(Array.from(d.querySelectorAll('img')).map(img=>img.decode?.().catch(()=>{})));document.body.classList.add('printing-presentation');window.print();print.disabled=false;};
 const cleanup=()=>document.body.classList.remove('printing-presentation');window.addEventListener('afterprint',cleanup);d.addEventListener('close',()=>{cleanup();window.removeEventListener('afterprint',cleanup);d.remove();},{once:true});document.body.append(d);d.showModal();
}
