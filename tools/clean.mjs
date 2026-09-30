// =============================================================================
// tools/clean.mjs —— 删除生成物
// 用 Node 而不是 rm -rf，保证 Windows 原生可跑（Makefile 里不出现 Unix 命令）。
//
// ⚠ 只删**生成物**。src/ 下现在全是手写源文件（templates.pnml 自 2026-09 起
//   归人管，不再是生成物），所以 src/ 一个都不动。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { config, log, rel, isMain } from './util.mjs';

export function clean() {
  const cfg = config();
  const targets = [
    cfg.gfxDir,
    cfg.outDir,
  ];
  // 历史遗留：这两个曾经是生成物，现在删掉它们只会毁掉源文件。
  // 留一条提示，避免还有人以为它们在。
  const legacy = [
    path.join(cfg.srcDir, 'rails', 'sprite_map.json'),
  ];

  for (const t of targets) {
    if (!fs.existsSync(t)) {
      log(`· 跳过（不存在） ${rel(t)}`);
      continue;
    }
    fs.rmSync(t, { recursive: true, force: true });
    log(`✔ 已删除 ${rel(t)}`);
  }

  for (const t of legacy) {
    if (fs.existsSync(t)) {
      log(`⚠ 发现历史遗留生成物 ${rel(t)}（现在没人生产它了，可以手工删掉）`);
    }
  }

  log('· src/ 下的手写源文件一个都没动 —— 包括 src/rails/templates.pnml');
}

if (isMain(import.meta.url)) {
  clean();
}
