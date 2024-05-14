const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const config = require('../config');

const execAsync = promisify(exec);

const ensureDirectoryExists = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Directory created: ${dirPath}`);
    }
};

const executeCommand = async (command, retries = 3) => {
    while (retries > 0) {
        try {
            const { stdout, stderr } = await execAsync(command);
            console.log(stdout);
            if (stderr) throw new Error(stderr);
            return stdout;
        } catch (error) {
            console.error(`Attempt failed: ${error.message}`);
            retries -= 1;
            if (retries > 0) console.log(`Retrying... (${retries} attempts left)`);
        }
    }
    throw new Error(`All retry attempts failed for command: ${command}`);
};

async function cloneOrUpdateRepo() {
    try {
        if (!fs.existsSync(config.repoDir)) {
            console.log(`[${new Date().toISOString()}] Cloning repository: ${config.repoUrl}`);
            await execAsync(`git clone ${config.repoUrl} ${config.repoDir}`);
            console.log(`[${new Date().toISOString()}] Repository cloned successfully.`);
        } else {
            const stats = fs.statSync(config.repoDir);
            const hoursDiff = (new Date() - new Date(stats.mtime)) / 3600000;
            if (hoursDiff > config.staleHours) {
                try {
                    console.log(`Updating repository in ${config.repoDir}`);
                    await execAsync(`git -C ${config.repoDir} pull`);
                    console.log('Repository updated successfully.');
                } catch (updateError) {
                    console.log('Error updating repository, attempting to reset:', updateError);
                    await execAsync(`git -C ${config.repoDir} fetch --all`);
                    await execAsync(`git -C ${config.repoDir} reset --hard origin/master`);
                    await execAsync(`git -C ${config.repoDir} pull`);
                    console.log('Repository reset and updated successfully.');
                }
            }
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in cloning or updating the repository: ${error.message}`);
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
    ensureDirectoryExists,
    executeCommand,
    getChainList,
    listChains
};
