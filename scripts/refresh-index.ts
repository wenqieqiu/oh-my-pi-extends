/**
 * Post-commit index refresh — run by simple-git-hooks' `post-commit` hook.
 *
 * Refreshes the GitNexus and CodeGraph indexes of this repository after a
 * commit. The work happens in a detached background process, so a commit
 * never waits for it.
 *
 * Throttling: at most one refresh *starts* per window (5 minutes by default).
 *
 *   - window has passed               → start a worker now
 *   - a worker is already running     → skip
 *   - a start is already scheduled    → skip
 *   - otherwise                       → schedule one worker for the moment the
 *                                       window ends, so a burst of commits
 *                                       still leaves the index fresh
 *
 * Gate (`bun scripts/refresh-index.ts`, the hook entry point) only decides and
 * spawns; the worker (`--run`) does the work:
 *
 *   1. stamp the start time,
 *   2. `node .gitnexus/run.cjs analyze`,
 *   3. `codegraph sync <repo root>`,
 *   4. clear the lock.
 *
 * State and log live inside the git dir (`.git/oh-my-pi-extends-index.json`,
 * `.git/oh-my-pi-extends-index.log`), so nothing shows up as a commit.
 *
 * Env knobs: `INDEX_REFRESH_WINDOW_MS` (throttle window), `INDEX_REFRESH_DISABLE=1`
 * (turn the hook off). Never exits non-zero: a refresh error must not fail the
 * commit.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const MAX_LOG_BYTES = 1024 * 1024;

export interface RefreshState {
  /** Epoch ms when the last worker started; 0 when none ever ran. */
  lastStart: number;
  /** Epoch ms a delayed worker is scheduled for, or null when none is. */
  pendingAt: number | null;
  /** Pid of the worker believed to be running, or null. */
  pid: number | null;
}

export type RefreshDecision =
  | { action: "run" }
  | { action: "schedule"; delayMs: number }
  | { action: "skip"; reason: "running" | "pending" };

const EMPTY_STATE: RefreshState = { lastStart: 0, pendingAt: null, pid: null };

/**
 * Decide what the hook should do now. Pure: callers pass the clock and the
 * liveness of the recorded worker, so the throttle is unit-testable.
 *
 * Exported for unit testing; not part of the hook's public surface.
 */
export function decideRefresh(
  state: RefreshState,
  now: number,
  windowMs: number,
  running: boolean,
): RefreshDecision {
  if (running) return { action: "skip", reason: "running" };
  if (state.pendingAt !== null && state.pendingAt > now) {
    return { action: "skip", reason: "pending" };
  }
  if (now - state.lastStart >= windowMs) return { action: "run" };
  // An expired `pendingAt` (worker died before starting) falls through here and
  // is rescheduled, so a stale marker cannot wedge the throttle forever.
  return { action: "schedule", delayMs: state.lastStart + windowMs - now };
}

function gitDir(): string {
  const out = Bun.spawnSync(["git", "rev-parse", "--absolute-git-dir"]).stdout.toString().trim();
  return out || join(process.cwd(), ".git");
}

function readState(): RefreshState {
  const path = join(gitDir(), "oh-my-pi-extends-index.json");
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<RefreshState>;
    return {
      lastStart: typeof parsed.lastStart === "number" ? parsed.lastStart : 0,
      pendingAt: typeof parsed.pendingAt === "number" ? parsed.pendingAt : null,
      pid: typeof parsed.pid === "number" ? parsed.pid : null,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

function writeState(state: RefreshState): void {
  const path = join(gitDir(), "oh-my-pi-extends-index.json");
  try {
    writeFileSync(path, `${JSON.stringify(state)}\n`);
  } catch (err) {
    logLine(`state write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function isAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function logLine(line: string): void {
  const path = join(gitDir(), "oh-my-pi-extends-index.log");
  const stamp = new Date().toISOString();
  try {
    try {
      if (statSync(path).size > MAX_LOG_BYTES) writeFileSync(path, "");
    } catch {
      // No log yet — appendFileSync creates it.
    }
    appendFileSync(path, `[${stamp}] ${line}\n`);
  } catch {
    // Logging must never break the hook.
  }
}

function runStep(label: string, cmd: string[], cwd: string): void {
  const started = Date.now();
  const result = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const stdout = result.stdout.toString().trim();
  const stderr = result.stderr.toString().trim();
  if (result.exitCode === 0) {
    const summary = stdout.split("\n").filter(Boolean).slice(-1)[0] ?? "";
    logLine(`${label}: ok in ${elapsed}s ${summary}`);
    return;
  }
  logLine(`${label}: exit ${result.exitCode} in ${elapsed}s ${(stderr || stdout).slice(0, 500)}`);
}

/** Worker: do the actual refresh. */
function runWorker(): void {
  const root =
    Bun.spawnSync(["git", "rev-parse", "--show-toplevel"]).stdout.toString().trim() ||
    process.cwd();
  const state = readState();
  writeState({ lastStart: Date.now(), pendingAt: null, pid: process.pid });
  try {
    runStep("gitnexus", [process.execPath, join(root, ".gitnexus", "run.cjs"), "analyze"], root);
    runStep("codegraph", ["codegraph", "sync", root], root);
    writeState({ lastStart: Date.now(), pendingAt: null, pid: null });
  } catch (err) {
    logLine(`worker failed: ${err instanceof Error ? err.message : String(err)}`);
    writeState({ ...state, pendingAt: null, pid: null });
  }
}

function spawnWorker(delayMs: number): void {
  const script = import.meta.path;
  const args = ["--run", `--delay=${delayMs}`];
  const cwd = process.cwd();
  if (process.platform === "win32") {
    // Verified: `cmd /c start /b` outlives the hook. `Bun.spawn` + `unref()`
    // does not — the child dies with the parent, and the refresh never runs.
    spawnSync("cmd", ["/c", "start", "", "/b", process.execPath, script, ...args], {
      cwd,
      stdio: "ignore",
    });
    return;
  }
  spawn(process.execPath, [script, ...args], {
    cwd,
    detached: true,
    stdio: "ignore",
  }).unref();
}

/** Gate: decide, then either spawn now, spawn later, or do nothing. */
function gate(): void {
  if (Bun.env.INDEX_REFRESH_DISABLE === "1") return;
  const windowMs = Number(Bun.env.INDEX_REFRESH_WINDOW_MS) || DEFAULT_WINDOW_MS;
  const now = Date.now();
  const state = readState();
  const decision = decideRefresh(state, now, windowMs, isAlive(state.pid));

  if (decision.action === "skip") return;

  if (decision.action === "run") {
    // Stamp the start before spawning: the worker overwrites it with the same
    // value moments later, and the stamp keeps a burst of commits from spawning
    // one worker each.
    writeState({ ...state, lastStart: now, pendingAt: null, pid: null });
    spawnWorker(0);
    return;
  }

  writeState({ ...state, pendingAt: now + decision.delayMs });
  spawnWorker(decision.delayMs);
}

function main(): void {
  const args = process.argv.slice(2);
  const delayArg = args.find((a) => a.startsWith("--delay="));
  const delayMs = delayArg ? Number(delayArg.slice("--delay=".length)) || 0 : 0;

  if (args.includes("--run")) {
    if (delayMs > 0) Bun.sleepSync(delayMs);
    runWorker();
    return;
  }
  gate();
}

// Guard so importing this module in tests does not run the hook.
if (import.meta.main) {
  try {
    main();
  } catch (err) {
    console.error("[refresh-index] error:", err instanceof Error ? err.message : err);
  }
}
