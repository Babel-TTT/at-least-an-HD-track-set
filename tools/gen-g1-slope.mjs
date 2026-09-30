// =============================================================================
// tools/gen-g1-slope.mjs —— 生成 G1 的「坡道」两个模型
//
//   node tools/gen-g1-slope.mjs          （或 make slope）
//
// 产出（**会被本工具整份重写**，别手改）：
//   models/G1_track_slope.model   underlay 槽 6-9：坡上的道砟 + 枕木 + 钢轨
//   models/G1_rail_slope.model    overlay  槽 6-9：只要枕木 + 钢轨（透明底）
//   两个都是 4 朝向。
//
// -----------------------------------------------------------------------------
// 【抬升量：32 px，实测自 China-Set-Tracks-Neo 的坡道实验精灵】
//
//   gfx/rails/test/test-pre_01_32bpp.png  平轨  内容高 129 px（= 菱形 128 + 1）
//   gfx/rails/test/test-pre_up_32bpp.png  坡道  内容高 161 px（= 129 + 32）
//   ⇒ 一格坡道抬升 32 px @4x
//   ⇒ flatiso 的 z：32 / 156.7673 = **0.2041 格**
//
//   交叉验算：OpenTTD 里坡道抬 8 单位、一格 16 单位 ⇒ 0.5；
//   而 flatiso 竖轴是 OpenTTD 的 156.7673/64 = 2.4495 ≈ 2.45 倍 ⇒ 0.5/2.45 = 0.2041 ✓
//
// -----------------------------------------------------------------------------
// 【方向映射：核自 OpenTTD 源码】
//
//   rail.h:  RTO_N,        ///< Piece of rail in northern corner     ← 是【角】不是边
//            RTO_SLOPE_NE, ///< Piece of rail on slope with north-east raised
//   rail_cmd.cpp:3768-3779 的配对：
//            SLOPE_NW + TRACK_BIT_Y -> RTO_SLOPE_NW
//            SLOPE_NE + TRACK_BIT_X -> RTO_SLOPE_NE
//            SLOPE_SE + TRACK_BIT_Y -> RTO_SLOPE_SE
//            SLOPE_SW + TRACK_BIT_X -> RTO_SLOPE_SW
//
//   瓦片四角 ↔ flatiso 坐标（由 RTO_N/E/S/W ↔ 半格轨贴哪个角反推，已在实机验证）：
//            北 N = (0,0)  西 W = (1,0)  南 S = (1,1)  东 E = (0,1)
//
//   SLOPE_NE = N 角与 E 角同时抬起 = 抬的是 **x=0 那条边**；
//   而它的轨道是 TRACK_X（沿 x 的弦），正好垂直于抬起的边 ⇒ 轨道顺着坡往上走 ✓
//
//   槽位          轨道        抬起的边      flatiso 抬升方向
//   SLOPE_NE      TRACK_X     x=0 边        朝 x=0 抬（x=0 高、x=1 低）   ← 本模型基准
//   SLOPE_SW      TRACK_X     x=1 边        朝 x=1 抬
//   SLOPE_SE      TRACK_Y     y=1 边        朝 y=1 抬
//   SLOPE_NW      TRACK_Y     y=0 边        朝 y=0 抬
//
//   【取图顺序】= v0=NE, v1=NW, v2=SW, v3=SE
//     flatiso 的「朝向」是**绕占地中心旋转模型**（core/raster.mjs:19-42），
//     90° 那一步是 (x,y) → (1−y, x) ⇒ view k 把 view0 里位于角 C 的特征搬到
//     R^(-k)(C)，其中 R 就是引擎的四重旋转（北→东→南→西）。
//     view0 抬的是 N–E 边，于是：
//       v0 → N–E(右上)=NE   v1 → N–W(左上)=NW
//       v2 → S–W(左下)=SW   v3 → S–E(右下)=SE
//     ⚠ 引擎槽位顺序是 NE / SE / SW / NW（rail.h:80-83），所以喂图时
//       **槽 7 要 v3、槽 8 要 v2**，不是顺序贴。见 src/rails/railsprite.pnml。
//
// -----------------------------------------------------------------------------
// 【基准朝向 = SLOPE_NE】地面 z 只随 x 变：   z(x) = RISE · (1 − x)
//   道砟、枕木、钢轨的每个顶点都按 z(x) 抬，所以它们自然贴合成一个斜面。
//
//   ⚠ 坡面上的枕木/钢轨是**倾斜**的，flatiso 的 `box` / `prism` 是轴对齐的，
//     用不了 ⇒ 全部用 `quad` 拼（顶面 + 可见侧面）。
//
//   ⚠ 本模型的偏移**不烘进几何**：坡道每个朝向各有一张模板，偏移由人在
//     Sprite Aligner 里调（按 §7.3 的新规矩）。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { ROOT, log, rel, isMain } from './util.mjs';

