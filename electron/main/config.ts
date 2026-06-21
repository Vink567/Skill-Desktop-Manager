import fs from "node:fs/promises";
import { appRootDir, configPath, defaultHubDir } from "./paths";
import { detectTools } from "./tools";
import type { AppConfig, LinkMode, ToolConfig, ToolId } from "./types";

export async function loadConfig(): Promise<AppConfig> {
  await ensureAppDirectories();
  const filePath = configPath();

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const merged = mergeConfig(parsed);
    await saveConfig(merged);
    return merged;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[skill-manager] Failed to read config, recreating defaults:", error);
    }
    const created = createDefaultConfig();
    await saveConfig(created);
    return created;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await ensureAppDirectories();
  await fs.writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function updateConfig(patch: Partial<AppConfig>): Promise<AppConfig> {
  const existing = await loadConfig();
  const next: AppConfig = {
    ...existing,
    ...patch,
    tools: mergeTools(existing.tools, patch.tools),
    linkMode: normalizeLinkMode(patch.linkMode ?? existing.linkMode),
    updatedAt: new Date().toISOString()
  };

  await saveConfig(next);
  return loadConfig();
}

export function createDefaultConfig(): AppConfig {
  const now = new Date().toISOString();
  return {
    hubDir: defaultHubDir(),
    tools: detectTools(),
    linkMode: "link-preferred",
    createdAt: now,
    updatedAt: now
  };
}

async function ensureAppDirectories(): Promise<void> {
  await fs.mkdir(appRootDir(), { recursive: true });
  await fs.mkdir(defaultHubDir(), { recursive: true });
}

function mergeConfig(parsed: Partial<AppConfig>): AppConfig {
  const defaults = createDefaultConfig();
  return {
    ...defaults,
    ...parsed,
    hubDir: parsed.hubDir || defaults.hubDir,
    tools: mergeTools(defaults.tools, parsed.tools),
    linkMode: normalizeLinkMode(parsed.linkMode || defaults.linkMode),
    createdAt: parsed.createdAt || defaults.createdAt,
    updatedAt: new Date().toISOString()
  };
}

function mergeTools(
  base: Record<ToolId, ToolConfig>,
  patch?: Partial<Record<ToolId, ToolConfig>>
): Record<ToolId, ToolConfig> {
  const detected = detectTools(patch ?? base);
  return {
    codex: {
      ...base.codex,
      ...(patch?.codex ?? {}),
      ...detected.codex
    },
    "claude-code": {
      ...base["claude-code"],
      ...(patch?.["claude-code"] ?? {}),
      ...detected["claude-code"]
    }
  };
}

function normalizeLinkMode(value: LinkMode | string): LinkMode {
  return value === "copy" ? "copy" : "link-preferred";
}
