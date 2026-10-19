/**
 * oh-my-pi-extends — Extension entry point.
 *
 * Registers slash commands; actual logic lives in sibling modules.
 *
 * Commands:
 *   /export-config           — export OMP configuration to a .tar.gz file
 *   /import-config           — restore from a previously exported .tar.gz file
 *   /benchmark-token-speed   — test the current model's token output speed
 *   /adhd-summary            — toggle the ADHD-style summary footer (on / off / status)
 *
 * Hooks:
 *   agent_end                — append the ADHD summary footer for terminal main-agent settles
 *   session_start            — refresh the ADHD summary status entry
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { handleAgentEnd } from "./adhd-summary";
import { exportConfig } from "./export-config";
import { importConfig } from "./import-config";
import { runBenchmark, cancelBenchmark } from "./benchmark";
import { getAdhdSummaryEnabled, setAdhdSummaryEnabled } from "./plugin-config";

/** Status entry shown while the footer is off; cleared while it is on. */
const ADHD_SUMMARY_OFF_STATUS = "ADHD 摘要: 关";

/** Status entry mirrors the OFF state only, so it never lingers after `/adhd-summary on`. */
async function refreshAdhdSummaryStatus(ctx: Pick<ExtensionContext, "ui">): Promise<void> {
  const enabled = await getAdhdSummaryEnabled();
  ctx.ui.setStatus("adhd-summary", enabled ? undefined : ADHD_SUMMARY_OFF_STATUS);
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async (event, ctx) => {
    await handleAgentEnd(pi, event, ctx);
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      await refreshAdhdSummaryStatus(ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pi.logger.warn("adhd-summary 状态刷新失败: " + msg);
    }
  });

  pi.registerCommand("adhd-summary", {
    description: "开关 ADHD 风格摘要页脚（无参数切换，on / off / status）",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      try {
        const mode = args.trim().toLowerCase();
        let enabled: boolean;
        if (mode === "on" || mode === "off") {
          enabled = mode === "on";
          await setAdhdSummaryEnabled(enabled);
        } else if (mode === "") {
          enabled = !(await getAdhdSummaryEnabled());
          await setAdhdSummaryEnabled(enabled);
        } else if (mode === "status") {
          enabled = await getAdhdSummaryEnabled();
        } else {
          ctx.ui.notify("用法: /adhd-summary [on|off|status]", "warning");
          return;
        }
        ctx.ui.notify(`ADHD 摘要已${enabled ? "开启" : "关闭"}`);
        ctx.ui.setStatus("adhd-summary", enabled ? undefined : ADHD_SUMMARY_OFF_STATUS);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pi.logger.error("adhd-summary 失败: " + msg);
        ctx.ui.notify("ADHD 摘要设置失败: " + msg, "error");
      }
    },
  });
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
