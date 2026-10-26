// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import {describe, it, expect, beforeEach, vi} from 'vitest';
import {action, database, snapshot, initialize, resetHistory} from './data';
import {validRecord} from '../worker/index';
// In-memory stand-in for the worker: same newest-wins rule and sequence cursor.
const server = {
  rows: new Map<string, {kind: string; data: any; seq: number}>(),
  files: new Map<string, Blob>(),
  seq: 0,
};
async function fakeFetch(path: string, init: RequestInit = {}) {
  const url = new URL(path, 'https://wall.test');
  const m = init.method || 'GET';
  const ok = (b: unknown) => new Response(JSON.stringify(b), {status: 200});
  if (url.pathname === '/api/me') return ok({email: 'owner@example.com'});
  if (url.pathname === '/api/boards')
    return ok({boards: [...server.rows.values()].filter(r => r.kind === 'boards').map(r => r.data)});
  if (url.pathname === '/api/sync' && m === 'POST') {
    for (const r of JSON.parse(init.body as string).records) {
      expect(validRecord(r.kind, r.data)).toBe(true);
      const k = r.kind + r.data.id,
        cur = server.rows.get(k);
      if (!cur || r.data.updated_at > cur.data.updated_at) server.rows.set(k, {...r, seq: ++server.seq});
    }
    return ok({ok: true});
  }
  if (url.pathname === '/api/sync') {
    const since = Number(url.searchParams.get('since'));
    const list = [...server.rows.values()].filter(r => r.seq > since).sort((a, b) => a.seq - b.seq);
    return ok({records: list, cursor: list.length ? list[list.length - 1].seq : since, more: false});
  }
  const ref = url.pathname.split('/').pop()!;
  if (m === 'PUT') {
    server.files.set(ref, init.body as Blob);
    return ok({ok: true});
  }
  const f = server.files.get(ref);
  return f ? new Response(m === 'HEAD' ? null : f, {status: 200}) : new Response(null, {status: 404});
}
const resetDevice = async () => {
  resetHistory();
  localStorage.clear();
  const db = await database;
  for (const s of ['boards', 'pins', 'files', 'feedback', 'activity_log', 'outbox']) await db.clear(s);
};
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  server.rows.clear();
  server.files.clear();
  server.seq = 0;
  await resetDevice();
});
describe('live sync', () => {
  it('pushes a board with its image and pulls it onto a second device', async () => {
    await initialize();
    const b = await action({type: 'board.create', payload: {name: 'Living room'}});
    const p = await action({
      type: 'pin.save',
      payload: {board_id: b.id, note: 'Plaster', palette: ['#aabbcc']},
      blob: new Blob(['img'], {type: 'image/webp'}),
    });
    const desk = await import('./sync');
    await desk.syncNow(() => {});
    expect(desk.syncStatus().state).toBe('on');
    expect(server.files.has(p.file_ref)).toBe(true);
    await resetDevice();
    await initialize();
    vi.resetModules();
    const phone = await import('./sync');
    let remote = 0;
    await phone.syncNow(() => remote++);
    const s = await snapshot();
    expect(remote).toBe(1);
    expect(s.boards.filter(x => x.name === 'Inbox')).toHaveLength(1);
    expect(s.pins.map(x => x.note)).toEqual(['Plaster']);
    expect(await (await database).get('files', p.file_ref)).toBeTruthy();
    await phone.syncNow(() => remote++);
    expect(remote).toBe(1);
  });
  it('keeps cards when an image is not available yet, then backfills it', async () => {
    await initialize();
    const b = await action({type: 'board.create', payload: {name: 'Studio'}});
    const p = await action({
      type: 'pin.save',
      payload: {board_id: b.id, note: 'Late image'},
      blob: new Blob(['img'], {type: 'image/webp'}),
    });
    await action({type: 'pin.save', payload: {board_id: b.id, note: 'Fine'}});
    await (await import('./sync')).syncNow(() => {});
    const held = server.files.get(p.file_ref)!;
    server.files.delete(p.file_ref);
    await resetDevice();
    await initialize();
    vi.resetModules();
    const phone = await import('./sync');
    await phone.syncNow(() => {});
    expect(phone.syncStatus().state).toBe('on');
    expect((await snapshot()).pins.map(x => x.note).sort()).toEqual(['Fine', 'Late image']);
    expect(await (await database).get('files', p.file_ref)).toBeUndefined();
    server.files.set(p.file_ref, held);
    await phone.syncNow(() => {});
    expect(await (await database).get('files', p.file_ref)).toBeTruthy();
  });
  it('moves a card its client removed into Recently deleted, where the owner can restore it', async () => {
    await initialize();
    const b = await action({type: 'board.create', payload: {name: 'Kitchen'}});
    const s1 = await import('./sync');
    await s1.syncNow(() => {});
    const t0 = new Date(Date.now() + 1000).toISOString(),
      t1 = new Date(Date.now() + 2000).toISOString();
    const card = {
      id: 'C1',
      studio_id: 'local-studio',
      created_at: t0,
      updated_at: t0,
      created_by: 'guest:abc',
      actor_type: 'human',
      version: 1,
      deleted_at: null,
      board_id: b.id,
      file_ref: null,
      source_url: '',
      source_credit: '',
      is_own: false,
      note: 'Wrong one',
      tags: [],
      palette: [],
      linked_type: null,
      linked_id: null,
      annotations: [],
      meta: {kind: 'idea', title: ''},
      contributor_name: 'Ana',
    };
    server.rows.set('pinsC1', {kind: 'pins', data: card, seq: ++server.seq});
    await s1.syncNow(() => {});
    expect((await snapshot()).pins.some(p => p.id === 'C1')).toBe(true);
    server.rows.set('pinsC1', {
      kind: 'pins',
      data: {...card, deleted_at: t1, deleted_by: 'guest:abc', updated_at: t1, version: 2},
      seq: ++server.seq,
    });
    let remote = 0;
    await s1.syncNow(() => {
      remote++;
    });
    expect(remote).toBe(1);
    expect((await snapshot()).pins.some(p => p.id === 'C1')).toBe(false);
    // The owner app lists it as a client removal (toast, badge, board notice) until it is restored.
    expect((await snapshot()).removed.map(p => [p.id, p.contributor_name])).toEqual([['C1', 'Ana']]);
    const {recentlyDeleted} = await import('./data');
    expect((await recentlyDeleted()).pins.map(p => p.id)).toEqual(['C1']);
    await action({type: 'pin.restore', id: 'C1'});
    expect((await snapshot()).pins.find(p => p.id === 'C1')?.board_id).toBe(b.id);
    const back = await snapshot();
    expect(back.removed).toEqual([]);
    expect(back.pins.find(p => p.id === 'C1')?.deleted_by).toBeNull();
    // Deleted again by the owner, it is not reported as a client removal.
    await action({type: 'pin.delete', id: 'C1'});
    expect((await snapshot()).removed).toEqual([]);
  });
  it('stays device-local when the API is not configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', {status: 503})),
    );
    const s = await import('./sync');
    await s.syncNow(() => {});
    expect(s.syncStatus().state).toBe('off');
  });
  it('worker rejects malformed records', () => {
    expect(validRecord('pins', {id: '../x', board_id: 'a', updated_at: '2026-01-01T00:00:00Z'})).toBe(false);
    expect(validRecord('users', {id: 'a', updated_at: '2026-01-01T00:00:00Z'})).toBe(false);
    expect(validRecord('boards', {id: 'A1', updated_at: '2026-01-01T00:00:00Z'})).toBe(true);
  });
});
describe('worker upload checks', () => {
  it('identifies images by their bytes and rejects anything else', async () => {
    const {sniffImage} = await import('../worker/index');
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBe('image/png');
    expect(sniffImage(enc('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(enc('\0\0\0\x18ftypheic'))).toBe('image/heic');
    expect(sniffImage(enc('<svg xmlns='))).toBeNull();
    expect(sniffImage(enc('<html>'))).toBeNull();
  });
});
