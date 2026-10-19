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
import {
  ADHD_SUMMARY_LANGUAGE_FOLLOW,
  getAdhdSummaryEnabled,
  getAdhdSummaryLanguage,
} from "./plugin-config";

/** Custom message type of the footer entry. */
export const SUMMARY_MESSAGE_TYPE = "adhd-summary";
/** Hard cap for the summarizer call on its own. */
export const SUMMARY_TIMEOUT_MS = 20_000;
export const SUMMARY_MAX_TOKENS = 512;
/**
 * Longest the footer waits for the session to go idle before giving up. The host
 * keeps the session busy after a settle while it generates the title, the recap
 * and the todo HUD, which measured >10s in practice and silently cost the footer;
 * 25s covers that housekeeping while still dropping a footer whose reply the user
 * has already moved past with a new prompt.
 */
export const SUMMARY_WAIT_TIMEOUT_MS = 25_000;
/** The extension handler's own budget: the idle wait and the model call fit inside it. */
const SUMMARY_HANDLER_BUDGET_MS = 45_000;
/** Poll interval used while waiting for idle. */
const WAIT_POLL_INTERVAL_MS = 25;
/** Fixed section headers: the footer's layout belongs to the extension, not the model. */
const CONCLUSION_HEADER = "【精要结论】";
const NEXT_HEADER = "【下一步】";
/** Caps enforced by `normalizeSummary` on top of the prompt's own wording. */
export const SUMMARY_CONCLUSION_MAX_ITEMS = 2;
export const SUMMARY_NEXT_MAX_ITEMS = 3;

const SYSTEM_PROMPT_LINES = [
  "You write the footer shown to the user right after an assistant reply.",
  "Write the item text in the SAME LANGUAGE as the reply you are summarizing; keep the two headers exactly as given.",
  "",
  "Output exactly these two blocks:",
  "",
  CONCLUSION_HEADER,
  "1. <one sentence: the conclusion of the reply, stated first, no build-up>",
  "2. <optional: the key fact that supports it; at most 2 items in this block>",
  "",
  NEXT_HEADER,
  "1. <the next action the user or the assistant should take>",
  "2. <optional further actions; at most 3 items in this block>",
  "",
  "Rules: one short line per item; no preamble, no closers, no praise, no code fences.",
  "Omit an optional item rather than padding it. Omit the whole 【下一步】 block only when there is genuinely nothing left to do.",
].join("\n");

/**
 * System prompt for one summarizer call.
 *
 * The footer's language is a setting, not a guess: the default is Chinese no
 * matter what language the reply is in, and only an explicit `follow` value
 * mirrors the reply. The two headers stay fixed — they are the extension's
 * layout, not the model's copy.
 *
 * A code (`zh`, `en-US`) is handed to the model as written: it resolves names
 * for codes it knows and an ISO code it does not is still an unambiguous
 * instruction. Anything else (`日本語`, `繁體中文`) passes through untouched.
 */
export function buildSummarySystemPrompt(language: string): string {
  const line =
    language === ADHD_SUMMARY_LANGUAGE_FOLLOW
      ? "Write the item text in the SAME LANGUAGE as the reply you are summarizing; keep the two headers exactly as given."
      : `Write the item text in ${language === "zh" ? "Simplified Chinese (简体中文)" : language}, regardless of the language of the reply; keep the two headers exactly as given.`;
  return SYSTEM_PROMPT_LINES.replace(/^Write the item text.*$/m, () => line);
}

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
  /** Footer language lookup. Defaults to the real `oh-my-pi-extends.json` reader. */
  getLanguage?: () => Promise<string>;
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

type Section = "conclusion" | "next";
const CONCLUSION_KEYS: Record<string, true> = {
  精要结论: true,
  结论: true,
  总结: true,
  摘要: true,
  小结: true,
  conclusion: true,
  summary: true,
  "tl;dr": true,
  tldr: true,
};
const NEXT_KEYS: Record<string, true> = {
  下一步: true,
  后续: true,
  后续步骤: true,
  待办: true,
  next: true,
  nextstep: true,
  nextsteps: true,
  todo: true,
  actions: true,
};

/** Section a header line opens, or undefined for a content line. */
function sectionOf(line: string): Section | undefined {
  const key = line
    .replace(/^[【[(#*>~\s]+/, "")
    .replace(/[】\])#*:：\s]+$/, "")
    .toLowerCase()
    .replace(/\s+/g, "");
  if (Object.hasOwn(CONCLUSION_KEYS, key)) return "conclusion";
  if (Object.hasOwn(NEXT_KEYS, key)) return "next";
  return undefined;
}

/**
 * Code-enforced format gate. The "two numbered blocks, conclusion first" layout
 * is the extension's; the model's markers, headers, ordering and padding are
 * not trusted.
 *
 * Drops code-fence lines, sorts items into the two sections, strips any bullet,
 * number or label prefix the model added, renumbers every item itself, caps the
 * sections at `SUMMARY_CONCLUSION_MAX_ITEMS` / `SUMMARY_NEXT_MAX_ITEMS`, and
 * returns `undefined` when there is no conclusion to show so the caller sends
 * nothing at all.
 */
export function normalizeSummary(raw: string): string | undefined {
  const conclusion: string[] = [];
  const next: string[] = [];
  const unlabeled: string[] = [];
  let current: Section | undefined;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("```")) continue;
    const section = sectionOf(line);
    if (section) {
      current = section;
      continue;
    }
    const text = line
      .replace(BULLET_PREFIX, "")
      .replace(NUMBER_PREFIX, "")
      .replace(LABEL_PREFIX, "")
      .trim();
    if (text.length === 0) continue;
    if (current === "conclusion") conclusion.push(text);
    else if (current === "next") next.push(text);
    else unlabeled.push(text);
  }

  // A model that ignored the headers still gets a usable footer: its first line
  // is the conclusion, the rest are next steps. A missing conclusion is filled
  // from the top of whatever it did send, so the first block is never empty.
  if (conclusion.length === 0) {
    const fallback = unlabeled.shift() ?? next.shift();
    if (fallback === undefined) return undefined;
    conclusion.push(fallback);
  }
  next.push(...unlabeled);

  const blocks = [
    [CONCLUSION_HEADER, ...conclusion.slice(0, SUMMARY_CONCLUSION_MAX_ITEMS)].join("\n"),
  ];
  if (next.length > 0) {
    blocks.push([NEXT_HEADER, ...next.slice(0, SUMMARY_NEXT_MAX_ITEMS)].join("\n"));
  }
  return blocks
    .map((block) =>
      block
        .split("\n")
        .map((line, index) => (index === 0 ? line : `${index}. ${line}`))
        .join("\n"),
    )
    .join("\n\n");
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
    const language = await (deps.getLanguage ?? getAdhdSummaryLanguage)();

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
        systemPrompt: [buildSummarySystemPrompt(language)],
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
