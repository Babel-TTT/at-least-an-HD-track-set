// =============================================================================
// tools/render.mjs —— 调外部 flatiso 渲染我们的 models/ 到 gfx/
//
// 关键：**不修改 flatiso 仓库**。flatiso 的 tools/build.mjs 原生支持
//       --models <目录> / --out <目录>，所以我们是纯粹的「外部调用方」。
//
// 一律按 4 个朝向（90° 步进）渲染：
//   * 几何上 1 重/2 重对称的模型会得到 4 张相同的精灵 —— 无害；
//   * 好处是格位尺寸、锚点在所有精灵之间天然一致，少一类失败模式。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { config, log, fail, rel, isMain } from './util.mjs';

export function render({ quiet = false } = {}) {
  const cfg = config();
  const entry = path.join(cfg.flatiso, 'tools', 'build.mjs');

  if (!fs.existsSync(entry)) fail(`找不到 flatiso 构建入口：${entry}`);

  if (!fs.existsSync(cfg.modelsDir)) {
    log(`⚠ 模型目录不存在，跳过渲染：${rel(cfg.modelsDir)}`);
    return false;
  }
  const models = fs.readdirSync(cfg.modelsDir).filter((f) => f.endsWith('.model'));
  if (!models.length) {
    log(`⚠ 模型目录为空，跳过渲染：${rel(cfg.modelsDir)}`);
    return false;
  }

  const argv = [
    entry,
    '--models', cfg.modelsDir,
    '--out', cfg.gfxDir,
    '--rotations', '4',
    '--rot-step', '90',
    '--tile-px', String(cfg.tilePx),
    '--preset', cfg.preset,
    '--ss', String(cfg.ss),
  ];
  // 材质颗粒：「碎石感」主要靠它（逐像素，不占面数）
  if (cfg.grainAmount) argv.push('--grain-amount', String(cfg.grainAmount));
  if (cfg.grainScale) argv.push('--grain-scale', String(cfg.grainScale));

  if (!quiet) log(`▶ flatiso 渲染 ${models.length} 个模型 → ${rel(cfg.gfxDir)}`);

  const r = spawnSync(process.execPath, argv, { stdio: 'inherit', cwd: cfg.flatiso });
  if (r.status !== 0) fail(`flatiso 渲染失败（exit ${r.status}）`);

  const manifest = path.join(cfg.gfxDir, 'openttd.json');
  if (!fs.existsSync(manifest)) fail(`flatiso 没产出 ${rel(manifest)}`);
  return true;
}

if (isMain(import.meta.url)) {
  render();
}
