/**
 * Tests for the ADHD summary footer: pure helpers plus the `agent_end` hook
 * driven with fake `pi`/`ctx`/model-call dependencies.
 */
import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import {
  SUMMARY_MESSAGE_TYPE,
  SUMMARY_TIMEOUT_MS,
  SUMMARY_WAIT_TIMEOUT_MS,
  extractResponseText,
  findSummarySource,
  handleAgentEnd,
  normalizeSummary,
  type SummaryCompleter,
  type SummaryMessageLike,
} from "../src/adhd-summary";

type HookPi = Pick<ExtensionAPI, "sendMessage" | "logger">;

function assistantMessage(content: unknown[], stopReason = "stop"): SummaryMessageLike {
  return { role: "assistant", stopReason, content };
}

function makeAssistantResponse(text: string): AssistantMessage {
  return { content: [{ type: "text", text }], stopReason: "stop" } as unknown as AssistantMessage;
}

interface Call {
  customType?: string;
  display?: boolean;
  content?: unknown;
}

function makeHarness(
  overrides: {
    isIdle?: () => boolean;
    hasPendingMessages?: () => boolean;
    hasUI?: boolean;
  } = {},
) {
  const calls: Array<{ message: Call; options: unknown }> = [];
  const pi = {
    sendMessage: (message: Call, options: unknown) => {
      calls.push({ message, options });
    },
    logger: { warn: () => {} },
  } as unknown as HookPi;
  const ctx = {
    agent: { kind: "main" },
    model: { provider: "test", id: "test-model" } as unknown as Model,
    modelRegistry: { resolver: () => () => "test-key" },
    sessionManager: { getSessionId: () => "session-1" },
    isIdle: () => (overrides.isIdle ? overrides.isIdle() : true),
    hasPendingMessages: () =>
      overrides.hasPendingMessages ? overrides.hasPendingMessages() : false,
    hasUI: overrides.hasUI ?? true,
  } as unknown as ExtensionContext;
  return { pi, ctx, calls };
}

describe("extractResponseText", () => {
  test("keeps text parts, drops reasoning/thinking parts, joins and trims", () => {
    expect(
      extractResponseText([
        { type: "thinking", text: "let me think" },
        { type: "reasoning", text: "more thoughts" },
        { type: "text", text: "Next: run the tests." },
        { type: "text", text: " Then commit." },
      ]),
    ).toBe("Next: run the tests. Then commit.");
  });

  test("returns empty string when there is no text part", () => {
    expect(extractResponseText([{ type: "thinking", text: "hmm" }])).toBe("");
    expect(extractResponseText([])).toBe("");
    expect(extractResponseText(undefined)).toBe("");
  });
});

describe("findSummarySource", () => {
  test("uses the last assistant message's text", () => {
    const messages: SummaryMessageLike[] = [
      assistantMessage([{ type: "text", text: "first" }]),
      { role: "user", content: "thanks" },
      assistantMessage([
        { type: "thinking", text: "..." },
        { type: "text", text: "second" },
      ]),
    ];
    expect(findSummarySource(messages)).toBe("second");
  });

  test("ignores tool-call-only and blank assistant messages", () => {
    expect(
      findSummarySource([assistantMessage([{ type: "toolCall", name: "edit" }])]),
    ).toBeUndefined();
    expect(findSummarySource([assistantMessage([{ type: "text", text: "   " }])])).toBeUndefined();
    expect(findSummarySource([])).toBeUndefined();
  });

  test("skips failed or aborted assistant messages", () => {
    expect(
      findSummarySource([assistantMessage([{ type: "text", text: "boom" }], "error")]),
    ).toBeUndefined();
    expect(
      findSummarySource([assistantMessage([{ type: "text", text: "stopped" }], "aborted")]),
    ).toBeUndefined();
  });
});

