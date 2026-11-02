// Stage 5 (Art-Talk-Back D-090): which client links this Worker answers itself (old ones, in its D1) and which it
// sends to studio-api through the API binding, with the path and cookie scope the client page expects.
import {it, expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import worker from '../worker/index';
const sql = new DatabaseSync(':memory:');
const stmt = (q: string, args: unknown[] = []) => ({
  bind: (...a: unknown[]) => stmt(q, a),
  first: async () => sql.prepare(q).get(...(args as any[])) ?? null,
  all: async () => ({results: sql.prepare(q).all(...(args as any[]))}),
  run: async () => sql.prepare(q).run(...(args as any[])),
});
const DB = {
  prepare: (q: string) => stmt(q),
  batch: async (list: any[]) => {
    for (const s of list) await s.run();
  },
};
const sent: Request[] = [];
const API = {
  fetch: async (r: Request) => {
    sent.push(r);
    if (r.method === 'GET' && /\/v1\/public\/shares\/s{43}$/.test(new URL(r.url).pathname))
      return Response.json({board: {name: 'Coastal <blues>', description: ''}, pins: [{}, {}], cover: 'F1'});
    return Response.json({ok: true});
  },
};
const ASSETS = {fetch: async () => new Response('<head><!--share-meta--></head>')};
const env = {DB, FILES: {}, API, ASSETS, ACCESS_TEAM_DOMAIN: 'x.cloudflareaccess.com', ACCESS_AUD: 'aud'};
const call = (path: string, init: RequestInit = {}, e: any = env) =>
  worker.fetch(new Request('https://wall.test' + path, init), e, {waitUntil() {}});
const STUDIO = 's'.repeat(43),
  OLD = 'o'.repeat(32);

it('sends a studio link’s requests to studio-api, as they came, scoped to the link’s own path', async () => {
  sent.length = 0;
  const r = await call(`/api/s/${STUDIO}/pins?name=Ana`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-guest-id': 'g'.repeat(20), cookie: 'sw_link=abc'},
    body: '{"note":"Brass"}',
  });
  expect(r.status).toBe(200);
  const f = sent.at(-1)!;
  expect(f.method).toBe('POST');
  expect(new URL(f.url).pathname + new URL(f.url).search).toBe(`/v1/public/shares/${STUDIO}/pins?name=Ana`);
  expect(f.headers.get('x-share-path')).toBe(`/api/s/${STUDIO}`);
  expect(f.headers.get('x-guest-id')).toBe('g'.repeat(20));
  expect(f.headers.get('cookie')).toBe('sw_link=abc');
  expect(await f.text()).toBe('{"note":"Brass"}');
});

it('keeps an old link on the old code', async () => {
  sql
    .prepare('INSERT INTO records(owner,kind,id,updated_at,seq,data) VALUES(?,?,?,?,?,?)')
    .run('me@x', 'boards', 'B1', 'x', 1, JSON.stringify({id: 'B1', name: 'Old', deleted_at: null}));
  sql
    .prepare('INSERT INTO shares(token,owner,board_id,permission,created_at) VALUES(?,?,?,?,?)')
    .run(OLD, 'me@x', 'B1', 'view', new Date().toISOString());
  sent.length = 0;
  const r = await call(`/api/s/${OLD}`);
  expect(r.status).toBe(200);
  expect(((await r.json()) as any).board.name).toBe('Old');
  expect(sent).toEqual([]);
});

it('fills a studio link’s preview from studio-api, escaped', async () => {
  const html = await (await call(`/s/${STUDIO}`)).text();
  expect(html).toContain('<meta property="og:title" content="Coastal &lt;blues&gt;">');
  expect(html).toContain('2 references · shared from Studio Wall');
  expect(html).toContain(`content="https://wall.test/api/s/${STUDIO}/files/F1"`);
});

it('without the studio binding, every link is the old Worker’s', async () => {
  sent.length = 0;
  expect((await call(`/api/s/${STUDIO}`, {}, {...env, API: undefined})).status).toBe(404);
  expect(sent).toEqual([]);
});
