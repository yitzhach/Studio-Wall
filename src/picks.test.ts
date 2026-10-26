// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import {it, expect, vi} from 'vitest';
import {database, STUDIO} from './data';
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('{}', {status: 503})),
);
const now = '2026-10-22T12:00:00.000Z';
const rec = (id: string, extra: object) => ({
  id,
  studio_id: STUDIO,
  created_at: now,
  updated_at: now,
  created_by: 'local-owner',
  actor_type: 'human',
  version: 1,
  deleted_at: null,
  ...extra,
});
const pin = (id: string, title: string) =>
  rec(id, {
    board_id: 'B1',
    file_ref: null,
    source_url: '',
    source_credit: '',
    is_own: true,
    note: title,
    tags: [],
    palette: [],
    linked_type: null,
    linked_id: null,
    meta: {kind: 'idea', title},
  });
const star = (id: string, pin_id: string, by: string, name: string, starred = true) =>
  rec(id, {board_id: 'B1', pin_id, text: '', starred, author_name: name, created_by: by});
it('shows the owner which cards each client starred, most-starred first', async () => {
  const db = await database;
  await db.put(
    'boards',
    rec('B1', {name: 'Living room', description: '', cover_pin_id: null, visibility: 'private', position: 1}),
  );
  for (const [id, t] of [
    ['P1', 'Linen'],
    ['P2', 'Walnut'],
    ['P3', 'Brass'],
  ])
    await db.put('pins', pin(id, t));
  await db.put('feedback', star('F1', 'P2', 'guest:a', 'Ana'));
  await db.put('feedback', star('F2', 'P2', 'guest:b', 'Ben'));
  await db.put('feedback', star('F3', 'P1', 'guest:b', 'Ben'));
  await db.put('feedback', star('F4', 'P3', 'guest:a', 'Ana', false));
  await db.put('feedback', rec('F5', {board_id: 'B1', pin_id: 'P3', text: '', starred: true}));
  document.body.innerHTML = '<div id="app"></div>';
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  await import('./main');
  await vi.waitFor(() => expect(document.querySelector('[data-nav="B1"]')).toBeTruthy());
  document.querySelector<HTMLElement>('.board-nav [data-nav="B1"]')!.click();
  const titles = () =>
    [...document.querySelectorAll('[data-pin] strong')].map(e => e.textContent!.replace('★ ', '').trim());
  expect(document.querySelector('[data-pin="P2"]')?.textContent).toContain('★ 2 clients');
  // Your own star is separate from client picks.
  document.querySelector<HTMLElement>('[data-filter="starred"]')!.click();
  expect(titles()).toEqual(['Brass']);
  document.querySelector<HTMLElement>('[data-filter="picks"]')!.click();
  expect(titles()).toEqual(['Walnut', 'Linen']);
  expect([...document.querySelectorAll('[data-pick-client]')].map(b => b.textContent!.trim())).toEqual([
    'All clients',
    'Ben 2',
    'Ana 1',
  ]);
  document.querySelector<HTMLElement>('[data-pick-client="guest:a"]')!.click();
  expect(titles()).toEqual(['Walnut']);
  document.querySelector<HTMLElement>('[data-pin="P2"]')!.click();
  expect(document.querySelector('.client-starred')?.textContent).toContain('Ana, Ben');
  // A client's star doesn't make the owner's own star button read "Starred".
  expect(document.querySelector('#star-pin')?.getAttribute('aria-pressed')).toBe('false');
});
