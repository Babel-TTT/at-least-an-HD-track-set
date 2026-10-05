// =============================================================================
// tools/gen-a3-quasi.mjs —— 生成 A3 组（`SCDN` + `SCDA`，准高速）的模型
//
//   node tools/gen-a3-quasi.mjs
//
// 人工 2026-10-05 批准新建（铁律 L3 的申请），只写 `models/G3_*.model`。
//
// -----------------------------------------------------------------------------
// 【口径：§6 确认门（人工 2026-10-05「四条全按推荐执行」）】
//
//   覆盖轨道 `SCDN`（准高速铁路 · 1967 · 160km/h · 非电）
//            `SCDA`（电气化准高速 25kV AC · 1991 · 160km/h）
//   A3 组 = 道床 `BAL-A` + 轨枕 `SLE-2` + 钢轨 `RAI-1` + 洞口 `TUN-3`
//
//   ① `BAL-A` 有砟·标准碎石 —— **与 `BAL-C` 同宽 0.36 格**（§1.1 的「肩宽 0.09 格」
//      正好 = 0.18 枕木 + 两侧各 0.09 ⇒ 总宽 0.36，也就是 G1/G2 现在这个宽度）。
//      ⇒ 与 `BAL-C` 的差别只能在别处，本工具做两件：
//        · **边缘拉直**：外缘那一行本来是逐列 ±0.012 格（±1.5 px）的毛边
//          （`BAL-C` 的"边缘不齐"），现在按"外缘顶点的均值"拉成一条直线。
//          判据不写死坐标：从**本模型自己的道砟高度场**算出外缘的均值与离散度。
//        · **粒径规整/粗化**：高度场台阶 0.0005 → **0.0011 格**（相邻格并成同一平面）。
//      颜色仍 `gravel`(156,149,138)（§1.1 的"灰褐碎石"就是它），坡脚散粒保留。
//      ⚠ 说清楚：`BAL-A` 与 `BAL-C` **同宽同色** ⇒ `SCDN` 与已装机的 `SBDA`
//        在开阔线路上只有枕木/洞口不同。这是 §1.1 的规格本身决定的。
//   ② `SLE-2` 混凝土枕 Ⅱ型 —— **完全照已装机的 G2**（§1.2 的 U 形承轨槽）：
//      底板顶 0.0075 / 槽底垫板顶 0.0087 / 中间体顶 0.0095 / 挡肩顶 0.0100，
//      槽 4 条分带线 0.4300 / 0.4660 / 0.5340 / 0.5700；枕木顶**仍是 0.0100**
//      ⇒ 钢轨高度与 G1 完全一致（人工 G2 那轮定过「铁轨的高度要和之前的枕木一致」）。
//      材质 = G2 的原配：挡肩 `concrete`(186,182,173) 亮 / 槽底垫板 `trim_dark`(62,66,71) 深 /
//      中间体顶 `concrete_seam` 中 —— §1.2 的"灰白色"就是 `concrete`。
//      ★ 本轮比 G2 多做的：G2 当年**只对直线轨真挖了槽**（半轨/交叉/坡道是"叠薄板只换色"），
//        本工具用 A5 那套统一机件，把三种表示（`box` / `prism` / `quad`）**都真挖**。
//   ③ `RAI-1` 60kg/m **一字不动**（宽 0.0080、轨顶 z 0.0230、轨底 0.0100）。
//      本工具对钢轨只做一件事：**沿轨探出 1/32 格**（盖瓦片接缝；G1/G2 至今没探出）。
//      ⚠ 判据用 TOL = 0.001 而不是 0.0005 —— 源里钢轨被 `clipBox` 钳在 0.0005/0.9995，
//        用"正好贴边"判会探不出去（A15 那次踩过，见文件头那条注释的出处）。
//   ④ `TUN-3` 现代混凝土端墙拱 —— 从 **TUN-2** 派生：
//      · **配色统一提亮**：`concrete_dark`(144,140,132) 与 `panel_seam`(96,96,96) 两种面
//        全部改成 `concrete`(186,182,173)。理由 = `docs/踩坑.md` B9：洞门所有**有面积**的面
//        统一一种料，正/侧/顶的明暗交给**逐法线光照**，不要用两种材质去硬分朝向。
//        拱腹内壁仍 `metal_seam`（洞里的暗部，刻意压暗）。
//      · **顶部截水沟**：压顶（x 0.144 × y 0.716 × 厚 0.014 那块板）沿 **x** 切成
//        「棱—沟—棱」三块，沟宽 0.030、深 0.008 格 ⇒ 屏幕上洞顶横过一道
//        ≈ **4 px 宽**的深色凹槽（槽底 `panel_seam`）。5 个面 → 13 个面。
//        沿 x 刻（不是沿 y）的理由：压顶长边沿 y，沟要顺长边通到两端排水；
//        且 x 是**墙厚**那一维，沟开在墙厚中间才是"天沟"而不是把洞顶劈成两半。
//
// -----------------------------------------------------------------------------
// 【为什么是「从既有模型派生」而不是重画一套】
//
//   与 A15 / A5 同理：G1/G2 的几何是实机调了十几轮的结果（道砟并集 + 毛边抖动、
//   枕木相位、交叉/道岔的逐方向屏幕偏移、隧道口拱线 128 段…）。重画只会更差。
//   本工具**逐行读源模型、逐行写 G3**，产物仍是完全写死的字面量
//   （符合 flatiso「模型是资产不是程序」的要求）。
//
//   源表（每个作业一行 `src → dst`，源的名字写在产物文件头里）：
//     轨道 10 件 ← G1 族（`probe_track_x` / `G1_rail_*` / `probe_half_upper` /
//                       `G1_track_slope` / `G1_crossing` / `G1_junction3|4` / `G1_levelcrossing`）
//     洞口  4 件 ← `G2_tunnel2_stone(_b)`（**已经带着 SLE-2 的 U 形混凝土枕**，
//                  见 tools/gen-g1-tunnel.mjs 的 `sleepersG2()`）
//                 ＋ `G1_tunnel2_stone_over(_b)`（压顶/仰面在这一层，截水沟刻在这里）
//
// -----------------------------------------------------------------------------
// 【横向是哪一维 —— 逐 kind 不同（与 A15 / A5 同一套口径）】
//
//   kind 'y'      整格直线 / 平交道口：横向 = y（轨道沿 x）
//   kind 'diag'   斜向半格轨（切 N 角）：横向 = **x + y**（轨道线 x + y = 0.5）
//   kind 'slope'  坡道：横向 = y，但**沿轨不探出**（延了会顶格位/穿地）
//   kind 'cross'  交叉 / 三向 / 四向：道砟板**铺满整格**，边缘就是瓦片边
//                 ⇒ **不做边缘拉直**（没有毛边可拉），只做沿轨探出。
//
// -----------------------------------------------------------------------------
// 【枕木：三种表示，三套做法（与 A5 同一套机件，只是常数换成 SLE-2）】
//
//   直线 / 交叉 / 道口：枕木是 **box**（轴对齐长方体，每根 3 段）
//     斜向：**prism**（45° 平行四边形，横向坐标 x + y）
//     坡道：**quad**（每段 5 个面，顶面随 x 倾斜）
//
//   ① box / prism ⇒ 直接吐「底板 + 分带条」两层的实体（G2 的构造，逐字照搬）
//   ② 坡道（quad 且**随 x 倾斜**）⇒ prism/box 都做不了斜的槽 ⇒ **只切顶面、只换颜色**
//      （槽深只有 0.0013 格 = 0.2 px，4x 下本来就看不见；形状不能动，动了与钢轨对不上）
//
//   ⚠ 枕木的「相位」是烘进坐标的（交叉的 X/Y 两个方向各有自己的屏幕位移），
//     所以本工具**不重排枕木**，只把每一根就地挖槽 ⇒ 方向偏移天然保留。
//     承轨槽的 4 条分带线一律**跟着该方向的位移走**：`cuts = CUT + shift`，
//     各方向的 shift 由**钢轨自己的位置**反推（shift = mean(该方向两条轨的中心) − 0.5）。
//
// -----------------------------------------------------------------------------
// 【探出边界（盖接缝）】
//
//   碰到瓦片边、且**沿轨全长**的顶点向外挪 OVER（1/32 格）：道床 / 钢轨探，枕木不探。
//   ⚠ 钢轨单独用放宽到 TOL(=0.001 > 0.0005) 的判据 —— 源里钢轨被 `clipBox` 钳过。
//   ⚠ 坡道不探出（同 A12/A15/A5 口径）。
//   ⚠ 洞口那 4 件**不做**（隧道地面层的接缝由邻格的直向件探过来盖）。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { ROOT, log, rel, isMain } from './util.mjs';

