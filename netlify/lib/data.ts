import { getStore } from '@netlify/blobs';

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

const STORE_NAME = 'quiz-leads';

function store() {
  return getStore(STORE_NAME);
}

export async function createLead(input: LeadInput): Promise<Lead> {
  const now = new Date().toISOString();
  const lead: Lead = {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...input,
  };
  await store().setJSON(lead.id, lead);
  return lead;
}

export async function getLead(id: string): Promise<Lead | null> {
  const lead = await store().get(id, { type: 'json' });
  return (lead as Lead | null) ?? null;
}

export async function listLeads(): Promise<Lead[]> {
  const { blobs } = await store().list();
  const leads = await Promise.all(blobs.map((entry) => getLead(entry.key)));
  return leads
    .filter((lead): lead is Lead => lead !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function updateLead(id: string, patch: LeadUpdate): Promise<Lead | null> {
  const existing = await getLead(id);
  if (!existing) return null;
  const updated: Lead = {
    ...existing,
    ...patch,
    id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  await store().setJSON(id, updated);
  return updated;
}

export async function deleteLead(id: string): Promise<boolean> {
  const existing = await getLead(id);
  if (!existing) return false;
  await store().delete(id);
  return true;
}
