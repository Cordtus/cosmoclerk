import db from "../database/db";

interface UserAction {
  chain?: string;
  messageId?: number;
  chatId?: number;
  browsingTestnets?: boolean;
  timestamp?: Date;
  customData?: Record<string, any>;
}

export function updateUserLastAction(userId: number, data: UserAction | null): void {
  if (data) {
    const timestamp = data.timestamp?.getTime() || new Date().getTime();
    const customData = JSON.stringify(data.customData || {});

    const stmt = db.prepare(`
      INSERT INTO user_sessions (user_id, custom_data, last_action_timestamp) 
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
      custom_data=excluded.custom_data,
      last_action_timestamp=excluded.last_action_timestamp
    `);

    stmt.run(userId, customData, timestamp);
  } else {
    const deleteStmt = db.prepare("DELETE FROM user_sessions WHERE user_id = ?");
    deleteStmt.run(userId);
  }
}

export function getUserLastAction(userId: number): UserAction | undefined {
  const stmt = db.prepare("SELECT * FROM user_sessions WHERE user_id = ?");
  const row = stmt.get(userId);

  if (row) {
    return {
      customData: JSON.parse(row.custom_data),
      timestamp: new Date(row.last_action_timestamp),
    };
  }
  return undefined;
}

export function resetUserSession(userId: number): void {
  const deleteStmt = db.prepare("DELETE FROM user_sessions WHERE user_id = ?");
  deleteStmt.run(userId);
  console.log(`[${new Date().toISOString()}] Resetting session for user ${userId}`);
}
