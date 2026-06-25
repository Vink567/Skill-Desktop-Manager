import fs from "node:fs/promises";
import path from "node:path";
import { checkToolState, refreshManagedSkillForTool } from "./linker";
import { readCopyMetadata } from "./metadata";
import {
  createDirectorySnapshot,
  createSnapshotFile,
  removeSnapshotFile,
  snapshotToMap
} from "./snapshot";
import type {
  AppConfig,
  ManagedCopySnapshotFile,
  MergeApplyRequest,
  MergeApplyResult,
  MergeFileEntry,
  MergeFileStatus,
  MergePreview,
  MergePreviewRequest,
  MergeResolutionChoice,
  OperationFailure,
  SkillRecord,
  ToolId
} from "./types";

interface MergeContext {
  skill: SkillRecord;
  sourcePath: string;
  targetPath: string;
  toolId: ToolId;
  managed: boolean;
  baseline: Map<string, ManagedCopySnapshotFile>;
  hub: Map<string, ManagedCopySnapshotFile>;
  copy: Map<string, ManagedCopySnapshotFile>;
}

export async function getMergePreview(
  config: AppConfig,
  skills: SkillRecord[],
  request: MergePreviewRequest
): Promise<MergePreview> {
  const context = await buildMergeContext(config, skills, request);
  const files = buildFileEntries(context);

  return {
    skillId: context.skill.id,
    toolId: request.toolId,
    sourcePath: context.sourcePath,
    targetPath: context.targetPath,
    dirtyFileCount: files.length,
    conflictCount: files.filter((file) => file.status === "conflict").length,
    binaryCount: files.filter((file) => file.binary).length,
    files
  };
}

