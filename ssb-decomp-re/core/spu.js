// SPU2 sample set: exact port of ps2/tools/spu_samples.py.
// VADPCM / raw16 -> (loop unroll + Catmull-Rom resample) -> PS-ADPCM.
// Arithmetic follows the Python/numpy operation order so the output is
// bit-identical (doubles, round-half-even, floor shifts).

export const SPU_SAMPLES_VROM = 0x28000000;
const LOOP_MIN = 28 * 50;
const BANKS = [
  [0xb4e5c0, 0xb54ce0, 0xb54ce0], // B1_sounds1: music instruments
  [0xc6b650, 0xc7b1f0, 0xc7b1f0], // B1_sounds2: sound effects / voices
];
const FILTERS = [[0, 0], [60, 0], [115, -52], [98, -55], [122, -60]];

/** Python round() / numpy.round(): half to even. */
function rint(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
const pymod = (a, n) => ((a % n) + n) % n;

export function collectWaves(rom) {
  const v = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
  const waves = new Map();
  for (const [lo, , tbl] of BANKS) {
    const u32 = (o) => v.getUint32(lo + o, false);
    const s16 = (o) => v.getInt16(lo + o, false);
    const seen = new Set();
    const waveAt = (w) => {
      const wave = { key: tbl + u32(w), len: u32(w + 4), type: rom[lo + w + 8], loop: null, book: null };
      const loopOff = u32(w + 12);
      const bookOff = u32(w + 16);
      if (loopOff) {
        const s = u32(loopOff), e = u32(loopOff + 4), c = u32(loopOff + 8);
        if (c !== 0 && e > s) wave.loop = [s, e, c];
      }
      if (wave.type === 0) {
        const order = v.getInt32(lo + bookOff, false);
        const npred = v.getInt32(lo + bookOff + 4, false);
        const n = order * npred * 8;
        const book = new Array(n);
        for (let i = 0; i < n; i++) book[i] = s16(bookOff + 8 + 2 * i);
        wave.book = { order, npred, book };
      }
      return wave;
    };
    const inst = (io) => {
      if (io === 0 || seen.has(io)) return;
      seen.add(io);
      const count = s16(io + 14);
      for (let i = 0; i < count; i++) {
        const soff = u32(io + 16 + 4 * i);
        const w = waveAt(u32(soff + 8));
        const key = `${w.key},${w.len},${w.loop ? w.loop[0] : 0},${w.loop ? w.loop[1] : 0}`;
        if (!waves.has(key)) waves.set(key, w); // dict.setdefault
      }
    };
    const bankCount = s16(2);
    for (let b = 0; b < bankCount; b++) {
      const boff = u32(4 + 4 * b);
      const instCount = s16(boff);
      inst(u32(boff + 8)); // percussion
      for (let i = 0; i < instCount; i++) inst(u32(boff + 12 + 4 * i));
    }
  }
  const sk = (w) => [w.key, w.len, w.loop ? w.loop[0] : 0, w.loop ? w.loop[1] : 0];
  return [...waves.values()].sort((a, b) => {
    const x = sk(a), y = sk(b);
    for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  });
}

function coefTable(order, npred, book) {
  const tables = [];
  let pos = 0;
  for (let p = 0; p < npred; p++) {
    const t = [];
    for (let k = 0; k < 8; k++) t.push(new Array(order + 8).fill(0));
    for (let j = 0; j < order; j++) for (let k = 0; k < 8; k++) t[k][j] = book[pos++];
    for (let k = 1; k < 8; k++) t[k][order] = t[k - 1][order - 1];
    t[0][order] = 1 << 11;
    for (let k = 1; k < 8; k++) {
      for (let j = 0; j < k; j++) t[j][k + order] = 0;
      for (let j = k; j < 8; j++) t[j][k + order] = t[j - k][order];
    }
    tables.push(t);
  }
  return tables;
}

function decodeVadpcm(data, order, npred, book) {
  const table = coefTable(order, npred, book);
  const nframes = Math.floor(data.length / 9);
  const out = new Int32Array(nframes * 16);
  let prev = new Array(16).fill(0);
  const ix = new Array(16);
  const vec = new Array(order + 8);
  for (let f = 0; f < nframes; f++) {
    const b0 = data[f * 9];
    const scale = 1 << (b0 >> 4);
    const pred = b0 & 0xf;
    for (let q = 0; q < 8; q++) {
      const byte = data[f * 9 + 1 + q];
      const hi = byte >> 4, lo = byte & 0xf;
      ix[2 * q] = (hi >= 8 ? hi - 16 : hi) * scale;
      ix[2 * q + 1] = (lo >= 8 ? lo - 16 : lo) * scale;
    }
    const coefs = pred < table.length ? table[pred] : table[0];
    const cur = new Array(16).fill(0);
    for (let j = 0; j < 2; j++) {
      for (let k = 0; k < order; k++) vec[k] = j === 0 ? prev[16 - order + k] : cur[8 - order + k];
      for (let k = 0; k < 8; k++) vec[order + k] = ix[j * 8 + k];
      for (let i = 0; i < 8; i++) {
        const row = coefs[i];
        let acc = 0;
        for (let k = 0; k < order + 8; k++) acc += row[k] * vec[k]; // exact: |acc| < 2^53
        let s = Math.floor(acc / 2048); // Python acc >> 11
        if (s > 32767) s = 32767;
        else if (s < -32768) s = -32768;
        cur[j * 8 + i] = s;
      }
    }
    out.set(cur, f * 16);
    prev = cur;
  }
  return out;
}

function decodeWave(w, raw) {
  if (w.type === 0) return decodeVadpcm(raw, w.book.order, w.book.npred, w.book.book);
  const n = (raw.length & ~1) >> 1;
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = ((raw[2 * i] << 24) >> 16) | raw[2 * i + 1];
  return out;
}

function resample(x, nOut, periodic = false) {
  const nIn = x.length;
  if (nOut === nIn || nIn === 0) return Float64Array.from(x);
  const step = nIn / nOut;
  const out = new Float64Array(nOut);
  const at = periodic
    ? (i) => x[pymod(i, nIn)]
    : (i) => x[i < 0 ? 0 : i > nIn - 1 ? nIn - 1 : i];
  for (let n = 0; n < nOut; n++) {
    const pos = n * step;
    const i = Math.floor(pos);
    const t = pos - i;
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    out[n] = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  }
  return out;
}

function encodeBlock(pcm, base, h1, h2, nibOut) {
  let bestErr = -1, bestHdr = 0, bestN1 = 0, bestN2 = 0;
  const nibs = new Array(28);
  for (let fi = 0; fi < 5; fi++) {
    const f0 = FILTERS[fi][0], f1 = FILTERS[fi][1];
    let p1 = h1, p2 = h2, peak = 0;
    for (let k = 0; k < 28; k++) {
      const s = pcm[base + k];
      const r = s - ((p1 * f0 + p2 * f1 + 32) >> 6);
      if (r > peak) peak = r;
      else if (-r > peak) peak = -r;
      p2 = p1;
      p1 = s;
    }
    let ub0 = 0;
    while (7 << ub0 < peak && ub0 < 12) ub0++;
    const tries = ub0 < 12 ? 2 : 1;
    for (let t = 0; t < tries; t++) {
      const ub = ub0 + t;
      const shift = 12 - ub;
      const half = (1 << ub) >> 1;
      let q1 = h1, q2 = h2, err = 0;
      for (let k = 0; k < 28; k++) {
        const s = pcm[base + k];
        const pred = (q1 * f0 + q2 * f1 + 32) >> 6;
        const r = s - pred;
        let q = r >= 0 ? (r + half) >> ub : -((-r + half) >> ub);
        if (q > 7) q = 7;
        else if (q < -8) q = -8;
        let d = ((q << 12) >> shift) + pred;
        if (d > 32767) d = 32767;
        else if (d < -32768) d = -32768;
        err += (s - d) * (s - d);
        nibs[k] = q & 0xf;
        q2 = q1;
        q1 = d;
      }
      if (bestErr < 0 || err < bestErr) {
        bestErr = err;
        bestHdr = (fi << 4) | shift;
        bestN1 = q1;
        bestN2 = q2;
        for (let k = 0; k < 28; k++) nibOut[k] = nibs[k];
      }
    }
  }
  return [bestHdr, bestN1, bestN2];
}

function encodePsAdpcm(pcm, loopBlock) {
  const nblocks = pcm.length / 28;
  const size = (nblocks * 16 + 63) & ~63;
  const out = new Uint8Array(size); // tail padding blocks are all zero
  const nib = new Array(28);
  let h1 = 0, h2 = 0;
  for (let b = 0; b < nblocks; b++) {
    const [hdr, n1, n2] = encodeBlock(pcm, b * 28, h1, h2, nib);
    h1 = n1;
    h2 = n2;
    let flags = 0;
    if (loopBlock === null) {
      if (b === 0) flags |= 0x04;
      if (b === nblocks - 1) flags |= 0x01;
    } else {
      if (b === loopBlock) flags |= 0x04;
      if (b === nblocks - 1) flags |= 0x03;
    }
    const o = b * 16;
    out[o] = hdr;
    out[o + 1] = flags;
    for (let i = 0; i < 14; i++) out[o + 2 + i] = nib[2 * i] | (nib[2 * i + 1] << 4);
  }
  return out;
}

function convertWave(w, raw) {
  const pcm = decodeWave(w, raw);
  let out, loopBlock, pitch;
  if (w.loop) {
    let [ls, le] = w.loop;
    le = Math.min(le, pcm.length);
    ls = Math.min(ls, le - 1);
    if (ls < 0 || le <= ls) throw new Error(`sample 0x${w.key.toString(16)}: empty loop`);
    const body0 = pcm.subarray(ls, le);
    const k = body0.length >= LOOP_MIN ? 1 : Math.ceil(LOOP_MIN / body0.length);
    const body = new Int32Array(body0.length * k);
    for (let i = 0; i < k; i++) body.set(body0, i * body0.length);
    const nLoop = Math.max(28, rint(body.length / 28.0) * 28);
    const r = nLoop / body.length;
    const head = resample(pcm.subarray(0, ls), rint(ls * r));
    const bodyR = resample(body, nLoop, true);
    const pad = pymod(-head.length, 28);
    out = new Float64Array(pad + head.length + bodyR.length);
    out.set(head, pad);
    out.set(bodyR, pad + head.length);
    loopBlock = Math.floor((pad + head.length) / 28);
    pitch = r;
  } else {
    const pad = pcm.length ? pymod(-pcm.length, 28) : 28;
    out = new Float64Array(pcm.length + pad);
    out.set(pcm);
    loopBlock = null;
    pitch = 1.0;
  }
  const ints = new Int32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const r = rint(out[i]);
    ints[i] = r > 32767 ? 32767 : r < -32768 ? -32768 : r;
  }
  return { data: encodePsAdpcm(ints, loopBlock), pitch };
}

