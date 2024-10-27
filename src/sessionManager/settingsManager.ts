import db from "../database/db";

interface UserSettings {
  notifications: boolean;
  defaultChain?: string;
}

export function getUserSettings(userId: number): UserSettings {
  const stmt = db.prepare("SELECT * FROM user_settings WHERE user_id = ?");
  const row = stmt.get(userId);

  if (row) {
    return {
      notifications: row.notifications === 1,
      defaultChain: row.default_chain,
    };
  }
  return { notifications: true }; // Default notifications to true if no settings exist.
}

export function updateUserSettings(userId: number, settings: UserSettings): void {
  const stmt = db.prepare(`
    INSERT INTO user_settings (user_id, notifications, default_chain) 
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
    notifications=excluded.notifications,
    default_chain=excluded.default_chain
  `);

  stmt.run(userId, settings.notifications ? 1 : 0, settings.defaultChain);
}
