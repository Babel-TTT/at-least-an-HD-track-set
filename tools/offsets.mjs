// =============================================================================
// tools/offsets.mjs —— 手调偏移表（sprite-offsets.json）的**查名 / 改值**工具
//
//   node tools/offsets.mjs                  列出所有「模型#朝向」+ 引擎槽位 + 当前值
//   node tools/offsets.mjs --sheet          同时出索引图（哪个格子是哪个朝向）
//   node tools/offsets.mjs --set k=dx,dy    写一条（例：--set probe_half_upper#0=0,-3）
//   node tools/offsets.mjs --clear k        删一条
//   node tools/offsets.mjs --clear-all      清空
//
// -----------------------------------------------------------------------------
// 名字怎么来的？
//
//   **名字 = models/ 下那个 .model 文件的文件名（去掉 .model 后缀）。**
//   一个文件 = 一个模型；它渲染出几个朝向，就有几个 view 号（0,1,2,3…）。
//
//   完整键 =  <模型名>#<朝向号>
//   也可以写 <模型名>        ⇒ 该模型**所有**朝向一起偏
//   也可以写 *               ⇒ 全部模型全部朝向一起偏（最后兜底）
//
//   例：models/probe_half_upper.model 的第 0 个朝向
//       ⇒ "probe_half_upper#0"
//
//   注意：名字里**不含** gfx/ 前缀、不含 .png、不含 NML 的 t_ 前缀 —
//   NML 里的 template 才叫 t_probe_half_upper_v0，那是生成物，别拿它当键。
//
// -----------------------------------------------------------------------------
// 「我到底要调哪一个？」—— 看下面的表，再配合 --sheet 出的索引图：
//   表里每一行都写了这个朝向**在引擎里当什么用**（TRACK_X / TRACK_UPPER …），
//   索引图里每个格子画在**同一个瓦片锚点**上，格子上方左角标了行列号。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT, config, log, fail, rel, isMain, spriteOffsets, anchorToXrelYrel } from './util.mjs';

const OFFSETS_FILE = path.join(ROOT, 'sprite-offsets.json');

// ---------------------------------------------------------------------------
// 语义表：这个模型的第 N 个朝向，喂给引擎的哪一槽
//
// 朝向号的来源：
//   * 整格模型（probe_track_x）4 朝向，flatiso 转一圈
//   * 半格模型（probe_half_upper）4 朝向，但只有 2 个是「新」几何，
//     另外 2 个是同一根钢轨的镜像 —— 引擎正好要 4 个方向的半格轨
//
// 槽位名对应 OpenTTD railtype 的 underlay 精灵序（见 src/rails/railsprite.pnml）：
//   X / Y = 整格直线；UPPER / LOWER / LEFT / RIGHT = 半格（对角半边）
// ---------------------------------------------------------------------------
const ROLES = {
  probe_tile: {
    what: 'P1 定标探针：朝向/角点探针（只为验证朝向，不进 GRF）',
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

function readRaw() {
  if (!fs.existsSync(OFFSETS_FILE)) return {};
  let txt = fs.readFileSync(OFFSETS_FILE, 'utf8');
  if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1);   // 踩坑 C5.1
  try {
    return JSON.parse(txt);
  } catch (err) {
    fail(`sprite-offsets.json 解析失败：${err.message}\n   （它现在是个坏文件，构建会静默忽略它）`);
  }
}

function writeRaw(obj) {
  // 保留 _note 等说明字段；Node 写 UTF-8 无 BOM，不会踩 C5.1 的坑
  fs.writeFileSync(OFFSETS_FILE, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function pad(s, n) {
  // 中文按 2 格宽算
  let w = 0;
  for (const ch of String(s)) w += ch.charCodeAt(0) > 0x2000 ? 2 : 1;
  const t = String(s);
  return t + ' '.repeat(Math.max(0, n - w));
}

// ---------------------------------------------------------------------------
// 索引图：每个「模型#朝向」一个格子，全部画在**同一个瓦片锚点**上
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
  // 瓦片菱形（相对锚点固定）+ 地面中心线
  const M = [255, 80, 255];
  guideLine(d, ox, oy, ox - 128, oy + 64, M, 0.85);
  guideLine(d, ox, oy, ox + 128, oy + 64, M, 0.85);
  guideLine(d, ox, oy + 128, ox - 128, oy + 64, M, 0.85);
  guideLine(d, ox, oy + 128, ox + 128, oy + 64, M, 0.45);
  guideLine(d, 0, oy + 64, CELL_W - 1, oy + 64, [225, 225, 90], 0.9);
  // 格子边框
  for (let x = 0; x < CELL_W; x++) { setpx(d, x, 0, [90, 90, 100]); setpx(d, x, CELL_H - 1, [90, 90, 100]); }
  for (let y = 0; y < CELL_H; y++) { setpx(d, 0, y, [90, 90, 100]); setpx(d, CELL_W - 1, y, [90, 90, 100]); }
  // 左上角的「身份条」：纯色块，行数 = 朝向号（图里没字体，靠表对照）
  for (let y = 4; y < 4 + 6; y++) for (let x = 4; x < 4 + 6; x++) setpx(d, x, y, [255, 210, 60]);
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

  const cells = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const cell = blankCell();
    drawGuides(cell, ANCHOR_X, ANCHOR_Y);
    // 朝向号用色条编码：左上角竖条长度 = view+1
    for (let y = 14; y < 14 + (r.view + 1) * 8; y++) for (let x = 4; x < 10; x++) setpx(cell, x, y, [80, 220, 255]);
    const atlas = get(r.sheet);
    const [rx, ry, rw, rh] = r.rect;
    blit(cell, atlas.rgba, atlas.width, rx, ry, rw, rh,
         ANCHOR_X + r.xrel, ANCHOR_Y + r.yrel);

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
    cells.push({ key: r.key, row, col });
  }

  const outDir = path.join(cfg.outDir, 'calibrate');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'index.png');
  fs.rmSync(outFile, { force: true });    // 踩坑 C5
  fs.writeFileSync(outFile, encodePNG(W, H, sheetPx));
  log(`✔ 索引图 ${rel(outFile)}   共 ${nRows} 行 × ${COLS} 列（左上角起，0 开始数）`);
  log('   每格：洋红 = 瓦片轮廓，黄线 = 地面中心线；左上角黄条 = 该模型第一个朝向，');
  log('   其下的青色竖条长度 = 朝向号 +1（0→1 段，1→2 段，2→3 段，3→4 段）');
  return cells;
}

