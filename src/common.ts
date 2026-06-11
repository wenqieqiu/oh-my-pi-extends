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
  try {
    const raw = await Bun.file(join(getAgentDir(), "config.yml")).text();
    const m = raw.match(/^lastChangelogVersion:\s*(.+)$/m);
    return m?.[1]?.trim() ?? "unknown";
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
