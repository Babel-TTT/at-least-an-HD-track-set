// =============================================================================
// tools/compare.mjs —— 三方差集对照：参照包 / xUSSR / 我方，画在**同一个瓦片锚点**上
//
//   左   China-Set-Tracks 的 32bpp 4x 精灵（半成品，只作画风参考）
//   中左 xUSSR 通用轨道包的 8bpp 精灵 **4 倍最近邻放大**（成熟实现，看"对"是什么样）
//   中右 我方精灵
//   右   叠加（参照染青 / 我方染红）
//
// 画布上会画出：
//   * 瓦片菱形轮廓（洋红）—— 相对锚点固定，不随精灵内容变化
//   * 每 16 px 一条的水平标尺（= 每 0.25 格高度）
//   * 地面中心线（黄）
//
//   node tools/compare.mjs   （或 make diag）
//   产物 out/calibrate/compare.png           整张对照
//        out/calibrate/compare_zoom_<模型>.png  裁到轨道附近 + 3×，看纹理用这张
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { config, log, fail, rel, isMain, anchorToXrelYrel } from './util.mjs';
import { decodePalettePNG, applyKeyColor } from './png8.mjs';

const PANEL_W = 320;
const PANEL_H = 400;
const ANCHOR_X = 160;   // 瓦片原点（菱形上顶点）在面板内的列
const ANCHOR_Y = 170;   // 瓦片原点在面板内的行
const GAP = 10;

/** 参照包（China-Set-Tracks）：X_SIZE 256 / Y_SIZE 310 / XOFFSET -124 / YOFFSET -182 */
const REF_DIR = 'D:/CNS/CNST/local/China-Set-Tracks/China-Set-Tracks/vox/normal';
const REF_PITCH = 264;
const REF_XREL = -124;
const REF_YREL = -182;

/** xUSSR 通用轨道包：8bpp 原尺寸，锚点来自其 railsprite.pnml 的模板 */
const XUSSR_DIR = 'D:/CNS/CNST/local/xUSSR-Rails-Europa-Redux-main/src/rails';

/** 对照表：我方模型 ↔ 参照图/格 ↔ xUSSR 图/格 */
const PAIRS = [
  {
    model: 'probe_track_x', ref: '01_32bpp.png', cell: 0, note: 'TRACK_X 直线',
    // rail_underlay_template(2,185) 第 0 条 = RTO_X
    xussr: { file: 'rail1.png', rect: [2, 185, 64, 31], xrel: -31, yrel: 0 },
  },
  {
    model: 'probe_half_upper', ref: '04_32bpp.png', cell: 0, note: 'TRACK_UPPER 上半格',
    // rail_underlay_template(2,185) 第 2 条 = RTO_N
    xussr: { file: 'rail0.png', rect: [162, 185, 64, 16], xrel: -31, yrel: 0 },
  },
];

function blankPanel() {
  const px = new Uint8Array(PANEL_W * PANEL_H * 4);
  for (let y = 0; y < PANEL_H; y++) {
    for (let x = 0; x < PANEL_W; x++) {
      const v = ((x >> 3) + (y >> 3)) & 1 ? 32 : 42;
      const i = (y * PANEL_W + x) * 4;
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
    }
  }
  return px;
}

function setpx(d, x, y, rgb, a = 1) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= PANEL_W || yi >= PANEL_H) return;
  const i = (yi * PANEL_W + xi) * 4;
  d[i]     = Math.round(rgb[0] * a + d[i]     * (1 - a));
  d[i + 1] = Math.round(rgb[1] * a + d[i + 1] * (1 - a));
  d[i + 2] = Math.round(rgb[2] * a + d[i + 2] * (1 - a));
  d[i + 3] = 255;
}

function line(d, x0, y0, x1, y1, rgb, a = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    setpx(d, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, rgb, a);
  }
}

