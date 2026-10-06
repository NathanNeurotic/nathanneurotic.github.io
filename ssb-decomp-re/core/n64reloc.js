// N64 relocData table (US ROM) and reloc-chain parsing.
// Format: src/lb/lbtypes.h (LBTableEntry, LBRelocDesc) and src/lb/lbreloc.c.
import { vpk0Decompress } from "./vpk0.js";

export const ROM_RELOC_TABLE = 0x1ac870;
export const RELOC_FILE_COUNT = 2132;

export function readRelocTable(rom) {
  const v = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  const entries = [];
  for (let i = 0; i <= RELOC_FILE_COUNT; i++) {
    const o = ROM_RELOC_TABLE + 12 * i;
    const w0 = v.getUint32(o, false);
    entries.push({
      compressed: w0 >>> 31 === 1,
      dataOffset: w0 & 0x7fffffff,
      intern: v.getUint16(o + 4, false),
      csize: v.getUint16(o + 6, false),
      extern: v.getUint16(o + 8, false),
      dsize: v.getUint16(o + 10, false),
    });
  }
  return entries;
}

export const relocTableHi = () => ROM_RELOC_TABLE + 12 * (RELOC_FILE_COUNT + 1);

/** Decompressed (big-endian) bytes of relocData file `fid`. */
export function relocFileBytes(rom, table, fid, scratch) {
  const e = table[fid];
  const start = relocTableHi() + e.dataOffset;
  const size = e.dsize * 4;
  if (!e.compressed) return rom.subarray(start, start + size);
  const dst = scratch && scratch.length >= size ? scratch.subarray(0, size) : new Uint8Array(size);
  return vpk0Decompress(rom, start, dst);
}

/** Extern file ids stored after the (compressed) payload, big-endian u16. */
export function externIds(rom, table, fid) {
  const hi = relocTableHi();
  const start = hi + table[fid].dataOffset + table[fid].csize * 4;
  const end = hi + table[fid + 1].dataOffset;
  const ids = [];
  for (let o = start; o + 2 <= end; o += 2) ids.push((rom[o] << 8) | rom[o + 1]);
  return ids;
}

/**
 * Walk the intern and extern chains of a decompressed file.
 * Returns [{slot, target, fid, ext}] with byte offsets; extern ids are paired
 * in chain order, exactly as lbRelocLoadAndRelocFile reads them.
 */
export function walkRelocs(fid, file, entry, ids) {
  const out = [];
  const walk = (head, ext) => {
    const seen = new Set();
    let k = 0;
    for (let s = head; s !== 0xffff; ) {
      if (seen.has(s) || s * 4 + 4 > file.length) throw new Error(`relocData ${fid}: bad reloc chain`);
      seen.add(s);
      const o = s * 4;
      const next = (file[o] << 8) | file[o + 1];
      const tgt = (file[o + 2] << 8) | file[o + 3];
      if (ext && k >= ids.length) throw new Error(`relocData ${fid}: extern chain longer than id list`);
      out.push({ slot: o, target: tgt * 4, fid: ext ? ids[k++] : fid, ext });
      s = next;
    }
  };
  walk(entry.intern, false);
  walk(entry.extern, true);
  return out;
}
