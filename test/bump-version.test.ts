import { describe, expect, test } from "bun:test";
import { parseBump, bumpVersion } from "../scripts/bump-version";

describe("parseBump", () => {
  test("feat → minor", () => {
    expect(parseBump("feat: add export command", "")?.kind).toBe("minor");
  });

  test("fix → patch", () => {
    expect(parseBump("fix: correct the timeout", "")?.kind).toBe("patch");
  });

  test("fix with scope → patch", () => {
    expect(parseBump("fix(scope): bugfix in scope", "")?.kind).toBe("patch");
  });

  test("type! in subject → major", () => {
    expect(parseBump("feat!: drop old config", "")?.kind).toBe("major");
    expect(parseBump("fix(scope)!: break api", "")?.kind).toBe("major");
  });

  test("BREAKING CHANGE footer → major", () => {
    const body = "\n\nBREAKING CHANGE: auth gone";
    expect(parseBump("fix: do thing", body)?.kind).toBe("major");
    expect(parseBump("feat: x", "\n\nBREAKING CHANGE: y")?.kind).toBe("major");
  });

  test("non-versioning types → null (no bump)", () => {
    for (const t of ["docs", "chore", "refactor", "test", "build", "ci", "perf", "style"]) {
      expect(parseBump(`${t}: update something`, "")).toBeNull();
    }
  });

  test("unparseable subject → null", () => {
    expect(parseBump("not a conventional message", "")).toBeNull();
    expect(parseBump("Merge branch 'x'", "")).toBeNull();
    expect(parseBump("", "")).toBeNull();
  });
});

describe("bumpVersion", () => {
  test("increments each component", () => {
    expect(bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  test("handles missing components", () => {
    expect(bumpVersion("1", "patch")).toBe("1.0.1");
    expect(bumpVersion("1.2", "minor")).toBe("1.3.0");
  });
});
