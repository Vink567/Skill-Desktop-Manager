import fs from "node:fs/promises";
import path from "node:path";
import { isSkillDir, parseSkillMeta, pathExists } from "./frontmatter";
import { checkToolState } from "./linker";
import { readHubMetadata } from "./metadata";
import { toPosixRelativePath } from "./paths";
import type { AppConfig, SkillCandidate, SkillRecord, ToolId } from "./types";

const IGNORED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "out",
  "dist",
  "build",
  "target",
  ".vite"
]);

export async function listSkills(config: AppConfig): Promise<SkillRecord[]> {
  await fs.mkdir(config.hubDir, { recursive: true });
  const candidates = await findSkillCandidates(config.hubDir, { recursive: true });
  const deduped = dedupeCandidates(candidates);
  const records = await Promise.all(deduped.map((candidate) => buildSkillRecord(config, candidate.path)));
  return records.sort((left, right) => left.id.localeCompare(right.id));
}

export async function buildSkillRecord(config: AppConfig, skillPath: string): Promise<SkillRecord> {
  const meta = await parseSkillMeta(skillPath);
  const hubMeta = await readHubMetadata(skillPath);
  const enabledByTool = {} as SkillRecord["enabledByTool"];

  for (const toolId of Object.keys(config.tools) as ToolId[]) {
    enabledByTool[toolId] = await checkToolState(skillPath, meta.id, config.tools[toolId]);
  }

  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    path: skillPath,
    sourceType: hubMeta.sourceType || "hub",
    sourceUrl: hubMeta.sourceUrl,
    sourceSubpath: hubMeta.sourceSubpath,
    revision: hubMeta.revision,
    enabledByTool
  };
}

export async function findSkillCandidates(
  rootPath: string,
  options: { recursive?: boolean } = {}
): Promise<SkillCandidate[]> {
  if (!(await pathExists(rootPath))) {
    return [];
  }

  const rootStat = await fs.lstat(rootPath);
  if (!rootStat.isDirectory()) {
    return [];
  }

  const candidates: SkillCandidate[] = [];
  await walk(rootPath, rootPath, Boolean(options.recursive), candidates);
  candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return candidates;
}

function dedupeCandidates(candidates: SkillCandidate[]): SkillCandidate[] {
  const byId = new Map<string, SkillCandidate>();

  for (const candidate of candidates) {
    const previous = byId.get(candidate.id);
    if (!previous || pathDepth(candidate.relativePath) < pathDepth(previous.relativePath)) {
      byId.set(candidate.id, candidate);
    }
  }

  return Array.from(byId.values());
}

async function walk(
  rootPath: string,
  currentPath: string,
  recursive: boolean,
  candidates: SkillCandidate[]
): Promise<void> {
  const stat = await fs.lstat(currentPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return;
  }

  if (await isSkillDir(currentPath)) {
    const meta = await parseSkillMeta(currentPath);
    const relativePath = path.relative(rootPath, currentPath) || ".";
    candidates.push({
      id: meta.id,
      name: meta.name,
      description: meta.description,
      path: currentPath,
      relativePath: toPosixRelativePath(relativePath)
    });
    return;
  }

  if (!recursive && currentPath !== rootPath) {
    return;
  }

  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_DIR_NAMES.has(entry.name)) {
      continue;
    }
    await walk(rootPath, path.join(currentPath, entry.name), recursive, candidates);
  }
}

function pathDepth(relativePath: string): number {
  if (relativePath === ".") {
    return 0;
  }
  return relativePath.split(/[\\/]/).filter(Boolean).length;
}
