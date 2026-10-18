import {it,expect} from 'vitest';
import {sniffFormat,isImageFile} from './media';
const bytes=(...parts:(string|number[])[])=>new Blob(parts.map(p=>typeof p==='string'?new TextEncoder().encode(p):new Uint8Array(p)));
it('recognises HEIC and TIFF by their bytes so they can be converted where the browser cannot open them',async()=>{
 expect(await sniffFormat(bytes([0,0,0,24],'ftypheic'))).toBe('heic');
 expect(await sniffFormat(bytes([0,0,0,24],'ftypmif1'))).toBe('heic');
 expect(await sniffFormat(bytes([0x49,0x49,0x2a,0]))).toBe('tiff');
 expect(await sniffFormat(bytes([0x4d,0x4d,0,0x2a]))).toBe('tiff');
 expect(await sniffFormat(bytes([0xff,0xd8,0xff,0xe0]))).toBeNull();
});
it('accepts image files even when the browser reports no MIME type',()=>{
 expect(isImageFile(new File([],'IMG_0001.HEIC'))).toBe(true);
 expect(isImageFile(new File([],'scan.tiff'))).toBe(true);
 expect(isImageFile(new File([],'x',{type:'image/avif'}))).toBe(true);
 expect(isImageFile(new File([],'notes.pdf'))).toBe(false);
});
