import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { COPY_METADATA_FILE, HUB_METADATA_FILE } from "./metadata";
import { pathExists } from "./frontmatter";
import { toPosixRelativePath } from "./paths";
import type { ManagedCopySnapshot, ManagedCopySnapshotFile } from "./types";

const IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  "out",
  "dist",
  "build",
  "target",
  ".vite",
  COPY_METADATA_FILE,
  HUB_METADATA_FILE
]);

export async function createDirectorySnapshot(rootPath: string): Promise<ManagedCopySnapshot> {
  const files: ManagedCopySnapshotFile[] = [];
  if (await pathExists(rootPath)) {
    await collectSnapshotFiles(rootPath, rootPath, files);
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    createdAt: new Date().toISOString(),
    files
  };
}

export async function createSnapshotFile(
  rootPath: string,
  relativePath: string
): Promise<ManagedCopySnapshotFile | undefined> {
  const absolutePath = path.join(rootPath, relativePath);
  if (!(await pathExists(absolutePath))) {
    return undefined;
  }

  const stat = await fs.lstat(absolutePath);
  if (!stat.isFile()) {
    return undefined;
  }

  const buffer = await fs.readFile(absolutePath);
  return snapshotFileFromBuffer(relativePath, buffer);
}

export async function listSnapshotRelativePaths(rootPath: string): Promise<string[]> {
  const snapshot = await createDirectorySnapshot(rootPath);
  return snapshot.files.map((file) => file.path);
}

export function snapshotToMap(
  snapshot?: ManagedCopySnapshot
): Map<string, ManagedCopySnapshotFile> {
  const files = new Map<string, ManagedCopySnapshotFile>();
  for (const file of snapshot?.files ?? []) {
    files.set(file.path, file);
  }
  return files;
}

export async function removeSnapshotFile(rootPath: string, relativePath: string): Promise<void> {
  const absolutePath = path.join(rootPath, relativePath);
  await fs.rm(absolutePath, { force: true });
  await removeEmptyParents(rootPath, path.dirname(absolutePath));
}

async function collectSnapshotFiles(
  rootPath: string,
  currentPath: string,
  files: ManagedCopySnapshotFile[]
): Promise<void> {
  const stat = await fs.lstat(currentPath);
  if (stat.isSymbolicLink()) {
    return;
  }

  if (stat.isFile()) {
    const relativePath = toPosixRelativePath(path.relative(rootPath, currentPath));
    if (!shouldIgnoreRelativePath(relativePath)) {
      const buffer = await fs.readFile(currentPath);
      files.push(snapshotFileFromBuffer(relativePath, buffer));
    }
    return;
  }

  if (!stat.isDirectory()) {
    return;
  }

  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_NAMES.has(entry.name)) {
      continue;
    }
    await collectSnapshotFiles(rootPath, path.join(currentPath, entry.name), files);
  }
}

function snapshotFileFromBuffer(relativePath: string, buffer: Buffer): ManagedCopySnapshotFile {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  if (isBinaryBuffer(buffer)) {
    return {
      path: toPosixRelativePath(relativePath),
      kind: "binary",
      hash
    };
  }

  return {
    path: toPosixRelativePath(relativePath),
    kind: "text",
    hash,
    content: normalizeText(buffer.toString("utf8"))
  };
}

function isBinaryBuffer(buffer: Buffer): boolean {
  if (!buffer.length) {
    return false;
  }

  const sampleLength = Math.min(buffer.length, 8000);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }
  return false;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function shouldIgnoreRelativePath(relativePath: string): boolean {
  return relativePath
    .split("/")
    .some((part) => IGNORED_NAMES.has(part));
}

async function removeEmptyParents(rootPath: string, startDir: string): Promise<void> {
  const root = path.resolve(rootPath);
  let current = path.resolve(startDir);

  while (current !== root && current.startsWith(root)) {
    try {
      const entries = await fs.readdir(current);
      if (entries.length > 0) {
        return;
      }
      await fs.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}
