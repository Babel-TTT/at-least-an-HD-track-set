// =============================================================================
// tools/gen-g1-switches.mjs —— 生成 G1 的「交叉 + 道岔」三个模型
//
//   node tools/gen-g1-switches.mjs          （或 make switches）
//
// 产出（**会被本工具整份重写**，别手改这三个文件）：
//   models/G1_crossing.model    交叉（TRACK_BIT_CROSS = X|Y），道砟 + 两组钢轨
//   models/G1_junction3.model   三向道岔道砟（RTO_JUNCTION_SW/NE/SE/NW，4 朝向）
//   models/G1_junction4.model   四向道岔道砟（RTO_JUNCTION_NSEW）
//
// 为什么要有这个工具、而不是手写字面量：
//   flatiso 允许**一个模型转 4 个朝向**，但 `templates.pnml` 里一张精灵只能给
//   **一个** xrel/yrel。而实机手调发现：不同方向需要的偏移**不一样**（见下表）。
//   交叉/道岔一张精灵要同时承载多个方向 ⇒ 无法用模板偏移分别修正，
//   **只能把「每方向偏移」烘进几何**。这张表就是唯一的口径，改它即可重算。
//
// -----------------------------------------------------------------------------
// 每方向偏移表（单位：屏幕 4x 像素，正 = 右 / 下）
//
// 来源：2026-09 人工在实机里的手调结果，从 src/rails/templates.pnml 的手调值
// 反推（相对按 centerAnchor 算出的 -131,-19）：
//
//   RTO_X      ← t_probe_track_x_v0    -129,-22   偏移 (+2, -3)   ← 人工明确给出
//   RTO_Y      ← t_probe_track_x_v3    -131,-19   偏移 ( 0,  0)
//   RTO_N      ← t_probe_half_upper_v0 -128,-21   偏移 (+3, -2)
//   RTO_S      ← t_probe_half_upper_v2 -129,-21   偏移 (+2, -2)
//   RTO_E      ← t_probe_half_upper_v3 -131,-19   偏移 ( 0,  0)
//   RTO_W      ← t_probe_half_upper_v1 -131,-19   偏移 ( 0,  0)
//
// ⚠ 这几个数是**实机手调**出来的，不是理论推导。原因是 flatiso 的 centerAnchor
//   反推给的是「几何中心对齐」，而实机里不同朝向还差一点点；`probe_track_x#1`
//   目前是 (-130,-20)=(+1,-1)，与 v3 的 (0,0) 不一致 —— 那个朝向引擎不用
//   （RTO_Y 取 v3），所以不影响，但说明手调**还没收敛**。
//   收敛之后只要改下面这张表，重跑本工具即可。
//
// 屏幕像素 → 世界位移的换算：屏幕 (dx,dy) = ((wy−wx)·128, (wx+wy)·64)
//   ⇒ wx = (dy/64 − dx/128)/2 ,  wy = (dy/64 + dx/128)/2
// -----------------------------------------------------------------------------
// 道砟形状口径（人工裁定）：各方向板带的**并集** —— 等价于「把多个方向的模型
// 叠起来，再去掉看不见的面」。实现用 32x32 网格 + 「格心是否落在并集内」判据，
// 每格只出一面 ⇒ 天然没有重叠面 / z-fighting。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, log, rel, isMain } from './util.mjs';

// ---------------------------------------------------------------------------
// ★ 唯一的手调口径：每方向的屏幕像素偏移
// ⚠ 这张表必须与 templates.pnml 里**同方向**的手调值一致 ——
//   道砟烘的是这个量，而钢轨走的是模板偏移；两者不一致，道岔瓦片上钢轨就会飘在道砟外。
// ---------------------------------------------------------------------------
export const DIR_DELTA = {
  X:     [  5,  -1],   // TRACK_X  （整格对角，沿世界 x）  ← 游戏里 Sprite Aligner 读数；只表示偏差程度
  Y:     [ -3,   1],   // TRACK_Y  （整格对角，沿世界 y）
                       //   ← 人工 2026-10-03 实机读数「Y 向轨道偏了 -1,+1」。
                       //     第一版按"再补 (-1,+1)"写成 [-5,3]，人工当场更正**方向反了**，
                       //     改成往 (+1,-1) 修 ⇒ **[-3,1]**（= 原 [-4,2] + (+1,-1)）。
                       //     ★ 口径记住：本表存的是**要烘进几何的补偿量**，
                       //       实机读到"偏了 (a,b)"时，方向一定要先在实机里验一下再落表。
  UPPER: [  3,  -2],   // 屏幕上水平带（上）
  LOWER: [  2,  -2],   // 屏幕上水平带（下）
  LEFT:  [  3,  -3],   // 屏幕上竖直带（左）
  RIGHT: [  3,  -3],   // 屏幕上竖直带（右）
};

// 调试开关：G1_SWITCHES_ZERO=1 时把所有方向偏移当 0，用来生成「未补偿的基线」，
// 便于和正式结果做前后对照（**诊断用，别拿它生成正式模型**）。
const ZERO_DELTA = process.env.G1_SWITCHES_ZERO === '1';
const EFF_DELTA = ZERO_DELTA
  ? Object.fromEntries(Object.keys(DIR_DELTA).map((k) => [k, [0, 0]]))
  : DIR_DELTA;

/** 屏幕像素偏移 → 世界位移 */
function worldShift([dx, dy]) {
  const a = dx / 128, b = dy / 64;        // a = wy−wx, b = wx+wy
  return [(b - a) / 2, (a + b) / 2];
}

const SHIFT = Object.fromEntries(
  Object.entries(EFF_DELTA).map(([k, d]) => [k, worldShift(d)]),
);

// ---------------------------------------------------------------------------
// ★ 人工 2026-10-05：**交叉模型里的 X / Y 两个方向**各再单独挪一点
//
//   X 向：(2, −1) px —— **沿轨**方向（沿世界 +x 的屏幕方向 = (−2,+1)）⇒ 钢轨通长
//          铺满整片瓦片，等于没挪；真正生效的是 X 向**枕木相位**沿轨 2.24px。
//   Y 向：(−2, +1) px —— 换算成世界位移是 **纯 +x 0.015625 格**，对沿 y 跑的 Y 轨
//          是**横移 1.79px**（钢轨真的会动）+ 沿轨 1.34px（枕木相位）。
//          两个数看着像"反的"，其实都是「世界 x 方向的 ±1/64 格」，只是各自
//          投影到屏幕后不同 —— 判别口诀：屏幕 u_X = (−2,+1)，u_Y = (+2,+1)。
//
//   范围只有 `G1_crossing` 这一份几何 —— 平交道口（`G1_levelcrossing`）、
//   三向 / 四向道岔（`G1_junction3` / `G1_junction4`）**不动**，仍走 DIR_DELTA。
//   由它机械派生的两张（`G1_brown_crossing` / `G2_track_crossing`）是**同一份
//   几何换材质**，所以跟着一起挪，正是人工点名的三张。
//
//   口径与 DIR_DELTA 完全一致：单位 = 4x 屏幕像素，正 = 右 / 下。
//   为什么不直接改 DIR_DELTA：那张表是**按方向**的唯一口径，改它会连带
//   平交道口与四向道岔的道砟一起挪；人工两次都只点了交叉。
// ---------------------------------------------------------------------------
export const CROSS_X_EXTRA = [2, -1];
export const CROSS_Y_EXTRA = [-2, 1];
/** 调试开关 G1_SWITCHES_ZERO=1 时，这两个增量也一起归零 */
const EFF_CROSS_X_EXTRA = ZERO_DELTA ? [0, 0] : CROSS_X_EXTRA;
const EFF_CROSS_Y_EXTRA = ZERO_DELTA ? [0, 0] : CROSS_Y_EXTRA;

/** 叠加用：把屏幕增量加到某个方向已换算好的世界位移上（worldShift 是线性的） */
function addScreenShift(key, extraPx) {
  const [wx, wy] = SHIFT[key];
  const [ex, ey] = worldShift(extraPx);
  return [wx + ex, wy + ey];
}

