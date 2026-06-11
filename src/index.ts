/**
 * oh-my-pi-extends — Extension entry point.
 *
 * Registers slash commands; actual logic lives in sibling modules.
 *
 * Commands:
 *   /export-config           — export OMP configuration to a .tar.gz file
 *   /import-config           — restore from a previously exported .tar.gz file
 *   /benchmark-token-speed   — test the current model's token output speed
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { exportConfig } from "./export-config";
import { importConfig } from "./import-config";
import { runBenchmark, cancelBenchmark } from "./benchmark";

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

  pi.registerCommand("benchmark-token-speed", {
    description: "测试当前模型 token 输出速度（TTFT + TPS）",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      try {
        await runBenchmark(pi, ctx);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pi.logger.error("benchmark-token-speed 失败: " + msg);
        ctx.ui.notify("基准测试失败: " + msg, "error");
      }
    },
  });

  pi.registerShortcut("ctrl+shift+e", {
    description: "中止正在运行的基准测试",
    handler: () => {
      cancelBenchmark();
    },
  });
}
