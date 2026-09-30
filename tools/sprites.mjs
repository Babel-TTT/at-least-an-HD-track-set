// =============================================================================
// tools/sprites.mjs —— 手写模板表（src/rails/templates.pnml）的**查阅工具**
//
//   node tools/sprites.mjs            列出 模型#朝向 ↔ 引擎槽位 ↔ 文件行号 ↔ 当前值
//   node tools/sprites.mjs --sheet    外加 out/calibrate/index.png（**带标注的偏移索引图**）
//   node tools/sprites.mjs --sheet --zoom 3   索引图放大 3 倍（默认 2；改 ±1px 时用 3 更好看）
//   node tools/sprites.mjs --emit     打印「可整段粘贴」的 template 块（同步用）
//
// ⚠ 本工具**只读不写**。templates.pnml 是手写源文件（人工裁定 O2），
//   这里是「查名字 / 对账 / 拿当前正确值」的地方，改文件请自己动手。
//
// -----------------------------------------------------------------------------
// 名字怎么来的？
//
//   **模型名 = models/ 下那个 .model 文件的文件名（去掉 .model 后缀）。**
//   一个文件 = 一个模型；它渲染出几个朝向，就有几个 view 号（0,1,2,3…）。
//
//   在 templates.pnml 里，它对应一个 template，名字固定为：
//
//       t_<模型名>_v<朝向号>          ← 例：t_probe_half_upper_v0
//
//   而它的那一行数据是：
//
//       [x, y, w, h, xrel, yrel, "gfx/1x1.png"]
//
//   想手调摆放 → 直接改那一行的 xrel / yrel（dx 正 = 向右，dy 正 = 向下）。
//
// -----------------------------------------------------------------------------
// 「我到底要调哪一个？」—— 看下面的表，再配合 --sheet 出的索引图：
//   表里每一行都写了这个朝向**在引擎里当什么用**（TRACK_X / TRACK_UPPER …），
//   索引图里每个格子画在**同一个瓦片锚点**上，格子的行列号打在终端里。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  config, log, fail, rel, isMain,
  readManifest, readTemplates, derivedTemplates, templatesFile,
} from './util.mjs';
import { drawText } from './font5x7.mjs';

// ---------------------------------------------------------------------------
// 语义表：这个模型的第 N 个朝向，喂给引擎的哪一槽
//
// 朝向号的来源：
//   * 整格模型（probe_track_x）4 朝向，flatiso 转一圈
//   * 半格模型（probe_half_upper）4 朝向，引擎正好要 4 个方向的半格轨
//
// 槽位名对应 OpenTTD railtype 的 underlay 精灵序（见 src/rails/railsprite.pnml）：
//   X / Y = 整格直线；UPPER / LOWER / LEFT / RIGHT = 半格（对角半边）
// ---------------------------------------------------------------------------
const ROLES = {
  probe_tile: {
    what: 'P1 定标探针：朝向/角点探针（只为验证朝向，不进 underlay）',
    views: ['—', '—', '—', '—'],
  },
  probe_track_x: {
    what: 'P1 定标探针：整格直线轨（道砟铺满整格）',
    views: ['TRACK_X', 'TRACK_Y', 'TRACK_X', 'TRACK_Y'],
  },
  probe_half_upper: {
    what: 'P1 定标探针：半格轨（对角半边，用在道岔/交叉/斜接）',
    views: ['TRACK_UPPER', 'TRACK_LEFT', 'TRACK_LOWER', 'TRACK_RIGHT'],
  },
};

function pad(s, n) {
  let w = 0;
  for (const ch of String(s)) w += ch.charCodeAt(0) > 0x2000 ? 2 : 1;
  return String(s) + ' '.repeat(Math.max(0, n - w));
}

