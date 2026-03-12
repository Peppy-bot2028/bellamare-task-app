require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const cron = require('node-cron');
const db = require('./database');
const { sendNotification, APP_URL } = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'bellamare-fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/admin', require('./routes/admin'));

// Get employee list (for task assignment dropdown)
app.get('/api/employees', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const employees = db.prepare('SELECT id, full_name FROM employees ORDER BY full_name').all();
  res.json(employees);
});

// Daily reminder: tasks due tomorrow (runs at 8 AM)
cron.schedule('0 8 * * *', () => {
  console.log('[CRON] Checking for tasks due tomorrow...');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const dueTasks = db.prepare(`
    SELECT t.*, e.*
    FROM tasks t
    JOIN employees e ON t.assigned_to = e.id
    WHERE t.due_date = ? AND t.status = 'open'
  `).all(tomorrowStr);

  dueTasks.forEach(task => {
    sendNotification(
      task,
      `Task Due Tomorrow: ${task.title}`,
      `Reminder: Your task "${task.title}" is due tomorrow (${task.due_date}).\n\nDescription: ${task.description || 'None'}\n\nLog in: ${APP_URL}`
    );
  });

  console.log(`[CRON] Sent reminders for ${dueTasks.length} tasks`);
});

// Test SMTP endpoint (admin only) - sends test email and returns raw error
app.get('/api/test-smtp', async (req, res) => {
  if (!req.session.userId || !req.session.isAdmin) {
    return res.status(403).json({ error: 'Admin only' });
  }
  const nodemailer = require('nodemailer');
  const user = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.session.userId);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.office365.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: { ciphers: 'SSLv3' }
  });
  try {
    const info = await transporter.sendMail({
      from: `"Bellamare Tasks" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: '[Bellamare Tasks] Test Email',
      text: 'If you receive this, SMTP notifications are working!'
    });
    res.json({ success: true, response: info.response, smtpUser: process.env.SMTP_USER });
  } catch (err) {
    res.json({ success: false, error: err.message, code: err.code, smtpUser: process.env.SMTP_USER, smtpHost: process.env.SMTP_HOST });
  }
});

// SPA fallback - serve index.html for non-API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Bellamare Task App running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
