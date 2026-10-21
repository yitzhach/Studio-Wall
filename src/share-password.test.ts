import {describe,it,expect} from 'vitest';
import {hashPassword,checkPassword} from '../worker/index';
describe('client link passwords',()=>{
 it('stores a salted PBKDF2 hash that only the right password matches',async()=>{
  const a=await hashPassword('coastal-blue'),b=await hashPassword('coastal-blue');
  expect(a).toMatch(/^pbkdf2\$20000\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}$/);expect(a).not.toBe(b);expect(a).not.toContain('coastal');
  expect(await checkPassword('coastal-blue',a)).toBe(true);expect(await checkPassword('coastal-blue',b)).toBe(true);
  expect(await checkPassword('Coastal-blue',a)).toBe(false);expect(await checkPassword('',a)).toBe(false);
 });
 it('rejects stored values it does not recognise',async()=>{const h=await hashPassword('coastal-blue');
  expect(await checkPassword('coastal-blue',h.replace('pbkdf2','plain'))).toBe(false);expect(await checkPassword('coastal-blue','')).toBe(false);
  expect(await checkPassword('coastal-blue',h.slice(0,h.lastIndexOf('$')+1)+btoa('x'.repeat(32)))).toBe(false);
 });
});
