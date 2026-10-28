// Actions data.test.ts doesn't reach directly: sync's merge and image backfill, board import, links, refusals.
import 'fake-indexeddb/auto';
import {describe, it, expect, beforeEach} from 'vitest';
import {action, database, snapshot, resetHistory} from './data';

const T = '2026-01-01T00:00:00.000Z',
  LATER = '2026-02-01T00:00:00.000Z';
const ID = (n: number) => '01JAAAAAAAAAAAAAAAAAAAAA' + String(n).padStart(2, '0');
const board = (n: number, extra = {}) => ({id: ID(n), name: 'Board ' + n, updated_at: T, ...extra});
const pin = (n: number, b: number, extra = {}) => ({
  id: ID(n),
  board_id: ID(b),
  updated_at: T,
  note: 'card ' + n,
  tags: [],
  palette: [],
  file_ref: null,
  ...extra,
});
const counts = async () => {
  const db = await database;
  return {log: await db.count('activity_log'), outbox: await db.count('outbox')};
};

beforeEach(async () => {
  resetHistory();
  const db = await database;
  for (const s of ['boards', 'pins', 'files', 'feedback', 'activity_log', 'outbox']) await db.clear(s);
});

describe('library.merge', () => {
  it('adds new records, keeps the newer copy, and logs one event', async () => {
    const merge = (payload: any) => action({type: 'library.merge', payload});
    const r = await merge({
      boards: [board(1)],
      pins: [pin(2, 1)],
      feedback: [{id: ID(3), board_id: ID(1), updated_at: T, text: 'hi'}],
    });
    expect(r.counts).toEqual({boards: 1, pins: 1, feedback: 1, images: 0, skipped: 0});
    const again = await merge({boards: [board(1, {name: 'Old'})], pins: [], feedback: []});
    expect(again.counts.boards).toBe(0);
    await merge({boards: [board(1, {name: 'New', updated_at: LATER})], pins: [], feedback: []});
    const s = await snapshot();
    expect(s.boards[0].name).toBe('New');
    expect(s.pins[0].meta).toEqual({kind: 'idea', title: ''});
    expect(await counts()).toEqual({log: 3, outbox: 3});
  });
  it('maps an incoming Inbox onto the local one', async () => {
    const inbox = await action({type: 'board.create', payload: {name: 'Inbox'}});
    await action({type: 'library.merge', payload: {boards: [board(1, {name: 'Inbox'})], pins: [pin(2, 1)]}});
    const s = await snapshot();
    expect(s.boards).toHaveLength(1);
    expect(s.pins[0].board_id).toBe(inbox.id);
  });
  it('refuses a bad record whole, unless lenient', async () => {
    const payload = {boards: [board(1)], pins: [pin(2, 1, {source_url: 'javascript:x'}), pin(3, 9)]};
    await expect(action({type: 'library.merge', payload})).rejects.toThrow('invalid reference');
    expect((await snapshot()).boards).toHaveLength(0);
    expect(await counts()).toEqual({log: 0, outbox: 0});
    const r = await action({type: 'library.merge', payload: {...payload, lenient: true}});
    expect(r.counts).toMatchObject({boards: 1, pins: 0, skipped: 2});
  });
  it('lets the studio copy win even when older', async () => {
    await action({type: 'library.merge', payload: {boards: [board(1, {name: 'Newer', updated_at: LATER})], pins: []}});
    await action({type: 'library.merge', payload: {boards: [board(1, {name: 'Studio'})], pins: [], studio: true}});
    expect((await snapshot()).boards[0].name).toBe('Studio');
  });
  it('needs an image unless lenient, and stores it when given', async () => {
    const payload = {boards: [board(1)], pins: [pin(2, 1, {file_ref: ID(5)})]};
    await expect(action({type: 'library.merge', payload})).rejects.toThrow('missing an image');
    const r = await action({type: 'library.merge', payload, blobs: {[ID(5)]: new Blob(['x'])}});
    expect(r.counts.images).toBe(1);
    expect(await (await database).get('files', ID(5))).toBeTruthy();
  });
  it('refuses a backup without lists', async () => {
    await expect(action({type: 'library.merge', payload: {boards: []}})).rejects.toThrow('not supported');
  });
});

describe('files.restore', () => {
  it('stores only missing files that a card uses, and logs only then', async () => {
    await action({
      type: 'library.merge',
      payload: {boards: [board(1)], pins: [pin(2, 1, {file_ref: ID(5)})], lenient: true},
    });
    const before = await counts();
    const r = await action({type: 'files.restore', blobs: {[ID(5)]: new Blob(['x']), [ID(6)]: new Blob(['y'])}});
    expect(r.counts).toEqual({images: 1});
    const db = await database;
    expect(await db.get('files', ID(6))).toBeUndefined();
    expect((await action({type: 'files.restore', blobs: {[ID(5)]: new Blob(['z'])}})).counts.images).toBe(0);
    expect((await counts()).log).toBe(before.log + 2);
  });
});

describe('board.import', () => {
  it('gives the board, cards and images new IDs and keeps credits', async () => {
    const r = await action({
      type: 'board.import',
      payload: {
        name: ' Trip ',
        pins: [
          {file_ref: 'img', source_credit: 'Ana', palette: ['#aabbcc', 'red'], meta: {title: 'Wall'}},
          {source_url: 'https://x.test', note: 'n'},
        ],
      },
      blobs: {img: new Blob(['x'])},
    });
    expect(r.board.name).toBe('Trip');
    expect(r.pins.map((p: any) => p.meta.kind)).toEqual(['image', 'link']);
    expect(r.pins[0]).toMatchObject({source_credit: 'Ana', palette: ['#aabbcc'], meta: {title: 'Wall'}});
    expect(r.pins[0].file_ref).not.toBe('img');
    expect(await (await database).get('files', r.pins[0].file_ref)).toBeTruthy();
  });
  it('writes nothing when a card is bad', async () => {
    const bad = (pins: any[]) => action({type: 'board.import', payload: {name: 'X', pins}});
    await expect(bad([{note: 'ok'}, {file_ref: 'gone'}])).rejects.toThrow('invalid or missing');
    await expect(bad([{source_url: 'ftp://x'}])).rejects.toThrow('complete http');
    await expect(action({type: 'board.import', payload: {name: ' ', pins: []}})).rejects.toThrow('not supported');
    expect((await snapshot()).boards).toHaveLength(0);
  });
});

describe('pin.link and refusals', () => {
  it('links a card to an artwork', async () => {
    const b = await action({type: 'board.create', payload: {name: 'B'}});
    const p = await action({type: 'pin.save', payload: {board_id: b.id, note: 'n'}});
    const r = await action({type: 'pin.link', id: p.id, payload: {linked_type: 'artwork', linked_id: 'a1'}});
    expect(r).toMatchObject({linked_type: 'artwork', linked_id: 'a1', version: 2});
  });
  it('refuses unknown actions and backend-only ones without writing', async () => {
    const b = await action({type: 'board.create', payload: {name: 'B'}});
    const before = await counts();
    await expect(action({type: 'board.start_artwork', id: b.id})).rejects.toThrow('shared backend');
    for (const type of ['board.rename', 'feedback.delete', 'constructor', 'toString', 'pin'])
      await expect(action({type, id: b.id})).rejects.toThrow();
    await expect(action({type: 'board.rename', id: b.id})).rejects.toThrow('Unknown action');
    await expect(action({type: 'board.update', id: 'missing'})).rejects.toThrow('no longer available');
    expect(await counts()).toEqual(before);
  });
});