/** Build the SPU sample region. onProgress(done, total) is optional. */
export function buildSpuSamples(rom, onProgress) {
  const waves = collectWaves(rom);
  const results = [];
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i];
    results.push(convertWave(w, rom.subarray(w.key, w.key + w.len)));
    if (onProgress) onProgress(i + 1, waves.length);
  }
  const dataStart = (16 + 32 * results.length + 63) & ~63;
  let total = dataStart;
  for (const r of results) total += r.data.length;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  out.set([0x53, 0x50, 0x55, 0x53]); // "SPUS"
  v.setUint32(4, 1, true);
  v.setUint32(8, results.length, true);
  v.setUint32(12, 16, true);
  let pos = dataStart;
  for (let i = 0; i < results.length; i++) {
    const w = waves[i], r = results[i], o = 16 + 32 * i;
    v.setUint32(o, w.key, true);
    v.setUint32(o + 4, w.len, true);
    v.setUint32(o + 8, w.loop ? w.loop[0] : 0, true);
    v.setUint32(o + 12, w.loop ? w.loop[1] : 0, true);
    v.setUint32(o + 16, pos, true);
    v.setUint32(o + 20, r.data.length, true);
    v.setFloat32(o + 24, r.pitch, true);
    v.setUint32(o + 28, w.loop ? 1 : 0, true);
    out.set(r.data, pos);
    pos += r.data.length;
  }
  return out;
}
