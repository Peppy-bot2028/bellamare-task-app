const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const { CARRIER_GATEWAYS } = require('./notifications');
const router = express.Router();

// Admin auth middleware
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

router.use(requireAdmin);

// Get all employees
router.get('/employees', (req, res) => {
  const employees = db.prepare(
    'SELECT id, username, full_name, email, phone, carrier, is_admin, created_at FROM employees ORDER BY full_name'
  ).all();
  res.json(employees);
});

// Add employee
router.post('/employees', (req, res) => {
  const { username, password, full_name, email, phone, carrier, is_admin } = req.body;
  if (!username || !password || !full_name || !email) {
    return res.status(400).json({ error: 'Username, password, full name, and email are required' });
  }

  const existing = db.prepare('SELECT id FROM employees WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already exists' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO employees (username, password_hash, full_name, email, phone, carrier, is_admin)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(username, hash, full_name, email, phone || null, carrier || null, is_admin ? 1 : 0);

  res.json({
    id: result.lastInsertRowid,
    username, full_name, email, phone, carrier, is_admin: !!is_admin
  });
});

// Update employee
router.put('/employees/:id', (req, res) => {
  const { full_name, email, phone, carrier, is_admin, password } = req.body;
  const employee = db.prepare('SELECT id FROM employees WHERE id = ?').get(req.params.id);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE employees SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
  }

  db.prepare(`
    UPDATE employees SET
      full_name = COALESCE(?, full_name),
      email = COALESCE(?, email),
      phone = COALESCE(?, phone),
      carrier = COALESCE(?, carrier),
      is_admin = COALESCE(?, is_admin)
    WHERE id = ?
  `).run(full_name, email, phone, carrier, is_admin !== undefined ? (is_admin ? 1 : 0) : null, req.params.id);

  const updated = db.prepare(
    'SELECT id, username, full_name, email, phone, carrier, is_admin FROM employees WHERE id = ?'
  ).get(req.params.id);
  res.json(updated);
});

// Delete employee
router.delete('/employees/:id', (req, res) => {
  const employeeId = parseInt(req.params.id);
  if (employeeId === req.session.userId) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }

  const employee = db.prepare('SELECT id FROM employees WHERE id = ?').get(employeeId);
  if (!employee) return res.status(404).json({ error: 'Employee not found' });

  try {
    // Use transaction to clean up all references before deleting
    const cleanup = db.transaction(() => {
      // Delete time entries logged by this employee
      db.prepare('DELETE FROM time_entries WHERE employee_id = ?').run(employeeId);
      // Delete notes authored by this employee
      db.prepare('DELETE FROM task_notes WHERE employee_id = ?').run(employeeId);
      // Unlink tasks (set created_by/assigned_to to NULL instead of deleting tasks)
      db.prepare('UPDATE tasks SET created_by = NULL WHERE created_by = ?').run(employeeId);
      db.prepare('UPDATE tasks SET assigned_to = NULL WHERE assigned_to = ?').run(employeeId);
      // Now delete the employee
      db.prepare('DELETE FROM employees WHERE id = ?').run(employeeId);
    });
    cleanup();
    res.json({ message: 'Employee deleted' });
  } catch (err) {
    console.error('Delete employee error:', err);
    res.status(500).json({ error: 'Failed to delete employee: ' + err.message });
  }
});

// Get carrier list
router.get('/carriers', (req, res) => {
  res.json(Object.keys(CARRIER_GATEWAYS));
});

module.exports = router;
