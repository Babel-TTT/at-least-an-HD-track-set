// 图集打包：把烘焙好的精灵按占地分类摆进**规则网格**。
//
// 规则
// ----
// * 一个占地一类（1x1 / 2x1 / 2x2 …）出**一张图集**。同一张图集里所有格子
//   尺寸完全相同，所以引擎只要记住 `cell` 与 `anchor` 两个值。
// * 绘制位置：`sx = (cx - cy) * HW - anchor.x`，`sy = (cx + cy) * HH - anchor.y`，
//   其中 (cx, cy) 是**占地中心**在地图上的世界坐标（单位：瓦片）。
// * 格子按 `col + row * cols` 顺序排列，`sprites[]` 里逐条给出 (col,row)。

import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from './png.mjs';
import { materialColor } from './materials.mjs';

const fpKey = (fp) => `${fp[0]}x${fp[1]}`;

/**
 * @param {Array<{id:string,name:string,group:string,footprint:number[],frames:Array,frame:object}>} items
 * @param {{cols?:number}} opts
 */
export function packSheets(items, opts = {}) {
  const groups = new Map();
  for (const it of items) {
    const k = fpKey(it.footprint);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }

  const sheets = [];
  for (const [key, list] of [...groups.entries()].sort()) {
    list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.rot - b.rot));

    // 统一格位：让"占地中心投影"落在同一格内像素上
    let originX = 0, originY = 0;
    for (const it of list) {
      originX = Math.max(originX, -Math.round(it.frame.x0));
      originY = Math.max(originY, -Math.round(it.frame.y0));
    }
    let W = 0, H = 0;
    for (const it of list) {
      const sx = Math.round(it.frame.x0) + originX;
      const sy = Math.round(it.frame.y0) + originY;
      it._sx = sx; it._sy = sy;
      W = Math.max(W, sx + it.frames[0].w);
      H = Math.max(H, sy + it.frames[0].h);
    }
    W += opts.gutter ?? 0;
    H += opts.gutter ?? 0;

    const cols = Math.min(list.length, opts.cols ?? 8);
    const rows = Math.ceil(list.length / cols);
    const sheetW = W * cols, sheetH = H * rows;
    const px = new Uint8Array(sheetW * sheetH * 4);

    const sprites = [];
    list.forEach((it, i) => {
      const col = i % cols, row = (i / cols) | 0;
      const ox = col * W + it._sx, oy = row * H + it._sy;
      const img = it.frames[0];
      for (let y = 0; y < img.h; y++) {
        const dy = oy + y;
        if (dy < 0 || dy >= sheetH) continue;
        for (let x = 0; x < img.w; x++) {
          const dx = ox + x;
          if (dx < 0 || dx >= sheetW) continue;
          const s = (y * img.w + x) * 4, d = (dy * sheetW + dx) * 4;
          px[d] = img.rgba[s];
          px[d + 1] = img.rgba[s + 1];
          px[d + 2] = img.rgba[s + 2];
          px[d + 3] = img.rgba[s + 3];
        }
      }
      // OpenTTD 用的锚点：该朝向的"占地西北角格角点"（模型空间原点）落在格内的像素。
      // 模型是绕占地中心旋转的，所以每个朝向这个点都不一样，必须逐朝向算。
      const off = it.originOffset ?? [0, 0];
      const ax = originX + Math.round(off[0]);
      const ay = originY + Math.round(off[1]);
      sprites.push({
        id: it.id, name: it.name, group: it.group, rot: it.rot, azimuth: it.azimuth,
        col, row,
        // 每张精灵就是**整格**：同组精灵尺寸完全一致，图集是严格规则网格。
        // 模型自身的内容只是摆在这格里的某个偏移上（见 content）。
        rect: [col * W, row * H, W, H],
        content: [ox, oy, img.w, img.h],
        /** NML spriteset 里的 xrel / yrel */
        xrel: -ax,
        yrel: -ay,
        /** 该朝向实际占的瓦片矩形（模型绕占地中心旋转后） */
        footprintRotated: it.footprintRotated ?? [[0, 0], list[0].footprint.slice()],
      });
    });

    sheets.push({
      key, footprint: list[0].footprint,
      file: `${key}.png`, preview: `${key}_preview.png`,
      cell: [W, H], cols, rows, size: [sheetW, sheetH],
      anchor: [originX, originY],
      sprites,
      _px: px,
      _W: sheetW, _H: sheetH,
    });
  }
  return sheets;
}

export function writeSheets(outDir, sheets) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const s of sheets) {
    const f = path.join(outDir, s.file);
    fs.writeFileSync(f, encodePNG(s._W, s._H, s._px));
    files.push(f);
    const p = path.join(outDir, s.preview);
    fs.writeFileSync(p, encodePNG(s._W, s._H, checker(s._px, s._W, s._H)));
    files.push(p);
  }
  return files;
}

/** 棋盘底，方便肉眼看透明边缘。 */
export function checker(px, w, h, size = 8, a = 62, b = 84) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = ((x / size | 0) + (y / size | 0)) & 1;
      const g = t ? a : b;
      const al = px[i + 3] / 255;
      out[i] = px[i] * al + g * (1 - al);
      out[i + 1] = px[i + 1] * al + g * (1 - al);
      out[i + 2] = px[i + 2] * al + g * (1 - al);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** 深色底预览（接近参考图的展示方式）。 */
export function darken(px, w, h, bg = [26, 30, 40]) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const s = i * 4;
    const al = px[s + 3] / 255;
    out[s] = px[s] * al + bg[0] * (1 - al);
    out[s + 1] = px[s + 1] * al + bg[1] * (1 - al);
    out[s + 2] = px[s + 2] * al + bg[2] * (1 - al);
    out[s + 3] = 255;
  }
  return out;
}

/** 把若干精灵横向拼成一张对照图（白底），用于肉眼检查。 */
export function contactSheet(frames, opts = {}) {
  const bg = opts.bg ?? [255, 255, 255];
  const gap = opts.gap ?? 8;
  const W = frames.reduce((s, f) => s + f.w, 0) + gap * (frames.length + 1);
  const H = Math.max(...frames.map((f) => f.h)) + gap * 2;
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    out[i * 4] = bg[0]; out[i * 4 + 1] = bg[1]; out[i * 4 + 2] = bg[2]; out[i * 4 + 3] = 255;
  }
  let ox = gap;
  for (const f of frames) {
    const oy = gap + (H - gap * 2 - f.h);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const s = (y * f.w + x) * 4, d = ((oy + y) * W + ox + x) * 4;
        const al = f.rgba[s + 3] / 255;
        out[d] = out[d] * (1 - al) + f.rgba[s] * al;
        out[d + 1] = out[d + 1] * (1 - al) + f.rgba[s + 1] * al;
        out[d + 2] = out[d + 2] * (1 - al) + f.rgba[s + 2] * al;
      }
    }
    ox += f.w + gap;
  }
  return { w: W, h: H, rgba: out };
}

/** 最近邻放大 k 倍。 */
export function upscale(img, k) {
  const w = img.w * k, h = img.h * k;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (((y / k) | 0) * img.w + ((x / k) | 0)) * 4, d = (y * w + x) * 4;
      out[d] = img.rgba[s]; out[d + 1] = img.rgba[s + 1];
      out[d + 2] = img.rgba[s + 2]; out[d + 3] = img.rgba[s + 3];
    }
  }
  return { w, h, rgba: out };
}

export { materialColor };
