// repoUtils.js

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { exec } = require('child_process');
const { promisify } = require('util');

const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Directory created: ${dirPath}`);
  }
};

const cloneOrUpdateRepo = async () => {
  const { repoDir, repoUrl, staleHours } = config;

  ensureDirectoryExists(repoDir);

  try {
    if (!fs.existsSync(path.join(repoDir, '.git'))) {
      console.log(`Cloning repository: ${repoUrl}`);
      await execAsync(`git clone ${repoUrl} "${repoDir}"`);
      console.log('Repository cloned successfully.');
    } else {
      const stats = fs.statSync(path.join(repoDir, '.git'));
      const hoursDiff = (new Date() - stats.mtime) / 3600000;
      if (hoursDiff > staleHours) {
        console.log(`Updating repository in ${repoDir}`);
        await execAsync(`git -C "${repoDir}" pull`);
        console.log('Repository updated successfully.');
      }
    }
  } catch (error) {
    console.error(`Error in cloning or updating the repository: ${error}`);
    throw error;
  }
};

const execAsync = promisify(exec);

module.exports = {
  cloneOrUpdateRepo,
  ensureDirectoryExists,
  execAsync
};
