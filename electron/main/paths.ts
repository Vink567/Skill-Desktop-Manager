import os from "node:os";
import path from "node:path";

export function homeDir(): string {
  if (process.env.SKILL_MANAGER_HOME) {
    return process.env.SKILL_MANAGER_HOME;
  }
  return os.homedir();
}

export function appRootDir(): string {
  return path.join(homeDir(), ".skill-desktop-manager");
}

export function defaultHubDir(): string {
  return path.join(appRootDir(), "skills");
}

export function cacheDir(): string {
  return path.join(appRootDir(), "cache");
}

export function configPath(): string {
  return path.join(appRootDir(), "config.json");
}

export function normalizePath(value: string): string {
  return path.normalize(value);
}

export function toPosixRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}
