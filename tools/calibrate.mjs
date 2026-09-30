// =============================================================================
// tools/calibrate.mjs —— P1 定标：把渲染出的精灵连同「瓦片菱形轮廓」一起画出来
//
// 目的有两个：
//   ① 验证 xrel/yrel 锚点：把瓦片 NW 角的屏幕位置画成菱形轮廓，
//      如果轮廓正好压在我们模型的瓦片地坪边缘上，锚点就是对的。
//   ② 定出「flatiso 朝向序号 ↔ OpenTTD trackbit」的对应关系：
//      把每个模型的 4 个朝向并排画出来，与 China-Set-Tracks 的参照图比对。
//
// 只读 flatiso 的 core/png.mjs（纯消费者，不改 flatiso 仓库）。
//
//   node tools/calibrate.mjs
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { config, log, fail, rel, isMain, anchorToXrelYrel, readTemplates } from './util.mjs';

const SCALE = 2;
const PAD = 6;

function checker(w, h, a = 34, b = 46) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = ((x >> 3) + (y >> 3)) & 1 ? a : b;
      const i = (y * w + x) * 4;
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
    }
  }
  return px;
}

function blend(dst, dw, dh, src, sw, sh, ox, oy) {
  for (let y = 0; y < sh; y++) {
    const ty = oy + y;
    if (ty < 0 || ty >= dh) continue;
    for (let x = 0; x < sw; x++) {
      const tx = ox + x;
      if (tx < 0 || tx >= dw) continue;
      const si = (y * sw + x) * 4;
      const a = src[si + 3];
      if (!a) continue;
      const di = (ty * dw + tx) * 4;
      const af = a / 255;
      dst[di]     = Math.round(src[si]     * af + dst[di]     * (1 - af));
      dst[di + 1] = Math.round(src[si + 1] * af + dst[di + 1] * (1 - af));
      dst[di + 2] = Math.round(src[si + 2] * af + dst[di + 2] * (1 - af));
      dst[di + 3] = 255;
    }
  }
}

function px(dst, w, h, x, y, rgb) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  dst[i] = rgb[0]; dst[i + 1] = rgb[1]; dst[i + 2] = rgb[2]; dst[i + 3] = 255;
}

function line(dst, w, h, x0, y0, x1, y1, rgb) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    px(dst, w, h, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), rgb);
  }
}

/** 用双线性附近取整做整数倍放大（最近邻即可） */
function upscale(src, sw, sh, k) {
  const out = new Uint8Array(sw * k * sh * k * 4);
  for (let y = 0; y < sh * k; y++) {
    for (let x = 0; x < sw * k; x++) {
      const si = (Math.floor(y / k) * sw + Math.floor(x / k)) * 4;
      const di = (y * sw * k + x) * 4;
      out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = src[si + 3];
    }
  }
  return out;
}

export async function calibrate() {
  const cfg = config();
  const atlasPath = path.join(cfg.gfxDir, '1x1.png');
  const manPath = path.join(cfg.gfxDir, 'openttd.json');
  if (!fs.existsSync(atlasPath) || !fs.existsSync(manPath)) fail('先跑 make render');

  const { decodePNG, encodePNG } = await import(
    pathToFileURL(path.join(cfg.flatiso, 'core', 'png.mjs')).href
  );

  const atlas = decodePNG(fs.readFileSync(atlasPath));
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  // 摆放事实来源：手写的 templates.pnml（工具只读）
  const templates = readTemplates();
  const byModel = new Map();
  for (const e of man.entries) {
    const n = String(e.id).split('#')[0];
    if (!byModel.has(n)) byModel.set(n, []);
    byModel.get(n).push(e);
  }
  for (const l of byModel.values()) l.sort((a, b) => (a.view ?? 0) - (b.view ?? 0));

  const outDir = path.join(cfg.outDir, 'calibrate');
  fs.mkdirSync(outDir, { recursive: true });

  const models = [...byModel.keys()];
  const views = Math.max(...[...byModel.values()].map((l) => l.length));
  const cw = Math.max(...man.entries.map((e) => e.size[0])) + PAD * 2;
  const ch = Math.max(...man.entries.map((e) => e.size[1])) + PAD * 2;

  const W = cw * views * SCALE;
  const H = ch * models.length * SCALE;
  const sheet = checker(W, H);

  const report = [];

  models.forEach((name, row) => {
    byModel.get(name).forEach((e, col) => {
      // 摆放事实来自**手写**的 src/rails/templates.pnml（不是 here 算出来的）
      const tpl = templates.get(String(e.id));
      if (!tpl) {
        log(`⚠ templates.pnml 里没有 ${e.id}，跳过`);
        return;
      }
      const [sx, sy, sw, sh] = tpl.rect;
      // 从图集里抠出这一格
      const cell = new Uint8Array(sw * sh * 4);
      for (let y = 0; y < sh; y++) {
        const srow = ((sy + y) * atlas.width + sx) * 4;
        cell.set(atlas.rgba.subarray(srow, srow + sw * 4), y * sw * 4);
      }
      // 画瓦片菱形轮廓：NW 角（瓦片原点）落在精灵内的 (rx, ry)
      const { xrel, yrel } = tpl;
      const rx = -xrel;
      const ry = -yrel;
      const nw = [rx, ry], wv = [rx - 128, ry + 64], ev = [rx + 128, ry + 64], sv = [rx, ry + 128];
      const drawn = cell.slice();
      const CYAN = [255, 0, 255];
      line(drawn, sw, sh, nw[0], nw[1], wv[0], wv[1], CYAN);
      line(drawn, sw, sh, nw[0], nw[1], ev[0], ev[1], CYAN);
      line(drawn, sw, sh, sv[0], sv[1], wv[0], wv[1], CYAN);
      line(drawn, sw, sh, sv[0], sv[1], ev[0], ev[1], CYAN);
      // 中心十字
      line(drawn, sw, sh, rx - 6, ry + 64, rx + 6, ry + 64, [0, 255, 0]);
      line(drawn, sw, sh, rx, ry + 58, rx, ry + 70, [0, 255, 0]);

      const big = upscale(drawn, sw, sh, SCALE);
      blend(sheet, W, H, big, sw * SCALE, sh * SCALE, col * cw * SCALE + PAD * SCALE, row * ch * SCALE + PAD * SCALE);

      report.push({ model: name, view: e.view, azimuth: e.azimuth, rect: tpl.rect, flatisoXrel: e.xrel, flatisoYrel: e.yrel, xrel, yrel, anchorInSprite: [rx, ry], size: e.size, templateLine: tpl.line });
    });
  });

  const sheetFile = path.join(outDir, 'anchors.png');
  fs.rmSync(sheetFile, { force: true });   // 见 docs/踩坑.md C5
  fs.writeFileSync(sheetFile, encodePNG(W, H, sheet));
  fs.writeFileSync(path.join(outDir, 'anchors.json'), JSON.stringify(report, null, 2) + '\n');

  log(`✔ ${path.resolve(sheetFile)}`);
  log(`  （相对路径 ${rel(sheetFile)} —— out/ 会被 make clean 删掉，重建用 make diag）`);
  log(`  行序：${models.join('  |  ')}`);
  log('  洋红十字 = 瓦片菱形轮廓；绿色十字 = 瓦片中心。轮廓应正好压在模型的瓦片地坪边缘上。');
  return sheetFile;
}

if (isMain(import.meta.url)) {
  calibrate();
}
