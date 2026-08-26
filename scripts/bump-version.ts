/**
 * Post-commit version bump — run by simple-git-hooks' `post-commit` hook.
 *
 * Reads the HEAD commit message, and if it's a Conventional Commit whose type
 * affects versioning, increments `version` in package.json:
 *
 *   - `fix`             → patch+
 *   - `feat`            → minor+
 *   - breaking (`!` in
 *     the subject or a
 *     `BREAKING CHANGE:`
 *     body footer)      → major+
 *
 * Other types (`docs:`, `chore:`, `refactor:`, `test:`, …) and messages that
 * don't parse as Conventional Commits leave the version untouched.
 *
 * After bumping, the script stages `package.json` and amends it into the
 * commit just created (`git commit --amend --no-edit`), so the version change
 * ships inside the commit itself rather than lingering in the working tree.
 * The amend runs with `SKIP_SIMPLE_GIT_HOOKS=1`, so the hook does not re-fire
 * in a loop. A commit that is already pushed cannot be amended without
 * rewriting history — only local, unpushed commits change.
 *
 * Non-interactive by design: prints one line on a bump, and stays silent when
 * it skips. Never exits non-zero, so a bump error never fails the commit.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_JSON = join(process.cwd(), "package.json");

interface Bump {
  kind: "major" | "minor" | "patch";
}

/** Parse the commit subject for a Conventional Commit type bump. */
function parseBump(subject: string, body: string): Bump | null {
  const m = subject.match(/^([a-zA-Z]+)(?:\([^)]*\))?(!)?:/);
  if (!m) return null;
  const type = m[1];
  const bang = m[2] === "!";
  const breakingFooter = /^BREAKING CHANGE:/m.test(body);
  if (bang || breakingFooter) return { kind: "major" };
  if (type === "feat") return { kind: "minor" };
  if (type === "fix") return { kind: "patch" };
  // docs:, chore:, refactor:, test:, build:, ci:, perf:, style:, etc. → no bump
  return null;
}

/** Bump a semver string's given component, returning the new version. */
function bumpVersion(version: string, kind: Bump["kind"]): string {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  switch (kind) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

function amendVersionIntoCommit(): void {
  // SKIP_SIMPLE_GIT_HOOKS=1 prevents the amend's post-commit from re-running
  // this hook in an infinite loop.
  Bun.spawnSync(["git", "add", "package.json"]);
  const amend = Bun.spawnSync(["git", "commit", "--amend", "--no-edit"], {
    env: { ...process.env, SKIP_SIMPLE_GIT_HOOKS: "1" },
  });
  if (amend.exitCode !== 0) {
    console.error("[bump-version] amend failed:", amend.stderr.toString().trim());
  }
}

function main(): void {
  // post-commit runs after HEAD is the new commit.
  const message = Bun.spawnSync(["git", "log", "-1", "--format=%B"]).stdout.toString();
  const [subjectLine, ...bodyLines] = message.split("\n");
  const subject = subjectLine ?? "";

  const bump = parseBump(subject, bodyLines.join("\n"));
  if (!bump) return; // non-versioning or unparseable commit — silent

  const raw = readFileSync(PACKAGE_JSON, "utf8");
  const versionLine = raw.match(/^(\s*"version":\s*")(\d+\.\d+\.\d+)(")/m);
  if (!versionLine) {
    console.error("[bump-version] package.json has no matching version field");
    return;
  }
  const oldVersion = versionLine[2];
  const newVersion = bumpVersion(oldVersion, bump.kind);
  if (newVersion === oldVersion) return;

  const updated = raw.replace(versionLine[0], `${versionLine[1]}${newVersion}${versionLine[3]}`);
  writeFileSync(PACKAGE_JSON, updated);
  console.log(`[bump-version] ${oldVersion} \u2192 ${newVersion} (${bump.kind})`);

  amendVersionIntoCommit();
}

try {
  main();
} catch (err) {
  // A version-bump error must never fail the commit.
  console.error("[bump-version] error:", err instanceof Error ? err.message : err);
}