// ---------------------------------------------------------------------------
// 偏移索引图
//
// 每个「模型#朝向」一格，全部画在**同一个瓦片锚点**上，并且**把标注直接写进图里**
// （靠 tools/font5x7.mjs 那套点阵字体）—— 这样一张图就能自查自调，不用来回对终端。
//
// 每格里画什么：
//   * 深色棋格      = 背景
//   * 蓝色细格      = 每 16 px 一条；每 64 px 加亮并标数字（4x 档像素）
//   * 洋红菱形      = 瓦片轮廓（瓦片四条边）
//   * 黄十字 + 刻度 = **瓦片原点**（菱形上顶点）—— xrel/yrel 就是相对它的偏移
//   * 青色小角标    = 朝向号（view+1 个点）
//   * 下方三行      = 模型#朝向 / 当前 xrel,yrel + 行号 / rect
//
// 用的是 templates.pnml 里的 xrel/yrel —— 也就是**真会被引擎用的**那个值，
// 所以手调之后这张图立刻反映实际摆放。
// ---------------------------------------------------------------------------
const K_DEFAULT = 2;             // 放大倍数（要看 ±1~2 px 的偏移，1x 太小）；--zoom N 可改
const CELL_W_BASE = 263;         // flatiso 给 1×1 占地的固定格位
const CELL_H_BASE = 151;
const LBL_H = 62;                // 下方三行标注
const GAP = 10;
const COLS = 4;
const HEAD_H = 74;               // 顶部说明

function blankCell(w, h) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = ((x >> 3) + (y >> 3)) & 1 ? 30 : 40;
      const i = (y * w + x) * 4;
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
    }
  }
  return px;
}

function setpx(d, w, h, x, y, rgb, a = 1) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= w || yi >= h) return;
  const i = (yi * w + xi) * 4;
  d[i]     = Math.round(rgb[0] * a + d[i]     * (1 - a));
  d[i + 1] = Math.round(rgb[1] * a + d[i + 1] * (1 - a));
  d[i + 2] = Math.round(rgb[2] * a + d[i + 2] * (1 - a));
  d[i + 3] = 255;
}

function solid(d, w, h, x, y, bw, bh, rgb) {
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) setpx(d, w, h, x + i, y + j, rgb);
}

function guideLine(d, w, h, x0, y0, x1, y1, rgb, a = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    setpx(d, w, h, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, rgb, a);
  }
}

/** 蓝网格（每 16 px，每 64 px 加亮）+ 顶部/左侧数字标尺 */
function drawPixelGrid(d, w, h, k) {
  const DIM = [44, 52, 70], MID = [66, 80, 108];
  for (let v = 0; v <= CELL_W_BASE; v += 16) {
    const bright = v % 64 === 0;
    guideLine(d, w, h, v * k, 0, v * k, h - LBL_H - 1, bright ? MID : DIM, 0.9);
    if (bright) drawText(d, w, h, v * k + 2, 2, String(v), 1, [110, 140, 200]);
  }
  for (let v = 0; v <= CELL_H_BASE; v += 16) {
    const bright = v % 64 === 0;
    guideLine(d, w, h, 0, v * k, w - 1, v * k, bright ? MID : DIM, 0.9);
    if (bright && v > 0) drawText(d, w, h, 2, v * k + 2, String(v), 1, [110, 140, 200]);
  }
}

/** 瓦片参照系：菱形轮廓 + 锚点黄十字（带每 8px 刻度，方便数偏移）。坐标一律按 1x 给，内部乘 K。 */
function drawTileGuides(d, w, h, ox, oy, k) {
  const P = (v) => v * k;
  const M = [255, 80, 255];
  guideLine(d, w, h, ox, oy, ox - P(128), oy + P(64), M, 0.9);
  guideLine(d, w, h, ox, oy, ox + P(128), oy + P(64), M, 0.9);
  guideLine(d, w, h, ox, oy + P(128), ox - P(128), oy + P(64), M, 0.9);
  guideLine(d, w, h, ox, oy + P(128), ox + P(128), oy + P(64), M, 0.55);
  // 瓦片横竖中线（暗黄）
  guideLine(d, w, h, ox - P(128), oy + P(64), ox + P(128), oy + P(64), [150, 150, 60], 0.7);
  guideLine(d, w, h, ox, oy, ox, oy + P(128), [150, 150, 60], 0.7);
  // 锚点黄十字 + 每 8px 一个小刻度
  const Y = [255, 220, 60];
  guideLine(d, w, h, ox - P(28), oy, ox + P(28), oy, Y, 1);
  guideLine(d, w, h, ox, oy - P(18), ox, oy + P(18), Y, 1);
  for (let t = -32; t <= 32; t += 8) {
    if (t === 0) continue;
    const len = (t % 16 === 0) ? 3 : 2;
    guideLine(d, w, h, ox + P(t), oy - P(len), ox + P(t), oy + P(len), Y, 0.85);
    guideLine(d, w, h, ox - P(len), oy + P(t), ox + P(len), oy + P(t), Y, 0.85);
  }
}

