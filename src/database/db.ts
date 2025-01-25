import * as path from 'path';

import Database from 'better-sqlite3';

const dbPath = path.join(__dirname, '../../data', 'bot_data.db');
const db = new Database(dbPath);

// Create tables if they do not exist
db.exec(`
  CREATE TABLE IF NOT EXISTS user_sessions (
    user_id INTEGER PRIMARY KEY,
    custom_data TEXT,
    last_action_timestamp INTEGER
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS user_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT,
    timestamp INTEGER
  );
`);

export default db;
