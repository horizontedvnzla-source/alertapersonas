const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'alertapersonas.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS disasters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    radius_km REAL DEFAULT 50,
    triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    active INTEGER DEFAULT 1,
    source TEXT DEFAULT 'manual'
  );

  CREATE TABLE IF NOT EXISTS safe_persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL,
    name TEXT,
    lat REAL,
    lng REAL,
    location_text TEXT,
    disaster_id INTEGER NOT NULL,
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    photo_url TEXT,
    FOREIGN KEY(disaster_id) REFERENCES disasters(id)
  );

  CREATE TABLE IF NOT EXISTS searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_phone TEXT NOT NULL,
    missing_name TEXT NOT NULL,
    description TEXT,
    last_known_lat REAL,
    last_known_lng REAL,
    photo_url TEXT,
    disaster_id INTEGER NOT NULL,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    FOREIGN KEY(disaster_id) REFERENCES disasters(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    search_id INTEGER NOT NULL,
    recipient_phone TEXT NOT NULL,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    response TEXT,
    FOREIGN KEY(search_id) REFERENCES searches(id)
  );

  CREATE TABLE IF NOT EXISTS assistance_centers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    address TEXT,
    capacity INTEGER,
    current_count INTEGER DEFAULT 0,
    disaster_id INTEGER NOT NULL,
    active INTEGER DEFAULT 1,
    FOREIGN KEY(disaster_id) REFERENCES disasters(id)
  );

  CREATE INDEX IF NOT EXISTS idx_safe_disaster ON safe_persons(disaster_id);
  CREATE INDEX IF NOT EXISTS idx_searches_disaster ON searches(disaster_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_search ON notifications(search_id);
`);

module.exports = db;
