import fs from "node:fs/promises";
import path from "node:path";
import { parseSkillMeta, pathExists } from "./frontmatter";
import { cloneGitHubRepo, parseGitHubUrl } from "./github";
import { enableSkillForTool } from "./linker";
import { writeHubMetadata } from "./metadata";
import { toPosixRelativePath } from "./paths";
import { buildSkillRecord, findSkillCandidates } from "./scanner";
import type {
  AdoptExistingRequest,
  AdoptExistingResult,
  AppConfig,
  InstallFromGitHubRequest,
  InstallFromLocalPathRequest,
  InstallResult,
  ManagerMetadata,
  OperationFailure,
  SkillCandidate,
  SkillRecord,
  ToolId
} from "./types";

interface InstallSession {
  sourceRoot: string;
  metadataBase: Omit<ManagerMetadata, "app" | "installedAt">;
  candidates: SkillCandidate[];
}

const installSessions = new Map<string, InstallSession>();

export async function installFromGitHub(
  config: AppConfig,
  request: InstallFromGitHubRequest
): Promise<InstallResult> {
  if (request.installSessionId && request.selectedSkillIds?.length) {
    return installFromSession(config, request.installSessionId, request.selectedSkillIds);
  }

  const parsed = parseGitHubUrl(request.url, request.subpath);
  const clone = await cloneGitHubRepo(parsed);
  const basePath = resolveInside(clone.dir, parsed.subpath);
  const metadataBase: Omit<ManagerMetadata, "app" | "installedAt"> = {
    sourceType: "github",
    sourceUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
    sourceSubpath: parsed.subpath,
    revision: clone.revision
  };

  return installFromSourceRoot(config, basePath, metadataBase, request.selectedSkillIds);
}

export async function installFromLocalPath(
  config: AppConfig,
  request: InstallFromLocalPathRequest
): Promise<InstallResult> {
  if (request.installSessionId && request.selectedSkillIds?.length) {
    return installFromSession(config, request.installSessionId, request.selectedSkillIds);
  }

  const metadataBase: Omit<ManagerMetadata, "app" | "installedAt"> = {
    sourceType: "local",
    sourceSubpath: request.path
  };
  return installFromSourceRoot(config, request.path, metadataBase, request.selectedSkillIds);
}

