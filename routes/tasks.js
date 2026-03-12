const express = require('express');
const db = require('../database');
const { sendNotification, APP_URL } = require('./notifications');
const router = express.Router();

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

router.use(requireAuth);

// Get tasks assigned to me
router.get('/my-tasks', (req, res) => {
  const tasks = db.prepare(`
    SELECT t.*, e.full_name as assigned_to_name, c.full_name as created_by_name
    FROM tasks t
    LEFT JOIN employees e ON t.assigned_to = e.id
    LEFT JOIN employees c ON t.created_by = c.id
    WHERE t.assigned_to = ?
    ORDER BY
      CASE t.status WHEN 'open' THEN 0 ELSE 1 END,
      CASE t.urgency WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 WHEN 'green' THEN 2 WHEN 'blue' THEN 3 END,
      t.due_date ASC
  `).all(req.session.userId);
  res.json(tasks);
});

// Get tasks I created/assigned to others
router.get('/assigned-by-me', (req, res) => {
  const tasks = db.prepare(`
    SELECT t.*, e.full_name as assigned_to_name, c.full_name as created_by_name
    FROM tasks t
    LEFT JOIN employees e ON t.assigned_to = e.id
    LEFT JOIN employees c ON t.created_by = c.id
    WHERE t.created_by = ?
    ORDER BY
      CASE t.status WHEN 'open' THEN 0 ELSE 1 END,
      CASE t.urgency WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 WHEN 'green' THEN 2 WHEN 'blue' THEN 3 END,
      t.due_date ASC
  `).all(req.session.userId);
  res.json(tasks);
});

// Get all tasks (admin or for archive view)
router.get('/all', (req, res) => {
  const status = req.query.status || null;
  const urgency = req.query.urgency || null;
  const search = req.query.search || null;

  let query = `
    SELECT t.*, e.full_name as assigned_to_name, c.full_name as created_by_name
    FROM tasks t
    LEFT JOIN employees e ON t.assigned_to = e.id
    LEFT JOIN employees c ON t.created_by = c.id
    WHERE (t.assigned_to = ? OR t.created_by = ? OR ? = 1)
  `;
  const params = [req.session.userId, req.session.userId, req.session.isAdmin ? 1 : 0];

  if (status) {
    query += ' AND t.status = ?';
    params.push(status);
  }
  if (urgency) {
    query += ' AND t.urgency = ?';
    params.push(urgency);
  }
  if (search) {
    query += ' AND (t.title LIKE ? OR t.description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ` ORDER BY
    CASE t.status WHEN 'open' THEN 0 ELSE 1 END,
    t.created_at DESC`;

  const tasks = db.prepare(query).all(...params);
  res.json(tasks);
});

// Create task
router.post('/', (req, res) => {
  const { title, description, urgency, due_date, assigned_to, notify } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const result = db.prepare(`
    INSERT INTO tasks (title, description, urgency, due_date, assigned_to, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title, description || '', urgency || 'green', due_date || null, assigned_to || req.session.userId, req.session.userId);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);

  // Send notification if assigned to someone else and notify is enabled
  if (notify !== false && assigned_to && assigned_to !== req.session.userId) {
    const assignee = db.prepare('SELECT * FROM employees WHERE id = ?').get(assigned_to);
    const assigner = db.prepare('SELECT full_name FROM employees WHERE id = ?').get(req.session.userId);
    if (assignee) {
      sendNotification(
        assignee,
        `New Task Assigned: ${title}`,
        `${assigner.full_name} assigned you a new task: "${title}"\nUrgency: ${urgency || 'green'}\nDue: ${due_date || 'No due date'}\n\nDescription: ${description || 'None'}\n\nLog in: ${APP_URL}`
      );
    }
  }

  res.json(task);
});

// Update task
router.put('/:id', (req, res) => {
  const { title, description, urgency, due_date, assigned_to, status } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const completedAt = status === 'completed' ? new Date().toISOString() : task.completed_at;

  db.prepare(`
    UPDATE tasks SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      urgency = COALESCE(?, urgency),
      due_date = COALESCE(?, due_date),
      assigned_to = COALESCE(?, assigned_to),
      status = COALESCE(?, status),
      completed_at = ?
    WHERE id = ?
  `).run(title, description, urgency, due_date, assigned_to, status, completedAt, req.params.id);

  const updated = db.prepare(`
    SELECT t.*, e.full_name as assigned_to_name, c.full_name as created_by_name
    FROM tasks t
    LEFT JOIN employees e ON t.assigned_to = e.id
    LEFT JOIN employees c ON t.created_by = c.id
    WHERE t.id = ?
  `).get(req.params.id);

  // Send notification when task is completed
  if (status === 'completed' && task.status !== 'completed' && task.created_by !== req.session.userId) {
    const creator = db.prepare('SELECT * FROM employees WHERE id = ?').get(task.created_by);
    const completer = db.prepare('SELECT full_name FROM employees WHERE id = ?').get(req.session.userId);
    if (creator && completer) {
      sendNotification(
        creator,
        `Task Completed: ${task.title}`,
        `${completer.full_name} has completed the task: "${task.title}"\n\nCompleted: ${new Date().toLocaleString()}\n\nDescription: ${task.description || 'None'}\n\nLog in: ${APP_URL}`
      );
    }
  }

  res.json(updated);
});

// Delete task (admin only)
router.delete('/:id', (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ error: 'Admin only' });
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ message: 'Task deleted' });
});

// Get notes for a task
router.get('/:id/notes', (req, res) => {
  const notes = db.prepare(`
    SELECT n.*, e.full_name as author_name
    FROM task_notes n
    JOIN employees e ON n.employee_id = e.id
    WHERE n.task_id = ?
    ORDER BY n.created_at ASC
  `).all(req.params.id);
  res.json(notes);
});

// Add note to task
router.post('/:id/notes', (req, res) => {
  const { note } = req.body;
  if (!note) return res.status(400).json({ error: 'Note text is required' });

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const result = db.prepare(`
    INSERT INTO task_notes (task_id, employee_id, note)
    VALUES (?, ?, ?)
  `).run(req.params.id, req.session.userId, note);

  const newNote = db.prepare(`
    SELECT n.*, e.full_name as author_name
    FROM task_notes n
    JOIN employees e ON n.employee_id = e.id
    WHERE n.id = ?
  `).get(result.lastInsertRowid);

  res.json(newNote);
});

module.exports = router;
