// =============================================================================
// tools/clean.mjs —— 删除生成物
// 用 Node 而不是 rm -rf，保证 Windows 原生可跑（Makefile 里不出现 Unix 命令）。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { config, log, rel, isMain } from './util.mjs';

export function clean() {
  const cfg = config();
  const targets = [
    cfg.gfxDir,
    cfg.outDir,
    path.join(cfg.srcDir, 'rails', 'templates.pnml'),
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
}

if (isMain(import.meta.url)) {
  clean();
}
