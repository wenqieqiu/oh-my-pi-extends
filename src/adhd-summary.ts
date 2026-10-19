/**
 * ADHD-style summary footer.
 *
 * After a main-agent turn ends, one small model call turns the reply into at
 * most three short lines ("what to do next" first) and that text is injected as
 * its own visible session entry — no extra turn, no changes to the reply. Only
 * the terminal settle is summarized (one footer per turn, never one for a
 * scheduled continuation), and the line cap is enforced in code by
 * {@link normalizeSummary}, not just asked for in the prompt.
 *
 * Every failure (config, model, timeout, parse) is silent: a warning in the log
 * at most, never a thrown error and never a placeholder in the transcript.
 */
import { completeSimple } from "@oh-my-pi/pi-ai";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { getAdhdSummaryEnabled } from "./plugin-config";

/** Custom message type of the footer entry. */
export const SUMMARY_MESSAGE_TYPE = "adhd-summary";
/** Hard cap for the summarizer call on its own. */
export const SUMMARY_TIMEOUT_MS = 20_000;
export const SUMMARY_MAX_TOKENS = 512;
/** Longest the footer waits for the session to go idle before giving up. */
export const SUMMARY_WAIT_TIMEOUT_MS = 10_000;
/** The extension handler's own budget: the idle wait and the model call fit inside it. */
const SUMMARY_HANDLER_BUDGET_MS = 30_000;
/** Poll interval used while waiting for idle. */
const WAIT_POLL_INTERVAL_MS = 25;
/** Documented hard cap on footer lines; enforced by `normalizeSummary`. */
export const SUMMARY_MAX_LINES = 3;

const SYSTEM_PROMPT_LINES = [
  "You write the short ADHD-style footer shown to the user right after an assistant reply.",
  "",
  "Output at most 3 short lines, in the SAME LANGUAGE as the reply you are summarizing:",
  "1. the next action the user (or the assistant, if it continues) should take;",
  "2. one line on what just happened;",
  "3. the open item, blocker, or a time estimate.",
  "",
  "Omit any line with nothing to say. No preamble, no closers, no praise, no headings, no bullet markers, no code fences. Output only those lines.",
].join("\n");

/** Passed as `Context.systemPrompt`, which is an array of blocks. */
const SYSTEM_PROMPT = [SYSTEM_PROMPT_LINES];

/** Minimal shape of the transcript messages the footer reads. */
export interface SummaryMessageLike {
  role?: unknown;
  stopReason?: unknown;
  content?: unknown;
}

/** Model call used by the footer; injectable so tests never hit a provider. */
export type SummaryCompleter = (
  model: Model,
  context: Context,
  options: SimpleStreamOptions,
) => Promise<AssistantMessage>;

export interface AdhdSummaryDeps {
  /** Config lookup. Defaults to the real `oh-my-pi-extends.json` reader. */
  isEnabled?: () => Promise<boolean>;
  /** Summarizer model call. Defaults to `completeSimple`. */
  complete?: SummaryCompleter;
  /** Idle-wait cap. Defaults to `SUMMARY_WAIT_TIMEOUT_MS`; tests shrink it. */
  waitTimeoutMs?: number;
  /** Idle-wait poll interval. Defaults to `WAIT_POLL_INTERVAL_MS`; tests shrink it. */
  pollIntervalMs?: number;
}

function isTextPart(part: unknown): part is { text: string } {
  if (typeof part !== "object" || part === null) return false;
  if (!("type" in part) || !("text" in part)) return false;
  return part.type === "text" && typeof part.text === "string";
}

/** Join an assistant message's text blocks, ignoring reasoning/thinking parts. */
export function extractResponseText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(isTextPart)
    .map((part) => part.text)
    .join("")
    .trim();
}