/** 画参考系：瓦片菱形轮廓 + 高度标尺 + 地面中心线 */
function drawGuides(d) {
  const ax = ANCHOR_X, ay = ANCHOR_Y;
  const nw = [ax, ay], wv = [ax - 128, ay + 64], ev = [ax + 128, ay + 64], sv = [ax, ay + 128];
  const M = [255, 80, 255];
  line(d, nw[0], nw[1], wv[0], wv[1], M);
  line(d, nw[0], nw[1], ev[0], ev[1], M);
  line(d, sv[0], sv[1], wv[0], wv[1], M);
  line(d, sv[0], sv[1], ev[0], ev[1], M);
  const G = [70, 190, 70];
  for (let k = 1; k <= 6; k++) {
    const y = ay + 64 - k * 16;
    for (let x = 4; x < PANEL_W - 4; x += 6) setpx(d, x, y, G, 0.55);
  }
  line(d, 4, ay + 64, PANEL_W - 4, ay + 64, [225, 225, 90]);
}

/**
 * 贴一块源图到面板上。
 * k = 整数倍最近邻放大（xUSSR 的 8bpp 精灵要 4× 才能和 4x 精灵同尺度）
 */
function blit(panel, src, srcW, sx0, sy0, w, h, dx, dy, tint, k = 1) {
  for (let y = 0; y < h * k; y++) {
    for (let x = 0; x < w * k; x++) {
      const si = ((sy0 + Math.floor(y / k)) * srcW + (sx0 + Math.floor(x / k))) * 4;
      const a = src[si + 3] / 255;
      if (a <= 0.03) continue;
      const rgb = tint
        ? [src[si] * 0.20 + tint[0] * 0.80, src[si + 1] * 0.20 + tint[1] * 0.80, src[si + 2] * 0.20 + tint[2] * 0.80]
        : [src[si], src[si + 1], src[si + 2]];
      setpx(panel, dx + x, dy + y, rgb, a);
    }
  }
}

function sheetNew(w, h) {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = 18; px[i * 4 + 1] = 18; px[i * 4 + 2] = 20; px[i * 4 + 3] = 255; }
  return px;
}

function sheetBlit(dst, dw, src, sw, sh, ox, oy) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const si = (y * sw + x) * 4, di = ((oy + y) * dw + ox + x) * 4;
      dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = 255;
    }
  }
}

/** 从某个面板里裁一块，按 k 倍最近邻放大后贴到目标图上 */
function cropScaled(dst, dw, src, sw, cx, cy, w, h, ox, oy, k) {
  for (let y = 0; y < h * k; y++) {
    for (let x = 0; x < w * k; x++) {
      const sx = cx + Math.floor(x / k);
      const sy = cy + Math.floor(y / k);
      if (sx < 0 || sy < 0 || sx >= sw) continue;
      const si = (sy * sw + sx) * 4;
      const di = ((oy + y) * dw + ox + x) * 4;
      if (di < 0 || di + 3 >= dst.length) continue;
      dst[di] = src[si]; dst[di + 1] = src[si + 1]; dst[di + 2] = src[si + 2]; dst[di + 3] = 255;
    }
  }
}

/** 内容 bbox + 相对地面的高度 */
function measure(src, srcW, sx0, sy0, w, h, ax, ay) {
  let top = null, bot = null, left = null, right = null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[((sy0 + y) * srcW + (sx0 + x)) * 4 + 3] <= 16) continue;
      if (top === null || y < top) top = y;
      if (bot === null || y > bot) bot = y;
      if (left === null || x < left) left = x;
      if (right === null || x > right) right = x;
    }
  }
  return { top: top - ay, bot: bot - ay, left: left - ax, right: right - ax };
}

