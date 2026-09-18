// Exercises the actual src/worker.ts fetch handler end-to-end in plain
// Node, using an in-memory fake D1Database (same .prepare/.bind/.first/
// .all/.run interface as the real binding) — no wrangler/workerd needed.
// This complements (does not replace) the real-D1 SQL verification already
// done directly against the live database via the Cloudflare MCP connector
// (INSERT/SELECT ORDER BY/UPDATE/DELETE all confirmed correct there).
//
// `wrangler dev` itself could not be exercised in this sandbox: it blocks
// trying to reach workers.cloudflare.com on every request (a network
// restriction here, not a code issue) — confirmed via `agentproxy status`
// showing rejected CONNECTs to that host during a `wrangler dev` curl test.
import assert from 'node:assert/strict';
import worker from '../src/worker.ts';

interface Row {
  id: string;
  stage: string;
  email: string | null;
  name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

class FakeD1 {
  rows: Row[] = [];

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }
}

class FakeStatement {
  constructor(
    private db: FakeD1,
    private sql: string,
    private bound: unknown[] = [],
  ) {}

  bind(...args: unknown[]) {
    return new FakeStatement(this.db, this.sql, args);
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.startsWith('SELECT * FROM leads WHERE id')) {
      const id = this.bound[0] as string;
      return (this.db.rows.find((r) => r.id === id) as T | undefined) ?? null;
    }
    throw new Error(`FakeD1: unhandled first() for: ${this.sql}`);
  }

  async all<T>(): Promise<{ results: T[] }> {
    if (this.sql.startsWith('SELECT * FROM leads ORDER BY created_at DESC')) {
      const sorted = [...this.db.rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { results: sorted as T[] };
    }
    throw new Error(`FakeD1: unhandled all() for: ${this.sql}`);
  }

  async run(): Promise<{ meta: { changes: number } }> {
    if (this.sql.startsWith('INSERT INTO leads')) {
      const [id, stage, email, name, notes, created_at, updated_at] = this.bound as string[];
      this.db.rows.push({ id, stage, email, name, notes, created_at, updated_at });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith('UPDATE leads')) {
      const [stage, email, name, notes, updated_at, id] = this.bound as string[];
      const row = this.db.rows.find((r) => r.id === id);
      if (!row) return { meta: { changes: 0 } };
      Object.assign(row, { stage, email, name, notes, updated_at });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith('DELETE FROM leads')) {
      const id = this.bound[0] as string;
      const before = this.db.rows.length;
      this.db.rows = this.db.rows.filter((r) => r.id !== id);
      return { meta: { changes: before - this.db.rows.length } };
    }
    throw new Error(`FakeD1: unhandled run() for: ${this.sql}`);
  }
}

const fakeAssets = {
  async fetch(req: Request) {
    return new Response(`static:${new URL(req.url).pathname}`, { status: 200 });
  },
};

const env = { DB: new FakeD1() as unknown as D1Database, ASSETS: fakeAssets as unknown as Fetcher };

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// 1. non-API paths fall through to ASSETS
let res = await worker.fetch(req('GET', '/'), env);
assert.equal(await res.text(), 'static:/');
console.log('PASS: non-API path falls through to ASSETS');

// 2. empty list
res = await worker.fetch(req('GET', '/api/leads'), env);
assert.equal(res.status, 200);
assert.deepEqual(await res.json(), []);
console.log('PASS: empty list');

// 3. reject invalid stage
res = await worker.fetch(req('POST', '/api/leads', { stage: 'not-a-stage' }), env);
assert.equal(res.status, 400);
console.log('PASS: rejects invalid stage');

// 4. create
res = await worker.fetch(
  req('POST', '/api/leads', { stage: 'victim', email: 'a@example.com', name: 'Ada' }),
  env,
);
assert.equal(res.status, 201);
const created = (await res.json()) as { id: string; stage: string; email: string };
assert.equal(created.stage, 'victim');
assert.equal(created.email, 'a@example.com');
assert.ok(created.id);
console.log('PASS: create');

// 5. list has one
res = await worker.fetch(req('GET', '/api/leads'), env);
const list = (await res.json()) as unknown[];
assert.equal(list.length, 1);
console.log('PASS: list has one');

// 6. get by id
res = await worker.fetch(req('GET', `/api/leads?id=${created.id}`), env);
assert.equal(res.status, 200);
console.log('PASS: get by id');

// 7. update
res = await worker.fetch(req('PUT', `/api/leads?id=${created.id}`, { notes: 'followed up' }), env);
assert.equal(res.status, 200);
const updated = (await res.json()) as { notes: string; email: string };
assert.equal(updated.notes, 'followed up');
assert.equal(updated.email, 'a@example.com');
console.log('PASS: partial update preserves other fields');

// 8. update with invalid stage rejected
res = await worker.fetch(req('PUT', `/api/leads?id=${created.id}`, { stage: 'nope' }), env);
assert.equal(res.status, 400);
console.log('PASS: update rejects invalid stage');

// 9. delete
res = await worker.fetch(req('DELETE', `/api/leads?id=${created.id}`), env);
assert.equal(res.status, 200);
console.log('PASS: delete');

// 10. get after delete -> 404
res = await worker.fetch(req('GET', `/api/leads?id=${created.id}`), env);
assert.equal(res.status, 404);
console.log('PASS: 404 after delete');

// 11. delete missing -> 404
res = await worker.fetch(req('DELETE', '/api/leads?id=does-not-exist'), env);
assert.equal(res.status, 404);
console.log('PASS: delete missing id -> 404');

console.log('\nAll worker fetch-handler checks passed.');