const N = (v) => v.toFixed(4);
const pad = (s) => String(s).padEnd(9);
const SLEEPER_MAT = ['wood_dark', 'wood_seam', 'wood_dark', 'wood_seam'];

// ---- 几何常量（与平轨那套完全对齐，只是整条随坡面抬）---------------------
const RISE = 0.2041;                 // 一格内的抬升量（32 px @4x）
const ZG = (x) => RISE * (1 - x);    // SLOPE_NE 的地面：x=0 边最高
const B0 = 0.32, B1 = 0.68;          // 道砟带宽（与 probe_track_x 一致）
const CN = 32, RN = 5;               // 道砟网格
const SLEEPER_BASE = 0.0000;         // 枕木底（世界 z，未加地面）
const SLEEPER_TOP = 0.0100;          // 枕木顶
const RAIL_BASE = 0.0100;            // 钢轨底（坐在枕木顶上）
const RAIL_TOP = 0.0230;             // 钢轨顶
const RAIL_Y = [[0.5476, 0.5556], [0.4444, 0.4524]];   // 两条钢轨的 y 区间（轴线 0.5±0.0516）

// ---- 会随坡面倾斜的长方体：八个顶点的高度都按 z(x) 定 --------------------
/**
 * @param {number} x0,x1,y0,y1  平面范围
 * @param {number} zb,zt        底/顶相对地面的高度
 * @param {string} side         侧面材质
 * @param {string|null} top     顶面材质（null = 与侧面同）
 */
function slab(x0, y0, x1, y1, zb, zt, side, top = null) {
  const Z = (x, z) => ZG(x) + z;
  const L = [];
  // 顶面（逆时针一圈；与道砟 quad 同序）
  L.push('quad ' + N(x1) + ' ' + N(y0) + ' ' + N(Z(x1, zt)) +
         '  ' + N(x1) + ' ' + N(y1) + ' ' + N(Z(x1, zt)) +
         '  ' + N(x0) + ' ' + N(y1) + ' ' + N(Z(x0, zt)) +
         '  ' + N(x0) + ' ' + N(y0) + ' ' + N(Z(x0, zt)) +
         '   ' + (top ?? side));
  // 四个侧面（底面不做 —— 贴地看不见）
  const side4 = [
    // x = x1 面
    [[x1, y0, zt], [x1, y1, zt], [x1, y1, zb], [x1, y0, zb]],
    // x = x0 面
    [[x0, y0, zt], [x0, y0, zb], [x0, y1, zb], [x0, y1, zt]],
    // y = y0 面
    [[x0, y0, zt], [x1, y0, zt], [x1, y0, zb], [x0, y0, zb]],
    // y = y1 面
    [[x0, y1, zt], [x0, y1, zb], [x1, y1, zb], [x1, y1, zt]],
  ];
  for (const f of side4) {
    L.push('quad ' + f.map(([x, y, z]) => N(x) + ' ' + N(y) + ' ' + N(Z(x, z))).join('  ') + '   ' + side);
  }
  return L;
}

