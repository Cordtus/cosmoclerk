import { cloneOrUpdateRepo } from "../repoManager/cloneOrUpdateRepo";

export function setupRepoUpdateJob(intervalHours: number): void {
  setInterval(async () => {
    try {
      console.log(`[${new Date().toISOString()}] Initiating scheduled repo update.`);
      await cloneOrUpdateRepo();
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error during scheduled repo update:`, error);
    }
  }, intervalHours * 3600000); // Convert hours to milliseconds
}