// ---------------------------------------------------------------------------

export async function offsets() {
  const argv = process.argv.slice(2);
  const cfg = config();

  const manPath = path.join(cfg.gfxDir, 'openttd.json');
  if (!fs.existsSync(manPath)) fail(`找不到 ${rel(manPath)} —— 先跑 make render`);
  const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  const entries = [...(man.entries ?? [])];
  if (!entries.length) fail('openttd.json 里没有 entries');
  entries.sort((a, b) => {
    const na = String(a.id).split('#')[0], nb = String(b.id).split('#')[0];
    return na < nb ? -1 : na > nb ? 1 : (a.view ?? 0) - (b.view ?? 0);
  });

  const raw = readRaw();
  const table = spriteOffsets();

  // --- 写操作 -------------------------------------------------------------
  if (argv.includes('--clear-all')) {
    const kept = {};
    for (const [k, v] of Object.entries(raw)) if (k.startsWith('_')) kept[k] = v;
    writeRaw(kept);
    log('✔ 已清空所有手调偏移');
    return;
  }
  const clearArg = argv.indexOf('--clear');
  if (clearArg >= 0) {
    const key = argv[clearArg + 1];
    if (!key) fail('--clear 需要键名，例：--clear probe_half_upper#0');
    if (!(key in raw)) fail(`sprite-offsets.json 里没有 "${key}"`);
    delete raw[key];
    writeRaw(raw);
    log(`✔ 已删除 "${key}"`);
    return;
  }
  const setArg = argv.indexOf('--set');
  if (setArg >= 0) {
    const spec = argv[setArg + 1];
    if (!spec || !spec.includes('=')) fail('--set 用法：--set 键名=dx,dy   例：--set probe_half_upper#0=0,-3');
    const i = spec.indexOf('=');
    const key = spec.slice(0, i).trim();
    const nums = spec.slice(i + 1).split(',').map((s) => Number(s.trim()));
    if (nums.length !== 2 || nums.some((n) => !Number.isFinite(n))) fail(`"${spec.slice(i + 1)}" 不是 dx,dy 两个数字`);
    // 校验键名，防手滑写了个不存在的模型
    if (key !== '*') {
      const base = key.split('#')[0];
      const known = new Set(entries.map((e) => String(e.id).split('#')[0]));
      if (!known.has(base)) {
        fail(`没有名为 "${base}" 的模型。现有：${[...known].join(', ')}`);
      }
      if (key.includes('#')) {
        const v = Number(key.split('#')[1]);
        const max = Math.max(...entries.filter((e) => String(e.id).split('#')[0] === base).map((e) => e.view ?? 0));
        if (!(v >= 0 && v <= max)) fail(`"${base}" 只有朝向 0…${max}，没有 #${v}`);
      }
    }
    raw[key] = nums.map((n) => Math.round(n));
    writeRaw(raw);
    log(`✔ 已写 "${key}" = [${raw[key].join(', ')}]   →  重跑 make sprite 生效`);
    return;
  }

  // --- 列表 ---------------------------------------------------------------
  const rows = entries.map((e) => {
    const name = String(e.id).split('#')[0];
    const view = e.view ?? 0;
    const [x, y, w, h] = e.rect;
    const a = anchorToXrelYrel(e, man.view);
    const adj = table[`${name}#${view}`] ?? table[name] ?? table['*'];
    const base = { xrel: a.xrel, yrel: a.yrel };
    if (adj) { base.xrel -= adj[0]; base.yrel -= adj[1]; }   // 反推出「没手调时」的值
    return {
      key: `${name}#${view}`, name, view,
      role: ROLES[name]?.views?.[view] ?? '?',
      what: ROLES[name]?.what ?? '',
      sheet: e.sheet, rect: e.rect, xrel: a.xrel, yrel: a.yrel,
      baseX: base.xrel, baseY: base.yrel, adj,
    };
  });

  log('');
  log('  sprite-offsets.json —— 可手调的键（= models/<名字>.model 的文件名 + #朝向号）');
  log('  ' + '─'.repeat(96));
  log('  ' + pad('键（就是你要写的名字）', 30) + pad('引擎槽位', 14) + pad('自动算出', 14) + pad('手调', 12) + '实际使用');
  log('  ' + '─'.repeat(96));
  let lastModel = null;
  for (const r of rows) {
    if (r.name !== lastModel) {
      lastModel = r.name;
      log(`  ${pad(r.name, 30)}${r.what}`);
    }
    const adjStr = r.adj ? `[${r.adj[0]}, ${r.adj[1]}]` : '—';
    log('    ' + pad(r.key, 28) + pad(r.role, 14) +
        pad(`${r.baseX}, ${r.baseY}`, 14) + pad(adjStr, 12) +
        `${r.xrel}, ${r.yrel}`);
  }
  log('  ' + '─'.repeat(96));
  log('');
  log('  三种写法：');
  log('    "probe_half_upper#0"  → 只管这一个朝向');
  log('    "probe_half_upper"    → 该模型 4 个朝向一起偏');
  log('    "*"                   → 全部一起偏（兜底）');
  log('');
  log('  改法（二选一）：');
  log('    a) 直接编辑仓库根的 sprite-offsets.json（值 = [dx, dy]，整数像素；');
  log('       dx 正 = 向右，dy 正 = 向下）');
  log('    b) node tools/offsets.mjs --set "probe_half_upper#0=0,-3"');
  log('');
  log('  改完跑 make sprite 重新生成模板；生成时会打印「↳ 手调偏移生效」。');
  log('');

  return rows;
}

