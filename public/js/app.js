let currentUser = null;
let currentTab = 'my-tasks';
let employees = [];

// ---- Init ----
async function init() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login.html'; return; }
    currentUser = await res.json();
  } catch { window.location.href = '/login.html'; return; }

  document.getElementById('userName').textContent = currentUser.full_name;
  if (currentUser.is_admin) {
    document.getElementById('adminLink').style.display = '';
  }

  // Load employees for assign dropdown
  const empRes = await fetch('/api/employees');
  employees = await empRes.json();
  populateAssignDropdown();

  loadTasks();
  setupEventListeners();
}

function populateAssignDropdown() {
  const sel = document.getElementById('taskAssign');
  sel.innerHTML = '';
  employees.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = e.full_name;
    if (e.id === currentUser.id) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ---- Event Listeners ----
function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      loadTasks();
    });
  });

  // Logout
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  // Add task
  document.getElementById('addTaskBtn').addEventListener('click', () => openTaskModal());

  // Task form submit
  document.getElementById('taskForm').addEventListener('submit', saveTask);

  // Note form submit
  document.getElementById('noteForm').addEventListener('submit', addNote);

  // Modal close buttons
  document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    });
  });

  // Filters
  document.getElementById('filterUrgency').addEventListener('change', loadTasks);
  document.getElementById('filterSearch').addEventListener('input', debounce(loadTasks, 300));
}

// ---- Load Tasks ----
async function loadTasks() {
  let url;
  if (currentTab === 'my-tasks') {
    url = '/api/tasks/my-tasks';
  } else if (currentTab === 'assigned') {
    url = '/api/tasks/assigned-by-me';
  } else {
    url = '/api/tasks/all?status=completed';
  }

  const res = await fetch(url);
  let tasks = await res.json();

  // Client-side filtering
  const urgencyFilter = document.getElementById('filterUrgency').value;
  const searchFilter = document.getElementById('filterSearch').value.toLowerCase();

  if (urgencyFilter) {
    tasks = tasks.filter(t => t.urgency === urgencyFilter);
  }
  if (searchFilter) {
    tasks = tasks.filter(t =>
      t.title.toLowerCase().includes(searchFilter) ||
      (t.description || '').toLowerCase().includes(searchFilter)
    );
  }

  // For my-tasks and assigned tabs, only show open by default
  if (currentTab === 'my-tasks' || currentTab === 'assigned') {
    tasks = tasks.filter(t => t.status === 'open');
  }

  renderTasks(tasks);
}

// ---- Render Tasks ----
function renderTasks(tasks) {
  const list = document.getElementById('taskList');
  const empty = document.getElementById('emptyState');

  if (tasks.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = tasks.map(t => {
    const dueStr = t.due_date ? formatDate(t.due_date) : 'No due date';
    const isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.status === 'open';
    const urgencyLabel = { red: 'Urgent', yellow: 'Due Soon', green: 'On Track', blue: 'Low Priority' };

    return `
      <div class="task-card urgency-${t.urgency} ${t.status === 'completed' ? 'task-completed' : ''}" data-id="${t.id}">
        <div class="task-card-header">
          <div class="task-urgency-badge urgency-bg-${t.urgency}">${urgencyLabel[t.urgency]}</div>
          ${t.status === 'open' ? `
            <button class="btn btn-xs btn-success task-complete-btn" data-id="${t.id}" title="Mark Complete">Complete</button>
          ` : '<span class="badge-completed">Completed</span>'}
        </div>
        <h3 class="task-title">${escapeHtml(t.title)}</h3>
        <p class="task-desc">${escapeHtml(t.description || '')}</p>
        <div class="task-meta">
          <span class="task-due ${isOverdue ? 'overdue' : ''}">${isOverdue ? 'OVERDUE: ' : ''}${dueStr}</span>
          ${currentTab === 'assigned' ? `<span class="task-assignee">Assigned to: ${escapeHtml(t.assigned_to_name || 'Unassigned')}</span>` : ''}
          ${currentTab === 'my-tasks' && currentUser.is_admin ? `<span class="task-assignee">Assigned to: ${escapeHtml(t.assigned_to_name || 'Unassigned')} | From: ${escapeHtml(t.created_by_name || '')}</span>` : ''}
          ${currentTab === 'my-tasks' && !currentUser.is_admin ? `<span class="task-assignee">From: ${escapeHtml(t.created_by_name || '')}</span>` : ''}
        </div>
        <div class="task-actions">
          <button class="btn btn-xs btn-outline task-detail-btn" data-id="${t.id}">Notes & Details</button>
          ${t.status === 'open' ? `<button class="btn btn-xs btn-outline task-edit-btn" data-id="${t.id}">Edit</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Attach event listeners
  list.querySelectorAll('.task-complete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      completeTask(btn.dataset.id);
    });
  });
  list.querySelectorAll('.task-detail-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDetailModal(btn.dataset.id);
    });
  });
  list.querySelectorAll('.task-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTaskModal(btn.dataset.id);
    });
  });
}

