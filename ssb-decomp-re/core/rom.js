// ROM identification: byte order (.z64 / .v64 / .n64), size and SHA-1.
import { BuildError } from "./build.js";

export const ROM_SIZE = 0x1000000;
export const ROM_SHA1 = "e2929e10fccc0aa84e5776227e798abc07cedabf";

export function detectByteOrder(b) {
  const w = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  if (w === 0x80371240) return "z64"; // big-endian (native)
  if (w === 0x37804012) return "v64"; // 16-bit byte-swapped
  if (w === 0x40123780) return "n64"; // 32-bit little-endian
  return null;
}

export function toZ64InPlace(b, order) {
  if (order === "v64") {
    for (let i = 0; i + 1 < b.length; i += 2) { const t = b[i]; b[i] = b[i + 1]; b[i + 1] = t; }
  } else if (order === "n64") {
    for (let i = 0; i + 3 < b.length; i += 4) {
      let t = b[i]; b[i] = b[i + 3]; b[i + 3] = t;
      t = b[i + 1]; b[i + 1] = b[i + 2]; b[i + 2] = t;
    }
  }
}

async function sha1Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Normalise to .z64 in place and verify. Returns {order, title, code, revision}.
 * Throws BuildError with a user-facing code.
 */
export async function verifyRom(bytes) {
  if (bytes.length < 0x40) throw new BuildError("NOT_N64", `file is only ${bytes.length} bytes`);
  const order = detectByteOrder(bytes);
  if (!order) throw new BuildError("NOT_N64", "the file does not start with an N64 ROM header");
  toZ64InPlace(bytes, order);
  const title = String.fromCharCode(...bytes.subarray(0x20, 0x34)).replace(/[\0 ]+$/, "");
  const code = String.fromCharCode(...bytes.subarray(0x3b, 0x3f));
  const revision = bytes[0x3f];
  const info = { order, title, code, revision };
  if (code.startsWith("NAL") && code !== "NALE") {
    throw new BuildError("WRONG_REGION", `game code ${code}; only the USA release (NALE) is supported`);
  }
  if (bytes.length < ROM_SIZE) throw new BuildError("TRUNCATED", `${bytes.length} bytes, expected ${ROM_SIZE}`);
  if (bytes.length > ROM_SIZE) throw new BuildError("WRONG_SIZE", `${bytes.length} bytes, expected ${ROM_SIZE}`);
  const sum = await sha1Hex(bytes);
  if (sum !== ROM_SHA1) {
    throw new BuildError(code === "NALE" ? "WRONG_REVISION" : "CHECKSUM",
      `sha1 ${sum}, expected ${ROM_SHA1} (header: "${title}", ${code}, revision ${revision})`);
  }
  return info;
}