// ---------------------------------------------------------------- 口径常量
const BAL_ZS = 0.0011;              // 道床高度场台阶（源 0.0005 ⇒ 粒径规整/粗化）
const K_SLEEP_L = 1.00;             // 枕木横向长（SLE-2 = 源木枕同长 0.18 格 = 2.50 m）
const K_SLEEP_T = 1.00;             // 枕木沿轨厚（0.016 格 = 22 cm）
const K_RAIL_W = 1.00;              // 钢轨宽度（RAI-1 = 源，一字不动）
const RAIL_DROP = 0.0000;           // 轨底不下移（轨顶 0.0230 不许动）
const RISE = 0.2041;                // 一层地形 = 一个坡道格的高差（源模型里的实测值）

const Z_BASE = 0.0075, Z_PAD = 0.0087, Z_MID = 0.0095, Z_TOP = 0.0100;
const CUT = [0.4300, 0.4660, 0.5340, 0.5700];   // 承轨槽 4 条分带线（未加位移的名义值）

const M_BODY = 'concrete';          // 枕身（186,182,173 = §1.2 的"灰白色"）
const M_BASE = 'concrete_seam';     // 底板顶（看不见，被分带条盖住）
const M_SH = 'concrete';            // 挡肩顶（最亮）
const M_MID_S = 'concrete';         // 中间体侧面
const M_MID_T = 'concrete_seam';    // 中间体顶（微凹的暗示）
const M_PAD = 'trim_dark';          // 承轨槽底垫板（最深）

