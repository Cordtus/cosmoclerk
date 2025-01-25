import {
  getUserLastAction,
  updateUserLastAction,
  UserAction,
} from './userSessions'; // Import UserAction

export function resetUserActionState(
  userId: number,
  fields: Array<keyof UserAction>,
): void {
  const userAction = getUserLastAction(userId);
  if (userAction) {
    fields.forEach((field) => {
      delete (userAction as any)[field]; // Type assertion for dynamic property access
    });

    userAction.timestamp = new Date();
    updateUserLastAction(userId, userAction);
  } else {
    console.error(
      `[${new Date().toISOString()}] No action found for user ${userId} to reset.`,
    );
  }
}
