import { getUserLastAction, updateUserLastAction } from "./userSessions";

export function cleanupUserSessions(): void {
  const now = new Date();
  Object.keys(getUserLastAction()).forEach((userIdStr) => {
    const userId = parseInt(userIdStr, 10);
    const userAction = getUserLastAction(userId);
    if (userAction && userAction.timestamp) {
      const timeDifference = now.getTime() - userAction.timestamp.getTime();
      if (timeDifference > 600000) { // 10 minutes in milliseconds
        updateUserLastAction(userId, null);
      }
    }
  });
}
