/**
 * Integration tests for config-items.
 *
 * Must be run with USERPROFILE (Windows) or HOME (Unix) set to a
 * temporary directory so that `Bun.env` resolves to the test sandbox.
 *
 * Example (Windows, cmd):
 *   set USERPROFILE=C:\tmp\omp-test-sandbox && bun test src\config-items.test.ts
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { rm } from "fs/promises";
import { join } from "node:path";
import { CONFIG_ITEMS } from "./config-items";

const AGENT = join(Bun.env.HOME || Bun.env.USERPROFILE || "", ".omp", "agent");

beforeAll(async () => {
  // Bun.write auto-creates parent directories
  await Bun.write(join(AGENT, "config.yml"), "lastChangelogVersion: v15.10.4\n");
  await Bun.write(join(AGENT, "APPEND_SYSTEM.md"), "# custom instructions\n");
  await Bun.write(join(AGENT, "extensions", "hello.ts"), 'export default () => {};\n');
  await Bun.write(join(AGENT, "extensions", "sub", "nested.js"), "// nested\n");
  await Bun.write(join(AGENT, "skills", "custom.md"), "# Custom Skill\n");
  await Bun.write(join(AGENT, "models.db"), "");
  await Bun.write(join(AGENT, "agent.db"), "{}");
});

afterAll(async () => {
  const TMP = Bun.env.HOME || Bun.env.USERPROFILE || "";
  if (TMP) await rm(TMP, { recursive: true, force: true });
});

describe("ConfigItem.exportFiles", () => {
  test("config item exports config.yml", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "config")!;
    const files = await item.exportFiles();
    expect(files.has("config.yml")).toBe(true);
    const content = new TextDecoder().decode(files.get("config.yml")!);
    expect(content).toContain("lastChangelogVersion");
  });

  test("APPEND_SYSTEM.md exported", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "append_system")!;
    const files = await item.exportFiles();
    expect(files.has("APPEND_SYSTEM.md")).toBe(true);
    expect(new TextDecoder().decode(files.get("APPEND_SYSTEM.md")!)).toBe("# custom instructions\n");
  });

  test("extensions item walks directory recursively", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "extensions")!;
    const files = await item.exportFiles();
    expect(files.has("extensions/hello.ts")).toBe(true);
    expect(files.has("extensions/sub/nested.js")).toBe(true);
    expect(files.size).toBe(2);
  });

  test("skills item exports skills directory", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "skills")!;
    const files = await item.exportFiles();
    expect(files.has("skills/custom.md")).toBe(true);
  });

  test("models.db exports correctly", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "models_db")!;
    const files = await item.exportFiles();
    expect(files.has("models.db")).toBe(true);
  });

  test("agent.db exports correctly", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "agent_db")!;
    const files = await item.exportFiles();
    expect(files.has("agent.db")).toBe(true);
  });

  test("estimateSize returns a string", async () => {
    for (const item of CONFIG_ITEMS) {
      const size = await item.estimateSize();
      expect(typeof size).toBe("string");
      expect(size.length).toBeGreaterThan(0);
    }
  });
});

describe("ConfigItem.importFiles roundtrip", () => {
  test("import config.yml overwrites file", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "config")!;
    const exported = new Map<string, Uint8Array>();
    exported.set("config.yml", new TextEncoder().encode("replaced: true\n"));
    await item.importFiles(exported);
    const raw = await Bun.file(join(AGENT, "config.yml")).text();
    expect(raw).toBe("replaced: true\n");
  });

  test("import extensions writes files under extensions/ prefix", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "extensions")!;
    const files = new Map<string, Uint8Array>();
    files.set("extensions/new_file.ts", new TextEncoder().encode("export const x = 1;\n"));
    await item.importFiles(files);
    const raw = await Bun.file(join(AGENT, "extensions", "new_file.ts")).text();
    expect(raw).toBe("export const x = 1;\n");
  });

  test("import skills writes under skills/ prefix", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "skills")!;
    const files = new Map<string, Uint8Array>();
    files.set("skills/new_skill.md", new TextEncoder().encode("# New Skill\n"));
    await item.importFiles(files);
    const raw = await Bun.file(join(AGENT, "skills", "new_skill.md")).text();
    expect(raw).toBe("# New Skill\n");
  });

  test("import models.db overwrites", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "models_db")!;
    const files = new Map<string, Uint8Array>();
    files.set("models.db", new TextEncoder().encode("updated"));
    await item.importFiles(files);
    const raw = await Bun.file(join(AGENT, "models.db")).text();
    expect(raw).toBe("updated");
  });

  test("import agent.db overwrites", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "agent_db")!;
    const files = new Map<string, Uint8Array>();
    files.set("agent.db", new TextEncoder().encode("updated"));
    await item.importFiles(files);
    const raw = await Bun.file(join(AGENT, "agent.db")).text();
    expect(raw).toBe("updated");
  });
});
