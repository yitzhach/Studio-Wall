// @vitest-environment happy-dom
import {it,expect,vi} from 'vitest';
import {bindMarquee} from './selection';
it('box selects multiple cards, adds to selection, cancels and leaves native card drags alone',()=>{
 document.body.innerHTML='<div id="grid"><div data-drag-pin="a"><button>Image A</button></div><div data-drag-pin="b"></div><div data-drag-pin="c"></div></div>';
 const grid=document.querySelector<HTMLElement>('#grid')!,cards=grid.querySelectorAll<HTMLElement>('[data-drag-pin]');
 cards.forEach((card,i)=>{card.getBoundingClientRect=()=>({left:20+i*100,right:100+i*100,top:20,bottom:100,width:80,height:80,x:20+i*100,y:20,toJSON:()=>{}});});
 const selected=new Set<string>(),finish=vi.fn();bindMarquee(grid,selected,finish);
 const down=(x:number,y:number,shiftKey=false,target:EventTarget=grid)=>target.dispatchEvent(new PointerEvent('pointerdown',{pointerType:'mouse',pointerId:1,button:0,clientX:x,clientY:y,shiftKey,bubbles:true}));
 const move=(x:number,y:number)=>window.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:x,clientY:y}));
 const up=(x:number,y:number)=>window.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,clientX:x,clientY:y}));
 down(0,0);move(201,110);expect([...selected]).toEqual(['a','b']);expect(document.querySelector('.selection-marquee')).toBeTruthy();up(201,110);expect(finish).toHaveBeenCalledTimes(1);expect(document.querySelector('.selection-marquee')).toBeNull();
 down(210,0,true);up(310,110);expect([...selected]).toEqual(['a','b','c']);
 down(0,0);move(110,110);expect([...selected]).toEqual(['a']);document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));expect([...selected]).toEqual(['a','b','c']);
 const calls=finish.mock.calls.length;down(25,25,false,cards[0].querySelector('button')!);move(60,60);up(60,60);expect(finish).toHaveBeenCalledTimes(calls);
 down(0,0);up(0,0);expect(selected.size).toBe(0);
});
