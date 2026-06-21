import fs from "node:fs/promises";
import path from "node:path";

export interface ParsedSkillMeta {
  id: string;
  name: string;
  description?: string;
}

export async function isSkillDir(dirPath: string): Promise<boolean> {
  return (
    (await pathExists(path.join(dirPath, "SKILL.md"))) ||
    (await pathExists(path.join(dirPath, "skill.md"))) ||
    (await pathExists(path.join(dirPath, "meta.json")))
  );
}

export async function parseSkillMeta(skillDir: string): Promise<ParsedSkillMeta> {
  const id = path.basename(skillDir);
  const metaPath = path.join(skillDir, "meta.json");
  const skillMdPath = (await pathExists(path.join(skillDir, "SKILL.md")))
    ? path.join(skillDir, "SKILL.md")
    : path.join(skillDir, "skill.md");

  const fromMetaJson = await parseMetaJson(metaPath, id);
  const fromSkillMd = (await pathExists(skillMdPath))
    ? await parseSkillMarkdown(skillMdPath, id)
    : undefined;

  return {
    id,
    name: fromMetaJson?.name || fromSkillMd?.name || humanizeId(id),
    description: fromMetaJson?.description || fromSkillMd?.description
  };
}

export async function readSkillMarkdown(skillDir: string): Promise<string> {
  const upper = path.join(skillDir, "SKILL.md");
  const lower = path.join(skillDir, "skill.md");
  const target = (await pathExists(upper)) ? upper : lower;
  return fs.readFile(target, "utf8");
}

export function sanitizeSkillId(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "untitled-skill";
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function parseMetaJson(metaPath: string, id: string): Promise<ParsedSkillMeta | undefined> {
  if (!(await pathExists(metaPath))) {
    return undefined;
  }

  try {
    const raw = await fs.readFile(metaPath, "utf8");
    const parsed = JSON.parse(raw) as {
      name?: unknown;
      description?: unknown;
    };
    return {
      id,
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : humanizeId(id),
      description:
        typeof parsed.description === "string" && parsed.description.trim()
          ? parsed.description.trim()
          : undefined
    };
  } catch {
    return undefined;
  }
}

async function parseSkillMarkdown(skillMdPath: string, id: string): Promise<ParsedSkillMeta> {
  const raw = await fs.readFile(skillMdPath, "utf8");
  const frontmatter = extractFrontmatter(raw);
  const parsed = frontmatter ? parseFrontmatterLines(frontmatter) : {};

  return {
    id,
    name: parsed.name || humanizeId(id),
    description: parsed.description
  };
}

function extractFrontmatter(raw: string): string | undefined {
  const normalized = raw.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---")) {
    return undefined;
  }

  const lines = normalized.split(/\r?\n/);
  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (endIndex <= 0) {
    return undefined;
  }

  return lines.slice(1, endIndex).join("\n");
}

function parseFrontmatterLines(frontmatter: string): { name?: string; description?: string } {
  const result: { name?: string; description?: string } = {};

  for (const line of frontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = stripYamlScalar(trimmed.slice(separator + 1).trim());
    if ((key === "name" || key === "description") && value) {
      result[key] = value;
    }
  }

  return result;
}

function stripYamlScalar(value: string): string {
  const withoutComment = value.replace(/\s+#.*$/, "").trim();
  if (
    (withoutComment.startsWith('"') && withoutComment.endsWith('"')) ||
    (withoutComment.startsWith("'") && withoutComment.endsWith("'"))
  ) {
    return withoutComment.slice(1, -1).trim();
  }
  return withoutComment.trim();
}

function humanizeId(id: string): string {
  return id.replace(/[-_]+/g, " ").trim() || id;
}
