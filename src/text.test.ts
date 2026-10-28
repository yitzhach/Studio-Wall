import {describe, expect, it} from 'vitest';
import {esc, isHttpUrl} from './text';

describe('esc', () => {
  it('escapes the five HTML characters', () => {
    expect(esc(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
  it('turns null and undefined into an empty string and other values into text', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(0)).toBe('0');
  });
});

describe('isHttpUrl', () => {
  it('accepts http and https links in any case', () => {
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('HTTP://example.com')).toBe(true);
  });
  it('refuses other schemes and bare text', () => {
    for (const s of ['', 'javascript:alert(1)', 'ftp://x', 'example.com', ' https://x'])
      expect(isHttpUrl(s)).toBe(false);
  });
});
