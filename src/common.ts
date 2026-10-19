/**
 * Shared helpers for config export/import.
 */
import { join, resolve } from "node:path";
import type { ConfigItem } from "./config-items";

function getHome(): string {
  return Bun.env.HOME || Bun.env.USERPROFILE || "";
}

export function getAgentDir(): string {
  return join(getHome(), ".omp", "agent");
}

export function ts(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function getOmpVersion(): Promise<string> {
  const dir = getAgentDir();
  // Both sources may carry a cosmetic leading "v"; drop it so "v15.10.4" and "15.10.4" compare equal.

  // Current OMP writes the last seen changelog version to a plain text marker file.
  try {
    const marker = (await Bun.file(join(dir, "last-changelog-version")).text())
      .trim()
      .replace(/^[vV]/, "");
    if (marker) return marker;
  } catch {
    // Missing or unreadable marker: fall through to the legacy config key.
  }

  // Legacy: older OMP versions stamped the version into config.yml.
  try {
    const raw = (await Bun.file(join(dir, "config.yml")).text())
      .match(/^lastChangelogVersion:\s*(.+)$/m)?.[1]
      ?.trim()
      .replace(/^[vV]/, "");
    return raw || "unknown";
  } catch {
    return "unknown";
  }
}

export function homeResolve(p: string): string {
  return resolve(p.replace(/^~(?=$|[\\/])/, getHome()));
}

export async function collectFiles(items: ConfigItem[]): Promise<Map<string, Uint8Array>> {
  const all = new Map<string, Uint8Array>();
  for (const item of items) {
    const files = await item.exportFiles();
    for (const [k, v] of files) all.set(k, v);
  }
  return all;
}