const OVER = 0.03125;               // 沿轨探出 1/32 格
const EDGE = 0.195;                 // 交叉/道岔「这一维属于哪条带」的阈值
const TOL = 0.001;                  // 「到头」容差（必须 > clipBox 的 0.0005）

// ---- TUN-3：压顶的 z 区间 + 截水沟 -----------------------------------------
//   （数值取自 tools/gen-g1-tunnel.mjs 的 SLAB_TOP / COPING_TOP；认不出就报错，
//     绝不静默放过 —— 见 ditchLines()）
const COPING_Z0 = 0.2720;
const COPING_Z1 = 0.2860;
const DITCH_W = 0.0300;             // 截水沟宽（沿 x，≈ 3.8 px 横向）
const DITCH_D = 0.0080;             // 截水沟深（≈ 1.25 px 竖向）
const M_PORTAL = 'concrete';        // TUN-3 洞门统一色
const M_DITCH = 'panel_seam';       // 截水沟槽底（压暗，让沟看得见）

const RAIL_MAT = /^(rust|metal)$/;
const WOOD_MAT = /^wood/;

/**
 * 作业表：源模型 → 产物模型。
 *   mode  'derive'  走几何机件（道床/枕木/钢轨逐面重写）
 *         'recolor' 纯材质替换（洞口那 4 件：几何已经是 TUN-2 + SLE-2，不该再动）
 *   remap 材质替换表（[正则, 替换]，按顺序）
 *   ditch 压顶刻截水沟（只在 tunnel_overlay: 那两件上有压顶）
 */
const JOBS = [
  // ---- 轨道：underlay（自带道砟 + 轨枕 + 钢轨）----
  { src: 'probe_track_x', dst: 'G3_track_x', mode: 'derive', kind: 'y', over: true,
    note: 'underlay 槽 0/1（RTO_X / RTO_Y）：BAL-A 标准碎石 + U 形混凝土枕 + 60kg/m 轨' },
  { src: 'G1_rail_straight', dst: 'G3_rail_straight', mode: 'derive', kind: 'y', over: true,
    note: 'overlay 槽 0/1：钢轨层（透明底）' },
  // ---- 斜向（切 N 角）----
  { src: 'probe_half_upper', dst: 'G3_track_half', mode: 'derive', kind: 'diag', over: true,
    note: 'underlay 槽 2-5（RTO_N / S / E / W）：切 N 角的半格轨' },
  { src: 'G1_rail_halftrack', dst: 'G3_rail_half', mode: 'derive', kind: 'diag', over: true,
    note: 'overlay 槽 2-5：半格轨的钢轨层' },
  // ---- 坡道（**不探出**；枕木只切顶面换颜色）----
  { src: 'G1_track_slope', dst: 'G3_track_slope', mode: 'derive', kind: 'slope', over: false,
    note: 'underlay 槽 6-9：坡道（z 已含 RISE，不动形状）' },
  { src: 'G1_rail_slope', dst: 'G3_rail_slope', mode: 'derive', kind: 'slope', over: false,
    note: 'overlay 槽 6-9：坡道的钢轨层' },
  // ---- 交叉 / 道岔 ----
  { src: 'G1_crossing', dst: 'G3_crossing', mode: 'derive', kind: 'cross', over: true,
    note: 'underlay 槽 10（RTO_CROSSING_XY）：交叉，自带两组钢轨' },
  { src: 'G1_junction3', dst: 'G3_junction3', mode: 'derive', kind: 'cross', over: true,
    note: 'underlay 槽 11-14：三向道岔（只有道床）' },
  { src: 'G1_junction4', dst: 'G3_junction4', mode: 'derive', kind: 'cross', over: true,
    note: 'underlay 槽 15：四向道岔（只有道床）' },
  // ---- 平交道口 ----
  { src: 'G1_levelcrossing', dst: 'G3_levelcrossing', mode: 'derive', kind: 'y', over: true,
    note: 'level_crossings 的轨道图（v0 → X 槽、v3 → Y 槽）' },
  // ---- 洞口 TUN-3：现代混凝土端墙拱（TUN-2 的几何 + 配色提亮 + 顶部截水沟）----
  { src: 'G2_tunnel2_stone', dst: 'G3_tunnel3', mode: 'recolor',
    remap: [[/\bconcrete_dark\b/g, 'concrete'], [/\bpanel_seam\b/g, 'concrete']],
    note: 'tunnels: 组（A 组：远半 y<0.5）—— 洞内轨道（SLE-2）+ 洞门远半' },
  { src: 'G2_tunnel2_stone_b', dst: 'G3_tunnel3_b', mode: 'recolor',
    remap: [[/\bconcrete_dark\b/g, 'concrete'], [/\bpanel_seam\b/g, 'concrete']],
    note: 'tunnels: 组（B 组：近半 y>0.5）—— 洞内轨道（SLE-2）+ 洞门近半' },
  { src: 'G1_tunnel2_stone_over', dst: 'G3_tunnel3_over', mode: 'recolor', ditch: true,
    remap: [[/\bconcrete_dark\b/g, 'concrete'], [/\bpanel_seam\b/g, 'concrete']],
    note: 'tunnel_overlay: 组（A 组）—— 洞顶 + 压顶（**截水沟刻在这里**）+ 仰面' },
  { src: 'G1_tunnel2_stone_over_b', dst: 'G3_tunnel3_over_b', mode: 'recolor', ditch: true,
    remap: [[/\bconcrete_dark\b/g, 'concrete'], [/\bpanel_seam\b/g, 'concrete']],
    note: 'tunnel_overlay: 组（B 组）—— 洞顶 + 压顶（**截水沟刻在这里**）+ 仰面' },
];

