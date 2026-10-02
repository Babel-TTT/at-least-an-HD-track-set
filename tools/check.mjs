// =============================================================================
// tools/check.mjs —— 自检
//
// 目前只查一类东西：**railtype 的结构**。因为那是全项目最容易"零报错地做错"的地方
// （见 docs/踩坑.md A6 / A6.1 —— 错了就是"车库里一辆车都没有"，编译毫无提示）。
//
// 查什么：
//   1. 每个 railtype Action 0 块的【局部 id】互不重复                            ★硬判
//      （撞车会让属性打在错的轨道上 —— 这条真的抓到过，见 docs/踩坑.md A6.1）
//   2. 兼容性锚点：局部 id 0 / 1 存在，且都带非空的 powered 列表                 ★硬判
//      ★ 人工裁定 2026-10-02：**不再覆盖内建 RAIL / ELRL** ——
//        改由本包自己的两个隐藏类型承担兼容性（id 0 = SACN、id 1 = SACA）。
//        ⇒ 原先"id 0 必须是 RAIL、id 1 必须是 ELRL"的判据**已作废**
//          （那是 A6 时代的规矩；A6 已废止，见 docs/踩坑.md）。
//   3. 每个块（带属性的）powered 列表非空                                        ★硬判
//   4. 每个 label 都出现在某个锚点的 powered 列表里                              ⚠提示
//      （漏了只是"两套轨道之间跑不通"，不一定是错，所以不硬判）
//
//   node tools/check.mjs      （或 make check）
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { config, log, fail, rel, isMain, ROOT, readTemplates, derivedTemplates, templatesFile } from './util.mjs';

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

/**
 * 文本编码自检。专治 docs/踩坑.md C5.1：
 * PowerShell 的 `Get-Content -Raw` 会按 ANSI 解码 UTF-8，`Set-Content -Encoding UTF8`
 * 再写回，中文就成乱码、JSON 还会语法坏掉、而且**静默失效**（本工程已经踩了两次）。
 *
 * 三条：
 *   1. 所有 .json 必须能解析（乱码后 JSON.parse 会抛错）
 *   2. 任何文本文件都不许带 UTF-8 BOM（PS 5.1 的 `-Encoding UTF8` 会加 BOM，是最好的指纹）
 *   3. "源头"文件里不许出现乱码指纹字符（不查 docs/ 与根目录 .md，因为踩坑.md 会引用乱码样例）
 */
const MOJIBAKE = '锛銆鈥鐨鍜鏄鍦鎵閲鏂寰鎴缁鍒鍑鍔闇';

function walkFiles(dir, depth, out) {
  if (depth > 3) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (['.git', 'gfx', 'out', 'node_modules', '.nmlcache'].includes(e.name)) continue;
    // ★ 2026-10：内置的 flatiso 快照（tools/flatiso/）是**上游第三方文件**，
    //   它自带几个带 BOM 的文件，不该由本工程的自检去管。整棵跳过。
    if (dir === ROOT && e.name === 'tools') {
      const p = path.join(dir, e.name);
      for (const t of fs.readdirSync(p, { withFileTypes: true })) {
        if (t.name === 'flatiso') continue;
        if (t.isDirectory()) walkFiles(path.join(p, t.name), depth + 1, out);
        else out.push(path.join(p, t.name));
      }
      continue;
    }
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, depth + 1, out);
    else out.push(p);
  }
}

function checkEncoding() {
  const problems = [];
  const warns = [];
  const all = [];
  walkFiles(ROOT, 0, all);

  const isText = (p) => /\.(json|mjs|pnml|model|lng|md|txt|csv|config|gitattributes|gitignore)$/i.test(p)
                        || /(^|[\\/])Makefile$/.test(p);
  /** 我们自己维护的源头文件：这些文件里出现 BOM 或乱码一定是事故 */
  const isSource = (p) => /[\\/](tools|src|models|lang)[\\/]/.test(p)
                        || /(^|[\\/])(Makefile|Makefile\.config)$/.test(p);
  /** 本文件自己就带指纹字符表，跳过 */
  const SELF = path.join(ROOT, 'tools', 'check.mjs');

  for (const p of all) {
    if (!isText(p)) continue;
    const buf = fs.readFileSync(p);
    const r = rel(p);
    const src = isSource(p);

    // 2) BOM（PS 5.1 的 `Set-Content -Encoding UTF8` 会加，是最好用的指纹）
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
      (src ? problems : warns).push(
        `${r} 带 UTF-8 BOM${src ? ' —— 多半是 PowerShell 写的（见 C5.1）' : '（外部文件，不影响构建，仅提示）'}`);
    }

    const txt = buf.toString('utf8').replace(/^\uFEFF/, '');

    // 1) JSON 必须能解析（乱码后 JSON.parse 会抛错）
    if (p.endsWith('.json')) {
      try { JSON.parse(txt); } catch (err) { problems.push(`${r} JSON 解析失败：${err.message}（见 C5.1）`); }
    }

    // 3) 源头文件里的乱码指纹
    if (src && p !== SELF) {
      const hit = [...txt].filter((c) => MOJIBAKE.includes(c));
      if (hit.length) {
        problems.push(`${r} 出现乱码指纹字符「${[...new Set(hit)].join('')}」×${hit.length}（见 C5.1）`);
      }
    }
  }
  return { problems, warns };
}

