// =============================================================================
// tools/gen-a9-hsballast.mjs —— A25 组（`SECA`，高速铁路 250km/h 25kV AC）模型生成器
//
// 人工 2026-10-06 批准新建（铁律 L3 的申请），**只写 `models/G10_*.model`**。
//
// 口径（A9/A25 确认门，人工裁定「全部按推荐执行」）：
//   道床 **`BAL-N` 有砟·高速（砟肩堆高）** —— 断面规格见下面那一节
//   轨枕 `SLE-3` 混凝土宽枕（U 形承轨槽）· 钢轨 `RAI-3` 60kg/m 长轨
//   洞口 **复用 A10 已落地的 `TUN-4`**（`G8_tunnel4*`，`gfx/tunnel4.png`）
//   电气化 `EL-25` + `PYL-S1` H 型钢（无标牌，`probe_catenary_pylons_steel`）
//   C8：`SECA` 250 km/h · 费用 24/12 · 2003 · 地图色 0x66 · 局部 id 22
//       `SORT_ELECTRIC` · `CATENARY` · **不设平交道口**
//       （`RAILTYPE_FLAG_NO_LEVEL_CROSSING`，与同为高铁的 `SGCA` 一致）
//
// ⚠ 本文件是 `tools/gen-a8-crts1.mjs`（A8 组）的**同源副本**：轨枕段（`SLE-3`）与
//   钢轨段（`RAI-3`）**逐字保留**（`SLE-3` 是 A5 / A8 / 本组共用的同一批模型口径，
//   枕木相位烘在坐标里）；换掉的只有"道床那一层" —— A8 是**删道砟、发射 `BAL-E` 板**，
//   本组是**删道砟、按 `BAL-N` 断面重新发射高度场**。
//
// -----------------------------------------------------------------------------
// 【为什么从 `G1_*` 派生，而不是从 `G6_*`（A5 重载）或 `G9_*`（A8 无砟）反推】
// -----------------------------------------------------------------------------
// A15 / A5 / A3 / A10 / A8 一路验证过的做法：从**结构最接近**的既有 `.model` 读文本、
// 按规则改写。本组的两个"半个身子"分别来自两个源：
//
//   * **轨枕 ← `G1_*` 的原文 + `tools/gen-a5-heavy.mjs` 的枕木那一段（逐字照抄）**
//     `SLE-3`（宽 0.19 格 / 厚 0.0215 / U 形承轨槽：挡肩顶 0.0100 `metal_pale`、
//     槽底 0.0087 `panel_seam`、中间 0.0095）是 **A5 组做出来的**，本组与它**共用同一批
//     模型口径**。枕木的"相位"是**烘进坐标**的 —— 每个朝向的枕位、交叉的 X/Y 两个方向
//     各自的屏幕位移，都写在源模型的字面量里。⇒ **必须以 `G1_*` 为源、原地加长/加厚/挖槽**，
//     不能"照 A5 的样子重画一遍"（重画等于把 G2 那轮的 U 形槽坑再趟一遍）。
//     `tools/gen-a5-heavy.mjs` 里 `boxSleeper()` / `prismSleeper()` / `quadSleeperGroup()`
//     三个函数与 `analyse()`（反推各方向的横向位移）**逐字搬过来**，改口径时两边一起改。
//
//   * **钢轨 `RAI-3` = `RAI-1` 的几何一字不动**（半宽 0.0040 / 轨底 0.0100 / 轨顶 0.0230），
//     只换材质：侧面 `rust` → `metal_dark`、顶面 `metal` → `metal_pale`
//     （`美术要素方案.md` §1.1 的 `BAL-G` 表第三行，A10 已经这么做过一遍）。
//     ⚠ **所以本组对钢轨只做两件事**：① 换材质；② 沿轨探出 `OVER` 盖接缝。
//       **宽度和轨底一个数都不动** —— 这与 A5（`RAI-2`：加宽 ×1.30、轨底 −0.0015）不同，
//       别把 A5 的 `K_RAIL_W` / `RAIL_DROP` 顺手抄进来。
//       （轨顶 0.0230 是全包硬约束：动了车会浮起来 / 沉下去。）
//
//   * **洞口不重做**：`TUN-4` 是 A10（`SGCA`）那轮从 `G3_tunnel3*` 派生出来的
//     （端墙加宽到 0.80 格、洞跨 0.40 格、拱顶 0.215、洞口正面一圈挑出的帽檐），
//     `G8_tunnel4*` 已经能直接用 ⇒ 本生成器**一件洞口模型都不出**，
//     NML 那边 `tunnels:` / `tunnel_overlay:` 直接指 `probe_tunnels_4` /
//     `probe_tunnel_over_4`（与 `SGCA` 共用同一套精灵）。
//
// -----------------------------------------------------------------------------
// 【`BAL-N`（有砟·高速 / 砟肩堆高）—— 数字规格与四条判据】
// -----------------------------------------------------------------------------
//   `美术要素方案.md` §1.1：`BAL-N` = 有砟·高速道床，现实对应 **石太 / 合武 /
//   甬台温 客运专线**（250 km/h **有砟**方案）。规范口径（见 §1.1 那一节的引文）：
//
//     道床顶面宽 3.6 m · 砟肩宽 0.5 m · **砟肩堆高 0.15 m** · 边坡 **1:1.75**
//     道床厚 0.35 m · **特级碎石道砟（上道前清洗）** · 轨枕 2.6 m / 每 km 1667 根
//     道床顶面「低于轨枕承轨面不应小于 40 mm，且不应高于轨枕中部顶面」
//
//   换算：`SLE-3` 长 0.19 格 ↔ 现实 2.6 m ⇒ **1 m = 0.07308 格**：
//     砟肩宽 0.5 m ⇒ `SHOULDER = 0.0365`，堆高 0.15 m ⇒ `RIDGE_H = 0.0110`
//
//   ① **道床顶面 `Z_CRIB = 0.0078`** —— 与 A5（`BAL-B`）/ A8（`BAL-E`）**同一个数**。
//      `SLE-3` 的枕身是 `z 0 → 0.0100`（`0.0075` 以下是看不见的底板）⇒ 取 0.0078 让
//      **同一批宽枕在 A5 / A8 / 本组三处的露出高度完全一致**。现实依据也正好对上：
//      承轨面（= 枕顶 0.0100）往下 40 mm = 0.0029 格 ⇒ 道床顶面 ≈ 0.0071~0.0078 ✓。
//      ⚠ 不能取 0.0075（与枕身底板顶面共面 ⇒ 深度相等、闪烁）；不能取 0.0100 及以上
//        （把宽枕整个埋掉，A5/A8 那批模型的口径就废了）。
//
//   ② **砟肩堆高 `RIDGE_H = 0.0110`** ⇒ 砟肩顶 `Z_CREST = 0.0188`（高出枕顶 0.0088）。
//      断面（半宽 d = |横向 − 0.5|，从外到内）：
//        d = `TOE_D 0.1644` → 0          （坡脚，1:1.75 的坡从这儿起算）
//        d = `CREST_D 0.1315` → `Z_CREST`（砟肩外沿 = 半枕长 + 砟肩宽）
//        d = `HALF_SLP 0.0950` → `Z_CRIB` （枕端：砟肩从枕端起坡，堆到外沿）
//        d = 0 → `Z_CRIB`                 （道心）
//      ⚠ **这是本包第一件"不是贴地薄饰面"的道床** —— `BAL-A/B/C` 全场高只有 0.0078
//        （1.2 px），本档到砟肩顶 0.0188（坡面 2.9 px）。不做堆高的话，新道床在 4x 下
//        就只是"又一个碎石条"，与 `BAL-A` 分不开 ⇒ **堆高是这一档唯一的身份**。
//      ⚠ 砟肩顶仍**低于轨顶 0.0230**（差 0.0042）：钢轨从两道埂之间露出来，而且埂在屏幕
//        上位于钢轨**前方 6 px、外侧 11 px**（`screen_x = (y−x)·128`），不会挡轨。
//
//   ③ **横向不需要"重映射"**：源道砟带在**直向 0.384 / 斜向 0.309 / 交叉 0.312** 宽，
//      三处本来就不等（那是 A5 那轮"以图像看上去一致为准"留下的口径）。本组是**按断面
//      重新铺高度场**，不是搬源顶点 ⇒ 三种朝向都直接铺到 `d = ±TOE_D`，可见带宽一律
//      **0.3288 格**（斜向是在带坐标 `s = x+y` 里铺，屏幕上是 128 px/格 × 0.3288 = 42 px；
//      直向是 143 px/格 × 0.3288 = 47 px ⇒ 斜向看起来略窄，与源口径同向）。
//      ⚠ 斜向每一行的沿轨范围由"裁到瓦片"反推：`a ∈ [0.5−s, s+0.5]`（两端正好落在瓦片
//        边上），再各外伸一个 `OVER` ⇒ 与 A8 的 `clipTile(…, OVER)` 同一个结论。
//
//   ④ **高度场抖动用"量化 1 周期坐标的哈希"**，不用随机数：相邻两格的边界那一列必须给出
//      **完全相同**的几何（否则精灵接缝会在道砟上留一条亮线 + 深度闪烁）。
//      `qf()` 取小数部分再量化到 1/32（局部坐标差一个整数 —— 正好一格 —— 时给出同一个值）
//      ⇒ 同一个世界位置在两格里哈希到同一个值 ✓（源模型用的是 1/32 周期的列抖动，同理）。
//      抖动量：高度上限 `JZ = 0.0015`（只往上抖 ⇒ 永远 `z ≥ 断面值 ≥ 0`，不会穿地；
//      也保证道心最高 0.0093 < 枕顶 0.0100）；坡脚那一行再叠 `JT = 0.0050` 的**横向**抖动，
//      做成锯齿毛边（源模型那句"道床边缘为微微折线"的同一招）。
//
//   ⑤ **岔口三张（交叉 / 三向 / 四向）走"素面平板"**：断面收进多边形里没法自洽
//      （三个方向的埂会互相织在一起、凹角处会冒竖直断面），所以照 **A8 / A10 / A13 的先例**
//      铺一块 `z 0 → Z_CRIB` 的平板，形状**逐字照抄 A8** 的 `slabCrossing/Junction3/4`
//      （只把带宽从 0.32~0.68 改成 `BAND`、材质换成道砟）。代价要如实记：直线段的砟肩
//      埂到岔口就断了（§1.1 有登记）。
//
//   ⑥ **平交道口不做**：`SECA` 是高铁、`NO_LEVEL_CROSSING`（人工裁定）⇒ 本组不出
//      `G10_levelcrossing`，NML 那边也不给 `level_crossings:`。
//
// -----------------------------------------------------------------------------
// 【探出边界（盖接缝）】—— 与 A5 / A12 / A8 同一套
// -----------------------------------------------------------------------------
//   轨道是唯一必须首尾严格对上的细线；精灵在瓦片边界上切齐 ⇒ 不探出就会留一条 1 px
//   的暗线。`OVER = 1/32` 格（4 px 横向 / 2 px 纵向 @4x）是实机调出来的量，
//   必须 < flatiso 的 `OVERFLOW_ALLOW`（1/16 格）才不刷"超出占地"警告。
//   ⚠ 钢轨 / 枕木仍按 A5 的口径用 `railExt` 探出；**道床高度场**也探出：
//     直向把首末两列推到 `−OVER / 1+OVER`（同时保持 32 列的 1 周期抖动 ⇒ 交界处
//     两格给出逐字相同的几何），斜向把每一行的**沿轨两端**各外伸 `OVER`（世界坐标）。
//   ⚠ **坡道不探出**（`over: false`）：高端探出去会顶格位、低端探出去 `z < 0` 直接穿地。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { ROOT, log, rel, isMain } from './util.mjs';

