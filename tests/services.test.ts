import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { updateConfig } from "../electron/main/config";
import { deleteInstalledSkills } from "../electron/main/deleter";
import { parseSkillMeta, pathExists } from "../electron/main/frontmatter";
import { cloneGitHubRepo, parseGitHubUrl } from "../electron/main/github";
import { installFromLocalPath } from "../electron/main/installer";
import { enableSkillForTool, disableSkillForTool, checkToolState } from "../electron/main/linker";
import { COPY_METADATA_FILE } from "../electron/main/metadata";
import { findSkillCandidates, listSkills } from "../electron/main/scanner";
import { detectTools } from "../electron/main/tools";
import type { AppConfig, ToolConfig, ToolId } from "../electron/main/types";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("skill metadata parsing", () => {
  it("parses UTF-8 SKILL.md frontmatter", async () => {
    const root = await makeTempRoot();
    const skillDir = path.join(root, "twitter-writer");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: twitter-writer\ndescription: 中文 X 写作助手\n---\n\n# 内容\n",
      "utf8"
    );

    await expect(parseSkillMeta(skillDir)).resolves.toMatchObject({
      id: "twitter-writer",
      name: "twitter-writer",
      description: "中文 X 写作助手"
    });
  });

  it("uses meta.json first and falls back safely", async () => {
    const root = await makeTempRoot();
    const skillDir = path.join(root, "meta-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "meta.json"),
      JSON.stringify({ name: "Meta Skill", description: "From meta" }),
      "utf8"
    );
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: Markdown Skill\ndescription: From markdown\n---\n",
      "utf8"
    );

    await expect(parseSkillMeta(skillDir)).resolves.toMatchObject({
      name: "Meta Skill",
      description: "From meta"
    });
  });
});

describe("skill scanning", () => {
  it("finds direct and nested skills and dedupes by shallower hub path", async () => {
    const root = await makeTempRoot();
    const hubDir = path.join(root, "hub");
    await writeSkill(path.join(hubDir, "plain-skill"), "plain-skill");
    await writeSkill(path.join(hubDir, "pack", "nested-skill"), "nested-skill");
    await writeSkill(path.join(hubDir, "container", "plain-skill"), "plain-skill");

    const config = makeConfig(root, hubDir);
    const skills = await listSkills(config);

    expect(skills.map((skill) => skill.id)).toEqual(["nested-skill", "plain-skill"]);
    expect(skills.find((skill) => skill.id === "plain-skill")?.path).toBe(
      path.join(hubDir, "plain-skill")
    );
  });

  it("returns install candidates from a source tree", async () => {
    const root = await makeTempRoot();
    await writeSkill(path.join(root, "repo", "skills", "alpha"), "alpha");
    await writeSkill(path.join(root, "repo", "skills", "beta"), "beta");

    const candidates = await findSkillCandidates(path.join(root, "repo"), { recursive: true });

    expect(candidates.map((candidate) => candidate.id)).toEqual(["alpha", "beta"]);
    expect(candidates[0].relativePath).toBe("skills/alpha");
  });
});

describe("github URL parsing", () => {
  it("parses repository and tree URLs", () => {
    expect(parseGitHubUrl("https://github.com/acme/skills")).toMatchObject({
      owner: "acme",
      repo: "skills",
      repoUrl: "https://github.com/acme/skills.git"
    });

    expect(parseGitHubUrl("https://github.com/acme/skills/tree/main/packs/team")).toMatchObject({
      ref: "main",
      subpath: "packs/team"
    });
  });
});

describe("github cloning", () => {
  it("retries transient clone failures with an HTTP/1.1 fallback", async () => {
    const root = await makeTempRoot();
    const home = path.join(root, "home");
    const calls: string[][] = [];
    let cloneAttempts = 0;

    const originalHome = process.env.SKILL_MANAGER_HOME;
    process.env.SKILL_MANAGER_HOME = home;

    try {
      const clone = await (cloneGitHubRepo as unknown as CloneGitHubRepoWithRunner)(
        {
          owner: "obra",
          repo: "superpowers",
          repoUrl: "https://github.com/obra/superpowers.git"
        },
        async (args) => {
          calls.push(args);

          if (args.includes("rev-parse")) {
            return "fake-revision\n";
          }

          if (args.includes("clone")) {
            cloneAttempts += 1;
            if (cloneAttempts === 1) {
              throw new Error(
                "fatal: unable to access 'https://github.com/obra/superpowers.git/': Recv failure: Connection was reset"
              );
            }

            await fs.mkdir(args.at(-1) ?? "", { recursive: true });
            return "";
          }

          throw new Error(`Unexpected git args: ${args.join(" ")}`);
        }
      );

      expect(clone.revision).toBe("fake-revision");
      const cloneCalls = calls.filter((args) => args.includes("clone"));
      expect(cloneCalls).toHaveLength(2);
      expect(cloneCalls[1].slice(0, 2)).toEqual(["-c", "http.version=HTTP/1.1"]);
    } finally {
      restoreEnv("SKILL_MANAGER_HOME", originalHome);
    }
  });
});

