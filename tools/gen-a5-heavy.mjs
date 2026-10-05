// =============================================================================
// tools/gen-a5-heavy.mjs —— 生成 A5 组（`SBEN` + `SBEA`，重载）的模型
//
//   node tools/gen-a5-heavy.mjs
//
// 人工 2026-10-05 批准新建（铁律 L3 的申请），只写 `models/G6_*.model`。
//
// -----------------------------------------------------------------------------
// 【口径：§6 确认门（人工 2026-10-05「按推荐执行，SLE-3 仿照 G2 要 U 形承轨槽」）】
//
//   覆盖轨道 `SBEN`（现代重载铁路 · 1983 · 120km/h · 非电）
//            `SBEA`（电气化重载 25kV AC · 1983 · 120km/h）
//   A5 组 = 道床 `BAL-B` + 轨枕 `SLE-3` + 钢轨 `RAI-2` + 洞口 `TUN-6`
//
//   ① `BAL-B` 厚道床：横向 0.36 → **0.40 格**（肩宽 5.00 → 5.56 m，屏幕 46 → 51 px）
//      顶面抬厚：源最高 0.0055~0.0061 → **0.0065~0.0078 格**（+1.4~2.4 cm，把枕木埋掉 65~78 %）
//      ⚠ 为什么不是更高：U 形槽底是 0.0087，道床再抬就把槽埋了。4x 下竖向 1 cm 只有 0.11 px，
//        "厚道床"本来就只能靠**宽 + 颗粒 + 埋枕**读，不能靠绝对高度。
//      颗粒粗化：高度场台阶 0.00015 → **0.0013 格**（相邻格并成同一平面 ⇒ 粒径变粗）
//   ② `SLE-3` 混凝土宽枕（**仿 G2 的 U 形承轨槽**）：厚 0.016 → **0.0215 格**（30 cm）、
//      长 0.18 → **0.19 格**（2.64 m）；材质用**冷灰** `concrete_mid`(159,165,175)
//      ＋ 顶面 `metal_pale`(190,195,199)。
//      ⚠ G2 的教训：它的枕顶是 `concrete_seam`(152,149,141)，与道砟 `gravel`(156,149,138)
//        **几乎同色** ⇒ 实机里混凝土枕几乎看不见（见 out/rimg/a5_sleeper8x.png 右）。
//      槽底由 G2 的 `trim_dark`(62,66,71) 改成 `panel_seam`(96,96,96)（少一串黑点）。
//   ③ `RAI-2` 75kg/m 重载轨：宽 0.0080 → **0.0104 格**（11.1 → 14.5 cm）、
//      轨底 0.0100 → **0.0085**（高 18.1 → 20.2 cm）。
//      ★ **轨顶 z 0.0230 不动** —— 人工在 G2 那轮定过「铁轨的高度要和之前的枕木保持一致」，
//        动了车就会浮/沉。所以只能"往下长 + 加宽"，竖向只多 0.24 px、横向 0.3 px。
//   ④ `TUN-6` 重载加固端墙：以 TUN-2（素混凝土深灰）为底，**洞口区横向 ×1.129**
//      ⇒ 端墙 0.68 → 0.768 格（10.7 m）、洞跨 0.31 → 0.35 格（4.87 m，拱顶高不动 ⇒ 大断面），
//      再在洞正面加一圈**凸出的加固环框**（亮一档 `concrete_mid`，外凸 0.026 格）。
//      ⚠ 只对 |y−0.5| ≤ 0.36 的顶点做横向放大 —— 仰面（山体）后沿必须仍然铺满整格。
//      ★ 2026-10-05 修正：第一版取 `G1_tunnel_stone`（**TUN-1 料石**）却**忘了做材质替换**
//        ⇒ 产物其实是料石色。现在补上 `recolor: 'tun2'`，与 TUN-2 的配色逐面一致。
//
// -----------------------------------------------------------------------------
// 【为什么是「从 G1 的既有模型派生」而不是重画一套】
//
//   与 A15 同理：G1 的几何是实机调了十几轮的结果（道砟并集 + 毛边抖动、枕木相位、
//   交叉/道岔的逐方向屏幕偏移、隧道口拱线 128 段…）。重画只会更差。
//   本工具**逐行读 G1 的模型、逐行写 G6**，产物仍是完全写死的字面量
//   （符合 flatiso「模型是资产不是程序」的要求）。
//
// -----------------------------------------------------------------------------
// 【横向是哪一维 —— 逐 kind 不同（与 A15 同一套口径）】
//
//   kind 'y'      整格直线 / 平交道口：横向 = y（轨道沿 x，中线 y = 0.5）
//   kind 'diag'   斜向半格轨（切 N 角）：横向 = **x + y**（轨道线 x + y = 0.5）
//   kind 'cross'  交叉 / 三向 / 四向：**两个方向混在一个模型里** ⇒ 逐坐标判带
//   kind 'slope'  坡道：横向 = y，但**沿轨不探出**（延了会顶格位/穿地）
//   kind 'tunnel' 洞口：**只有轨道材质**走轨道那一套（横向 = y），
//                 洞门（stone*/dirt）走「洞口横向 ×1.129」，仰面后沿不动
//
// -----------------------------------------------------------------------------
// 【枕木：三种表示，三套做法（关键）】
//
//   直线 / 交叉 / 道口：枕木是 **box**（轴对齐长方体，每根 3 段）
//     斜向：**prism**（45° 平行四边形，横向坐标 x + y）
//     坡道 / 隧道：**quad**（每段 5 个面：顶 + 4 侧；坡道的顶面随 x 倾斜）
//
//   ① box / prism ⇒ 直接吐「底板 + 分带条」两层的实体（**G2 的构造，逐字照搬**）：
//        底板   z 0     → 0.0075   枕身色 / 顶 = concrete_seam（看不见，被条盖住）
//        挡肩条 z 0.0075 → 0.0100   枕身色 / 顶 = metal_pale
//        中间条 z 0.0075 → 0.0095   枕身色 / 顶 = concrete_mid
//        槽底条 z 0.0075 → 0.0087   panel_seam（顶同色）
//   ② 隧道（quad 但**平**）⇒ 每段按它的顶面轮廓**改吐成 box**（box 是实心体，能挖出槽）
//   ③ 坡道（quad 且**随 x 倾斜**）⇒ prism/box 都做不了斜的槽 ⇒ **只切顶面、只换颜色**
//      （槽深 0.0013 格 = 0.2 px，4x 下本来就看不见；形状不能动，动了与钢轨的坡度对不上）
//
//   ⚠ 枕木的「相位」是烘进坐标的（交叉的 X/Y 两个方向各有自己的屏幕位移），
//     所以本工具**不重排枕木**，只把每一根就地加长/加厚/挖槽 ⇒ 方向偏移天然保留。
//     横向加长一律**绕该方向的中心**（0.5 + 位移）缩，不许绕 0.5 —— 否则枕木会从钢轨底下挪开。
//     各方向的位移由**钢轨自己的位置**反推：shift = mean(该方向两条轨的中心) − 0.5。
//
// -----------------------------------------------------------------------------
// 【探出边界（盖接缝）】—— 与 A15 同一套，含那条 0.0005 的教训
//
//   碰到瓦片边、且**沿轨全长**的顶点向外挪 OVER（1/32 格）：道床 / 钢轨探，枕木不探。
//   ⚠ 钢轨单独用放宽到 `TOL`(=0.001 > 0.0005) 的判据 —— 源里钢轨被
//     `gen-g1-switches.mjs` 的 clipBox 钳在 0.0005/0.9995，用「正好贴边」判会探不出去，
//     而道砟板是 quad、正好 0/1、**反而探了** ⇒ 缝上留一条光板（2026-10-05 实机报过）。
//   ⚠ 坡道不探出（同 A12/A15 口径）。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { ROOT, log, rel, isMain } from './util.mjs';

