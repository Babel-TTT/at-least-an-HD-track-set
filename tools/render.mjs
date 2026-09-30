// =============================================================================
// tools/render.mjs —— 调外部 flatiso 渲染我们的 models/ 到 gfx/
//
// 关键：**不修改 flatiso 仓库**。flatiso 的 tools/build.mjs 原生支持
//       --models <目录> / --out <目录> / --only <逗号分隔的模型名>，
//       所以我们是纯粹的「外部调用方」。
//
// -----------------------------------------------------------------------------
// 【分表渲染】（人工裁定 2026-10，见 tools/sheets.mjs）
//
//   不同种类的组件**各自出一张 PNG**，不再挤在一张图上。
//   flatiso 只按**占地**分表，且格位尺寸取组内极值统一 —— 所以一个高个子
//   模型（隧道口 0.57 格）会把同表所有精灵的格位一起撑大（263×151 → 263×218），
//   逼得 40 张轨道图跟着重排。
//
//   做法：**每张表单独跑一遍 flatiso**，用 --only 只喂本类的模型。
//   每遍各自算 union frame ⇒ 各自一张尺寸合适的 PNG。
//
//   产出：
//     gfx/rail.png        轨道
//     gfx/tunnel.png      隧道口
//     gfx/openttd.json    **合并后**的摆放清单（entry.sheet 已改成本表文件名）
//   （flatiso 另外还会产出 atlas.json / preview.html / 32bpp/，
//     那些只落在临时目录里，用完即删 —— 本工程的工具不依赖它们。）
//
// 一律按 4 个朝向（90° 步进）渲染：
//   * 几何上 1 重/2 重对称的模型会得到 4 张相同的精灵 —— 无害；
//   * 好处是格位尺寸、锚点在所有精灵之间天然一致，少一类失败模式。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { config, log, fail, rel, isMain } from './util.mjs';
import { planSheets } from './sheets.mjs';

/** 临时目录名（放在 gfx/ 下，跑完即删） */
const STAGING = '.sheets';

export function render({ quiet = false } = {}) {
  const cfg = config();
  const entry = path.join(cfg.flatiso, 'tools', 'build.mjs');

  if (!fs.existsSync(entry)) fail(`找不到 flatiso 构建入口：${entry}`);

  if (!fs.existsSync(cfg.modelsDir)) {
    log(`⚠ 模型目录不存在，跳过渲染：${rel(cfg.modelsDir)}`);
    return false;
  }
  const modelFiles = fs.readdirSync(cfg.modelsDir).filter((f) => f.endsWith('.model'));
  if (!modelFiles.length) {
    log(`⚠ 模型目录为空，跳过渲染：${rel(cfg.modelsDir)}`);
    return false;
  }

  let sheets;
  try {
    sheets = planSheets(modelFiles);
  } catch (e) {
    fail(e.message);
  }

  // ---- 公共渲染参数 ---------------------------------------------------------
  const common = [
    '--models', cfg.modelsDir,
    '--rotations', '4',
    '--rot-step', '90',
    '--tile-px', String(cfg.tilePx),
    '--preset', cfg.preset,
    '--ss', String(cfg.ss),
  ];
  // 材质颗粒：「碎石感」主要靠它（逐像素，不占面数）
  if (cfg.grainAmount) common.push('--grain-amount', String(cfg.grainAmount));
  if (cfg.grainScale) common.push('--grain-scale', String(cfg.grainScale));

  const staging = path.join(cfg.gfxDir, STAGING);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  if (!quiet) {
    log(`▶ flatiso 分表渲染 ${modelFiles.length} 个模型 → ${rel(cfg.gfxDir)}`);
    for (const s of sheets) log(`    ${s.key.padEnd(9)} ${String(s.names.length).padStart(2)} 个模型   ${s.title}`);
  }

  const merged = [];
  let head = null;

  for (const s of sheets) {
    const outDir = path.join(staging, s.key);
    fs.mkdirSync(outDir, { recursive: true });

    const argv = [entry, ...common, '--out', outDir, '--only', s.names.join(',')];
    const r = spawnSync(process.execPath, argv, { stdio: quiet ? 'ignore' : 'inherit', cwd: cfg.flatiso });
    if (r.status !== 0) fail(`flatiso 渲染「${s.key}」失败（exit ${r.status}）`);

    const manPath = path.join(outDir, 'openttd.json');
    if (!fs.existsSync(manPath)) fail(`flatiso 没产出 ${rel(manPath)}`);
    const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));

    // 一个类只能产出一张表：混了不同占地就会出多张，这里直接拦下
    const pngs = fs.readdirSync(outDir).filter((f) => /^\d+x\d+\.png$/.test(f));
    if (pngs.length !== 1) {
      fail(`表「${s.key}」产出了 ${pngs.length} 张图（${pngs.join(', ')}）——`
        + `\n   一个类只能有一种占地。请回 tools/sheets.mjs 把这个类拆开。`);
    }

    const dest = s.key + '.png';
    fs.copyFileSync(path.join(outDir, pngs[0]), path.join(cfg.gfxDir, dest));

    if (!head) head = man;
    for (const e of man.entries) {
      e.sheet = dest;                 // 改成本表文件名
      e.sheetSource = pngs[0];        // 记下源表名（诊断用）
      merged.push(e);
    }

    if (!quiet) {
      const sp = man.entries.length;
      log(`    ✔ ${dest.padEnd(12)} ${String(sp).padStart(2)} 张精灵   格位 ${man.entries[0]?.size?.join('×') ?? '?'}`);
    }
  }

  // ---- 清理旧的单表产物 -----------------------------------------------------
  for (const f of fs.readdirSync(cfg.gfxDir)) {
    if (/^\d+x\d+\.png$/.test(f)) {
      fs.rmSync(path.join(cfg.gfxDir, f), { force: true });
      if (!quiet) log(`    – 删掉旧的单表图集 ${f}`);
    }
  }

  // ---- 合并 manifest --------------------------------------------------------
  const manifest = {
    format: head.format,
    note: (head.note ? head.note + ' ' : '')
      + `【本工程按类分表，共 ${sheets.length} 张：${sheets.map((s) => s.key + '.png').join(', ')}】`,
    zoomLevel: head.zoomLevel,
    bitDepth: head.bitDepth,
    view: head.view,
    sheets: sheets.map((s) => ({ key: s.key, file: s.key + '.png', title: s.title, models: s.names })),
    entries: merged,
  };
  fs.writeFileSync(path.join(cfg.gfxDir, 'openttd.json'), JSON.stringify(manifest, null, 2) + '\n');

  fs.rmSync(staging, { recursive: true, force: true });

  if (!quiet) log(`  → 合并清单 ${rel(path.join(cfg.gfxDir, 'openttd.json'))}  共 ${merged.length} 张精灵 / ${sheets.length} 张表`);
  return true;
}

if (isMain(import.meta.url)) {
  render();
}