export async function applyMerge(
  config: AppConfig,
  skills: SkillRecord[],
  request: MergeApplyRequest
): Promise<MergeApplyResult> {
  const context = await buildMergeContext(config, skills, request);
  const files = buildFileEntries(context);
  const resolutions = new Map(
    (request.resolutions ?? []).map((resolution) => [resolution.path, resolution.resolution])
  );
  const failures: OperationFailure[] = [];
  let appliedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const resolution = resolutions.get(file.path) ?? file.defaultResolution;
    if (file.requiresResolution && !resolutions.has(file.path)) {
      failures.push({
        skillId: context.skill.id,
        toolId: request.toolId,
        message: `${file.path} 需要先选择采用副本或保留中心`
      });
      continue;
    }

    if (resolution === "hub") {
      try {
        await applyFileFromHub(context.sourcePath, context.targetPath, file.path);
        skippedCount += 1;
      } catch (error) {
        failures.push({
          skillId: context.skill.id,
          toolId: request.toolId,
          message: error instanceof Error ? error.message : String(error)
        });
      }
      continue;
    }

    try {
      await applyFileFromCopy(context.targetPath, context.sourcePath, file.path);
      appliedCount += 1;
    } catch (error) {
      failures.push({
        skillId: context.skill.id,
        toolId: request.toolId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (failures.length) {
    return {
      appliedCount,
      skippedCount,
      refreshedCopyCount: 0,
      failures
    };
  }

  const refreshedCopyCount = await refreshManagedCopies(config, context.skill);
  return {
    appliedCount,
    skippedCount,
    refreshedCopyCount,
    failures
  };
}

async function buildMergeContext(
  config: AppConfig,
  skills: SkillRecord[],
  request: MergePreviewRequest
): Promise<MergeContext> {
  const skill = skills.find((item) => item.id === request.skillId);
  if (!skill) {
    throw new Error(`Skill 不存在: ${request.skillId}`);
  }

  const tool = config.tools[request.toolId];
  if (!tool) {
    throw new Error(`工具不存在: ${request.toolId}`);
  }

  const state = await checkToolState(skill.path, skill.id, tool);
  if (state.status === "disabled") {
    throw new Error("目标工具目录中没有同名 skill，无法合并回中心仓库");
  }
  if (state.syncState === "linked") {
    throw new Error("链接模式已直接指向中心仓库，无需合并回流");
  }
  if (!state.canMergeBack) {
    throw new Error("这个工具目录没有可合并回中心仓库的改动");
  }

  const copyMeta = await readCopyMetadata(state.targetPath);
  if (state.managed && !copyMeta?.baseline) {
    throw new Error("缺少副本 baseline，无法安全生成合并预览");
  }
  const hubSnapshot = await createDirectorySnapshot(skill.path);

  return {
    skill,
    sourcePath: skill.path,
    targetPath: state.targetPath,
    toolId: request.toolId,
    managed: state.managed,
    baseline: state.managed ? snapshotToMap(copyMeta?.baseline) : snapshotToMap(hubSnapshot),
    hub: snapshotToMap(hubSnapshot),
    copy: snapshotToMap(await createDirectorySnapshot(state.targetPath))
  };
}

function buildFileEntries(context: MergeContext): MergeFileEntry[] {
  const allPaths = new Set([...context.baseline.keys(), ...context.hub.keys(), ...context.copy.keys()]);
  const entries: MergeFileEntry[] = [];

  for (const relativePath of allPaths) {
    const base = context.baseline.get(relativePath);
    const hub = context.hub.get(relativePath);
    const copy = context.copy.get(relativePath);
    const hubChanged = base?.hash !== hub?.hash;
    const copyChanged = base?.hash !== copy?.hash;

    if (!copyChanged) {
      continue;
    }

    entries.push(buildFileEntry(relativePath, base, hub, copy, hubChanged, copyChanged, context.managed));
  }

  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function buildFileEntry(
  relativePath: string,
  base: ManagedCopySnapshotFile | undefined,
  hub: ManagedCopySnapshotFile | undefined,
  copy: ManagedCopySnapshotFile | undefined,
  hubChanged: boolean,
  copyChanged: boolean,
  managed: boolean
): MergeFileEntry {
  const binary = [base, hub, copy].some((file) => file?.kind === "binary");
  const hubAndCopySame = hub?.hash === copy?.hash;
  const requiresResolution =
    binary || !managed || (hubChanged && copyChanged && !hubAndCopySame);
  const status = getFileStatus(base, hub, copy, binary, hubChanged, copyChanged, hubAndCopySame);

  return {
    path: relativePath,
    status,
    binary,
    hubChanged,
    copyChanged,
    requiresResolution,
    defaultResolution: requiresResolution ? "hub" : "auto",
    resolutionOptions: requiresResolution ? ["hub", "copy"] : ["auto", "hub"],
    diff: binary ? undefined : buildSimpleDiff(hub?.content, copy?.content)
  };
}

function getFileStatus(
  base: ManagedCopySnapshotFile | undefined,
  hub: ManagedCopySnapshotFile | undefined,
  copy: ManagedCopySnapshotFile | undefined,
  binary: boolean,
  hubChanged: boolean,
  copyChanged: boolean,
  hubAndCopySame: boolean
): MergeFileStatus {
  if (binary) {
    return "binary";
  }
  if (hubChanged && copyChanged && !hubAndCopySame) {
    return "conflict";
  }
  if (!base && copy) {
    return "added";
  }
  if (base && !copy) {
    return "deleted";
  }
  if (!hubChanged && copyChanged) {
    return "auto-merged";
  }
  return "modified";
}

function buildSimpleDiff(hubContent = "", copyContent = ""): string {
  if (hubContent === copyContent) {
    return "";
  }

  const hubLines = splitLines(hubContent);
  const copyLines = splitLines(copyContent);
  const maxLines = Math.max(hubLines.length, copyLines.length);
  const lines: string[] = [];

  for (let index = 0; index < maxLines; index += 1) {
    const hubLine = hubLines[index];
    const copyLine = copyLines[index];
    if (hubLine === copyLine) {
      if (hubLine !== undefined) {
        lines.push(`  ${hubLine}`);
      }
      continue;
    }
    if (hubLine !== undefined) {
      lines.push(`- ${hubLine}`);
    }
    if (copyLine !== undefined) {
      lines.push(`+ ${copyLine}`);
    }
  }

  return lines.join("\n");
}

function splitLines(content: string): string[] {
  if (!content) {
    return [];
  }
  return content.replace(/\r\n/g, "\n").split("\n");
}

async function applyFileFromCopy(
  copyRoot: string,
  hubRoot: string,
  relativePath: string
): Promise<void> {
  const copyFile = await createSnapshotFile(copyRoot, relativePath);
  if (!copyFile) {
    await removeSnapshotFile(hubRoot, relativePath);
    return;
  }

  const sourcePath = path.join(copyRoot, relativePath);
  const targetPath = path.join(hubRoot, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}

async function applyFileFromHub(
  hubRoot: string,
  copyRoot: string,
  relativePath: string
): Promise<void> {
  const hubFile = await createSnapshotFile(hubRoot, relativePath);
  if (!hubFile) {
    await removeSnapshotFile(copyRoot, relativePath);
    return;
  }

  const sourcePath = path.join(hubRoot, relativePath);
  const targetPath = path.join(copyRoot, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
}

async function refreshManagedCopies(config: AppConfig, skill: SkillRecord): Promise<number> {
  let refreshedCount = 0;
  const failures: OperationFailure[] = [];

  for (const toolId of Object.keys(config.tools) as ToolId[]) {
    const state = await checkToolState(skill.path, skill.id, config.tools[toolId]);
    if (!state.enabled || !state.managed || state.syncState === "linked") {
      continue;
    }

    try {
      await refreshManagedSkillForTool(config, skill.path, skill.id, toolId);
      refreshedCount += 1;
    } catch (error) {
      failures.push({
        skillId: skill.id,
        toolId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (failures.length) {
    throw new Error(failures.map((failure) => failure.message).join("\n"));
  }

  return refreshedCount;
}