// ---------------------------------------------------------------- 小工具
const N = (v) => {
  const s = v.toFixed(4);
  return s === '-0.0000' ? '0.0000' : s;
};
const near0 = (v) => v <= 1e-4;
const near1 = (v) => v >= 1 - 1e-4;
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
/** 道床高度场台阶（粒径规整/粗化；共享顶点仍是同一个函数值 ⇒ 不会裂） */
const balZ = (z) => Math.round(z / BAL_ZS) * BAL_ZS;

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

/**
 * 发射一个 quad，**绕序自动纠正到指定的朝向**。
 *
 *   ⚠ flatiso 的 `quad` 不传法线时，法线按顶点绕序用 Newell 法算
 *     （core/mesh.mjs 的 `newell()`），管线是**背面剔除**的 ⇒ 新建的面必须自己保证绕序。
 *     公式与 `newell()` 逐字一致（这里不归一化，只判点积符号）。
 */
function q4(pts, want, mat) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const d = nx * want[0] + ny * want[1] + nz * want[2];
  return emitQuad(d >= 0 ? pts : [...pts].reverse(), mat);
}

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
  if (t < CUT[0]) return { z: Z_TOP, mat: M_SH, top: M_SH, prism: M_SH, pad: false };
  if (t < CUT[1]) return { z: Z_PAD, mat: M_PAD, top: M_PAD, prism: M_PAD, pad: true };
  if (t < CUT[2]) return { z: Z_MID, mat: M_MID_S, top: M_MID_T, prism: M_MID_T, pad: false };
  if (t < CUT[3]) return { z: Z_PAD, mat: M_PAD, top: M_PAD, prism: M_PAD, pad: true };
  return { z: Z_TOP, mat: M_SH, top: M_SH, prism: M_SH, pad: false };
}
/** [lo,hi] 按分带线（已含位移）切成若干段 */
function splitByCuts(lo, hi, cuts) {
  const inner = cuts.filter((c) => c > lo + 1e-6 && c < hi - 1e-6);
  const bounds = [lo, ...inner, hi];
  const out = [];
  for (let i = 0; i + 1 < bounds.length; i++) out.push([bounds[i], bounds[i + 1]]);
  return out;
}

// ---------------------------------------------------------------- 道床外缘拉直
/** 横向坐标：diag 用 s = x + y，其余用 y */
const transOf = (kind, x, y) => (kind === 'diag' ? x + y : y);

/**
 * 从**本模型自己的道砟高度场**算出「外缘」的两条线和它们各自的离散度。
 *
 *   不写死 0.32 / 0.68 的理由：直向是 0.32/0.68、斜向是 0.35/0.65、道口是 0.3125/0.6875
 *   —— 每族的名义值不同，写死就会把某一族拉错。
 *   做法：取横向极小/极大各 0.030 窗内的顶点，**它们的均值就是名义外缘**，
 *   离散度 ×1.6（再夹到 [0.008, 0.025]）就是判定半径。
 */