describe("tool detection", () => {
  it("treats an existing manually selected skills directory as detected", async () => {
    const root = await makeTempRoot();
    const configPath = path.join(root, ".missing-codex");
    const skillsPath = path.join(root, "custom-codex-skills");
    await fs.mkdir(skillsPath, { recursive: true });

    const tools = detectTools({
      codex: {
        ...makeTool("codex", "Codex", configPath),
        skillsPath
      }
    });

    expect(tools.codex.skillsPath).toBe(skillsPath);
    expect(tools.codex.detected).toBe(true);
  });

  it("recomputes detection when saving a manually selected skills directory", async () => {
    const root = await makeTempRoot();
    const home = path.join(root, "home");
    const configPath = path.join(root, ".missing-codex");
    const skillsPath = path.join(root, "custom-codex-skills");
    const originalHome = process.env.SKILL_MANAGER_HOME;
    await fs.mkdir(skillsPath, { recursive: true });
    process.env.SKILL_MANAGER_HOME = home;

    try {
      const nextConfig = await updateConfig({
        tools: {
          codex: {
            ...makeTool("codex", "Codex", configPath),
            detected: false,
            skillsPath
          },
          "claude-code": makeTool("claude-code", "Claude Code", path.join(root, ".claude"))
        }
      });

      expect(nextConfig.tools.codex.skillsPath).toBe(skillsPath);
      expect(nextConfig.tools.codex.detected).toBe(true);
    } finally {
      restoreEnv("SKILL_MANAGER_HOME", originalHome);
    }
  });
});

describe("install sessions", () => {
  it("reports repeated installs as already installed instead of failures", async () => {
    const root = await makeTempRoot();
    const hubDir = path.join(root, "hub");
    const sourceDir = path.join(root, "source-pack");
    await writeSkill(path.join(sourceDir, "repeat-me"), "repeat-me");
    const config = makeConfig(root, hubDir);

    const first = await installFromLocalPath(config, { path: sourceDir });
    expect(first.installed.map((skill) => skill.id)).toEqual(["repeat-me"]);

    const second = await installFromLocalPath(config, { path: sourceDir });
    expect(second).toMatchObject({
      installed: [],
      alreadyInstalled: [
        expect.objectContaining({
          id: "repeat-me"
        })
      ],
      failures: []
    });
  });

  it("installs selected candidates from the first scan session", async () => {
    const root = await makeTempRoot();
    const hubDir = path.join(root, "hub");
    const sourceDir = path.join(root, "source-pack");
    await writeSkill(path.join(sourceDir, "skills", "alpha"), "alpha");
    await writeSkill(path.join(sourceDir, "skills", "beta"), "beta");
    const config = makeConfig(root, hubDir);

    const first = await installFromLocalPath(config, { path: sourceDir });
    expect(first.needsSelection).toBe(true);
    expect(first.installSessionId).toBeTruthy();
    expect(first.candidates.map((candidate) => candidate.id)).toEqual(["alpha", "beta"]);

    const second = await installFromLocalPath(config, {
      path: sourceDir,
      installSessionId: first.installSessionId,
      selectedSkillIds: ["beta"]
    });

    expect(second.needsSelection).toBe(false);
    expect(second.installed.map((skill) => skill.id)).toEqual(["beta"]);
    expect(await pathExists(path.join(hubDir, "beta", "SKILL.md"))).toBe(true);
    expect(await pathExists(path.join(hubDir, "alpha"))).toBe(false);
  });
});