export async function compare() {
  const cfg = config();
  const { decodePNG, encodePNG } = await import(
    pathToFileURL(path.join(cfg.flatiso, 'core', 'png.mjs')).href
  );

  const atlasPath = path.join(cfg.gfxDir, '1x1.png');
  const manPath = path.join(cfg.gfxDir, 'openttd.json');
  if (!fs.existsSync(atlasPath)) fail('先跑 make render');

  const atlas = decodePNG(fs.readFileSync(atlasPath));
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  const find = (m, v) => man.entries.find((e) => e.id === `${m}#${v}`);

  const cols = 4;
  const rows = PAIRS.length;
  const W = cols * PANEL_W + (cols + 1) * GAP;
  const H = rows * PANEL_H + (rows + 1) * GAP;
  const sheet = sheetNew(W, H);
  const panels = [];
  const report = [];
  const f = (v) => String(v).padStart(5);

  for (let row = 0; row < PAIRS.length; row++) {
    const pr = PAIRS[row];
    const e = find(pr.model, 0);
    if (!e) { log(`⚠ 找不到模型 ${pr.model}，跳过`); continue; }
    const { xrel, yrel } = anchorToXrelYrel(e, man.view);

    const refPath = path.join(REF_DIR, pr.ref);
    if (!fs.existsSync(refPath)) { log(`⚠ 找不到参照 ${refPath}，跳过`); continue; }
    const ref = decodePNG(fs.readFileSync(refPath));

    // xUSSR：8bpp 调色板 PNG，用自带的解码器（flatiso 的不处理 tRNS）
    let xu = null;
    const xuPath = path.join(XUSSR_DIR, pr.xussr.file);
    if (fs.existsSync(xuPath)) {
      try {
        xu = applyKeyColor(decodePalettePNG(fs.readFileSync(xuPath)));
      } catch (err) {
        log(`⚠ xUSSR 解码失败（${pr.xussr.file}）：${err.message}`);
      }
    } else {
      log(`⚠ 找不到 xUSSR 精灵 ${xuPath}`);
    }

    const pRef = blankPanel(), pXu = blankPanel(), pOur = blankPanel(), pOvl = blankPanel();
    drawGuides(pRef); drawGuides(pXu); drawGuides(pOur); drawGuides(pOvl);

    const [rx, ry, rw, rh] = e.rect;

    blit(pRef, ref.rgba, ref.width, pr.cell * REF_PITCH, 0, 256, ref.height,
         ANCHOR_X + REF_XREL, ANCHOR_Y + REF_YREL, null);

    if (xu) {
      const [ux, uy, uw, uh] = pr.xussr.rect;
      // 8bpp 精灵 4× 放大 ⇒ 锚点偏移也 ×4（正常缩放一瓦片 64 px → 4x 是 256 px）
      blit(pXu, xu.rgba, xu.width, ux, uy, uw, uh,
           ANCHOR_X + pr.xussr.xrel * 4, ANCHOR_Y + pr.xussr.yrel * 4, null, 4);
    }

    blit(pOur, atlas.rgba, atlas.width, rx, ry, rw, rh,
         ANCHOR_X + xrel, ANCHOR_Y + yrel, null);

    blit(pOvl, ref.rgba, ref.width, pr.cell * REF_PITCH, 0, 256, ref.height,
         ANCHOR_X + REF_XREL, ANCHOR_Y + REF_YREL, [0, 240, 240]);
    blit(pOvl, atlas.rgba, atlas.width, rx, ry, rw, rh,
         ANCHOR_X + xrel, ANCHOR_Y + yrel, [255, 60, 60]);

    const y0 = GAP + row * (PANEL_H + GAP);
    sheetBlit(sheet, W, pRef, PANEL_W, PANEL_H, GAP, y0);
    sheetBlit(sheet, W, pXu, PANEL_W, PANEL_H, GAP + PANEL_W + GAP, y0);
    sheetBlit(sheet, W, pOur, PANEL_W, PANEL_H, GAP + 2 * (PANEL_W + GAP), y0);
    sheetBlit(sheet, W, pOvl, PANEL_W, PANEL_H, GAP + 3 * (PANEL_W + GAP), y0);
    panels.push({ pr, pRef, pXu, pOur });

    const ourM = measure(atlas.rgba, atlas.width, rx, ry, rw, rh, -xrel, -yrel);
    const refM = measure(ref.rgba, ref.width, pr.cell * REF_PITCH, 0, 256, ref.height, -REF_XREL, -REF_YREL);
    // xUSSR 是 8bpp 原尺寸，量出来的偏移是 **1x 像素**，要 ×4 才能和 4x 的数字比
    const xuM1 = xu ? measure(xu.rgba, xu.width, pr.xussr.rect[0], pr.xussr.rect[1],
                              pr.xussr.rect[2], pr.xussr.rect[3],
                              -pr.xussr.xrel, -pr.xussr.yrel) : null;
    const xuM = xuM1 ? {
      left: xuM1.left * 4, right: xuM1.right * 4,
      top: xuM1.top * 4, bot: xuM1.bot * 4,
    } : null;

    report.push({
      model: pr.model, ref: `${pr.ref}#${pr.cell}`, note: pr.note,
      ourAnchor: [xrel, yrel], refAnchor: [REF_XREL, REF_YREL], xussrAnchor: pr.xussr,
      ourBBox: ourM, refBBox: refM, xussrBBox: xuM,
    });

    log(`  ${pr.model}  ↔  ${pr.ref}#${pr.cell}  (${pr.note})`);
    log(`     相对瓦片原点 bbox： 参照 x[${f(refM.left)},${f(refM.right)}] y[${f(refM.top)},${f(refM.bot)}]` +
        `   xUSSR x[${xuM ? f(xuM.left) : '  -  '},${xuM ? f(xuM.right) : '  -  '}] y[${xuM ? f(xuM.top) : '  -  '},${xuM ? f(xuM.bot) : '  -  '}]` +
        `   我方 x[${f(ourM.left)},${f(ourM.right)}] y[${f(ourM.top)},${f(ourM.bot)}]`);
  }

  const outDir = path.join(cfg.outDir, 'calibrate');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'compare.png');
  fs.rmSync(outFile, { force: true });   // 见 docs/踩坑.md C5
  fs.writeFileSync(outFile, encodePNG(W, H, sheet));
  fs.writeFileSync(path.join(outDir, 'compare.json'), JSON.stringify(report, null, 2) + '\n');

  // 裁到轨道附近 + 放大，三张竖排：参照 / xUSSR / 我方
  // （整张图在屏幕上会被缩到看不出纹理，必须裁小再放大）
  const CX = ANCHOR_X - 100;
  const CY = ANCHOR_Y + 8;
  const CW = 200;
  const CH = 108;
  const K = 3;
  for (const { pr, pRef, pXu, pOur } of panels) {
    const zW = CW * K;
    const zH = CH * K * 3 + GAP * 2;
    const zs = sheetNew(zW, zH);
    cropScaled(zs, zW, pRef, PANEL_W, CX, CY, CW, CH, 0, 0, K);
    cropScaled(zs, zW, pXu, PANEL_W, CX, CY, CW, CH, 0, CH * K + GAP, K);
    cropScaled(zs, zW, pOur, PANEL_W, CX, CY, CW, CH, 0, 2 * (CH * K + GAP), K);
    const zf = path.join(outDir, `compare_zoom_${pr.model}.png`);
    fs.rmSync(zf, { force: true });
    fs.writeFileSync(zf, encodePNG(zW, zH, zs));
    log(`✔ ${path.resolve(zf)}`);
    log(`   （裁剪 ${CW}×${CH} + ${K}×；上=参照 China-Set-Tracks / 中=xUSSR 4× / 下=我方）`);
  }

  log(`✔ ${path.resolve(outFile)}`);
  log(`  （相对路径 ${rel(outFile)} —— out/ 会被 make clean 删掉，重建用 make diag）`);
  log('  每行四栏：参照 / xUSSR(4×) / 我方 / 叠加(参照青·我方红)');
  log('  洋红菱形 = 瓦片轮廓；黄线 = 地面中心线；绿横线每 16px = 0.25 格高度');
  return outFile;
}

if (isMain(import.meta.url)) {
  compare();
}
