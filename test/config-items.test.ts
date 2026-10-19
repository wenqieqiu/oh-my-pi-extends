/**
 * Integration tests for config-items.
 *
 * All file operations happen in an isolated temp directory.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { safeTreePath, type ConfigItem } from "../src/config-items";
import { getOmpVersion } from "../src/common";

let sandbox: string;
let agentDir: string;
let CONFIG_ITEMS: ConfigItem[];

function getAgentDir(): string {
  return join(Bun.env.HOME || Bun.env.USERPROFILE || "", ".omp", "agent");
}

beforeAll(async () => {
  sandbox = mkdtempSync(join(tmpdir(), "omp-test-config-"));
  agentDir = join(sandbox, ".omp", "agent");
  Bun.env.HOME = sandbox;

  // Import AFTER setting HOME so the module uses sandbox path
  const mod = await import("../src/config-items");
  CONFIG_ITEMS = mod.CONFIG_ITEMS;

  // Bun.write auto-creates parent directories
  await Bun.write(join(agentDir, "config.yml"), "lastChangelogVersion: v15.10.4\n");
  await Bun.write(join(agentDir, "last-changelog-version"), "18.12.2\n");
  await Bun.write(join(agentDir, "APPEND_SYSTEM.md"), "# custom instructions\n");
  await Bun.write(join(agentDir, "extensions", "hello.ts"), "export default () => {};\n");
  await Bun.write(join(agentDir, "extensions", "sub", "nested.js"), "// nested\n");
  await Bun.write(join(agentDir, "skills", "custom.md"), "# Custom Skill\n");
  await Bun.write(join(agentDir, "models.db"), "");
  await Bun.write(join(agentDir, "agent.db"), "{}");
  await Bun.write(join(agentDir, "mcp.json"), '{"mcpServers":{}}\n');
  await Bun.write(join(agentDir, "skill-descriptions.db"), "db");
  await Bun.write(join(agentDir, "managed-skills", "a", "b", "SKILL.md"), "# managed\n");
});

afterAll(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
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
    expect(new TextDecoder().decode(files.get("APPEND_SYSTEM.md")!)).toBe(
      "# custom instructions\n",
    );
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

  test("last-changelog-version item exports marker file", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "last-changelog-version")!;
    const files = await item.exportFiles();
    expect(files.has("last-changelog-version")).toBe(true);
  });

  test("mcp item exports mcp.json", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "mcp")!;
    const files = await item.exportFiles();
    expect(files.size).toBe(1);
    expect(new TextDecoder().decode(files.get("mcp.json")!)).toBe('{"mcpServers":{}}\n');
  });

  test("skill_descriptions item exports skill-descriptions.db", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "skill_descriptions")!;
    const files = await item.exportFiles();
    expect(new TextDecoder().decode(files.get("skill-descriptions.db")!)).toBe("db");
  });

  test("managed_skills item walks directory recursively", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "managed_skills")!;
    const files = await item.exportFiles();
    expect(files.has("managed-skills/a/b/SKILL.md")).toBe(true);
    expect(files.size).toBe(1);
  });
});

describe("getOmpVersion", () => {
  test("reads last-changelog-version marker file", async () => {
    await Bun.write(join(agentDir, "last-changelog-version"), "18.12.2\n");
    await Bun.write(join(agentDir, "config.yml"), "lastChangelogVersion: v15.10.4\n");
    expect(await getOmpVersion()).toBe("18.12.2");
  });

  test("falls back to lastChangelogVersion in config.yml", async () => {
    const markerPath = join(agentDir, "last-changelog-version");
    const originalMarker = await Bun.file(markerPath).text();
    rmSync(markerPath, { force: true });
    try {
      await Bun.write(join(agentDir, "config.yml"), "lastChangelogVersion: v15.10.4\n");
      expect(await getOmpVersion()).toBe("15.10.4");

      // Empty marker file must not win over the legacy key
      await Bun.write(markerPath, "\n");
      expect(await getOmpVersion()).toBe("15.10.4");
    } finally {
      // Leave the shared fixture as this test found it
      await Bun.write(markerPath, originalMarker);
    }
  });

  test("returns unknown when neither source exists", async () => {
    const emptyHome = mkdtempSync(join(tmpdir(), "omp-test-empty-"));
    const prevHome = Bun.env.HOME;
    Bun.env.HOME = emptyHome;
    try {
      expect(await getOmpVersion()).toBe("unknown");
    } finally {
      Bun.env.HOME = prevHome;
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});

describe("ConfigItem.importFiles roundtrip", () => {
  test("import config.yml overwrites file", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "config")!;
    const exported = new Map<string, Uint8Array>();
    exported.set("config.yml", new TextEncoder().encode("replaced: true\n"));
    await item.importFiles(exported);
    const raw = await Bun.file(join(agentDir, "config.yml")).text();
    expect(raw).toBe("replaced: true\n");
  });

  test("import extensions writes files under extensions/ prefix", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "extensions")!;
    const files = new Map<string, Uint8Array>();
    files.set("extensions/new_file.ts", new TextEncoder().encode("export const x = 1;\n"));
    await item.importFiles(files);
    const raw = await Bun.file(join(agentDir, "extensions", "new_file.ts")).text();
    expect(raw).toBe("export const x = 1;\n");
  });

  test("import skills writes under skills/ prefix", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "skills")!;
    const files = new Map<string, Uint8Array>();
    files.set("skills/new_skill.md", new TextEncoder().encode("# New Skill\n"));
    await item.importFiles(files);
    const raw = await Bun.file(join(agentDir, "skills", "new_skill.md")).text();
    expect(raw).toBe("# New Skill\n");
  });

  test("import models.db overwrites", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "models_db")!;
    const files = new Map<string, Uint8Array>();
    files.set("models.db", new TextEncoder().encode("updated"));
    await item.importFiles(files);
    const raw = await Bun.file(join(agentDir, "models.db")).text();
    expect(raw).toBe("updated");
  });

  test("import agent.db overwrites", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "agent_db")!;
    const files = new Map<string, Uint8Array>();
    files.set("agent.db", new TextEncoder().encode("updated"));
    await item.importFiles(files);
    const raw = await Bun.file(join(agentDir, "agent.db")).text();
    expect(raw).toBe("updated");
  });

  test("roundtrip restores new file items from their own export", async () => {
    const cases: Record<string, string> = {
      "last-changelog-version": "last-changelog-version",
      mcp: "mcp.json",
      skill_descriptions: "skill-descriptions.db",
    };
    for (const [id, key] of Object.entries(cases)) {
      const item = CONFIG_ITEMS.find((i) => i.id === id)!;
      const exported = await item.exportFiles();
      expect(exported.has(key)).toBe(true);
      await item.importFiles(exported);
      const onDisk = new Uint8Array(await Bun.file(join(agentDir, key)).arrayBuffer());
      expect(onDisk).toEqual(Uint8Array.from(exported.get(key)!));
    }
  });

  test("ids stay stable — they are the wire format of existing backups", () => {
    expect(CONFIG_ITEMS.map((i) => i.id)).toEqual([
      "config",
      "append_system",
      "extensions",
      "skills",
      "models_db",
      "agent_db",
      "last-changelog-version",
      "mcp",
      "skill_descriptions",
      "managed_skills",
    ]);
  });

  test("managed_skills import ignores keys outside its prefix", async () => {
    const item = CONFIG_ITEMS.find((i) => i.id === "managed_skills")!;
    await item.importFiles(
      new Map([
        ["skills/x.md", new TextEncoder().encode("# foreign\n")],
        ["managed-skills/sub/new.md", new TextEncoder().encode("# new\n")],
      ]),
    );
    expect(await Bun.file(join(agentDir, "managed-skills", "sub", "new.md")).text()).toBe(
      "# new\n",
    );
    expect(await Bun.file(join(agentDir, "skills", "x.md")).exists()).toBe(false);

    const exported = await item.exportFiles();
    expect(exported.has("managed-skills/a/b/SKILL.md")).toBe(true);
    expect(exported.has("managed-skills/sub/new.md")).toBe(true);
  });
});

describe("writeTree path traversal guard", () => {
  test("accepts plain relative keys and rejects every escaping form", () => {
    const base = mkdtempSync(join(tmpdir(), "omp-test-guard-"));
    try {
      expect(safeTreePath(base, "skills/a.md")).toBe(resolve(base, "skills", "a.md"));
      expect(safeTreePath(base, "../evil.txt")).toBeNull();
      expect(safeTreePath(base, "skills/../../evil.txt")).toBeNull();
      // Has a `..` segment even though it resolves back inside base
      expect(safeTreePath(base, "skills/sub/../ok.txt")).toBeNull();
      expect(safeTreePath(base, "/etc/passwd")).toBeNull();
      expect(safeTreePath(base, "C:/Windows/evil.txt")).toBeNull();
      expect(safeTreePath(base, "C:evil.txt")).toBeNull();
      expect(safeTreePath(base, "\\\\server\\share\\evil.txt")).toBeNull();
      expect(safeTreePath(base, "skills\\evil.txt")).toBeNull();
      expect(safeTreePath(base, "")).toBeNull();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  test("importFiles skips traversal keys instead of writing them", async () => {
    const skills = CONFIG_ITEMS.find((i) => i.id === "skills")!;
    const payload = new TextEncoder().encode("pwned\n");
    await skills.importFiles(
      new Map([
        ["skills/../evil.txt", payload],
        ["skills/../../evil.txt", payload],
        ["skills/sub/../ok.txt", payload],
        ["skills/kept.md", payload],
      ]),
    );
    expect(await Bun.file(join(sandbox, "evil.txt")).exists()).toBe(false);
    expect(await Bun.file(join(sandbox, ".omp", "evil.txt")).exists()).toBe(false);
    expect(await Bun.file(join(agentDir, "evil.txt")).exists()).toBe(false);
    expect(await Bun.file(join(agentDir, "skills", "ok.txt")).exists()).toBe(false);
    expect(await Bun.file(join(agentDir, "skills", "kept.md")).text()).toBe("pwned\n");
  });
});

describe("ConfigItem absence tolerance", () => {
  test("missing files export empty maps with 未知 size and never throw", async () => {
    const emptyHome = mkdtempSync(join(tmpdir(), "omp-test-missing-"));
    const prevHome = Bun.env.HOME;
    Bun.env.HOME = emptyHome;
    try {
      for (const id of ["last-changelog-version", "mcp", "skill_descriptions"]) {
        const item = CONFIG_ITEMS.find((i) => i.id === id)!;
        expect((await item.exportFiles()).size).toBe(0);
        expect(await item.estimateSize()).toBe("未知");
      }

      const managed = CONFIG_ITEMS.find((i) => i.id === "managed_skills")!;
      expect((await managed.exportFiles()).size).toBe(0);
      expect(await managed.estimateSize()).toBe("0 B");
    } finally {
      Bun.env.HOME = prevHome;
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