describe("link management", () => {
  it("enables and disables a managed target without deleting the hub source", async () => {
    const root = await makeTempRoot();
    const hubDir = path.join(root, "hub");
    const skillPath = path.join(hubDir, "demo-skill");
    await writeSkill(skillPath, "demo-skill");
    const config = makeConfig(root, hubDir);

    await enableSkillForTool(config, skillPath, "demo-skill", "codex");
    const enabled = await checkToolState(skillPath, "demo-skill", config.tools.codex);

    expect(enabled.enabled).toBe(true);
    expect(enabled.managed).toBe(true);

    await disableSkillForTool(config, skillPath, "demo-skill", "codex");

    expect(await pathExists(path.join(config.tools.codex.skillsPath, "demo-skill"))).toBe(false);
    expect(await pathExists(skillPath)).toBe(true);
  });

  it("reports conflicts for unmanaged same-name directories", async () => {
    const root = await makeTempRoot();
    const hubDir = path.join(root, "hub");
    const skillPath = path.join(hubDir, "demo-skill");
    await writeSkill(skillPath, "demo-skill");
    const config = makeConfig(root, hubDir);
    await writeSkill(path.join(config.tools.codex.skillsPath, "demo-skill"), "demo-skill");

    const state = await checkToolState(skillPath, "demo-skill", config.tools.codex);
    expect(state.status).toBe("conflict");
    await expect(enableSkillForTool(config, skillPath, "demo-skill", "codex")).rejects.toThrow(
      /冲突|非托管/
    );
  });

  it("copy mode writes managed metadata", async () => {
    const root = await makeTempRoot();
    const hubDir = path.join(root, "hub");
    const skillPath = path.join(hubDir, "copy-skill");
    await writeSkill(skillPath, "copy-skill");
    const config = makeConfig(root, hubDir, "copy");

    await enableSkillForTool(config, skillPath, "copy-skill", "claude-code");
    const target = path.join(config.tools["claude-code"].skillsPath, "copy-skill");

    expect(await pathExists(path.join(target, COPY_METADATA_FILE))).toBe(true);
    await expect(checkToolState(skillPath, "copy-skill", config.tools["claude-code"])).resolves.toMatchObject({
      enabled: true,
      managed: true
    });
  });
});

describe("deleting installed skills", () => {
  it("deletes the hub skill and removes managed tool targets", async () => {
    const root = await makeTempRoot();
    const hubDir = path.join(root, "hub");
    const skillPath = path.join(hubDir, "delete-me");
    await writeSkill(skillPath, "delete-me");
    const config = makeConfig(root, hubDir);

    await enableSkillForTool(config, skillPath, "delete-me", "codex");
    const skills = await listSkills(config);
    const result = await deleteInstalledSkills(config, skills, ["delete-me"]);

    expect(result.deletedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(await pathExists(skillPath)).toBe(false);
    expect(await pathExists(path.join(config.tools.codex.skillsPath, "delete-me"))).toBe(false);
  });

  it("keeps unmanaged same-name tool directories while deleting the hub skill", async () => {
    const root = await makeTempRoot();
    const hubDir = path.join(root, "hub");
    const skillPath = path.join(hubDir, "keep-tool-copy");
    const unmanagedToolPath = path.join(root, ".codex", "skills", "keep-tool-copy");
    await writeSkill(skillPath, "keep-tool-copy");
    await writeSkill(unmanagedToolPath, "keep-tool-copy");
    const config = makeConfig(root, hubDir);

    const skills = await listSkills(config);
    const result = await deleteInstalledSkills(config, skills, ["keep-tool-copy"]);

    expect(result.deletedCount).toBe(1);
    expect(result.failures).toEqual([
      expect.objectContaining({
        skillId: "keep-tool-copy",
        toolId: "codex"
      })
    ]);
    expect(await pathExists(skillPath)).toBe(false);
    expect(await pathExists(path.join(unmanagedToolPath, "SKILL.md"))).toBe(true);
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skill-manager-test-"));
  tempRoots.push(root);
  return root;
}

async function writeSkill(skillDir: string, name: string): Promise<void> {
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill ${name}\n---\n\n# ${name}\n`,
    "utf8"
  );
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

type CloneGitHubRepoWithRunner = (
  parsed: Parameters<typeof cloneGitHubRepo>[0],
  runner: (args: string[], cwd?: string) => Promise<string>
) => ReturnType<typeof cloneGitHubRepo>;

function makeConfig(root: string, hubDir: string, linkMode: AppConfig["linkMode"] = "link-preferred"): AppConfig {
  const codex = makeTool("codex", "Codex", path.join(root, ".codex"));
  const claude = makeTool("claude-code", "Claude Code", path.join(root, ".claude"));
  return {
    hubDir,
    tools: {
      codex,
      "claude-code": claude
    },
    linkMode,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function makeTool(id: ToolId, name: string, configPath: string): ToolConfig {
  return {
    id,
    name,
    configPath,
    skillsPath: path.join(configPath, "skills"),
    detected: true,
    cliAvailable: true,
    enabled: true
  };
}
