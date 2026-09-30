// =============================================================================
// tools/sprites.mjs —— 手写模板表（src/rails/templates.pnml）的**查阅工具**
//
//   node tools/sprites.mjs            列出 模型#朝向 ↔ 引擎槽位 ↔ 文件行号 ↔ 当前值
//   node tools/sprites.mjs --sheet    外加 out/calibrate/index.png（哪个格子是哪个朝向）
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
// 索引图：每个「模型#朝向」一个格子，全部画在**同一个瓦片锚点**上。
// 用的是 templates.pnml 里的 xrel/yrel —— 也就是**真会被引擎用的**那个值。
// ---------------------------------------------------------------------------
const CELL_W = 280;
const CELL_H = 200;
const ANCHOR_X = 140;
const ANCHOR_Y = 60;
const GAP = 8;
const COLS = 4;

function blankCell() {
  const px = new Uint8Array(CELL_W * CELL_H * 4);
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const v = ((x >> 3) + (y >> 3)) & 1 ? 30 : 40;
      const i = (y * CELL_W + x) * 4;
      px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255;
    }
  }
  return px;
}

function setpx(d, x, y, rgb, a = 1) {
  const xi = Math.round(x), yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= CELL_W || yi >= CELL_H) return;
  const i = (yi * CELL_W + xi) * 4;
  d[i]     = Math.round(rgb[0] * a + d[i]     * (1 - a));
  d[i + 1] = Math.round(rgb[1] * a + d[i + 1] * (1 - a));
  d[i + 2] = Math.round(rgb[2] * a + d[i + 2] * (1 - a));
  d[i + 3] = 255;
}

function guideLine(d, x0, y0, x1, y1, rgb, a = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    setpx(d, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, rgb, a);
  }
}

function drawGuides(d, ox, oy) {
  const M = [255, 80, 255];
  guideLine(d, ox, oy, ox - 128, oy + 64, M, 0.85);
  guideLine(d, ox, oy, ox + 128, oy + 64, M, 0.85);
  guideLine(d, ox, oy + 128, ox - 128, oy + 64, M, 0.85);
  guideLine(d, ox, oy + 128, ox + 128, oy + 64, M, 0.45);
  guideLine(d, 0, oy + 64, CELL_W - 1, oy + 64, [225, 225, 90], 0.9);
  for (let x = 0; x < CELL_W; x++) { setpx(d, x, 0, [90, 90, 100]); setpx(d, x, CELL_H - 1, [90, 90, 100]); }
  for (let y = 0; y < CELL_H; y++) { setpx(d, 0, y, [90, 90, 100]); setpx(d, CELL_W - 1, y, [90, 90, 100]); }
  // 左上角一小块黄 —— 图里没字体，靠终端打印的行列号对照
  for (let y = 4; y < 10; y++) for (let x = 4; x < 10; x++) setpx(d, x, y, [255, 210, 60]);
}

function blit(dst, src, srcW, sx0, sy0, w, h, dx, dy) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((sy0 + y) * srcW + (sx0 + x)) * 4;
      const a = src[si + 3] / 255;
      if (a <= 0.03) continue;
      setpx(dst, dx + x, dy + y, [src[si], src[si + 1], src[si + 2]], a);
    }
  }
}

async function indexSheet(rows, cfg) {
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
  const W = COLS * CELL_W + (COLS + 1) * GAP;
  const H = nRows * CELL_H + (nRows + 1) * GAP;
  const sheetPx = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { sheetPx[i * 4] = 16; sheetPx[i * 4 + 1] = 16; sheetPx[i * 4 + 2] = 18; sheetPx[i * 4 + 3] = 255; }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cell = blankCell();
    drawGuides(cell, ANCHOR_X, ANCHOR_Y);
    // 朝向号编码：左上角青色竖条长度 = view + 1 段
    for (let y = 14; y < 14 + (r.view + 1) * 8; y++) for (let x = 4; x < 10; x++) setpx(cell, x, y, [80, 220, 255]);
    const atlas = get(r.sheet);
    const [rx, ry, rw, rh] = r.rect;
    blit(cell, atlas.rgba, atlas.width, rx, ry, rw, rh, ANCHOR_X + r.xrel, ANCHOR_Y + r.yrel);

    const col = i % COLS, row = Math.floor(i / COLS);
    const ox = GAP + col * (CELL_W + GAP);
    const oy = GAP + row * (CELL_H + GAP);
    for (let y = 0; y < CELL_H; y++) {
      for (let x = 0; x < CELL_W; x++) {
        const si = (y * CELL_W + x) * 4, di = ((oy + y) * W + ox + x) * 4;
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
  log(`✔ 索引图 ${rel(outFile)}   共 ${nRows} 行 × ${COLS} 列（左上角起，0 开始数）`);
  log('   每格：洋红 = 瓦片轮廓，黄线 = 地面中心线；左上角黄块下方');
  log('   青色竖条长度 = 朝向号 +1 段（0→1 段，1→2 段，2→3 段，3→4 段）');
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
    await indexSheet(rows, cfg);
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
