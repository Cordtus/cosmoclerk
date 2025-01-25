import { getAllUserLastActions, updateUserLastAction } from './userSessions';

export function cleanupUserSessions(): void {
  const now = new Date();

  // Get all user actions
  const userActions = getAllUserLastActions();

  // Iterate through each user's last action
  Object.keys(userActions).forEach((userIdStr) => {
    const userId = parseInt(userIdStr, 10);
    const userAction = userActions[userId];

    if (userAction && userAction.timestamp) {
      const timeDifference = now.getTime() - userAction.timestamp.getTime();

      // If the action is older than 10 minutes, delete it
      if (timeDifference > 600000) {
        // 10 minutes in milliseconds
        updateUserLastAction(userId, null);
        console.log(
          `[${now.toISOString()}] Cleaned up session for user ${userId}`,
        );
      }
    }
  });
}