/** 交叉块的临时覆盖表；`null` = 全部走 SHIFT（DIR_DELTA） */
let XTRA = null;
/** ★ 所有取方向偏移的地方都走这个函数，别直接读 SHIFT */
const shiftOf = (key) => (XTRA && XTRA[key]) || SHIFT[key];

// ---------------------------------------------------------------------------
// 板带：带内返回「正的有符号距离」，用于并集判据
// 口径见 docs/定标.md §2.5 —— 半格带 0.30（x+y / y−x 空间），直线带 0.36
// ---------------------------------------------------------------------------
export const BANDS = {
  UPPER: (x, y) => Math.min(x + y - 0.35, 0.65 - (x + y)),
  LOWER: (x, y) => Math.min(x + y - 1.35, 1.65 - (x + y)),
  LEFT:  (x, y) => Math.min((y - x) + 0.65, -0.35 - (y - x)),
  RIGHT: (x, y) => Math.min((y - x) - 0.35, 0.65 - (y - x)),
  X:     (x, y) => Math.min(y - 0.32, 0.68 - y),
  Y:     (x, y) => Math.min(x - 0.32, 0.68 - x),
};

/** 把某个方向的板带按其屏幕偏移挪位后，判断 (x,y) 是否在带内 */
function inBand(key, x, y) {
  const [wx, wy] = shiftOf(key);
  return BANDS[key](x - wx, y - wy);
}
/** 并集判据（带逐格毛边抖动） */
function makeUnion(keys, seed) {
  const rnd = (() => { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const jit = new Map();
  const j = (i, k) => { const q = i * 1000 + k; if (!jit.has(q)) jit.set(q, (rnd() - 0.5) * 2 * 0.007); return jit.get(q); };
  return {
    test(x, y, i, k) {
      let d = -1e9;
      for (const key of keys) d = Math.max(d, inBand(key, x, y));
      return d + j(i, k) > 0;
    },
    /** 该方向的板带中心线在 (x,y) 处的「带内程度」，用于给道砟排高度 */
    hz: (i, k) => 0.0005 + 0.005 * (0.5 + 0.5 * Math.sin(i * 1.7 + k * 2.3)) + 0.0006 * ((i * 7 + k * 13) % 5) / 4,
  };
}

const N = (v) => v.toFixed(4);
const pad = (s) => String(s).padEnd(9);
const CN = 32, RN = 32;               // 道砟网格
const SLEEPER_MAT = ['wood_dark', 'wood_seam', 'wood_dark', 'wood_seam'];

/**
 * 道砟并集网格
 *
 * ★ 人工裁定（2026-09）：并集里**封闭的空洞要填掉**。
 *   单纯求并集时，几条板带的夹角处会留下小空洞 —— 实机里就是"道床中间缺一块"。
 *   做法：先在 32x32 网格上求并集掩码，再从**边界**做一次 flood fill 找出
 *   「真正的外面」，剩下既不在并集、又不与外面连通的格子就是空洞 ⇒ 补上。
 *   外缘的毛边抖动照旧保留（那是刻意的）。
 */
function ballastQuads(keys, seed) {
  const u = makeUnion(keys, seed);
  // 1) 求并集掩码
  const inU = [];
  for (let k = 0; k < RN; k++) {
    inU.push([]);
    for (let i = 0; i < CN; i++) inU[k].push(u.test((i + 0.5) / CN, (k + 0.5) / RN, i, k));
  }
  // 2) 从边界 flood fill，标出「外面」
  const out = Array.from({ length: RN }, () => new Array(CN).fill(false));
  const stack = [];
  for (let i = 0; i < CN; i++) stack.push([i, 0], [i, RN - 1]);
  for (let k = 0; k < RN; k++) stack.push([0, k], [CN - 1, k]);
  while (stack.length) {
    const [i, k] = stack.pop();
    if (i < 0 || k < 0 || i >= CN || k >= RN) continue;
    if (out[k][i] || inU[k][i]) continue;
    out[k][i] = true;
    stack.push([i + 1, k], [i - 1, k], [i, k + 1], [i, k - 1]);
  }
  // 3) 出图：并集 ∪ 空洞
  const L = [];
  let n = 0, filled = 0;
  for (let k = 0; k < RN; k++) for (let i = 0; i < CN; i++) {
    if (!inU[k][i] && out[k][i]) continue;         // 真正的外面，跳过
    if (!inU[k][i]) filled++;                      // 补上的空洞
    const x0 = i / CN, x1 = (i + 1) / CN, y0 = k / RN, y1 = (k + 1) / RN;
    L.push('quad ' + N(x1) + ' ' + N(y0) + ' ' + N(u.hz(i + 1, k)) +
           '  ' + N(x1) + ' ' + N(y1) + ' ' + N(u.hz(i + 1, k + 1)) +
           '  ' + N(x0) + ' ' + N(y1) + ' ' + N(u.hz(i, k + 1)) +
           '  ' + N(x0) + ' ' + N(y0) + ' ' + N(u.hz(i, k)) + '   gravel');
    n++;
  }
  return { lines: L, n, filled };
}

/**
 * 裁剪到瓦片内（flatiso 铁律：坐标必须在 [0,w]x[0,d]）。
 * 正常路径下**不该有任何东西被剪掉** —— 空白已经在下面用「纵向回扩」补好了。
 * 这里只是最后一道保险，被剪到会报出来。
 */
const CLIP0 = 0.0005, CLIP1 = 0.9995;
let clipped = 0;
function clipBox([x0, y0, x1, y1]) {
  const b = [Math.max(CLIP0, x0), Math.max(CLIP0, y0), Math.min(CLIP1, x1), Math.min(CLIP1, y1)];
  if (b[2] - b[0] < 0.0015 || b[3] - b[1] < 0.0015) { clipped++; return null; }
  // 只把「真被剪掉一截」算数；贴安全边距的零点几不算
  const cut = Math.abs(b[0] - x0) + Math.abs(b[1] - y0) + Math.abs(b[2] - x1) + Math.abs(b[3] - y1);
  if (cut > 0.002) clipped++;
  return b;
}

/**
 * ★ 纵向范围：**位移 + 补空白**
 *
 * 把某个方向整体位移 (wx,wy) 之后，它在一端会探出瓦片、另一端会留下空白。
 * 补法：把**预位移**的纵向范围反向回扩同样的量 —— 位移完正好还是铺满 [0,1]。
 *   fill=false 时不做回扩（= 只挪不补），用来出「会留空白」的对照图。
 */
const NOFILL = process.env.G1_SWITCHES_NOFILL === '1';
function alongRange(key, axis) {
  const [wx, wy] = shiftOf(key);
  const w = axis === 'x' ? wx : wy;          // 该方向的纵向位移分量
  return NOFILL ? [0, 1] : [0 - w, 1 - w];   // 预位移范围
}

/**
 * 某个方向的轨枕。
 *
 * ★ 位移 + 补空白：位置 = 0.012 + k·间距 + 纵向位移，只保留落在 [0.012, 0.988]
 *   的那些 —— 也就是**相位跟着位移走**，末端不够就多铺一根补上。
 *   （不是「整体回扩」，那样会把位移抵消掉，等于没挪。）
 *   NOFILL=1 时退化成「只挪不补」，用来出会留空白的对照图。
 */
const SLEEPER_PITCH = 0.976 / 24;    // 与原来 25 根、0.012..0.988 一致
function sleeperBoxes(axis, hw, shiftKey, skipCenter) {
  const [wx, wy] = shiftOf(shiftKey);
  const w = axis === 'x' ? wx : wy;          // 该方向的纵向位移分量
  const T0 = 0.012, T1 = 0.988;
  let kmin, kmax;
  if (NOFILL) { kmin = 0; kmax = 24; }       // 只挪不补：固定 25 根，位置整体平移
  else {
    kmin = Math.ceil((T0 - T0 - w) / SLEEPER_PITCH - 1e-9);
    kmax = Math.floor((T1 - T0 - w) / SLEEPER_PITCH + 1e-9);
  }
  const L = [];
  for (let k = kmin; k <= kmax; k++) {
    const tNom = T0 + k * SLEEPER_PITCH;    // 预位移位置
    const t = tNom + w;                     // 位移后的最终位置
    if (!NOFILL && (t < T0 - 1e-9 || t > T1 + 1e-9)) continue;
    if (skipCenter && Math.abs(t - 0.5) <= 0.105) continue;
    for (let s = 0; s < 3; s++) {          // 沿枕木长度切 3 段（材质几乎同色）
      const a = 0.41 + 0.06 * s, b = a + 0.06;
      // raw 用**预位移**坐标，后面统一加 (wx,wy) —— 别在这里就把 w 加进去
      const raw = axis === 'x'
        ? [tNom - hw, a, tNom + hw, b]       // 枕木沿 y 伸长，沿 x 等距
        : [a, tNom - hw, b, tNom + hw];      // 枕木沿 x 伸长，沿 y 等距
      const box = clipBox([raw[0] + wx, raw[1] + wy, raw[2] + wx, raw[3] + wy]);
      if (!box) continue;
      // 枕木 z：顶 0.0140 不动（钢轨坐在这上面），底抬到 0.0100 ⇒ 枕木做薄
      // （人工裁定：大幅降低所有枕木高度）
      L.push('box ' + N(box[0]) + ' ' + N(box[1]) + ' 0.0000  ' +
             N(box[2]) + ' ' + N(box[3]) + ' 0.0100  ' +
             pad(SLEEPER_MAT[((k + s) % 4 + 4) % 4]) + ' top=wood_seam');
    }
  }
  return L;
}

/** 某个方向的两根钢轨（轴线在 [0.4444,0.4524] / [0.5476,0.5556]），按偏移挪位 */
function railBoxes(axis, zTop, shiftKey) {
  const [wx, wy] = shiftOf(shiftKey);
  const [a0, a1] = alongRange(shiftKey, axis);
  const L = [];
  for (const [a, b] of [[0.5476, 0.5556], [0.4444, 0.4524]]) {
    const raw = axis === 'x'
      ? [a0, a, a1, b]
      : [a, a0, b, a1];
    const box = clipBox([raw[0] + wx, raw[1] + wy, raw[2] + wx, raw[3] + wy]);
    if (!box) continue;
    L.push('box ' + N(box[0]) + ' ' + N(box[1]) + ' ' + N(zTop - 0.013) + '  ' +
           N(box[2]) + ' ' + N(box[3]) + ' ' + N(zTop) + '   rust top=metal');
  }
  return L;
}

// ---------------------------------------------------------------------------
function header(title, extra) {
  return '# =============================================================================\n'
    + '# ' + title + '\n#\n'
    + '# 【本文件由 tools/gen-g1-switches.mjs 生成，请勿手改】\n'
    + '#   改道砟形状/方向偏移 → 改那个工具的 DIR_DELTA / BANDS 表后重跑 make switches\n#\n'
    + extra
    + '# =============================================================================\n\n';
}

export function generate() {
  const out = [];

  // ---- G1_crossing -------------------------------------------------------
  {
    // ★ X / Y 两个方向各多挪一次「交叉专用」增量（见那两张表的注释）。
    XTRA = {
      X: addScreenShift('X', EFF_CROSS_X_EXTRA),
      Y: addScreenShift('Y', EFF_CROSS_Y_EXTRA),
    };
    const X_EFF = EFF_DELTA.X.map((v, i) => v + EFF_CROSS_X_EXTRA[i]);
    const Y_EFF = EFF_DELTA.Y.map((v, i) => v + EFF_CROSS_Y_EXTRA[i]);
    const { lines, n } = ballastQuads(['X', 'Y'], 20260930);
    let s = header('G1_crossing —— G1 几何组：平交道口轨（TRACK_BIT_CROSS = X | Y）',
      '# 喂给 underlay 的 RTO_CROSSING_XY（1 个朝向）。\n'
      + '# 【为什么自带钢轨】核自 OpenTTD 源码 rail_cmd.cpp:3790：交叉瓦片只画\n'
      + '#   DrawGroundSprite(ground + RTO_CROSSING_XY)，**不叠加任何 overlay**\n'
      + '#   （道岔才是「道砟 underlay + 逐段 overlay 钢轨」）。rail.h:84 的注释也\n'
      + '#   写着「Crossing of X and Y rail, with ballast」。\n#\n'
      + '# 【本模型的关键】X 轨与 Y 轨各自的屏幕偏移**不同**（见表），一张精灵只能有一个\n'
      + '#   xrel/yrel ⇒ 两个方向的偏移都烘进下面的坐标里。\n'
      + '#   X 方向偏移 ' + JSON.stringify(X_EFF) + ' px = DIR_DELTA.X ' + JSON.stringify(EFF_DELTA.X)
      + ' + **交叉专用** ' + JSON.stringify(EFF_CROSS_X_EXTRA) + '（人工 2026-10-05）\n'
      + '#     ⚠ (2,−1) 是 X 轨的**沿轨**方向 ⇒ 钢轨坐标不变，动的是枕木相位\n'
      + '#   Y 方向偏移 ' + JSON.stringify(Y_EFF) + ' px = DIR_DELTA.Y ' + JSON.stringify(EFF_DELTA.Y)
      + ' + **交叉专用** ' + JSON.stringify(EFF_CROSS_Y_EXTRA) + '（人工 2026-10-05）\n'
      + '#     ⚠ (−2,+1) = 世界 +x 1/64 格 ⇒ 对 Y 轨是**横移**（钢轨真的动）\n'
      + '#\n'
      + '# 【中心处理】两组钢轨都画满；Y 轨抬 0.001 格（=0.16px）只为定序；\n'
      + '#   Y 轨枕跳过中心 5 根，让中间的枕木只属于 X 轨，避免叠成一片。\n');
    s += 'name      G1_crossing\ngroup     misc\nfootprint 1 1\nzmax      0.028\n\n';
    s += '# --- 道砟：X 带 ∪ Y 带 的并集（各自按自己的屏幕偏移挪位），' + CN + 'x' + RN + ' 网格 ---\n';
    s += lines.join('\n') + '\n';
    s += '\n# --- 轨枕：X 轨 25 根画满（偏移 ' + X_EFF.join(',') + '）---\n';
    s += sleeperBoxes('x', 0.008, 'X', false).join('\n') + '\n';
    s += '\n# --- 轨枕：Y 轨 25 根，跳过中心 5 根（偏移 ' + Y_EFF.join(',') + '）---\n';
    s += sleeperBoxes('y', 0.008, 'Y', true).join('\n') + '\n';
    s += '\n# --- 钢轨：X 组 2 根（z 0.0140->0.0270，偏移 ' + X_EFF.join(',') + '）---\n';
    s += railBoxes('x', 0.0230, 'X').join('\n') + '\n';
    s += '\n# --- 钢轨：Y 组 2 根（z 0.0150->0.0280，偏移 ' + Y_EFF.join(',') + '）---\n';
    s += railBoxes('y', 0.0240, 'Y').join('\n') + '\n';
    out.push(['G1_crossing', s, n]);
    XTRA = null;                     // 后面 levelcrossing / junction 必须走原表
  }

  // ---- G1_levelcrossing --------------------------------------------------
  //   公路 × 铁路的**平交道口** —— 引擎 level_crossings 里那张「道口上的轨道图」。
  //
  //   依据（wiki NML:Railtypes 文末精灵组数量表）：
  //     level_crossings = 10 张 = 2 个方向 × (1 张轨道图 + 4 张道口灯/栏杆)
  //   而 wiki NML:Roadtypes §5.1 的精灵组里**没有 level_crossings** ⇒ 公路包没有
  //   道口专用的图案，道口上的轨道/道床完全由**这一张**决定，画在公路路面之上。
  //
  //   ★ 人工裁定 2026-10：道床**只在两侧各留约 0.1 格**；中间约 0.8 格是公路区域 ——
  //     **不画道床、不画枕木**，只有两根钢轨穿过去，让公路的路面透出来。
  //     实际切在 32 格网格上 = 0.09375 格。
  //
  //   基准朝向：轨道沿 x、公路沿 y。
  //   取图 v0（轨道沿 x → 喂引擎的 X 槽）× v3（沿 y → 喂 Y 槽），与 probe_track_x 的约定一致。
  {
    const LC = 0.10;                        // 两侧道床各占多少格（人工给的值）
    const GN = 32;                          // 道砟网格（与其它模型一致）
    const LC_N = Math.floor(LC * GN) / GN;  // 切到网格上 = 0.09375
    const LC_CELLS = Math.round(LC_N * GN);
    const u = makeUnion(['X'], 20261001);   // 用 X 带（y∈0.32~0.68）的宽度与毛边
    const lines = [];
    for (let k = 0; k < GN; k++) for (let i = 0; i < GN; i++) {
      if (i >= LC_CELLS && i < GN - LC_CELLS) continue;      // 中间公路区域：不画道床
      const x0 = i / GN, x1 = (i + 1) / GN, y0 = k / GN, y1 = (k + 1) / GN;
      if (!u.test((x0 + x1) / 2, (y0 + y1) / 2, i, k)) continue;   // X 带以外
      lines.push('quad ' + N(x1) + ' ' + N(y0) + ' ' + N(u.hz(i + 1, k)) +
                 '  ' + N(x1) + ' ' + N(y1) + ' ' + N(u.hz(i + 1, k + 1)) +
                 '  ' + N(x0) + ' ' + N(y1) + ' ' + N(u.hz(i, k + 1)) +
                 '  ' + N(x0) + ' ' + N(y0) + ' ' + N(u.hz(i, k)) + '   gravel');
    }

    // 轨枕：只留在两侧道床里，并且**按道床边界裁掉外伸的半根**
    const sleep = [];
    const T0 = 0.012, PITCH = 0.976 / 24, HW = 0.008;
    for (let k = 0; k <= 24; k++) {
      const t = T0 + k * PITCH;
      for (const [a0, a1] of [[0, LC_N], [1 - LC_N, 1]]) {
        const xa = Math.max(t - HW, a0), xb = Math.min(t + HW, a1);
        if (xb - xa < 0.002) continue;
        for (let seg = 0; seg < 3; seg++) {
          const a = 0.41 + 0.06 * seg, b = a + 0.06;
          sleep.push('box ' + N(xa) + ' ' + N(a) + ' 0.0000  ' + N(xb) + ' ' + N(b) + ' 0.0100  ' +
                     pad(SLEEPER_MAT[((k + seg) % 4 + 4) % 4]) + ' top=wood_seam');
        }
      }
    }

    // 钢轨：两根**通长 0→1 不断**（这一张的重点就是钢轨要连过公路）
    const rails = [];
    for (const [a, b] of [[0.5476, 0.5556], [0.4444, 0.4524]]) {
      rails.push('box ' + N(0) + ' ' + N(a) + ' ' + N(0.0230 - 0.013) + '  ' +
                 N(1) + ' ' + N(b) + ' ' + N(0.0230) + '   rust top=metal');
    }

    // 护轨板（人工 2026-10：可以做）
    //   三条**纵向**板：两轨之间一条、两轨外侧各一条，只铺在公路区域那一段。
    //   顶面 0.0140 = 与枕木顶同高、略低于钢轨顶（0.0230），车过的时候不硌。
    //   纵向范围用道床内缘 → 道床内缘（x∈[LC_N, 1−LC_N]），与两侧道床正好接上。
    //   外侧两块的宽度取到轨枕两端（0.41 / 0.59），与轨枕等宽。
    const planks = [];
    const PLANK_TOP = 0.0140;
    for (const [pa, pb] of [[0.4524, 0.5476], [0.4100, 0.4444], [0.5556, 0.5900]]) {
      planks.push('box ' + N(LC_N) + ' ' + N(pa) + ' 0.0000  ' +
                  N(1 - LC_N) + ' ' + N(pb) + ' ' + N(PLANK_TOP) + '  stone_dark top=stone_seam');
    }

    let s = header('G1_levelcrossing —— G1 几何组：公路 × 铁路平交道口（level_crossings 的轨道图）',
      '# 【这张是给公路走的】引擎 level_crossings 每组 = 2 方向 × (1 张轨道图 + 4 张道口灯)，共 10 张。\n'
      + '#   wiki NML:Roadtypes §5.1 的精灵组里**没有** level_crossings ⇒ 公路包没有道口\n'
      + '#   专用的图案，道口上的轨道/道床完全由这一张决定，且画在公路路面**之上**。\n#\n'
      + '# ★ 人工裁定 2026-10：道床只在**两侧各留约 ' + LC + ' 格**（切在网格上 = ' + LC_N + '）；\n'
      + '#   中间约 ' + N(1 - 2 * LC_N) + ' 格是公路区域 —— 不画道床、不画枕木，\n'
      + '#   只有两根钢轨通长穿过去，让公路路面透出来。\n#\n'
      + '# 基准朝向：轨道沿 x、公路沿 y。取图 v0（沿 x → 引擎 X 槽）× v3（沿 y → Y 槽），\n'
      + '#   与 probe_track_x 的约定一致（见 src/rails/templates.pnml）。\n#\n');
    s += 'name      G1_levelcrossing\ngroup     misc\nfootprint 1 1\nzmax      0.028\n\n';
    s += '# --- 道床：两侧各 ' + LC_N + ' 格（x∈[0,' + LC_N + '] ∪ [' + N(1 - LC_N) + ',1]），y 用 X 带 ---\n';
    s += lines.join('\n') + '\n';
    s += '\n# --- 轨枕：只在两侧道床内，按道床边界裁齐 ---\n';
    s += sleep.join('\n') + '\n';
    s += '\n# --- 钢轨：2 根，通长 0→1 不断 ---\n';
    s += rails.join('\n') + '\n';
    s += '\n# --- 护轨板：3 条纵向板（两轨之间 + 两轨外侧），只铺公路区域那一段 ---\n';
    s += planks.join('\n') + '\n';
    out.push(['G1_levelcrossing', s, lines.length + sleep.length + rails.length + planks.length]);
  }

  // ---- G1_levelcrossing_blank --------------------------------------------
  //   引擎的 level_crossings 每组要 **10 格**（2 方向 × (1 张轨道图 + 4 张道口灯)）。
  //   本工程只做轨道图，**道口灯与栏杆是额外部件，人工裁定：先用空精灵占位，以后再做**
  //   ⇒ 出一个**无几何**的模型，它的 4 张精灵全是透明的，正好拿去填那 8 格。
  //   （flatiso 会打一条 `! 空网格` 警告，和 G1_tunnel_frame 一样，无害。）
  {
    const s = header('G1_levelcrossing_blank —— 空精灵占位（道口灯 / 栏杆，尚未做）',
      '# **故意没有任何几何。** 它的 4 张精灵全是透明的，用来填 level_crossings\n'
      + '# 里那 8 格「道口灯 + 栏杆」（2 方向 × 4 张）。\n'
      + '# 人工裁定 2026-10：道口灯与栏杆是额外部件，以后再做，先占位。\n'
      + '# 做的时候把这里换成真的几何，再改 spriteset 的槽位即可。\n#\n')
      + 'name      G1_levelcrossing_blank\ngroup     misc\nfootprint 1 1\nzmax      0.0280\n\n';
    out.push(['G1_levelcrossing_blank', s, 0]);
  }

  // ---- G1_junction3 ------------------------------------------------------
  {
    const { lines, n } = ballastQuads(['Y', 'LOWER', 'LEFT'], 771);
    let s = header('G1_junction3 —— G1 几何组：三向道岔道砟（RTO_JUNCTION_SW/NE/SE/NW）',
      '# 【只有道砟，不含钢轨】核自 rail_cmd.cpp:3796-3816：道岔瓦片画 junction 道砟\n'
      + '#   underlay，然后逐段叠 overlay 的 X/Y/N/S/E/W 作为钢轨。烘钢轨会双画。\n#\n'
      + '# 基准朝向 = JUNCTION_SW，瓦片轨位 {Y, LOWER, LEFT}（由 rail_cmd.cpp 的判据\n'
      + '#   配合 TRACK_BIT_3WAY_* 反推）。其余三个朝向由四重旋转得出：\n'
      + '#     R(X->Y, UPPER->RIGHT->LOWER->LEFT)；R³(SW)=SE，R²(SW)=NE，R¹(SW)=NW\n'
      + '#   取图顺序 SW<-v0, SE<-v1, NE<-v2, NW<-v3（见 railsprite.pnml）。\n#\n'
      + '# 各方向板带按自己的屏幕偏移挪位（' + JSON.stringify(DIR_DELTA) + '）。\n');
    s += 'name      G1_junction3\ngroup     misc\nfootprint 1 1\nzmax      0.007\n\n';
    s += '# --- 道砟：{Y, LOWER, LEFT} 板带并集 ---\n';
    s += lines.join('\n') + '\n';
    out.push(['G1_junction3', s, n]);
  }

  // ---- G1_junction4 ------------------------------------------------------
  {
    const keys = ['X', 'Y', 'UPPER', 'LOWER', 'LEFT', 'RIGHT'];
    const { lines, n } = ballastQuads(keys, 883);
    let s = header('G1_junction4 —— G1 几何组：四向道岔道砟（RTO_JUNCTION_NSEW）',
      '# 瓦片轨位 = 全 6 位 ⇒ 板带并集 ≈ 整格（四角各切掉一块）。同样**只有道砟**。\n'
      + '# 引擎在 4 种「箭头」三向组合上也复用这一张，所以范围会比实际轨道大 ——\n'
      + '# 与 xUSSR 的做法一致。\n');
    s += 'name      G1_junction4\ngroup     misc\nfootprint 1 1\nzmax      0.007\n\n';
    s += '# --- 道砟：全 6 轨位板带并集 ---\n';
    s += lines.join('\n') + '\n';
    out.push(['G1_junction4', s, n]);
  }

  for (const [name, text, nq] of out) {
    const f = path.join(ROOT, 'models', name + '.model');
    fs.writeFileSync(f, text, 'utf8');
    log(`  ✔ ${rel(f).padEnd(34)} ${String(text.split('\n').length).padStart(4)} 行   道砟 ${nq} 面`);
  }

  // =========================================================================
  // ★ 褐色道床变体（人工 2026-10：「SADN 换一种更褐色的道床」）
  //
  //   背景：P2-G1 的四种轨道（`SADN` `SBDN` `SBEd` `SBDD`）原本共用一套几何。
  //   人工裁定把 `SADN` 单独拿出来、道床换成**褐色**（`roof_shingle` 122,106,86，
  //   比原来的 `gravel` 156,149,138 明显偏褐），其余三种继续用灰的。
  //
  //   做法：**读现有模型 → 只把道砟材质 gravel 换成 roof_shingle → 改名吐新模型**。
  //     · 几何一字不改 ⇒ 与源模型永远同步，改几何只需改源、重跑本工具
  //     · **不动任何已有模型** —— 全是新增文件
  //     · 和当年 G1_rail_straight / G1_rail_halftrack「读 probe_*.model 去道床」
  //       是同一个套路（那个一次性脚本已不在仓库里，所以这次挂在生成器里）
  //
  //   覆盖 9 个**带道砟**的模型（跨 3 张表）—— 少一个就会在实机里露出灰道床：
  //     rail 表          probe_track_x / probe_half_upper / G1_crossing /
  //                      G1_junction3 / G1_junction4 / G1_track_slope
  //     tunnel 表        G1_tunnel_stone / G1_tunnel_stone_b   （隧道地面层有轨有道砟）
  //     levelcrossing 表 G1_levelcrossing
  //   （overlay 那几个「只有钢轨+轨枕」的模型没有道砟，不需要变体。）
  //
  //   输出到**一张单独的表** gfx/brown.png（tools/sheets.mjs），
  //   格位由哨兵 models/G1_brown_frame.model 钉死 ⇒ 以后改几何不动 rect。
  // =========================================================================
  {
    const BROWN = [
      ['probe_track_x',     'G1_brown_track_x'],
      ['probe_half_upper',  'G1_brown_half_upper'],
      ['G1_crossing',       'G1_brown_crossing'],
      ['G1_junction3',      'G1_brown_junction3'],
      ['G1_junction4',      'G1_brown_junction4'],
      ['G1_track_slope',    'G1_brown_track_slope'],
      ['G1_tunnel_stone',   'G1_brown_tunnel_stone'],
      ['G1_tunnel_stone_b', 'G1_brown_tunnel_stone_b'],
      ['G1_levelcrossing',  'G1_brown_levelcrossing'],
    ];
    log('');
    log(`  褐色道床变体（道砟 gravel → roof_shingle）：${BROWN.length} 个`);
    for (const [src, dst] of BROWN) {
      const f = path.join(ROOT, 'models', src + '.model');
      if (!fs.existsSync(f)) {
        log(`  × 跳过 ${src}：源模型不存在（先跑对应的生成器）`);
        continue;
      }
      const raw = fs.readFileSync(f, 'utf8');
      const nGravel = (raw.match(/\bgravel\b/g) || []).length;
      const note =
        '# ⚠【褐色道床变体 —— 不要手改本文件】\n'
        + `#   由 tools/gen-g1-switches.mjs 从 models/${src}.model **机械改写**而来：\n`
        + `#     模型名 ${src} → ${dst}；道砟材质 gravel → roof_shingle（${nGravel} 处）。\n`
        + '#   **几何一字未改。** 要改几何请改源模型，然后重跑 `node tools/gen-g1-switches.mjs`。\n'
        + '#   用途：SADN（人工裁定：SADN 的道床比同组另三种更褐）。\n'
        + '# =============================================================================\n';
      const t = note + raw.split(src).join(dst).replace(/\bgravel\b/g, 'roof_shingle');
      const g = path.join(ROOT, 'models', dst + '.model');
      fs.writeFileSync(g, t, 'utf8');
      log(`  ✔ ${rel(g).padEnd(34)} ${String(t.split('\n').length).padStart(4)} 行   褐色道砟 ${nGravel} 面`);
    }
  }

  // =========================================================================
  // ★ G2（电气化铁路 `SBDA` 那一组）—— 把**木枕换成 U 形混凝土枕**
  //
  //   人工裁定 2026-10-02：「G2 改成类似现实混凝土枕木的 U 形状」。
  //   做法同 TUN-2 / 褐色道床：**读 G1 的模型 → 只换枕木 → 改名吐 G2**，
  //   道砟/钢轨/颗粒一字不改，**不动任何已有模型**。
  //
  //   ★ 高度**必须与 G1 一致**（人工：「铁轨的高度要和之前的枕木保持一致就行」）：
  //       G1 木枕   z 0.0000 → 0.0100（分 3 段 / 25 根 / 间距 0.04）
  //       G1 钢轨   z 0.0100 → 0.0230  ← 正好压在枕木顶上
  //     ⇒ G2 的 U 形**全部压在 0~0.0100 之内**，不抬高：
  //       底板顶 0.0075 ／ 垫板顶 0.0087 ／ 中间体顶 0.0095（微凹）／ 挡肩顶 0.0100
  //
  //   ★ 「U 形」靠**色差**读，不靠深度（人工选 a）：
  //       挡肩      `concrete`      最亮 —— 高出来的肩
  //       承轨槽底  `trim_dark`     最深 —— 凹进去的槽（现实里就是深色橡胶垫板）
  //       中间体顶  `concrete_seam` 中间调 —— 比两端低一点
  //     理由：竖直标度 156.77 px/格 ⇒ 真实 5 cm 的槽只有 0.63 px，几何挖不出来。
  //
  //   ★ 承轨槽**必须明显宽于钢轨**（2026-10-02 踩过）：
  //       钢轨只占 y 0.008 格；第一版把槽做成 0.010 宽 ⇒ 每边只露 0.15 px，
  //       深色垫板**整块被钢轨盖住**，U 形一点都读不出来。
  //       现在槽宽 0.036 格（y 0.4300~0.4660 / 0.5340~0.5700），
  //       钢轨两侧各露 0.014 格 ≈ **1.8 px**（真实档 256px/格）⇒ 看得见。
  //       物理上也说得通：承轨槽本来就比钢轨宽（0.036 格 ≈ 0.50 m）。
  //
  //   ⚠ **本轮只做「直线轨」两个模型**（`track_straight` / `rail_straight`）——
  //     它们的枕木是**正交 box**，替换干净。其余几种的枕木是 45° 的 `prism`
  //     （半轨）或带 z 变化的 `quad`（坡道），要另想办法，等人工看过直线再说。
  //     `junction3` / `junction4` **根本没有枕木**（纯道砟），G2 直接复用 G1 那两个。
  // =========================================================================
  {
    const Z_BASE = 0.0075;   // 底板顶
    const Z_PAD  = 0.0087;   // 承轨槽底垫板顶（钢轨 z 0.0100 压在上面）
    const Z_MID  = 0.0095;   // 中间体顶（比挡肩低 0.0005 = 微微下凹）
    const Z_TOP  = 0.0100;   // 挡肩顶 = G1 木枕顶（**不许改**）

    // G1 木枕的一根 = 连续三行 box，y 固定 0.41/0.47/0.53 → 0.59。
    // ⚠ 相邻两根的段材质是**交织**的（一根 wood_dark/seam/dark，下一根 seam/dark/seam）
    //   —— 2026-10-02 踩过：只写死一种，25 根里只换掉 13 根。
    //   所以三段都用 wood_(?:dark|seam) 放开。
    const RE = new RegExp(
      '^box (\\S+) 0\\.4100 0\\.0000 (\\S+) 0\\.4700 0\\.0100 wood_(?:dark|seam) top=wood_seam\\n'
      + 'box \\1 0\\.4700 0\\.0000 \\2 0\\.5300 0\\.0100 wood_(?:dark|seam) top=wood_seam\\n'
      + 'box \\1 0\\.5300 0\\.0000 \\2 0\\.5900 0\\.0100 wood_(?:dark|seam) top=wood_seam$', 'gm');

    const G2LIST = [
      ['probe_track_x',    'G2_track_straight'],
      ['G1_rail_straight', 'G2_rail_straight'],
    ];
    log('');
    log('  G2 混凝土枕（U 形承轨槽）：');
    for (const [src, dst] of G2LIST) {
      const f = path.join(ROOT, 'models', src + '.model');
      if (!fs.existsSync(f)) { log(`  × 跳过 ${src}：源模型不存在`); continue; }
      const raw = fs.readFileSync(f, 'utf8');
      let n = 0;
      const body = raw.replace(RE, (_m, X0, X1) => {
        n++;
        return [
          `box ${X0} 0.4100 0.0000 ${X1} 0.5900 ${Z_BASE} concrete top=concrete_seam`,
          `box ${X0} 0.4300 ${Z_BASE} ${X1} 0.4660 ${Z_PAD} trim_dark top=trim_dark`,
          `box ${X0} 0.5340 ${Z_BASE} ${X1} 0.5700 ${Z_PAD} trim_dark top=trim_dark`,
          `box ${X0} 0.4100 ${Z_BASE} ${X1} 0.4300 ${Z_TOP} concrete top=concrete`,
          `box ${X0} 0.4660 ${Z_BASE} ${X1} 0.5340 ${Z_MID} concrete top=concrete_seam`,
          `box ${X0} 0.5700 ${Z_BASE} ${X1} 0.5900 ${Z_TOP} concrete top=concrete`,
        ].join('\n');
      });
      const note =
        '# ⚠【G2 混凝土枕变体 —— 不要手改本文件】\n'
        + `#   由 tools/gen-g1-switches.mjs 从 models/${src}.model 机械改写而来：\n`
        + `#     模型名 ${src} → ${dst}；木枕 → U 形混凝土枕（换了 ${n} 根）。\n`
        + '#   **道砟 / 钢轨 / 颗粒一字未改**，枕木顶仍是 0.0100（与 G1 一致，钢轨高度不变）。\n'
        + '#   U 形靠色差读：挡肩 concrete（亮）/ 槽底垫板 trim_dark（深）/ 中间体 concrete_seam（中）。\n'
        + '#   要改形状请改本段生成逻辑，然后重跑 `node tools/gen-g1-switches.mjs`。\n'
        + '#   用途：P2-G2 的 `SBDA`（电气化铁路 25kV）。\n'
        + '# =============================================================================\n';
      const t = note + body.split(src).join(dst);
      const g = path.join(ROOT, 'models', dst + '.model');
      fs.writeFileSync(g, t, 'utf8');
      log(`  ✔ ${rel(g).padEnd(34)} ${String(t.split('\n').length).padStart(4)} 行   换成混凝土枕 ${n} 根`);
    }

    // -----------------------------------------------------------------------
    // 其余 5 个：**先把枕木整体换成混凝土色**（主视觉差异），U 形承轨槽稍后再加。
    //
    //   为什么先只换色：这 5 个的枕木不是正交 box ——
    //     probe_half_upper / G1_rail_halftrack  枕木是沿 `x+y=const` 的 **45° prism**
    //     G1_track_slope  / G1_rail_slope       枕木是带 z 变化的 **quad**（坡道上）
    //     G1_crossing                           枕木是 box，但**两个方向各一套**（24+12 根）
    //   加 U 槽要按各自的「沿轨坐标」重排几何，逐个处理；先保证颜色一致，
    //   这样 7 个模型放一起不会一半灰一半木色。
    //
    //   材质映射（★ 必须**明显亮于道砟**）：
    //     wood_dark → concrete    (186,182,173)
    //     wood_seam → tile_grey   (198,195,188)
    //   为什么不用 concrete_seam(152,149,141)：那和道砟 gravel(156,149,138)
    //   **几乎同色**，2026-10-02 踩过 —— 坡道渲出来枕木整个消失、
    //   混凝土枕直接融进道砟里。两档都要比 gravel 亮 30 级以上才看得见。
    //   注意 `top=wood_seam` 也要换（模型里是显式写的）。
    // -----------------------------------------------------------------------
    const REMAP = [
      ['probe_half_upper',   'G2_track_halftrack'],
      ['G1_rail_halftrack',  'G2_rail_halftrack'],
      ['G1_track_slope',     'G2_track_slope'],
      ['G1_rail_slope',      'G2_rail_slope'],
      ['G1_crossing',        'G2_track_crossing'],
    ];
    log('');
    log('  G2 其余 5 个（先只换枕木颜色，U 槽待加）：');
    for (const [src, dst] of REMAP) {
      const f = path.join(ROOT, 'models', src + '.model');
      if (!fs.existsSync(f)) { log(`  × 跳过 ${src}：源模型不存在`); continue; }
      const raw = fs.readFileSync(f, 'utf8');
      const nWood = (raw.match(/wood_(?:dark|seam)/g) || []).length;
      const note =
        '# ⚠【G2 混凝土枕变体（**只换了颜色，U 槽还没加**）—— 不要手改本文件】\n'
        + `#   由 tools/gen-g1-switches.mjs 从 models/${src}.model 机械改写而来：\n`
        + `#     模型名 ${src} → ${dst}；枕木材质 wood_dark→concrete / wood_seam→tile_grey（${nWood} 处）。\n`
        + '#   **几何一字未改。** U 形承轨槽要按本模型自己的「沿轨坐标」重排几何，尚未做。\n'
        + '#   用途：P2-G2 的 `SBDA`（电气化铁路 25kV）。\n'
        + '# =============================================================================\n';
      const t = note + raw.split(src).join(dst)
        .replace(/\bwood_dark\b/g, 'concrete')
        .replace(/\bwood_seam\b/g, 'tile_grey');
      const g = path.join(ROOT, 'models', dst + '.model');
      fs.writeFileSync(g, t, 'utf8');
      log(`  ✔ ${rel(g).padEnd(34)} ${String(t.split('\n').length).padStart(4)} 行   枕木换色 ${nWood} 处`);
    }

    // -----------------------------------------------------------------------
    // 半轨的 U 形承轨槽（prism 版）
    //
    //   半轨的轨道跑在 `x + y = 0.5` 这条线上 ⇒ 用**沿轨坐标**
    //       s = x + y   （横跨枕木的方向）
    //       t = x - y   （沿钢轨的方向）
    //   表示时，半轨的几何与直线轨**完全同构**（已用模型头注释核实）：
    //       枕木横跨  s ∈ [0.41, 0.59]
    //       两条钢轨  s ∈ [0.4444,0.4524] 与 [0.5476,0.5556]
    //   ⇒ 承轨槽的 5 段划分**照搬直线轨那套**，只是要换成棱柱发出来。
    //
    //   做法：**不动原有的枕木棱柱**，只在其顶面（z 0.0100）之上叠 3 片薄板
    //     （2 片深色槽底 + 1 片中间调），
    //   薄板只在**有枕木的地方**出现（t 范围取自该枕木自身的棱柱）⇒
    //   枕木之间的道砟缝不会被盖住。
    //
    //   t 范围怎么来：一根枕木的所有棱柱**共享同一个 t 范围**（它们是横跨 s 的
    //   分带），所以按 t 范围分组就能把棱柱归成一根根枕木。
    // -----------------------------------------------------------------------
    {
      const s2xy = (s, tv) => [ (s + tv) / 2, (s - tv) / 2 ];
      const PAL = [
        [0.4300, 0.4660, 'trim_dark',     'trim_dark'],      // 槽底 A
        [0.4660, 0.5340, 'concrete_seam', 'concrete_seam'],  // 中间体（微凹）
        [0.5340, 0.5700, 'trim_dark',     'trim_dark'],      // 槽底 B
      ];
      const ZP = 0.0100, ZPAD = 0.0103;    // 薄板：叠在枕木顶上 0.0003

      for (const dst of ['G2_track_halftrack', 'G2_rail_halftrack']) {
        const g = path.join(ROOT, 'models', dst + '.model');
        if (!fs.existsSync(g)) { log(`  × 跳过 ${dst}：还不存在`); continue; }
        const lines = fs.readFileSync(g, 'utf8').split('\n');
        // 1) 按 t 范围分组棱柱 → 每根枕木一个 t 区间
        const groups = new Map();
        for (const ln of lines) {
          const m = /^prism\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/.exec(ln);
          if (!m) continue;
          const pts = m[4].trim().split(/\s+/).map((p) => p.split(',').map(Number));
          if (pts.length !== 4 || pts.some((p) => p.length !== 2 || !isFinite(p[0]))) continue;
          const ts = pts.map(([x, y]) => x - y);
          const key = ts.map((v) => v.toFixed(4)).sort().join('|');
          groups.set(key, [Math.min(...ts), Math.max(...ts)]);
        }
        // 2) 每根枕木叠 3 片薄板
        const add = [];
        let nS = 0;
        for (const [, [t0, t1]] of groups) {
          nS++;
          for (const [s0, s1, side, top] of PAL) {
            const q = [s2xy(s0, t0), s2xy(s1, t0), s2xy(s1, t1), s2xy(s0, t1)]
              .map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(' ');
            add.push(`prism ${ZP.toFixed(4)} ${ZPAD.toFixed(4)}  ${side} ${q}`);
          }
        }
        if (!add.length) { log(`  × ${dst}：没找到枕木棱柱，跳过`); continue; }
        const out = lines.join('\n').replace(/\n?$/, '\n')
          + '\n# --- U 形承轨槽薄板（半轨，prism；叠在枕木顶上）---\n'
          + add.join('\n') + '\n';
        fs.writeFileSync(g, out, 'utf8');
        log(`  ✔ ${rel(g).padEnd(34)} 加 U 槽薄板 ${add.length} 片（${nS} 根枕木）`);
      }
    }

    // -----------------------------------------------------------------------
    // 交叉的 U 形承轨槽（box 版，**两个方向各一套枕木**）
    //
    //   交叉里有两族枕木：
    //     X 向轨道的枕木 —— 在 y 上长（横跨轨向）、在 x 上是窄条
    //     Y 向轨道的枕木 —— 反过来
    //   ⇒ 用**长宽比**分族（y span > x span ⇒ X 向），不写死坐标，抗改动。
    //
    //   同一族里：按「与轨向垂直的那条边的范围」分组 = 一根枕木
    //     X 向：按 (x0,x1) 分组，槽开在 y ∈ 轨中心±0.018
    //     Y 向：按 (y0,y1) 分组，槽开在 x ∈ 轨中心±0.018
    //   也只在有枕木的地方叠薄板 ⇒ 枕木之间的道砟缝不被盖住。
    //
    //   ⚠ 槽位**从本模型自己的钢轨行（rust）现算**，不写死 —— 交叉两个方向
    //     烘了不同屏幕偏移，写死直线轨的带会让 Y 向垫板整条跑偏（2026-10-03）。
    // -----------------------------------------------------------------------
    {
      // ⚠ 垫板位置**必须跟着本模型自己的钢轨走**，不能照抄直线轨的固定带。
      //
      //   交叉的两个方向各自烘进了不同的屏幕偏移（G1_crossing.model 头部：
      //   X 组 [7,-2] px = DIR_DELTA.X [5,-1] + 交叉专用 [2,-1]、
      //   Y 组 [-5,2] px = DIR_DELTA.Y [-3,1] + 交叉专用 [-2,1]），换算成世界位移：
      //     X 轨 y 中心 0.4484 + 0.01172 = 0.4601            （直线轨是 0.4484）
      //     Y 轨 x 中心 0.4484 + 0.01953 + 0.015625 = 0.4836 （直线轨是 0.4484）
      //   2026-10-03 实机发现：垫板照抄直线轨的 [0.43,0.466]/[0.534,0.57] 时，
      //   **Y 向那两条整条跑到钢轨外面**（Y 轨在 x 0.4757/0.5788）。
      //   ⇒ 改成从钢轨算：垫板 = 轨中心 ± HALF（HALF 与直线轨 U 槽同宽 0.018）。
      const HALF = 0.0180;
      const ZP = 0.0100, ZPAD = 0.0103;
      const g = path.join(ROOT, 'models', 'G2_track_crossing.model');
      if (!fs.existsSync(g)) log('  × 跳过交叉：G2_track_crossing 还不存在');
      else {
        const lines = fs.readFileSync(g, 'utf8').split('\n');
        const famA = new Map();   // X 向枕木：key = x0|x1 → y 范围
        const famB = new Map();   // Y 向枕木：key = y0|y1 → x 范围
        const railY = [];         // 沿 x 跑的钢轨：记**中心 y**
        const railX = [];         // 沿 y 跑的钢轨：记**中心 x**
        for (const ln of lines) {
          const m = /^box\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(concrete\S*)/.exec(ln);
          if (!m) continue;
          const [x0, y0, , x1, y1] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
          if (![x0, y0, x1, y1].every(isFinite)) continue;
          if (y1 - y0 > x1 - x0) {          // 在 y 上长 ⇒ X 向轨道的枕木
            famA.set(`${x0.toFixed(4)}|${x1.toFixed(4)}`, [y0, y1]);
          } else {                          // 在 x 上长 ⇒ Y 向轨道的枕木
            famB.set(`${y0.toFixed(4)}|${y1.toFixed(4)}`, [x0, x1]);
          }
        }
        for (const ln of lines) {
          const m = /^box\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+rust\b/.exec(ln);
          if (!m) continue;
          const x0 = +m[1], y0 = +m[2], x1 = +m[4], y1 = +m[5];
          if (![x0, y0, x1, y1].every(isFinite)) continue;
          if (x1 - x0 > y1 - y0) railY.push((y0 + y1) / 2);   // 沿 x 跑 ⇒ 记 y 中心
          else railX.push((x0 + x1) / 2);                     // 沿 y 跑 ⇒ 记 x 中心
        }
        railY.sort((a, b) => a - b);
        railX.sort((a, b) => a - b);
        const FALLBACK = [[0.4300, 0.4660], [0.5340, 0.5700]];   // 找不到钢轨时的老固定带
        const bandY = railY.length === 2 ? railY.map((c) => [c - HALF, c + HALF]) : FALLBACK;
        const bandX = railX.length === 2 ? railX.map((c) => [c - HALF, c + HALF]) : FALLBACK;
        if (railY.length !== 2 || railX.length !== 2) {
          log(`  ⚠ 交叉：钢轨根数不是 2+2（沿 x ${railY.length} / 沿 y ${railX.length}），`
            + '垫板退回直线轨固定带 —— 去查模型的 rust 钢轨行');
        } else {
          log(`  · 交叉垫板跟着钢轨：y 带 ${railY.map((c) => (c - HALF).toFixed(4) + '~' + (c + HALF).toFixed(4)).join(' / ')}`
            + `，x 带 ${railX.map((c) => (c - HALF).toFixed(4) + '~' + (c + HALF).toFixed(4)).join(' / ')}`);
        }
        const pad = (a, b, ya, yb) =>
          `box ${a.toFixed(4)} ${ya.toFixed(4)} ${ZP.toFixed(4)}  `
          + `${b.toFixed(4)} ${yb.toFixed(4)} ${ZPAD.toFixed(4)}  trim_dark top=trim_dark`;
        const add = [];
        for (const [k] of famA) {
          const [xa, xb] = k.split('|').map(Number);
          for (const [ya, yb] of bandY) add.push(pad(xa, xb, ya, yb));
        }
        for (const [k] of famB) {
          const [ya, yb] = k.split('|').map(Number);
          for (const [xa, xb] of bandX) add.push(pad(xa, xb, ya, yb));
        }
        if (!add.length) log('  × 交叉：没找到枕木 box，跳过');
        else {
          const out = lines.join('\n').replace(/\n?$/, '\n')
            + '\n# --- U 形承轨槽薄板（交叉，box；两个方向各一套）---\n'
            + add.join('\n') + '\n';
          fs.writeFileSync(g, out, 'utf8');
          log(`  ✔ ${rel(g).padEnd(34)} 加 U 槽薄板 ${add.length} 片`
            + `（X 向 ${famA.size} 根 / Y 向 ${famB.size} 根）`);
        }
      }
    }

    // -----------------------------------------------------------------------
    // 坡道的 U 形承轨槽（quad 版，**必须跟着坡度倾斜**）
    //
    //   坡道模型的枕木是 box，但**整体绕 y 轴倾斜** —— 实测 dz/dx ≈ −0.20625，
    //   正好等于一个地形高差 0.2041（模型头：z 0.2100@x=0.0200 → 0.2133@x=0.0040）。
    //   ⇒ 薄板不能用 prism（prism 顶面是平的），必须发成**四点独立 z 的 quad**。
    //
    //   每根枕木（按它的 x 范围分组）取两端最高 z，然后在 z 之上 0.0003 叠 3 片：
    //     y ∈ [0.43,0.466] 深色 / [0.466,0.534] 中间调 / [0.534,0.57] 深色
    // -----------------------------------------------------------------------
    {
      const BANDS = [
        [0.4300, 0.4660, 'trim_dark'],
        [0.4660, 0.5340, 'concrete_seam'],
        [0.5340, 0.5700, 'trim_dark'],
      ];
      const DZ = 0.0003;
      for (const dst of ['G2_track_slope', 'G2_rail_slope']) {
        const g = path.join(ROOT, 'models', dst + '.model');
        if (!fs.existsSync(g)) { log(`  × 跳过 ${dst}：还不存在`); continue; }
        const lines = fs.readFileSync(g, 'utf8').split('\n');
        const grp = new Map();      // x0|x1 → { x0, x1, z0, z1 }（两端最高 z）
        for (const ln of lines) {
          const m = /^quad\s+(.+)$/.exec(ln);
          if (!m) continue;
          const t = m[1].trim().split(/\s+/);
          if (!/^concrete/.test(t[t.length - 1])) continue;
          const n = t.slice(0, t.length - 1).map(Number);
          if (n.length !== 12 || n.some((v) => !isFinite(v))) continue;
          const xs = [n[0], n[3], n[6], n[9]], zs = [n[2], n[5], n[8], n[11]];
          const x0 = Math.min(...xs), x1 = Math.max(...xs);
          // ⚠ 枕木的**侧面/端面** quad 在 x 上是退化的（x0 == x1），
          //   不过滤的话会被当成一根根独立的枕木，根数会多 3 倍
          //   （2026-10-02 踩过：25 根被数成 75 根）。
          if (x1 - x0 < 0.003) continue;
          const key = `${x0.toFixed(4)}|${x1.toFixed(4)}`;
          const r = grp.get(key) || { x0, x1, z0: -Infinity, z1: -Infinity };
          for (let i = 0; i < 4; i++) {
            if (Math.abs(xs[i] - x0) < 1e-6) r.z0 = Math.max(r.z0, zs[i]);
            if (Math.abs(xs[i] - x1) < 1e-6) r.z1 = Math.max(r.z1, zs[i]);
          }
          grp.set(key, r);
        }
        const add = [];
        for (const [, r] of grp) {
          if (!isFinite(r.z0) || !isFinite(r.z1)) continue;
          for (const [y0, y1, mat] of BANDS) {
            const za = (r.z0 + DZ).toFixed(4), zb = (r.z1 + DZ).toFixed(4);
            const xa = r.x0.toFixed(4), xb = r.x1.toFixed(4);
            add.push(`quad ${xa} ${y0} ${za}  ${xa} ${y1} ${za}  `
              + `${xb} ${y1} ${zb}  ${xb} ${y0} ${zb}   ${mat}`);
          }
        }
        if (!add.length) { log(`  × ${dst}：没找到枕木 quad，跳过`); continue; }
        const out = lines.join('\n').replace(/\n?$/, '\n')
          + '\n# --- U 形承轨槽薄板（坡道，quad；跟着坡度倾斜）---\n'
          + add.join('\n') + '\n';
        fs.writeFileSync(g, out, 'utf8');
        log(`  ✔ ${rel(g).padEnd(34)} 加 U 槽薄板 ${add.length} 片（${grp.size} 根枕木）`);
      }
    }
  }
  log('');
  log('  每方向屏幕偏移（px，正=右/下）—— 改这张表后重跑本工具：');
  log('  ' + pad('方向', 8) + pad('屏幕偏移', 12) + pad('世界位移', 24) + pad('纵向', 10) + '横向');
  for (const [k, v] of Object.entries(DIR_DELTA)) {
    const [wx, wy] = SHIFT[k];
    // 自检：把世界位移反算回屏幕像素，必须与表里填的一致
    const bx = (wy - wx) * 128, by = (wx + wy) * 64;
    const ok = Math.abs(bx - v[0]) < 1e-6 && Math.abs(by - v[1]) < 1e-6;
    // 沿哪个轴跑：X/Y 是整格对角（一条长轨），半格带也一样按自己的轴算
    const axis = (k === 'X' || k === 'UPPER' || k === 'LOWER') ? 'x' : 'y';
    const along = Math.hypot(...(axis === 'x' ? [wx * 128, wx * 64] : [wy * 128, wy * 64]));
    const cross = Math.hypot(...(axis === 'x' ? [wy * 128, wy * 64] : [wx * 128, wx * 64]));
    log(`    ${pad(k, 8)} ${pad((v[0] >= 0 ? '+' : '') + v[0] + ', ' + (v[1] >= 0 ? '+' : '') + v[1], 12)}` +
        `${pad(wx.toFixed(5) + ', ' + wy.toFixed(5), 24)}${pad(along.toFixed(2) + 'px', 10)}${cross.toFixed(2)}px` +
        (ok ? '' : '   × 表写错了'));
  }
  log('    ↑ 纵向分量：钢轨/道砟是连续的，补空白会把纵向那截抵消；');
  log('      但**枕木相位会跟着位移走**（末端不够会多铺一根补上），这一项在实机里看得见。');
  log(`    ★ 交叉专用增量 X ${JSON.stringify(EFF_CROSS_X_EXTRA)} / Y ${JSON.stringify(EFF_CROSS_Y_EXTRA)} px` +
      ` ⇒ G1_crossing（及褐色 / G2 派生两张）实际用 X ` +
      `${JSON.stringify(EFF_DELTA.X.map((v, i) => v + EFF_CROSS_X_EXTRA[i]))} / Y ` +
      `${JSON.stringify(EFF_DELTA.Y.map((v, i) => v + EFF_CROSS_Y_EXTRA[i]))} px；` +
      '平交道口 / 三向 / 四向不加。');
  if (clipped) log(`  ⚠ 有 ${clipped} 处几何被 clipBox 剪到 —— 正常情况下应该是 0`);
  log('');
  log('  下一步：make render → make sprites（核对锚点）→ make check');
  return out;
}

if (isMain(import.meta.url)) {
  log('生成 G1 交叉 + 道岔：');
  generate();
}
