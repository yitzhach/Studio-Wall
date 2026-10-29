// Stage 3 of docs/backend-and-ai-plan.md: how studio sync compares the device with the studio (src/studio.ts plan()).
import 'fake-indexeddb/auto';
import {describe, it, expect} from 'vitest';
import {plan, toServer, emptyState, hashOf, type Local, type Server, type SyncState} from './studio';

const SINCE = '2026-10-26T00:00:00.000Z',
  BEFORE = '2026-10-01T00:00:00.000Z',
  AFTER = '2026-10-26T01:00:00.000Z';
const id = (n: number) => '01J' + String(n).padStart(23, '0');
const rec = (x: any) => ({
  studio_id: 'local-studio',
  created_at: AFTER,
  updated_at: AFTER,
  created_by: 'local-owner',
  actor_type: 'human',
  version: 1,
  deleted_at: null,
  ...x,
});
const board = (n: number, x: any = {}) =>
  rec({id: id(n), name: 'Board ' + n, description: '', cover_pin_id: null, visibility: 'private', position: n, ...x});
const pin = (n: number, b: number, x: any = {}) =>
  rec({
    id: id(n),
    board_id: id(b),
    file_ref: null,
    source_url: '',
    source_credit: '',
    is_own: false,
    note: 'note ' + n,
    tags: [],
    palette: [],
    linked_type: null,
    linked_id: null,
    annotations: [],
    meta: {kind: 'idea', title: ''},
    ...x,
  });
const local = (x: Partial<Local> = {}): Local => ({board: [], pin: [], feedback: [], ...x});
const none = (): Server => ({board: new Map(), pin: new Map(), feedback: new Map()});
/** The studio's copy of local records, as the SDK holds it after they went up. */
function mirror(l: Local, st: SyncState, v = 1): Server {
  const s = none(),
    c = {alias: st.alias, files: st.files, scope: new Set([...l.board, ...l.pin, ...l.feedback].map(r => r.id))};
  for (const t of ['board', 'pin', 'feedback'] as const)
    for (const r of l[t])
      if (!r.deleted_at)
        s[t].set(t === 'board' ? st.alias[r.id] || r.id : r.id, {
          id: t === 'board' ? st.alias[r.id] || r.id : r.id,
          version: v,
          deletedAt: null,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          ...toServer(t, r, c),
        });
  return s;
}
const agree = (l: Local, st: SyncState) => {
  const s = mirror(l, st);
  plan(l, s, st, SINCE);
  return s;
};

describe('what goes up', () => {
  it('sends the Inbox and what was made since switching on; older boards wait for the import', () => {
    const l = local({board: [board(1, {name: 'Inbox', created_at: BEFORE}), board(2, {created_at: BEFORE}), board(3)]});
    const p = plan(l, none(), emptyState(), SINCE);
    expect(p.ops.map(o => [o.op, o.id])).toEqual([
      ['create', id(1)],
      ['create', id(3)],
    ]);
    expect(p.ops[1].fields).toEqual({
      name: 'Board 3',
      description: null,
      coverPinId: null,
      position: 3,
      commentsEnabled: true,
    });
  });
  it('takes an older board along when a new card goes on it', () => {
    const l = local({board: [board(2, {created_at: BEFORE})], pin: [pin(10, 2), pin(11, 2, {created_at: BEFORE})]});
    const p = plan(l, none(), emptyState(), SINCE);
    expect(p.ops.map(o => [o.op, o.type, o.id])).toEqual([
      ['create', 'board', id(2)],
      ['create', 'pin', id(10)],
    ]);
  });
  it('maps a card: empty text is null, the title and kind are columns, drawings stay in meta, the image is a studio file', () => {
    const st = emptyState();
    st.files['ref1'] = id(99);
    const l = local({
      board: [board(1)],
      pin: [
        pin(10, 1, {
          file_ref: 'ref1',
          note: '',
          source_url: 'https://a.test/x',
          tags: [' warm ', 'warm', ''],
          annotations: [{id: 'a', tool: 'pen', points: [], comment: ''}],
          meta: {kind: 'image', title: 'Blue'},
        }),
      ],
    });
    const f = plan(l, none(), st, SINCE).ops[1].fields!;
    expect(f).toMatchObject({
      boardId: id(1),
      fileId: id(99),
      note: null,
      sourceUrl: 'https://a.test/x',
      tags: ['warm'],
      kind: 'image',
      title: 'Blue',
      meta: {annotations: [{id: 'a', tool: 'pen', points: [], comment: ''}]},
    });
  });
});

