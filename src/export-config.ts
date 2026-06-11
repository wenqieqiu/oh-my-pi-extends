/**
 * Config export logic — /export-config handler.
 */
import { join, resolve } from "node:path";
import type { ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { CONFIG_ITEMS } from "./config-items";
import { packTarGz } from "./tar-utils";
import { ts, homeResolve, getOmpVersion, collectFiles } from "./common";
import { pickItems } from "./ui";

const HOME = Bun.env.HOME || Bun.env.USERPROFILE || "";

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

export async function exportConfig(ctx: ExtensionCommandContext): Promise<void> {
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
  ctx.ui.notify(`导出完成！\n文件: ${target}\n共 ${fileCount} 个文件 (${sizeKB} KB)`, "info");

  const openLocation = await ctx.ui.confirm(
    "导出完成",
    `文件: ${target}\n共 ${fileCount} 个文件 (${sizeKB} KB)\n\n是否在文件管理器中打开所在位置？`,
  );
  if (openLocation) {
    openFileInExplorer(target);
  }
}