// ---------------------------------------------------------------- 口径常量
const K_BAL = 0.40 / 0.36;          // 道床横向加宽 1.1111
const BAL_ZK = 1.28;                // 道床顶面抬厚倍率（0.0061 → 0.0078）
const BAL_ZS = 0.0013;              // 道床高度场台阶（粗化粒径）
const K_SLEEP_L = 0.19 / 0.18;      // 枕木横向加长 1.0556
const K_SLEEP_T = 0.0215 / 0.016;   // 枕木沿轨加厚 1.3438
const K_RAIL_W = 0.0104 / 0.0080;   // 钢轨加宽 1.30
const RAIL_DROP = 0.0015;           // 轨底往下（轨顶 0.0230 不动）
const RISE = 0.2041;                // 一层地形 = 一个坡道格的高差（源模型里的实测值）

const Z_BASE = 0.0075, Z_PAD = 0.0087, Z_MID = 0.0095, Z_TOP = 0.0100;
const CUT = [0.4300, 0.4660, 0.5340, 0.5700];   // 承轨槽 4 条分带线（未加位移的名义值）

const M_BODY = 'concrete_mid';     // 枕身（冷灰 159,165,175）
const M_SH = 'metal_pale';         // 挡肩顶（冷白 190,195,199）
const M_MID = 'concrete_mid';      // 中间体顶
const M_PAD = 'panel_seam';        // 槽底（96,96,96）
const M_BASE = 'concrete_seam';    // 底板顶（看不见）

const OVER = 0.03125;              // 沿轨探出 1/32 格
const EDGE = 0.195;                // 交叉/道岔「这一维属于哪条带」的阈值（带半宽 0.18 + 抖动）
const TOL = 0.001;                 // 钢轨「到头」容差（必须 > clipBox 的 0.0005）
const PORTAL_S = 0.35 / 0.31;      // 洞口区横向放大 1.1290（端墙 0.68 → 0.768 格）
const PORTAL_EDGE = 0.36;          // 只放大 |y−0.5| ≤ 这个范围的顶点（仰面后沿必须铺满整格）
const RING_X0 = 0.8000;            // 端墙正面
const RING_X1 = 0.8260;            // 加固环框外凸到 x
const RING_Z0 = 0.1900;            // 环框柱身在底图里的上端（= TUN-1 的分层线「起拱线」）
const ARCH_CROWN = 0.2000;         // 拱顶高（TUN-1/TUN-2 的常量，不动）
const ARCH_R = 0.1550;             // 拱半径（TUN-1/TUN-2 的常量）
const RING_W = 0.0200;             // 环框宽度
const RING_TOP = 0.2270;           // 环框顶（= 压顶底面）

const RAIL_MAT = /^(rust|metal)$/;
const WOOD_MAT = /^wood/;

