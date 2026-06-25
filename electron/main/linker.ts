import fs from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./frontmatter";
import { readCopyMetadata, writeCopyMetadata } from "./metadata";
import { createDirectorySnapshot, snapshotToMap } from "./snapshot";
import type {
  AppConfig,
  BatchOperationResult,
  ManagedCopySnapshot,
  OperationFailure,
  SkillToolState,
  ToolConfig,
  ToolId
} from "./types";

export async function checkToolState(
  skillPath: string,
  skillId: string,
  tool: ToolConfig
): Promise<SkillToolState> {
  const targetPath = path.join(tool.skillsPath, skillId);

  if (!(await pathExists(targetPath))) {
    return {
      enabled: false,
      status: "disabled",
      targetPath,
      managed: false,
      syncState: "clean",
      dirtyFileCount: 0,
      canMergeBack: false
    };
  }

  const stat = await fs.lstat(targetPath);
  if (stat.isSymbolicLink()) {
    const matches = await linkTargetsSamePath(targetPath, skillPath);
    if (matches) {
      return {
        enabled: true,
        status: (await pathExists(skillPath)) ? "enabled" : "broken",
        targetPath,
        managed: true,
        syncState: "linked",
        dirtyFileCount: 0,
        canMergeBack: false
      };
    }

    return {
      enabled: false,
      status: "conflict",
      targetPath,
      managed: false,
      message: "目标位置是指向其他目录的链接",
      syncState: "unknown",
      dirtyFileCount: 0,
      canMergeBack: false
    };
  }

  if (stat.isDirectory()) {
    const copyMeta = await readCopyMetadata(targetPath);
    if (copyMeta?.skillId === skillId && (await pathsSame(copyMeta.sourcePath, skillPath))) {
      const dirtyFileCount = await countDirtyFiles(targetPath, copyMeta.baseline);
      return {
        enabled: true,
        status: (await pathExists(skillPath)) ? "enabled" : "broken",
        targetPath,
        managed: true,
        syncState: copyMeta.baseline ? (dirtyFileCount ? "dirty" : "clean") : "unknown",
        dirtyFileCount,
        canMergeBack: Boolean(copyMeta.baseline && dirtyFileCount)
      };
    }
    const unmanagedDirtyFileCount = await countDifferentFiles(skillPath, targetPath);

    return {
      enabled: false,
      status: "conflict",
      targetPath,
      managed: false,
      message: "目标位置已有非托管 skill 文件夹",
      syncState: "unmanaged",
      dirtyFileCount: unmanagedDirtyFileCount,
      canMergeBack: unmanagedDirtyFileCount > 0
    };
  }

  return {
    enabled: false,
    status: "conflict",
    targetPath,
    managed: false,
    message: "目标位置已有非托管文件",
    syncState: "unknown",
    dirtyFileCount: 0,
    canMergeBack: false
  };
}

export async function enableSkillForTool(
  config: AppConfig,
  skillPath: string,
  skillId: string,
  toolId: ToolId
): Promise<void> {
  const tool = config.tools[toolId];
  if (!tool?.enabled) {
    throw new Error(`工具未启用: ${toolId}`);
  }
  if (!(await pathExists(skillPath))) {
    throw new Error(`Skill 不存在: ${skillPath}`);
  }

  await fs.mkdir(tool.skillsPath, { recursive: true });
  const current = await checkToolState(skillPath, skillId, tool);

  if (current.enabled && current.managed && current.status === "enabled") {
    return;
  }
  if (current.status === "conflict") {
    throw new Error(current.message || "目标位置存在冲突，未覆盖");
  }
  if (current.managed) {
    await removeManagedTarget(current.targetPath);
  }

  if (config.linkMode === "copy") {
    await copyManagedSkill(skillPath, current.targetPath, skillId);
    return;
  }

  try {
    await createManagedLink(skillPath, current.targetPath);
  } catch (error) {
    console.warn("[skill-manager] Link creation failed, falling back to copy:", error);
    await copyManagedSkill(skillPath, current.targetPath, skillId);
  }
}

export async function disableSkillForTool(
  config: AppConfig,
  skillPath: string,
  skillId: string,
  toolId: ToolId
): Promise<void> {
  const tool = config.tools[toolId];
  if (!tool) {
    throw new Error(`工具不存在: ${toolId}`);
  }

  const current = await checkToolState(skillPath, skillId, tool);
  if (current.status === "disabled") {
    return;
  }
  if (!current.managed) {
    throw new Error(current.message || "目标位置不是本应用管理的链接或副本，未删除");
  }

  await removeManagedTarget(current.targetPath);
}