// 索引图的行列号要等图出完才知道，单独补一遍
async function main() {
  const argv = process.argv.slice(2);
  if (!argv.includes('--sheet')) return offsets();
  const cfg = config();
  const man = JSON.parse(fs.readFileSync(path.join(cfg.gfxDir, 'openttd.json'), 'utf8'));
  const entries = [...(man.entries ?? [])].sort((a, b) => {
    const na = String(a.id).split('#')[0], nb = String(b.id).split('#')[0];
    return na < nb ? -1 : na > nb ? 1 : (a.view ?? 0) - (b.view ?? 0);
  });
  const table = spriteOffsets();
  const rows = entries.map((e) => {
    const name = String(e.id).split('#')[0];
    const a = anchorToXrelYrel(e, man.view);
    const adj = table[`${name}#${e.view ?? 0}`] ?? table[name] ?? table['*'];
    return { key: `${name}#${e.view ?? 0}`, name, view: e.view ?? 0, sheet: e.sheet, rect: e.rect, xrel: a.xrel, yrel: a.yrel, adj };
  });
  const cells = await indexSheet(rows, cfg);
  log('');
  log('  索引图 位置对照（行/列 从 0 开始，左上角为 0/0）：');
  for (const c of cells) log(`    ${pad(c.key, 30)}  第 ${c.row} 行 第 ${c.col} 列`);
  log('');
}

if (isMain(import.meta.url)) {
  main();
}
