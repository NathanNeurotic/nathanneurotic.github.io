// VPK0 decompressor, ported from the game's own decoder (syDmaDecodeVpk0 in
// src/sys/dma.c of the decomp). The stream is read MSB-first, fed by
// big-endian 16-bit units.

export function vpk0Size(src, off = 0) {
  if (src[off] !== 0x76 || src[off + 1] !== 0x70 || src[off + 2] !== 0x6b || src[off + 3] !== 0x30) {
    throw new Error("vpk0: bad magic");
  }
  return ((src[off + 4] << 24) | (src[off + 5] << 16) | (src[off + 6] << 8) | src[off + 7]) >>> 0;
}

/** Decompress the vpk0 stream at src[off...] into dst (length = decompressed size). */
export function vpk0Decompress(src, off, dst) {
  let pos = off;
  let buf = 0; // bit buffer (up to 32 bits used)
  let nbits = 0;

  const bits = (n) => {
    if (n === 0) return 0;
    if (n > 16) return (bits(n - 16) * 65536 + bits(16)) >>> 0;
    if (nbits < n) {
      buf = ((buf << 16) | (src[pos] << 8) | src[pos + 1]) >>> 0;
      pos += 2;
      nbits += 16;
    }
    nbits -= n;
    return (buf >>> nbits) & ((1 << n) - 1);
  };

  bits(32); // "vpk0"
  const size = bits(32) >>> 0;
  if (size !== dst.length) throw new Error(`vpk0: size ${size} != expected ${dst.length}`);
  const method = bits(8);

  const readTree = () => {
    const stack = [];
    for (;;) {
      if (bits(1)) {
        if (stack.length < 2) break;
        const right = stack.pop();
        const left = stack.pop();
        stack.push({ left, right, value: 0 });
      } else {
        stack.push({ left: null, right: null, value: bits(8) });
      }
    }
    return stack[0] || null;
  };
  const readValue = (tree) => {
    let node = tree;
    while (node.left !== null) node = bits(1) ? node.right : node.left;
    return bits(node.value);
  };

  const offsets = readTree();
  const lengths = readTree();

  let out = 0;
  while (out < size) {
    if (!bits(1)) {
      dst[out++] = bits(8);
      continue;
    }
    let from;
    if (method !== 0) {
      let extra = 0;
      let v = readValue(offsets);
      if (v <= 2) {
        extra = v + 1;
        v = readValue(offsets);
      }
      from = out - v * 4 - extra + 8;
    } else {
      from = out - readValue(offsets);
    }
    let n = readValue(lengths);
    if (from < 0 || out + n > size) throw new Error("vpk0: corrupt stream");
    while (n-- > 0) dst[out++] = dst[from++];
  }
  return dst;
}
