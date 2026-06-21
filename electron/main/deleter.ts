import fs from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./frontmatter";
import { checkToolState, disableSkillForTool } from "./linker";
import type { AppConfig, DeleteSkillsResult, OperationFailure, SkillRecord, ToolId } from "./types";

export async function deleteInstalledSkills(
  config: AppConfig,
  skills: SkillRecord[],
  skillIds: string[]
): Promise<DeleteSkillsResult> {
  const failures: OperationFailure[] = [];
  let deletedCount = 0;

  for (const skillId of skillIds) {
    const skill = skills.find((item) => item.id === skillId);
    if (!skill) {
      failures.push({ skillId, message: `Skill 不存在: ${skillId}` });
      continue;
    }

    try {
      await assertSkillInsideHub(config.hubDir, skill.path);
      await removeManagedTargets(config, skill, failures);
      await fs.rm(skill.path, { recursive: true, force: true });
      await removeEmptyParents(config.hubDir, path.dirname(skill.path));
      deletedCount += 1;
    } catch (error) {
      failures.push({
        skillId,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    requestedCount: skillIds.length,
    deletedCount,
    failedCount: failures.length,
    failures
  };
}

async function removeManagedTargets(
  config: AppConfig,
  skill: SkillRecord,
  failures: OperationFailure[]
): Promise<void> {
  for (const toolId of Object.keys(config.tools) as ToolId[]) {
    const tool = config.tools[toolId];
    const state = await checkToolState(skill.path, skill.id, tool);
    if (state.status === "disabled") {
      continue;
    }
    if (!state.managed) {
      failures.push({
        skillId: skill.id,
        toolId,
        message: state.message || "目标位置不是本应用管理的链接或副本，已保留"
      });
      continue;
    }

    await disableSkillForTool(config, skill.path, skill.id, toolId);
  }
}

async function assertSkillInsideHub(hubDir: string, skillPath: string): Promise<void> {
  const hubRealPath = await realpathOrResolved(hubDir);
  const skillRealPath = await realpathOrResolved(skillPath);
  const relativePath = path.relative(hubRealPath, skillRealPath);

  if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("拒绝删除中心仓库之外的路径");
  }
}

async function removeEmptyParents(hubDir: string, startDir: string): Promise<void> {
  const hubRealPath = await realpathOrResolved(hubDir);
  let current = path.resolve(startDir);

  while (current !== hubRealPath && current.startsWith(hubRealPath)) {
    if (!(await pathExists(current))) {
      current = path.dirname(current);
      continue;
    }

    const entries = await fs.readdir(current);
    if (entries.length > 0) {
      return;
    }

    await fs.rmdir(current);
    current = path.dirname(current);
  }
}

async function realpathOrResolved(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}
