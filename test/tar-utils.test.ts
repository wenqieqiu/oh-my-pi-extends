/**
 * Tests for tar-utils — pure functions, no OMP dependencies.
 *
 * Covers pack → extract roundtrip, list, empty archives,
 * files near the 100-byte name limit, binary content, and
 * error handling for invalid input.
 */
import { describe, expect, test } from "bun:test";
import { packTar, extractTar, listTar, packTarGz, extractTarGz, listTarGz } from "../src/tar-utils";

describe("packTar / extractTar", () => {
  test("roundtrip empty map produces empty archive", () => {
    const buf = packTar(new Map());
    expect(buf.length).toBeGreaterThanOrEqual(1024); // 2 zero blocks
    const files = extractTar(buf);
    expect(files.size).toBe(0);
  });

  test("single small file roundtrip", () => {
    const input = new Map([["hello.txt", new Uint8Array([72, 73])]]);
    const buf = packTar(input);
    const out = extractTar(buf);
    expect(out.size).toBe(1);
    expect([...out.keys()]).toEqual(["hello.txt"]);
    expect([...out.values()][0]).toEqual(new Uint8Array([72, 73]));
  });

  test("multiple files with subdirectories", () => {
    const input = new Map([
      ["a.txt", new TextEncoder().encode("alpha")],
      ["dir/b.txt", new TextEncoder().encode("beta")],
      ["dir/sub/c.txt", new TextEncoder().encode("gamma")],
    ]);
    const buf = packTar(input);
    const out = extractTar(buf);
    expect(out.size).toBe(3);
    expect(new TextDecoder().decode(out.get("a.txt"))).toBe("alpha");
    expect(new TextDecoder().decode(out.get("dir/b.txt"))).toBe("beta");
    expect(new TextDecoder().decode(out.get("dir/sub/c.txt"))).toBe("gamma");
  });

  test("binary content preserved", () => {
    const bin = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bin[i] = i;
    const input = new Map([["bin.dat", bin]]);
    const buf = packTar(input);
    const out = extractTar(buf);
    expect(out.size).toBe(1);
    expect(out.get("bin.dat")).toEqual(bin);
  });

  test("large file spanning multiple blocks", () => {
    // > 512 bytes to cross block boundary
    const content = new Uint8Array(2000);
    for (let i = 0; i < 2000; i++) content[i] = i & 0xff;
    const input = new Map([["large.bin", content]]);
    const buf = packTar(input);
    const out = extractTar(buf);
    expect(out.get("large.bin")).toEqual(content);
  });

  test("100-byte name boundary", () => {
    const name = "a".repeat(99);
    const input = new Map([[name, new TextEncoder().encode("x")]]);
    const buf = packTar(input);
    const out = extractTar(buf);
    expect(out.has(name)).toBe(true);
  });

  test("files with near-empty content", () => {
    const input = new Map([
      ["empty.dat", new Uint8Array(0)],
      ["one.dat", new Uint8Array([42])],
    ]);
    const buf = packTar(input);
    const out = extractTar(buf);
    expect(out.get("empty.dat")).toEqual(new Uint8Array(0));
    expect(out.get("one.dat")).toEqual(new Uint8Array([42]));
  });

  test("extract with filter", () => {
    const input = new Map([
      ["keep.txt", new TextEncoder().encode("keep")],
      ["skip.txt", new TextEncoder().encode("skip")],
    ]);
    const buf = packTar(input);
    const out = extractTar(buf, (name) => name === "keep.txt");
    expect(out.size).toBe(1);
    expect(out.has("keep.txt")).toBe(true);
    expect(out.has("skip.txt")).toBe(false);
  });

  test("listTar returns correct names", () => {
    const input = new Map([
      ["a.txt", new Uint8Array(0)],
      ["b.txt", new Uint8Array(0)],
    ]);
    const buf = packTar(input);
    const names = listTar(buf);
    expect(names).toEqual(["a.txt", "b.txt"]);
  });

  test("extractTar on invalid data throws gracefully", () => {
    // garbage data that doesn't start with a header
    const garbage = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const out = extractTar(garbage);
    expect(out.size).toBe(0);
  });
});

describe("packTarGz / extractTarGz / listTarGz", () => {
  test("roundtrip with compression", () => {
    const input = new Map([
      ["compress.me", new TextEncoder().encode("hello world")],
    ]);
    const compressed = packTarGz(input);
    // gz is smaller than raw tar for this content (but not guaranteed for tiny files)
    expect(compressed.length).toBeGreaterThan(0);

    const out = extractTarGz(compressed);
    expect(out.size).toBe(1);
    expect(new TextDecoder().decode(out.get("compress.me"))).toBe("hello world");
  });

  test("listTarGz returns names", () => {
    const input = new Map([
      ["x.txt", new Uint8Array(0)],
      ["y.txt", new Uint8Array(0)],
    ]);
    const compressed = packTarGz(input);
    const names = listTarGz(compressed);
    expect(names).toEqual(["x.txt", "y.txt"]);
  });

  test("extractTarGz with filter", () => {
    const input = new Map([
      ["visible", new TextEncoder().encode("a")],
      ["hidden", new TextEncoder().encode("b")],
    ]);
    const compressed = packTarGz(input);
    const out = extractTarGz(compressed, (n) => n === "visible");
    expect(out.size).toBe(1);
    expect(out.has("visible")).toBe(true);
  });

  test("extractTarGz on invalid gzip throws", () => {
    expect(() => extractTarGz(new Uint8Array([0, 1, 2, 3]))).toThrow();
  });
});
