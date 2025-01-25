import * as fs from 'fs';
import * as path from 'path';

const REPO_DIR = path.join(__dirname, '../../chain-registry1');

export async function getChainList(
  directory: string = REPO_DIR,
): Promise<string[]> {
  const directories = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      (dirent) => dirent.isDirectory() && /^[A-Za-z0-9]/.test(dirent.name),
    )
    .map((dirent) => dirent.name);

  // Non-case-sensitive sorting
  return directories.sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  );
}
