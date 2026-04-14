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

// Helper: attach assignees (array of {id, full_name}) to a task or array of tasks
function enrichWithAssignees(taskOrTasks) {
  const stmt = db.prepare(`
    SELECT e.id, e.full_name
    FROM task_assignees ta
    JOIN employees e ON ta.employee_id = e.id
    WHERE ta.task_id = ?
    ORDER BY e.full_name
  `);
  const enrich = (t) => {
    const assignees = stmt.all(t.id);
    t.assignees = assignees;
    t.assignee_ids = assignees.map(a => a.id);
    t.assigned_to_names = assignees.map(a => a.full_name).join(', ') || 'Unassigned';
    return t;
  };
  return Array.isArray(taskOrTasks) ? taskOrTasks.map(enrich) : enrich(taskOrTasks);
}

// Helper: replace a task's assignees, returns array of assignee IDs
function setTaskAssignees(taskId, assigneeIds) {
  const ids = Array.isArray(assigneeIds) ? assigneeIds : (assigneeIds ? [assigneeIds] : []);
  const clean = [...new Set(ids.map(Number).filter(n => !isNaN(n)))];
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM task_assignees WHERE task_id = ?').run(taskId);
    const insert = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, employee_id) VALUES (?, ?)');
    clean.forEach(empId => insert.run(taskId, empId));
  });
  txn();
  return clean;
}

// Get tasks assigned to me (admins see all tasks)
router.get('/my-tasks', (req, res) => {
  const isAdmin = req.session.isAdmin ? 1 : 0;
  const tasks = db.prepare(`
    SELECT DISTINCT t.*, c.full_name as created_by_name
    FROM tasks t
    LEFT JOIN employees c ON t.created_by = c.id
    LEFT JOIN task_assignees ta ON t.id = ta.task_id
    WHERE ta.employee_id = ? OR ? = 1
    ORDER BY
      CASE t.status WHEN 'open' THEN 0 ELSE 1 END,
      CASE t.urgency WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 WHEN 'green' THEN 2 WHEN 'blue' THEN 3 END,
      t.due_date ASC
  `).all(req.session.userId, isAdmin);
  res.json(enrichWithAssignees(tasks));
});

// Get tasks I created/assigned to others
router.get('/assigned-by-me', (req, res) => {
  const tasks = db.prepare(`
    SELECT t.*, c.full_name as created_by_name
    FROM tasks t
    LEFT JOIN employees c ON t.created_by = c.id
    WHERE t.created_by = ?
    ORDER BY
      CASE t.status WHEN 'open' THEN 0 ELSE 1 END,
      CASE t.urgency WHEN 'red' THEN 0 WHEN 'yellow' THEN 1 WHEN 'green' THEN 2 WHEN 'blue' THEN 3 END,
      t.due_date ASC
  `).all(req.session.userId);
  res.json(enrichWithAssignees(tasks));
});

