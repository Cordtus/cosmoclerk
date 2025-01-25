import db from '../database/db';

export function logUserAction(userId: number, action: string): void {
  const stmt = db.prepare(`
    INSERT INTO user_logs (user_id, action, timestamp) VALUES (?, ?, ?)
  `);
  stmt.run(userId, action, new Date().getTime());
  console.log(`[${new Date().toISOString()}] User ${userId} action: ${action}`);
}