/** Text of the last finalized assistant message, when it holds something worth summarizing. */
export function findSummarySource(messages: readonly SummaryMessageLike[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") continue;
    if (message.stopReason === "error" || message.stopReason === "aborted") return undefined;
    const text = extractResponseText(message.content);
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

/** Bullet markers the model likes to add back despite the prompt; a bare marker alone counts. */
const BULLET_PREFIX = /^[-*+•·](?:\s+|$)/;
/** Ordered-list markers, `1.` and `1)`, marker alone included. */
const NUMBER_PREFIX = /^\d+[.)](?:\s+|$)/;
/**
 * Label-like prefixes, up to three words: `Next step: `, `Open question: `,
 * `下一步：`. The label may not contain `/` and an ASCII colon needs a following
 * space, so URL schemes (`https://…`) and prose colons survive.
 */
const LABEL_PREFIX = /^[^\s:：/]+(?:\s+[^\s:：/]+){0,2}(?::\s+|：\s*)/;

/**
 * Code-enforced format gate. The "at most 3 lines, no preamble" promise used to
 * live only in the system prompt; this makes it true of what gets sent.
 *
 * Drops code-fence lines, bullet/number markers and label-like prefixes, trims,
 * keeps at most `SUMMARY_MAX_LINES` non-empty lines, and returns `undefined`
 * when nothing survives so the caller sends nothing at all.
 */
export function normalizeSummary(raw: string): string | undefined {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("```"))
    .map((line) =>
      line.replace(BULLET_PREFIX, "").replace(NUMBER_PREFIX, "").replace(LABEL_PREFIX, "").trim(),
    )
    .filter((line) => line.length > 0)
    .slice(0, SUMMARY_MAX_LINES);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/**
 * Wait for the session to stop streaming.
 *
 * `false` when it neither went idle before `timeoutMs` nor stayed current: a
 * queued message (steer/follow-up) means this reply is no longer the one the
 * footer belongs to.
 */
async function waitForIdle(
  ctx: ExtensionContext,
  timeoutMs: number,
  intervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (ctx.hasPendingMessages()) return false;
    if (ctx.isIdle()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * `agent_end` handler: summarize the finished reply and append the footer.
 *
 * `agent_end` fires for every settle and is dispatched before the session goes
 * idle, so only a terminal settle is summarized and the footer waits for idle
 * first — otherwise the injected message is steered into the still running turn
 * and triggers a bonus model turn.
 */
export async function handleAgentEnd(
  pi: Pick<ExtensionAPI, "sendMessage" | "logger">,
  event: {
    messages: readonly SummaryMessageLike[];
    willContinue?: boolean;
    awaitingAsyncWork?: boolean;
  },
  ctx: ExtensionContext,
  deps: AdhdSummaryDeps = {},
): Promise<void> {
  const startedAt = Date.now();
  try {
    // Terminal settle only: `willContinue` marks a scheduled continuation
    // (rewind, plan mode, todo reminder, queued steer) or a settle background
    // work may resume, and the continuation's own terminal `agent_end` still
    // emits the one footer. Same gate as the host's extension-facing consumer
    // (`modes/warp-events.ts:222`: `if (event.willContinue) return;`), which is
    // the extension-side form of the session-event check
    // `event.isTerminal !== false` (`modes/rpc/rpc-session-settle.ts:85`).
    if (event.willContinue === true || event.awaitingAsyncWork === true) return;

    const isEnabled = deps.isEnabled ?? getAdhdSummaryEnabled;
    if (!(await isEnabled())) return;
    if (ctx.agent?.kind !== "main") return;
    // Print and RPC sessions have no UI (`ExtensionContext.hasUI` is false there):
    // nobody would see the footer, and the process usually exits before the
    // summarizer call returns, so skip it instead of burning a model call.
    if (!ctx.hasUI) return;
    if (!ctx.model) return;

    const source = findSummarySource(event.messages);
    if (!source) return;

    const model = ctx.model;
    const complete = deps.complete ?? completeSimple;

    const idle = await waitForIdle(
      ctx,
      deps.waitTimeoutMs ?? SUMMARY_WAIT_TIMEOUT_MS,
      deps.pollIntervalMs ?? WAIT_POLL_INTERVAL_MS,
    );
    if (!idle) return;

    const remainingMs = SUMMARY_HANDLER_BUDGET_MS - (Date.now() - startedAt);
    if (remainingMs <= 0) return;

    const response = await complete(
      model,
      {
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: "user", content: source, timestamp: Date.now() }],
      },
      {
        apiKey: ctx.modelRegistry.resolver(model, ctx.sessionManager.getSessionId()),
        disableReasoning: true,
        maxTokens: SUMMARY_MAX_TOKENS,
        signal: AbortSignal.timeout(Math.min(SUMMARY_TIMEOUT_MS, remainingMs)),
      },
    );
    if (response.stopReason === "error" || response.stopReason === "aborted") return;

    // The model call takes seconds: if the session started streaming again or a
    // message got queued meanwhile, this reply is superseded and the footer
    // would land on the wrong turn — drop it silently.
    if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

    const text = normalizeSummary(extractResponseText(response.content));
    if (!text) return;

    pi.sendMessage(
      {
        customType: SUMMARY_MESSAGE_TYPE,
        content: [{ type: "text", text }],
        display: true,
      },
      { triggerTurn: false },
    );
  } catch (err) {
    pi.logger.warn(
      "oh-my-pi-extends: adhd summary skipped: " +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}