export async function refreshManagedSkillForTool(
  config: AppConfig,
  skillPath: string,
  skillId: string,
  toolId: ToolId
): Promise<void> {
  const tool = config.tools[toolId];
  if (!tool) {
    throw new Error(`工具不存在: ${toolId}`);
  }

  const current = await checkToolState(skillPath, skillId, tool);
  if (!current.enabled || !current.managed || current.syncState === "linked") {
    return;
  }

  await copyManagedSkill(skillPath, current.targetPath, skillId);
}

export async function batchSetToolEnabled(
  config: AppConfig,
  skills: Array<{ id: string; path: string }>,
  toolIds: ToolId[],
  enabled: boolean
): Promise<BatchOperationResult> {
  const failures: OperationFailure[] = [];
  let appliedCount = 0;
  let skippedCount = 0;

  for (const skill of skills) {
    for (const toolId of toolIds) {
      try {
        const before = await checkToolState(skill.path, skill.id, config.tools[toolId]);
        if (before.enabled === enabled && before.managed) {
          skippedCount += 1;
          continue;
        }
        if (enabled) {
          await enableSkillForTool(config, skill.path, skill.id, toolId);
        } else {
          await disableSkillForTool(config, skill.path, skill.id, toolId);
        }
        appliedCount += 1;
      } catch (error) {
        failures.push({
          skillId: skill.id,
          toolId,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  return {
    requestedCount: skills.length * toolIds.length,
    appliedCount,
    skippedCount,
    failedCount: failures.length,
    failures
  };
}

async function createManagedLink(sourcePath: string, targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  if (process.platform === "win32") {
    await fs.symlink(sourcePath, targetPath, "junction");
    return;
  }
  await fs.symlink(sourcePath, targetPath, "dir");
}

async function copyManagedSkill(sourcePath: string, targetPath: string, skillId: string): Promise<void> {
  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.cp(sourcePath, targetPath, {
    recursive: true,
    force: false,
    errorOnExist: true,
    verbatimSymlinks: false
  });
  await writeCopyMetadata(targetPath, skillId, sourcePath, await createDirectorySnapshot(sourcePath));
}

async function removeManagedTarget(targetPath: string): Promise<void> {
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) {
      await fs.unlink(targetPath);
      return;
    }
  } catch {
    return;
  }

  await fs.rm(targetPath, { recursive: true, force: true });
}

async function linkTargetsSamePath(targetPath: string, sourcePath: string): Promise<boolean> {
  try {
    const linkedPath = await fs.readlink(targetPath);
    const absoluteLinkedPath = path.isAbsolute(linkedPath)
      ? linkedPath
      : path.resolve(path.dirname(targetPath), linkedPath);
    return pathsSame(absoluteLinkedPath, sourcePath);
  } catch {
    return pathsSame(targetPath, sourcePath);
  }
}

async function pathsSame(left: string, right: string): Promise<boolean> {
  try {
    const [leftReal, rightReal] = await Promise.all([fs.realpath(left), fs.realpath(right)]);
    return normalizeForCompare(leftReal) === normalizeForCompare(rightReal);
  } catch {
    return normalizeForCompare(path.resolve(left)) === normalizeForCompare(path.resolve(right));
  }
}

function normalizeForCompare(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function countDirtyFiles(
  targetPath: string,
  baseline?: ManagedCopySnapshot
): Promise<number> {
  if (!baseline) {
    return 0;
  }

  const current = snapshotToMap(await createDirectorySnapshot(targetPath));
  const base = snapshotToMap(baseline);
  const allPaths = new Set([...base.keys(), ...current.keys()]);
  let dirtyCount = 0;

  for (const relativePath of allPaths) {
    if (base.get(relativePath)?.hash !== current.get(relativePath)?.hash) {
      dirtyCount += 1;
    }
  }

  return dirtyCount;
}

async function countDifferentFiles(leftPath: string, rightPath: string): Promise<number> {
  const left = snapshotToMap(await createDirectorySnapshot(leftPath));
  const right = snapshotToMap(await createDirectorySnapshot(rightPath));
  const allPaths = new Set([...left.keys(), ...right.keys()]);
  let differentCount = 0;

  for (const relativePath of allPaths) {
    if (left.get(relativePath)?.hash !== right.get(relativePath)?.hash) {
      differentCount += 1;
    }
  }

  return differentCount;
}
