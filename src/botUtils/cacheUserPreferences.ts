interface UserCache {
  userId: number;
  preferredChains: string[];
  timestamp: Date;
}

const userPreferencesCache: Record<number, UserCache> = {};

export function cacheUserPreferences(userId: number, preferredChains: string[]): void {
  userPreferencesCache[userId] = {
    userId,
    preferredChains,
    timestamp: new Date(),
  };
}

export function getCachedUserPreferences(userId: number): UserCache | undefined {
  const cached = userPreferencesCache[userId];
  if (cached && (new Date().getTime() - cached.timestamp.getTime()) < 300000) {
    // Cache is valid for 5 minutes
    return cached;
  }
  return undefined;
}