// ---------------------------------------------------------------- 口径常量
// `BAL-N` 断面（现实依据与六条判据见文件头那一节；1 m = 0.07308 格）
const r4 = (v) => Number(v.toFixed(4));
// ★ 砟肩宽的**家族口径倍率**：确认门里说好"断面宽度先出两版让你挑"——
//   `KW = 1.00` ⇒ **N-1 真实比例**（砟肩 0.5 m，可见带宽 0.3288 格）
//   `KW = 1.56` ⇒ **N-2 拉齐本包家族**（砟肩等效 0.78 m，可见带宽 0.3686 格）
//   挑定之后**只改这一个数**即可（`SHOULDER` 与 `TOE_D` / `BAND` 全部跟着走）。
const KW = 1.0000;
const Z_CRIB = 0.0078;               // 道床顶面（枕间）= A5 `BAL-B` / A8 `BAL-E` 的同一个数
const RIDGE_H = 0.0110;              // 砟肩堆高 0.15 m
const Z_CREST = 0.0188;              // 砟肩顶 = Z_CRIB + RIDGE_H（低于轨顶 0.0230）
const SLOPE_R = 1.75;                // 道床边坡 1:1.75（水平 = 竖直 × 1.75）
const HALF_SLP = 0.0950;             // `SLE-3` 半长（0.19 格 = 2.64 m）——**不随 KW 走**
const SLOPE_RUN = r4(Z_CREST * SLOPE_R);          // 边坡的水平投影 0.0329
const SHOULDER = r4(0.0365 * KW);                 // 砟肩宽（规范 0.5 m）
const CREST_D = r4(HALF_SLP + SHOULDER);          // 砟肩外沿
const TOE_D = r4(CREST_D + SLOPE_RUN);            // 坡脚
const BAND = [r4(0.5 - TOE_D), r4(0.5 + TOE_D)];  // 道床可见带宽 = 2 × TOE_D
const SEG_SLOPE = 3;                 // 边坡那条线上再取几个采样点（抖动才看得出来）
const NROW = 32;                     // 直向沿轨列数（1 周期 ⇒ 交界处两格几何逐字相同）
const MCOL = 16;                     // 斜向沿轨列数
const JZ = 0.0015;                   // 高度场抖动上限（只往上抖 ⇒ 不会穿地）
const JT = 0.0050;                   // 坡脚横向抖动幅度（毛边；必须 < 坡脚那两行的间距）

