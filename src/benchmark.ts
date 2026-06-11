/**
 * Benchmark — Model token output speed testing.
 *
 * Measures TTFT (time-to-first-token) and TPS (tokens/sec) using OMP's built-in
 * streamSimple API, which handles all provider wire formats transparently.
 * Runs 3 realistic scenarios × 3 iterations each, reports averages.
 */
import { streamSimple } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import type { Model } from "@oh-my-pi/pi-ai";
let currentBenchmarkAbort: AbortController | null = null;

/** Abort the currently running benchmark (if any). */
export function cancelBenchmark(): void {
  currentBenchmarkAbort?.abort();
}

// ── Types ─────────────────────────────────────────────────────────

export interface BenchmarkRun {
  /** Time-to-first-token in milliseconds */
  ttft: number;
  /** Total output tokens from API response */
  outputTokens: number;
  /** Output tokens per second (total / output_duration) */
  tps: number;
  /** Total wall-clock duration in milliseconds (request → last token) */
  duration: number;
  /** Error message if this run failed */
  error?: string;
}

export interface ScenarioResult {
  label: string;
  runs: BenchmarkRun[];
  avgTtft: number;
  avgTps: number;
  validRuns: number;
}

export interface BenchmarkResult {
  modelId: string;
  modelName: string;
  scenarios: ScenarioResult[];
  timestamp: string;
  overallAvgTps: number;
  overallAvgTtft: number;
}

// ── Scenarios ─────────────────────────────────────────────────────

interface Scenario {
  label: string;
  prompt: string;
}

const SCENARIOS: Scenario[] = [
  {
    label: "代码生成",
    prompt: `请用 TypeScript 实现一个轻量级的 EventEmitter 类，支持 on、off、emit、once 方法和泛型类型支持。包含完整的类型定义和注释。直接输出代码即可。`,
  },
  {
    label: "文本总结",
    prompt: `请按时间线总结人工智能在过去十年中的主要技术突破，包括深度学习、大语言模型、多模态模型等领域的发展。指出每个突破的关键技术贡献者。全文不少于 500 字。`,
  },
  {
    label: "逻辑规划",
    prompt: `某电商平台需要设计订单系统的库存扣减方案，要求：
1. 支持高并发（每秒 10000 单）
2. 防止超卖
3. 支持批量扣减
4. 支持库存回滚

请分析不同方案的优劣，给出推荐方案及实现要点。`,
  },
];

// ── Run single measurement ────────────────────────────────────────

export class BenchmarkCancelledError extends Error {
  constructor() {
    super("Benchmark cancelled by user");
    this.name = "BenchmarkCancelledError";
  }
}

