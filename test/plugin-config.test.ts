/**
 * Tests for plugin-config: the extension's own config file under `~/.omp/agent/`.
 *
 * All file operations happen in an isolated temp directory passed explicitly to
 * the API, so no global HOME mutation is needed.
 */
import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PLUGIN_CONFIG_FILE,
  getAdhdSummaryEnabled,
  setAdhdSummaryEnabled,
} from "../src/plugin-config";

const sandbox = mkdtempSync(join(tmpdir(), "omp-plugin-config-"));
let seq = 0;

function freshDir(): string {
  return join(sandbox, `case-${seq++}`, "agent");
}

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("getAdhdSummaryEnabled", () => {
  test("defaults to true when the config file is missing", async () => {
    expect(await getAdhdSummaryEnabled(freshDir())).toBe(true);
  });

  test("defaults to true when adhdSummary is absent", async () => {
    const dir = freshDir();
    await Bun.write(join(dir, PLUGIN_CONFIG_FILE), '{"other":{"keep":1}}\n');
    expect(await getAdhdSummaryEnabled(dir)).toBe(true);
  });

  test("defaults to true when enabled is not a boolean", async () => {
    const dir = freshDir();
    await Bun.write(join(dir, PLUGIN_CONFIG_FILE), '{"adhdSummary":{"enabled":"no"}}');
    expect(await getAdhdSummaryEnabled(dir)).toBe(true);
  });

  test("tolerates corrupt JSON without rewriting the file", async () => {
    const dir = freshDir();
    const raw = "{ this is not json";
    await Bun.write(join(dir, PLUGIN_CONFIG_FILE), raw);

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
    try {
      expect(await getAdhdSummaryEnabled(dir)).toBe(true);
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings.length).toBe(1);
    expect(await Bun.file(join(dir, PLUGIN_CONFIG_FILE)).text()).toBe(raw);
  });
});

describe("setAdhdSummaryEnabled", () => {
  test("round-trips false and true, creating parent directories", async () => {
    const dir = freshDir();

    await setAdhdSummaryEnabled(false, dir);
    expect(await getAdhdSummaryEnabled(dir)).toBe(false);

    await setAdhdSummaryEnabled(true, dir);
    expect(await getAdhdSummaryEnabled(dir)).toBe(true);

    expect(JSON.parse(await Bun.file(join(dir, PLUGIN_CONFIG_FILE)).text())).toEqual({
      adhdSummary: { enabled: true },
    });
  });

  test("preserves unrelated keys, including in a corrupt file's replacement", async () => {
    const dir = freshDir();
    await Bun.write(join(dir, PLUGIN_CONFIG_FILE), '{"other":{"keep":1}}');

    await setAdhdSummaryEnabled(false, dir);

    expect(JSON.parse(await Bun.file(join(dir, PLUGIN_CONFIG_FILE)).text())).toEqual({
      other: { keep: 1 },
      adhdSummary: { enabled: false },
    });
  });

  test("recovers from a corrupt file by starting from a fresh object", async () => {
    const dir = freshDir();
    await Bun.write(join(dir, PLUGIN_CONFIG_FILE), "not json at all");

    await setAdhdSummaryEnabled(false, dir);

    expect(JSON.parse(await Bun.file(join(dir, PLUGIN_CONFIG_FILE)).text())).toEqual({
      adhdSummary: { enabled: false },
    });
  });
});
