import {
  QUIZ_STAGES,
  createLead,
  deleteLead,
  getLead,
  listLeads,
  updateLead,
  type LeadInput,
  type LeadUpdate,
} from './db';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  // Admin bearer token. Set with `npx wrangler secret put ADMIN_TOKEN`
  // (never commit it). If unset/empty, every admin route returns 401
  // (fail closed).
  ADMIN_TOKEN?: string;
  // Optional comma-separated list of extra origins (e.g.
  // "https://fourstagesquiz.com,https://www.fourstagesquiz.com") that may
  // POST new leads cross-origin from a browser. Same-origin requests never
  // need this. Admin methods never get CORS headers.
  ALLOWED_ORIGINS?: string;
}

// Routes (all under /api/leads):
//   POST                  create a lead, JSON body           (public)
//   GET    ?              list all leads                     (admin)
//   GET    ?id=<id>       get one lead                       (admin)
//   PUT    ?id=<id>       update a lead, JSON body (partial) (admin)
//   PATCH  ?id=<id>       same as PUT                        (admin)
//   DELETE ?id=<id>       delete a lead                      (admin)
//   OPTIONS               CORS preflight (POST only)
// Admin = `Authorization: Bearer <ADMIN_TOKEN>`.
// Everything else falls through to the static assets binding.

const MAX_BODY_BYTES = 8 * 1024;
const MAX_ID_LENGTH = 64;
const FIELD_LIMITS = { email: 254, name: 200, notes: 2000 } as const;
// Deliberately loose: one "@", no whitespace, a dot in the domain part.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ADMIN_METHODS = new Set(['GET', 'PUT', 'PATCH', 'DELETE']);

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// --- auth -------------------------------------------------------------------

async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
}

// Constant-time comparison. Both sides are hashed first so the compared
// buffers always have the same length (no length leak) and the loop below
// never short-circuits.
async function timingSafeEqualStrings(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

async function isAdmin(req: Request, env: Env): Promise<boolean> {
  const expected = env.ADMIN_TOKEN;
  if (typeof expected !== 'string' || expected.length === 0) return false; // fail closed
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  return timingSafeEqualStrings(match[1].trim(), expected);
}

function unauthorized(): Response {
  return json({ error: 'Unauthorized.' }, 401, { 'www-authenticate': 'Bearer realm="leads"' });
}

// --- CORS (public POST only) ------------------------------------------------

function corsHeadersFor(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin) return {};
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

// --- body parsing / validation ------------------------------------------------

async function readJsonBody(req: Request): Promise<{ error: string; status: number } | { value: unknown }> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { error: 'Request body too large.', status: 413 };
  }
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return { error: 'Content-Type must be application/json.', status: 415 };
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return { error: 'Request body too large.', status: 413 };
  }
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: 'Request body must be valid JSON.', status: 400 };
  }
}

function validateFields(b: Record<string, unknown>): string | null {
  for (const field of ['email', 'name', 'notes'] as const) {
    const v = b[field];
    if (v === undefined) continue;
    if (typeof v !== 'string') return `"${field}" must be a string.`;
    if (v.trim().length > FIELD_LIMITS[field]) {
      return `"${field}" must be at most ${FIELD_LIMITS[field]} characters.`;
    }
  }
  if (typeof b.email === 'string' && b.email.trim() !== '' && !EMAIL_RE.test(b.email.trim())) {
    return '"email" must be a valid email address.';
  }
  return null;
}

function validateCreateInput(body: unknown): { error: string } | { value: LeadInput } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object.' };
  }
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.stage) || !(QUIZ_STAGES as readonly string[]).includes(b.stage)) {
    return { error: `"stage" is required and must be one of: ${QUIZ_STAGES.join(', ')}.` };
  }
  const fieldError = validateFields(b);
  if (fieldError) return { error: fieldError };
  return {
    value: {
      stage: b.stage as LeadInput['stage'],
      email: (b.email as string | undefined)?.trim() || undefined,
      name: (b.name as string | undefined)?.trim() || undefined,
      notes: (b.notes as string | undefined)?.trim() || undefined,
    },
  };
}

function validateUpdateInput(body: unknown): { error: string } | { value: LeadUpdate } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be a JSON object.' };
  }
  const b = body as Record<string, unknown>;
  if (
    b.stage !== undefined &&
    (!isNonEmptyString(b.stage) || !(QUIZ_STAGES as readonly string[]).includes(b.stage))
  ) {
    return { error: `"stage" must be one of: ${QUIZ_STAGES.join(', ')}.` };
  }
  const fieldError = validateFields(b);
  if (fieldError) return { error: fieldError };
  const value: LeadUpdate = {};
  if (b.stage !== undefined) value.stage = b.stage as LeadUpdate['stage'];
  if (b.email !== undefined) value.email = (b.email as string).trim() || undefined;
  if (b.name !== undefined) value.name = (b.name as string).trim() || undefined;
  if (b.notes !== undefined) value.notes = (b.notes as string).trim() || undefined;
  return { value };
}

function validId(id: string | null): id is string {
  return id !== null && id.length > 0 && id.length <= MAX_ID_LENGTH;
}

// --- handler ------------------------------------------------------------------

async function handleLeads(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  if (req.method === 'OPTIONS') {
    const cors = corsHeadersFor(req, env);
    return new Response(null, { status: cors['access-control-allow-origin'] ? 204 : 403, headers: cors });
  }

  if (ADMIN_METHODS.has(req.method) && !(await isAdmin(req, env))) {
    return unauthorized();
  }

  try {
    switch (req.method) {
      case 'GET': {
        if (id !== null) {
          if (!validId(id)) return json({ error: 'Invalid "id".' }, 400);
          const lead = await getLead(env.DB, id);
          return lead ? json(lead) : json({ error: 'Lead not found.' }, 404);
        }
        return json(await listLeads(env.DB));
      }

      case 'POST': {
        const cors = corsHeadersFor(req, env);
        const parsed = await readJsonBody(req);
        if ('error' in parsed) return json({ error: parsed.error }, parsed.status, cors);
        const result = validateCreateInput(parsed.value);
        if ('error' in result) return json({ error: result.error }, 400, cors);
        const lead = await createLead(env.DB, result.value);
        return json(lead, 201, cors);
      }

      case 'PUT':
      case 'PATCH': {
        if (!id) return json({ error: 'Missing required "id" query parameter.' }, 400);
        if (!validId(id)) return json({ error: 'Invalid "id".' }, 400);
        const parsed = await readJsonBody(req);
        if ('error' in parsed) return json({ error: parsed.error }, parsed.status);
        const result = validateUpdateInput(parsed.value);
        if ('error' in result) return json({ error: result.error }, 400);
        const updated = await updateLead(env.DB, id, result.value);
        return updated ? json(updated) : json({ error: 'Lead not found.' }, 404);
      }

      case 'DELETE': {
        if (!id) return json({ error: 'Missing required "id" query parameter.' }, 400);
        if (!validId(id)) return json({ error: 'Invalid "id".' }, 400);
        const deleted = await deleteLead(env.DB, id);
        return deleted ? json({ success: true }) : json({ error: 'Lead not found.' }, 404);
      }

      default:
        return json({ error: 'Method not allowed.' }, 405, { allow: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' });
    }
  } catch (err) {
    console.error('leads handler error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    // Also catch "/api/leads/" so a trailing slash can't fall through to assets.
    if (url.pathname === '/api/leads' || url.pathname === '/api/leads/') {
      return handleLeads(req, env);
    }
    return env.ASSETS.fetch(req);
  },
};