async function measureOnce(
  model: Model,
  apiKey: string,
  prompt: string,
  timeoutMs: number,
  cancelSignal?: AbortSignal,
): Promise<BenchmarkRun> {
  const startTime = performance.now();
  let firstTokenTimestamp = 0;
  let text = "";
  let outputTokens = 0;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // ── Wire up cancellation ────────────────────────────────────────
  // Both mechanisms fire when cancelSignal aborts:
  //   1. Abort the local controller so streamSimple's provider sees it
  //   2. Reject a cancellation promise so Promise.race can break out
  //      even when the stream blocks on a non-responsive read.
  const { promise: cancelPromise, reject: cancelReject } = Promise.withResolvers<never>();

  if (cancelSignal) {
    if (cancelSignal.aborted) {
      controller.abort();
      cancelReject(new BenchmarkCancelledError());
    } else {
      cancelSignal.addEventListener(
        "abort",
        () => {
          controller.abort();
          cancelReject(new BenchmarkCancelledError());
        },
        { once: true },
      );
    }
  }

  try {
    const stream = streamSimple(
      model,
      { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
      { signal: controller.signal, apiKey },
    );

    // ── Process stream events ─────────────────────────────────────
    // Extracted into an inner function so we can race it against the
    // cancellation promise below. This guarantees that cancellation is
    // detected promptly even when the for-await loop blocks on a stream
    // that never yields another event.
    const processEvents = async (): Promise<void> => {
      for await (const event of stream) {
        // Explicit cancellation check — the underlying EventStream may buffer
        // events and keep iterating even after the abort signal fires. Without
        // this check, a full buffer of pre-fetched events can delay or prevent
        // cancellation from taking effect.
        if (cancelSignal?.aborted) {
          throw new BenchmarkCancelledError();
        }
        if (event.type === "text_delta" || event.type === "thinking_delta") {
          if (!firstTokenTimestamp) firstTokenTimestamp = performance.now();
          text += event.delta;
        }
        if ("partial" in event && event.partial?.usage?.output) {
          outputTokens = event.partial.usage.output;
        }
        if (event.type === "done" && event.message?.usage?.output) {
          outputTokens = event.message.usage.output;
        }
      }
    };

    if (cancelSignal) {
      // Suppress the loser's rejection — it's from a stream that was already
      // aborted; the winner determines the outcome.
      const processing = processEvents();
      processing.catch(() => {});
      await Promise.race([processing, cancelPromise]);
    } else {
      await processEvents();
    }
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : String(err);
    if (cancelSignal?.aborted) {
      throw new BenchmarkCancelledError();
    }
    const isAbort =
      err instanceof Error && (err.name === "AbortError" || msg.toLowerCase().includes("abort"));
    if (isAbort) {
      return {
        ttft: 0,
        outputTokens: 0,
        tps: 0,
        duration: 0,
        error: `⏱ 超时（超过 ${(timeoutMs / 1000).toFixed(0)} 秒）`,
      };
    }
    return { ttft: 0, outputTokens: 0, tps: 0, duration: 0, error: msg };
  } finally {
    clearTimeout(timeout);
  }

  const endTime = performance.now();
  const totalDuration = endTime - startTime;

  // Fallback token estimate when provider doesn't report usage
  if (outputTokens === 0 && text.length > 0) {
    outputTokens = Math.ceil(text.length / 2);
  }

  const ttft = firstTokenTimestamp > 0 ? firstTokenTimestamp - startTime : totalDuration;
  const outputDuration = firstTokenTimestamp > 0 ? endTime - firstTokenTimestamp : totalDuration;
  const tps = outputDuration > 0 && outputTokens > 0 ? (outputTokens / outputDuration) * 1000 : 0;

  return { ttft, outputTokens, tps, duration: totalDuration };
}

// ── Master benchmark runner ───────────────────────────────────────

export async function runBenchmark(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const model = ctx.model;
  if (!model) {
    ctx.ui.notify("未检测到模型，请先配置模型后再运行基准测试。", "error");
    return;
  }

  const apiKey = (await ctx.modelRegistry.getApiKey(model)) ?? "";
  if (!apiKey && model.api !== "google-generative-ai") {
    ctx.ui.notify("无法获取模型的 API 密钥，基准测试无法进行。", "error");
    return;
  }

  // ── Set up cancellation ─────────────────────────────────────────
  // Two channels for cancellation, both calling cancelBenchmark():
  //   1. Keyboard shortcut (ctrl+shift+e via registerShortcut in index.ts)
  //   2. Raw terminal input listener (via ctx.ui.onTerminalInput)
  //
  // Channel 2 is the primary mechanism: it intercepts ALL terminal input
  // BEFORE focus-based routing, so Escape/Ctrl+Shift+E work even when the
  // editor component doesn't have TUI focus (e.g. while viewing progress).
  currentBenchmarkAbort = new AbortController();
  const cancelSignal = currentBenchmarkAbort.signal;
  let cancelled = false;

  const unregisterInput = ctx.ui.onTerminalInput((data) => {
    // Escape key sends a bare \x1b byte — the universal "cancel/interrupt"
    // key that works on every terminal without depending on key-protocol
    // support. The strict equality check ensures we only match a standalone
    // Escape press, not multi-byte escape sequences (arrow keys, etc.).
    if (data === "\x1b") {
      cancelBenchmark();
    }
    // Don't consume the event — let the platform also process it for
    // its own interrupt/cancel mechanism.
    return undefined;
  });

  const result: BenchmarkResult = {
    modelId: `${model.provider}/${model.id}`,
    modelName: model.name,
    scenarios: [],
    timestamp: new Date().toISOString(),
    overallAvgTps: 0,
    overallAvgTtft: 0,
  };

  let totalValidRuns = 0;
  let totalTps = 0;
  let totalTtft = 0;

  try {
    pi.sendMessage(
      {
        customType: "benchmark_progress",
        content: [
          {
            type: "text" as const,
            text: `⚡ 开始模型速度测试\n**模型**: ${result.modelName} (\`${result.modelId}\`)\n**场景**: ${SCENARIOS.length} 个，各测试 1 次\n\n按 Escape 或 Ctrl+Shift+E 可中止测试`,
          },
        ],
        display: true,
      },
      { deliverAs: "followUp" },
    );

    for (let s = 0; s < SCENARIOS.length; s++) {
      if (cancelSignal.aborted) {
        cancelled = true;
        break;
      }
      const scenario = SCENARIOS[s];
      pi.sendMessage(
        {
          customType: "benchmark_progress",
          content: [
            {
              type: "text" as const,
              text: `🔄 场景 ${s + 1}/${SCENARIOS.length}: ${scenario.label}`,
            },
          ],
          display: true,
        },
        { deliverAs: "followUp" },
      );

      const runs: BenchmarkRun[] = [];
      if (cancelSignal.aborted) {
        cancelled = true;
        break;
      }
      const run = await measureOnce(model, apiKey, scenario.prompt, 300_000, cancelSignal);
      runs.push(run);
      if (!run.error) {
        pi.sendMessage(
          {
            customType: "benchmark_progress",
            content: [
              {
                type: "text" as const,
                text: `  ✅ TTFT=${run.ttft.toFixed(0)}ms, TPS=${run.tps.toFixed(1)}, tokens=${run.outputTokens}`,
              },
            ],
            display: true,
          },
          { deliverAs: "followUp" },
        );
      } else {
        pi.sendMessage(
          {
            customType: "benchmark_progress",
            content: [{ type: "text" as const, text: `  ❌ ${run.error}` }],
            display: true,
          },
          { deliverAs: "followUp" },
        );
      }

      if (cancelSignal.aborted) {
        cancelled = true;
        break;
      }

      const valid = runs.filter((r) => !r.error);
      const avgTtft = valid.length > 0 ? valid.reduce((a, r) => a + r.ttft, 0) / valid.length : 0;
      const avgTps = valid.length > 0 ? valid.reduce((a, r) => a + r.tps, 0) / valid.length : 0;

      totalValidRuns += valid.length;
      totalTps += avgTps * valid.length;
      totalTtft += avgTtft * valid.length;

      result.scenarios.push({
        label: scenario.label,
        runs,
        avgTtft,
        avgTps,
        validRuns: valid.length,
      });
    }
  } catch (err) {
    if (err instanceof BenchmarkCancelledError) {
      cancelled = true;
    } else {
      throw err;
    }
  } finally {
    unregisterInput();
    currentBenchmarkAbort = null;
  }

  if (cancelled) {
    pi.sendMessage(
      {
        customType: "benchmark_progress",
        content: [{ type: "text" as const, text: "⏹ 测试已中止" }],
        display: true,
      },
      { deliverAs: "followUp" },
    );
    return;
  }

  result.overallAvgTps = totalValidRuns > 0 ? totalTps / totalValidRuns : 0;
  result.overallAvgTtft = totalValidRuns > 0 ? totalTtft / totalValidRuns : 0;

  // ── Build report message ──────────────────────────────────────
  const lines: string[] = [];
  lines.push(`## ⚡ 模型速度测试报告`);
  lines.push(``);
  lines.push(`**模型**: ${result.modelName} (\`${result.modelId}\`)`);
  lines.push(`**时间**: ${result.timestamp}`);
  lines.push(``);
  lines.push(`| 场景 | TTFT (ms) | TPS (tok/s) |`);
  lines.push(`|------|-----------|-------------|`);
  for (const sc of result.scenarios) {
    const ttftStr = sc.avgTtft > 0 ? sc.avgTtft.toFixed(0) : "N/A";
    const tpsStr = sc.avgTps > 0 ? sc.avgTps.toFixed(1) : "N/A";
    lines.push(`| ${sc.label} | ${ttftStr} | ${tpsStr} |`);
  }

  lines.push(``);
  lines.push(
    `**综合平均**: TTFT=${result.overallAvgTtft.toFixed(0)}ms, TPS=${result.overallAvgTps.toFixed(1)} tok/s`,
  );
  lines.push(``);
  // Per-scenario details
  lines.push(`### 详细数据`);
  for (const sc of result.scenarios) {
    lines.push(``);
    const r = sc.runs[0];
    if (r.error) {
      lines.push(`**${sc.label}**: ❌ ${r.error}`);
    } else {
      lines.push(
        `**${sc.label}**: TTFT=${r.ttft.toFixed(0)}ms, TPS=${r.tps.toFixed(1)}, ${r.outputTokens} tokens, ${r.duration.toFixed(0)}ms`,
      );
    }
  }

  // Send the final report into session history
  pi.sendMessage(
    {
      customType: "benchmark_result",
      content: [{ type: "text" as const, text: lines.join("\n") }],
      display: true,
      details: result,
    },
    { deliverAs: "followUp" },
  );
}