/**
 * 作业表：源模型 → 产物模型。
 *   kind  横向口径（见文件头）
 *   over  沿轨探出边界（坡道 false）
 *   ring  隧道口要追加的加固环框件：'a' | 'b' | 'lintel'
 */
const JOBS = [
  // ---- 轨道：underlay（自带道砟 + 轨枕 + 钢轨）----
  { src: 'probe_track_x', dst: 'G6_track_x', kind: 'y', over: true,
    note: 'underlay 槽 0/1（RTO_X / RTO_Y）：厚道床 + 混凝土宽枕 + 重轨' },
  { src: 'G1_rail_straight', dst: 'G6_rail_straight', kind: 'y', over: true,
    note: 'overlay 槽 0/1：钢轨层（透明底）' },
  // ---- 斜向（切 N 角）----
  { src: 'probe_half_upper', dst: 'G6_track_half', kind: 'diag', over: true,
    note: 'underlay 槽 2-5（RTO_N / S / E / W）：切 N 角的半格轨' },
  { src: 'G1_rail_halftrack', dst: 'G6_rail_half', kind: 'diag', over: true,
    note: 'overlay 槽 2-5：半格轨的钢轨层' },
  // ---- 坡道（**不探出**；枕木只切顶面换颜色，见文件头）----
  { src: 'G1_track_slope', dst: 'G6_track_slope', kind: 'slope', over: false,
    note: 'underlay 槽 6-9：坡道（z 已含 RISE，不动形状）' },
  { src: 'G1_rail_slope', dst: 'G6_rail_slope', kind: 'slope', over: false,
    note: 'overlay 槽 6-9：坡道的钢轨层' },
  // ---- 交叉 / 道岔 ----
  { src: 'G1_crossing', dst: 'G6_crossing', kind: 'cross', over: true,
    note: 'underlay 槽 10（RTO_CROSSING_XY）：交叉，自带两组钢轨' },
  { src: 'G1_junction3', dst: 'G6_junction3', kind: 'cross', over: true,
    note: 'underlay 槽 11-14：三向道岔（只有道床）' },
  { src: 'G1_junction4', dst: 'G6_junction4', kind: 'cross', over: true,
    note: 'underlay 槽 15：四向道岔（只有道床）' },
  // ---- 平交道口 ----
  { src: 'G1_levelcrossing', dst: 'G6_levelcrossing', kind: 'y', over: true,
    note: 'level_crossings 的轨道图（v0 → X 槽、v3 → Y 槽）' },
  // ---- 洞口 TUN-6：重载加固端墙（端墙加宽 + 大断面拱 + 洞口加固环框）----
  //   ★ 2026-10-05 修正：本工具原来取的是 `G1_tunnel_stone`（**TUN-1 料石**）而且
  //     **没有做材质替换** ⇒ `G6_tunnel6` 实际是**料石色**，与文件头/文档写的
  //     "以 TUN-2（素混凝土深灰）为底" 不符。现在补上 `recolor: 'tun2'`（见 RECOLOR_TUN2）。
  { src: 'G1_tunnel_stone', dst: 'G6_tunnel6', kind: 'tunnel', over: true, ring: 'a', recolor: 'tun2',
    note: 'tunnels: 组（A 组：远半 y<0.5）—— 洞内轨道 + 洞门远半 + 环框左柱' },
  { src: 'G1_tunnel_stone_b', dst: 'G6_tunnel6_b', kind: 'tunnel', over: true, ring: 'b', recolor: 'tun2',
    note: 'tunnels: 组（B 组：近半 y>0.5）—— 洞内轨道 + 洞门近半 + 环框右柱' },
  { src: 'G1_tunnel_stone_over', dst: 'G6_tunnel6_over', kind: 'tunnel', over: false, ring: 'lintel', recolor: 'tun2',
    note: 'tunnel_overlay: 组（A 组）—— 洞顶 + 环框横梁' },
  { src: 'G1_tunnel_stone_over_b', dst: 'G6_tunnel6_over_b', kind: 'tunnel', over: false, ring: 'lintel', recolor: 'tun2',
    note: 'tunnel_overlay: 组（B 组）—— 洞顶 + 环框横梁' },
];

/**
 * 洞口配色替换表 —— 与 `tools/gen-g1-tunnel.mjs` 里 TUN-2 那一套**逐条一致**
 * （那边是 `s.replace(/\bstone_seam\b/g,'metal_seam').replace(/\bstone_dark\b/g,'panel_seam')
 *   .replace(/\bstone\b/g,'concrete_dark')`）。
 *
 *   ⚠ 必须在**整份 body 都发完之后**再替换（而不是逐面替换）：
 *     `G1_tunnel_stone` 里有 2 个 `stone_dark` 面会被"坡脚散粒"那条规则先接走
 *     （`mat==='stone_dark' && kw==='prism' && z1<=0.006`），逐面替换会把它们漏掉，
 *     而 TUN-2 是整文件替换 ⇒ 两边会差 2 个面的颜色。整份替换才与 TUN-2 逐面一致。
 */
const RECOLOR_TUN2 = [
  [/\bstone_seam\b/g, 'metal_seam'],
  [/\bstone_dark\b/g, 'panel_seam'],
  [/\bstone\b/g, 'concrete_dark'],
];