function blit(dst, dw, dh, src, srcW, sx0, sy0, w, h, dx, dy, k) {
  for (let y = 0; y < h * k; y++) {
    for (let x = 0; x < w * k; x++) {
      const si = ((sy0 + Math.floor(y / k)) * srcW + (sx0 + Math.floor(x / k))) * 4;
      const a = src[si + 3] / 255;
      if (a <= 0.03) continue;
      setpx(dst, dw, dh, dx + x, dy + y, [src[si], src[si + 1], src[si + 2]], a);
    }
  }
}

async function indexSheet(rows, cfg, K = K_DEFAULT) {
  const { decodePNG, encodePNG } = await import(
    pathToFileURL(path.join(cfg.flatiso, 'core', 'png.mjs')).href
  );
  const atlases = new Map();
  const get = (sheet) => {
    if (!atlases.has(sheet)) {
      const p = path.join(cfg.gfxDir, sheet);
      if (!fs.existsSync(p)) fail(`找不到 ${rel(p)} —— 先跑 make render`);
      atlases.set(sheet, decodePNG(fs.readFileSync(p)));
    }
    return atlases.get(sheet);
  };

  const nRows = Math.ceil(rows.length / COLS);
  const CELL_W = CELL_W_BASE * K, CELL_H = CELL_H_BASE * K;
  const cw = CELL_W, chh = CELL_H + LBL_H;
  const W = COLS * cw + (COLS + 1) * GAP;
  const H = HEAD_H + nRows * chh + (nRows + 1) * GAP;
  const sheetPx = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { sheetPx[i * 4] = 14; sheetPx[i * 4 + 1] = 14; sheetPx[i * 4 + 2] = 17; sheetPx[i * 4 + 3] = 255; }

  // ---- 顶部说明 -----------------------------------------------------------
  const TX = GAP + 4;
  drawText(sheetPx, W, H, TX, 8, 'OFFSET INDEX -- ONE CELL PER MODEL#VIEW, ALL DRAWN ON THE SAME TILE ANCHOR', 2, [255, 235, 140]);
  drawText(sheetPx, W, H, TX, 26, 'MAGENTA DIAMOND = TILE OUTLINE', 1, [255, 110, 255]);
  drawText(sheetPx, W, H, TX + 230, 26, 'YELLOW CROSS + TICKS = TILE ORIGIN (REFERENCE FOR XREL/YREL)', 1, [255, 220, 60]);
  drawText(sheetPx, W, H, TX, 38, 'BLUE GRID = EVERY 16 PX (4X), LABELS EVERY 64 PX', 1, [110, 140, 200]);
  drawText(sheetPx, W, H, TX + 340, 38, 'CYAN CORNER DOTS = VIEW NUMBER (VIEW+1 DOTS)', 1, [80, 220, 255]);
  drawText(sheetPx, W, H, TX, 50, 'EDIT SRC/RAILS/TEMPLATES.PNML ON THE SHOWN LINE:  XREL+ = SPRITE RIGHT,  YREL+ = SPRITE DOWN', 1, [180, 230, 180]);
  drawText(sheetPx, W, H, TX + 700, 50, '*TUNED* = LINE MARKED [HAND-TUNED] IN THAT FILE', 1, [255, 160, 160]);
  guideLine(sheetPx, W, H, GAP, HEAD_H - 4, W - GAP, HEAD_H - 4, [90, 90, 110], 1);

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cell = blankCell(cw, chh);
    drawPixelGrid(cell, cw, chh, K);
    // 瓦片原点在精灵格内的位置 = (−xrel, −yrel)，也就是文件里真正生效的值
    const ax = (-r.xrel) * K, ay = (-r.yrel) * K;
    drawTileGuides(cell, cw, chh, ax, ay, K);
    const atlas = get(r.sheet);
    const [rx, ry, rw, rh] = r.rect;
    blit(cell, cw, chh, atlas.rgba, atlas.width, rx, ry, rw, rh, 0, 0, K);
    // 精灵格边框
    for (let x = 0; x < cw; x++) { setpx(cell, cw, chh, x, 0, [90, 90, 110]); setpx(cell, cw, chh, x, CELL_H - 1, [90, 90, 110]); }
    for (let y = 0; y < CELL_H; y++) { setpx(cell, cw, chh, 0, y, [90, 90, 110]); setpx(cell, cw, chh, cw - 1, y, [90, 90, 110]); }

    // 朝向角标：左上角青色小方块，个数 = view+1
    for (let v = 0; v <= r.view; v++) solid(cell, cw, chh, 6 + v * 12, 6, 9, 9, [80, 220, 255]);

    // ---- 标注 -------------------------------------------------------------
    const name = r.key.split('#')[0], view = Number(r.key.split('#')[1]);
    const ly = CELL_H + 2;
    drawText(cell, cw, chh, 2, ly, r.key + '   ' + (ROLES[name]?.views?.[view] ?? '-'), 2, [255, 255, 255]);
    drawText(cell, cw, chh, 2, ly + 18,
      'XREL,YREL = ' + r.xrel + ',' + r.yrel + '    LINE ' + r.line + (r.handTuned ? '  *TUNED*' : ''), 2,
      r.handTuned ? [255, 170, 120] : [150, 235, 150]);
    drawText(cell, cw, chh, 2, ly + 36, 'RECT ' + r.rect.join(',') + '   SPRITE ' + rw + 'X' + rh, 1, [170, 180, 200]);

    const col = i % COLS, row = Math.floor(i / COLS);
    const ox = GAP + col * (cw + GAP);
    const oy = HEAD_H + GAP + row * (chh + GAP);
    for (let y = 0; y < chh; y++) {
      for (let x = 0; x < cw; x++) {
        const si = (y * cw + x) * 4, di = ((oy + y) * W + ox + x) * 4;
        sheetPx[di] = cell[si]; sheetPx[di + 1] = cell[si + 1];
        sheetPx[di + 2] = cell[si + 2]; sheetPx[di + 3] = 255;
      }
    }
    r.row = row; r.col = col;
  }

  const outDir = path.join(cfg.outDir, 'calibrate');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'index.png');
  fs.rmSync(outFile, { force: true });   // 见 docs/踩坑.md C5
  fs.writeFileSync(outFile, encodePNG(W, H, sheetPx));
  log(`✔ 偏移索引图 ${rel(outFile)}   ${W}×${H}   共 ${nRows} 行 × ${COLS} 列`);
  log('   每格：洋红=瓦片轮廓，黄十字=瓦片原点（xrel/yrel 的参照），蓝格=每 16px，');
  log('         左上角青点数=朝向号+1；下方三行写着 模型#朝向 / xrel,yrel 与行号 / rect。');
  log('   XREL+ 右移，YREL+ 下移；改完 src/rails/templates.pnml 那一行再跑 make。');
}

