/**
 * Config import logic — /import-config handler.
 */
import { join } from "node:path";
import type { ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { CONFIG_ITEMS } from "./config-items";
import { packTarGz, extractTarGz } from "./tar-utils";
import { ts, homeResolve, getOmpVersion, collectFiles } from "./common";
import { pickItems } from "./ui";

const HOME = Bun.env.HOME || Bun.env.USERPROFILE || "";

export async function importConfig(ctx: ExtensionCommandContext): Promise<void> {
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
