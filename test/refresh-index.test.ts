import { describe, expect, test } from "bun:test";
import { decideRefresh, type RefreshState } from "../scripts/refresh-index";

const WINDOW = 5 * 60 * 1000;
const NOW = 1_000_000_000;

function state(overrides: Partial<RefreshState> = {}): RefreshState {
  return { lastStart: 0, pendingAt: null, pid: null, ...overrides };
}

describe("decideRefresh", () => {
  test("runs when the window has passed (or never ran)", () => {
    expect(decideRefresh(state(), NOW, WINDOW, false)).toEqual({ action: "run" });
    expect(decideRefresh(state({ lastStart: NOW - WINDOW }), NOW, WINDOW, false)).toEqual({
      action: "run",
    });
    expect(decideRefresh(state({ lastStart: NOW - WINDOW - 1 }), NOW, WINDOW, false)).toEqual({
      action: "run",
    });
  });

  test("schedules for the end of the window when the last start is recent", () => {
    expect(decideRefresh(state({ lastStart: NOW - 60_000 }), NOW, WINDOW, false)).toEqual({
      action: "schedule",
      delayMs: WINDOW - 60_000,
    });
    expect(decideRefresh(state({ lastStart: NOW - 1 }), NOW, WINDOW, false)).toEqual({
      action: "schedule",
      delayMs: WINDOW - 1,
    });
  });

  test("does not stack a second schedule while one is pending", () => {
    const pending = state({ lastStart: NOW - 60_000, pendingAt: NOW + 10_000 });
    expect(decideRefresh(pending, NOW, WINDOW, false)).toEqual({
      action: "skip",
      reason: "pending",
    });
  });

  test("reschedules after a pending worker died before starting", () => {
    const stale = state({ lastStart: NOW - 60_000, pendingAt: NOW - 1 });
    expect(decideRefresh(stale, NOW, WINDOW, false)).toEqual({
      action: "schedule",
      delayMs: WINDOW - 60_000,
    });
  });

  test("skips while a worker is running, even when the window has passed", () => {
    expect(
      decideRefresh(state({ lastStart: NOW - WINDOW * 2, pid: 123 }), NOW, WINDOW, true),
    ).toEqual({
      action: "skip",
      reason: "running",
    });
  });

  test("liveness decides, not the recorded pid", () => {
    // Same state, dead worker → the throttle decides, not the pid.
    const stale = state({ lastStart: NOW - 60_000, pid: 123 });
    expect(decideRefresh(stale, NOW, WINDOW, false)).toEqual({
      action: "schedule",
      delayMs: WINDOW - 60_000,
    });
  });
});
