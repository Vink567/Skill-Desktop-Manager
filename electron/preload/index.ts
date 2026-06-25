import { contextBridge, ipcRenderer } from "electron";
import type {
  AdoptExistingRequest,
  AppConfig,
  BatchSetToolEnabledRequest,
  DeleteSkillsResult,
  DeleteSkillsRequest,
  InstallFromGitHubRequest,
  InstallFromLocalPathRequest,
  MergeApplyRequest,
  MergeApplyResult,
  MergePreview,
  MergePreviewRequest,
  SetToolEnabledRequest,
  SkillRecord
} from "../main/types";

const api = {
  config: {
    get: (): Promise<AppConfig> => ipcRenderer.invoke("config:get"),
    update: (patch: Partial<AppConfig>): Promise<AppConfig> => ipcRenderer.invoke("config:update", patch)
  },
  tools: {
    list: () => ipcRenderer.invoke("tools:list")
  },
  skills: {
    list: () => ipcRenderer.invoke("skills:list"),
    installFromGitHub: (request: InstallFromGitHubRequest) =>
      ipcRenderer.invoke("skills:installFromGitHub", request),
    installFromLocalPath: (request: InstallFromLocalPathRequest) =>
      ipcRenderer.invoke("skills:installFromLocalPath", request),
    setToolEnabled: (request: SetToolEnabledRequest) =>
      ipcRenderer.invoke("skills:setToolEnabled", request),
    batchSetToolEnabled: (request: BatchSetToolEnabledRequest) =>
      ipcRenderer.invoke("skills:batchSetToolEnabled", request),
    delete: (request: DeleteSkillsRequest): Promise<DeleteSkillsResult & { skills: SkillRecord[] }> =>
      ipcRenderer.invoke("skills:delete", request),
    adoptExisting: (request?: AdoptExistingRequest) => ipcRenderer.invoke("skills:adoptExisting", request ?? {}),
    readMarkdown: (skillId: string) => ipcRenderer.invoke("skills:readMarkdown", skillId),
    getMergePreview: (request: MergePreviewRequest): Promise<MergePreview> =>
      ipcRenderer.invoke("skills:getMergePreview", request),
    applyMerge: (request: MergeApplyRequest): Promise<MergeApplyResult & { skills: SkillRecord[] }> =>
      ipcRenderer.invoke("skills:applyMerge", request)
  },
  dialog: {
    selectDirectory: (): Promise<string | undefined> => ipcRenderer.invoke("dialog:selectDirectory")
  },
  settings: {
    onOpen: (callback: () => void): (() => void) => {
      const listener = (): void => callback();
      ipcRenderer.on("settings:open", listener);
      return () => ipcRenderer.removeListener("settings:open", listener);
    }
  }
};

contextBridge.exposeInMainWorld("skillManager", api);

export type SkillManagerApi = typeof api;