// Get all tasks (admin or for archive view)
router.get('/all', (req, res) => {
  const status = req.query.status || null;
  const urgency = req.query.urgency || null;
  const search = req.query.search || null;

  let query = `
    SELECT DISTINCT t.*, c.full_name as created_by_name
    FROM tasks t
    LEFT JOIN employees c ON t.created_by = c.id
    LEFT JOIN task_assignees ta ON t.id = ta.task_id
    WHERE (ta.employee_id = ? OR t.created_by = ? OR ? = 1)
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
  res.json(enrichWithAssignees(tasks));
});

// Create task
router.post('/', (req, res) => {
  const { title, description, urgency, due_date, assigned_to, notify } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  // Normalize assigned_to to an array
  let assigneeIds = Array.isArray(assigned_to) ? assigned_to : (assigned_to ? [assigned_to] : []);
  assigneeIds = [...new Set(assigneeIds.map(Number).filter(n => !isNaN(n)))];
  if (assigneeIds.length === 0) assigneeIds = [req.session.userId];

  // Store the first assignee on the legacy tasks.assigned_to column for backward compat
  const primaryAssignee = assigneeIds[0];

  const result = db.prepare(`
    INSERT INTO tasks (title, description, urgency, due_date, assigned_to, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title, description || '', urgency || 'green', due_date || null, primaryAssignee, req.session.userId);

  const taskId = result.lastInsertRowid;
  setTaskAssignees(taskId, assigneeIds);

  const task = enrichWithAssignees(db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId));

  // Send notifications for new task
  if (notify !== false && assigneeIds.length > 0) {
    const assigner = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.session.userId);
    const assignees = assigneeIds
      .filter(id => id !== req.session.userId)
      .map(id => db.prepare('SELECT * FROM employees WHERE id = ?').get(id))
      .filter(Boolean);
    const assigneeNames = assignees.map(a => a.full_name).join(', ');

    // Notify each assignee
    assignees.forEach(assignee => {
      sendNotification(
        assignee,
        `New Task Assigned: ${title}`,
        `${assigner.full_name} assigned you a new task: "${title}"\nUrgency: ${urgency || 'green'}\nDue: ${due_date || 'No due date'}\n\nDescription: ${description || 'None'}\n\nLog in: ${APP_URL}`,
        `New task from ${assigner.full_name}: "${title}"\n${APP_URL}`
      );
    });

    // Notify the sender (confirmation) if they assigned to someone else
    if (assigner && assignees.length > 0) {
      sendNotification(
        assigner,
        `Task Sent: ${title}`,
        `You assigned a new task to ${assigneeNames}: "${title}"\nUrgency: ${urgency || 'green'}\nDue: ${due_date || 'No due date'}\n\nDescription: ${description || 'None'}\n\nLog in: ${APP_URL}`,
        `Task sent to ${assigneeNames}: "${title}"\n${APP_URL}`
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

  // Only update assigned_to if it was explicitly passed
  let primaryAssignee = task.assigned_to;
  if (assigned_to !== undefined && assigned_to !== null) {
    let assigneeIds = Array.isArray(assigned_to) ? assigned_to : [assigned_to];
    assigneeIds = [...new Set(assigneeIds.map(Number).filter(n => !isNaN(n)))];
    if (assigneeIds.length > 0) {
      primaryAssignee = assigneeIds[0];
      setTaskAssignees(req.params.id, assigneeIds);
    }
  }

  db.prepare(`
    UPDATE tasks SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      urgency = COALESCE(?, urgency),
      due_date = COALESCE(?, due_date),
      assigned_to = ?,
      status = COALESCE(?, status),
      completed_at = ?
    WHERE id = ?
  `).run(title, description, urgency, due_date, primaryAssignee, status, completedAt, req.params.id);

  const updatedRow = db.prepare(`
    SELECT t.*, c.full_name as created_by_name
    FROM tasks t
    LEFT JOIN employees c ON t.created_by = c.id
    WHERE t.id = ?
  `).get(req.params.id);
  const updated = enrichWithAssignees(updatedRow);

  // Send notification when task is completed (notify creator and all assignees)
  if (status === 'completed' && task.status !== 'completed') {
    const creator = db.prepare('SELECT * FROM employees WHERE id = ?').get(task.created_by);
    const completer = db.prepare('SELECT full_name FROM employees WHERE id = ?').get(req.session.userId);
    const assigneeIds = db.prepare('SELECT employee_id FROM task_assignees WHERE task_id = ?').all(req.params.id).map(r => r.employee_id);

    if (completer) {
      // Notify the task creator (if they didn't complete it themselves)
      if (creator && task.created_by !== req.session.userId) {
        sendNotification(
          creator,
          `Task Completed: ${task.title}`,
          `${completer.full_name} has completed the task: "${task.title}"\n\nCompleted: ${new Date().toLocaleString()}\n\nDescription: ${task.description || 'None'}\n\nLog in: ${APP_URL}`,
          `${completer.full_name} completed: "${task.title}"\n${APP_URL}`
        );
      }

      // Notify each assignee (skip completer and creator to avoid duplicates)
      assigneeIds.forEach(aid => {
        if (aid === req.session.userId || aid === task.created_by) return;
        const assignee = db.prepare('SELECT * FROM employees WHERE id = ?').get(aid);
        if (assignee) {
          sendNotification(
            assignee,
            `Task Completed: ${task.title}`,
            `${completer.full_name} has marked your task as complete: "${task.title}"\n\nCompleted: ${new Date().toLocaleString()}\n\nDescription: ${task.description || 'None'}\n\nLog in: ${APP_URL}`,
            `${completer.full_name} completed: "${task.title}"\n${APP_URL}`
          );
        }
      });
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

// ---- Time Tracking ----

// Get time entries for a task
router.get('/:id/time', (req, res) => {
  const entries = db.prepare(`
    SELECT te.*, e.full_name as employee_name
    FROM time_entries te
    JOIN employees e ON te.employee_id = e.id
    WHERE te.task_id = ?
    ORDER BY te.start_time DESC
  `).all(req.params.id);
  res.json(entries);
});

// Start a timer on a task
router.post('/:id/time/start', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Check if this user already has a running timer on ANY task
  const running = db.prepare(`
    SELECT te.*, t.title as task_title
    FROM time_entries te
    JOIN tasks t ON te.task_id = t.id
    WHERE te.employee_id = ? AND te.end_time IS NULL
  `).get(req.session.userId);

  if (running) {
    return res.status(400).json({
      error: `You already have a timer running on "${running.task_title}". Stop it first.`
    });
  }

  // Use Central Time offset (UTC-6 for CST, UTC-5 for CDT)
  const now = new Date();
  const centralTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const startTime = centralTime.toISOString().replace('T', ' ').substring(0, 19);

  const result = db.prepare(`
    INSERT INTO time_entries (task_id, employee_id, start_time)
    VALUES (?, ?, ?)
  `).run(req.params.id, req.session.userId, startTime);

  const entry = db.prepare(`
    SELECT te.*, e.full_name as employee_name
    FROM time_entries te
    JOIN employees e ON te.employee_id = e.id
    WHERE te.id = ?
  `).get(result.lastInsertRowid);

  res.json(entry);
});

// Stop the running timer on a task
router.post('/:id/time/stop', (req, res) => {
  const running = db.prepare(`
    SELECT * FROM time_entries
    WHERE task_id = ? AND employee_id = ? AND end_time IS NULL
  `).get(req.params.id, req.session.userId);

  if (!running) {
    return res.status(400).json({ error: 'No running timer found for this task' });
  }

  const now = new Date();
  const centralTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const endTime = centralTime.toISOString().replace('T', ' ').substring(0, 19);

  db.prepare('UPDATE time_entries SET end_time = ? WHERE id = ?').run(endTime, running.id);

  const entry = db.prepare(`
    SELECT te.*, e.full_name as employee_name
    FROM time_entries te
    JOIN employees e ON te.employee_id = e.id
    WHERE te.id = ?
  `).get(running.id);

  res.json(entry);
});

// Delete a time entry (own entries only, or admin)
router.delete('/:id/time/:entryId', (req, res) => {
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(req.params.entryId);
  if (!entry) return res.status(404).json({ error: 'Time entry not found' });
  if (entry.employee_id !== req.session.userId && !req.session.isAdmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  db.prepare('DELETE FROM time_entries WHERE id = ?').run(req.params.entryId);
  res.json({ message: 'Time entry deleted' });
});

module.exports = router;
