// 零依赖 PNG 编解码器（RGBA8）。只用 node:zlib，不引任何第三方包。
//
// 编码：色型 6（真彩 + Alpha），8 位深度，逐行自适应滤波（None/Sub/Up/Average/Paeth）。
// 解码：支持色型 0/2/3/4/6 × 8 位深度，含 tRNS；不支持隔行（遇到直接报错）。

import zlib from 'node:zlib';

// ---------------------------------------------------------------- CRC
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf, from, to) {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------- 编码
function chunk(type, data) {
  const out = Buffer.allocUnsafe(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out, 4, 8 + data.length), 8 + data.length);
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * @param {number} w
 * @param {number} h
 * @param {Uint8Array|Buffer} rgba  长度必须 >= w*h*4
 * @param {{level?:number}} [opts]
 * @returns {Buffer}
 */
export function encodePNG(w, h, rgba, opts = {}) {
  const level = opts.level ?? 9;
  const stride = w * 4;
  const raw = Buffer.allocUnsafe((stride + 1) * h);
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  const best = Buffer.alloc(stride);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];

  for (let y = 0; y < h; y++) {
    const src = rgba.subarray(y * stride, y * stride + stride);
    let bestType = 0;
    let bestScore = Infinity;
    for (let t = 0; t <= 4; t++) {
      const dst = t === 0 ? line : cand[t - 1];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? src[i - 4] : 0;
        const b = prev[i];
        const c = i >= 4 ? prev[i - 4] : 0;
        let v;
        if (t === 0) v = src[i];
        else if (t === 1) v = src[i] - a;
        else if (t === 2) v = src[i] - b;
        else if (t === 3) v = src[i] - ((a + b) >> 1);
        else v = src[i] - paeth(a, b, c);
        v &= 0xff;
        dst[i] = v;
        score += v < 128 ? v : 256 - v;
      }
      if (score < bestScore) {
        bestScore = score;
        bestType = t;
        if (t !== 0) best.set(dst);
      }
    }
    raw[y * (stride + 1)] = bestType;
    (bestType === 0 ? line : best).copy(raw, y * (stride + 1) + 1);
    prev.set(src);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: truecolour + alpha
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 解码
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * @param {Buffer|Uint8Array} buf
 * @returns {{width:number,height:number,rgba:Uint8Array}}
 */
export function decodePNG(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');

  let off = 8;
  let w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  let plte = null, trns = null;
  const idat = [];

  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('latin1', off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    off += 12 + len;
  }

  if (depth !== 8) throw new Error(`不支持的位深 ${depth}`);
  if (interlace !== 0) throw new Error('不支持隔行 PNG');
  const ch = CHANNELS[ctype];
  if (!ch) throw new Error(`不支持的色型 ${ctype}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const cur = y * stride;
    const prv = cur - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[cur + i - ch] : 0;
      const bb = y > 0 ? px[prv + i] : 0;
      const c = y > 0 && i >= ch ? px[prv + i - ch] : 0;
      let v = raw[src + i];
      if (ft === 1) v += a;
      else if (ft === 2) v += bb;
      else if (ft === 3) v += (a + bb) >> 1;
      else if (ft === 4) v += paeth(a, bb, c);
      px[cur + i] = v & 0xff;
    }
  }

  // 统一成 RGBA8
  const out = new Uint8Array(w * h * 4);
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * ch, d = i * 4;
    if (ctype === 6) {
      out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3];
    } else if (ctype === 2) {
      out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = 255;
    } else if (ctype === 0) {
      out[d] = out[d + 1] = out[d + 2] = px[s]; out[d + 3] = 255;
    } else if (ctype === 4) {
      out[d] = out[d + 1] = out[d + 2] = px[s]; out[d + 3] = px[s + 1];
    } else {
      const idx = px[s];
      out[d] = plte[idx * 3]; out[d + 1] = plte[idx * 3 + 1]; out[d + 2] = plte[idx * 3 + 2];
      out[d + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { width: w, height: h, rgba: out };
}