// ---- Task Modal ----
async function openTaskModal(taskId) {
  const modal = document.getElementById('taskModal');
  const title = document.getElementById('modalTitle');
  document.getElementById('taskId').value = '';
  document.getElementById('taskForm').reset();
  populateAssignDropdown();

  if (taskId) {
    title.textContent = 'Edit Task';
    const res = await fetch(`/api/tasks/all`);
    const tasks = await res.json();
    const task = tasks.find(t => t.id == taskId);
    if (task) {
      document.getElementById('taskId').value = task.id;
      document.getElementById('taskTitle').value = task.title;
      document.getElementById('taskDesc').value = task.description || '';
      document.getElementById('taskUrgency').value = task.urgency;
      document.getElementById('taskDue').value = task.due_date || '';
      document.getElementById('taskAssign').value = task.assigned_to;
    }
  } else {
    title.textContent = 'New Task';
  }

  modal.style.display = 'flex';
}

async function saveTask(e) {
  e.preventDefault();
  const taskId = document.getElementById('taskId').value;
  const body = {
    title: document.getElementById('taskTitle').value,
    description: document.getElementById('taskDesc').value,
    urgency: document.getElementById('taskUrgency').value,
    due_date: document.getElementById('taskDue').value || null,
    assigned_to: parseInt(document.getElementById('taskAssign').value),
    notify: document.getElementById('taskNotify').checked
  };

  const url = taskId ? `/api/tasks/${taskId}` : '/api/tasks';
  const method = taskId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.ok) {
    document.getElementById('taskModal').style.display = 'none';
    loadTasks();
  } else {
    const data = await res.json();
    alert(data.error || 'Failed to save task');
  }
}

async function completeTask(id) {
  if (!confirm('Mark this task as complete?')) return;
  await fetch(`/api/tasks/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' })
  });
  loadTasks();
}

// ---- Detail / Notes Modal ----
async function openDetailModal(taskId) {
  const modal = document.getElementById('detailModal');
  document.getElementById('noteTaskId').value = taskId;

  // Load task details
  const res = await fetch('/api/tasks/all');
  const tasks = await res.json();
  const task = tasks.find(t => t.id == taskId);

  if (!task) return;

  const urgencyLabel = { red: 'Urgent', yellow: 'Due Soon', green: 'On Track', blue: 'Low Priority' };
  document.getElementById('detailTitle').textContent = task.title;
  document.getElementById('detailBody').innerHTML = `
    <div class="detail-grid">
      <div class="detail-item">
        <strong>Status:</strong> <span class="badge-${task.status}">${task.status === 'open' ? 'Open' : 'Completed'}</span>
      </div>
      <div class="detail-item">
        <strong>Urgency:</strong> <span class="urgency-badge urgency-bg-${task.urgency}">${urgencyLabel[task.urgency]}</span>
      </div>
      <div class="detail-item">
        <strong>Due Date:</strong> ${task.due_date ? formatDate(task.due_date) : 'None'}
      </div>
      <div class="detail-item">
        <strong>Assigned To:</strong> ${escapeHtml(task.assigned_to_name || 'Unassigned')}
      </div>
      <div class="detail-item">
        <strong>Created By:</strong> ${escapeHtml(task.created_by_name || '')}
      </div>
      <div class="detail-item">
        <strong>Created:</strong> ${formatDateTime(task.created_at)}
      </div>
    </div>
    ${task.description ? `<div class="detail-desc"><strong>Description:</strong><p>${escapeHtml(task.description)}</p></div>` : ''}
  `;

  // Load notes and time entries
  await loadNotes(taskId);
  await loadTimeEntries(taskId);
  setupTimerButtons(taskId);
  modal.style.display = 'flex';
}

async function loadNotes(taskId) {
  const res = await fetch(`/api/tasks/${taskId}/notes`);
  const notes = await res.json();
  const list = document.getElementById('notesList');

  if (notes.length === 0) {
    list.innerHTML = '<p class="no-notes">No notes yet.</p>';
    return;
  }

  list.innerHTML = notes.map(n => `
    <div class="note-item">
      <div class="note-header">
        <strong>${escapeHtml(n.author_name)}</strong>
        <span class="note-time">${formatDateTime(n.created_at)}</span>
      </div>
      <p>${escapeHtml(n.note)}</p>
    </div>
  `).join('');
}

async function addNote(e) {
  e.preventDefault();
  const taskId = document.getElementById('noteTaskId').value;
  const note = document.getElementById('noteText').value.trim();
  if (!note) return;

  const res = await fetch(`/api/tasks/${taskId}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note })
  });

  if (res.ok) {
    document.getElementById('noteText').value = '';
    await loadNotes(taskId);
  }
}

