import type { Config } from '@netlify/functions';
import {
  QUIZ_STAGES,
  createLead,
  deleteLead,
  getLead,
  listLeads,
  updateLead,
  type LeadInput,
  type LeadUpdate,
} from '../lib/data';

// Netlify Blobs is key-value only — no querying/filtering/sorting at the
// storage level. Sorting (newest first) happens in listLeads(); any future
// filtering would need to happen here in application code, not in Blobs.
//
// Routes (all under /.netlify/functions/leads):
//   GET    ?              list all leads
//   GET    ?id=<id>       get one lead
//   POST                  create a lead, JSON body
//   PUT    ?id=<id>       update a lead, JSON body (partial)
//   DELETE ?id=<id>       delete a lead

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateCreateInput(body: unknown): { error: string } | { value: LeadInput } {
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be a JSON object.' };
  }
  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.stage) || !(QUIZ_STAGES as readonly string[]).includes(b.stage)) {
    return { error: `"stage" is required and must be one of: ${QUIZ_STAGES.join(', ')}.` };
  }
  for (const field of ['email', 'name', 'notes'] as const) {
    if (b[field] !== undefined && typeof b[field] !== 'string') {
      return { error: `"${field}" must be a string.` };
    }
  }
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
  if (!body || typeof body !== 'object') {
    return { error: 'Request body must be a JSON object.' };
  }
  const b = body as Record<string, unknown>;
  if (b.stage !== undefined && (!isNonEmptyString(b.stage) || !(QUIZ_STAGES as readonly string[]).includes(b.stage))) {
    return { error: `"stage" must be one of: ${QUIZ_STAGES.join(', ')}.` };
  }
  for (const field of ['email', 'name', 'notes'] as const) {
    if (b[field] !== undefined && typeof b[field] !== 'string') {
      return { error: `"${field}" must be a string.` };
    }
  }
  const value: LeadUpdate = {};
  if (b.stage !== undefined) value.stage = b.stage as LeadUpdate['stage'];
  if (b.email !== undefined) value.email = (b.email as string).trim() || undefined;
  if (b.name !== undefined) value.name = (b.name as string).trim() || undefined;
  if (b.notes !== undefined) value.notes = (b.notes as string).trim() || undefined;
  return { value };
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  try {
    switch (req.method) {
      case 'GET': {
        if (id) {
          const lead = await getLead(id);
          return lead ? json(lead) : json({ error: 'Lead not found.' }, 404);
        }
        return json(await listLeads());
      }

      case 'POST': {
        const body = await req.json().catch(() => null);
        const result = validateCreateInput(body);
        if ('error' in result) return json({ error: result.error }, 400);
        const lead = await createLead(result.value);
        return json(lead, 201);
      }

      case 'PUT': {
        if (!id) return json({ error: 'Missing required "id" query parameter.' }, 400);
        const body = await req.json().catch(() => null);
        const result = validateUpdateInput(body);
        if ('error' in result) return json({ error: result.error }, 400);
        const updated = await updateLead(id, result.value);
        return updated ? json(updated) : json({ error: 'Lead not found.' }, 404);
      }

      case 'DELETE': {
        if (!id) return json({ error: 'Missing required "id" query parameter.' }, 400);
        const deleted = await deleteLead(id);
        return deleted ? json({ success: true }) : json({ error: 'Lead not found.' }, 404);
      }

      default:
        return json({ error: 'Method not allowed.' }, 405);
    }
  } catch (err) {
    console.error('leads function error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
};

export const config: Config = {
  path: '/.netlify/functions/leads',
};
