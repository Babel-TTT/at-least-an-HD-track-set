// =============================================================================
// tools/check.mjs —— 自检
//
// 目前只查一类东西：**railtype 的结构**。因为那是全项目最容易"零报错地做错"的地方
// （见 docs/踩坑.md A6 / A6.1 —— 错了就是"车库里一辆车都没有"，编译毫无提示）。
//
// 查什么：
//   1. 每个 railtype Action 0 块的【局部 id】互不重复
//      （撞车会让"重定义 base 轨道"打在错误的轨道上）
//   2. 局部 id 0 的标签是 RAIL、id 1 是 ELRL，且两者都带 0x0F(powered)
//   3. 我们自己的每个 label 都出现在 base RAIL 的 powered 列表里
//      （否则原版/其他包的列车在我们轨道上没动力）
//   4. powered 列表非空
//
//   node tools/check.mjs      （或 make check）
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { config, log, fail, rel, isMain } from './util.mjs';

/** 跑 nmlc 产出 nfo，然后按块解析 railtype 的 Action 0（feature 0x10） */
function dumpRailtypes(cfg) {
  const nml = path.join(cfg.outDir, `${cfg.baseName}.nml`);
  const nfo = path.join(cfg.outDir, `${cfg.baseName}.nfo`);
  const grf = path.join(cfg.outDir, `${cfg.baseName}.grf`);
  if (!fs.existsSync(nml)) fail(`找不到 ${rel(nml)}，先跑 make`);

  const r = spawnSync(cfg.nmlc, [nml, `--nfo=${nfo}`, `--grf=${grf}`], { stdio: 'ignore' });
  if (r.status !== 0) fail('nmlc 生成 nfo 失败');
  if (!fs.existsSync(nfo)) fail('没有产出 nfo');

  const lines = fs.readFileSync(nfo, 'utf8').split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    const m = /\*\s+\d+\s+00\s+10\s/.exec(line);
    if (m) {
      if (cur) blocks.push(cur);
      const idm = /\\wx([0-9A-Fa-f]{4})/.exec(line);
      const nprop = /\\b(\d+)/.exec(line);
      cur = {
        header: line,
        localId: idm ? parseInt(idm[1], 16) : null,
        numProps: nprop ? parseInt(nprop[1], 10) : null,
        label: null,
        powered: null,
        compatible: null,
      };
      continue;
    }
    if (!cur) continue;
    if (!line) { blocks.push(cur); cur = null; continue; }
    const lm = /^0?8\s+"(.{4})"/.exec(line);
    if (lm) cur.label = lm[1];
    const pm = /^0?F\s+(.*)$/.exec(line);
    if (pm) cur.powered = [...pm[1].matchAll(/"(.{4})"/g)].map((x) => x[1]);
    const cm = /^0?E\s+(.*)$/.exec(line);
    if (cm) cur.compatible = [...cm[1].matchAll(/"(.{4})"/g)].map((x) => x[1]);
  }
  if (cur) blocks.push(cur);
  return blocks;
}

export function check() {
  const cfg = config();
  const blocks = dumpRailtypes(cfg);
  if (!blocks.length) fail('nfo 里找不到任何 railtype Action 0 块');

  const problems = [];
  const warns = [];

  // --- 1. 局部 id 唯一 -----------------------------------------------------
  const seen = new Map();
  for (const b of blocks) {
    if (b.localId === null) { problems.push(`有块解析不出局部 id：${b.header}`); continue; }
    if (seen.has(b.localId)) {
      problems.push(
        `局部 id 撞车：id ${b.localId} 同时给了 "${seen.get(b.localId)}" 和 "${b.label}"\n` +
        `      ⇒ reserve 阶段会按顺序覆盖 type_map[${b.localId}]，前一个块的属性会打在错的轨道上\n` +
        `      ⇒ 见 docs/踩坑.md A6.1`,
      );
    }
    seen.set(b.localId, b.label);
  }

  // --- 2. base RAIL / ELRL 必须存在且带 powered ----------------------------
  const byId = (n) => blocks.find((b) => b.localId === n);
  const base = byId(0);
  if (!base) problems.push('没有局部 id 0 的块 —— 必须重定义内建 RAIL（见 A6）');
  else if (base.label !== 'RAIL') problems.push(`局部 id 0 的标签是 "${base.label}"，应为 "RAIL"`);
  else if (!base.powered || !base.powered.length) problems.push('重定义的 RAIL 没有 powered 列表 —— 列车不会有动力（见 A6）');

  const elrl = byId(1);
  if (!elrl) warns.push('没有局部 id 1 的块（未重定义内建 ELRL）—— 原版电力机车可能无法在我们轨道上跑');
  else if (elrl.label !== 'ELRL') problems.push(`局部 id 1 的标签是 "${elrl.label}"，应为 "ELRL"`);

  // --- 3. 我方每个 label 都要在 base RAIL 的 powered 里 ---------------------
  const ours = blocks.filter((b) => b !== base && b !== elrl && b.label && b.numProps > 3);
  if (base && base.powered) {
    for (const b of ours) {
      if (!base.powered.includes(b.label)) {
        problems.push(`我方 label "${b.label}" 不在 RAIL 的 powered 列表里 ⇒ 原版列车在它上面没动力（见 A6）`);
      }
    }
  }

  // --- 4. 每个块的 powered 不能空（除了纯占位）-----------------------------
  for (const b of blocks) {
    if (b.numProps > 3 && (!b.powered || !b.powered.length)) {
      problems.push(`"${b.label}"（局部 id ${b.localId}）的 powered 列表是空的`);
    }
  }

  // --- 输出 ----------------------------------------------------------------
  log(`railtype Action 0 块 ${blocks.length} 个：`);
  for (const b of blocks.sort((a, x) => a.localId - x.localId)) {
    log(`  局部 id ${String(b.localId).padStart(2)}  ${String(b.label).padEnd(5)} 属性 ${String(b.numProps).padStart(2)}  powered=[${(b.powered ?? []).join(' ')}]`);
  }
  for (const w of warns) log(`  ⚠ ${w}`);
  if (problems.length) {
    log('');
    for (const p of problems) log(`  ❌ ${p}`);
    fail(`${problems.length} 个问题`);
  }
  log('');
  log(`✔ railtype 结构检查通过（${ours.length} 个自定义轨道 + 2 个 base 重定义）`);
}

if (isMain(import.meta.url)) {
  check();
}
