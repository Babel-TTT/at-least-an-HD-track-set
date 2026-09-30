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
// ---------------------------------------------------------------------------
export const DIR_DELTA = {
  X:     [+5, -2],   // TRACK_X  （整格对角，沿世界 x）  ← 人工在实机里测出的新值
  Y:     [ 0,  0],   // TRACK_Y  （整格对角，沿世界 y）
  UPPER: [+3, -2],   // 屏幕上水平带（上）
  LOWER: [+2, -2],   // 屏幕上水平带（下）
  LEFT:  [ 0,  0],   // 屏幕上竖直带（左）
  RIGHT: [ 0,  0],   // 屏幕上竖直带（右）
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
  const [wx, wy] = SHIFT[key];
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
    hz: (i, k) => 0.002 + 0.005 * (0.5 + 0.5 * Math.sin(i * 1.7 + k * 2.3)) + 0.0006 * ((i * 7 + k * 13) % 5) / 4,
  };
}

const N = (v) => v.toFixed(4);
const pad = (s) => String(s).padEnd(9);
const CN = 32, RN = 32;               // 道砟网格
const SLEEPER_MAT = ['wood_dark', 'wood_seam', 'wood_dark', 'wood_seam'];

/** 道砟并集网格 */
function ballastQuads(keys, seed) {
  const u = makeUnion(keys, seed);
  const L = [];
  let n = 0;
  for (let k = 0; k < RN; k++) for (let i = 0; i < CN; i++) {
    const x0 = i / CN, x1 = (i + 1) / CN, y0 = k / RN, y1 = (k + 1) / RN;
    if (!u.test((x0 + x1) / 2, (y0 + y1) / 2, i, k)) continue;
    L.push('quad ' + N(x1) + ' ' + N(y0) + ' ' + N(u.hz(i + 1, k)) +
           '  ' + N(x1) + ' ' + N(y1) + ' ' + N(u.hz(i + 1, k + 1)) +
           '  ' + N(x0) + ' ' + N(y1) + ' ' + N(u.hz(i, k + 1)) +
           '  ' + N(x0) + ' ' + N(y0) + ' ' + N(u.hz(i, k)) + '   gravel');
    n++;
  }
  return { lines: L, n };
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
  const [wx, wy] = SHIFT[key];
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
  const [wx, wy] = SHIFT[shiftKey];
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
      L.push('box ' + N(box[0]) + ' ' + N(box[1]) + ' 0.0040  ' +
             N(box[2]) + ' ' + N(box[3]) + ' 0.0140  ' +
             pad(SLEEPER_MAT[((k + s) % 4 + 4) % 4]) + ' top=wood_seam');
    }
  }
  return L;
}

/** 某个方向的两根钢轨（轴线在 [0.4444,0.4524] / [0.5476,0.5556]），按偏移挪位 */
function railBoxes(axis, zTop, shiftKey) {
  const [wx, wy] = SHIFT[shiftKey];
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
    const { lines, n } = ballastQuads(['X', 'Y'], 20260930);
    let s = header('G1_crossing —— G1 几何组：平交道口轨（TRACK_BIT_CROSS = X | Y）',
      '# 喂给 underlay 的 RTO_CROSSING_XY（1 个朝向）。\n'
      + '# 【为什么自带钢轨】核自 OpenTTD 源码 rail_cmd.cpp:3790：交叉瓦片只画\n'
      + '#   DrawGroundSprite(ground + RTO_CROSSING_XY)，**不叠加任何 overlay**\n'
      + '#   （道岔才是「道砟 underlay + 逐段 overlay 钢轨」）。rail.h:84 的注释也\n'
      + '#   写着「Crossing of X and Y rail, with ballast」。\n#\n'
      + '# 【本模型的关键】X 轨与 Y 轨各自的屏幕偏移**不同**（见表），一张精灵只能有一个\n'
      + '#   xrel/yrel ⇒ 两个方向的偏移都烘进下面的坐标里。\n'
      + '#   X 方向偏移 ' + JSON.stringify(DIR_DELTA.X) + ' px，Y 方向 ' + JSON.stringify(DIR_DELTA.Y) + ' px\n'
      + '#\n'
      + '# 【中心处理】两组钢轨都画满；Y 轨抬 0.001 格（=0.16px）只为定序；\n'
      + '#   Y 轨枕跳过中心 5 根，让中间的枕木只属于 X 轨，避免叠成一片。\n');
    s += 'name      G1_crossing\ngroup     misc\nfootprint 1 1\nzmax      0.028\n\n';
    s += '# --- 道砟：X 带 ∪ Y 带 的并集（各自按自己的屏幕偏移挪位），' + CN + 'x' + RN + ' 网格 ---\n';
    s += lines.join('\n') + '\n';
    s += '\n# --- 轨枕：X 轨 25 根画满（偏移 ' + DIR_DELTA.X.join(',') + '）---\n';
    s += sleeperBoxes('x', 0.008, 'X', false).join('\n') + '\n';
    s += '\n# --- 轨枕：Y 轨 25 根，跳过中心 5 根（偏移 ' + DIR_DELTA.Y.join(',') + '）---\n';
    s += sleeperBoxes('y', 0.008, 'Y', true).join('\n') + '\n';
    s += '\n# --- 钢轨：X 组 2 根（z 0.0140->0.0270，偏移 ' + DIR_DELTA.X.join(',') + '）---\n';
    s += railBoxes('x', 0.0270, 'X').join('\n') + '\n';
    s += '\n# --- 钢轨：Y 组 2 根（z 0.0150->0.0280，偏移 ' + DIR_DELTA.Y.join(',') + '）---\n';
    s += railBoxes('y', 0.0280, 'Y').join('\n') + '\n';
    out.push(['G1_crossing', s, n]);
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
  if (clipped) log(`  ⚠ 有 ${clipped} 处几何被 clipBox 剪到 —— 正常情况下应该是 0`);
  log('');
  log('  下一步：make render → make sprites（核对锚点）→ make check');
  return out;
}

if (isMain(import.meta.url)) {
  log('生成 G1 交叉 + 道岔：');
  generate();
}
