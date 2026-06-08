/**
 * oh-my-pi-extends — Config export/import extension.
 *
 * Commands:
 *   /export-config   — export OMP configuration to a .tar.gz file
 *   /import-config   — restore from a previously exported .tar.gz file
 *
 * Built with zero external dependencies. Uses Bun native file APIs.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { join, resolve } from "node:path";
import { CONFIG_ITEMS, type ConfigItem } from "./config-items";
import { packTarGz, extractTarGz } from "./tar-utils";

const HOME = Bun.env.HOME || Bun.env.USERPROFILE || "";
const AGENT = join(HOME, ".omp", "agent");

// ── Helpers ───────────────────────────────────────────────────────

function ts(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function getOmpVersion(): Promise<string> {
  try {
    const raw = await Bun.file(join(AGENT, "config.yml")).text();
    const m = raw.match(/^lastChangelogVersion:\s*(.+)$/m);
    return m?.[1]?.trim() ?? "unknown";
  } catch {
    return "unknown";
  }
}

function homeResolve(p: string): string {
  return resolve(p.replace(/^~(?=$|[\\/])/, HOME));
}

async function collectFiles(items: ConfigItem[]): Promise<Map<string, Uint8Array>> {
  const all = new Map<string, Uint8Array>();
  for (const item of items) {
    const files = await item.exportFiles();
    for (const [k, v] of files) all.set(k, v);
  }
  return all;
}

// ── Platform helper ───────────────────────────────────────────────

function openFileInExplorer(path: string): void {
  const platform = process.platform;
  if (platform === "win32") {
    Bun.spawnSync(["explorer", "/select,", resolve(path)]);
  } else if (platform === "darwin") {
    Bun.spawnSync(["open", "-R", path]);
  } else {
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
    Bun.spawnSync(["xdg-open", dir]);
  }
}

// ── Extension entry ───────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerCommand("export-config", {
    description: "将 OMP 配置导出为 tar.gz 备份文件",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      try {
        await exportConfig(ctx);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pi.logger.error("export-config 失败: " + msg);
        ctx.ui.notify("导出失败: " + msg, "error");
      }
    },
  });

  pi.registerCommand("import-config", {
    description: "从 tar.gz 备份文件还原 OMP 配置",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      try {
        await importConfig(ctx);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pi.logger.error("import-config 失败: " + msg);
        ctx.ui.notify("还原失败: " + msg, "error");
      }
    },
  });
}

// ── Export logic ──────────────────────────────────────────────────

async function exportConfig(ctx: ExtensionCommandContext) {
  ctx.ui.notify("正在扫描配置项目...", "info");

  const infos = await Promise.all(
    CONFIG_ITEMS.map(async (item) => ({ item, size: await item.estimateSize() })),
  );

  let itemList = "可用配置项目：\n";
  for (const [i, info] of infos.entries()) {
    itemList += `  ${i + 1}. ${info.item.label} (${info.size})\n`;
  }
  ctx.ui.notify(itemList, "info");

  const exportAll = await ctx.ui.confirm(
    "导出配置",
    "是否导出所有项目？\n\n选择「否」可逐个选择。",
  );

  const selected = exportAll ? CONFIG_ITEMS : await pickItems(ctx, CONFIG_ITEMS);

  if (selected.length === 0) {
    ctx.ui.notify("未选择任何项目，导出已取消。", "warning");
    return;
  }

  const defaultPath = join(HOME, `omp-config-export-${ts()}.tar.gz`);
  const rawPath = await ctx.ui.input("保存路径（直接回车使用默认路径）", defaultPath);
  const target = homeResolve(rawPath || defaultPath);

  ctx.ui.setStatus("config-export", "正在收集文件...");
  const files = await collectFiles(selected);

  const manifest = JSON.stringify({
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    ompVersion: await getOmpVersion(),
    items: selected.map((i) => i.id),
  });
  files.set("manifest.json", new TextEncoder().encode(manifest));

  ctx.ui.setStatus("config-export", "正在压缩...");
  const archive = packTarGz(files);

  await Bun.write(target, archive);

  ctx.ui.setStatus("config-export", undefined);

  const fileCount = files.size - 1;
  const sizeKB = (archive.length / 1024).toFixed(1);
  ctx.ui.notify(
    `导出完成！\n文件: ${target}\n共 ${fileCount} 个文件 (${sizeKB} KB)`,
    "info",
  );

  const openLocation = await ctx.ui.confirm(
    "导出完成",
    `文件: ${target}\n共 ${fileCount} 个文件 (${sizeKB} KB)\n\n是否在文件管理器中打开所在位置？`,
  );
  if (openLocation) {
    openFileInExplorer(target);
  }
}

// ── Import logic ──────────────────────────────────────────────────

async function importConfig(ctx: ExtensionCommandContext) {
  const rawPath = await ctx.ui.input("备份文件路径", join(HOME, "omp-config-export-*.tar.gz"));
  if (!rawPath) {
    ctx.ui.notify("未指定文件，还原已取消。", "warning");
    return;
  }

  const src = homeResolve(rawPath);

  ctx.ui.setStatus("config-import", "正在读取备份文件...");
  let compressed: Uint8Array;
  try {
    compressed = new Uint8Array(await Bun.file(src).arrayBuffer());
  } catch {
    ctx.ui.setStatus("config-import", undefined);
    ctx.ui.notify("无法读取文件，请检查路径是否正确。", "error");
    return;
  }

  let archiveFiles: Map<string, Uint8Array>;
  try {
    archiveFiles = extractTarGz(compressed);
  } catch {
    ctx.ui.setStatus("config-import", undefined);
    ctx.ui.notify("文件格式无效：不是合法的 tar.gz 备份文件。", "error");
    return;
  }

  const manifestRaw = archiveFiles.get("manifest.json");
  if (!manifestRaw) {
    ctx.ui.setStatus("config-import", undefined);
    ctx.ui.notify("备份文件中缺少 manifest.json，文件可能已损坏。", "error");
    return;
  }

  let manifest: { formatVersion: number; ompVersion: string; items: string[] };
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestRaw));
  } catch {
    ctx.ui.setStatus("config-import", undefined);
    ctx.ui.notify("manifest.json 解析失败，备份文件可能已损坏。", "error");
    return;
  }

  if (manifest.formatVersion !== 1) {
    ctx.ui.setStatus("config-import", undefined);
    ctx.ui.notify(`不支持的备份格式版本 (v${manifest.formatVersion})，请更新此扩展。`, "error");
    return;
  }

  const currentVer = await getOmpVersion();
  if (manifest.ompVersion && manifest.ompVersion !== currentVer) {
    const ok = await ctx.ui.confirm(
      "版本不匹配",
      `导出时的 OMP 版本: ${manifest.ompVersion}\n当前 OMP 版本: ${currentVer}\n\n版本不同可能导致兼容性问题。是否继续？`,
    );
    if (!ok) {
      ctx.ui.notify("还原已取消。", "info");
      return;
    }
  }

  const available = CONFIG_ITEMS.filter((i) => manifest.items?.includes(i.id));
  if (available.length === 0) {
    ctx.ui.setStatus("config-import", undefined);
    ctx.ui.notify("备份文件中没有可还原的配置项目。", "warning");
    return;
  }

  const itemDesc = available.map((i) => `  • ${i.label}`).join("\n");
  ctx.ui.notify(`备份文件包含以下项目：\n${itemDesc}`, "info");

  const restoreAll = await ctx.ui.confirm(
    "还原配置",
    "是否还原所有项目？\n\n选择「否」可逐个选择。",
  );

  const selected = restoreAll ? available : await pickItems(ctx, available);

  if (selected.length === 0) {
    ctx.ui.notify("未选择任何项目，还原已取消。", "warning");
    return;
  }

  let backupPath: string | null = null;
  ctx.ui.setStatus("config-import", "正在备份现有配置...");
  try {
    const backupFiles = await collectFiles(selected);
    if (backupFiles.size > 0) {
      backupPath = join(HOME, `.omp-agent-backup-${ts()}.tar.gz`);
      await Bun.write(backupPath, packTarGz(backupFiles));
    }
  } catch {
    const cont = await ctx.ui.confirm(
      "备份失败",
      "无法备份当前配置。继续还原将覆盖现有文件。\n是否继续？",
    );
    if (!cont) {
      ctx.ui.notify("还原已取消。", "info");
      return;
    }
  }

  ctx.ui.setStatus("config-import", "正在还原...");
  let restored = 0;
  for (const item of selected) {
    await item.importFiles(archiveFiles);
    restored++;
  }

  ctx.ui.setStatus("config-import", undefined);

  const backupMsg = backupPath ? `\n备份文件已保存至: ${backupPath}` : "";
  ctx.ui.notify(
    `还原完成！已还原 ${restored}/${selected.length} 个项目。${backupMsg}\n\n🔄 请重启 OMP 以使配置生效（/quit 退出后重新启动）。`,
    "info",
  );
}

// ── Multi-select with checkbox ────────────────────────────────────

async function pickItems(ctx: ExtensionCommandContext, items: ConfigItem[]): Promise<ConfigItem[]> {
  if (items.length === 0) return [];

  const opts = items.map((item) => ({
    label: item.label,
    description: item.description,
  }));

  const doneLabel = "✅ 完成选择";
  const allOpts = [...opts, { label: doneLabel, description: "确认当前选择并继续" }];
  const markableCount = opts.length;
  const checked = new Set<number>();

  while (true) {
    const choice = await ctx.ui.select(
      "选择配置项目（↑↓ 导航  Enter 切换勾选）",
      allOpts,
      {
        selectionMarker: "checkbox",
        checkedIndices: [...checked],
        markableCount,
        helpText: "↑↓ 导航  Enter 切换勾选  选择「✅ 完成选择」确认  Esc 取消",
      },
    );

    if (!choice || choice === doneLabel) break;

    const idx = allOpts.findIndex((o) => o.label === choice);
    if (idx >= 0 && idx < markableCount) {
      if (checked.has(idx)) checked.delete(idx);
      else checked.add(idx);
    }
  }

  return items.filter((_, i) => checked.has(i));
}
