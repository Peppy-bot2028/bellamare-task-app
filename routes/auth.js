const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../database');
const router = express.Router();

// Login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  const employee = db.prepare('SELECT * FROM employees WHERE username = ?').get(username);
  if (!employee) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  if (!bcrypt.compareSync(password, employee.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.userId = employee.id;
  req.session.isAdmin = employee.is_admin === 1;

  res.json({
    id: employee.id,
    username: employee.username,
    full_name: employee.full_name,
    email: employee.email,
    is_admin: employee.is_admin === 1
  });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out' });
});

// Get current user
router.get('/me', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  const employee = db.prepare('SELECT id, username, full_name, email, is_admin FROM employees WHERE id = ?').get(req.session.userId);
  if (!employee) {
    return res.status(401).json({ error: 'User not found' });
  }
  employee.is_admin = employee.is_admin === 1;
  res.json(employee);
});

module.exports = router;