function ballastEdges(kind, recs) {
  if (kind === 'cross') return null;      // 道砟板铺满整格，边缘就是瓦片边，没有毛边
  const ts = [];
  for (const r of recs) {
    if (!r || r.kw !== 'quad' || r.mat !== 'gravel') continue;
    for (const p of r.pts3) ts.push(transOf(kind, p[0], p[1]));
  }
  if (ts.length < 8) return null;
  const tmin = Math.min(...ts), tmax = Math.max(...ts);
  const loSet = ts.filter((t) => t < tmin + 0.030);
  const hiSet = ts.filter((t) => t > tmax - 0.030);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const dev = (a, m) => Math.max(...a.map((t) => Math.abs(t - m)));
  const lo = mean(loSet), hi = mean(hiSet);
  const rad = Math.max(0.008, Math.min(0.025, 1.6 * Math.max(dev(loSet, lo), dev(hiSet, hi))));
  return { lo, hi, rad, spreadLo: dev(loSet, lo), spreadHi: dev(hiSet, hi) };
}
const snapT = (t, e) => {
  if (!e) return t;
  if (Math.abs(t - e.lo) <= e.rad) return e.lo;
  if (Math.abs(t - e.hi) <= e.rad) return e.hi;
  return t;
};

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
  // 各横向轴的方向位移 = 两条轨中心的均值 − 0.5（枕木的相位与承轨槽都按这个偏移走）
  const shift = {};
  for (const [k, arr] of Object.entries(cl)) {
    if (arr.length >= 2) shift[k] = (Math.min(...arr) + Math.max(...arr)) / 2 - 0.5;
  }
  const nearest = (arr, v) =>
    (arr.length ? arr.reduce((b, c) => (Math.abs(c - v) < Math.abs(b - v) ? c : b), arr[0]) : null);
  return { cl, shift, nearest };
}

// ---------------------------------------------------------------- 逐面变换
function xfBallast(kind, pts3, over, edges, doSnap) {
  // ⚠ 坡道的道床是**跟着坡面走的**（z ≈ 0.2041·(1−x) + 抖动）⇒ 只对"抖动那一部分"做粗化，
  //   把整条坡的 z 一起动会让道床整体跳起来（A5 那次踩过）。
  const base = (x) => (kind === 'slope' ? RISE * (1 - x) : 0);
  return pts3.map(([x, y, z]) => {
    let nx = x, ny = y;
    if (kind === 'diag') {
      if (doSnap) {
        const s = x + y, s2 = snapT(s, edges), d = (s2 - s) / 2;
        nx += d; ny += d;
      }
      if (over) {
        const d = OVER / Math.SQRT2;
        if (near0(y)) { nx += d; ny -= d; }
        if (near0(x)) { nx -= d; ny += d; }
        if (near1(y)) { nx -= d; ny += d; }
        if (near1(x)) { nx += d; ny -= d; }
      }
    } else if (kind === 'cross') {
      if (over) { nx += ext(x); ny += ext(y); }
    } else {
      if (doSnap) ny = snapT(y, edges);
      if (over) nx += ext(x);
    }
    return [nx, ny, base(x) + balZ(z - base(x))];
  });
}

