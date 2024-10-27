import db from "../database/db";

interface UserSettings {
  notifications: boolean;
  defaultChain?: string;
}

interface UserSettingsRow {
  user_id: number;
  notifications: number;  // Assuming `notifications` is stored as 1 or 0 in the database
  default_chain?: string;  // Assuming `default_chain` is a string
}

// Get user settings from the database
export function getUserSettings(userId: number): UserSettings {
  const stmt = db.prepare("SELECT * FROM user_settings WHERE user_id = ?");
  const row = stmt.get(userId) as UserSettingsRow | undefined;

  if (row) {
    return {
      notifications: row.notifications === 1,  // Convert 1 or 0 to boolean
      defaultChain: row.default_chain,
    };
  }
  return { notifications: true };  // Default notifications to true if no settings exist.
}

// Update user settings in the database
export function updateUserSettings(userId: number, settings: UserSettings): void {
  const stmt = db.prepare(`
    INSERT INTO user_settings (user_id, notifications, default_chain) 
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      notifications = excluded.notifications,
      default_chain = excluded.default_chain
  `);

  stmt.run(userId, settings.notifications ? 1 : 0, settings.defaultChain);
}
