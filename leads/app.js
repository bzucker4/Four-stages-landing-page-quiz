const API_URL = '/.netlify/functions/leads';

const STAGE_LABELS = {
  victim: 'Victim (To Me)',
  creator: 'Creator (By Me)',
  witness: 'Witness (Through Me)',
  unity: 'Unity (As Me)',
};

const els = {
  statusRegion: document.getElementById('status-region'),
  errorRegion: document.getElementById('error-region'),
  loading: document.getElementById('leads-loading'),
  empty: document.getElementById('leads-empty'),
  error: document.getElementById('leads-error'),
  tableWrap: document.getElementById('leads-table-wrap'),
  tbody: document.getElementById('leads-tbody'),
  retryBtn: document.getElementById('retry-load'),
  createForm: document.getElementById('create-form'),
  createStageError: document.getElementById('create-stage-error'),
  editDialog: document.getElementById('edit-dialog'),
  editForm: document.getElementById('edit-form'),
  editCancel: document.getElementById('edit-cancel'),
  confirmDialog: document.getElementById('confirm-dialog'),
  confirmDeleteBtn: document.getElementById('confirm-delete'),
  confirmCancel: document.getElementById('confirm-cancel'),
};

let pendingDeleteId = null;

function announce(message) {
  els.statusRegion.textContent = message;
}

function announceError(message) {
  els.errorRegion.textContent = message;
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function setView(view) {
  els.loading.hidden = view !== 'loading';
  els.empty.hidden = view !== 'empty';
  els.error.hidden = view !== 'error';
  els.tableWrap.hidden = view !== 'table';
}

function renderLeads(leads) {
  els.tbody.textContent = '';

  for (const lead of leads) {
    const tr = document.createElement('tr');

    const stageTd = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = 'stage-pill';
    pill.textContent = STAGE_LABELS[lead.stage] || lead.stage;
    stageTd.appendChild(pill);
    tr.appendChild(stageTd);

    const nameTd = document.createElement('td');
    nameTd.textContent = lead.name || '—';
    tr.appendChild(nameTd);

    const emailTd = document.createElement('td');
    emailTd.textContent = lead.email || '—';
    tr.appendChild(emailTd);

    const notesTd = document.createElement('td');
    notesTd.textContent = lead.notes || '—';
    tr.appendChild(notesTd);

    const dateTd = document.createElement('td');
    dateTd.textContent = formatDate(lead.createdAt);
    tr.appendChild(dateTd);

    const actionsTd = document.createElement('td');
    actionsTd.className = 'actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn';
    editBtn.textContent = 'Edit';
    editBtn.setAttribute('aria-label', `Edit lead for ${lead.name || lead.email || lead.stage}`);
    editBtn.addEventListener('click', () => openEditDialog(lead));
    actionsTd.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.setAttribute('aria-label', `Delete lead for ${lead.name || lead.email || lead.stage}`);
    deleteBtn.addEventListener('click', () => openConfirmDialog(lead));
    actionsTd.appendChild(deleteBtn);

    tr.appendChild(actionsTd);
    els.tbody.appendChild(tr);
  }
}

async function loadLeads() {
  setView('loading');
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
    const leads = await res.json();
    if (leads.length === 0) {
      setView('empty');
    } else {
      renderLeads(leads);
      setView('table');
    }
  } catch (err) {
    console.error('Failed to load leads:', err);
    setView('error');
    announceError('Failed to load leads. Use the retry button to try again.');
  }
}

els.retryBtn.addEventListener('click', loadLeads);

els.createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  els.createStageError.textContent = '';

  const formData = new FormData(els.createForm);
  const stage = formData.get('stage');
  if (!stage) {
    els.createStageError.textContent = 'Please choose a stage.';
    return;
  }

  const payload = {
    stage,
    email: formData.get('email')?.toString().trim() || undefined,
    name: formData.get('name')?.toString().trim() || undefined,
    notes: formData.get('notes')?.toString().trim() || undefined,
  };

  const submitBtn = els.createForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Request failed with status ${res.status}`);

    els.createForm.reset();
    announce('Lead added.');
    await loadLeads();
  } catch (err) {
    console.error('Failed to create lead:', err);
    announceError(`Failed to add lead: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
  }
});

function openEditDialog(lead) {
  els.editForm.elements['id'].value = lead.id;
  els.editForm.elements['stage'].value = lead.stage;
  els.editForm.elements['email'].value = lead.email || '';
  els.editForm.elements['name'].value = lead.name || '';
  els.editForm.elements['notes'].value = lead.notes || '';
  els.editDialog.showModal();
}

els.editCancel.addEventListener('click', () => els.editDialog.close());

els.editForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(els.editForm);
  const id = formData.get('id');
  const payload = {
    stage: formData.get('stage'),
    email: formData.get('email')?.toString().trim() || undefined,
    name: formData.get('name')?.toString().trim() || undefined,
    notes: formData.get('notes')?.toString().trim() || undefined,
  };

  const submitBtn = els.editForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const res = await fetch(`${API_URL}?id=${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Request failed with status ${res.status}`);

    els.editDialog.close();
    announce('Lead updated.');
    await loadLeads();
  } catch (err) {
    console.error('Failed to update lead:', err);
    announceError(`Failed to update lead: ${err.message}`);
  } finally {
    submitBtn.disabled = false;
  }
});

function openConfirmDialog(lead) {
  pendingDeleteId = lead.id;
  document.getElementById('confirm-dialog-body').textContent =
    `Delete the lead for ${lead.name || lead.email || STAGE_LABELS[lead.stage] || lead.stage}? This cannot be undone.`;
  els.confirmDialog.showModal();
}

els.confirmCancel.addEventListener('click', () => {
  pendingDeleteId = null;
  els.confirmDialog.close();
});

els.confirmDeleteBtn.addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  els.confirmDeleteBtn.disabled = true;
  try {
    const res = await fetch(`${API_URL}?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Request failed with status ${res.status}`);

    els.confirmDialog.close();
    announce('Lead deleted.');
    await loadLeads();
  } catch (err) {
    console.error('Failed to delete lead:', err);
    announceError(`Failed to delete lead: ${err.message}`);
    els.confirmDialog.close();
  } finally {
    pendingDeleteId = null;
    els.confirmDeleteBtn.disabled = false;
  }
});

loadLeads();
