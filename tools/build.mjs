// =============================================================================
// tools/build.mjs —— 构建编排：渲染 → 生成模板 → 编 GRF
//
//   node tools/build.mjs                 全流程
//   node tools/build.mjs --step render   只调 flatiso
//   node tools/build.mjs --step template 只生成 templates.pnml
//   node tools/build.mjs --step grf      只编 GRF（不重渲染）
//   node tools/build.mjs --no-render     跳过渲染
//
// 由 Makefile 调用；也可以直接 node 跑。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { config, log, fail, rel } from './util.mjs';
import { render } from './render.mjs';
import { genTemplate } from './gen-template.mjs';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (!s.startsWith('--')) continue;
    const k = s.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    a[k] = v;
  }
  return a;
}

function compile() {
  const cfg = config();
  const src = path.join(process.cwd(), `${cfg.baseName}.pnml`);
  if (!fs.existsSync(src)) fail(`找不到 NML 源入口：${cfg.baseName}.pnml`);

  fs.mkdirSync(cfg.outDir, { recursive: true });
  const pre = path.join(cfg.outDir, `${cfg.baseName}.nml`);
  const grf = path.join(cfg.outDir, `${cfg.baseName}.grf`);
  const md5 = path.join(cfg.outDir, `${cfg.baseName}.md5`);

  // --- 1) gcc -E：nmlc 不自带 #include / #define 预处理器
  //        （xUSSR 与 China-Set-Tracks 也都是先跑一遍 C 预处理器）
  log(`▶ ${cfg.cpp} -E -x c ${cfg.baseName}.pnml → ${rel(pre)}`);
  const p = spawnSync(cfg.cpp, [
    '-E', '-x', 'c', '-I.', `${cfg.baseName}.pnml`,
    '-o', pre,
  ], { stdio: 'inherit', cwd: process.cwd() });
  if (p.error) fail(`调用 ${cfg.cpp} 失败：${p.error.message}（Windows 上装 mingw 或改 Makefile.config 的 CPP）`);
  if (p.status !== 0) fail(`${cfg.cpp} 预处理失败（exit ${p.status}）`);

  // --- 2) nmlc
  if (!fs.existsSync(cfg.nmlc)) fail(`找不到 nmlc：${cfg.nmlc}`);

  log(`▶ nmlc ${rel(pre)} → ${rel(grf)}`);
  const r = spawnSync(cfg.nmlc, [
    pre,
    `--grf=${grf}`,
    `--md5=${md5}`,
  ], { stdio: 'inherit', cwd: process.cwd() });

  if (r.status !== 0) fail(`nmlc 编译失败（exit ${r.status}）`);
  if (!fs.existsSync(grf)) fail('nmlc 退出码为 0 但没有产出 grf');
  const size = fs.statSync(grf).size;
  log(`✔ ${rel(grf)}   ${size} 字节`);
  return grf;
}

// ---------------------------------------------------------------- 主流程

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  log(`China Style Tracks —— 构建
用法：  node tools/build.mjs [选项]        （或 make [目标]）

选项
  --step render      只调 flatiso 渲染 models/ → gfx/
  --step template    只由 gfx/openttd.json 生成 src/rails/templates.pnml
  --step grf         只预处理 + 编 GRF（不重渲染）
  --no-render        全流程但跳过渲染
  --help             显示这段帮助

环境变量（或写在 Makefile.config 里）
  MODELS_DIR  GFX_DIR  OUT_DIR  SRC_DIR  LANG_DIR
  CPP  NMLC  FLATISO  TILE_PX  PRESET  SS

make 目标
  make / make grf   全流程        make sprite   渲染 + 生成模板
  make render       只渲染        make template 只生成模板
  make diag         重出定标图（out/calibrate/ 下的 anchors.png 与 compare.png）
  make check        自检          make clean    删生成物（**连定标图一起删**）

⚠ make clean 会删掉整个 out/，定标图也在里面 —— 用 make diag 重建。`);
  process.exit(0);
}

const step = args.step ?? null;
const noRender = !!args['no-render'] || step === 'template' || step === 'grf';

const t0 = Date.now();
if (step === 'render') {
  render();
} else if (step === 'template') {
  genTemplate();
} else if (step === 'grf') {
  compile();
} else {
  if (!noRender) render();
  genTemplate();
  compile();
}
log(`完成，用时 ${((Date.now() - t0) / 1000).toFixed(1)} s`);
