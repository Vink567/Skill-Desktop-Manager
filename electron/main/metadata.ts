import fs from "node:fs/promises";
import path from "node:path";
import type { ManagedCopyMetadata, ManagedCopySnapshot, ManagerMetadata } from "./types";

export const HUB_METADATA_FILE = ".skill-desktop-manager.json";
export const COPY_METADATA_FILE = ".skill-desktop-manager-source.json";

export async function readHubMetadata(skillDir: string): Promise<Partial<ManagerMetadata>> {
  try {
    const raw = await fs.readFile(path.join(skillDir, HUB_METADATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<ManagerMetadata>;
    return parsed.app === "skill-desktop-manager" ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeHubMetadata(
  skillDir: string,
  metadata: Omit<ManagerMetadata, "app" | "installedAt"> & { installedAt?: string }
): Promise<void> {
  const content: ManagerMetadata = {
    app: "skill-desktop-manager",
    installedAt: metadata.installedAt || new Date().toISOString(),
    ...metadata
  };
  await fs.writeFile(path.join(skillDir, HUB_METADATA_FILE), `${JSON.stringify(content, null, 2)}\n`, "utf8");
}

export async function readCopyMetadata(targetDir: string): Promise<ManagedCopyMetadata | undefined> {
  try {
    const raw = await fs.readFile(path.join(targetDir, COPY_METADATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as ManagedCopyMetadata;
    return parsed.app === "skill-desktop-manager" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function writeCopyMetadata(
  targetDir: string,
  skillId: string,
  sourcePath: string,
  baseline?: ManagedCopySnapshot
): Promise<void> {
  const metadata: ManagedCopyMetadata = {
    app: "skill-desktop-manager",
    skillId,
    sourcePath,
    copiedAt: new Date().toISOString(),
    baseline
  };
  await fs.writeFile(path.join(targetDir, COPY_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}
