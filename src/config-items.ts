/**
 * Config item definitions for export/import.
 *
 * Each item knows how to collect its files from `~/.omp/agent/`
 * and how to write them back on restore.
 *
 * Uses Bun native file APIs instead of node:fs.
 */
import { join } from "node:path";

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

function getAgent(): string {
  return join(Bun.env.HOME || Bun.env.USERPROFILE || "", ".omp", "agent");
}

/** Walk a directory tree using Bun.Glob, yielding relative paths under `prefix`. */
async function* walkDir(dir: string, prefix: string): AsyncGenerator<[string, Uint8Array]> {
  const glob = new Bun.Glob("**/*");
  for await (const raw of glob.scan({ cwd: dir })) {
    // Normalize to forward slashes for cross-platform archive keys
    const rel = raw.replace(/\\/g, "/");
    const full = join(dir, raw);
    const buf = await Bun.file(full).arrayBuffer();
    yield [prefix + rel, new Uint8Array(buf)];
  }
}

/** Write files under `base` directory. Bun.write auto-creates parent dirs. */
async function writeTree(base: string, files: Map<string, Uint8Array>): Promise<void> {
  for (const [path, content] of files) {
    await Bun.write(join(base, path), content);
  }
}

async function formatFileSize(path: string): Promise<string> {
  try {
    const f = Bun.file(path);
    return (await f.exists()) ? formatBytes(f.size) : "未知";
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
      const content = await Bun.file(join(getAgent(), "config.yml")).arrayBuffer();
      return new Map([["config.yml", new Uint8Array(content)]]);
    },
    async importFiles(files) {
      const c = files.get("config.yml");
      if (c) await Bun.write(join(getAgent(), "config.yml"), c);
    },
    async estimateSize() {
      return formatFileSize(join(getAgent(), "config.yml"));
    },
  },
  {
    id: "append_system",
    label: "系统提示 (APPEND_SYSTEM.md)",
    description: "追加到系统提示的自定义指令",
    async exportFiles() {
      const p = join(getAgent(), "APPEND_SYSTEM.md");
      try {
        const content = await Bun.file(p).arrayBuffer();
        return new Map([["APPEND_SYSTEM.md", new Uint8Array(content)]]);
      } catch {
        return new Map(); // file may not exist yet
      }
    },
    async importFiles(files) {
      const c = files.get("APPEND_SYSTEM.md");
      if (c) await Bun.write(join(getAgent(), "APPEND_SYSTEM.md"), c);
    },
    async estimateSize() {
      return formatFileSize(join(getAgent(), "APPEND_SYSTEM.md"));
    },
  },
  {
    id: "extensions",
    label: "扩展目录 (extensions/)",
    description: "所有已安装的 TypeScript 扩展",
    async exportFiles() {
      const files = new Map<string, Uint8Array>();
      const dir = join(getAgent(), "extensions");
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
      const extFiles = new Map([...files].filter(([p]) => p.startsWith("extensions/")));
      if (extFiles.size > 0) {
        await writeTree(getAgent(), extFiles);
      }
    },
    async estimateSize() {
      try {
        const dir = join(getAgent(), "extensions");
        let total = 0;
        const glob = new Bun.Glob("**/*");
        for await (const raw of glob.scan({ cwd: dir })) {
          const f = Bun.file(join(dir, raw));
          if (await f.exists()) total += f.size;
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
      const dir = join(getAgent(), "skills");
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
        await writeTree(getAgent(), skillFiles);
      }
    },
    async estimateSize() {
      try {
        const dir = join(getAgent(), "skills");
        let total = 0;
        const glob = new Bun.Glob("**/*");
        for await (const raw of glob.scan({ cwd: dir })) {
          const f = Bun.file(join(dir, raw));
          if (await f.exists()) total += f.size;
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
      const content = await Bun.file(join(getAgent(), "models.db")).arrayBuffer();
      return new Map([["models.db", new Uint8Array(content)]]);
    },
    async importFiles(files) {
      const c = files.get("models.db");
      if (c) await Bun.write(join(getAgent(), "models.db"), c);
    },
    async estimateSize() {
      return formatFileSize(join(getAgent(), "models.db"));
    },
  },
  {
    id: "agent_db",
    label: "Agent 数据库 (agent.db)",
    description: "Agent 内部状态和持久化数据",
    async exportFiles() {
      const content = await Bun.file(join(getAgent(), "agent.db")).arrayBuffer();
      return new Map([["agent.db", new Uint8Array(content)]]);
    },
    async importFiles(files) {
      const c = files.get("agent.db");
      if (c) await Bun.write(join(getAgent(), "agent.db"), c);
    },
    async estimateSize() {
      return formatFileSize(join(getAgent(), "agent.db"));
    },
  },
];
