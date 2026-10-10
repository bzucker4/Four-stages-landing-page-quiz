export const QUIZ_STAGES = ['victim', 'creator', 'witness', 'unity'] as const;
export type QuizStage = (typeof QUIZ_STAGES)[number];

export interface Lead {
  id: string;
  stage: QuizStage;
  email?: string;
  name?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type LeadInput = {
  stage: QuizStage;
  email?: string;
  name?: string;
  notes?: string;
};

export type LeadUpdate = Partial<LeadInput>;

interface LeadRow {
  id: string;
  stage: string;
  email: string | null;
  name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToLead(row: LeadRow): Lead {
  return {
    id: row.id,
    stage: row.stage as QuizStage,
    email: row.email ?? undefined,
    name: row.name ?? undefined,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createLead(db: D1Database, input: LeadInput): Promise<Lead> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO leads (id, stage, email, name, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(id, input.stage, input.email ?? null, input.name ?? null, input.notes ?? null, now, now)
    .run();
  return { id, createdAt: now, updatedAt: now, ...input };
}

export async function getLead(db: D1Database, id: string): Promise<Lead | null> {
  const row = await db.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<LeadRow>();
  return row ? rowToLead(row) : null;
}

export async function listLeads(db: D1Database): Promise<Lead[]> {
  const { results } = await db.prepare('SELECT * FROM leads ORDER BY created_at DESC').all<LeadRow>();
  return results.map(rowToLead);
}

export async function updateLead(db: D1Database, id: string, patch: LeadUpdate): Promise<Lead | null> {
  const existing = await getLead(db, id);
  if (!existing) return null;
  const merged: Lead = {
    ...existing,
    ...patch,
    id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await db
    .prepare('UPDATE leads SET stage = ?, email = ?, name = ?, notes = ?, updated_at = ? WHERE id = ?')
    .bind(merged.stage, merged.email ?? null, merged.name ?? null, merged.notes ?? null, merged.updatedAt, id)
    .run();
  return merged;
}

export async function deleteLead(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM leads WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}
