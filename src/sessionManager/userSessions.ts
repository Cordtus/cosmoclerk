import db from '../database/db';

// Define the structure of a user's action
export interface UserAction {
  // Change here to export UserAction
  chain?: string;
  messageId?: number;
  chatId?: number;
  browsingTestnets?: boolean;
  timestamp?: Date;
  customData?: Record<string, any>;
}

// Define the structure for database rows (user_sessions table)
interface UserSessionRow {
  user_id: number;
  chain?: string;
  message_id?: number;
  chat_id?: number;
  browsing_testnets?: boolean;
  custom_data: string; // JSON string
  last_action_timestamp: string; // Timestamp in string format
}

// Update or remove the last action for a specific user
export function updateUserLastAction(
  userId: number,
  data: UserAction | null,
): void {
  if (data) {
    const timestamp = data.timestamp?.getTime() || new Date().getTime();
    const customData = JSON.stringify(data.customData || {});

    const stmt = db.prepare(`
      INSERT INTO user_sessions (user_id, chain, message_id, chat_id, browsing_testnets, custom_data, last_action_timestamp) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        chain = excluded.chain,
        message_id = excluded.message_id,
        chat_id = excluded.chat_id,
        browsing_testnets = excluded.browsing_testnets,
        custom_data = excluded.custom_data,
        last_action_timestamp = excluded.last_action_timestamp
    `);

    stmt.run(
      userId,
      data.chain,
      data.messageId,
      data.chatId,
      data.browsingTestnets,
      customData,
      timestamp,
    );
  } else {
    const deleteStmt = db.prepare(
      'DELETE FROM user_sessions WHERE user_id = ?',
    );
    deleteStmt.run(userId);
  }
}

// Retrieve the last action for a specific user
export function getUserLastAction(userId: number): UserAction | undefined {
  const stmt = db.prepare('SELECT * FROM user_sessions WHERE user_id = ?');
  const row = stmt.get(userId) as UserSessionRow | undefined;

  if (row) {
    return {
      chain: row.chain,
      messageId: row.message_id,
      chatId: row.chat_id,
      browsingTestnets: row.browsing_testnets,
      customData: JSON.parse(row.custom_data),
      timestamp: new Date(row.last_action_timestamp),
    };
  }
  return undefined;
}

// Get all users with active sessions
export function getAllUserLastActions(): Record<
  number,
  UserAction | undefined
> {
  const stmt = db.prepare('SELECT * FROM user_sessions');
  const rows = stmt.all() as UserSessionRow[];

  const userActions: Record<number, UserAction> = {};
  rows.forEach((row) => {
    userActions[row.user_id] = {
      chain: row.chain,
      messageId: row.message_id,
      chatId: row.chat_id,
      browsingTestnets: row.browsing_testnets,
      customData: JSON.parse(row.custom_data),
      timestamp: new Date(row.last_action_timestamp),
    };
  });

  return userActions;
}

// Reset the session for a specific user
export function resetUserSession(userId: number): void {
  const deleteStmt = db.prepare('DELETE FROM user_sessions WHERE user_id = ?');
  deleteStmt.run(userId);
  console.log(
    `[${new Date().toISOString()}] Resetting session for user ${userId}`,
  );
}