// ---------------------------------------------------------------------------

export async function sprites() {
  const argv = process.argv.slice(2);
  const cfg = config();
  const man = readManifest();
  const tpl = readTemplates();
  const derived = derivedTemplates(man);

  if (!tpl.size) fail(`读不到任何 template：${rel(templatesFile())}\n   （文件是不是被删了？）`);

  // 排序：templates.pnml 里的出现顺序（也就是文件的顺序）
  const rows = [...tpl.values()].sort((a, b) => a.line - b.line);

  // 对账
  const drift = [];
  const tuned = [];
  for (const r of rows) {
    const d = derived.get(r.key);
    if (!d) { drift.push({ key: r.key, why: 'openttd.json 里没有这个「模型#朝向」' }); continue; }
    const diffs = [];
    if (d.rect.join(',') !== r.rect.join(',')) diffs.push(`rect ${r.rect.join(',')} → ${d.rect.join(',')}`);
    if (d.xrel !== r.xrel || d.yrel !== r.yrel) diffs.push(`xrel/yrel ${r.xrel},${r.yrel} → ${d.xrel},${d.yrel}`);
    if (!diffs.length) continue;
    if (r.handTuned) tuned.push({ key: r.key, line: r.line, why: diffs.join('; ') });
    else drift.push({ key: r.key, line: r.line, why: diffs.join('; ') });
  }
  const missing = [...derived.keys()].filter((k) => !tpl.has(k));

  const e = (k) => derived.get(k)?.entry;
  const sheet = e(rows[0].key)?.sheet ?? '1x1.png';
  for (const r of rows) r.sheet = e(r.key)?.sheet ?? sheet;

  if (argv.includes('--emit')) {
    log('');
    log('// ---- 下面是按 flatiso 当前输出算出来的 template 块（整段粘贴用）----');
    let last = null;
    for (const r of rows) {
      const name = r.key.split('#')[0];
      if (name !== last) {
        last = name;
        log('');
        log(`// ${name}  ——  ${ROLES[name]?.what ?? ''}`);
      }
      const d = derived.get(r.key);
      if (!d) continue;
      log(`template ${r.templateName}() {`);
      log(`  [${d.rect.join(', ')}, ${d.xrel}, ${d.yrel}, "gfx/${r.sheet}"]`);
      log('}');
    }
    log('');
    return rows;
  }

  log('');
  log('  src/rails/templates.pnml —— 手写源文件（要改就改这个文件的那一行）');
  log('  ' + '─'.repeat(104));
  log('  ' + pad('模型#朝向', 26) + pad('引擎槽位', 13) + pad('模板名', 26) + pad('行', 6) + pad('当前 xrel,yrel', 17) + 'rect');
  log('  ' + '─'.repeat(104));
  let lastModel = null;
  for (const r of rows) {
    const r2 = { ...r };
    const name = r.key.split('#')[0];
    const view = Number(r.key.split('#')[1]);
    if (name !== lastModel) {
      lastModel = name;
      log(`  ${pad(name, 26)}${ROLES[name]?.what ?? ''}`);
    }
    log('    ' + pad(r.key, 24) + pad(ROLES[name]?.views?.[view] ?? '?', 13) +
        pad(r2.templateName, 26) + pad(r2.line, 6) +
        pad(`${r.xrel}, ${r.yrel}`, 17) + `[${r.rect.join(', ')}]` + (r.handTuned ? '  ✎手调' : ''));
  }
  log('  ' + '─'.repeat(104));
  log('');

  if (tuned.length) {
    log(`  ✎ 已标【手调】的 ${tuned.length} 行（有意偏离算法值，正常）：`);
    for (const t of tuned) log(`      第 ${t.line} 行  ${t.key}：${t.why}`);
    log('');
  }

  if (drift.length) {
    log(`  ⚠ 与 flatiso 当前输出不一致（${drift.length} 处）：`);
    for (const d of drift) {
      log(`    ${d.line ? `第 ${d.line} 行  ` : '（无对应行）'}${d.key}：${d.why}`);
    }
    log('    想按当前输出整段重写：node tools/sprites.mjs --emit');
    log('    有意的微调：在该行注释里写【手调】，本条就不再报');
    log('');
  } else {
    log('  ✔ 与 flatiso 当前输出一致（或已标【手调】）');
  }
  if (missing.length) {
    log(`  ⚠ openttd.json 里有、但 templates.pnml 里没有：${missing.join(', ')}`);
    log('    （新模型忘了加 template？引擎取不到图会直接报错）');
  }
  log('');
  log('  手调摆放下法：直接编辑 src/rails/templates.pnml 里那一行的 xrel / yrel');
  log('    xrel 正 = 向右，yrel 正 = 向下（相对瓦片原点 = 菱形上顶点）');
  log('  改完 `make` 编译；`make check` 会再做一遍对账。');
  log('');

  if (argv.includes('--sheet')) {
    const zi = argv.indexOf('--zoom');
    const zoom = zi >= 0 ? Math.max(1, Math.min(6, Number(argv[zi + 1]) || K_DEFAULT)) : K_DEFAULT;
    await indexSheet(rows, cfg, zoom);
    log('');
    log('  索引图 位置对照（行/列 从 0 开始，左上角为 0/0）：');
    for (const r of rows) log('    ' + pad(r.key, 28) + ` 第 ${r.row} 行 第 ${r.col} 列`);
    log('');
  }
  return rows;
}

if (isMain(import.meta.url)) {
  sprites();
}
