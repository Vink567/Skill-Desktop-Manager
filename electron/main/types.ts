export type ToolId = "codex" | "claude-code";

export type SourceType = "hub" | "github" | "local" | "adopted";

export type LinkMode = "link-preferred" | "copy";

export type ToolSkillStatus =
  | "enabled"
  | "disabled"
  | "conflict"
  | "broken";

export interface ToolConfig {
  id: ToolId;
  name: string;
  configPath: string;
  skillsPath: string;
  detected: boolean;
  cliAvailable: boolean;
  enabled: boolean;
}

export interface AppConfig {
  hubDir: string;
  tools: Record<ToolId, ToolConfig>;
  linkMode: LinkMode;
  createdAt: string;
  updatedAt: string;
}

export interface SkillToolState {
  enabled: boolean;
  status: ToolSkillStatus;
  targetPath: string;
  managed: boolean;
  message?: string;
}

export interface SkillRecord {
  id: string;
  name: string;
  description?: string;
  path: string;
  sourceType: SourceType;
  sourceUrl?: string;
  sourceSubpath?: string;
  revision?: string;
  enabledByTool: Record<ToolId, SkillToolState>;
}

export interface SkillCandidate {
  id: string;
  name: string;
  description?: string;
  path: string;
  relativePath: string;
  installed?: boolean;
}

export interface InstallRequestBase {
  selectedSkillIds?: string[];
  installSessionId?: string;
}

export interface InstallFromGitHubRequest extends InstallRequestBase {
  url: string;
  subpath?: string;
}

export interface InstallFromLocalPathRequest extends InstallRequestBase {
  path: string;
}

export interface InstallResult {
  installed: SkillRecord[];
  alreadyInstalled: SkillRecord[];
  candidates: SkillCandidate[];
  needsSelection: boolean;
  installSessionId?: string;
  failures: OperationFailure[];
}

export interface OperationFailure {
  skillId?: string;
  toolId?: ToolId;
  message: string;
}

export interface BatchSetToolEnabledRequest {
  skillIds: string[];
  toolIds: ToolId[];
  enabled: boolean;
}

export interface BatchOperationResult {
  requestedCount: number;
  appliedCount: number;
  skippedCount: number;
  failedCount: number;
  failures: OperationFailure[];
}

export interface DeleteSkillsRequest {
  skillIds: string[];
}

export interface DeleteSkillsResult {
  requestedCount: number;
  deletedCount: number;
  failedCount: number;
  failures: OperationFailure[];
}

export interface SetToolEnabledRequest {
  skillId: string;
  toolId: ToolId;
  enabled: boolean;
}

export interface AdoptExistingRequest {
  toolIds?: ToolId[];
}

export interface AdoptExistingResult {
  adopted: SkillRecord[];
  skipped: OperationFailure[];
}

export interface ManagerMetadata {
  app: "skill-desktop-manager";
  sourceType: SourceType;
  sourceUrl?: string;
  sourceSubpath?: string;
  revision?: string;
  installedAt: string;
}

export interface ManagedCopyMetadata {
  app: "skill-desktop-manager";
  skillId: string;
  sourcePath: string;
  copiedAt: string;
}
