// =============================================================================
// tools/png8.mjs —— 最小 PNG 解码器（专治 **索引色 / 8bpp** 图）
//
// 为什么不用 flatiso 的 core/png.mjs：
//   flatiso 的 decodePNG **不处理调色板 PNG 的 tRNS 块**，
//   读 xUSSR 之类的 8bpp 精灵时会把透明像素也当成不透明（alpha 全 255），
//   于是没法用 alpha 求 bbox、也没法做叠加比对。见 docs/踩坑.md C4。
//
// 支持：color type 3（索引色），bit depth 1/2/4/8，PLTE + tRNS，
//       扫描线滤波 0~4。非索引色的 PNG 请直接用 flatiso 的 decodePNG。
// =============================================================================

import zlib from 'node:zlib';

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** 解一个索引色 PNG → { width, height, rgba }
 *  opts.keyRGB —— 指定一个 RGB 当作透明（TTD/OpenTTD 的 8bpp 精灵惯例是
 *                 **magic blue = (0,0,255)**，它们**没有 tRNS 块**）。
 *                 不传时只用 tRNS。
 */
export function decodePalettePNG(buf, opts = {}) {
  const keyRGB = opts.keyRGB ?? null;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== SIG[i]) throw new Error('不是 PNG');
  }
  let p = 8;
  let W = 0, H = 0, depth = 8, colorType = 3, interlace = 0;
  let plte = null, trns = null;
  const idat = [];

  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      W = data.readUInt32BE(0);
      H = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      plte = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    p += 12 + len;
  }

  if (colorType !== 3) throw new Error(`png8 只处理索引色（colorType 3），这张是 ${colorType}`);
  if (interlace) throw new Error('png8 不支持隔行扫描');
  if (!plte) throw new Error('索引色 PNG 缺 PLTE');

  const raw = zlib.inflateSync(Buffer.concat(idat));

  // 每像素字节数（索引色一律 1，因为一个索引最多 1 字节）
  const bpp = 1;
  const stride = Math.ceil((W * depth) / 8);
  const out = Buffer.alloc(stride * H);

  for (let y = 0; y < H; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      const v = line[x];
      let val;
      switch (ft) {
        case 0: val = v; break;
        case 1: val = v + a; break;
        case 2: val = v + b; break;
        case 3: val = v + ((a + b) >> 1); break;
        case 4: val = v + paeth(a, b, c); break;
        default: throw new Error(`未知滤波类型 ${ft}`);
      }
      cur[x] = val & 0xff;
    }
  }

  // 索引 → RGBA
  const rgba = new Uint8Array(W * H * 4);
  const maxIdx = (plte.length / 3) - 1;
  const getIdx = (x, y) => {
    if (depth === 8) return out[y * stride + x];
    const per = 8 / depth;
    const byte = out[y * stride + Math.floor(x / per)];
    const shift = 8 - depth * ((x % per) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let idx = getIdx(x, y);
      if (idx > maxIdx) idx = 0;
      const o = (y * W + x) * 4;
      rgba[o] = plte[idx * 3];
      rgba[o + 1] = plte[idx * 3 + 1];
      rgba[o + 2] = plte[idx * 3 + 2];
      rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { width: W, height: H, rgba, hasTRNS: !!trns, keyRGB };
}

/** 把 keyRGB（magic blue）刷成透明。8bpp 精灵没有 tRNS，只能这样认。 */
export function applyKeyColor(im, keyRGB = [0, 0, 255]) {
  const { rgba } = im;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] === keyRGB[0] && rgba[i + 1] === keyRGB[1] && rgba[i + 2] === keyRGB[2]) {
      rgba[i + 3] = 0;
    }
  }
  return im;
}

/** 整数倍最近邻放大 */
export function upscaleNN(src, w, h, k) {
  const out = new Uint8Array(w * k * h * k * 4);
  for (let y = 0; y < h * k; y++) {
    for (let x = 0; x < w * k; x++) {
      const si = (Math.floor(y / k) * w + Math.floor(x / k)) * 4;
      const di = (y * w * k + x) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
    }
  }
  return out;
}
