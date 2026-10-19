/**
 * Config item definitions for export/import.
 *
 * Each item knows how to collect its files from `~/.omp/agent/`
 * and how to write them back on restore.
 *
 * Uses Bun native file APIs instead of node:fs.
 */
import { isAbsolute, join, resolve, sep } from "node:path";

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

/**
 * Resolve an archive key under `base` for writing, or null when it must be
 * skipped: absolute keys, drive/UNC prefixes, backslashes, any `..` segment,
 * and anything that still resolves outside `base`.
 */
export function safeTreePath(base: string, key: string): string | null {
  if (!key || isAbsolute(key) || /^[A-Za-z]:/.test(key) || key.includes("\\")) return null;
  if (key.split("/").includes("..")) return null;
  const root = resolve(base);
  const full = resolve(root, key);
  return full.startsWith(root + sep) ? full : null;
}

/** Write files under `base` directory. Bun.write auto-creates parent dirs. */
async function writeTree(base: string, files: Map<string, Uint8Array>): Promise<void> {
  for (const [key, content] of files) {
    const target = safeTreePath(base, key);
    if (!target) {
      console.warn(`oh-my-pi-extends: skipping unsafe archive path ${key}`);
      continue;
    }
    await Bun.write(target, content);
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

/** Single-file item: one archive key, stored at the same path under `~/.omp/agent/`. */
function fileItem(opts: {
  id: string;
  label: string;
  description: string;
  file: string;
  /** Missing file exports an empty map instead of propagating ENOENT. */
  tolerant?: boolean;
}): ConfigItem {
  return {
    id: opts.id,
    label: opts.label,
    description: opts.description,
    async exportFiles() {
      try {
        const content = await Bun.file(join(getAgent(), opts.file)).arrayBuffer();
        return new Map([[opts.file, new Uint8Array(content)]]);
      } catch (err) {
        if (!opts.tolerant) throw err;
        return new Map(); // file may not exist yet
      }
    },
    async importFiles(files) {
      const c = files.get(opts.file);
      if (c) await Bun.write(join(getAgent(), opts.file), c);
    },
    async estimateSize() {
      return formatFileSize(join(getAgent(), opts.file));
    },
  };
}

// ── Item definitions ──────────────────────────────────────────────

export const CONFIG_ITEMS: ConfigItem[] = [
  fileItem({
    id: "config",
    label: "主配置 (config.yml)",
    description: "模型设置、状态栏布局、扩展路径等关键配置",
    file: "config.yml",
  }),
  fileItem({
    id: "append_system",
    label: "系统提示 (APPEND_SYSTEM.md)",
    description: "追加到系统提示的自定义指令",
    file: "APPEND_SYSTEM.md",
    tolerant: true,
  }),
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
  fileItem({
    id: "models_db",
    label: "模型数据库 (models.db)",
    description: "已配置的模型提供商和 API 端点",
    file: "models.db",
  }),
  fileItem({
    id: "agent_db",
    label: "Agent 数据库 (agent.db)",
    description: "Agent 内部状态和持久化数据",
    file: "agent.db",
  }),
  fileItem({
    id: "last-changelog-version",
    label: "更新标记 (last-changelog-version)",
    description: "上次已读更新日志的版本号，用于判断是否提示新版本",
    file: "last-changelog-version",
    tolerant: true,
  }),
  fileItem({
    id: "mcp",
    label: "MCP 配置 (mcp.json)",
    description: "MCP 服务器定义与启动参数",
    file: "mcp.json",
    tolerant: true,
  }),
  fileItem({
    id: "skill_descriptions",
    label: "技能描述 (skill-descriptions.db)",
    description: "已生成技能描述的缓存数据库",
    file: "skill-descriptions.db",
    tolerant: true,
  }),
  {
    id: "managed_skills",
    label: "托管技能 (managed-skills/)",
    description: "OMP 自行下载安装的托管技能目录",
    async exportFiles() {
      const files = new Map<string, Uint8Array>();
      const dir = join(getAgent(), "managed-skills");
      try {
        for await (const [path, content] of walkDir(dir, "managed-skills/")) {
          files.set(path, content);
        }
      } catch {
        // directory may not exist
      }
      return files;
    },
    async importFiles(files) {
      const managedFiles = new Map([...files].filter(([p]) => p.startsWith("managed-skills/")));
      if (managedFiles.size > 0) {
        await writeTree(getAgent(), managedFiles);
      }
    },
    async estimateSize() {
      try {
        const dir = join(getAgent(), "managed-skills");
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
];