describe("handleAgentEnd", () => {
  test("sends one visible non-turning message on the happy path", async () => {
    const { pi, ctx, calls } = makeHarness();
    let seenContext: Context | undefined;
    let seenOptions: SimpleStreamOptions | undefined;
    const complete: SummaryCompleter = async (_model, context, options) => {
      seenContext = context;
      seenOptions = options;
      return makeAssistantResponse("Do X next.");
    };

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      { isEnabled: async () => true, complete },
    );

    expect(calls.length).toBe(1);
    expect(calls[0].message.customType).toBe(SUMMARY_MESSAGE_TYPE);
    expect(calls[0].message.display).toBe(true);
    expect(calls[0].message.content).toEqual([{ type: "text", text: "Do X next." }]);
    expect(calls[0].options).toEqual({ triggerTurn: false });

    // systemPrompt is passed as an array, the summarized reply as the user message.
    const systemPrompt = seenContext?.systemPrompt ?? [];
    expect(Array.isArray(seenContext?.systemPrompt)).toBe(true);
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(systemPrompt[0]).toContain("ADHD");
    expect(seenContext?.messages[0].content).toBe("Did Y.");
    expect(seenOptions?.disableReasoning).toBe(true);
    expect(seenOptions?.maxTokens).toBe(512);
  });

  test("does nothing when the feature is disabled", async () => {
    const { pi, ctx, calls } = makeHarness();
    let called = false;
    const complete: SummaryCompleter = async () => {
      called = true;
      return makeAssistantResponse("nope");
    };

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => false,
        complete,
      },
    );

    expect(calls.length).toBe(0);
    expect(called).toBe(false);
  });

  test("does nothing for a subagent session", async () => {
    const { pi, ctx, calls } = makeHarness();
    ctx.agent = { kind: "sub" } as unknown as ExtensionContext["agent"];

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => true,
        complete: async () => makeAssistantResponse("nope"),
      },
    );

    expect(calls.length).toBe(0);
  });

  test("does nothing without a model", async () => {
    const { pi, ctx, calls } = makeHarness();
    ctx.model = undefined;

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => true,
        complete: async () => makeAssistantResponse("nope"),
      },
    );

    expect(calls.length).toBe(0);
  });

  test("skips UI-less sessions (print/RPC) without calling the model", async () => {
    const { pi, ctx, calls } = makeHarness({ hasUI: false });
    let called = false;

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => true,
        complete: async () => {
          called = true;
          return makeAssistantResponse("nope");
        },
      },
    );

    expect(called).toBe(false);
    expect(calls.length).toBe(0);
  });

  test("does nothing when there is nothing worth summarizing", async () => {
    const { pi, ctx, calls } = makeHarness();

    await handleAgentEnd(pi, { messages: [assistantMessage([{ type: "toolCall" }])] }, ctx, {
      isEnabled: async () => true,
      complete: async () => makeAssistantResponse("nope"),
    });

    expect(calls.length).toBe(0);
  });

  test("never throws and sends nothing when the model call fails", async () => {
    const { pi, ctx, calls } = makeHarness();

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => true,
        complete: async () => {
          throw new Error("provider exploded");
        },
      },
    );

    expect(calls.length).toBe(0);
  });

  test("caps the model call with an abort signal and stays silent on abort", async () => {
    const { pi, ctx, calls } = makeHarness();
    let seenOptions: SimpleStreamOptions | undefined;

    expect(SUMMARY_TIMEOUT_MS).toBe(20_000);

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => true,
        complete: (_model, _context, options) => {
          seenOptions = options;
          return Promise.reject(new Error("The operation was aborted due to timeout"));
        },
      },
    );

    expect(seenOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(calls.length).toBe(0);
  });

  test("stays silent when the config cannot be read", async () => {
    const { pi, ctx, calls } = makeHarness();

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => {
          throw new Error("config unreadable");
        },
        complete: async () => makeAssistantResponse("nope"),
      },
    );

    expect(calls.length).toBe(0);
  });

  test("sends only after the session goes idle, so the footer is not steered into the turn", async () => {
    let polls = 0;
    let idleSeen = false;
    let idleWhenCallingModel: boolean | undefined;
    const { pi, ctx, calls } = makeHarness({
      isIdle: () => {
        const ready = polls++ >= 2;
        if (ready) idleSeen = true;
        return ready;
      },
    });
    const complete: SummaryCompleter = async () => {
      idleWhenCallingModel = idleSeen;
      return makeAssistantResponse("Do X next.");
    };

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      { isEnabled: async () => true, complete },
    );

    expect(idleWhenCallingModel).toBe(true);
    expect(calls.length).toBe(1);
  });

  test("sends nothing when the model returns no usable text", async () => {
    const { pi, ctx, calls } = makeHarness();

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => true,
        complete: async () => makeAssistantResponse("   "),
      },
    );

    expect(calls.length).toBe(0);
  });

  test("stays silent when the model call reports an error stop reason", async () => {
    const { pi, ctx, calls } = makeHarness();

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => true,
        complete: async () =>
          ({
            content: [{ type: "text", text: "partial" }],
            stopReason: "error",
          }) as unknown as AssistantMessage,
      },
    );

    expect(calls.length).toBe(0);
  });

  test("skips a non-terminal settle, so a continuation gets no footer", async () => {
    for (const event of [
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])], willContinue: true },
      {
        messages: [assistantMessage([{ type: "text", text: "Did Y." }])],
        willContinue: true,
        awaitingAsyncWork: true,
      },
    ]) {
      let called = false;
      const { pi, ctx, calls } = makeHarness();

      await handleAgentEnd(pi, event, ctx, {
        isEnabled: async () => true,
        complete: async () => {
          called = true;
          return makeAssistantResponse("nope");
        },
      });

      expect(called).toBe(false);
      expect(calls.length).toBe(0);
    }
  });

  test("a continuation settle followed by the terminal one yields exactly one footer", async () => {
    const { pi, ctx, calls } = makeHarness();
    const messages = [assistantMessage([{ type: "text", text: "Did Y." }])];
    const deps = {
      isEnabled: async () => true,
      complete: async () => makeAssistantResponse("Do X next."),
    };

    await handleAgentEnd(pi, { messages, willContinue: true }, ctx, deps);
    await handleAgentEnd(pi, { messages }, ctx, deps);

    expect(calls.length).toBe(1);
    expect(calls[0].message.content).toEqual([{ type: "text", text: "Do X next." }]);
  });

  test("drops the footer when a message is queued, the reply is no longer current", async () => {
    let called = false;
    const { pi, ctx, calls } = makeHarness({ hasPendingMessages: () => true });

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => true,
        complete: async () => {
          called = true;
          return makeAssistantResponse("Do X next.");
        },
      },
    );

    expect(called).toBe(false);
    expect(calls.length).toBe(0);
  });

  test("drops the footer when the session resumed while summarizing", async () => {
    const state = { idle: true, queued: false };
    const { pi, ctx, calls } = makeHarness({
      isIdle: () => state.idle,
      hasPendingMessages: () => state.queued,
    });

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => true,
        complete: async () => {
          state.idle = false;
          return makeAssistantResponse("Do X next.");
        },
      },
    );

    expect(calls.length).toBe(0);
  });

  test("drops the footer when a message got queued while summarizing", async () => {
    const state = { idle: true, queued: false };
    const { pi, ctx, calls } = makeHarness({
      isIdle: () => state.idle,
      hasPendingMessages: () => state.queued,
    });

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => true,
        complete: async () => {
          state.queued = true;
          return makeAssistantResponse("Do X next.");
        },
      },
    );

    expect(calls.length).toBe(0);
  });

  test("gives up quietly when the session never goes idle", async () => {
    let called = false;
    const { pi, ctx, calls } = makeHarness({ isIdle: () => false });

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => true,
        complete: async () => {
          called = true;
          return makeAssistantResponse("Do X next.");
        },
        waitTimeoutMs: 30,
        pollIntervalMs: 5,
      },
    );

    expect(called).toBe(false);
    expect(calls.length).toBe(0);
    expect(SUMMARY_WAIT_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test("sends at most three lines of the model's answer", async () => {
    const { pi, ctx, calls } = makeHarness();

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => true,
        complete: async () =>
          makeAssistantResponse(
            "```\n1. Next step: run the tests.\n- Then commit.\n* Watch CI.\n- Fourth line.\n```",
          ),
      },
    );

    expect(calls.length).toBe(1);
    expect(calls[0].message.content).toEqual([
      { type: "text", text: "run the tests.\nThen commit.\nWatch CI." },
    ]);
  });

  test("sends nothing when the model's answer is only fences and markers", async () => {
    const { pi, ctx, calls } = makeHarness();

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => true,
        complete: async () => makeAssistantResponse("```\n- \n\n```"),
      },
    );

    expect(calls.length).toBe(0);
  });
});

