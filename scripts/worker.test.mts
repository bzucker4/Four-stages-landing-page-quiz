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

const TEST_TOKEN = 'test-admin-token-not-a-real-secret';
const env = {
  DB: new FakeD1() as unknown as D1Database,
  ASSETS: fakeAssets as unknown as Fetcher,
  ADMIN_TOKEN: TEST_TOKEN,
};

function req(
  method: string,
  path: string,
  body?: unknown,
  opts: { token?: string | null; headers?: Record<string, string> } = {},
): Request {
  const token = opts.token === undefined ? TEST_TOKEN : opts.token;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (body !== undefined) headers['content-type'] ??= 'application/json';
  if (token) headers['authorization'] = `Bearer ${token}`;
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}

// 1. non-API paths fall through to ASSETS
let res = await worker.fetch(req('GET', '/'), env);
assert.equal(await res.text(), 'static:/');
console.log('PASS: non-API path falls through to ASSETS');

// --- auth ---------------------------------------------------------------
for (const [method, path, body] of [
  ['GET', '/api/leads', undefined],
  ['GET', '/api/leads/', undefined],
  ['GET', '/api/leads?id=x', undefined],
  ['PUT', '/api/leads?id=x', { notes: 'x' }],
  ['PATCH', '/api/leads?id=x', { notes: 'x' }],
  ['DELETE', '/api/leads?id=x', undefined],
] as const) {
  res = await worker.fetch(req(method, path, body, { token: null }), env);
  assert.equal(res.status, 401, `${method} ${path} without token`);
  res = await worker.fetch(req(method, path, body, { token: 'wrong-token' }), env);
  assert.equal(res.status, 401, `${method} ${path} with wrong token`);
}
console.log('PASS: admin methods reject missing/wrong token with 401');

res = await worker.fetch(
  req('GET', '/api/leads', undefined, { headers: { authorization: TEST_TOKEN }, token: null }),
  env,
);
assert.equal(res.status, 401);
console.log('PASS: token without "Bearer " scheme rejected');

{
  const noSecretEnv = { ...env, ADMIN_TOKEN: undefined };
  res = await worker.fetch(req('GET', '/api/leads'), noSecretEnv);
  assert.equal(res.status, 401);
  const emptySecretEnv = { ...env, ADMIN_TOKEN: '' };
  res = await worker.fetch(req('GET', '/api/leads', undefined, { headers: { authorization: 'Bearer ' }, token: null }), emptySecretEnv);
  assert.equal(res.status, 401);
  console.log('PASS: fails closed when ADMIN_TOKEN is unset or empty');
}

// 2. empty list (authorized)
res = await worker.fetch(req('GET', '/api/leads'), env);
assert.equal(res.status, 200);
assert.equal(res.headers.get('cache-control'), 'no-store');
assert.equal(res.headers.get('access-control-allow-origin'), null);
assert.deepEqual(await res.json(), []);
console.log('PASS: empty list with valid token, no-store, no CORS');

// 3. reject invalid stage
res = await worker.fetch(req('POST', '/api/leads', { stage: 'not-a-stage' }, { token: null }), env);
assert.equal(res.status, 400);
console.log('PASS: rejects invalid stage');

// --- validation ---------------------------------------------------------
res = await worker.fetch(req('POST', '/api/leads', { stage: 'victim', email: 'nope' }, { token: null }), env);
assert.equal(res.status, 400);
res = await worker.fetch(req('POST', '/api/leads', { stage: 'victim', notes: 'x'.repeat(2001) }, { token: null }), env);
assert.equal(res.status, 400);
res = await worker.fetch(req('POST', '/api/leads', { stage: 'victim', name: 'x'.repeat(9000) }, { token: null }), env);
assert.equal(res.status, 413);
res = await worker.fetch(
  req('POST', '/api/leads', { stage: 'victim' }, { token: null, headers: { 'content-type': 'text/plain' } }),
  env,
);
assert.equal(res.status, 415);
res = await worker.fetch(req('POST', '/api/leads', '{not json', { token: null }), env);
assert.equal(res.status, 400);
res = await worker.fetch(req('POST', '/api/leads', ['victim'], { token: null }), env);
assert.equal(res.status, 400);
assert.equal((env.DB as unknown as FakeD1).rows.length, 0);
console.log('PASS: rejects bad email, oversize fields/body, wrong content-type, bad JSON, arrays');

// 4. public create (no token)
res = await worker.fetch(
  req('POST', '/api/leads', { stage: 'victim', email: 'a@example.com', name: 'Ada' }, { token: null }),
  env,
);
assert.equal(res.status, 201);
const created = (await res.json()) as { id: string; stage: string; email: string };
assert.equal(created.stage, 'victim');
assert.equal(created.email, 'a@example.com');
assert.ok(created.id);
console.log('PASS: public create without token');

// --- CORS ---------------------------------------------------------------
{
  const corsEnv = { ...env, ALLOWED_ORIGINS: 'https://fourstagesquiz.com' };
  res = await worker.fetch(
    req('OPTIONS', '/api/leads', undefined, { token: null, headers: { origin: 'https://fourstagesquiz.com' } }),
    corsEnv,
  );
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://fourstagesquiz.com');
  assert.equal(res.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  res = await worker.fetch(
    req('OPTIONS', '/api/leads', undefined, { token: null, headers: { origin: 'https://evil.example' } }),
    corsEnv,
  );
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  res = await worker.fetch(
    req('GET', '/api/leads', undefined, { headers: { origin: 'https://fourstagesquiz.com' } }),
    corsEnv,
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  await res.body?.cancel();
  console.log('PASS: CORS only for allow-listed origins on POST, never on admin GET');
}

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

// 7b. PATCH alias
res = await worker.fetch(req('PATCH', `/api/leads?id=${created.id}`, { name: 'Ada L' }), env);
assert.equal(res.status, 200);
console.log('PASS: PATCH works with token');

// 8. update with invalid stage rejected
res = await worker.fetch(req('PUT', `/api/leads?id=${created.id}`, { stage: 'nope' }), env);
assert.equal(res.status, 400);
console.log('PASS: update rejects invalid stage');

// 8b. unauthenticated delete does not delete
res = await worker.fetch(req('DELETE', `/api/leads?id=${created.id}`, undefined, { token: null }), env);
assert.equal(res.status, 401);
assert.equal((env.DB as unknown as FakeD1).rows.length, 1);
console.log('PASS: unauthenticated delete leaves data intact');

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

// 12. unknown method
res = await worker.fetch(req('HEAD', '/api/leads', undefined, { token: null }), env);
assert.equal(res.status, 405);
console.log('PASS: unknown method -> 405');

console.log('\nAll worker fetch-handler checks passed.');