const RISE = 0.2041;                  // 一格坡道抬高（与 gen-g1-slope / A5 / A8 同源）
const OVER = 0.03125;                 // 沿轨探出 1/32 格（见文件头）
const TOL = 0.001;                    // 钢轨"到头"容差（必须 > clipBox 的 0.0005）

// ---------------------------------------------------------------- 交叉：Y 向轨道再挪一份
// ★ 人工 2026-10-06：「把 SCCA 和 SECA 的交叉轨道模型中的 y 方向轨道应用（2,-1）的偏移」
//   —— 人工先报了 (−2,+1)、随即更正为 **(2,−1)**，本文件按**更正后的数**落。
//   A8（SCCA）与 A25（SECA）两个生成器各改一处，口径**逐字相同**。
//   口径与 2026-10-05 给 G1 那次的 `CROSS_Y_EXTRA` 一致：**在现值上叠加**
//   （见 docs/建模标准.md 2026-10-05 那条、docs/建模经验.md §4.10）。
//   屏幕 (2,−1) px ⇒ 世界**纯 −x 1/64 格**（= 0.015625 格）；Y 轨沿 y 跑 ⇒ 对它是
//   **横移 1.79px ＋ 沿轨 1.34px**（屏幕"右上"方向）⇒ 钢轨与枕木**整组平移**，
//   X 向与道床一个数不动。
//   ⚠ 本组从 `G1_crossing` 派生，源里**已经**含 G1 那份 (−2,+1)
//     （Y 组钢轨 x 0.4796 / 0.5828，与 G1_crossing.model 逐字节相同）
//     ⇒ 这一份是在它之上**反向叠一次**，净结果 = **只剩 `DIR_DELTA.Y` 那一份**
//     （Y 组钢轨 x 落回 0.4640 / 0.5672），即本组**不吃** G1 的 `CROSS_Y_EXTRA`。
//   实测量（按 flatiso 打包口径反算，对照图 out/rimg/g9g10_cross_yextra_ab.png）：
//     Y 轨相对相邻直线轨的横向偏差 **1.34px → 0.44px**（改善）；X 向 0.89px 不变。
//   范围：**只有交叉那一件**；`levelcrossing` / `junction3` / `junction4` 一律不动
//     （与 G1 那次的范围逐条相同）。
const CY_PX = [2, -1];                                // 屏幕增量（px；正 = 右 / 下）
const CY_DX = (CY_PX[1] / 64 - CY_PX[0] / 128) / 2;   // ⇒ 世界 −x −0.015625 格
const CY_DY = (CY_PX[1] / 64 + CY_PX[0] / 128) / 2;   // ⇒ 世界 y 0
/** 只有交叉那一件吃这份增量（A8 的作业表用 `plate:`、A25 用 `bed:`） */
const isCrossing = (job) => job.bed === 'crossing' || job.plate === 'crossing';

