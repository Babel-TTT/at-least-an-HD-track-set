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
    cpp: g('CPP', 'CPP', 'gcc'),
    nmlc: g('NMLC', 'NMLC', 'G:/NMLC/nmlc.exe'),
    flatiso: path.resolve(g('FLATISO', 'FLATISO', 'D:/CNS/ottd/建筑测试/flatiso')),
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

/**
 * 手调偏移表：`<仓库根>/sprite-offsets.json`
 *
 * 为什么要有这个：`centerAnchor` 反推出来的 xrel/yrel 在**几何**上是对的，
 * 但如果实机里发现某个朝向的精灵有系统性偏移（引擎侧的额外处理、
 * 或者 flatiso 取景与我们的理解有半像素差），就需要一个不改模型、
 * 不改算法就能微调的地方。
 *
 * 格式（像素，整数；叠加在反推结果上）：
 *   {
 *     "_note": "key = 模型名 或 模型名#朝向",
 *     "probe_half_upper#0": [0, -3],
 *     "*": [1, 0]
 *   }
 *
 * ⚠ 这是**定标微调**，不是常规手段。能用几何解释的偏移要回去改几何；
 *   只有解释不了的系统性偏移才动这里，并在提交信息里写清原因。
 */
let _offsets = null;
export function spriteOffsets() {
  if (_offsets) return _offsets;
  _offsets = {};
  const f = path.join(ROOT, 'sprite-offsets.json');
  if (!fs.existsSync(f)) return _offsets;
  try {
    // 去掉可能存在的 BOM —— PowerShell 的 Set-Content -Encoding UTF8 会加，
    // 而带 BOM 的字符串 JSON.parse 会直接抛错（踩过，见 docs/踩坑.md C5.1）
    let txt = fs.readFileSync(f, 'utf8');
    if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
    const raw = JSON.parse(txt);
    for (const [k, v] of Object.entries(raw)) {
      if (k.startsWith('_')) continue;
      if (Array.isArray(v) && v.length === 2) _offsets[k] = v.map(Number);
    }
  } catch (err) {
    process.stderr.write(`⚠ sprite-offsets.json 解析失败，忽略：${err.message}\n`);
  }
  return _offsets;
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
//
// 最后叠加 sprite-offsets.json 里的手调量（见上）。
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

  let xrel, yrel, fromCenterAnchor;
  if (!ca) {
    xrel = entry.xrel;
    yrel = entry.yrel;
    fromCenterAnchor = false;
  } else {
    const originX = ca[0] - offX;
    const originY = ca[1] - offY;
    xrel = -Math.round(originX);
    yrel = -Math.round(originY);
    fromCenterAnchor = true;
  }

  // 手调叠加
  const name = String(entry.id ?? '').split('#')[0];
  const vw = entry.view ?? 0;
  const t = spriteOffsets();
  const adj = t[`${name}#${vw}`] ?? t[name] ?? t['*'];
  if (adj) {
    xrel += adj[0];
    yrel += adj[1];
  }

  return { xrel, yrel, fromCenterAnchor, adjusted: !!adj };
}