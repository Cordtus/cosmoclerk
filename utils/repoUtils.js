const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const config = require('../config');

// Utility function to ensure directory existence
const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Directory created: ${dirPath}`);
  }
};

// Use exec with promisify for asynchronous execution
const execAsync = async (command, retries = 3) => {
  while (retries > 0) {
    try {
      const { stdout, stderr } = await exec(command);
      if (stderr) throw new Error(stderr);
      console.log(stdout);
      return; // Success, exit the loop
    } catch (error) {
      console.error(`Attempt failed: ${error}`);
      retries -= 1;
      if (retries > 0) console.log(`Retrying... (${retries} attempts left)`);
    }
  }
  throw new Error(`All retry attempts failed for command: ${command}`);
};

// Asynchronously clones or updates the repository based on its current state and the staleHours setting.
const cloneOrUpdateRepo = async () => {
  const { repoDir, repoUrl, staleHours } = config;

  ensureDirectoryExists(repoDir);

  try {
    if (!fs.existsSync(path.join(repoDir, '.git'))) {
      console.log(`Cloning repository: ${repoUrl}`);
      await execAsync(`git clone ${repoUrl} "${repoDir}"`, 2); // Allows for 2 retry attempts
      console.log('Repository cloned successfully.');
    } else {
      const stats = fs.statSync(path.join(repoDir, '.git'));
      const hoursDiff = (new Date() - stats.mtime) / 3600000;
      if (hoursDiff > staleHours) {
        console.log(`Updating repository in ${repoDir}`);
        await execAsync(`git -C "${repoDir}" pull`, 2); // Allows for 2 retry attempts
        console.log('Repository updated successfully.');
      }
    }
  } catch (error) {
    console.error(`Error in cloning or updating the repository: ${error}`);
    throw error;
  }
};

// Checks if the repository is stale.
const checkRepoStaleness = async () => {
  const { repoDir, staleHours } = config;
  if (fs.existsSync(path.join(repoDir, '.git'))) {
    const stats = fs.statSync(path.join(repoDir, '.git'));
    const hoursDiff = (new Date() - stats.mtime) / 3600000;
    return hoursDiff > staleHours;
  }
  return true; // Consider the repo stale if it doesn't exist.
};

function readFileSafely(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else {
      console.error(`File not found: ${filePath}`);
      return null;
    }
  } catch (error) {
    console.error(`Error reading or parsing file ${filePath}:`, error);
    return null;
  }
}

// Retrieves a list of chains from the specified directory, defaulting to the repository directory.
async function getChainList(directory = config.repoDir) {
  try {
    const directories = fs.readdirSync(directory, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    return directories.sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.error('Error getting chain list:', error);
    return [];
  }
}

module.exports = { cloneOrUpdateRepo, readFileSafely, getChainList, checkRepoStaleness };