// ---- 道砟：铺满 X 带，z 随坡面 ------------------------------------------
function slopeBallast(seed) {
  const rnd = (() => { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  // 外围两行的带状边缘做折线扰动（与 probe_track_x 同风格）
  const wav = [];
  for (let i = 0; i <= CN; i++) wav.push([(rnd() - 0.5) * 2 * 0.012, (rnd() - 0.5) * 2 * 0.012]);
  const yb = (r, i) => (r === 0 ? B0 + wav[i][0] : r === RN ? B1 + wav[i][1] : B0 + (B1 - B0) * r / RN);
  const hz = (r, i) => 0.0005 + 0.005 * (0.5 + 0.5 * Math.sin(i * 1.7 + r * 2.3)) + 0.0006 * ((i * 7 + r * 13) % 5) / 4;
  const L = [];
  const X = (i) => i / CN;
  for (let r = 0; r < RN; r++) for (let i = 0; i < CN; i++) {
    const x0 = X(i), x1 = X(i + 1), y0 = yb(r, i), y1 = yb(r + 1, i);
    L.push('quad ' + N(x1) + ' ' + N(y0) + ' ' + N(ZG(x1) + hz(r, i + 1)) +
           '  ' + N(x1) + ' ' + N(y1) + ' ' + N(ZG(x1) + hz(r + 1, i + 1)) +
           '  ' + N(x0) + ' ' + N(y1) + ' ' + N(ZG(x0) + hz(r + 1, i)) +
           '  ' + N(x0) + ' ' + N(y0) + ' ' + N(ZG(x0) + hz(r, i)) + '   gravel');
  }
  return L;
}

// ---- 枕木：沿 y 的条，按坡面倾斜 ----------------------------------------
function slopeSleepers() {
  const L = [];
  const NT = 25, HW = 0.008;           // 与平轨一致：25 根、宽 0.016
  for (let i = 0; i < NT; i++) {
    const t = 0.012 + 0.976 * i / (NT - 1);
    for (let s = 0; s < 3; s++) {
      const a = 0.41 + 0.06 * s, b = a + 0.06;
      L.push(...slab(t - HW, a, t + HW, b, SLEEPER_BASE, SLEEPER_TOP,
        SLEEPER_MAT[(i + s) % 4], 'wood_seam'));
    }
  }
  return L;
}

// ---- 钢轨：沿 x 的两条，按坡面倾斜 --------------------------------------
function slopeRails() {
  const L = [];
  for (const [a, b] of RAIL_Y) {
    L.push(...slab(0, a, 1, b, RAIL_BASE, RAIL_TOP, 'rust', 'metal'));
  }
  return L;
}

// ---------------------------------------------------------------------------
function header(name, title, extra) {
  return '# =============================================================================\n'
    + '# ' + name + ' —— ' + title + '\n#\n'
    + '# 【本文件由 tools/gen-g1-slope.mjs 生成，请勿手改】\n#\n'
    + extra
    + '# =============================================================================\n\n';
}

const WHY = '# 抬升量 32 px @4x（实测自 China-Set-Tracks-Neo 的坡道实验精灵）\n'
  + '#   = 0.2041 格（flatiso z；32 / 156.7673）\n'
  + '# 基准朝向 = SLOPE_NE：地面 z(x) = 0.2041·(1 − x)，即 x=0 那条边最高\n'
  + '# 取图顺序 v0=NE  v1=NW  v2=SW  v3=SE（绕占地中心转模型推出）\n'
  + '#   ⚠ 引擎槽位顺序是 NE/SE/SW/NW ⇒ 槽 7 用 v3、槽 8 用 v2\n'
  + '# 偏移不烘进几何：坡道每个朝向各有一张模板，由人在 Sprite Aligner 里调\n'
  + '#\n';

export function generateSlope() {
  const ballast = slopeBallast(20260930);
  const sleepers = slopeSleepers();
  const rails = slopeRails();

  const out = [];

  // underlay：道砟 + 枕木 + 钢轨
  {
    let s = header('G1_track_slope', 'G1 几何组：坡道（underlay 槽 RTO_SLOPE_NE/SE/SW/NW）', WHY);
    s += 'name      G1_track_slope\ngroup     misc\nfootprint 1 1\nzmax      0.2300\n\n';
    s += '# --- 道砟（随坡面抬）' + CN + 'x' + RN + ' = ' + ballast.length + ' 面 ---\n';
    s += ballast.join('\n') + '\n';
    s += '\n# --- 轨枕 ' + (sleepers.length / 6) + ' 根 x 3 段，倾斜（每根 6 面）---\n';
    s += sleepers.join('\n') + '\n';
    s += '\n# --- 钢轨 2 根，倾斜（每根 5 面）---\n';
    s += rails.join('\n') + '\n';
    out.push(['G1_track_slope', s, ballast.length + sleepers.length + rails.length]);
  }

  // overlay：只要枕木 + 钢轨
  {
    let s = header('G1_rail_slope', 'G1 几何组：坡道的 overlay（只要枕木 + 钢轨，透明底）', WHY
      + '# ⚠ overlay 必须透明底、只画钢轨和轨枕，否则会把道砟又盖一层\n#\n');
    s += 'name      G1_rail_slope\ngroup     misc\nfootprint 1 1\nzmax      0.2300\n\n';
    s += '# --- 轨枕（倾斜）---\n' + sleepers.join('\n') + '\n';
    s += '\n# --- 钢轨（倾斜）---\n' + rails.join('\n') + '\n';
    out.push(['G1_rail_slope', s, sleepers.length + rails.length]);
  }

  for (const [name, text, nf] of out) {
    const f = path.join(ROOT, 'models', name + '.model');
    fs.writeFileSync(f, text, 'utf8');
    log(`  ✔ ${rel(f).padEnd(34)} ${String(text.split('\n').length).padStart(4)} 行   ${nf} 面`);
  }
  log('');
  log('  抬升量  RISE = ' + RISE + ' 格 = ' + (RISE * 156.7673).toFixed(1) + ' px @4x');
  log('  地面    z(x) = ' + RISE + '·(1 − x)   （x=0 边最高）');
  log('  结构    道砟 ' + ballast.length + ' 面 + 枕木 ' + (sleepers.length / 6) + ' 根(x6) + 钢轨 2 根(x5)');
  log('');
  log('  下一步：make render → make sprites（核对锚点）→ make check');
  return out;
}

if (isMain(import.meta.url)) {
  log('生成 G1 坡道：');
  generateSlope();
}