describe("normalizeSummary", () => {
  test("keeps plain lines, trims them, and drops blank lines", () => {
    expect(normalizeSummary("  Next: run the tests.\n\n Then commit.  ")).toBe(
      "run the tests.\nThen commit.",
    );
    expect(normalizeSummary("Do X next.")).toBe("Do X next.");
  });

  test("drops code fences and bullet or number markers", () => {
    expect(normalizeSummary("```ts\n- one\n* two\n+ three\n1. four\n1) five\n```")).toBe(
      "one\ntwo\nthree",
    );
  });

  test("drops label-like prefixes but keeps URLs and prose colons", () => {
    expect(normalizeSummary("Next step: run the tests.")).toBe("run the tests.");
    expect(normalizeSummary("下一步：运行测试")).toBe("运行测试");
    expect(normalizeSummary("See https://example.com/run")).toBe("See https://example.com/run");
    expect(normalizeSummary("See: https://example.com/run")).toBe("https://example.com/run");
    expect(normalizeSummary("Open question: why?")).toBe("why?");
    expect(normalizeSummary("Fixed the bug in file: src/x.ts")).toBe(
      "Fixed the bug in file: src/x.ts",
    );
  });

  test("keeps at most three non-empty lines", () => {
    expect(normalizeSummary("a\nb\nc\nd\ne")).toBe("a\nb\nc");
  });

  test("returns undefined when nothing survives", () => {
    expect(normalizeSummary("")).toBeUndefined();
    expect(normalizeSummary("   \n\n  ")).toBeUndefined();
    expect(normalizeSummary("- \n```\n```")).toBeUndefined();
  });
});
