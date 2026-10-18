/** Plain-language colour words for a palette hex, so search can match "blue", "warm", "dark"… not just exact hex codes. */
export function colourWords(hex:string):string[]{
 const m=/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);if(!m)return [];
 const [r,g,b]=m.slice(1).map(x=>parseInt(x,16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2,d=max-min;
 const s=d===0?0:d/(1-Math.abs(2*l-1));
 let h=0;if(d){h=max===r?((g-b)/d)%6:max===g?(b-r)/d+2:(r-g)/d+4;h=(h*60+360)%360;}
 const tone=l<.3?['dark']:l>.7?['light']:[];
 if(l<.13)return ['black','dark','neutral'];
 if(l>.9&&s<.35)return ['white','light','neutral'];
 if(s<.15)return ['grey','gray','neutral',...tone];
 let name:string;
 if(h<15||h>=345)name='red';else if(h<40)name=l<.45?'brown':'orange';else if(h<65)name=l<.35?'brown':'yellow';
 else if(h<165)name='green';else if(h<195)name='teal';else if(h<255)name='blue';else if(h<290)name='purple';else name='pink';
 const extra:Record<string,string[]>={teal:['cyan','turquoise'],purple:['violet'],pink:['magenta'],brown:['earth']};
 const warm=['red','orange','yellow','pink','brown'].includes(name);
 return [name,...(extra[name]||[]),warm?'warm':'cool',...tone];
}
