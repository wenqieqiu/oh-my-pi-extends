import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
} from "@oh-my-pi/pi-coding-agent";

const WIDGET_KEY = "token-speed";

export default function (pi: ExtensionAPI): void {
  let lastAssistantTimestamp = 0;

  pi.on("message_start", (event: MessageStartEvent, ctx: ExtensionContext) => {
    const msg = event.message as Record<string, unknown>;
    if (msg.role !== "assistant") return;
    lastAssistantTimestamp = (msg.timestamp as number) ?? Date.now();
    ctx.ui.setWidget(WIDGET_KEY, undefined);
  });

  pi.on("message_update", (event: MessageUpdateEvent, ctx: ExtensionContext) => {
    const msg = event.message as Record<string, unknown>;
    if (msg.role !== "assistant") return;

    const usage = msg.usage as Record<string, unknown> | undefined;
    const output = usage?.output as number | undefined;
    if (!output || !Number.isFinite(output) || output <= 0) return;

    const now = Date.now();
    const elapsed = now - ((msg.timestamp as number) || lastAssistantTimestamp);
    if (elapsed < 200) return;

    const speed = (output * 1000) / elapsed;
    if (!Number.isFinite(speed) || speed <= 0) return;

    ctx.ui.setWidget(WIDGET_KEY, formatSpeed(speed), { placement: "aboveEditor" });
  });

  pi.on("message_end", (event: MessageEndEvent, ctx: ExtensionContext) => {
    const msg = event.message as Record<string, unknown>;
    if (msg.role !== "assistant") return;

    const usage = msg.usage as Record<string, unknown> | undefined;
    const output = usage?.output as number | undefined;
    if (!output || !Number.isFinite(output) || output <= 0) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      return;
    }

    const duration = msg.duration as number | undefined;
    const elapsed =
      duration && Number.isFinite(duration) && duration > 0
        ? duration
        : Date.now() - ((msg.timestamp as number) || lastAssistantTimestamp);

    if (!elapsed || elapsed < 200) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      return;
    }

    const speed = (output * 1000) / elapsed;
    if (!Number.isFinite(speed) || speed <= 0) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      return;
    }

    ctx.ui.setWidget(WIDGET_KEY, formatSpeed(speed), { placement: "aboveEditor" });
  });
}

function formatSpeed(speed: number): string {
  return `${speed.toFixed(1)}tok/s`;
}
