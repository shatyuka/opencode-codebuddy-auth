import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import lockfile from 'proper-lockfile';

function getConfigDir(): string {
  // 1. Check for explicit override via env var
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR;
  }

  // 2. Use ~/.config/opencode on all platforms (including Windows)
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(xdgConfig, 'opencode');
}

export function getStoragePath(): string {
  return join(getConfigDir(), 'codebuddy.json');
}

export interface CodeBuddyStorage {
  auth: {
    accessToken: string;
    expiresAt: number;
    refreshToken: string;
    refreshExpiresAt: number;
    domain: string;
  },
  account: {
    uid: string;
    nickname: string;
    enterpriseId?: string;
    departmentFullName?: string;
  }
}

const LOCK_OPTIONS = {
  stale: 10000,
  retries: {
    retries: 5,
    minTimeout: 100,
    maxTimeout: 1000,
    factor: 2,
  },
};

async function ensureSecurePermissions(path: string): Promise<void> {
  try {
    await fs.chmod(path, 0o600);
  } catch {
    // Ignore errors (e.g. Windows, file doesn't exist, FS doesn't support chmod)
  }
}

async function ensureFileExists(path: string): Promise<void> {
  try {
    await fs.access(path);
  } catch {
    await fs.mkdir(dirname(path), {recursive: true});
    await fs.writeFile(
      path,
      JSON.stringify({version: 4, accounts: [], activeIndex: 0}, null, 2),
      {encoding: 'utf-8', mode: 0o600},
    );
  }
}

async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  await ensureFileExists(path);
  let release: (() => Promise<void>) | null = null;
  try {
    release = await lockfile.lock(path, LOCK_OPTIONS);
    return await fn();
  } finally {
    if (release) {
      try {
        await release();
      } catch {
      }
    }
  }
}

export async function loadStorage() {
  try {
    const path = getStoragePath();
    // Ensure permissions are correct on load (fixes existing files)
    await ensureSecurePermissions(path);

    const content = await fs.readFile(path, 'utf-8');
    return JSON.parse(content) as CodeBuddyStorage;
  } catch {
    return null;
  }
}

export async function saveStorage(storage: CodeBuddyStorage) {
  const path = getStoragePath();
  const configDir = dirname(path);
  await fs.mkdir(configDir, {recursive: true});

  await withFileLock(path, async () => {
    const tempPath = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    const content = JSON.stringify(storage, null, 2);

    try {
      await fs.writeFile(tempPath, content, {encoding: 'utf-8', mode: 0o600});
      await fs.rename(tempPath, path);
    } catch (error) {
      // Clean up temp file on failure to prevent accumulation
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors (file may not exist)
      }
      throw error;
    }
  });
}
