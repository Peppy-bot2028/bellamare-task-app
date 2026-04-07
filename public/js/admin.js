let currentUser = null;

async function init() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login.html'; return; }
    currentUser = await res.json();
    if (!currentUser.is_admin) { window.location.href = '/'; return; }
  } catch { window.location.href = '/login.html'; return; }

  loadEmployees();
  setupEventListeners();
  setupAdminTabs();
}

function setupEventListeners() {
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  document.getElementById('addEmployeeBtn').addEventListener('click', () => openEmpModal());
  document.getElementById('empForm').addEventListener('submit', saveEmployee);

  document.querySelectorAll('.modal-close, .modal-overlay').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    });
  });
}

async function loadEmployees() {
  const res = await fetch('/api/admin/employees');
  const employees = await res.json();

  const list = document.getElementById('employeeList');
  list.innerHTML = employees.map(e => `
    <div class="employee-card">
      <div class="emp-info">
        <h3>${escapeHtml(e.full_name)} ${e.is_admin ? '<span class="badge-admin">Admin</span>' : ''}</h3>
        <p class="emp-detail">Username: <strong>${escapeHtml(e.username)}</strong></p>
        <p class="emp-detail">Email: ${escapeHtml(e.email)}</p>
        <p class="emp-detail">Phone: ${e.phone || 'Not set'} ${e.carrier ? '(' + e.carrier + ')' : ''}</p>
      </div>
      <div class="emp-actions">
        <button class="btn btn-xs btn-outline emp-edit-btn" data-id="${e.id}">Edit</button>
        ${e.id !== currentUser.id ? `<button class="btn btn-xs btn-danger emp-delete-btn" data-id="${e.id}">Delete</button>` : ''}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.emp-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openEmpModal(btn.dataset.id));
  });
  list.querySelectorAll('.emp-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteEmployee(btn.dataset.id));
  });
}

async function openEmpModal(empId) {
  const modal = document.getElementById('empModal');
  document.getElementById('empForm').reset();
  document.getElementById('empId').value = '';

  if (empId) {
    document.getElementById('empModalTitle').textContent = 'Edit Employee';
    document.getElementById('pwdHint').textContent = '(leave blank to keep)';
    document.getElementById('empPassword').required = false;

    const res = await fetch('/api/admin/employees');
    const employees = await res.json();
    const emp = employees.find(e => e.id == empId);
    if (emp) {
      document.getElementById('empId').value = emp.id;
      document.getElementById('empUsername').value = emp.username;
      document.getElementById('empUsername').disabled = true;
      document.getElementById('empName').value = emp.full_name;
      document.getElementById('empEmail').value = emp.email;
      document.getElementById('empPhone').value = emp.phone || '';
      document.getElementById('empCarrier').value = emp.carrier || '';
      document.getElementById('empAdmin').checked = emp.is_admin;
    }
  } else {
    document.getElementById('empModalTitle').textContent = 'Add Employee';
    document.getElementById('pwdHint').textContent = '*';
    document.getElementById('empPassword').required = true;
    document.getElementById('empUsername').disabled = false;
  }

  modal.style.display = 'flex';
}

async function saveEmployee(e) {
  e.preventDefault();
  const empId = document.getElementById('empId').value;

  const body = {
    full_name: document.getElementById('empName').value,
    email: document.getElementById('empEmail').value,
    phone: document.getElementById('empPhone').value || null,
    carrier: document.getElementById('empCarrier').value || null,
    is_admin: document.getElementById('empAdmin').checked
  };

  const pwd = document.getElementById('empPassword').value;
  if (pwd) body.password = pwd;

  if (!empId) {
    body.username = document.getElementById('empUsername').value;
    body.password = pwd;
  }

  const url = empId ? `/api/admin/employees/${empId}` : '/api/admin/employees';
  const method = empId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.ok) {
    document.getElementById('empModal').style.display = 'none';
    loadEmployees();
  } else {
    const data = await res.json();
    alert(data.error || 'Failed to save employee');
  }
}

async function deleteEmployee(id) {
  if (!confirm('Are you sure you want to remove this employee?')) return;
  const res = await fetch(`/api/admin/employees/${id}`, { method: 'DELETE' });
  if (res.ok) loadEmployees();
  else {
    const data = await res.json();
    alert(data.error || 'Failed to delete');
  }
}

// ---- Admin Tabs ----
function setupAdminTabs() {
  document.querySelectorAll('[data-admin-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-admin-tab]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const target = tab.dataset.adminTab;
      document.getElementById('employeesTab').style.display = target === 'employees' ? '' : 'none';
      document.getElementById('timeReportTab').style.display = target === 'time-report' ? '' : 'none';

      if (target === 'time-report') {
        loadTimeReport();
      }
    });
  });
}

// ---- Time Report ----
let allTimeEntries = [];

async function loadTimeReport() {
  // Load employees for filter dropdown
  const empRes = await fetch('/api/admin/employees');
  const employees = await empRes.json();
  const empSelect = document.getElementById('timeFilterEmployee');
  empSelect.innerHTML = '<option value="">All Employees</option>' +
    employees.map(e => `<option value="${e.id}">${escapeHtml(e.full_name)}</option>`).join('');

  // Load time entries
  const res = await fetch('/api/tasks/admin/time-report');
  allTimeEntries = await res.json();

  // Set default date range (last 30 days)
  const today = new Date();
  const thirtyAgo = new Date();
  thirtyAgo.setDate(today.getDate() - 30);
  document.getElementById('timeFilterTo').value = today.toISOString().split('T')[0];
  document.getElementById('timeFilterFrom').value = thirtyAgo.toISOString().split('T')[0];

  // Set up filter listeners
  document.getElementById('timeFilterEmployee').addEventListener('change', renderTimeReport);
  document.getElementById('timeFilterFrom').addEventListener('change', renderTimeReport);
  document.getElementById('timeFilterTo').addEventListener('change', renderTimeReport);

  renderTimeReport();
}

function renderTimeReport() {
  const empFilter = document.getElementById('timeFilterEmployee').value;
  const fromFilter = document.getElementById('timeFilterFrom').value;
  const toFilter = document.getElementById('timeFilterTo').value;

  let entries = allTimeEntries.filter(e => e.end_time); // Only completed entries

  if (empFilter) entries = entries.filter(e => e.employee_id == empFilter);
  if (fromFilter) entries = entries.filter(e => e.start_time >= fromFilter);
  if (toFilter) entries = entries.filter(e => e.start_time <= toFilter + 'T23:59:59');

  // Summary by employee
  const byEmployee = {};
  entries.forEach(e => {
    if (!byEmployee[e.employee_name]) byEmployee[e.employee_name] = 0;
    const mins = Math.round((new Date(e.end_time) - new Date(e.start_time)) / 60000);
    byEmployee[e.employee_name] += mins;
  });

  const totalMins = Object.values(byEmployee).reduce((a, b) => a + b, 0);

  const summary = document.getElementById('timeSummary');
  summary.innerHTML = `
    <div class="time-summary-card">
      <div class="time-value">${formatDuration(totalMins)}</div>
      <div class="time-label">Total Hours</div>
    </div>
    ${Object.entries(byEmployee).sort((a, b) => b[1] - a[1]).map(([name, mins]) => `
      <div class="time-summary-card">
        <div class="time-value">${formatDuration(mins)}</div>
        <div class="time-label">${escapeHtml(name)}</div>
      </div>
    `).join('')}
  `;

  // Table
  const table = document.getElementById('timeReportTable');
  if (entries.length === 0) {
    table.innerHTML = '<p style="color:var(--text-light);text-align:center;padding:40px;">No time entries found for this period.</p>';
    return;
  }

  table.innerHTML = `
    <table class="time-report-table">
      <thead>
        <tr>
          <th>Employee</th>
          <th>Task</th>
          <th>Date</th>
          <th>Start</th>
          <th>End</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        ${entries.map(e => {
          const start = new Date(e.start_time);
          const end = new Date(e.end_time);
          const mins = Math.round((end - start) / 60000);
          return `
            <tr>
              <td>${escapeHtml(e.employee_name)}</td>
              <td>${escapeHtml(e.task_title)}</td>
              <td>${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })}</td>
              <td>${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })}</td>
              <td>${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })}</td>
              <td><strong>${formatDuration(mins)}</strong></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function formatDuration(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