// ---------------------------------------------------------------- 材质
const MAT = {
  bed: 'granite_grey',                // 特级道砟（146,144,140 中性偏冷；颗粒 0.040 < gravel 的 0.060）
  rail: 'metal_dark',                 // `RAI-3` 侧面（94,100,106 冷亮钢）
  railTop: 'metal_pale',              // `RAI-3` 顶面（190,195,199）
};

// ---------------------------------------------------------------- 轨枕（`SLE-3`）口径
//   ★ 这一整段（含 `CUT` / `Z_*` / `M_*`）**与 `tools/gen-a5-heavy.mjs` 逐字同源**。
//     改口径时两个文件要一起改 —— `SLE-3` 是两个组共用的同一批模型口径。
const K_SLEEP_L = 0.19 / 0.18;        // 枕木横向加长（源 0.18 → 0.19 格 = 2.64 m）
const K_SLEEP_T = 0.0215 / 0.016;     // 枕木沿轨加厚（源 0.016 → 0.0215 格 = 30 cm）
const Z_BASE = 0.0075, Z_PAD = 0.0087, Z_MID = 0.0095, Z_TOP = 0.0100;
const CUT = [0.4300, 0.4660, 0.5340, 0.5700];   // 承轨槽 4 条分带线（未加位移的名义值）
const M_BODY = 'concrete_mid';        // 枕身（冷灰 159,165,175）
const M_SH = 'metal_pale';            // 挡肩顶（冷白 190,195,199）
const M_MID = 'concrete_mid';         // 中间体顶
const M_PAD = 'panel_seam';           // 槽底（96,96,96）
const M_BASE = 'concrete_seam';       // 底板顶（看不见，被分带条盖住）

const RAIL_MAT = /^(rust|metal)$/;
const WOOD_MAT = /^wood/;

// ---------------------------------------------------------------- 作业表
/**
 *   kind    横向口径（决定枕木相位怎么反推，见 `analyse`）
 *              'y'      整格直线：横向 = y
 *              'diag'   斜向半格轨（切 N 角）：横向 = x + y
 *              'cross'  交叉 / 三向 / 四向：两个方向混在一个模型里 ⇒ 逐坐标判
 *              'slope'  坡道：横向 = y，但**沿轨不探出**
 *   bed     道床的发射口径（null = 本件没有道床，纯 overlay）
 *              'ridge'     直向 / 斜向 / 坡道：按 `BAL-N` 断面重新发射高度场
 *              'crossing'  十字平板（素面，形状照抄 A8）
 *              'junction3' 六边形平板（素面）
 *              'junction4' 八边形平板（素面）
 */
const JOBS = [
  { src: 'probe_track_x', dst: 'G10_track_x', kind: 'y', over: true, bed: 'ridge',
    note: 'underlay 槽 0/1（RTO_X / RTO_Y）：BAL-N 高速有砟（砟肩堆高）+ SLE-3 宽枕 + RAI-3 长轨' },
  { src: 'G1_rail_straight', dst: 'G10_rail_straight', kind: 'y', over: true, bed: null,
    note: 'overlay 槽 0/1：透明底，只有宽枕 + 长轨（道岔瓦片上引擎逐段叠它）' },

  { src: 'probe_half_upper', dst: 'G10_track_half', kind: 'diag', over: true, bed: 'ridge',
    note: 'underlay 槽 2-5（RTO_N / S / E / W）：切 N 角的半格轨' },
  { src: 'probe_half_upper', dst: 'G10_z_track_half_m', kind: 'diag', over: true, bed: 'ridge',
    note: 'underlay 槽 3/4（RTO_S / RTO_E）专用：半格轨的"镜像版"——'
      + '本组没有第三轨可翻，所以它与 `G10_track_half` **逐面相同**，存在的唯一理由是'
      + '**槽位对齐**（照 A10 `G8_z_track_half_m` / A8 `G9_z_track_half_m` 的先例）' },
  { src: 'G1_rail_halftrack', dst: 'G10_rail_half', kind: 'diag', over: true, bed: null,
    note: 'overlay 槽 2-5：半格轨的宽枕 + 钢轨层' },

  { src: 'G1_track_slope', dst: 'G10_track_slope', kind: 'slope', over: false, bed: 'ridge',
    note: 'underlay 槽 6-9（RTO_SLOPE_NE / SE / SW / NW）：坡道（**不探出**）' },
  { src: 'G1_rail_slope', dst: 'G10_rail_slope', kind: 'slope', over: false, bed: null,
    note: 'overlay 槽 6-9：坡道的宽枕 + 钢轨层' },

  { src: 'G1_crossing', dst: 'G10_crossing', kind: 'cross', over: true, bed: 'crossing',
    note: 'underlay 槽 10（RTO_CROSSING_XY）：交叉（十字素面道床 + 两个方向的宽枕 / 钢轨）' },
  { src: 'G1_junction3', dst: 'G10_junction3', kind: 'cross', over: true, bed: 'junction3',
    note: 'underlay 槽 11-14：三向道岔的六边形道床（**素面**，同 A8 / A10 / A12）' },
  { src: 'G1_junction4', dst: 'G10_junction4', kind: 'cross', over: true, bed: 'junction4',
    note: 'underlay 槽 15：四向道岔的八边形道床（**素面**，同 A8 / A10 / A12）' },

  // ⚠ **本组不出平交道口**（`SECA` 是高铁、`NO_LEVEL_CROSSING`，人工 2026-10-06 裁定）
  //   —— 所以没有 `G10_levelcrossing`，NML 那边也不给 `level_crossings:`。
  // ⚠ **本组的"镜像半格件"（`G10_z_track_half_m`）是 `G10_track_half` 的逐面副本**：
  //   本组是 25kV 架空接触网、**没有第三轨** ⇒ 道床 / 钢轨 / 宽枕全部关于 y = 0.5 对称
  //   （A10 / A8 的那两对文件实测差异 **0 行**）。留着它是为了**槽位对齐**。
];

