let currentUser = null;
let currentTab = 'my-tasks';
let employees = [];
let timerInterval = null;

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

  // Time tracking buttons
  document.getElementById('timeStartBtn').addEventListener('click', startTimer);
  document.getElementById('timeStopBtn').addEventListener('click', stopTimer);

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
  document.getElementById('timeTaskId').value = taskId;

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

  // Load time entries and notes
  await loadTimeEntries(taskId);
  await loadNotes(taskId);
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
async function loadTimeEntries(taskId) {
  const res = await fetch(`/api/tasks/${taskId}/time`);
  const entries = await res.json();
  const list = document.getElementById('timeEntries');
  const totalDisplay = document.getElementById('timeTotalDisplay');

  // Check if current user has a running timer on this task
  const myRunning = entries.find(e => e.employee_id === currentUser.id && !e.end_time);
  const startBtn = document.getElementById('timeStartBtn');
  const stopBtn = document.getElementById('timeStopBtn');
  const timerDisplay = document.getElementById('timerDisplay');

  if (myRunning) {
    startBtn.style.display = 'none';
    stopBtn.style.display = '';
    timerDisplay.style.display = '';
    startLiveTimer(myRunning.start_time);
  } else {
    startBtn.style.display = '';
    stopBtn.style.display = 'none';
    timerDisplay.style.display = 'none';
    clearInterval(timerInterval);
  }

  // Calculate total time
  let totalMinutes = 0;
  entries.forEach(e => {
    if (e.end_time) {
      const start = new Date(e.start_time);
      const end = new Date(e.end_time);
      totalMinutes += (end - start) / 60000;
    }
  });
  const totalHrs = Math.floor(totalMinutes / 60);
  const totalMins = Math.round(totalMinutes % 60);
  totalDisplay.textContent = entries.length > 0
    ? `Total time logged: ${totalHrs}h ${totalMins}m`
    : '';

  if (entries.length === 0) {
    list.innerHTML = '<p class="no-notes">No time entries yet.</p>';
    return;
  }

  list.innerHTML = entries.map(e => {
    const start = formatTimeCT(e.start_time);
    const end = e.end_time ? formatTimeCT(e.end_time) : '<span class="timer-running">Running...</span>';
    let duration = '';
    if (e.end_time) {
      const mins = Math.round((new Date(e.end_time) - new Date(e.start_time)) / 60000);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      duration = `${h}h ${m}m`;
    }
    const canDelete = (e.employee_id === currentUser.id || currentUser.is_admin) && e.end_time;
    return `
      <div class="time-entry-item">
        <div class="time-entry-header">
          <strong>${escapeHtml(e.employee_name)}</strong>
          ${canDelete ? `<button class="btn btn-xs btn-danger time-delete-btn" data-task-id="${e.task_id}" data-entry-id="${e.id}">&times;</button>` : ''}
        </div>
        <div class="time-entry-detail">
          <span>${start} &mdash; ${end}</span>
          ${duration ? `<span class="time-entry-duration">${duration}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.time-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this time entry?')) return;
      await fetch(`/api/tasks/${btn.dataset.taskId}/time/${btn.dataset.entryId}`, { method: 'DELETE' });
      await loadTimeEntries(btn.dataset.taskId);
    });
  });
}

function startLiveTimer(startTime) {
  clearInterval(timerInterval);
  const display = document.getElementById('timerDisplay');
  function update() {
    const now = new Date();
    const start = new Date(startTime);
    const diff = Math.max(0, now - start);
    const secs = Math.floor(diff / 1000) % 60;
    const mins = Math.floor(diff / 60000) % 60;
    const hrs = Math.floor(diff / 3600000);
    display.textContent = `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  }
  update();
  timerInterval = setInterval(update, 1000);
}

async function startTimer() {
  const taskId = document.getElementById('timeTaskId').value;
  const res = await fetch(`/api/tasks/${taskId}/time/start`, { method: 'POST' });
  if (res.ok) {
    await loadTimeEntries(taskId);
  } else {
    const data = await res.json();
    alert(data.error || 'Failed to start timer');
  }
}

async function stopTimer() {
  const taskId = document.getElementById('timeTaskId').value;
  const res = await fetch(`/api/tasks/${taskId}/time/stop`, { method: 'POST' });
  if (res.ok) {
    clearInterval(timerInterval);
    await loadTimeEntries(taskId);
  } else {
    const data = await res.json();
    alert(data.error || 'Failed to stop timer');
  }
}

function formatTimeCT(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
    hour12: true
  }) + ' CT';
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
