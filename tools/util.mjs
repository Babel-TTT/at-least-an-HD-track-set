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
  if (!ca) {
    // 没有 centerAnchor 就退回 flatiso 自己的值，但会记一笔
    return { xrel: entry.xrel, yrel: entry.yrel, fromCenterAnchor: false };
  }
  const originX = ca[0] - offX;
  const originY = ca[1] - offY;
  return {
    xrel: -Math.round(originX),
    yrel: -Math.round(originY),
    fromCenterAnchor: true,
  };
}