describe('after the first sync', () => {
  it('agrees, then sends only the fields changed here', () => {
    const st = emptyState(),
      l = local({board: [board(1)], pin: [pin(10, 1)]});
    const s = agree(l, st);
    expect(plan(l, s, st, SINCE).ops).toEqual([]);
    l.pin[0] = {...l.pin[0], note: 'changed', tags: ['a']};
    expect(plan(l, s, st, SINCE).ops).toEqual([
      {op: 'update', type: 'pin', id: id(10), patch: {note: 'changed', tags: ['a']}},
    ]);
  });
  it('takes the studio’s change when only the studio moved, keeping local-only settings', () => {
    const st = emptyState(),
      l = local({board: [board(1, {share_settings: {mode: 'private', permission: 'view'}})]});
    const s = agree(l, st);
    s.board.set(id(1), {
      ...s.board.get(id(1)),
      name: 'Renamed elsewhere',
      version: 2,
      updatedAt: '2026-10-26T02:00:00.000Z',
    });
    const p = plan(l, s, st, SINCE);
    expect(p.ops).toEqual([]);
    expect(p.conflicts).toEqual([]);
    expect(p.apply.boards[0]).toMatchObject({
      id: id(1),
      name: 'Renamed elsewhere',
      share_settings: {mode: 'private', permission: 'view'},
      updated_at: '2026-10-26T02:00:00.000Z',
    });
  });
  it('keeps the studio’s copy and makes a review card when both moved', () => {
    const st = emptyState(),
      l = local({board: [board(1)], pin: [pin(10, 1)]});
    const s = agree(l, st);
    s.pin.set(id(10), {...s.pin.get(id(10)), note: 'theirs', version: 2});
    l.pin[0] = {...l.pin[0], note: 'mine'};
    const p = plan(l, s, st, SINCE);
    expect(p.ops).toEqual([]);
    expect(p.apply.pins[0].note).toBe('theirs');
    expect(p.conflicts.map(c => [c.id, c.local.note])).toEqual([[id(10), 'mine']]);
  });
  it('fetches a picture the studio has under its own file id', () => {
    const st = emptyState(),
      l = local({board: [board(1)]});
    const s = agree(l, st);
    s.pin.set(id(10), {
      id: id(10),
      version: 1,
      deletedAt: null,
      ...toServer('pin', pin(10, 1), {alias: {}, files: {}, scope: new Set()}),
      fileId: id(50),
      kind: 'image',
    });
    const p = plan(l, s, st, SINCE);
    expect(p.apply.pins[0]).toMatchObject({id: id(10), file_ref: id(50), meta: {kind: 'image'}});
    expect(st.files[id(50)]).toBe(id(50));
  });
});

describe('the Inbox', () => {
  it('maps this device’s Inbox onto the studio’s, quietly, and files new cards there', () => {
    const st = emptyState(),
      s = none();
    s.board.set(id(5), {
      id: id(5),
      version: 3,
      deletedAt: null,
      name: 'Inbox',
      description: 'Theirs',
      coverPinId: null,
      position: 0,
      commentsEnabled: true,
    });
    const l = local({board: [board(1, {name: 'Inbox', description: 'Mine', created_at: BEFORE})], pin: [pin(10, 1)]});
    const p = plan(l, s, st, SINCE);
    expect(st.alias).toEqual({[id(1)]: id(5)});
    expect(p.conflicts).toEqual([]);
    expect(p.apply.boards[0]).toMatchObject({id: id(1), description: 'Theirs'});
    expect(p.ops).toEqual([
      expect.objectContaining({
        op: 'create',
        type: 'pin',
        id: id(10),
        fields: expect.objectContaining({boardId: id(5)}),
      }),
    ]);
  });
});

