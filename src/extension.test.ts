/**
 * Integration test for the OMP extension entry point.
 *
 * Mocks ExtensionAPI to verify:
 *   - Commands are registered with correct names
 *   - Export handler produces a valid tar.gz
 *   - Import handler restores files correctly
 *
 * Runs inside a sandboxed homedir (set USERPROFILE/HOME before running).
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { gunzipSync } from "bun";
import { rm } from "fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";

const HOME = Bun.env.HOME || Bun.env.USERPROFILE || "";
const AGENT = join(HOME, ".omp", "agent");
const OUTPUT_DIR = join(HOME, "output");

interface CommandDefn {
  description: string;
  handler: (_args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

const registered = new Map<string, CommandDefn>();
const notifyLog: string[] = [];
let confirmResponses: boolean[] = [];
let inputResponses: string[] = [];
const statusMap = new Map<string, string | undefined>();

const mockPi = {
  registerCommand: (name: string, defn: CommandDefn) => {
    registered.set(name, defn);
  },
  logger: {
    error: (...args: unknown[]) => console.error("[mock logger]", ...args),
    info: (...args: unknown[]) => console.log("[mock logger]", ...args),
  },
} as unknown as ExtensionAPI;

function makeMockCtx(): ExtensionCommandContext {
  return {
    ui: {
      notify: (msg: string) => { notifyLog.push(msg); },
      confirm: async (_title: string, _msg: string) => confirmResponses.shift() ?? false,
      input: async (_label: string, _placeholder?: string) => inputResponses.shift() ?? _placeholder ?? "",
      setStatus: (_key: string, _text: string | undefined) => { statusMap.set(_key, _text); },
    },
  } as unknown as ExtensionCommandContext;
}

beforeAll(async () => {
  // Bun.write auto-creates parent directories
  await Bun.write(join(AGENT, "config.yml"), "lastChangelogVersion: v15.10.4\nkey: value\n");
  await Bun.write(join(AGENT, "APPEND_SYSTEM.md"), "# custom prompt\n");
  await Bun.write(join(AGENT, "extensions", "demo.ts"), "export default {};\n");
  await Bun.write(join(AGENT, "skills", "helper.md"), "# helper\n");
  await Bun.write(join(AGENT, "models.db"), "{}");
  await Bun.write(join(AGENT, "agent.db"), "{}");
});

afterAll(async () => {
  if (HOME) {
    await rm(HOME, { recursive: true, force: true });
  }
});

describe("Extension entry point", () => {
  test("default export is a function", async () => {
    const mod = await import("./index");
    expect(typeof mod.default).toBe("function");
  });

  test("registers both commands when invoked", async () => {
    const mod = await import("./index");
    registered.clear();
    mod.default(mockPi);

    expect(registered.has("export-config")).toBe(true);
    expect(registered.has("import-config")).toBe(true);
    const expDef = registered.get("export-config")!;
    const impDef = registered.get("import-config")!;
    expect(expDef.description).toContain("导出");
    expect(impDef.description).toContain("还原");
  });
});

describe("Export flow", () => {
  test("exportConfig produces a valid tar.gz with manifest", async () => {
    registered.clear();
    const mod = await import("./index");
    mod.default(mockPi);

    const exportHandler = registered.get("export-config")!.handler;
    notifyLog.length = 0;
    confirmResponses = [true];
    inputResponses = [join(OUTPUT_DIR, "test-export.tar.gz")];

    await exportHandler("", makeMockCtx());

    const outputPath = join(OUTPUT_DIR, "test-export.tar.gz");
    const archiveBuf = await Bun.file(outputPath).arrayBuffer();
    expect(archiveBuf.byteLength).toBeGreaterThan(100);

    const decompressed = gunzipSync(new Uint8Array(archiveBuf));
    const text = new TextDecoder().decode(decompressed);

    expect(text).toContain("config.yml");
    expect(text).toContain("APPEND_SYSTEM.md");
    expect(text).toContain("extensions/demo.ts");
    expect(text).toContain("skills/helper.md");
    expect(text).toContain("models.db");
    expect(text).toContain("agent.db");
    expect(text).toContain("manifest.json");
  });
});

describe("Import flow", () => {
  test("importConfig restores files from an archive", async () => {
    registered.clear();
    const mod = await import("./index");
    mod.default(mockPi);

    const exportHandler = registered.get("export-config")!.handler;
    notifyLog.length = 0;
    confirmResponses = [true];
    inputResponses = [join(OUTPUT_DIR, "for-import.tar.gz")];
    await exportHandler("", makeMockCtx());

    const originalConfig = await Bun.file(join(AGENT, "config.yml")).text();
    await Bun.write(join(AGENT, "config.yml"), "modified: true\n");

    const importHandler = registered.get("import-config")!.handler;
    notifyLog.length = 0;
    confirmResponses = [true, true];
    inputResponses = [join(OUTPUT_DIR, "for-import.tar.gz")];

    await importHandler("", makeMockCtx());

    const restoredConfig = await Bun.file(join(AGENT, "config.yml")).text();
    expect(restoredConfig).toBe(originalConfig);
  });
});
