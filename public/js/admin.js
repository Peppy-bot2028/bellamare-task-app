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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
