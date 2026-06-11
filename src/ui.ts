/**
 * Shared UI helpers for commands that need multi-select.
 */
import type { ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import type { ConfigItem } from "./config-items";

/**
 * Multi-select with checkbox — pick a subset of items.
 */
export async function pickItems(
  ctx: ExtensionCommandContext,
  items: ConfigItem[],
): Promise<ConfigItem[]> {
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
    const choice = await ctx.ui.select("选择配置项目（↑↓ 导航  Enter 切换勾选）", allOpts, {
      selectionMarker: "checkbox",
      checkedIndices: [...checked],
      markableCount,
      helpText: "↑↓ 导航  Enter 切换勾选  选择「✅ 完成选择」确认  Esc 取消",
    });

    if (!choice || choice === doneLabel) break;

    const idx = allOpts.findIndex((o) => o.label === choice);
    if (idx >= 0 && idx < markableCount) {
      if (checked.has(idx)) checked.delete(idx);
      else checked.add(idx);
    }
  }

  return items.filter((_, i) => checked.has(i));
}
