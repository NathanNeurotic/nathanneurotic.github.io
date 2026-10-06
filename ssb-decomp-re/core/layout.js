// Word-layout interpreter: replays, from ROM bytes, the byte/bit arrangement
// the EE compiler produced for the typed decomp sources.
//
// A layout describes one 32-bit word as fields [bitOffset, width] in C
// allocation order. IDO (big-endian) puts allocation bit o of a field of
// width w at bits (31-o-w+1 .. 31-o) of the big-endian word; GCC on the
// little-endian EE puts it at bits (o .. o+w-1) of the little-endian word.
// Plain scalars are the same rule: u8 = width 8, u16 = width 16, u32 = 32.

export const OP_ZERO = 0; // n words of zero
export const OP_SKIP = 1; // skip n source words
export const OP_BYTES = 2; // copy n bytes unchanged (tails)
export const OP_LAYOUT0 = 8; // OP_LAYOUT0 + k: n words through layout k

export const BUILTIN_LAYOUTS = [
  [[0, 8], [8, 8], [16, 8], [24, 8]], // 0 ID   (u8 x4, texels)
  [[0, 16], [16, 16]], // 1 SW16 (u16 x2)
  [[0, 32]], // 2 SW32 (u32 / f32 / s32)
  [[0, 16], [16, 8], [24, 8]], // 3 u16, u8, u8
  [[0, 8], [8, 8], [16, 16]], // 4 u8, u8, u16
];

export function beToLe(be, fields) {
  let le = 0;
  for (let i = 0; i < fields.length; i++) {
    const off = fields[i][0], w = fields[i][1];
    if (w === 32) return be >>> 0;
    const v = (be >>> (32 - off - w)) & ((1 << w) - 1);
    le |= v << off;
  }
  return le >>> 0;
}

/** Apply an op stream: ops = Uint32Array of (code, count) pairs. */
export function applyOps(src, dst, ops, layouts) {
  const sv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const dv = new DataView(dst.buffer, dst.byteOffset, dst.byteLength);
  let s = 0;
  let d = 0;
  for (let k = 0; k < ops.length; k += 2) {
    const code = ops[k];
    const n = ops[k + 1];
    switch (code) {
      case OP_ZERO:
        dst.fill(0, d, d + 4 * n);
        d += 4 * n;
        break;
      case OP_SKIP:
        s += 4 * n;
        break;
      case OP_BYTES:
        dst.set(src.subarray(s, s + n), d);
        s += n;
        d += n;
        break;
      case OP_LAYOUT0: // ID: straight copy
        dst.set(src.subarray(s, s + 4 * n), d);
        s += 4 * n;
        d += 4 * n;
        break;
      case OP_LAYOUT0 + 1: // SW16
        for (let i = 0; i < n; i++, s += 4, d += 4) {
          dv.setUint16(d, sv.getUint16(s, false), true);
          dv.setUint16(d + 2, sv.getUint16(s + 2, false), true);
        }
        break;
      case OP_LAYOUT0 + 2: // SW32
        for (let i = 0; i < n; i++, s += 4, d += 4) dv.setUint32(d, sv.getUint32(s, false), true);
        break;
      default: {
        const L = layouts[code - OP_LAYOUT0];
        if (!L) throw new Error(`manifest: unknown op ${code}`);
        for (let i = 0; i < n; i++, s += 4, d += 4) dv.setUint32(d, beToLe(sv.getUint32(s, false), L), true);
      }
    }
  }
  if (d !== dst.length) throw new Error(`manifest: ops produced ${d} of ${dst.length} bytes`);
}
