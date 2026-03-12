const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'bellamare.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent access
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    carrier TEXT,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    urgency TEXT DEFAULT 'green' CHECK(urgency IN ('red','yellow','green','blue')),
    due_date DATE,
    status TEXT DEFAULT 'open' CHECK(status IN ('open','completed')),
    assigned_to INTEGER REFERENCES employees(id),
    created_by INTEGER REFERENCES employees(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS task_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    note TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed employees if none exist
const employeeCount = db.prepare('SELECT COUNT(*) as count FROM employees').get();
if (employeeCount.count === 0) {
  const defaultPassword = bcrypt.hashSync('Bellamare2026', 10);
  const adminPassword = bcrypt.hashSync('BellamareAdmin2026', 10);

  const insert = db.prepare(`
    INSERT INTO employees (username, password_hash, full_name, email, phone, carrier, is_admin)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const seedEmployees = db.transaction(() => {
    // John Bullard - Admin
    insert.run('john', adminPassword, 'John Bullard', 'Johnb@certifiedhm.com', '6019548477', 'att', 1);
    // All employees
    insert.run('kathryn', defaultPassword, 'Kathryn', 'Kathryn@certifiedhm.com', '6015177854', 'att', 0);
    insert.run('connie', defaultPassword, 'Connie', 'Connie@certifiedhm.com', '6015731162', 'att', 0);
    insert.run('brittany', defaultPassword, 'Brittany', 'Brittany@certifiedhm.com', '6019466149', 'att', 0);
    insert.run('olivia', defaultPassword, 'Olivia', 'Olivia@bellamaredevelopment.com', '6019545992', 'att', 0);
    insert.run('evie', defaultPassword, 'Evie', 'Evie@bellamaredevelopment.com', '6624011357', 'att', 0);
    insert.run('tatiana', defaultPassword, 'Tatiana', 'Tatiana@bellamaredevelopment.com', '6015869816', 'att', 0);
    insert.run('annajane', defaultPassword, 'Anna Jane', 'aj@bellamaredevelopment.com', '6019540054', 'att', 0);
    insert.run('sunny', defaultPassword, 'Sunny', 'Sunny@certifiedhm.com', '6016131188', 'att', 0);
    // Paige - Admin
    insert.run('paige', adminPassword, 'Paige', 'Paige@bellamaredevelopment.com', '9547340792', 'verizon', 1);
  });

  seedEmployees();
  console.log('All employees seeded successfully!');
  console.log('Admin login: username=john password=BellamareAdmin2026');
  console.log('Admin login: username=paige password=BellamareAdmin2026');
  console.log('Employee default password: Bellamare2026');
}

module.exports = db;