// ---------------------------------------------------------------- 小工具
const N = (v) => {
  const s = v.toFixed(4);
  return s === '-0.0000' ? '0.0000' : s;
};
const near0 = (v) => v <= 1e-4;
const near1 = (v) => v >= 1 - 1e-4;
const nearEdge = (v) => v <= TOL || v >= 1 - TOL;
function ext(v) {
  if (near0(v)) return -OVER;
  if (near1(v)) return OVER;
  return 0;
}
/** 钢轨专用（见文件头那条 0.0005 的教训） */
function railExt(v) {
  if (v <= TOL) return -OVER;
  if (v >= 1 - TOL) return OVER;
  return 0;
}
/** 道床顶面：抬厚 + 台阶粗化（共享顶点仍是同一个函数值 ⇒ 不会裂） */
const balZ = (z) => Math.round((z * BAL_ZK) / BAL_ZS) * BAL_ZS;
const balY = (y) => 0.5 + K_BAL * (y - 0.5);
const balS = (x, y) => {
  const d = (K_BAL - 1) * ((x + y) - 0.5) / 2;
  return [x + d, y + d];
};
const portalY = (y) => (Math.abs(y - 0.5) <= PORTAL_EDGE ? 0.5 + PORTAL_S * (y - 0.5) : y);

/** 解析一行构件；不是几何行返回 null */
function parseLine(raw) {
  const t = raw.trim().split(/\s+/);
  const kw = t[0];
  if (kw === 'quad') {
    const n = t.slice(1, 13).map(Number);
    if (n.length !== 12 || n.some((v) => !Number.isFinite(v))) return null;
    return { kw, mat: t[13], mods: t.slice(14), pts3: [[n[0], n[1], n[2]], [n[3], n[4], n[5]], [n[6], n[7], n[8]], [n[9], n[10], n[11]]] };
  }
  if (kw === 'prism') {
    const z0 = Number(t[1]), z1 = Number(t[2]);
    const pts = t.slice(4).map((p) => p.split(',').map(Number));
    if (!Number.isFinite(z0) || pts.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)))) return null;
    return { kw, z0, z1, mat: t[3], pts };
  }
  if (kw === 'poly') {
    const z = Number(t[1]);
    const pts = t.slice(3).map((p) => p.split(',').map(Number));
    if (!Number.isFinite(z) || pts.some((p) => p.length !== 2)) return null;
    return { kw, z, mat: t[2], pts };
  }
  if (kw === 'box') {
    const n = t.slice(1, 7).map(Number);
    if (n.length !== 6 || n.some((v) => !Number.isFinite(v))) return null;
    return { kw, mat: t[7], mods: t.slice(8), box: n };
  }
  return null;
}

const emitQuad = (pts, mat, mods = []) =>
  `quad ${pts.map((p) => `${N(p[0])} ${N(p[1])} ${N(p[2])}`).join('  ')}   ${[mat, ...mods].join(' ')}`;
const emitPrism = (z0, z1, pts, mat) =>
  `prism ${N(z0)} ${N(z1)}  ${mat}  ${pts.map((p) => `${N(p[0])},${N(p[1])}`).join('  ')}`;
const emitPoly = (z, pts, mat) =>
  `poly ${N(z)}  ${mat}  ${pts.map((p) => `${N(p[0])},${N(p[1])}`).join('  ')}`;
const emitBox = (b, mat, mods = []) =>
  `box ${N(b[0])} ${N(b[1])} ${N(b[2])}  ${N(b[3])} ${N(b[4])} ${N(b[5])}  ${[mat, ...mods].join(' ')}`;

/** 水平面法向的符号（Newell 的 z 分量）—— 判「这是不是枕木顶面」 */
function nzSign(pts) {
  let n = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}