describe('deletes and restores', () => {
  it('deletes a board once, after other changes; its cards go with it', () => {
    const st = emptyState(),
      l = local({board: [board(1), board(2)], pin: [pin(10, 1), pin(11, 1)]});
    const s = agree(l, st);
    const at = '2026-10-26T03:00:00.000Z';
    l.pin[1] = {...l.pin[1], board_id: id(2)};
    l.board[0] = {...l.board[0], deleted_at: at};
    l.pin[0] = {...l.pin[0], deleted_at: at};
    expect(plan(l, s, st, SINCE).ops.map(o => [o.op, o.id])).toEqual([
      ['update', id(11)],
      ['remove', id(1)],
    ]);
  });
  it('applies the studio’s delete to the device, with its time', () => {
    const st = emptyState(),
      l = local({board: [board(1)], pin: [pin(10, 1)]});
    const s = agree(l, st);
    s.pin.delete(id(10));
    st.tombs['pin:' + id(10)] = {v: 2, d: '2026-10-26T04:00:00.000Z', by: null};
    const p = plan(l, s, st, SINCE);
    expect(p.apply.pins[0]).toMatchObject({id: id(10), deleted_at: '2026-10-26T04:00:00.000Z'});
    expect(st.base['pin:' + id(10)]).toBe('deleted');
  });
  it('restores a board alone when its cards were deleted with it', () => {
    const st = emptyState(),
      l = local({board: [board(1)], pin: [pin(10, 1)]});
    const s = agree(l, st);
    const d = '2026-10-26T05:00:00.000Z';
    s.board.delete(id(1));
    s.pin.delete(id(10));
    st.tombs['board:' + id(1)] = {v: 2, d};
    st.tombs['pin:' + id(10)] = {v: 2, d};
    st.base['board:' + id(1)] = 'deleted';
    st.base['pin:' + id(10)] = 'deleted';
    expect(plan(l, s, st, SINCE).ops).toEqual([
      expect.objectContaining({op: 'restore', type: 'board', id: id(1), version: 2}),
    ]);
  });
  it('holds a refused card back until it changes', () => {
    const st = emptyState(),
      l = local({board: [board(1)], pin: [pin(10, 1)]});
    const s = agree(l, st);
    s.pin.delete(id(10));
    st.refused['pin:' + id(10)] = {h: '?', why: 'No'};
    delete st.base['pin:' + id(10)];
    expect(plan(l, s, st, SINCE).ops).toEqual([]);
    expect(plan(l, s, st, SINCE).ops).toEqual([]);
    l.pin[0] = {...l.pin[0], note: 'fixed'};
    expect(plan(l, s, st, SINCE).ops.map(o => o.op)).toEqual(['create']);
  });
});

it('compares only the fields both sides have', () => {
  expect(
    hashOf('board', {
      name: 'A',
      description: null,
      coverPinId: null,
      position: 0,
      commentsEnabled: true,
      version: 4,
      meta: {x: 1},
    }),
  ).toBe(hashOf('board', {name: 'A', position: 0, commentsEnabled: true}));
  expect(hashOf('pin', {deletedAt: 'x', note: 'a'})).toBe('deleted');
});

