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
      return makeAssistantResponse("【精要结论】\n1. Did Y.\n【下一步】\n1. Do X next.");
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
    expect(calls[0].message.content).toEqual([
      { type: "text", text: "【精要结论】\n1. Did Y.\n\n【下一步】\n1. Do X next." },
    ]);
    expect(calls[0].options).toEqual({ triggerTurn: false });

    // systemPrompt is passed as an array, the summarized reply as the user message.
    const systemPrompt = seenContext?.systemPrompt ?? [];
    expect(Array.isArray(seenContext?.systemPrompt)).toBe(true);
    expect(systemPrompt.length).toBeGreaterThan(0);
    expect(systemPrompt[0]).toContain("【精要结论】");
    expect(systemPrompt[0]).toContain("【下一步】");
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
    expect(calls[0].message.content).toEqual([{ type: "text", text: "【精要结论】\n1. Do X next." }]);
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
    // The host stays busy after a settle (title / recap / todo HUD) well past 10s;
    // lowering this back to single-digit seconds silently costs footers.
    expect(SUMMARY_WAIT_TIMEOUT_MS).toBeGreaterThanOrEqual(20_000);
  });

  test("renders the model's answer as the two capped blocks", async () => {
    const { pi, ctx, calls } = makeHarness();

    await handleAgentEnd(
      pi,
      { messages: [assistantMessage([{ type: "text", text: "Did Y." }])] },
      ctx,
      {
        isEnabled: async () => true,
        complete: async () =>
          makeAssistantResponse(
            "```\n1. Next step: run the tests.\n- Then commit.\n* Watch CI.\n```",
          ),
      },
    );

    expect(calls.length).toBe(1);
    expect(calls[0].message.content).toEqual([
      {
        type: "text",
        text: "【精要结论】\n1. run the tests.\n\n【下一步】\n1. Then commit.\n2. Watch CI.",
      },
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
  test("renders the two blocks with our own numbering", () => {
    expect(
      normalizeSummary("【精要结论】\n1. 索引已刷新\n2. 工作树只剩统计漂移\n【下一步】\n1. 提交统计"),
    ).toBe("【精要结论】\n1. 索引已刷新\n2. 工作树只剩统计漂移\n\n【下一步】\n1. 提交统计");
  });

  test("renumbers whatever the model wrote", () => {
    expect(normalizeSummary("精要结论\n- a\n- b\n下一步\n- c")).toBe(
      "【精要结论】\n1. a\n2. b\n\n【下一步】\n1. c",
    );
    expect(normalizeSummary("Summary:\n7) a\nNext steps:\n3) b")).toBe(
      "【精要结论】\n1. a\n\n【下一步】\n1. b",
    );
  });

  test("drops code fences and label-like prefixes, keeps URLs and prose colons", () => {
    expect(normalizeSummary("```\n精要结论\nSee https://example.com/run\n```")).toBe(
      "【精要结论】\n1. See https://example.com/run",
    );
    expect(normalizeSummary("下一步：运行测试")).toBe("【精要结论】\n1. 运行测试");
    expect(normalizeSummary("Next step: run the tests.")).toBe("【精要结论】\n1. run the tests.");
    expect(normalizeSummary("Fixed the bug in file: src/x.ts")).toBe(
      "【精要结论】\n1. Fixed the bug in file: src/x.ts",
    );
    expect(normalizeSummary("See: https://example.com/run")).toBe(
      "【精要结论】\n1. https://example.com/run",
    );
  });

  test("caps each block", () => {
    const many = "【精要结论】\n1. a\n2. b\n3. c\n【下一步】\n1. d\n2. e\n3. f\n4. g";
    expect(normalizeSummary(many)).toBe("【精要结论】\n1. a\n2. b\n\n【下一步】\n1. d\n2. e\n3. f");
  });

  test("falls back when the model ignores the headers", () => {
    // First line becomes the conclusion, the rest are next steps.
    expect(normalizeSummary("Done.\nCommit it.\nThen push.")).toBe(
      "【精要结论】\n1. Done.\n\n【下一步】\n1. Commit it.\n2. Then push.",
    );
  });

  test("omits the next block when there is nothing to do", () => {
    expect(normalizeSummary("【精要结论】\nNothing left.")).toBe("【精要结论】\n1. Nothing left.");
  });

  test("fills the conclusion from the next block rather than sending an empty one", () => {
    expect(normalizeSummary("【下一步】\n1. push")).toBe("【精要结论】\n1. push");
  });

  test("returns undefined when nothing survives", () => {
    expect(normalizeSummary("")).toBeUndefined();
    expect(normalizeSummary("   \n\n  ")).toBeUndefined();
    expect(normalizeSummary("- \n```\n```")).toBeUndefined();
    expect(normalizeSummary("【精要结论】\n【下一步】")).toBeUndefined();
  });
});
