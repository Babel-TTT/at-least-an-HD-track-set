// 自检：只查"引擎/GRF 侧会在意的不变量"，不查好看不好看。
//
//   node tools/check.mjs
//   node tools/check.mjs --tile-px 256
//
// 覆盖面：
//   1. 几何——占地不越界、不穿地、无退化面
//   2. 取景——内容不贴格位边缘（等于没被裁掉）
//   3. 一致性——同占地的精灵格位尺寸一致，内容都落在自己格位内
//   4. 确定性——同一配置连渲两次逐像素哈希必须相同
//   5. GRF——图集内的 rect 不重叠、不越界；xrel/yrel 与格位锚点自洽

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { makeView } from '../core/project.mjs';
import { makeLook } from '../core/look.mjs';
import { prepareModel, unionFrame, renderModel, listModelFiles } from '../core/bake.mjs';
import { zoomLevelName } from '../core/grf.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s.startsWith('--')) a[s.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else a._.push(s);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const tilePx = Number(args['tile-px'] ?? 256);
const view = makeView({ tilePx });
const look = makeLook({ preset: String(args.preset ?? 'stylized') });

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const ok = (m) => notes.push(m);

const modelsDir = path.join(ROOT, 'models');
const files = listModelFiles(modelsDir);
if (!files.length) { console.error(`没有模型：${modelsDir}`); process.exit(2); }

console.log(`flatiso 自检  tilePx=${tilePx}  zPx=${view.zPx.toFixed(4)}\n`);

// ---- 投影口径本身也要验 ---------------------------------------------------
{
  const p = (x, y, z) => view.project(x, y, z);
  const a = p(0, 0, 0), b = p(1, 0, 0), c = p(0, 1, 0), d = p(1, 1, 0);
  const w = Math.abs(b[0] - c[0]), h = Math.abs(d[1] - a[1]);
  if (w !== 256 || h !== 128) fail(`投影：1x1 菱形应为 256×128，实际 ${w}×${h}`);
  else ok(`投影：1x1 菱形 ${w}×${h}（严格 2:1），一条边水平跨 ${Math.abs(b[0] - a[0])} px`);
  if (b[0] > 0) fail('投影：+x 应该朝屏幕左下（OpenTTD 口径）');
}

// ---- 逐模型 ---------------------------------------------------------------
const cells = new Map();   // footprint key → {w,h,frames:[]}
const hashes = new Map();
const trisByFp = new Map();
let totalTris = 0;

for (const file of files) {
  const stem = path.basename(file, '.model');
  let prepared;
  try {
    prepared = prepareModel(fs.readFileSync(file, 'utf8'), {
      name: stem, aoRays: look.aoRays, aoDist: look.aoDist, aoSteps: look.aoSteps,
    });
  } catch (e) {
    fail(`${stem}: 解析失败 —— ${e.message}`);
    continue;
  }
  const { meta, mesh, warnings } = prepared;
  for (const w of warnings) fail(`${stem}: ${w}`);
  if (!Number.isInteger(meta.footprint[0]) || !Number.isInteger(meta.footprint[1])) {
    fail(`${stem}: 占地必须是整瓦片`);
  }

  const frame = unionFrame(prepared, view, { rotations: 4, rotStep: 90, pad: 3 });
  const rendered = renderModel(prepared, view, look, { frame, rotations: 4, rotStep: 90, ss: 2 });

  // 取景：每张精灵四周至少留 1px 全透明，否则说明被裁了
  rendered.frames.forEach((img, r) => {
    if (img.w !== frame.w || img.h !== frame.h) fail(`${stem}#${r}: 精灵尺寸 ${img.w}×${img.h} 与格位 ${frame.w}×${frame.h} 不符`);
    const at = (x, y) => img.rgba[(y * img.w + x) * 4 + 3];
    let touch = false;
    for (let x = 0; x < img.w && !touch; x++) if (at(x, 0) || at(x, img.h - 1)) touch = true;
    for (let y = 0; y < img.h && !touch; y++) if (at(0, y) || at(img.w - 1, y)) touch = true;
    if (touch) fail(`${stem}#${r}: 内容贴到格位边缘，可能被裁切`);

    // 占地菱形必须完整落在格位内（否则引擎对齐会错）
    const corners = [[0, 0, 0], [meta.footprint[0], 0, 0], [meta.footprint[0], meta.footprint[1], 0], [0, meta.footprint[1], 0]];
    const ang = (r * Math.PI) / 2, cc = Math.cos(ang), ss2 = Math.sin(ang);
    const cx = meta.footprint[0] / 2, cy = meta.footprint[1] / 2;
    const A = view.project(cx, cy, 0);
    for (const q of corners) {
      const dx = q[0] - cx, dy = q[1] - cy;
      const p = view.project(cx + dx * cc - dy * ss2, cy + dx * ss2 + dy * cc, 0);
      const px = Math.round(p[0] - A[0]) - frame.x0;
      const py = Math.round(p[1] - A[1]) - frame.y0;
      if (px < 0 || py < 0 || px >= img.w || py >= img.h) fail(`${stem}#${r}: 占地角点 (${q[0]},${q[1]}) 落在格位外`);
    }
  });

  // 确定性
  const r2 = renderModel(prepared, view, look, { frame, rotations: 1, rotStep: 90, ss: 2 });
  const h1 = createHash('sha256').update(rendered.frames[0].rgba).digest('hex');
  const h2 = createHash('sha256').update(r2.frames[0].rgba).digest('hex');
  if (h1 !== h2) fail(`${stem}: 两次渲染结果不一致（不确定）`);
  hashes.set(stem, h1.slice(0, 12));

  const key = meta.footprint.join('x');
  if (!cells.has(key)) cells.set(key, { w: 0, h: 0, frames: [] });
  const cell = cells.get(key);
  cell.w = Math.max(cell.w, frame.w);
  cell.h = Math.max(cell.h, frame.h);
  cell.frames.push({ name: stem, w: frame.w, h: frame.h });

  const bb = mesh.bbox();
  let tris = 0;
  for (const fa of mesh.faces) tris += fa.v.length - 2;
  totalTris += tris;
  const fpKey = key;
  if (!trisByFp.has(fpKey)) trisByFp.set(fpKey, []);
  trisByFp.get(fpKey).push({ name: stem, tris });
  ok(`${stem.padEnd(16)} ${key.padEnd(4)} 面 ${String(mesh.faces.length).padStart(4)}  三角 ${String(tris).padStart(5)}  格位 ${frame.w}×${frame.h}  hash ${hashes.get(stem)}`);
}

