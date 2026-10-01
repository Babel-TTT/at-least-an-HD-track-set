// =============================================================================
// tools/util.mjs —— 共享工具
// 读 Makefile.config（保持单一配置源），环境变量优先。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, '..');

/** 判断某个模块是否是被直接 `node xxx.mjs` 执行（而不是被 import） */
export function isMain(metaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  return metaUrl === pathToFileURL(path.resolve(entry)).href;
}

/**
 * 在 PATH 上找一个外部可执行文件，返回**绝对路径**；找不到就原样返回（交给调用方报错）。
 *
 * ★ 2026-10：`nmlc` 改成从系统 PATH 取之后必须有这一步 ——
 *   `fs.existsSync('nmlc')` 是按**当前工作目录**找的，光给个名字永远找不到，
 *   于是报「找不到 nmlc」。带路径分隔符的值（绝对/相对路径）原样返回，
 *   所以 `NMLC=G:/NMLC/nmlc.exe` 这种老写法照样能用。
 */
export function which(cmd) {
  if (!cmd) return cmd;
  if (cmd.includes('/') || cmd.includes('\\')) return cmd;   // 已经带路径了
  const exts = [''].concat((process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';'));
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      if (fs.existsSync(p)) return p;
    }
  }
  return cmd;
}

/** 极简 Makefile 变量解析器：只认 `KEY ?= value` / `KEY = value`。 */
export function readMakefileConfig(file = path.join(ROOT, 'Makefile.config')) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*\??=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2];
    const hash = v.indexOf(' #');
    if (hash >= 0) v = v.slice(0, hash);
    out[m[1]] = v.trim();
  }
  return out;
}

/** 配置：Makefile.config < 环境变量 */
export function config() {
  const c = readMakefileConfig();
  const g = (env, cfgKey, dflt) => {
    const e = process.env[env];
    if (e !== undefined && e !== '') return e;
    const k = cfgKey ?? env;
    if (c[k] !== undefined && c[k] !== '') return c[k];
    return dflt;
  };
  return {
    raw: c,
    baseName: g('BASE_FILENAME', 'BASE_FILENAME', 'china-style-track'),
    grfId: g('GRF_ID', 'GRF_ID', '\\5F\\5F\\03\\80'),
    repoName: g('REPO_NAME', 'REPO_NAME', 'China Style Tracks'),
    modelsDir: path.resolve(ROOT, g('MODELS_DIR', 'MODELS_DIR', 'models')),
    gfxDir: path.resolve(ROOT, g('GFX_DIR', 'GFX_DIR', 'gfx')),
    outDir: path.resolve(ROOT, g('OUT_DIR', 'OUT_DIR', 'out')),
    srcDir: path.resolve(ROOT, g('SRC_DIR', 'SRC_DIR', 'src')),
    langDir: path.resolve(ROOT, g('LANG_DIR', 'LANG_DIR', 'lang')),
    node: g('NODE', 'NODE', process.execPath),
    cpp: which(g('CPP', 'CPP', 'gcc')),
    // ★ 2026-10：nmlc 从**系统 PATH** 取（原来是硬编码 G:/NMLC/nmlc.exe，别人拿到就是坏的）
    nmlc: which(g('NMLC', 'NMLC', 'nmlc')),
    // ★ 2026-10：flatiso **已内置**到本仓库 tools/flatiso/（原来是绝对路径指向另一个仓库）
    flatiso: path.resolve(ROOT, g('FLATISO', 'FLATISO', 'tools/flatiso')),
    tilePx: Number(g('TILE_PX', 'TILE_PX', '256')),
    preset: g('PRESET', 'PRESET', 'stylized'),
    ss: Number(g('SS', 'SS', '3')),
    grainAmount: g('GRAIN_AMOUNT', 'GRAIN_AMOUNT', ''),
    grainScale: g('GRAIN_SCALE', 'GRAIN_SCALE', ''),
  };
}

export function log(msg) {
  process.stdout.write(msg + '\n');
}

export function fail(msg) {
  process.stderr.write('❌ ' + msg + '\n');
  process.exit(1);
}

/** 相对 ROOT 的短路径，用于日志 */
export function rel(p) {
  const r = path.relative(ROOT, p);
  return r.startsWith('..') ? p : r;
}

// ---------------------------------------------------------------------------
// 摆放锚点：**不要直接用 flatiso 的 xrel/yrel**
//
// flatiso 的 openttd.json 里，xrel/yrel 是「相对【该朝向旋转后占地矩形的西北角】」。
// 而 OpenTTD 摆放精灵时用的是「相对【瓦片原点】」，瓦片原点就是瓦片菱形的上顶点，
// 它**不随精灵内容旋转**。
//
// 对 1×1 模型：view 0 两者恰好相等，view 1/2/3 各差半格（128 px / 64 px），
// 直接照抄会让轨道在第 2/3/4 个朝向上整体错位半格。
//
// 唯一可靠的量是 centerAnchor —— 它是「占地中心投影」在精灵内的像素位置，
// 绕占地中心旋转因此**不随朝向变化**（实测 4 个朝向完全一致）。
//
//   瓦片原点像素 = centerAnchor − 占地中心投影偏移
//   占地中心 (cx, cy) 的投影偏移 = ( (cy−cx)·HW , (cx+cy)·HH )
//   ⇒ NML 的 xrel = −原点像素x , yrel = −原点像素y
// ---------------------------------------------------------------------------
export function anchorToXrelYrel(entry, view) {
  const HW = view?.HW ?? 128;
  const HH = view?.HH ?? 64;
  const [fw, fd] = entry.footprint ?? [1, 1];
  const cx = fw / 2;
  const cy = fd / 2;
  const offX = (cy - cx) * HW;
  const offY = (cx + cy) * HH;
  const ca = entry.centerAnchor;

  if (!ca) return { xrel: entry.xrel, yrel: entry.yrel, fromCenterAnchor: false };
  return {
    xrel: -Math.round(ca[0] - offX),
    yrel: -Math.round(ca[1] - offY),
    fromCenterAnchor: true,
  };
}