export async function adoptExistingSkills(
  config: AppConfig,
  request: AdoptExistingRequest = {}
): Promise<AdoptExistingResult> {
  await fs.mkdir(config.hubDir, { recursive: true });
  const toolIds = request.toolIds?.length
    ? request.toolIds
    : (Object.keys(config.tools) as ToolId[]);
  const adopted: SkillRecord[] = [];
  const skipped: OperationFailure[] = [];

  for (const toolId of toolIds) {
    const tool = config.tools[toolId];
    if (!(await pathExists(tool.skillsPath))) {
      continue;
    }

    const entries = await fs.readdir(tool.skillsPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sourcePath = path.join(tool.skillsPath, entry.name);
      const stat = await fs.lstat(sourcePath);
      if (stat.isSymbolicLink()) {
        skipped.push({
          skillId: entry.name,
          toolId,
          message: "已是链接，跳过接管"
        });
        continue;
      }

      const candidates = await findSkillCandidates(sourcePath, { recursive: false });
      if (!candidates.length) {
        continue;
      }

      const meta = await parseSkillMeta(sourcePath);
      const targetPath = path.join(config.hubDir, meta.id);
      if (await pathExists(targetPath)) {
        skipped.push({
          skillId: meta.id,
          toolId,
          message: "中心仓库已存在同名 skill，未覆盖"
        });
        continue;
      }

      try {
        await copySkillIntoHub(sourcePath, targetPath, {
          sourceType: "adopted",
          sourceSubpath: sourcePath
        });
        await fs.rm(sourcePath, { recursive: true, force: true });
        await enableSkillForTool(config, targetPath, meta.id, toolId);
        adopted.push(await buildSkillRecord(config, targetPath));
      } catch (error) {
        skipped.push({
          skillId: meta.id,
          toolId,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  return { adopted, skipped };
}

async function installFromSourceRoot(
  config: AppConfig,
  sourceRoot: string,
  metadataBase: Omit<ManagerMetadata, "app" | "installedAt">,
  selectedSkillIds?: string[]
): Promise<InstallResult> {
  await fs.mkdir(config.hubDir, { recursive: true });
  const candidates = await markInstalledCandidates(
    config,
    await findSkillCandidates(sourceRoot, { recursive: true })
  );

  if (!candidates.length) {
    return {
      installed: [],
      alreadyInstalled: [],
      candidates: [],
      needsSelection: false,
      failures: [{ message: "没有找到包含 SKILL.md、skill.md 或 meta.json 的 skill 目录" }]
    };
  }

  const hasInstallableCandidates = candidates.some((candidate) => !candidate.installed);
  if (candidates.length > 1 && !selectedSkillIds?.length && hasInstallableCandidates) {
    const installSessionId = createInstallSession(sourceRoot, metadataBase, candidates);
    return {
      installed: [],
      alreadyInstalled: [],
      candidates,
      needsSelection: true,
      installSessionId,
      failures: []
    };
  }

  const effectiveSelectedSkillIds =
    candidates.length > 1 && !selectedSkillIds?.length && !hasInstallableCandidates
      ? candidates.map((candidate) => candidate.id)
      : selectedSkillIds;
  return installSelectedCandidates(config, candidates, metadataBase, effectiveSelectedSkillIds);
}

async function installFromSession(
  config: AppConfig,
  installSessionId: string,
  selectedSkillIds: string[]
): Promise<InstallResult> {
  const session = installSessions.get(installSessionId);
  if (!session) {
    throw new Error("安装会话已失效，请重新导入一次 GitHub 地址");
  }

  const result = await installSelectedCandidates(
    config,
    session.candidates,
    session.metadataBase,
    selectedSkillIds
  );
  installSessions.delete(installSessionId);
  return result;
}

async function installSelectedCandidates(
  config: AppConfig,
  candidates: SkillCandidate[],
  metadataBase: Omit<ManagerMetadata, "app" | "installedAt">,
  selectedSkillIds?: string[]
): Promise<InstallResult> {
  const selected = selectCandidates(candidates, selectedSkillIds);
  const installed: SkillRecord[] = [];
  const alreadyInstalled: SkillRecord[] = [];
  const failures: OperationFailure[] = [];

  for (const candidate of selected) {
    const targetPath = path.join(config.hubDir, candidate.id);
    if (await pathExists(targetPath)) {
      alreadyInstalled.push(await buildSkillRecord(config, targetPath));
      continue;
    }

    try {
      const sourceSubpath = combineSourceSubpath(metadataBase.sourceSubpath, candidate.relativePath);
      await copySkillIntoHub(candidate.path, targetPath, {
        ...metadataBase,
        sourceSubpath
      });
      installed.push(await buildSkillRecord(config, targetPath));
    } catch (error) {
      failures.push({
        skillId: candidate.id,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    installed,
    alreadyInstalled,
    candidates,
    needsSelection: false,
    failures
  };
}

async function markInstalledCandidates(
  config: AppConfig,
  candidates: SkillCandidate[]
): Promise<SkillCandidate[]> {
  return Promise.all(
    candidates.map(async (candidate) => ({
      ...candidate,
      installed: await pathExists(path.join(config.hubDir, candidate.id))
    }))
  );
}

function createInstallSession(
  sourceRoot: string,
  metadataBase: Omit<ManagerMetadata, "app" | "installedAt">,
  candidates: SkillCandidate[]
): string {
  const installSessionId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  installSessions.set(installSessionId, {
    sourceRoot,
    metadataBase,
    candidates
  });
  return installSessionId;
}

function selectCandidates(candidates: SkillCandidate[], selectedSkillIds?: string[]): SkillCandidate[] {
  if (!selectedSkillIds?.length) {
    return [candidates[0]];
  }
  const selected = new Set(selectedSkillIds);
  return candidates.filter((candidate) => selected.has(candidate.id));
}

async function copySkillIntoHub(
  sourcePath: string,
  targetPath: string,
  metadata: Omit<ManagerMetadata, "app" | "installedAt">
): Promise<void> {
  await fs.cp(sourcePath, targetPath, {
    recursive: true,
    force: false,
    errorOnExist: true,
    verbatimSymlinks: false
  });
  await writeHubMetadata(targetPath, metadata);
}

function resolveInside(rootPath: string, subpath?: string): string {
  const resolvedRoot = path.resolve(rootPath);
  const resolved = path.resolve(rootPath, subpath || ".");
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("subpath 不能指向仓库外部");
  }
  return resolved;
}

function combineSourceSubpath(base: string | undefined, relativePath: string): string | undefined {
  const parts = [base, relativePath === "." ? undefined : relativePath].filter(Boolean) as string[];
  if (!parts.length) {
    return undefined;
  }
  return toPosixRelativePath(path.join(...parts));
}
