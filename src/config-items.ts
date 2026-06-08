/**
 * Config item definitions for export/import.
 *
 * Each item knows how to collect its files from `~/.omp/agent/`
 * and how to write them back on restore.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";

export interface ConfigItem {
  id: string;
  label: string;
  description: string;
  /** Collect files for export. Key = relative path from `~/.omp/agent/`. */
  exportFiles(): Promise<Map<string, Uint8Array>>;
  /** Write files back from import. */
  importFiles(files: Map<string, Uint8Array>): Promise<void>;
  /** Estimated size for UI display. */
  estimateSize(): Promise<string>;
}

const AGENT = join(homedir(), ".omp", "agent");

async function* walkDir(dir: string, prefix: string): AsyncGenerator<[string, Uint8Array]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkDir(full, prefix + e.name + "/");
    } else if (e.isFile()) {
      const buf = await readFile(full);
      yield [prefix + e.name, new Uint8Array(buf)];
    }
  }
}

async function writeTree(base: string, files: Map<string, Uint8Array>): Promise<void> {
  const dirs = new Set<string>();
  for (const path of files.keys()) {
    const d = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (d) dirs.add(d);
  }
  for (const d of dirs) await mkdir(join(base, d), { recursive: true });
  for (const [path, content] of files) {
    await writeFile(join(base, path), content);
  }
}

async function formatFileSize(path: string): Promise<string> {
  try {
    const s = await stat(path);
    return formatBytes(s.size);
  } catch {
    return "未知";
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Item definitions ──────────────────────────────────────────────

export const CONFIG_ITEMS: ConfigItem[] = [
  {
    id: "config",
    label: "主配置 (config.yml)",
    description: "模型设置、状态栏布局、扩展路径等关键配置",
    async exportFiles() {
      const content = await readFile(join(AGENT, "config.yml"));
      return new Map([["config.yml", new Uint8Array(content)]]);
    },
    async importFiles(files) {
      const c = files.get("config.yml");
      if (c) await writeFile(join(AGENT, "config.yml"), c);
    },
    async estimateSize() {
      return formatFileSize(join(AGENT, "config.yml"));
    },
  },
  {
    id: "append_system",
    label: "系统提示 (APPEND_SYSTEM.md)",
    description: "追加到系统提示的自定义指令",
    async exportFiles() {
      const p = join(AGENT, "APPEND_SYSTEM.md");
      try {
        const content = await readFile(p);
        return new Map([["APPEND_SYSTEM.md", new Uint8Array(content)]]);
      } catch {
        return new Map(); // file may not exist yet
      }
    },
    async importFiles(files) {
      const c = files.get("APPEND_SYSTEM.md");
      if (c) await writeFile(join(AGENT, "APPEND_SYSTEM.md"), c);
    },
    async estimateSize() {
      return formatFileSize(join(AGENT, "APPEND_SYSTEM.md"));
    },
  },
  {
    id: "extensions",
    label: "扩展目录 (extensions/)",
    description: `所有已安装的 TypeScript 扩展`,
    async exportFiles() {
      const files = new Map<string, Uint8Array>();
      const dir = join(AGENT, "extensions");
      try {
        for await (const [path, content] of walkDir(dir, "extensions/")) {
          files.set(path, content);
        }
      } catch {
        // directory may not exist
      }
      return files;
    },
    async importFiles(files) {
      // Filter only files under extensions/
      const extFiles = new Map([...files].filter(([p]) => p.startsWith("extensions/")));
      if (extFiles.size > 0) {
        await writeTree(AGENT, extFiles);
      }
    },
    async estimateSize() {
      try {
        const dir = join(AGENT, "extensions");
        let total = 0;
        for await (const [, content] of walkDir(dir, "")) {
          total += content.length;
        }
        return formatBytes(total);
      } catch {
        return "0 B";
      }
    },
  },
  {
    id: "skills",
    label: "技能目录 (skills/)",
    description: "自定义 agent 技能，定义行为和工作流",
    async exportFiles() {
      const files = new Map<string, Uint8Array>();
      const dir = join(AGENT, "skills");
      try {
        for await (const [path, content] of walkDir(dir, "skills/")) {
          files.set(path, content);
        }
      } catch {
        // directory may not exist
      }
      return files;
    },
    async importFiles(files) {
      const skillFiles = new Map([...files].filter(([p]) => p.startsWith("skills/")));
      if (skillFiles.size > 0) {
        await writeTree(AGENT, skillFiles);
      }
    },
    async estimateSize() {
      try {
        const dir = join(AGENT, "skills");
        let total = 0;
        for await (const [, content] of walkDir(dir, "")) {
          total += content.length;
        }
        return formatBytes(total);
      } catch {
        return "0 B";
      }
    },
  },
  {
    id: "models_db",
    label: "模型数据库 (models.db)",
    description: "已配置的模型提供商和 API 端点",
    async exportFiles() {
      const content = await readFile(join(AGENT, "models.db"));
      return new Map([["models.db", new Uint8Array(content)]]);
    },
    async importFiles(files) {
      const c = files.get("models.db");
      if (c) await writeFile(join(AGENT, "models.db"), c);
    },
    async estimateSize() {
      return formatFileSize(join(AGENT, "models.db"));
    },
  },
  {
    id: "agent_db",
    label: "Agent 数据库 (agent.db)",
    description: "Agent 内部状态和持久化数据",
    async exportFiles() {
      const content = await readFile(join(AGENT, "agent.db"));
      return new Map([["agent.db", new Uint8Array(content)]]);
    },
    async importFiles(files) {
      const c = files.get("agent.db");
      if (c) await writeFile(join(AGENT, "agent.db"), c);
    },
    async estimateSize() {
      return formatFileSize(join(AGENT, "agent.db"));
    },
  },
];
