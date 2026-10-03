/** Mouse dragging pans a zoomed image; touch keeps native scrolling/pinch behavior. */
export function bindImagePan(stage:HTMLElement,isZoomed:()=>boolean){
 let drag:{id:number;x:number;y:number;left:number;top:number}|null=null;
 const end=()=>{const id=drag?.id;drag=null;stage.classList.remove('is-panning');if(id!==undefined&&stage.hasPointerCapture?.(id))stage.releasePointerCapture(id);};
 const update=()=>{stage.classList.toggle('can-pan',isZoomed());if(!isZoomed())end();};
 stage.addEventListener('pointerdown',e=>{
  if(e.pointerType!=='mouse'||e.button!==0||!isZoomed())return;
  drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:stage.scrollLeft,top:stage.scrollTop};
  stage.setPointerCapture?.(e.pointerId);stage.classList.add('is-panning');e.preventDefault();
 });
 stage.addEventListener('pointermove',e=>{
  if(!drag||drag.id!==e.pointerId)return;
  if(!isZoomed()||!(e.buttons&1)){end();return;}
  stage.scrollLeft=drag.left-(e.clientX-drag.x);stage.scrollTop=drag.top-(e.clientY-drag.y);e.preventDefault();
 });
 for(const event of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(event,end);
 stage.addEventListener('dragstart',e=>{if(isZoomed())e.preventDefault();});
 update();return {update,end};
}