/** gfx/openttd.json 的路径 */
export function manifestFile() {
  return path.join(config().gfxDir, 'openttd.json');
}

/** 读 gfx/openttd.json（没渲染过就报错） */
export function readManifest() {
  const p = manifestFile();
  if (!fs.existsSync(p)) fail(`找不到 ${rel(p)} —— 先跑 make render`);
  const man = JSON.parse(fs.readFileSync(p, 'utf8'));
  const entries = man.entries ?? [];
  if (!entries.length) fail('openttd.json 里没有 entries');
  return man;
}

// ---------------------------------------------------------------------------
// 手写模板表：`src/rails/templates.pnml`  ←  **本工程的摆放事实来源**
//
// 2026-09 起改为手写（人工裁定 O2）：这份文件不再由脚本生成，因为人要能直接
// 改里面的 xrel/yrel 来手调。**所有工具只读它，绝不写它。**
//
// 语法（nmlc 认的 template，加我们自己的一行注释约定了朝向）：
//
//     template t_<模型>_v<朝向>(sheet) {
//       [x, y, w, h, xrel, yrel, sheet]
//     }
//
// ⚠ 第 7 个字段自 2026-10 起是**参数**，不再是写死的 "gfx/1x1.png"。
//   因为图集按类分表了（tools/sheets.mjs）：轨道在 rail.png、隧道口在 tunnel.png……
//   一个模板要能对不同的 PNG 取图，所以把文件名做成 **NML 自带的模板参数**
//   （人工裁定：用 nmlc 自己的机制，不要用 #define 绕）。
//   调用处传字面量：t_G1_tunnel_stone_v0("gfx/tunnel.png")
//   为了兼容，这里**两种写法都认**：带引号的字面量、或不带引号的标识符。
//
// 返回 Map<"模型#朝向", { templateName, rect, xrel, yrel, file, line }>
// 解析失败（括号不闭合、数组字段不是 7 个等）会**抛错**，不会静默跳过。
// ---------------------------------------------------------------------------

export function templatesFile() {
  return path.join(config().srcDir, 'rails', 'templates.pnml');
}

export function readTemplates(file = templatesFile()) {
  const map = new Map();
  if (!fs.existsSync(file)) return map;

  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  let cur = null;

  for (let i = 0; i < lines.length; i++) {
    const at = i + 1;
    // 去掉行尾 `//` 注释（本文件里不会出现字符串字面量含 `//` 的情况）
    const code = lines[i].replace(/\/\/.*$/, '');
    const cm = /\/\/(.*)$/.exec(lines[i]);
    const comment = cm ? cm[1].trim() : '';
    if (!code.trim()) continue;

    const head = /^\s*template\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/.exec(code);
    if (head) {
      const m = /^t_(.+)_v(\d+)$/.exec(head[1]);
      if (!m) {
        throw new Error(`${rel(file)}:${at} template 名不符合 t_<模型>_v<朝向>：${head[1]}`);
      }
      // 形参名（本工程约定只有一个：表名参数）。留空也允许。
      const params = head[2].split(',').map((s) => s.trim()).filter(Boolean);
      cur = {
        templateName: head[1],
        key: `${m[1]}#${Number(m[2])}`,
        line: at,
        params,
        sheetParam: params[0] ?? null,
      };
      continue;
    }

    if (!cur) continue;

    // 第 7 个字段：带引号的字面量，或不带引号的形参名（NML 模板参数）
    const body = /^\s*\[\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*\]\s*$/.exec(code);
    if (body) {
      map.set(cur.key, {
        templateName: cur.templateName,
        key: cur.key,
        line: cur.line,
        params: cur.params,
        sheetParam: cur.sheetParam,
        // body[7] = 字面量文件名；body[8] = 形参名（两者只有一个有值）
        file: body[7] ?? null,
        fileParam: body[8] ?? null,
        rect: [body[1], body[2], body[3], body[4]].map(Number),
        xrel: Number(body[5]),
        yrel: Number(body[6]),
        comment,
        // 行尾注释里写了【手调】(= HAND-TUNED) 的行，对账时不当成"漂移"，
        // 免得每次 make check 都对人有意的微调喊狼来了。见 docs/定标.md §4.5。
        handTuned: /【手调】|HAND-TUNED/.test(comment),
      });
      cur = null;
      continue;
    }
    if (code.trim() === '}') { cur = null; continue; }
  }
  return map;
}

/**
 * 「按算法应该是什么」—— 只用于**对账**（check.mjs / sprites.mjs / compare.mjs），
 * 绝不写回 templates.pnml。
 *
 * 返回 Map<"模型#朝向", { rect, xrel, yrel }>
 */
export function derivedTemplates(man) {
  const map = new Map();
  for (const e of man.entries ?? []) {
    const r = anchorToXrelYrel(e, man.view);
    map.set(String(e.id), { rect: e.rect.map(Number), xrel: r.xrel, yrel: r.yrel, entry: e });
  }
  return map;
}

/** 按模型名分组、朝向升序 —— 各工具打印时统一用这个顺序 */
export function groupByModel(entries) {
  const by = new Map();
  for (const e of entries) {
    const name = String(e.id).split('#')[0];
    if (!by.has(name)) by.set(name, []);
    by.get(name).push(e);
  }
  for (const list of by.values()) list.sort((a, b) => (a.view ?? 0) - (b.view ?? 0));
  return by;
}
