export function resetUserActionState(userId: number, fields: Array<keyof UserAction>): void {
  const userAction = userLastAction[userId];
  if (userAction) {
    fields.forEach(field => delete userAction[field]);
    userLastAction[userId] = {
      ...userAction,
      timestamp: new Date(),
    };
  }
}
