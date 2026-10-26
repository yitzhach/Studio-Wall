import {it, expect} from 'vitest';
import {colourWords} from './colour';
it('names palette colours in plain words', () => {
  expect(colourWords('#2850a0')).toEqual(expect.arrayContaining(['blue', 'cool']));
  expect(colourWords('#c82828')).toEqual(expect.arrayContaining(['red', 'warm']));
  expect(colourWords('#784828')).toEqual(expect.arrayContaining(['brown', 'warm']));
  expect(colourWords('#a0a0a0')).toEqual(expect.arrayContaining(['grey', 'neutral']));
  expect(colourWords('#f0f0f0')).toContain('white');
  expect(colourWords('#141414')).toContain('black');
  expect(colourWords('#28a078')).toContain('green');
  expect(colourWords('#c8c828')).toContain('yellow');
  expect(colourWords('bad')).toEqual([]);
});
