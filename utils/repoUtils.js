// repoUtils.js

const fs = require('fs');
const path = require('path');
const { execPromise } = require('./coreUtils');
const config = require('../config');


// Utility function to ensure directory existence
const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`Directory created: ${dirPath}`);
  }
};

const cloneOrUpdateRepo = async function cloneOrUpdateRepo() {
  const REPO_DIR = config.repoDir;
  const REPO_URL = config.repoUrl;
  const STALE_HOURS = config.staleHours;

  try {
    ensureDirectoryExists(REPO_DIR); // Ensure the directory exists before proceeding

    if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
      console.log(`[${new Date().toISOString()}] Cloning repository: ${REPO_URL}`);
      await execPromise(`git clone ${REPO_URL} "${REPO_DIR}"`);
      console.log(`[${new Date().toISOString()}] Repository cloned successfully.`);
    } else {
      const stats = fs.statSync(REPO_DIR);
      const hoursDiff = (new Date() - new Date(stats.mtime)) / 3600000;
      if (hoursDiff > STALE_HOURS) {
        try {
          console.log(`Updating repository in ${REPO_DIR}`);
          await execPromise(`git -C "${REPO_DIR}" pull`);
          console.log('Repository updated successfully.');
        } catch (updateError) {
          console.error('Error updating repository, attempting to reset:', updateError);
          await execPromise(`git -C "${REPO_DIR}" fetch --all`);
          await execPromise(`git -C "${REPO_DIR}" reset --hard origin/master`);
          await execPromise(`git -C "${REPO_DIR}" pull`);
          console.log('Repository reset and updated successfully.');
        }
      }
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error in cloning or updating the repository: ${error.message}`);
  }
};

const periodicUpdateRepo = async function periodicUpdateRepo() {
  try {
    await cloneOrUpdateRepo();
  } catch (error) {
    console.log('Error during periodic repository update:', error);
  }
};

function readFileSafely(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else {
      console.error(`File not found: ${filePath}`);
      return null; // File does not exist
    }
  } catch (error) {
    console.error(`Error reading or parsing file ${filePath}: ${error}`);
    return null; // Error reading or parsing file
  }
}

async function getChainList(directory = config.repoDir) {
  const directories = fs.readdirSync(directory, {
          withFileTypes: true
      })
      .filter(dirent => dirent.isDirectory() && /^[A-Za-z0-9]/.test(dirent.name))
      .map(dirent => dirent.name);

  // Non-case-sensitive sorting
  return directories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// export functions 
module.exports = { cloneOrUpdateRepo, periodicUpdateRepo, readFileSafely, getChainList };