// ---------------------------------------------------------------- 小工具
const N = (v) => {
  const s = Number(v).toFixed(6);
  return Number(s) === 0 ? 0 : Number(s);
};
const fmt = (v) => Number(v).toFixed(4);
const near0 = (v) => v <= 1e-4;
const near1 = (v) => v >= 1 - 1e-4;

/** 沿轨探出（直向 / 交叉用）：贴到 0 / 1 就往外挪 OVER */
function ext(v) {
  if (near0(v)) return -OVER;
  if (near1(v)) return OVER;
  return 0;
}

/** 钢轨专用（见 A5 文件头那条 0.0005 的教训：源里钢轨被 clipBox 钳在 0.0005） */
function railExt(v) {
  if (v <= TOL) return -OVER;
  if (v >= 1 - TOL) return OVER;
  return 0;
}

// =============================================================================
// 一、源模型解析（与 tools/gen-a5-heavy.mjs 同源）
// =============================================================================
function parseLine(raw) {
  const t = raw.trim().split(/\s+/);
  const kw = t[0];
  if (kw === 'quad') {
    const n = t.slice(1, 13).map(Number);
    if (n.length !== 12 || n.some((v) => !Number.isFinite(v))) return null;
    return { kw, mat: t[13], mods: t.slice(14),
      pts3: [[n[0], n[1], n[2]], [n[3], n[4], n[5]], [n[6], n[7], n[8]], [n[9], n[10], n[11]]] };
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
  `quad ${pts.map((p) => `${fmt(p[0])} ${fmt(p[1])} ${fmt(p[2])}`).join('  ')}   ${[mat, ...mods].join(' ')}`;
const emitPrism = (z0, z1, pts, mat) =>
  `prism ${fmt(z0)} ${fmt(z1)}  ${mat}  ${pts.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join('  ')}`;
const emitPoly = (z, pts, mat) =>
  `poly ${fmt(z)}  ${mat}  ${pts.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join('  ')}`;
const emitBoxRaw = (b, mat, mods = []) =>
  `box ${fmt(b[0])} ${fmt(b[1])} ${fmt(b[2])}  ${fmt(b[3])} ${fmt(b[4])} ${fmt(b[5])}  ${[mat, ...mods].join(' ')}`;

/** Newell 法向的 z 分量 —— 判「这是不是枕木顶面」 */
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

// ---------------------------------------------------------------- 反向分析
function transRange(kind, pts) {
  if (kind === 'diag') {
    const s = pts.map((p) => p[0] + p[1]);
    return [Math.min(...s), Math.max(...s)];
  }
  return bboxY(pts);
}

/** 从**源模型的钢轨**反推各横向轴的方向位移（枕木的相位就按这个偏移走） */
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
  const shift = {};
  for (const [k, arr] of Object.entries(cl)) {
    if (arr.length >= 2) shift[k] = (Math.min(...arr) + Math.max(...arr)) / 2 - 0.5;
  }
  return { cl, shift };
}

// =============================================================================
// 二、Risers —— 与 tools/gen-a12-metro.mjs 的三个发射器同源
// =============================================================================
/** 有向面积（> 0 = 逆时针，flatiso 的 prism 要这个序） */
function area2(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}
const ccw = (p) => (area2(p) < 0 ? p.slice().reverse() : p);

/** 斜向映射：局部 (x 沿轨, y 横向) → 世界 (x,y)，轨道线为 x+y = 0.5（切 N 角） */
const mapD = (x, y) => [N((y + (x - 0.5)) / 2), N((y - (x - 0.5)) / 2)];

/** 直向：轴对齐的 box（`long` 的件沿轨两端各探出 OVER） */
function emitBox(L, b) {
  const o = b.long ? OVER : 0;
  L.push(`box ${fmt(b.x0 - o)} ${fmt(b.y0)} ${fmt(b.z0)}  ${fmt(b.x1 + o)} ${fmt(b.y1)} ${fmt(b.z1)}   `
    + `${b.mat}${b.top ? ` top=${b.top}` : ''}`);
}

/** 发一块水平多边形柱（轴对齐用 box，多边形用 prism） */
function emitSlab(L, b) {
  if (b.poly) {
    const P = ccw(b.poly).map((p) => `${fmt(p[0])},${fmt(p[1])}`).join('  ');
    L.push(`prism ${fmt(b.z0)} ${fmt(b.z1)}  ${b.mat}  ${P}`);
  } else {
    emitBox(L, b);
  }
}

// =============================================================================
// 三、`BAL-N` 道床（本组唯一的新几何）
// =============================================================================
/** 断面结点（半宽 d ≥ 0 → 高度 z），d 从 0（道心）到 `TOE_D`（坡脚）；线性插值 */
const PROFILE = (() => {
  const k = [[0, Z_CRIB], [HALF_SLP, Z_CRIB], [CREST_D, Z_CREST]];
  for (let i = 1; i <= SEG_SLOPE; i++) {
    const d = Number((CREST_D + (TOE_D - CREST_D) * (i / SEG_SLOPE)).toFixed(4));
    k.push([d, Number((Z_CREST * (TOE_D - d) / (TOE_D - CREST_D)).toFixed(4))]);
  }
  return k;
})();

/** 断面结点列表：**横向坐标升序**（南半 → 道心 → 北半），供逐行铺高度场用 */
function bedRows() {
  const out = [];
  for (let i = PROFILE.length - 1; i >= 1; i--) out.push([N(0.5 - PROFILE[i][0]), PROFILE[i][1]]);
  out.push([0.5, Z_CRIB]);
  for (let i = 1; i < PROFILE.length; i++) out.push([N(0.5 + PROFILE[i][0]), PROFILE[i][1]]);
  return out;
}

/**
 * 1 周期伪随机：**按"量化后的 1 周期坐标"取哈希**，不用 `Math.random`
 * （见文件头 ④ —— 相邻两格在交界处必须给出逐字相同的几何，否则会留亮线 + 深度闪烁）。
 *   `qf()` 取小数部分 ⇒ 局部坐标差一个整数（正好一格）时给出同一个值 ✓
 *   `jz()` 只往上抖（0 ~ `JZ`）⇒ 永远 `z ≥ 断面值 ≥ 0`，不会穿地
 *   `toeOff()` 只给坡脚那一行用，做锯齿毛边（横向，可正可负）
 */
function hash2(a, b) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const qf = (v) => (Math.round((((v % 1) + 1) % 1) * NROW) % NROW);
const jz = (a, r) => Number((JZ * hash2(qf(a), r)).toFixed(4));
const toeOff = (a) => Number(((hash2(qf(a), 991) - 0.5) * JT).toFixed(4));

/** 直向 / 坡道：`NROW` 列 × 断面结点行的高度场（坡道整片随 x 抬起 `RISE·(1−x)`） */
function emitBedY(job, L, stats) {
  const rows = bedRows();
  const R = rows.length, lastR = R - 1;
  const slope = job.kind === 'slope';
  const X = [];
  for (let c = 0; c <= NROW; c++) X.push(c === 0 ? -OVER : c === NROW ? 1 + OVER : N(c / NROW));
  const Y = [], Z = [];
  for (let c = 0; c <= NROW; c++) {
    const yy = [], zz = [];
    for (let r = 0; r < R; r++) {
      const off = (r === 0 || r === lastR) ? toeOff(c) : 0;
      yy.push(N(rows[r][0] + off));
      const base = slope ? RISE * (1 - X[c]) : 0;
      zz.push(N(base + rows[r][1] + jz(c, r)));
    }
    Y.push(yy); Z.push(zz);
  }
  for (let c = 0; c < NROW; c++) {
    for (let r = 0; r < lastR; r++) {
      L.push(emitQuad([[X[c], Y[c][r], Z[c][r]], [X[c + 1], Y[c + 1][r], Z[c + 1][r]],
        [X[c + 1], Y[c + 1][r + 1], Z[c + 1][r + 1]], [X[c], Y[c][r + 1], Z[c][r + 1]]], MAT.bed));
      stats.bed++;
    }
  }
}

/**
 * 斜向半格：在**带坐标** (沿轨 a, 横向 s) 里铺同一套断面，再经 `mapD` 落进世界。
 * 每一行的沿轨范围由"裁到瓦片"反推：`a ∈ [0.5−s, s+0.5]`（两端正好落在瓦片边上
 * —— 与 A8 的 `clipTile(…, OVER)` 同一个结论），再各外伸 `2·OVER` ⇒ 世界坐标过界 `OVER`
 * （< flatiso 的 `OVERFLOW_ALLOW` 1/16，且与 A8 斜向板的口径一致）。
 */
function emitBedDiag(job, L, stats) {
  const rows = bedRows();
  const R = rows.length, lastR = R - 1;
  const DLT = 2 * OVER;
  const NODE = [];
  for (let r = 0; r < R; r++) {
    const s = rows[r][0];
    const lo = N(0.5 - s - DLT), hi = N(s + 0.5 + DLT);
    const line = [];
    for (let j = 0; j <= MCOL; j++) line.push(mapD(N(lo + (hi - lo) * (j / MCOL)), s));
    NODE.push(line);
  }
  for (let r = 0; r < lastR; r++) {
    for (let j = 0; j < MCOL; j++) {
      const A = NODE[r][j], B = NODE[r][j + 1], C = NODE[r + 1][j + 1], D = NODE[r + 1][j];
      const z = (n, rr) => N(rows[rr][1] + jz(n[0] + n[1], rr));
      L.push(emitQuad([[A[0], A[1], z(A, r)], [B[0], B[1], z(B, r)],
        [C[0], C[1], z(C, r + 1)], [D[0], D[1], z(D, r + 1)]], MAT.bed));
      stats.bed++;
    }
  }
}

/** 岔口三张（交叉 / 三向 / 四向）：素面平板，形状**逐字照抄 A8** 的 `slabCrossing/Junction3/4` */
function emitJunctionBed(job, L, stats) {
  const [a, b] = BAND;
  const z0 = 0, z1 = Z_CRIB, mat = MAT.bed;
  let shapes;
  if (job.bed === 'crossing') {
    shapes = [
      { x0: 0, x1: 1, y0: a, y1: b, z0, z1, mat },   // X 带
      { x0: a, x1: b, y0: 0, y1: a, z0, z1, mat },   // Y 带（北侧）
      { x0: a, x1: b, y0: b, y1: 1, z0, z1, mat },   // Y 带（南侧）
    ];
  } else if (job.bed === 'junction3') {
    shapes = [{ poly: [[a, 0], [b, 0], [1, a], [1, b], [b, 1], [a, 1]], z0, z1, mat }];
  } else if (job.bed === 'junction4') {
    shapes = [{ poly: [[a, 0], [b, 0], [1, a], [1, b], [b, 1], [a, 1], [0, b], [0, a]], z0, z1, mat }];
  } else {
    throw new Error(`未知的道床口径 bed=${job.bed}`);
  }
  for (const s of shapes) { emitSlab(L, s); stats.bed++; }
}

/** 道床阶段：把源模型里的道砟**整族换成** `BAL-N`（见文件头 ①~⑤） */
function emitBed(job, L, stats) {
  if (!job.bed) return;
  if (job.bed === 'ridge') {
    if (job.kind === 'diag') emitBedDiag(job, L, stats);
    else emitBedY(job, L, stats);
  } else {
    emitJunctionBed(job, L, stats);
  }
}

// =============================================================================
// 四、轨枕（`SLE-3`）—— 与 tools/gen-a5-heavy.mjs **逐字同源**
// =============================================================================
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

  // ★ 交叉那一件：Y 向枕木（横向轴 = x）**整体平移** `ctx.crossDx`。
  //   ⚠ 必须"先按 `c` 缩放、再平移"，**不能把 `crossDx` 加进 `sh`** —— `sh` 是
  //   **缩放中心**，加进去会把加长量按比例摊回去（枕木中心只挪 0.0009 格），
  //   承轨槽就与钢轨错位 0.0156 格 ≈ 2px（本轮踩到并修掉）。
  const dx = axis === 'x' ? (ctx.crossDx ?? 0) : 0;
  if (dx) { b[0] += dx; b[3] += dx; }
  const lo = axis === 'y' ? b[1] : b[0];
  const hi = axis === 'y' ? b[4] : b[3];
  const cuts = CUT.map((v) => v + sh + dx);
  const out = [emitBoxRaw([b[0], b[1], 0, b[3], b[4], Z_BASE], M_BODY, ['top=' + M_BASE])];
  for (const [p, q] of splitByCuts(lo, hi, cuts)) {
    const z = zoneOf((p + q) / 2 - sh - dx);
    const bb = [...b];
    if (axis === 'y') { bb[1] = p; bb[4] = q; } else { bb[0] = p; bb[3] = q; }
    out.push(emitBoxRaw([bb[0], bb[1], Z_BASE, bb[3], bb[4], z.z], z.mat, ['top=' + z.top]));
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
  const back = ([s, t]) => [N((s + t) / 2), N((s - t) / 2)];
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
    const out = [emitBoxRaw([bx0, by0, 0, bx1, by1, Z_BASE], M_BODY, ['top=' + M_BASE])];
    for (const [p, q] of splitByCuts(by0, by1, CUT)) {
      const z = zoneOf((p + q) / 2);
      out.push(emitBoxRaw([bx0, p, Z_BASE, bx1, q, z.z], z.mat, ['top=' + z.top]));
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

// =============================================================================
// 五、钢轨（`RAI-3`）—— **几何一个数不动**，只换材质 + 沿轨探出
// =============================================================================
function railMat(kw, t) {
  const mi = kw === 'box' ? 7 : kw === 'quad' ? 13 : kw === 'prism' ? 3 : 2;
  t[mi] = t[mi] === 'rust' ? MAT.rail : t[mi] === 'metal' ? MAT.railTop : t[mi];
  if (kw === 'box' && t[8] === 'top=metal') t[8] = `top=${MAT.railTop}`;
  return t;
}

function railFaces(job, rec) {
  const over = job.over;
  if (rec.kw === 'box') {
    const b = [...rec.box];
    if (over) {
      if (b[0] <= TOL) b[0] = -OVER;
      if (b[3] >= 1 - TOL) b[3] = 1 + OVER;
      if (b[1] <= TOL) b[1] = -OVER;
      if (b[4] >= 1 - TOL) b[4] = 1 + OVER;
    }
    // ★ 交叉那一件：**沿 y 跑的钢轨**（薄的那一维是 x）跟着 Y 向轨道整组平移；
    //   枕木在 `boxSleeper()` 里按同一个 `ctx.shift.x` 同步挪，X 向钢轨一个数不动。
    if (isCrossing(job) && (b[3] - b[0]) < (b[4] - b[1])) {
      b[0] += CY_DX; b[3] += CY_DX; b[1] += CY_DY; b[4] += CY_DY;
    }
    const t = railMat('box', [null, null, null, null, null, null, null, rec.mat, ...rec.mods]);
    return [`box ${fmt(b[0])} ${fmt(b[1])} ${fmt(b[2])}  ${fmt(b[3])} ${fmt(b[4])} ${fmt(b[5])}   ${t.slice(7).join(' ')}`];
  }

  const iso3 = rec.kw === 'quad';
  const src = iso3 ? rec.pts3 : rec.pts.map((p) => [p[0], p[1]]);
  const out = src.map(([x, y]) => {
    let nx = x, ny = y;
    if (over) {
      if (job.kind === 'diag') {
        const d = OVER / Math.SQRT2;
        if (near0(y)) { nx += d; ny -= d; }
        if (near0(x)) { nx -= d; ny += d; }
        if (near1(y)) { nx -= d; ny += d; }
        if (near1(x)) { nx += d; ny -= d; }
      } else {
        nx += railExt(x);
      }
    }
    return [nx, ny];
  });
  if (rec.kw === 'poly') {
    // ⚠ 材质在参数数组的 **第 2 位**（`railMat` 的 `mi` 是按"整行 token 的下标"定的：
    //   `poly z mat` ⇒ mat 在 t[2]）—— 这里必须按同一个下标放，放错了会吐 `poly ... undefined`
    const t = railMat('poly', [null, null, rec.mat]);
    return [emitPoly(rec.z, out, t[2])];
  }
  if (rec.kw === 'prism') {
    const t = railMat('prism', [null, null, null, rec.mat]);
    return [emitPrism(rec.z0, rec.z1, out, t[3])];
  }
  const t = railMat('quad', [null, null, null, null, null, null, null, null, null, null, null, null, null, rec.mat]);
  return [emitQuad(rec.pts3.map(([x, y, z], i) => [out[i][0], out[i][1], z]), t[13], rec.mods)];
}

// =============================================================================
// 六、主流程
// =============================================================================
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
  // ★ 交叉那一件：Y 向枕木再吃一份「交叉专用」平移（钢轨在 `railFaces()` 里同步；
  //   X 向枕木 / 道床板 / 其余所有件一个数不动）。**是平移量，不是缩放中心** ——
  //   见 `boxSleeper()` 里那条警告。
  if (isCrossing(job)) ctx.crossDx = CY_DX;

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
  const stats = { lines: 0, out: 0, bed: 0, sleep: 0, rail: 0, drop: 0, other: 0 };
  for (const { raw, rec } of geo) {
    stats.lines++;
    if (!rec) { body.push(raw.trimEnd()); stats.other++; continue; }
    const mat = rec.mat;

    // ---- 轨枕：三种表示三套做法（与 A5 逐字同源）----
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

    // ---- 道砟：**整族删掉**（本组改成按 `BAL-N` 断面重铺，见下面的道床阶段）----
    //   `stone_dark` 只在「prism 且 z ≤ 0.006」时并进来 —— 那是坡脚散粒，
    //   本组的毛边由道床自己的坡脚横向抖动做（`toeOff`），旧的散粒不再需要。
    const toe = mat === 'stone_dark' && rec.kw === 'prism' && rec.z1 <= 0.006;
    if (mat === 'gravel' || toe) { stats.drop++; continue; }

    // ---- 钢轨：换材质 + 探出；**几何不动** ----
    if (RAIL_MAT.test(mat)) {
      railFaces(job, rec).forEach((l) => body.push(l));
      stats.rail++; stats.out++;
      continue;
    }

    body.push(raw.trimEnd());
    stats.other++; stats.out++;
  }

  // ---- 道床阶段（把删掉的道砟换成 `BAL-N` 断面）----
  emitBed(job, body, stats);
  stats.out += stats.bed;

  const hdr = [
    '# =============================================================================',
    `# ${job.dst} —— A25 组（\`SECA\` 高速铁路 250km/h）· ${job.note}`,
    '#',
    '# 【本文件由 tools/gen-a9-hsballast.mjs 生成（**整件重写**），请勿手改；改口径改生成器】',
    `#   源 = models/${job.src}.model；kind=${job.kind}、沿轨探出 OVER=${OVER} 格${job.over ? '' : '（本件**不探出**）'}`,
    '#   道床 = `BAL-N` 有砟·高速（砟肩堆高）：道床顶面 0.0078 / 砟肩顶 0.0188 / 砟肩宽 0.0365 / 边坡 1:1.75 / 坡脚 0.1644',
    '#   轨枕 = `SLE-3` 混凝土宽枕（U 形承轨槽，与 A5 重载组**同一批模型口径**）',
    '#   钢轨 = `RAI-3` 长轨（几何 = `RAI-1` 一字不动，只换 metal_dark / metal_pale）',
    '#   轨顶 0.0230 与道床顶面 0.0078 的理由、以及断面的现实依据见生成器文件头。',
    `#   自检：入 ${stats.lines} 行 → 出 ${stats.out} 行；`
      + `**删掉旧道砟 ${stats.drop} 面**、新出道床 ${stats.bed} 面、枕木 ${stats.sleep} 件、钢轨 ${stats.rail} 面、原样 ${stats.other} 行`,
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
  fs.writeFileSync(file, hdr + outHead.join('\n') + '\n' + body.join('\n') + '\n', 'utf8');
  return { file, stats };
}

// ⚠ 取景用的 `zmax` **照抄源模型那一行**（本组不自己定）：道床最高点是砟肩顶
//   0.0188 + 抖动 0.0015 = 0.0203（坡道上再加 0.2041 = 0.2244），**都低于轨顶**
//   0.0230（坡道 0.2271）⇒ 取景框仍由钢轨决定，源的 `zmax` 对本组同样成立，
//   同表十件共用同一个并集取景框。
export function generate() {
  const files = [];
  for (const job of JOBS) {
    const srcFile = path.join(ROOT, 'models', `${job.src}.model`);
    if (!fs.existsSync(srcFile)) { log(`  × 跳过 ${job.dst}：源 ${job.src}.model 不存在`); continue; }
    const { file, stats } = processJob(job);
    files.push(file);
    log(`  → ${rel(file).padEnd(38)} 入 ${String(stats.lines).padStart(4)} → 出 ${String(stats.out).padStart(4)} 行`
      + `   删旧砟 ${String(stats.drop).padStart(3)} · 道床 ${String(stats.bed).padStart(3)} ·`
      + ` 枕 ${String(stats.sleep).padStart(3)} · 轨 ${String(stats.rail).padStart(2)}`);
  }
  return files;
}

if (isMain(import.meta.url)) {
  const t0 = Date.now();
  log('生成 A25 组（SECA）模型：BAL-N 高速有砟（砟肩堆高 0.15 m / 边坡 1:1.75）+ SLE-3 宽枕 + RAI-3 长轨');
  const files = generate();
  log(`✔ 生成 ${files.length} 个模型，用时 ${((Date.now() - t0) / 1000).toFixed(2)} s`);
  log('  下一步：make sprite → 抄模板 → make check');
}
