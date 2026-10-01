// 产物审计：跑在 build 之后，验证"交出去的东西"本身没问题。
//
//   node tools/verify.mjs            # 跨进程可复现 + PNG 格式 + 图集/GRF 自洽
//   node tools/verify.mjs --rebuild  # 额外重跑一次 build 比对哈希（慢一倍）
//
// 和 check.mjs 的分工：
//   check.mjs  —— 查"模型/渲染管线"的不变量（几何、取景、确定性哈希）
//   verify.mjs —— 查"磁盘上的产物"（PNG 编码、透明背景、图集与 GRF 元数据一致）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import { decodePNG } from '../core/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'out', 'atlas');
const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const ok = (m) => notes.push(m);

const sha = (f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16);
const atlas = JSON.parse(fs.readFileSync(path.join(OUT, 'atlas.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'openttd.json'), 'utf8'));

console.log(`flatiso 产物审计  ${path.relative(ROOT, OUT)}\n`);

// ---- 1. 跨进程可复现 -------------------------------------------------------
{
  // 图集 PNG 必须逐字节可复现；atlas.json 里只有生成时间戳是允许变的。
  const norm = (f) => {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    delete j.generated;
    return createHash('sha256').update(JSON.stringify(j)).digest('hex').slice(0, 16);
  };
  const targets = [
    ...atlas.sheets.map((s) => ({ f: path.join(OUT, s.file), name: s.file, h: null })),
    { f: path.join(OUT, 'atlas.json'), name: 'atlas.json(去时间戳)', h: null },
  ];
  for (const t of targets) t.h = t.name.startsWith('atlas.json') ? norm(t.f) : sha(t.f);

  if (process.argv.includes('--rebuild')) {
    execFileSync(process.execPath, ['tools/build.mjs', '--ss', '3'], { cwd: ROOT, stdio: 'ignore' });
    const bad = [];
    for (const t of targets) {
      const h2 = t.name.startsWith('atlas.json') ? norm(t.f) : sha(t.f);
      if (h2 !== t.h) bad.push(`${t.name} ${t.h} → ${h2}`);
    }
    if (bad.length) fail(`跨进程不可复现：${bad.join('；')}`);
    else ok(`跨进程可复现（重跑 build 后逐字节相同）：${targets.map((t) => `${t.name}=${t.h}`).join('  ')}`);
  } else {
    ok(`产物哈希：${targets.map((t) => `${t.name}=${t.h}`).join('  ')}`);
    notes.push('（加 --rebuild 可跑一次真正的跨进程复现比对）');
  }
}

// ---- 2. PNG 格式与透明背景 -------------------------------------------------
for (const sheet of atlas.sheets) {
  const file = path.join(OUT, sheet.file);
  const buf = fs.readFileSync(file);
  const img = decodePNG(buf);
  if (img.width !== sheet.size[0] || img.height !== sheet.size[1]) {
    fail(`${sheet.file}: 实际 ${img.width}×${img.height} 与元数据 ${sheet.size} 不符`);
  }
  // 必须是 RGBA（32bpp），不能是索引色或被压成 RGB
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') fail(`${sheet.file}: 不是合法 PNG`);
  const ctype = buf[8 + 8 + 9];   // IHDR 的 colour type
  if (ctype !== 6) fail(`${sheet.file}: 色型 ${ctype} ≠ 6（必须是真彩+Alpha，即 32bpp）`);

  let opaque = 0;
  const n = img.width * img.height;
  for (let i = 3; i < img.rgba.length; i += 4) if (img.rgba[i] > 0) opaque++;
  const ratio = (opaque / n) * 100;
  // 背景必须透明：整张图不能用满
  if (ratio > 99) fail(`${sheet.file}: 不透明像素占 ${ratio.toFixed(1)}%，背景不透明`);
  // 但也不能几乎空的
  if (ratio < 3) fail(`${sheet.file}: 不透明像素只有 ${ratio.toFixed(1)}%，图集像是空的`);
  ok(`${sheet.file.padEnd(10)} ${img.width}×${img.height}  色型 6 (RGBA)  内容占比 ${ratio.toFixed(1)}%`);

  // 每个格子的四周留白必须是透明的（说明精灵没被裁切、格位没串味）
  for (const sp of sheet.sprites) {
    const px = (x, y) => img.rgba[(y * img.width + x) * 4 + 3];
    let touch = false;
    for (let x = 0; x < sheet.cell[0] && !touch; x++) {
      if (px(sp.col * sheet.cell[0] + x, sp.row * sheet.cell[1])) touch = true;
      if (px(sp.col * sheet.cell[0] + x, sp.row * sheet.cell[1] + sheet.cell[1] - 1)) touch = true;
    }
    for (let y = 0; y < sheet.cell[1] && !touch; y++) {
      if (px(sp.col * sheet.cell[0], sp.row * sheet.cell[1] + y)) touch = true;
      if (px(sp.col * sheet.cell[0] + sheet.cell[0] - 1, sp.row * sheet.cell[1] + y)) touch = true;
    }
    if (touch) fail(`${sheet.file}/${sp.id}: 内容贴到格位边框，可能被裁切`);
  }
}

// ---- 3. 图集元数据与 GRF 清单一致 ------------------------------------------
{
  const byId = new Map();
  for (const sheet of atlas.sheets) for (const sp of sheet.sprites) byId.set(sp.id, { sheet, sp });
  if (manifest.entries.length !== byId.size) {
    fail(`openttd.json 条目数 ${manifest.entries.length} ≠ 图集精灵数 ${byId.size}`);
  }
  for (const e of manifest.entries) {
    const hit = byId.get(e.id);
    if (!hit) { fail(`openttd.json 里的 ${e.id} 在图集里找不到`); continue; }
    if (e.xrel !== hit.sp.xrel || e.yrel !== hit.sp.yrel) fail(`${e.id}: xrel/yrel 与图集不一致`);
    if (e.rect.join() !== hit.sp.rect.join()) fail(`${e.id}: rect 与图集不一致`);
    if (e.sheet !== hit.sheet.file) fail(`${e.id}: 引用了错误的图集 ${e.sheet}`);
    if (e.bitDepth !== 32) fail(`${e.id}: 色深应为 32bpp`);
  }
  ok(`GRF 清单：${manifest.entries.length} 条，与图集逐条一致，缩放档 ${manifest.zoomLevel}`);
  if (manifest.zoomLevel !== 'ZOOM_LEVEL_IN_4X' || atlas.view.tilePx !== 256) {
    fail(`缩放档与 tilePx 不匹配：tilePx=${atlas.view.tilePx} → ${manifest.zoomLevel}`);
  }
  // 清单里引用的图集文件必须真的存在（本工程只出图，所以这里只查文件，不查 NML）
  for (const f of new Set(manifest.entries.map((e) => e.sheet))) {
    if (!fs.existsSync(path.join(OUT, '32bpp', f))) fail(`openttd.json 引用了不存在的图集 32bpp/${f}`);
  }
  ok('openttd.json 引用的图集文件都存在');
}

// ---- 报告 -----------------------------------------------------------------
console.log('');
for (const n of notes) console.log(`  ✓ ${n}`);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log(`\n产物审计失败：${problems.length} 个问题`);
  process.exit(1);
}
console.log('\n产物审计通过：0 个问题');
