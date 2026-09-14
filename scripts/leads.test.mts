// Standalone integration check for the leads Function + Blobs data layer,
// run directly against a local Netlify Blobs test server. This exists
// because `netlify dev`'s Edge Functions bootstrap can't reach its download
// host in this sandbox (network-restricted), so the full CLI dev server
// couldn't be exercised end-to-end. Not part of the deployed site.
import assert from 'node:assert/strict';
import { BlobsServer } from '@netlify/blobs/server';
import leadsHandler from '../netlify/functions/leads.ts';

const token = 'test-token';
const port = 18888;
const server = new BlobsServer({ directory: '/tmp/blobs-test-data', port, token });
await server.start();

process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(
  JSON.stringify({ edgeURL: `http://localhost:${port}`, token, siteID: 'test-site' }),
).toString('base64');

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

// 1. list is empty initially
let res = await leadsHandler(req('GET', '/.netlify/functions/leads'));
assert.equal(res.status, 200);
assert.deepEqual(await res.json(), []);
console.log('PASS: empty list');

// 2. reject invalid stage
res = await leadsHandler(req('POST', '/.netlify/functions/leads', { stage: 'not-a-stage' }));
assert.equal(res.status, 400);
console.log('PASS: rejects invalid stage');

// 3. create
res = await leadsHandler(
  req('POST', '/.netlify/functions/leads', { stage: 'victim', email: 'a@example.com', name: 'Ada' }),
);
assert.equal(res.status, 201);
const created = await res.json();
assert.equal(created.stage, 'victim');
assert.equal(created.email, 'a@example.com');
assert.ok(created.id);
console.log('PASS: create');

// 4. list has one
res = await leadsHandler(req('GET', '/.netlify/functions/leads'));
const list = await res.json();
assert.equal(list.length, 1);
console.log('PASS: list has one');

// 5. get by id
res = await leadsHandler(req('GET', `/.netlify/functions/leads?id=${created.id}`));
assert.equal(res.status, 200);
console.log('PASS: get by id');

// 6. update
res = await leadsHandler(req('PUT', `/.netlify/functions/leads?id=${created.id}`, { notes: 'followed up' }));
assert.equal(res.status, 200);
const updated = await res.json();
assert.equal(updated.notes, 'followed up');
assert.equal(updated.email, 'a@example.com'); // unchanged fields preserved
console.log('PASS: partial update preserves other fields');

// 7. update with invalid stage rejected
res = await leadsHandler(req('PUT', `/.netlify/functions/leads?id=${created.id}`, { stage: 'nope' }));
assert.equal(res.status, 400);
console.log('PASS: update rejects invalid stage');

// 8. delete
res = await leadsHandler(req('DELETE', `/.netlify/functions/leads?id=${created.id}`));
assert.equal(res.status, 200);
console.log('PASS: delete');

// 9. get after delete -> 404
res = await leadsHandler(req('GET', `/.netlify/functions/leads?id=${created.id}`));
assert.equal(res.status, 404);
console.log('PASS: 404 after delete');

// 10. delete missing -> 404
res = await leadsHandler(req('DELETE', `/.netlify/functions/leads?id=does-not-exist`));
assert.equal(res.status, 404);
console.log('PASS: delete missing id -> 404');

await server.stop();
console.log('\nAll leads Function/Blobs checks passed.');