/** 钢轨（box / prism / poly / quad）。K_RAIL_W = 1 时**一个数都不改**，只探出边界 */
function xfRail(kind, rec, ctx, over, rise) {
  const { cl, nearest } = ctx;

  if (rec.kw === 'box') {
    const b = [...rec.box];
    if (K_RAIL_W !== 1) {
      const thinX = (b[3] - b[0]) < (b[4] - b[1]);
      const arr = thinX ? cl.x : cl.y;
      const i0 = thinX ? 0 : 1, i1 = thinX ? 3 : 4;
      const c = nearest(arr, (b[i0] + b[i1]) / 2);
      if (c !== null) {
        const half = (b[i1] - b[i0]) * K_RAIL_W / 2;
        b[i0] = c - half; b[i1] = c + half;
      }
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
  const c = K_RAIL_W === 1 ? null : nearest(kind === 'diag' ? cl.s : cl.y, (t0 + t1) / 2);
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

/** box 枕木：底板 + 分带条（G2 的两层构造）；承轨槽跟着本方向的位移走 */
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

/** prism 枕木（斜向）：在 (s,t) = (x+y, x−y) 里挖槽 → 底板 + 分带条 */
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
    out.push(emitPrism(Z_BASE, z.z, poly.map(back), z.prism));
  }
  return out;
}

/** quad 枕木组（坡道：一段的 5 个面共享同一个 (x,y) 包围盒 ⇒ 按盒分组） */
function quadSleeperGroup(group) {
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

// ---------------------------------------------------------------- TUN-3：顶部截水沟
/**
 * 把压顶那 5 个面（顶 1 + 4 侧）换成「棱—沟—棱」的 13 个面。
 *
 *   认压顶的办法：**所有 z 都落在 {COPING_Z0, COPING_Z1} 里的 quad**。
 *   那是 `tools/gen-g1-tunnel.mjs` 的 `box(COPING_*, SLAB_TOP, COPING_TOP, …)` 那一块，
 *   恰好 5 个面；数量不对就抛错（宁可炸，也不要静默刻错地方）。
 */
function ditchSplice(lines) {
  const hit = [];
  for (let i = 0; i < lines.length; i++) {
    const r = parseLine(lines[i]);
    if (!r || r.kw !== 'quad') continue;
    const zs = r.pts3.map((p) => p[2]);
    const ok = zs.every((z) => Math.abs(z - COPING_Z0) < 1e-6 || Math.abs(z - COPING_Z1) < 1e-6)
      && zs.some((z) => Math.abs(z - COPING_Z1) < 1e-6);   // ⚠ 必须碰到顶面，
    //   否则会把**石梁的梁顶**（那一块全是 COPING_Z0=0.2720，压在压顶下面）也认成压顶
    if (ok) hit.push({ i, r });
  }
  if (hit.length !== 5) {
    throw new Error(`TUN-3 认压顶失败：z ∈ {${COPING_Z0}, ${COPING_Z1}} 且碰到顶面的 quad 应有 5 个，实得 ${hit.length}`
      + '\n   → 去 gen-g1-tunnel.mjs 核对 SLAB_TOP / COPING_TOP，或改本文件的 COPING_Z0 / COPING_Z1');
  }
  let X0 = Infinity, X1 = -Infinity, Y0 = Infinity, Y1 = -Infinity;
  for (const { r } of hit) {
    X0 = Math.min(X0, ...r.pts3.map((p) => p[0])); X1 = Math.max(X1, ...r.pts3.map((p) => p[0]));
    Y0 = Math.min(Y0, ...r.pts3.map((p) => p[1])); Y1 = Math.max(Y1, ...r.pts3.map((p) => p[1]));
  }
  const Z0 = COPING_Z0, Z1 = COPING_Z1;
  const cx = (X0 + X1) / 2;
  const c0 = cx - DITCH_W / 2, c1 = cx + DITCH_W / 2;
  const ZD = Z1 - DITCH_D;
  const P = (x, y, z) => [x, y, z];
  const out = [
    // 两条棱的顶面
    q4([P(X0, Y0, Z1), P(c0, Y0, Z1), P(c0, Y1, Z1), P(X0, Y1, Z1)], [0, 0, 1], M_PORTAL),
    q4([P(c1, Y0, Z1), P(X1, Y0, Z1), P(X1, Y1, Z1), P(c1, Y1, Z1)], [0, 0, 1], M_PORTAL),
    // 沟底
    q4([P(c0, Y0, ZD), P(c1, Y0, ZD), P(c1, Y1, ZD), P(c0, Y1, ZD)], [0, 0, 1], M_DITCH),
    // 沟的两个内壁（朝沟里）
    q4([P(c0, Y0, ZD), P(c0, Y0, Z1), P(c0, Y1, Z1), P(c0, Y1, ZD)], [1, 0, 0], M_PORTAL),
    q4([P(c1, Y0, ZD), P(c1, Y1, ZD), P(c1, Y1, Z1), P(c1, Y0, Z1)], [-1, 0, 0], M_PORTAL),
    // 压顶的两个外端面（x = X1 / X0）
    q4([P(X1, Y0, Z0), P(X1, Y0, Z1), P(X1, Y1, Z1), P(X1, Y1, Z0)], [1, 0, 0], M_PORTAL),
    q4([P(X0, Y0, Z0), P(X0, Y1, Z0), P(X0, Y1, Z1), P(X0, Y0, Z1)], [-1, 0, 0], M_PORTAL),
    // 两侧面（各三段：棱 A / 沟 / 棱 B）—— 沟两端要**通**，不能封死
    q4([P(X0, Y0, Z0), P(X0, Y0, Z1), P(c0, Y0, Z1), P(c0, Y0, Z0)], [0, -1, 0], M_PORTAL),
    q4([P(c0, Y0, Z0), P(c0, Y0, ZD), P(c1, Y0, ZD), P(c1, Y0, Z0)], [0, -1, 0], M_PORTAL),
    q4([P(c1, Y0, Z0), P(c1, Y0, Z1), P(X1, Y0, Z1), P(X1, Y0, Z0)], [0, -1, 0], M_PORTAL),
    q4([P(X0, Y1, Z0), P(c0, Y1, Z0), P(c0, Y1, Z1), P(X0, Y1, Z1)], [0, 1, 0], M_PORTAL),
    q4([P(c0, Y1, Z0), P(c1, Y1, Z0), P(c1, Y1, ZD), P(c0, Y1, ZD)], [0, 1, 0], M_PORTAL),
    q4([P(c1, Y1, Z0), P(X1, Y1, Z0), P(X1, Y1, Z1), P(c1, Y1, Z1)], [0, 1, 0], M_PORTAL),
  ];
  const at = hit[0].i;
  const del = new Set(hit.map((h) => h.i));
  const res = lines.filter((_, i) => !del.has(i));
  // 插回第一个被删的位置（用原来的行号当锚；删掉的行都在它之后或它本身）
  const anchorIdx = Math.min(at, res.length);
  res.splice(anchorIdx, 0, ...out);
  return { lines: res, box: [X0, X1, Y0, Y1, Z0, Z1], nOut: out.length };
}

// ---------------------------------------------------------------- 主流程
function readModel(name) {
  const file = path.join(ROOT, 'models', `${name}.model`);
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, 'utf8').split('\n');
  const head = [];
  const geo = [];
  for (const raw of src) {
    if (!/^\S/.test(raw)) continue;
    const kw = raw.trim().split(/\s+/)[0];
    if (kw === 'name' || kw === 'group' || kw === 'footprint' || kw === 'zmax') { head.push([kw, raw.trimEnd()]); continue; }
    geo.push({ raw, rec: parseLine(raw) });
  }
  return { head, geo };
}

function processDerive(job) {
  const m = readModel(job.src);
  if (!m) return null;
  const recs = m.geo.map((g) => g.rec);
  const ctx = analyse(job.kind, recs);
  const edges = ballastEdges(job.kind, recs);
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
  const stats = { lines: 0, out: 0, bal: 0, sleep: 0, rail: 0, other: 0 };
  for (const { raw, rec } of m.geo) {
    stats.lines++;
    if (!rec) { body.push(raw.trimEnd()); stats.other++; continue; }
    const mat = rec.mat;

    if (rec.kw === 'quad' && WOOD_MAT.test(mat)) {
      const k = groupKey(rec);
      if (!emitted.has(k)) {
        emitted.add(k);
        const lines = quadSleeperGroup(groups.get(k));
        lines.forEach((l) => body.push(l));
        stats.sleep += groups.get(k).length; stats.out += lines.length;
      }
      continue;
    }
    if (rec.kw === 'box' && WOOD_MAT.test(mat)) {
      const lines = boxSleeper(rec, ctx);
      lines.forEach((l) => body.push(l));
      stats.sleep++; stats.out += lines.length;
      continue;
    }
    if (rec.kw === 'prism' && WOOD_MAT.test(mat)) {
      const lines = prismSleeper(rec, ctx, job.over);
      lines.forEach((l) => body.push(l));
      stats.sleep++; stats.out += lines.length;
      continue;
    }
    // 道床：quad（并集板）与 prism（坡脚散粒）都要跟着拉直/粗化。
    // `stone_dark` 只在「prism 且 z ≤ 0.006」时并进来 —— 那是坡脚散粒；
    // 平交道口的 stone_dark 是三块 box 铺板（道面），一格不能动。
    const toe = mat === 'stone_dark' && rec.kw === 'prism' && rec.z1 <= 0.006;
    if (mat === 'gravel' || toe) {
      if (rec.kw === 'quad') {
        body.push(emitQuad(xfBallast(job.kind, rec.pts3, job.over, edges, true), mat, rec.mods));
      } else {
        // 散粒：**不拉直**（把坡脚的散石全吸到外缘线上就成了一条假边），也不动它的 z
        const flat = rec.pts.map(([x, y]) => [x, y, 0]);
        const xy = xfBallast(job.kind, flat, job.over, edges, false).map((p) => [p[0], p[1]]);
        if (rec.kw === 'prism') body.push(emitPrism(rec.z0, rec.z1, xy, mat));
        else body.push(emitPoly(rec.z, xy, mat));
      }
      stats.bal++; stats.out++;
      continue;
    }
    if (RAIL_MAT.test(mat)) {
      xfRail(job.kind, rec, ctx, job.over, rise).forEach((l) => body.push(l));
      stats.rail++; stats.out++;
      continue;
    }
    body.push(raw.trimEnd());
    stats.other++; stats.out++;
  }
  return { head: m.head, body, stats, extra: { edges, shift: ctx.shift } };
}

function processRecolor(job) {
  const m = readModel(job.src);
  if (!m) return null;
  const body = m.geo.map((g) => g.raw.trimEnd());
  let lines = body;
  let nRemap = 0;
  for (const [re, to] of job.remap ?? []) {
    lines = lines.map((l) => {
      const r = l.replace(re, to);
      if (r !== l) nRemap++;
      return r;
    });
  }
  let ditch = null;
  if (job.ditch) {
    const r = ditchSplice(lines);
    lines = r.lines; ditch = r;
  }
  return { head: m.head, body: lines, stats: { lines: body.length, out: lines.length, remap: nRemap, ditch }, extra: {} };
}

function writeModel(job, res) {
  let seenName = false;
  const outHead = res.head.map(([kw, line]) => {
    if (kw === 'name') { seenName = true; return `name      ${job.dst}`; }
    return line;
  });
  if (!seenName) outHead.unshift(`name      ${job.dst}`);

  const s = res.stats;
  const hdr = [
    '# =============================================================================',
    `# ${job.dst} —— A3 组（\`SCDN\` / \`SCDA\` 准高速）· ${job.note}`,
    '#',
    '# 【本文件由 tools/gen-a3-quasi.mjs 生成，请勿手改】',
    `#   源 = models/${job.src}.model；模式 ${job.mode}`,
    job.mode === 'derive'
      ? `#   道床 BAL-A（同宽 0.36、外缘拉直、高度场台阶 ${BAL_ZS}）· 枕木 SLE-2（U 形承轨槽，`
        + `z ${Z_BASE}/${Z_PAD}/${Z_MID}/${Z_TOP}）· 钢轨 RAI-1（**一字未改**，只沿轨探出 ${OVER} 格）`
      : `#   洞门 TUN-3：材质提亮统一（concrete_dark / panel_seam → concrete）`
        + `${job.ditch ? ` + 压顶刻截水沟（宽 ${DITCH_W} / 深 ${DITCH_D}）` : ''}`,
    '#   口径与"为什么这么改"见 tools/gen-a3-quasi.mjs 的文件头。',
    job.mode === 'derive'
      ? `#   自检：入 ${s.lines} 行 → 出 ${s.out} 行；道床 ${s.bal} 面、枕木 ${s.sleep} 件、钢轨 ${s.rail} 面、原样 ${s.other} 行`
        + (res.extra.edges
          ? `\n#   道床外缘：lo=${N(res.extra.edges.lo)}（原离散 ±${N(res.extra.edges.spreadLo)}）`
            + ` / hi=${N(res.extra.edges.hi)}（±${N(res.extra.edges.spreadHi)}）`
            + ` / 判定半径 ${N(res.extra.edges.rad)}`
          : '')
      : `#   自检：入 ${s.lines} 行 → 出 ${s.out} 行；材质替换 ${s.remap} 处`
        + (s.ditch ? `；截水沟：压顶 5 面 → ${s.ditch.nOut} 面，bbox x[${N(s.ditch.box[0])},${N(s.ditch.box[1])}] y[${N(s.ditch.box[2])},${N(s.ditch.box[3])}]` : ''),
    '# =============================================================================',
    '',
  ].join('\n');

  const file = path.join(ROOT, 'models', `${job.dst}.model`);
  fs.writeFileSync(file, hdr + outHead.join('\n') + '\n' + res.body.join('\n') + '\n', 'utf8');
  return file;
}

export function generate() {
  const files = [];
  for (const job of JOBS) {
    const res = job.mode === 'derive' ? processDerive(job) : processRecolor(job);
    if (!res) { log(`  × 跳过 ${job.dst}：源 ${job.src}.model 不存在`); continue; }
    const file = writeModel(job, res);
    files.push(file);
    if (job.mode === 'derive') {
      log(`  → ${rel(file).padEnd(34)} 入 ${String(res.stats.lines).padStart(4)} → 出 ${String(res.stats.out).padStart(4)} 行`
        + `   道床 ${String(res.stats.bal).padStart(3)} · 枕木 ${String(res.stats.sleep).padStart(3)} · 钢轨 ${String(res.stats.rail).padStart(2)}`
        + `   外缘 ${res.extra.edges ? `${N(res.extra.edges.lo)}/${N(res.extra.edges.hi)} ±${N(res.extra.edges.spreadLo)}` : '—'}`);
    } else {
      log(`  → ${rel(file).padEnd(34)} 入 ${String(res.stats.lines).padStart(4)} → 出 ${String(res.stats.out).padStart(4)} 行`
        + `   材质替换 ${res.stats.remap} 处${res.stats.ditch ? ` · 截水沟 5→${res.stats.ditch.nOut} 面` : ''}`);
    }
  }
  return files;
}

if (isMain(import.meta.url)) {
  const t0 = Date.now();
  log('生成 A3 组（SCDN / SCDA 准高速）模型：'
    + `BAL-A 外缘拉直 + 台阶 ${BAL_ZS}、SLE-2 U 形槽、RAI-1 不动（只探出 ${OVER}）、TUN-3 提亮 + 截水沟`);
  const files = generate();
  log(`✔ 生成 ${files.length} 个模型，用时 ${((Date.now() - t0) / 1000).toFixed(2)} s`);
  log('  下一步：make sprite → 抄模板 → make check');
}
