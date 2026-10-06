// SSB64.DAT writer: port of write_pack() in ps2/tools/build_assets.py.
// Format: ps2/include/ps2/assetpack.h (little-endian, 64-byte header,
// 16-byte region entries sorted by vrom, resident regions contiguous).

export const PACK_VERSION = 1;
export const REGION_RESIDENT = 1;

const align = (x, a) => Math.ceil(x / a) * a;

/** regions: [{vrom, size, resident}] -> adds .fileOffset; returns layout info. */
export function layoutPack(regions) {
  const sorted = [...regions].sort((a, b) => a.vrom - b.vrom);
  for (let i = 0; i + 1 < sorted.length; i++) {
    if (sorted[i].vrom + sorted[i].size > sorted[i + 1].vrom) {
      throw new Error(`overlapping regions at 0x${sorted[i].vrom.toString(16)} / 0x${sorted[i + 1].vrom.toString(16)}`);
    }
  }
  const tableOffset = 64;
  const residentOffset = align(tableOffset + 16 * sorted.length, 64);
  let pos = residentOffset;
  for (const r of sorted) if (r.resident) { r.fileOffset = pos; pos += r.size; }
  const residentBytes = pos - residentOffset;
  pos = align(pos, 64);
  for (const r of sorted) if (!r.resident) { r.fileOffset = pos; pos = align(pos + r.size, 16); }
  return { sorted, tableOffset, residentOffset, residentBytes, totalSize: pos };
}

export function writePackHeader(out, layout, relocVrom, relocCount) {
  const v = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const enc = new TextEncoder();
  out.set(enc.encode("SSB64PS2"), 0);
  const fields = [PACK_VERSION, layout.sorted.length, layout.tableOffset, layout.residentBytes,
    layout.totalSize, relocVrom, relocCount, layout.residentOffset, 0, 0];
  fields.forEach((x, i) => v.setUint32(8 + 4 * i, x >>> 0, true));
  out.set(enc.encode("ssb64-ps2-pack"), 48); // build_id[16], NUL padded
  layout.sorted.forEach((r, i) => {
    const o = layout.tableOffset + 16 * i;
    v.setUint32(o, r.vrom, true);
    v.setUint32(o + 4, r.size, true);
    v.setUint32(o + 8, r.fileOffset, true);
    v.setUint32(o + 12, r.resident ? REGION_RESIDENT : 0, true);
  });
}