export function check() {
  const cfg = config();
  const enc = checkEncoding();
  const encProblems = enc.problems;
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

  // --- 2. 兼容性锚点：局部 id 0 / id 1 --------------------------------------
  //
  // ★ 人工裁定 2026-10-02：**不再覆盖内建 RAIL / ELRL**。
  //   兼容性改由本包自己的两个隐藏类型承担：id 0 = SACN、id 1 = SACA，
  //   两者的 compatible / powered 表都铺到全量。
  //   ⇒ 原先"id 0 标签必须是 RAIL、id 1 必须是 ELRL"的判据**已作废**
  //     （那是 docs/踩坑.md A6 时代的规矩，A6 已废止）。
  //   现在只查：这两个锚点在、且有非空 powered。
  const byId = (n) => blocks.find((b) => b.localId === n);
  const anchors = [byId(0), byId(1)];
  for (let i = 0; i < 2; i++) {
    const a = anchors[i];
    if (!a) {
      problems.push(`没有局部 id ${i} 的块 —— 兼容性锚点缺失（人工 2026-10-02：id 0 = SACN、id 1 = SACA）`);
    } else if (!a.powered || !a.powered.length) {
      problems.push(`局部 id ${i}（"${a.label}"）没有 powered 列表 —— 兼容性锚点失效`);
    }
  }

  // --- 4. 每个 label 都该出现在某个锚点的 powered 里（只提示）---------------
  const reach = new Set();
  for (const a of anchors) if (a && a.powered) for (const l of a.powered) reach.add(l);
  if (reach.size) {
    for (const b of blocks) {
      if (!b.label || b.numProps <= 3) continue;
      if (!reach.has(b.label)) {
        warns.push(`label "${b.label}"（id ${b.localId}）不在任何兼容性锚点的 powered 里 —— 它与其他轨道之间可能跑不通`);
      }
    }
  }

  // --- 4. 每个块的 powered 不能空（除了纯占位）-----------------------------
  for (const b of blocks) {
    if (b.numProps > 3 && (!b.powered || !b.powered.length)) {
      problems.push(`"${b.label}"（局部 id ${b.localId}）的 powered 列表是空的`);
    }
  }

  // --- 5. 手写模板表对账（templates.pnml）-----------------------------------
  //      templates.pnml 自 2026-09 起是手写源文件（人工裁定 O2），没有生成器。
  //      这里**只对账、只警告，绝不改写** —— 免得手写的值被静默盖掉。
  const tplLines = [];
  let tplProblems = 0;
  let tpl = new Map();
  try {
    tpl = readTemplates();
  } catch (err) {
    problems.push(`templates.pnml 解析失败：${err.message}`);
    tplProblems++;
  }
  if (!tplProblems) {
    const manPath = path.join(cfg.gfxDir, 'openttd.json');
    if (!fs.existsSync(manPath)) {
      warns.push('没渲染过（缺 gfx/openttd.json）—— 跳过 templates.pnml 对账');
    } else {
      const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
      const derived = derivedTemplates(man);
      const drift = [];
      const tuned = [];
      for (const [key, t] of tpl) {
        const d = derived.get(key);
        if (!d) { drift.push(`${rel(templatesFile())}:${t.line}  ${key} —— openttd.json 里没这个「模型#朝向」`); continue; }
        const diffs = [];
        if (d.rect.join(',') !== t.rect.join(',')) {
          diffs.push(`rect [${t.rect.join(', ')}] ≠ 图集实际 [${d.rect.join(', ')}]`);
        }
        if (d.xrel !== t.xrel || d.yrel !== t.yrel) {
          diffs.push(`xrel,yrel ${t.xrel},${t.yrel} ≠ 按 centerAnchor 算的 ${d.xrel},${d.yrel}`);
        }
        if (!diffs.length) continue;
        // 行尾标了【手调】的：是有意为之，单独列出，不算漂移
        if (t.handTuned) tuned.push(`第 ${t.line} 行  ${key}：${diffs.join('；')}`);
        else drift.push(`${rel(templatesFile())}:${t.line}  ${key} —— ${diffs.join('；')}`);
      }
      for (const key of derived.keys()) {
        if (!tpl.has(key)) drift.push(`openttd.json 里有 ${key}，但 templates.pnml 里没有对应 template`);
      }

      // --- 模板参数化核对（2026-10 起 templates.pnml 的「表名」是形参）---------
      //   ① 每个 template 的第一形参必须是 sheet（否则调用处传了也没用）
      //   ② railsprite.pnml 调用处传的表名，必须 == 该模型实际所在的表
      //      —— 传错不会报错，只会**静默从错的 PNG 上截图**，所以必须查
      const notParam = [...tpl.values()].filter((t) => !t.sheetParam);
      if (notParam.length) {
        problems.push(`这些 template 没参数化（第 7 个字段应为形参 sheet）：`
          + `\n      ` + notParam.map((t) => `${t.templateName}（第 ${t.line} 行）`).join('\n      '));
      } else {
        const rsp = path.join(cfg.srcDir, 'rails', 'railsprite.pnml');
        if (!fs.existsSync(rsp)) {
          warns.push('缺 src/rails/railsprite.pnml，跳过表名参数核对');
        } else {
          const code = fs.readFileSync(rsp, 'utf8').replace(/\/\/.*$/gm, '');
          const byName = new Map([...tpl.values()].map((t) => [t.templateName, t]));
          const bad = [];
          const re = /\b(t_[A-Za-z0-9_]+)\s*\(\s*"([^"]*)"\s*\)/g;
          let m;
          while ((m = re.exec(code))) {
            const t = byName.get(m[1]);
            if (!t) continue;                       // 不是 templates.pnml 里的模板，跳过
            const d = derived.get(t.key);
            if (!d?.entry?.sheet) continue;
            const want = 'gfx/' + d.entry.sheet;
            if (m[2] !== want) {
              bad.push(`${m[1]}  传了 "${m[2]}"，但 ${t.key} 实际在 "${want}"`);
            }
          }
          if (bad.length) {
            problems.push(`railsprite.pnml 的表名参数传错（会静默从错的 PNG 截图）：`
              + `\n      ` + bad.join('\n      '));
          }
        }
      }
      if (tuned.length) {
        tplLines.push(`  ✎ 已标【手调】的 ${tuned.length} 行（有意偏离算法值，正常）：`);
        for (const t of tuned) tplLines.push(`      ${t}`);
      }
      if (drift.length) {
        tplLines.push(`  ⚠ templates.pnml 与 flatiso 当前输出有 ${drift.length} 处不一致（**只提示，不覆盖**）：`);
        for (const d of drift) tplLines.push(`      ${d}`);
        tplLines.push('      ⇒ 若确实是模型改了：`make sprites --emit` 打出正确值，手抄回去');
        tplLines.push('      ⇒ 若是有意手调摆位：在该行注释里写【手调】，本条就不再报');
      } else {
        tplLines.push('  ✔ 与 flatiso 当前输出一致（rect 与 xrel/yrel 都对得上，或已标【手调】）');
      }

      // spriteset 里引用的 template 必须真的存在
      const spritePnml = path.join(cfg.srcDir, 'rails', 'railsprite.pnml');
      if (fs.existsSync(spritePnml)) {
        const used = new Set();
        const txt = fs.readFileSync(spritePnml, 'utf8');
        for (const m of txt.matchAll(/\bt_[A-Za-z0-9_]+_v\d+\s*\(/g)) used.add(m[0].replace(/\s*\($/, ''));
        const defined = new Set([...tpl.values()].map((t) => t.templateName));
        const undef = [...used].filter((u) => !defined.has(u));
        if (undef.length) {
          problems.push(`railsprite.pnml 引用了 templates.pnml 里没有的 template：${undef.join(', ')}`);
        }
      }
    }
  }

  // --- 输出 ----------------------------------------------------------------
  log('文本编码自检：');
  if (encProblems.length) {
    for (const p of encProblems) log(`  ❌ ${p}`);
  } else {
    log('  ✔ 源头文件无 BOM、无乱码，JSON 均可解析');
  }
  for (const w of enc.warns) log(`  ⚠ ${w}`);
  log('');
  log(`手写模板表 ${rel(templatesFile())}：${tpl.size} 条 template`);
  for (const l of tplLines) log(l);
  log('');
  log(`railtype Action 0 块 ${blocks.length} 个：`);
  for (const b of blocks.sort((a, x) => a.localId - x.localId)) {
    log(`  局部 id ${String(b.localId).padStart(2)}  ${String(b.label).padEnd(5)} 属性 ${String(b.numProps).padStart(2)}  powered=[${(b.powered ?? []).join(' ')}]`);
  }
  for (const w of warns) log(`  ⚠ ${w}`);
  if (encProblems.length || problems.length) {
    log('');
    for (const p of problems) log(`  ❌ ${p}`);
    fail(`${encProblems.length + problems.length} 个问题`);
  }
  log('');
  // 人工裁定 2026-10-02：不再覆盖内建 RAIL/ELRL ⇒ 统计口径改成
  //   「可见轨道 = 除锚点 id 0/1 之外、带完整属性的块」+「+2 锚点（隐藏兼容类型）」
  const visible = blocks.filter((b) => b.localId !== 0 && b.localId !== 1 && b.numProps > 3);
  log(`✔ 全部通过：文本编码 + railtype 结构（${blocks.length} 个 railtype 块，含兼容性锚点 id 0/1）`);
}

if (isMain(import.meta.url)) {
  check();
}