// ---- Time Tracking ----
let timerInterval = null;

function setupTimerButtons(taskId) {
  const startBtn = document.getElementById('timerStartBtn');
  const stopBtn = document.getElementById('timerStopBtn');
  const runningEl = document.getElementById('timerRunning');

  // Remove old listeners by cloning
  const newStart = startBtn.cloneNode(true);
  const newStop = stopBtn.cloneNode(true);
  startBtn.parentNode.replaceChild(newStart, startBtn);
  stopBtn.parentNode.replaceChild(newStop, stopBtn);

  newStart.addEventListener('click', () => startTimer(taskId));
  newStop.addEventListener('click', () => stopTimer(taskId));
}

async function startTimer(taskId) {
  const res = await fetch(`/api/tasks/${taskId}/time/start`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json();
    alert(data.error || 'Failed to start timer');
    return;
  }
  await loadTimeEntries(taskId);
}

async function stopTimer(taskId) {
  const res = await fetch(`/api/tasks/${taskId}/time/stop`, { method: 'POST' });
  if (!res.ok) {
    const data = await res.json();
    alert(data.error || 'Failed to stop timer');
    return;
  }
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  await loadTimeEntries(taskId);
}

async function loadTimeEntries(taskId) {
  const res = await fetch(`/api/tasks/${taskId}/time`);
  const entries = await res.json();
  const list = document.getElementById('timeEntries');
  const startBtn = document.getElementById('timerStartBtn');
  const stopBtn = document.getElementById('timerStopBtn');
  const runningEl = document.getElementById('timerRunning');
  const totalRow = document.getElementById('timeTotalRow');
  const totalEl = document.getElementById('timeTotal');

  // Check for running timer
  const myRunning = entries.find(e => !e.end_time && e.employee_id === currentUser.id);

  if (myRunning) {
    startBtn.style.display = 'none';
    stopBtn.style.display = '';
    runningEl.style.display = '';
    // Start live counter
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - new Date(myRunning.start_time).getTime()) / 1000);
      document.getElementById('timerElapsed').textContent = formatDurationHMS(elapsed);
    }, 1000);
  } else {
    startBtn.style.display = '';
    stopBtn.style.display = 'none';
    runningEl.style.display = 'none';
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  if (entries.length === 0) {
    list.innerHTML = '<p class="no-time">No time logged yet.</p>';
    totalRow.style.display = 'none';
    return;
  }

  let totalMinutes = 0;

  list.innerHTML = entries.map(e => {
    const start = new Date(e.start_time);
    const startStr = formatTimeCT(start);

    if (!e.end_time) {
      return `
        <div class="time-entry time-entry-running">
          <div class="time-entry-info">
            <div class="time-entry-name">${escapeHtml(e.employee_name)}</div>
            <div class="time-entry-range">${formatDateShort(start)} ${startStr} — running...</div>
          </div>
          <div class="time-entry-duration">⏱ Active</div>
        </div>
      `;
    }

    const end = new Date(e.end_time);
    const endStr = formatTimeCT(end);
    const mins = Math.round((end - start) / 60000);
    totalMinutes += mins;
    const canDelete = e.employee_id === currentUser.id || currentUser.is_admin;

    return `
      <div class="time-entry">
        <div class="time-entry-info">
          <div class="time-entry-name">${escapeHtml(e.employee_name)}</div>
          <div class="time-entry-range">${formatDateShort(start)} ${startStr} — ${endStr}</div>
        </div>
        <div class="time-entry-duration">${formatDurationShort(mins)}</div>
        ${canDelete ? `<button class="time-entry-delete" data-task="${taskId}" data-entry="${e.id}" title="Delete">&times;</button>` : ''}
      </div>
    `;
  }).join('');

  // Show total
  if (totalMinutes > 0) {
    totalRow.style.display = '';
    totalEl.textContent = formatDurationShort(totalMinutes);
  } else {
    totalRow.style.display = 'none';
  }

  // Attach delete handlers
  list.querySelectorAll('.time-entry-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this time entry?')) return;
      await fetch(`/api/tasks/${btn.dataset.task}/time/${btn.dataset.entry}`, { method: 'DELETE' });
      await loadTimeEntries(taskId);
    });
  });
}

function formatDurationHMS(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function formatDurationShort(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatTimeCT(date) {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
}

function formatDateShort(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
}

// ---- Utilities ----
function formatDate(d) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d) {
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// Start
init();
