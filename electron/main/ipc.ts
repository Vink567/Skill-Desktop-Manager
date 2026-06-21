import { dialog, ipcMain } from "electron";
import { loadConfig, updateConfig } from "./config";
import { deleteInstalledSkills } from "./deleter";
import { adoptExistingSkills, installFromGitHub, installFromLocalPath } from "./installer";
import { batchSetToolEnabled, disableSkillForTool, enableSkillForTool } from "./linker";
import { readSkillMarkdown } from "./frontmatter";
import { listSkills } from "./scanner";
import type {
  AdoptExistingRequest,
  AppConfig,
  BatchSetToolEnabledRequest,
  DeleteSkillsRequest,
  InstallFromGitHubRequest,
  InstallFromLocalPathRequest,
  SetToolEnabledRequest
} from "./types";

export function registerIpcHandlers(): void {
  ipcMain.handle("config:get", async () => loadConfig());

  ipcMain.handle("config:update", async (_event, patch: Partial<AppConfig>) => updateConfig(patch));

  ipcMain.handle("tools:list", async () => {
    const config = await loadConfig();
    return Object.values(config.tools);
  });

  ipcMain.handle("skills:list", async () => {
    const config = await loadConfig();
    return listSkills(config);
  });

  ipcMain.handle("skills:installFromGitHub", async (_event, request: InstallFromGitHubRequest) => {
    const config = await loadConfig();
    return installFromGitHub(config, request);
  });

  ipcMain.handle("skills:installFromLocalPath", async (_event, request: InstallFromLocalPathRequest) => {
    const config = await loadConfig();
    return installFromLocalPath(config, request);
  });

  ipcMain.handle("skills:setToolEnabled", async (_event, request: SetToolEnabledRequest) => {
    const config = await loadConfig();
    const skills = await listSkills(config);
    const skill = skills.find((item) => item.id === request.skillId);
    if (!skill) {
      throw new Error(`Skill 不存在: ${request.skillId}`);
    }

    if (request.enabled) {
      await enableSkillForTool(config, skill.path, skill.id, request.toolId);
    } else {
      await disableSkillForTool(config, skill.path, skill.id, request.toolId);
    }

    return listSkills(config);
  });

  ipcMain.handle("skills:batchSetToolEnabled", async (_event, request: BatchSetToolEnabledRequest) => {
    const config = await loadConfig();
    const allSkills = await listSkills(config);
    const selected = allSkills
      .filter((skill) => request.skillIds.includes(skill.id))
      .map((skill) => ({ id: skill.id, path: skill.path }));
    const result = await batchSetToolEnabled(config, selected, request.toolIds, request.enabled);
    return {
      ...result,
      skills: await listSkills(config)
    };
  });

  ipcMain.handle("skills:adoptExisting", async (_event, request: AdoptExistingRequest) => {
    const config = await loadConfig();
    return adoptExistingSkills(config, request);
  });

  ipcMain.handle("skills:delete", async (_event, request: DeleteSkillsRequest) => {
    const config = await loadConfig();
    const skills = await listSkills(config);
    const result = await deleteInstalledSkills(config, skills, request.skillIds);
    return {
      ...result,
      skills: await listSkills(config)
    };
  });

  ipcMain.handle("skills:readMarkdown", async (_event, skillId: string) => {
    const config = await loadConfig();
    const skills = await listSkills(config);
    const skill = skills.find((item) => item.id === skillId);
    if (!skill) {
      throw new Error(`Skill 不存在: ${skillId}`);
    }
    return readSkillMarkdown(skill.path);
  });

  ipcMain.handle("dialog:selectDirectory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "选择 skill 目录或包含 skills 的目录"
    });
    return result.canceled ? undefined : result.filePaths[0];
  });
}