const bboxX = (pts) => [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
const bboxY = (pts) => [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];

/** 凸多边形按 s = x+y ∈ [a,b] 裁剪（Sutherland–Hodgman） */
function clipS(pts, a, b) {
  const S = (p) => p[0] + p[1];
  const cut = (poly, keep) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const fp = keep === 'ge' ? S(p) - a : b - S(p);
      const fq = keep === 'ge' ? S(q) - a : b - S(q);
      if (fp >= -1e-9) out.push(p);
      if ((fp >= -1e-9) !== (fq >= -1e-9)) {
        const t = fp / (fp - fq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    return out;
  };
  return cut(cut(pts, 'ge'), 'le');
}

/** 分带（横向坐标用**未加位移**的名义值）→ 高度与材质 */
function zoneOf(t) {
  if (t < CUT[0]) return { z: Z_TOP, mat: M_BODY, top: M_SH, pad: false };
  if (t < CUT[1]) return { z: Z_PAD, mat: M_PAD, top: M_PAD, pad: true };
  if (t < CUT[2]) return { z: Z_MID, mat: M_BODY, top: M_MID, pad: false };
  if (t < CUT[3]) return { z: Z_PAD, mat: M_PAD, top: M_PAD, pad: true };
  return { z: Z_TOP, mat: M_BODY, top: M_SH, pad: false };
}
/** [lo,hi] 按分带线（已含位移）切成若干段 */
function splitByCuts(lo, hi, cuts) {
  const inner = cuts.filter((c) => c > lo + 1e-6 && c < hi - 1e-6);
  const bounds = [lo, ...inner, hi];
  const out = [];
  for (let i = 0; i + 1 < bounds.length; i++) out.push([bounds[i], bounds[i + 1]]);
  return out;
}

// ---------------------------------------------------------------- 分析
function transRange(kind, pts) {
  if (kind === 'diag') {
    const s = pts.map((p) => p[0] + p[1]);
    return [Math.min(...s), Math.max(...s)];
  }
  return bboxY(pts);
}

function analyse(kind, recs) {
  const centers = { x: [], y: [], s: [] };
  for (const r of recs) {
    if (!r || !RAIL_MAT.test(r.mat)) continue;
    if (r.kw === 'box') {
      const [x0, y0, , x1, y1] = r.box;
      if (x1 - x0 < y1 - y0) centers.x.push((x0 + x1) / 2);   // 沿 y 的钢轨 ⇒ 横向 = x
      else centers.y.push((y0 + y1) / 2);                     // 沿 x 的钢轨 ⇒ 横向 = y
    } else {
      const pts = r.kw === 'quad' ? r.pts3 : r.pts.map((p) => [p[0], p[1]]);
      const [t0, t1] = transRange(kind, pts);
      (kind === 'diag' ? centers.s : centers.y).push((t0 + t1) / 2);
    }
  }
  const cluster = (arr) => {
    const a = [...arr].sort((p, q) => p - q), out = [];
    for (const v of a) {
      const last = out[out.length - 1];
      if (last && Math.abs(v - last.sum / last.n) < 0.006) { last.sum += v; last.n++; }
      else out.push({ sum: v, n: 1 });
    }
    return out.map((c) => c.sum / c.n);
  };
  const cl = { x: cluster(centers.x), y: cluster(centers.y), s: cluster(centers.s) };
  // 各横向轴的方向位移 = 两条轨中心的均值 − 0.5（枕木的相位就按这个偏移走）
  const shift = {};
  for (const [k, arr] of Object.entries(cl)) {
    if (arr.length >= 2) shift[k] = (Math.min(...arr) + Math.max(...arr)) / 2 - 0.5;
  }
  const nearest = (arr, v) =>
    (arr.length ? arr.reduce((b, c) => (Math.abs(c - v) < Math.abs(b - v) ? c : b), arr[0]) : null);
  return { cl, shift, nearest };
}

// ---------------------------------------------------------------- 逐面变换
function xfBallast(kind, pts3, over) {
  // ⚠ 坡道的道床是**跟着坡面走的**（z ≈ 0.2041·(1−x) + 抖动）⇒ 只能对"抖动那一部分"
  //   做抬厚/粗化，把整条坡的 z 一起乘 1.28 会让道床整体跳起来（9 px）。
  const base = (x) => (kind === 'slope' ? RISE * (1 - x) : 0);
  return pts3.map(([x, y, z]) => {
    let nx = x, ny = y;
    if (kind === 'diag') {
      [nx, ny] = balS(x, y);
      if (over) {
        const d = OVER / Math.SQRT2;
        if (near0(y)) { nx += d; ny -= d; }
        if (near0(x)) { nx -= d; ny += d; }
        if (near1(y)) { nx -= d; ny += d; }
        if (near1(x)) { nx += d; ny -= d; }
      }
    } else if (kind === 'cross') {
      if (Math.abs(x - 0.5) <= EDGE) nx = 0.5 + K_BAL * (x - 0.5);
      if (Math.abs(y - 0.5) <= EDGE) ny = balY(y);
      if (over) { nx += ext(x); ny += ext(y); }
    } else {
      ny = balY(y);
      if (over) nx += ext(x);
    }
    return [nx, ny, base(x) + balZ(z - base(x))];
  });
}

/** 钢轨（box / prism / poly / quad）。rise = 坡道才有的随 x 抬升 */
function xfRail(kind, rec, ctx, over, rise) {
  const { cl, nearest } = ctx;

  if (rec.kw === 'box') {
    const b = [...rec.box];
    const thinX = (b[3] - b[0]) < (b[4] - b[1]);
    const arr = thinX ? cl.x : cl.y;
    const i0 = thinX ? 0 : 1, i1 = thinX ? 3 : 4;
    const c = nearest(arr, (b[i0] + b[i1]) / 2);
    if (c !== null) {
      const half = (b[i1] - b[i0]) * K_RAIL_W / 2;
      b[i0] = c - half; b[i1] = c + half;
    }
    if (over) {
      if (b[0] <= TOL) b[0] = -OVER;
      if (b[3] >= 1 - TOL) b[3] = 1 + OVER;
      if (b[1] <= TOL) b[1] = -OVER;
      if (b[4] >= 1 - TOL) b[4] = 1 + OVER;
    }
    b[2] -= RAIL_DROP;                       // 轨底往下（轨顶 b[5] 不动）
    return [emitBox(b, rec.mat, rec.mods)];
  }

  const is3 = rec.kw === 'quad';
  const src = is3 ? rec.pts3 : rec.pts.map((p) => [p[0], p[1], 0]);
  const [t0, t1] = transRange(kind, src);
  const c = nearest(kind === 'diag' ? cl.s : cl.y, (t0 + t1) / 2);
  const bot = (x) => 0.0100 + rise * (1 - x);

  const out = src.map(([x, y, z]) => {
    let nx = x, ny = y;
    if (c !== null) {
      if (kind === 'diag') {
        const s = x + y, s2 = c + K_RAIL_W * (s - c), d = (s2 - s) / 2;
        nx += d; ny += d;
      } else {
        ny = c + K_RAIL_W * (y - c);
      }
    }
    if (over) {
      if (kind === 'diag') {
        const d = OVER / Math.SQRT2;
        if (near0(y)) { nx += d; ny -= d; }
        if (near0(x)) { nx -= d; ny += d; }
        if (near1(y)) { nx -= d; ny += d; }
        if (near1(x)) { nx += d; ny -= d; }
      } else if (rec.kw !== 'box') {
        nx += railExt(x);
      }
    }
    const z2 = is3 && Math.abs(z - bot(x)) < 1e-6 ? z - RAIL_DROP : z;
    return [nx, ny, z2];
  });

  if (rec.kw === 'poly') {
    const z = Math.abs(rec.z - bot(src[0][0])) < 1e-6 ? rec.z - RAIL_DROP : rec.z;
    return [emitPoly(z, out, rec.mat)];
  }
  if (rec.kw === 'prism') return [emitPrism(rec.z0, rec.z1, out, rec.mat)];
  return [emitQuad(out, rec.mat, rec.mods)];
}

/** box 枕木：就地加长/加厚 → 底板 + 分带条（G2 的两层构造） */
function boxSleeper(rec, ctx) {
  const b = [...rec.box];
  const thinX = (b[3] - b[0]) < (b[4] - b[1]);
  const axis = thinX ? 'y' : 'x';                       // 横向轴
  const sh = ctx.shift[axis] ?? 0;
  const c = 0.5 + sh;
  if (axis === 'y') { b[1] = c + K_SLEEP_L * (b[1] - c); b[4] = c + K_SLEEP_L * (b[4] - c); }
  else { b[0] = c + K_SLEEP_L * (b[0] - c); b[3] = c + K_SLEEP_L * (b[3] - c); }
  if (thinX) { const m = (b[0] + b[3]) / 2, h = (b[3] - b[0]) * K_SLEEP_T / 2; b[0] = m - h; b[3] = m + h; }
  else { const m = (b[1] + b[4]) / 2, h = (b[4] - b[1]) * K_SLEEP_T / 2; b[1] = m - h; b[4] = m + h; }

  const lo = axis === 'y' ? b[1] : b[0];
  const hi = axis === 'y' ? b[4] : b[3];
  const cuts = CUT.map((v) => v + sh);
  const out = [emitBox([b[0], b[1], 0, b[3], b[4], Z_BASE], M_BODY, ['top=' + M_BASE])];
  for (const [p, q] of splitByCuts(lo, hi, cuts)) {
    const z = zoneOf((p + q) / 2 - sh);
    const bb = [...b];
    if (axis === 'y') { bb[1] = p; bb[4] = q; } else { bb[0] = p; bb[3] = q; }
    out.push(emitBox([bb[0], bb[1], Z_BASE, bb[3], bb[4], z.z], z.mat, ['top=' + z.top]));
  }
  return out;
}

/** prism 枕木（斜向）：在 (s,t) = (x+y, x−y) 里加长/加厚 → 底板 + 分带条 */
function prismSleeper(rec, ctx, over) {
  const d = OVER / Math.SQRT2;
  const shifts = rec.pts.map(([x, y]) => {
    if (!over) return 0;
    let dx = 0, dy = 0;
    if (near0(y)) { dx += d; dy -= d; }
    if (near0(x)) { dx -= d; dy += d; }
    if (near1(y)) { dx -= d; dy += d; }
    if (near1(x)) { dx += d; dy -= d; }
    return dx - dy;                                    // 只影响 t（沿轨），横向 s 不变
  });
  const st = rec.pts.map(([x, y]) => [x + y, x - y]);
  const t0 = Math.min(...st.map((p) => p[1])), t1 = Math.max(...st.map((p) => p[1]));
  const tc = (t0 + t1) / 2;
  const c = 0.5 + (ctx.shift.s ?? 0);
  const P = st.map(([s, t], i) => [c + K_SLEEP_L * (s - c), tc + K_SLEEP_T * (t - tc) + shifts[i]]);
  const back = ([s, t]) => [(s + t) / 2, (s - t) / 2];
  const cuts = CUT.map((v) => v + (ctx.shift.s ?? 0));
  const out = [emitPrism(0, Z_BASE, P.map(back), M_BODY)];
  const s0 = Math.min(...P.map((u) => u[0])), s1 = Math.max(...P.map((u) => u[0]));
  for (const [p, q] of splitByCuts(s0, s1, cuts)) {
    const poly = clipS(P, p, q);
    if (poly.length < 3) continue;
    const z = zoneOf((p + q) / 2 - (ctx.shift.s ?? 0));
    out.push(emitPrism(Z_BASE, z.z, poly.map(back), z.mat));
  }
  return out;
}

/** quad 枕木组（一段的 5 个面共享同一个 (x,y) 包围盒 ⇒ 按盒分组） */
function quadSleeperGroup(kind, group) {
  const [x0, x1] = bboxX(group[0].pts3);
  const [y0, y1] = bboxY(group[0].pts3);

  if (kind === 'tunnel') {
    // 平放 ⇒ 用顶面轮廓改吐成 box（实心体，能挖槽）；同组的 5 个原面全部丢掉
    const top = group.find((r) => nzSign(r.pts3) > 0);
    if (!top) return group.map((r) => emitQuad(r.pts3, M_BODY, r.mods));
    const m = (x0 + x1) / 2, h = (x1 - x0) * K_SLEEP_T / 2;
    const bx0 = m - h, bx1 = m + h;
    const by0 = 0.5 + K_SLEEP_L * (y0 - 0.5), by1 = 0.5 + K_SLEEP_L * (y1 - 0.5);
    const out = [emitBox([bx0, by0, 0, bx1, by1, Z_BASE], M_BODY, ['top=' + M_BASE])];
    for (const [p, q] of splitByCuts(by0, by1, CUT)) {
      const z = zoneOf((p + q) / 2);
      out.push(emitBox([bx0, p, Z_BASE, bx1, q, z.z], z.mat, ['top=' + z.top]));
    }
    return out;
  }

  // 坡道：形状一格不动（顶面随 x 倾斜，动了与钢轨对不上），只把顶面切成条 + 换材质
  const out = [];
  for (const r of group) {
    if (nzSign(r.pts3) <= 0) { out.push(emitQuad(r.pts3, M_BODY, r.mods)); continue; }
    const pts = r.pts3.map(([x, y, z]) => [x, 0.5 + K_SLEEP_L * (y - 0.5), z]);
    const ys = pts.map((p) => p[1]);
    for (const [p, q] of splitByCuts(Math.min(...ys), Math.max(...ys), CUT)) {
      const z = zoneOf((p + q) / 2);
      const strip = pts.map(([x, y, zz]) => [x, Math.min(Math.max(y, p), q), zz]);  // y 夹到条内
      out.push(emitQuad(strip, z.pad ? M_PAD : z.top, r.mods));
    }
  }
  return out;
}

// ---------------------------------------------------------------- 隧道：加固环框
function ringLines(which) {
  const inner = ARCH_R * PORTAL_S;             // 放大后的拱洞半宽（0.1748）
  const a0 = 0.5 - inner, a1 = 0.5 + inner;
  const o0 = a0 - RING_W, o1 = a1 + RING_W;
  if (which === 'a') return [emitBox([RING_X0, o0, 0, RING_X1, a0, RING_Z0], M_BODY)];
  if (which === 'b') return [emitBox([RING_X0, a1, 0, RING_X1, o1, RING_Z0], M_BODY)];
  if (which === 'lintel') return [
    emitBox([RING_X0, o0, RING_Z0, RING_X1, a0, RING_TOP], M_BODY),
    emitBox([RING_X0, a1, RING_Z0, RING_X1, o1, RING_TOP], M_BODY),
    emitBox([RING_X0, a0, ARCH_CROWN, RING_X1, a1, RING_TOP], M_BODY),
  ];
  return [];
}

// ---------------------------------------------------------------- 主流程
function processJob(job) {
  const src = fs.readFileSync(path.join(ROOT, 'models', `${job.src}.model`), 'utf8').split('\n');
  const head = [];
  const geo = [];
  for (const raw of src) {
    if (!/^\S/.test(raw)) continue;
    const kw = raw.trim().split(/\s+/)[0];
    if (kw === 'name' || kw === 'group' || kw === 'footprint' || kw === 'zmax') { head.push([kw, raw.trimEnd()]); continue; }
    geo.push({ raw, rec: parseLine(raw) });
  }
  const recs = geo.map((g) => g.rec);
  const ctx = analyse(job.kind, recs);
  const rise = job.kind === 'slope' ? RISE : 0;

  // quad 枕木分组（按 (x0,x1,y0,y1) 包围盒）
  const groupKey = (r) => {
    const [x0, x1] = bboxX(r.pts3), [y0, y1] = bboxY(r.pts3);
    return `${x0.toFixed(3)}|${x1.toFixed(3)}|${y0.toFixed(3)}|${y1.toFixed(3)}`;
  };
  const groups = new Map();
  for (const r of recs) {
    if (!r || r.kw !== 'quad' || !WOOD_MAT.test(r.mat)) continue;
    const k = groupKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }

  const body = [];
  const emitted = new Set();
  const stats = { lines: 0, out: 0, bal: 0, sleep: 0, rail: 0, portal: 0, other: 0 };
  for (const { raw, rec } of geo) {
    stats.lines++;
    if (!rec) { body.push(raw.trimEnd()); stats.other++; continue; }
    const mat = rec.mat;

    if (rec.kw === 'quad' && WOOD_MAT.test(mat)) {
      const k = groupKey(rec);
      if (!emitted.has(k)) {
        emitted.add(k);
        const lines = quadSleeperGroup(job.kind, groups.get(k));
        lines.forEach((l) => body.push(l));
        stats.sleep += groups.get(k).length; stats.out += lines.length;
      }
      continue;
    }
    if (rec.kw === 'box' && WOOD_MAT.test(mat)) {
      boxSleeper(rec, ctx).forEach((l) => body.push(l));
      stats.sleep++; stats.out += 1 + splitByCuts(0, 1, []).length;
      continue;
    }
    if (rec.kw === 'prism' && WOOD_MAT.test(mat)) {
      const lines = prismSleeper(rec, ctx, job.over);
      lines.forEach((l) => body.push(l));
      stats.sleep++; stats.out += lines.length;
      continue;
    }
    // 道床：quad（并集板）与 prism（坡脚散粒）都要跟着加宽/抬厚。
    // `stone_dark` 只在「prism 且 z ≤ 0.006」时并进来 —— 那是坡脚散粒；
    // 平交道口的 stone_dark 是三块 box 铺板（道面），一格不能动。
    const toe = mat === 'stone_dark' && rec.kw === 'prism' && rec.z1 <= 0.006;
    if (mat === 'gravel' || toe) {
      if (rec.kw === 'quad') {
        body.push(emitQuad(xfBallast(job.kind, rec.pts3, job.over), mat, rec.mods));
      } else {
        const flat = rec.pts.map(([x, y]) => [x, y, 0]);
        const xy = xfBallast(job.kind, flat, job.over).map((p) => [p[0], p[1]]);
        // 散粒抬到新道床面之上一点，免得被抬厚的道床埋掉（0.0022 ≈ 抬厚量 + 半个粒径）
        if (rec.kw === 'prism') body.push(emitPrism(balZ(rec.z0) + 0.0022, balZ(rec.z1) + 0.0022, xy, mat));
        else body.push(emitPoly(rec.z + 0.0022, xy, mat));
      }
      stats.bal++; stats.out++;
      continue;
    }
    if (RAIL_MAT.test(mat)) {
      xfRail(job.kind, rec, ctx, job.over, rise).forEach((l) => body.push(l));
      stats.rail++; stats.out++;
      continue;
    }
    if (job.kind === 'tunnel') {
      const pts = (rec.kw === 'quad' ? rec.pts3 : rec.pts.map((p) => [p[0], p[1], 0]))
        .map(([x, y, z]) => [x, portalY(y), z]);
      body.push(rec.kw === 'quad' ? emitQuad(pts, mat, rec.mods) : emitPoly(rec.z, pts, mat));
      stats.portal++; stats.out++;
      continue;
    }
    body.push(raw.trimEnd());
    stats.other++; stats.out++;
  }
  if (job.ring) ringLines(job.ring).forEach((l) => body.push(l));

  // ★ 洞口配色替换（整份 body 发完之后再做，见 RECOLOR_TUN2 的注释）
  let out = body;
  let nRecolor = 0;
  if (job.recolor === 'tun2') {
    for (const [re, to] of RECOLOR_TUN2) {
      out = out.map((l) => { const r = l.replace(re, to); if (r !== l) nRecolor++; return r; });
    }
  }

  const hdr = [
    '# =============================================================================',
    `# ${job.dst} —— A5 组（\`SBEN\` / \`SBEA\` 重载）· ${job.note}`,
    '#',
    '# 【本文件由 tools/gen-a5-heavy.mjs 生成，请勿手改】',
    `#   源 = models/${job.src}.model；kind=${job.kind}、沿轨探出 OVER=${OVER} 格${job.over ? '' : '（本件**不探出**）'}`,
    '#   口径与"为什么这么改"见 tools/gen-a5-heavy.mjs 的文件头。',
    job.recolor === 'tun2'
      ? '#   洞口配色 = **TUN-2 素混凝土深灰**（料石 stone* → concrete_dark / panel_seam / metal_seam，'
        + `${nRecolor} 处）—— 与 tools/gen-g1-tunnel.mjs 里 TUN-2 那一套逐条一致。`
      : '#   （洞口材质原样）',
    `#   自检：入 ${stats.lines} 行 → 出 ${stats.out} 行；道床 ${stats.bal} 面、枕木 ${stats.sleep} 件、钢轨 ${stats.rail} 面、洞门 ${stats.portal} 面、原样 ${stats.other} 行`,
    '# =============================================================================',
    '',
  ].join('\n');

  let seenName = false;
  const outHead = head.map(([kw, line]) => {
    if (kw === 'name') { seenName = true; return `name      ${job.dst}`; }
    return line;
  });
  if (!seenName) outHead.unshift(`name      ${job.dst}`);

  const file = path.join(ROOT, 'models', `${job.dst}.model`);
  fs.writeFileSync(file, hdr + outHead.join('\n') + '\n' + out.join('\n') + '\n', 'utf8');
  return { file, stats: { ...stats, recolor: nRecolor } };
}

export function generate() {
  const files = [];
  for (const job of JOBS) {
    const srcFile = path.join(ROOT, 'models', `${job.src}.model`);
    if (!fs.existsSync(srcFile)) { log(`  × 跳过 ${job.dst}：源 ${job.src}.model 不存在`); continue; }
    const { file, stats } = processJob(job);
    files.push(file);
    log(`  → ${rel(file).padEnd(38)} 入 ${String(stats.lines).padStart(4)} → 出 ${String(stats.out).padStart(4)} 行`
      + `   道床 ${String(stats.bal).padStart(3)} · 枕木 ${String(stats.sleep).padStart(3)} · 钢轨 ${String(stats.rail).padStart(2)} · 洞门 ${String(stats.portal).padStart(3)}`
      + (stats.recolor ? ` · 洞口配色 ${String(stats.recolor).padStart(3)} 处` : ''));
  }
  return files;
}

if (isMain(import.meta.url)) {
  const t0 = Date.now();
  log(`生成 A5 组（SBEN / SBEA 重载）模型：道床 ×${K_BAL.toFixed(4)}、枕木 U 形槽、钢轨 ×${K_RAIL_W.toFixed(3)}、洞口 ×${PORTAL_S.toFixed(4)}`);
  const files = generate();
  log(`✔ 生成 ${files.length} 个模型，用时 ${((Date.now() - t0) / 1000).toFixed(2)} s`);
  log('  下一步：make sprite → 抄模板 → make check');
}
