/**
 * Minimal tar + gzip utilities for config export/import.
 *
 * POSIX ustar format: implements only what we need —
 * regular files with 100-byte names, no symlinks, no long names.
 * Gzip uses Bun's built-in gzipSync/gunzipSync.
 */
import { gzipSync, gunzipSync } from "bun";

const BLOCK = 512;

function padToBlock(n: number): number {
  return (n + BLOCK - 1) & ~(BLOCK - 1);
}

/** Encode `value` as right-aligned octal, NUL-terminated, into `length` bytes. */
function encodeOctal(buf: Uint8Array, offset: number, length: number, value: number): void {
  const s = value.toString(8);
  // padStart to length-1 (NUL goes at the last position)
  const padded = s.padStart(length - 1, "0") + "\0";
  for (let i = 0; i < length; i++) buf[offset + i] = padded.charCodeAt(i);
}

/** Write a ustar header for a regular file. */
function createHeader(name: string, size: number): Uint8Array {
  const h = new Uint8Array(BLOCK);

  // name (100 bytes)
  const nameB = new TextEncoder().encode(name).slice(0, 100);
  h.set(nameB, 0);

  // mode (8), uid (8), gid (8)
  encodeOctal(h, 100, 8, 0o644);
  encodeOctal(h, 108, 8, 0);
  encodeOctal(h, 116, 8, 0);

  // size (12), mtime (12)
  encodeOctal(h, 124, 12, size);
  encodeOctal(h, 136, 12, Math.floor(Date.now() / 1_000));

  h[156] = 0x30; // typeflag = '0' (regular file)

  // magic = "ustar\0"  (6 bytes)
  h[257] = 0x75;
  h[258] = 0x73;
  h[259] = 0x74;
  h[260] = 0x61;
  h[261] = 0x72;
  h[262] = 0x00;

  // version = "00" (2 bytes)
  h[263] = 0x30;
  h[264] = 0x30;

  // checksum: first fill chksum field (bytes 148-155) with spaces
  for (let i = 148; i < 156; i++) h[i] = 0x20;

  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];

  // chksum: 6 octal digits + NUL + space = 8 bytes
  const cks = sum.toString(8).padStart(6, "0") + "\0 ";
  for (let i = 0; i < 8; i++) h[148 + i] = cks.charCodeAt(i);

  return h;
}

/** Pack files into an uncompressed tar byte buffer. */
export function packTar(files: Map<string, Uint8Array>): Uint8Array {
  let total = 0;
  for (const [, data] of files) {
    total += BLOCK; // header
    total += padToBlock(data.length); // data
  }
  total += 2 * BLOCK; // end-of-archive zero blocks

  const out = new Uint8Array(total);
  let off = 0;

  for (const [name, data] of files) {
    out.set(createHeader(name, data.length), off);
    off += BLOCK;

    out.set(data, off);
    off += padToBlock(data.length);
  }

  // remaining is already zero-filled (end-of-archive)
  return out;
}

/** List file names from an uncompressed tar buffer. */
export function listTar(buf: Uint8Array): string[] {
  const names: string[] = [];
  let off = 0;
  const decoder = new TextDecoder();

  while (off + BLOCK <= buf.length) {
    // Check end-of-archive (all-zero block)
    let end = true;
    for (let i = 0; i < BLOCK; i++) {
      if (buf[off + i] !== 0) {
        end = false;
        break;
      }
    }
    if (end) break;

    const nameEnd = buf.indexOf(0, off);
    const name =
      nameEnd >= off && nameEnd < off + 100
        ? decoder.decode(buf.slice(off, nameEnd))
        : decoder.decode(buf.slice(off, off + 100));

    const sizeStr = decoder.decode(buf.slice(off + 124, off + 136));
    const size = parseInt(sizeStr.trim(), 8) || 0;

    names.push(name.split("\0")[0]);
    off += BLOCK + padToBlock(size);
  }
  return names;
}

/** Extract files from an uncompressed tar buffer. */
export function extractTar(
  buf: Uint8Array,
  filter?: (name: string) => boolean,
): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  let off = 0;
  const decoder = new TextDecoder();

  while (off + BLOCK <= buf.length) {
    let end = true;
    for (let i = 0; i < BLOCK; i++) {
      if (buf[off + i] !== 0) {
        end = false;
        break;
      }
    }
    if (end) break;

    const nameEnd = buf.indexOf(0, off);
    const name =
      nameEnd >= off && nameEnd < off + 100
        ? decoder.decode(buf.slice(off, nameEnd))
        : decoder.decode(buf.slice(off, off + 100));

    const sizeStr = decoder.decode(buf.slice(off + 124, off + 136));
    const size = parseInt(sizeStr.trim(), 8) || 0;

    off += BLOCK;

    if (!filter || filter(name)) {
      files.set(name.split("\0")[0], size > 0 ? buf.slice(off, off + size) : new Uint8Array(0));
    }

    off += padToBlock(size);
  }
  return files;
}

// ── High-level helpers ────────────────────────────────────────────

/** Compress files into a .tar.gz blob. */
export function packTarGz(files: Map<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  return gzipSync(packTar(files) as Uint8Array<ArrayBuffer>);
}

/** List entries inside a .tar.gz blob. */
export function listTarGz(compressed: Uint8Array): string[] {
  return listTar(gunzipSync(compressed as Uint8Array<ArrayBuffer>));
}

/** Extract entries from a .tar.gz blob. */
export function extractTarGz(
  compressed: Uint8Array,
  filter?: (name: string) => boolean,
): Map<string, Uint8Array> {
  return extractTar(gunzipSync(compressed as Uint8Array<ArrayBuffer>), filter);
}