// ---- 三角面统计 -----------------------------------------------------------
// 建模细节的"体检指标"。1k~5k 是这套风格下的合理区间：
// 低于 1k 通常意味着门窗是贴片、没有洞口进深；高到 5k 以上在 256px/瓦片
// 下大部分细节会糊成亚像素，白涨渲染时间。
{
  const detail = Number(args['detail-min'] ?? 0);
  for (const [fp, list] of [...trisByFp].sort()) {
    const sum = list.reduce((s, x) => s + x.tris, 0);
    const lo = Math.min(...list.map((x) => x.tris));
    const hi = Math.max(...list.map((x) => x.tris));
    ok(`三角面 ${fp.padEnd(4)} ${String(list.length).padStart(2)} 栋  合计 ${String(sum).padStart(5)}  区间 ${lo} ~ ${hi}`);
  }
  ok(`三角面 全部 ${String(totalTris).padStart(5)}`);
  if (detail > 0) {
    for (const list of trisByFp.values()) {
      for (const x of list) {
        if (x.tris < detail) fail(`${x.name}: 三角面 ${x.tris} < 下限 ${detail}`);
      }
    }
  }
}

// ---- 图集 / GRF -----------------------------------------------------------
// 同占地的格位尺寸取组内最大值；每个模型自己的取景框必须能装进去。
for (const [key, cell] of cells) {
  for (const f of cell.frames) {
    if (f.w > cell.w || f.h > cell.h) fail(`占地 ${key}：${f.name} 的取景框 ${f.w}×${f.h} 超出组格位 ${cell.w}×${cell.h}`);
  }
  ok(`占地 ${key}：${cell.frames.length} 个模型共用格位 ${cell.w}×${cell.h}`);
}

const atlasFile = path.join(ROOT, 'out', 'atlas', 'atlas.json');
if (!fs.existsSync(atlasFile)) {
  fail('没有找到 out/atlas/atlas.json —— 先把 build 跑一遍');
} else {
  const atlas = JSON.parse(fs.readFileSync(atlasFile, 'utf8'));
  const zi = atlas.sheets.map((s) => s.file).join();
  ok(`GRF：缩放档 ${zoomLevelName(atlas.view.tilePx) ?? '（非标准档）'}  图集 ${zi}`);

  for (const sheet of atlas.sheets) {
    const [W, H] = sheet.size;
    const seen = new Set();
    if (sheet.cell[0] * sheet.cols !== W || sheet.cell[1] * sheet.rows !== H) {
      fail(`${sheet.key}: 图集尺寸 ${sheet.size} 不是 格位×行列 的整数倍（网格不规则）`);
    }
    for (const sp of sheet.sprites) {
      const [x, y, w, h] = sp.rect;
      if (x < 0 || y < 0 || x + w > W || y + h > H) fail(`${sheet.key}/${sp.id}: rect 越出图集 ${sheet.size}`);
      if (w !== sheet.cell[0] || h !== sheet.cell[1]) fail(`${sheet.key}/${sp.id}: 精灵 ${w}×${h} 与格位 ${sheet.cell} 不符`);
      if (x !== sp.col * sheet.cell[0] || y !== sp.row * sheet.cell[1]) fail(`${sheet.key}/${sp.id}: rect 与 col/row 不对应`);
      if (sp.col < 0 || sp.col >= sheet.cols || sp.row < 0 || sp.row >= sheet.rows) fail(`${sheet.key}/${sp.id}: col/row 越界`);
      const key = `${sp.col},${sp.row}`;
      if (seen.has(key)) fail(`${sheet.key}: 格子 ${key} 被放了两次`);
      seen.add(key);
      const ax = -sp.xrel, ay = -sp.yrel;
      if (ax < 0 || ax >= sheet.cell[0] || ay < 0 || ay >= sheet.cell[1]) {
        fail(`${sheet.key}/${sp.id}: 锚点 (${ax},${ay}) 落在格位 ${sheet.cell} 之外`);
      }
      // 同一张图集里，格位锚点（占地中心）固定不变 —— 这正是"一个格子一个锚点"的承诺
      if (sheet.anchor[0] >= sheet.cell[0] || sheet.anchor[1] >= sheet.cell[1]) {
        fail(`${sheet.key}: 格位锚点 ${sheet.anchor} 落在格位之外`);
      }
    }
    ok(`图集 ${sheet.file.padEnd(10)} ${String(W).padStart(5)}×${String(H).padEnd(5)} 格位 ${sheet.cell[0]}×${sheet.cell[1]}  ${sheet.cols}×${sheet.rows}  ${sheet.sprites.length} 张`);
  }
}

// ---- 报告 -----------------------------------------------------------------
console.log('');
for (const n of notes) console.log(`  ✓ ${n}`);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n自检失败：${problems.length} 个问题`);
  process.exit(1);
}
console.log(`\n自检通过：${files.length} 个模型，0 个问题`);
