/** Start on grid whitespace so dragging a reference still moves the selected group. */
export function bindMarquee(grid:HTMLElement, selected:Set<string>, finish:()=>void){
 grid.addEventListener('pointerdown',start=>{
  if(start.button!==0||start.pointerType!=='mouse'||start.target!==grid)return;
  start.preventDefault();
  const original=new Set(selected),additive=start.shiftKey||start.ctrlKey||start.metaKey;
  const x=start.clientX+window.scrollX,y=start.clientY+window.scrollY;
  const overlay=document.createElement('div');overlay.className='selection-marquee';overlay.setAttribute('aria-hidden','true');
  const cards=Array.from(grid.querySelectorAll<HTMLElement>('[data-drag-pin]'));
  const previousSelect=document.body.style.userSelect;document.body.style.userSelect='none';
  let moved=false;
  const paint=()=>cards.forEach(card=>{const active=selected.has(card.dataset.dragPin!);card.classList.toggle('is-selected',active);const button=card.querySelector('[data-select-pin]');button?.setAttribute('aria-pressed',String(active));if(button)button.textContent=active?'✓':'○';});
  const move=(e:PointerEvent)=>{
   if(e.pointerId!==start.pointerId)return;
   const endX=e.clientX+window.scrollX,endY=e.clientY+window.scrollY;
   if(!moved&&Math.hypot(endX-x,endY-y)<5)return;
   if(!moved){moved=true;document.body.append(overlay);}
   const left=Math.min(x,endX),top=Math.min(y,endY),right=Math.max(x,endX),bottom=Math.max(y,endY);
   Object.assign(overlay.style,{left:`${left}px`,top:`${top}px`,width:`${right-left}px`,height:`${bottom-top}px`});
   selected.clear();if(additive)original.forEach(id=>selected.add(id));
   for(const card of cards){const r=card.getBoundingClientRect();if(r.right+scrollX>left&&r.left+scrollX<right&&r.bottom+scrollY>top&&r.top+scrollY<bottom)selected.add(card.dataset.dragPin!);}
   paint();
  };
  const cleanup=(cancel:boolean)=>{
   window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancelPointer);window.removeEventListener('blur',cancelAll);document.removeEventListener('keydown',key);
   overlay.remove();document.body.style.userSelect=previousSelect;
   if(cancel){selected.clear();original.forEach(id=>selected.add(id));}else if(!moved&&!additive)selected.clear();
   paint();finish();
  };
  const up=(e:PointerEvent)=>{if(e.pointerId===start.pointerId){move(e);cleanup(false);}};
  const cancelPointer=(e:PointerEvent)=>{if(e.pointerId===start.pointerId)cleanup(true);};
  const cancelAll=()=>cleanup(true);
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();cleanup(true);}};
  window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancelPointer);window.addEventListener('blur',cancelAll);document.addEventListener('keydown',key);
 });
}
