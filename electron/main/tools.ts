import fs from "node:fs";
import path from "node:path";
import { homeDir } from "./paths";
import type { ToolConfig, ToolId } from "./types";

interface ToolDefinition {
  id: ToolId;
  name: string;
  configDir: string;
  cliCommand: string;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    id: "codex",
    name: "Codex",
    configDir: ".codex",
    cliCommand: "codex"
  },
  {
    id: "claude-code",
    name: "Claude Code",
    configDir: ".claude",
    cliCommand: "claude"
  }
];

export function defaultToolConfig(definition: ToolDefinition): ToolConfig {
  const configPath = path.join(homeDir(), definition.configDir);
  return {
    id: definition.id,
    name: definition.name,
    configPath,
    skillsPath: path.join(configPath, "skills"),
    detected: fs.existsSync(configPath),
    cliAvailable: isCommandAvailable(definition.cliCommand),
    enabled: true
  };
}

export function detectTools(saved?: Partial<Record<ToolId, ToolConfig>>): Record<ToolId, ToolConfig> {
  const tools = {} as Record<ToolId, ToolConfig>;

  for (const definition of TOOL_DEFINITIONS) {
    const defaults = defaultToolConfig(definition);
    const persisted = saved?.[definition.id];
    const configPath = persisted?.configPath || defaults.configPath;
    const skillsPath = persisted?.skillsPath || path.join(configPath, "skills");
    const detected = fs.existsSync(configPath) || fs.existsSync(skillsPath);

    tools[definition.id] = {
      ...defaults,
      configPath,
      skillsPath,
      detected,
      cliAvailable: isCommandAvailable(definition.cliCommand),
      enabled: persisted?.enabled ?? defaults.enabled
    };
  }

  return tools;
}

function isCommandAvailable(command: string): boolean {
  const pathValue = process.env.PATH || "";
  const pathEntries = pathValue.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter(Boolean)
      : [""];

  for (const entry of pathEntries) {
    if (process.platform === "win32") {
      for (const ext of extensions) {
        const candidate = path.join(entry, `${command}${ext.toLowerCase()}`);
        const candidateUpper = path.join(entry, `${command}${ext.toUpperCase()}`);
        if (isExecutableFile(candidate) || isExecutableFile(candidateUpper)) {
          return true;
        }
      }
      const extensionless = path.join(entry, command);
      if (isExecutableFile(extensionless)) {
        return true;
      }
      continue;
    }

    if (isExecutableFile(path.join(entry, command))) {
      return true;
    }
  }

  return false;
}

function isExecutableFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}