describe('import my library (stage 4)', () => {
  const D = '2026-10-20T00:00:00.000Z';
  /** A studio that takes every op, as the server would; a board's delete takes its live cards with it. */
  function push(s: Server, st: SyncState, ops: ReturnType<typeof plan>['ops'], at = '2026-10-27T00:00:00.000Z') {
    for (const o of ops) {
      const S = s[o.type].get(o.id);
      if (o.op === 'create') s[o.type].set(o.id, {id: o.id, version: 1, deletedAt: null, updatedAt: at, ...o.fields});
      else if (o.op === 'update') s[o.type].set(o.id, {...S, ...o.patch, version: S!.version + 1});
      else if (o.op === 'remove') {
        const gone = [[o.type, o.id]] as [Type, string][];
        if (o.type === 'board') for (const [pid, p] of s.pin) if (p.boardId === o.id) gone.push(['pin', pid]);
        for (const [t, i] of gone) {
          st.tombs[`${t}:${i}`] = {v: s[t].get(i)!.version + 1, d: at};
          s[t].delete(i);
        }
      }
    }
  }
  /** Plan and push until the device and the studio agree. */
  function settle(l: Local, s: Server, st: SyncState, upload?: (st: SyncState) => void) {
    const all: ReturnType<typeof plan>['ops'] = [];
    for (let i = 0; i < 10; i++) {
      const held = JSON.stringify(st.later),
        p = plan(l, s, st, SINCE);
      all.push(...p.ops);
      push(s, st, p.ops);
      upload?.(st);
      if (!p.ops.length && held === JSON.stringify(st.later)) break;
    }
    return all;
  }
  type Type = 'board' | 'pin' | 'feedback';
  const old = {created_at: BEFORE, updated_at: BEFORE};

  it('sends every older record once; a second run sends nothing', () => {
    const st = {...emptyState(), all: AFTER};
    const l = local({
      board: [board(1, old), board(2, {...old, cover_pin_id: id(10)})],
      pin: [pin(10, 2, old), pin(11, 2, old)],
      feedback: [rec({...old, id: id(20), board_id: id(2), pin_id: id(10), text: 'Love it'})],
    });
    const s = none();
    const first = plan(l, s, st, SINCE);
    expect(first.ops.map(o => [o.op, o.id])).toEqual([
      ['create', id(1)],
      ['create', id(2)],
      ['create', id(10)],
      ['create', id(11)],
      ['create', id(20)],
    ]);
    // The cover waits for its card to be in the studio, then follows.
    expect(first.ops[1].fields!.coverPinId).toBeNull();
    push(s, st, first.ops);
    expect(plan(l, s, st, SINCE).ops).toEqual([{op: 'update', type: 'board', id: id(2), patch: {coverPinId: id(10)}}]);
    settle(l, s, st);
    expect(plan(l, s, st, SINCE).ops).toEqual([]);
    expect([s.board.size, s.pin.size, s.feedback.size]).toEqual([2, 2, 1]);
  });
  it('carries Recently deleted over: a deleted card goes up with its picture, then is deleted', () => {
    const st = {...emptyState(), all: AFTER};
    const l = local({
      board: [board(1, old)],
      pin: [pin(10, 1, {...old, file_ref: 'ref', deleted_at: D})],
    });
    const s = none();
    const ops = settle(l, s, st, x => {
      // The picture is uploaded once the card is in the studio.
      if (s.pin.get(id(10))?.version) x.files.ref ||= id(90);
    });
    expect(ops.map(o => [o.op, o.id])).toEqual([
      ['create', id(1)],
      ['create', id(10)],
      ['update', id(10)],
      ['remove', id(10)],
    ]);
    expect(ops[2].patch).toEqual({fileId: id(90)});
    expect(st.tombs['pin:' + id(10)]).toBeTruthy();
    expect(st.later).toEqual({});
    expect(st.base['pin:' + id(10)]).toBe('deleted');
  });
  it('a deleted board waits for its cards, then one delete takes them all', () => {
    const st = {...emptyState(), all: AFTER};
    const l = local({
      board: [board(1, {...old, deleted_at: D})],
      pin: [pin(10, 1, {...old, deleted_at: D}), pin(11, 1, {...old, deleted_at: D, file_ref: 'ref'})],
    });
    const s = none();
    const ops = settle(l, s, st, x => {
      if (s.pin.get(id(11))?.version) x.files.ref ||= id(90);
    });
    expect(ops.filter(o => o.op === 'remove').map(o => o.id)).toEqual([id(1)]);
    expect(ops.findIndex(o => o.op === 'remove')).toBeGreaterThan(ops.findIndex(o => o.patch?.fileId));
    expect(st.tombs['pin:' + id(10)]?.d).toBe(st.tombs['board:' + id(1)]?.d);
    expect(plan(l, s, st, SINCE).ops).toEqual([]);
  });
  it('a card without its picture on this device still goes, once marked', () => {
    const st = {...emptyState(), all: AFTER};
    const l = local({board: [board(1, old)], pin: [pin(10, 1, {...old, file_ref: 'gone', deleted_at: D})]});
    const s = none();
    settle(l, s, st);
    expect(s.pin.has(id(10))).toBe(true);
    st.later['pin:' + id(10)] = 'nofile';
    settle(l, s, st);
    expect(s.pin.has(id(10))).toBe(false);
  });
  it('without the import, older deleted records stay here', () => {
    const l = local({board: [board(1)], pin: [pin(10, 1, {deleted_at: AFTER})]});
    expect(plan(l, none(), emptyState(), SINCE).ops.map(o => o.id)).toEqual([id(1)]);
  });
  it('on the other device, a record deleted before it ever had it goes into Recently deleted, once', () => {
    const st = emptyState(),
      rec = (n: number, d: string) => ({
        ...toServer('pin', pin(n, 1, {file_ref: 'x'}), {alias: {}, files: {x: id(90)}, scope: new Set()}),
        id: id(n),
        version: 2,
        deletedAt: d,
      });
    st.tombs['pin:' + id(10)] = {v: 2, d: AFTER, rec: rec(10, AFTER)};
    st.tombs['pin:' + id(11)] = {v: 2, d: BEFORE, rec: rec(11, BEFORE)}; // over 30 days: gone for good
    const l = local({board: [board(1, old)]});
    const p = plan(l, none(), st, SINCE, '2026-11-02T00:00:00.000Z');
    expect(p.apply.pins.map(x => [x.id, x.deleted_at, x.file_ref])).toEqual([[id(10), AFTER, id(90)]]);
    expect(st.files[id(90)]).toBe(id(90));
    expect(st.tombs['pin:' + id(10)].rec).toBeUndefined();
    expect(p.ops).toEqual([]);
  });
  it('on the other device, the same library copied by old sync takes the newer copy quietly', () => {
    const st = emptyState(),
      s = none();
    s.board.set(id(1), {id: id(1), version: 1, deletedAt: null, updatedAt: AFTER, name: 'Theirs', position: 1});
    s.pin.set(id(10), {
      ...toServer('pin', pin(10, 1), {alias: {}, files: {}, scope: new Set()}),
      id: id(10),
      version: 1,
      deletedAt: null,
      updatedAt: BEFORE,
    });
    const l = local({
      board: [board(1, {...old, name: 'Mine'})],
      pin: [pin(10, 1, {...old, note: 'newer here', updated_at: AFTER})],
    });
    const p = plan(l, s, st, SINCE);
    expect(p.conflicts).toEqual([]);
    expect(p.apply.boards.map(b => b.name)).toEqual(['Theirs']);
    expect(p.ops).toEqual([{op: 'update', type: 'pin', id: id(10), patch: {note: 'newer here'}}]);
  });
});
