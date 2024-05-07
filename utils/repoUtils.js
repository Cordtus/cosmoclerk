// repoUtils.js

const fs = require('fs');
const path = require('path');
const config = require('../config');


// ensure directory existence
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

async function readFileSafely(filePath) {
  try {
      const data = await readFile(filePath, { encoding: 'utf8' });
      return JSON.parse(data);
  } catch (error) {
      console.error(`Error reading file ${filePath}:`, error);
      return null; // Or throw, depending on your error handling strategy
  }
}

async function getChainList(subDirectory = '') {
  const directory = path.join(config.repoDir, subDirectory);
  try {
      const directories = fs.readdirSync(directory, { withFileTypes: true })
          .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('_') && !dirent.name.startsWith('.'))
          .map(dirent => dirent.name);
      return directories.sort((a, b) => a.localeCompare(b));
  } catch (error) {
      console.error('Error getting chain list:', error);
      return [];
  }
}

async function listChains() {
  const chains = await getChainList();
  console.log('Main Chains:', chains);

  const testnets = await getChainList('testnets');
  console.log('Testnets:', testnets);
}

module.exports = {
  cloneOrUpdateRepo,
  readFileSafely,
  getChainList,
  checkRepoStaleness
};

