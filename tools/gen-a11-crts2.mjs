// =============================================================================
// tools/gen-a11-crts2.mjs —— A9 组（`SFCA`，高速铁路 310 km/h 25kV AC）模型生成器
//
// 人工 2026-10-08 批准新建（铁律 L3 的申请），**只写 `models/G11_*.model`**。
//
// 口径（A9 §6 确认门，人工裁定三项）：
//   道床 `BAL-F` 无砟·CRTS II **纵连板**（**板顶 0.0078 + 板面正中一条沿轨纵缝 +
//        横向宽接缝每 1 格 + 不放凸形挡台** —— G11 与 A8 `BAL-E` 的三条差别全在板面）
//   轨枕 `SLE-3` 混凝土宽枕（U 形承轨槽）· 钢轨 `RAI-3` 60kg/m 长轨
//   洞口 **复用 A10 已落地的 `TUN-4`**（`G8_tunnel4*`，`gfx/tunnel4.png`）
//   电气化 `EL-25` + `PYL-S1` H 型钢（无标牌，`probe_catenary_pylons_steel`）
//   C8：`SFCA` **310 km/h** · 费用 **30/15** · 2005 · 地图色 **0x66** · 局部 id **22**
//       `SORT_ELECTRIC` · `CATENARY` · **不做平交道口**（310 高铁全封闭，同 `SGCA` / `SECA`）
//
// -----------------------------------------------------------------------------
// 【为什么是 `gen-a8-crts1.mjs` 的同源副本】
// -----------------------------------------------------------------------------
// A8 / A10 / A25 一路验证过的做法：**同族只差"板面那一层"时，整件复制最省事、最安全**。
// 本组与 A8（`SCCA` / `SDCA`）的差别**只有板面**：
//
//   * **轨枕 `SLE-3` 那一段逐字照抄**（`boxSleeper` / `prismSleeper` / `quadSleeperGroup`
//     / `analyse` 四个函数 + `K_SLEEP_*` / `CUT` / `Z_*` 常量）—— 相位与交叉两方向的
//     屏幕位移都**烘在坐标里**，重画必丢（见 `docs/建模经验.md` §4.24）。
//   * **钢轨 `RAI-3` 只做两件事**：换材质（`rust`→`metal_dark`、`metal`→`metal_pale`）
//     + 沿轨探出 `OVER_RAIL = 3/128`。**宽度与轨底一个数不动**（别抄 A5 的 `RAI-2`）。
//   * **洞口一件不出**：`TUN-4` 是四条 `S_CA` 共用的洞口，NML 直接指 `probe_tunnels_4`。
//
// ⇒ 与 A8 的差别集中在 `plateSegs()` / `emitPlate()` 两处，以及那条**纵缝**。
//
// -----------------------------------------------------------------------------
// 【`BAL-F`（无砟·CRTS II 纵连板）—— 数字规格与三条判据】
// -----------------------------------------------------------------------------
//   `美术要素方案.md` §1.1：「**纵连板，更平顺、几乎无板缝**」（京沪高铁）。
//   现实口径：CRTS II 板式 ＝ **两片 2.55 m 宽的预制板纵向并排**，板缝（纵向施工缝）
//   用后浇混凝土**纵连**起来，再在两端设**横向宽接缝** —— 所以板面上稳定的缝只有两类：
//   **一条沿轨的纵缝**与**间距很大的横缝**（这就是它与 CRTS I「单元板 + 每 4.93 m 一条横缝
//   + 凸形挡台」的区别）。
//
//   ① **板顶 `0.0078`**（板体 `z 0 → 0.0078`，板带 `y 0.32 ~ 0.68` 与全包同宽）
//      与 A5 `BAL-B` / A8 `BAL-E` / A25 `BAL-N` **同一个数** ⇒ **同一批 `SLE-3` 在四组上
//      露出的高度完全一致**。（`RISE`/`SLE-3` 的枕身是 `z 0 → 0.0100`，`0.0075` 以下是
//      "看不见的底板"；⚠ 不能取 0.0075 —— 与枕身底板顶面**共面**，深度相等、谁先画谁赢，会闪。）
//
//   ② **横向宽接缝：每 1 格一道**（`JOINT_P = 1`，一格 1 块板 ≈ 13.7 m）——
//      缝宽 `0.0100` / 缝深 `0.0028`（缝底 `z 0.0050`）/ 缝内 `panel_seam`(96,96,96) 深色顶面。
//      * **必须整除 1 格**（`1 / JOINT_P` 是整数）⇒ 缝位锚在每格局部 `x = 0`，相邻两格对得上。
//      * **瓦片边那道缝画整条**（向外各多伸 `JOINT_W/2 = 0.005` < `OVER`）：相邻两格画的是
//        **逐字相同**的一块几何 ⇒ 瓦片边界那一列像素落在缝**内部**（否则精灵接缝会在缝正中
//        留一条 1 px 亮线：两边抗锯齿各出一半 alpha）。
//      * 与 A8 的判据对照：`BAL-E` 是 **1/3 格**一道 ⇒ **节奏差 3 倍**，4x 下一眼可分。
//      * ⚠ **例外是坡道**（`edgeFull: false`）：坡道两端各有硬理由不许探出（高端顶格位、
//        低端 `z < 0` 穿地）⇒ 坡道上的缝**只画落在本格里的那一半**，另一半由邻格（平的）
//        画的整条盖住。
//
//   ③ ★ **纵向施工缝（本档的身份）**：**沿轨方向、压在板带中线 `y = 0.5` 上的一道缝**
//      —— 宽 / 深 / 缝内材质与横缝**同值**（`JOINT_W` / `JOINT_D` / `panel_seam`），
//      只是走向差 90°。落法：`plateSegs()` 把**板体段在 y 上切成三片**（外 / 中缝 / 外），
//      中片降到缝底并换深色顶面；横缝段本来就是整幅降到缝底 ⇒ 不必再切。
//      ⚠ `apron`（缝外侧那条 1/32 的探出板）**也要带纵缝** —— 否则纵缝每格都在瓦片边断 4.47px。
//      ⚠ 直向 / 斜向 / 坡道三种板的"沿轨"方向各不相同，但**纵缝都在各自的局部 `y = 0.5`**
//        （斜向板经 `mapD` 落进世界、坡道板随 x 剪切）⇒ 三条路径共用同一个 `plateSegs()`。
//
//   ④ **不放凸形挡台**：CRTS II 没有这一构件 ⇒ `BOSS_*` 常量与 `bossQuad/Box/Diag/Sheared`
//      四个函数整段删除。（`BAL-E` 是"每道缝正对中线一个 0.036 格见方、顶 0.0218 的方柱"。）
//
//   ⑤ **岔口三张板素面**（同 `BAL-I` / `BAL-G` / `BAL-E` / `BAL-N` 的先例）：交叉 = 十字
//      （X 带 ∪ 两个 Y 带）、三向 = 六边形、四向 = 八边形 —— 形状**照抄 A12**
//      （人工 2026-10-03 裁定过，别自己发明），只把 z 与材质换成 `BAL-F` 的。
//      ⚠ **纵缝也不画**：板形是多边形的，X/Y 两个方向的纵缝会在十字中心织在一起
//      （与"三个方向的埂会织在一起"同一条理由）。
//
//   ⑥ **不做平交道口**（`SFCA` 310 km/h 全封闭）⇒ 不出 `G11_levelcrossing`。
//
// -----------------------------------------------------------------------------
// 【探出边界（盖接缝）】—— 与 A5 / A8 / A10 / A25 同一套（**三个量**，别用一个）
// -----------------------------------------------------------------------------
//   * **钢轨**：`OVER_RAIL = 3/128`（直向 + 坡道；坡道两端从"一点不探"改成探 3/128 ⇒
//     原来实机看到"上下坡铁轨短一截"）。⚠ 坡道钢轨只动 x、**z 一个数不动**（走 `railOver`）。
//   * **板**：`OVER = 1/32`（含 apron）—— 试过 1/16，实机证明会**盖住邻格斜向半格的枕木**
//     （`docs/建模经验.md` §4.29：探出量不是越大越好）。
//   * **枕木 / 岔口板 / 斜向板**：仍 `OVER = 1/32`。
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, log, rel, isMain } from './util.mjs';

// ---------------------------------------------------------------- 口径常量
const BAND = [0.3200, 0.6800];        // 板带（与 G1 / A12 / A10 同宽 0.36 格 = 5.0 m）
const PLATE_Z = 0.0078;               // `BAL-F` 板顶（与 `BAL-E`/`BAL-B`/`BAL-N` 同一个数，理由见文件头 ①）
const JOINT_P = 1;                    // 板缝间距（**必须整除 1 格**）—— A9 `BAL-F` = **每 1 格一道**（A8 是 1/3）
const JOINT_W = 0.0100;               // 板缝宽
const JOINT_D = 0.0028;               // 板缝深（缝底 z = PLATE_Z − JOINT_D = 0.0050）
// ★★ 人工 2026-10-08 裁定的 `BAL-F` 身份：**板面正中一条沿轨的纵缝**（CRTS II 的纵向施工缝）。
//   现实里 CRTS II = "两片 2.55 m 宽的板纵向并排、再用后浇混凝土纵连" ⇒ 板面上唯一稳定的
//   缝就是这条纵缝。宽 / 深 / 缝内材质与横缝**同值**（`panel_seam`），只是走向差 90°。
const SEAM_Y = 0.5;                   // 纵缝中线（= 轨道中线 0.5，压在两条钢轨正中间）
// ⚠ **不放凸形挡台**（CRTS II 没有这一构件）—— 与 A8 `BAL-E` 的第三条差别。

const RISE = 0.2041;                  // 一格坡道抬高（与 gen-g1-slope / A12 / A10 同源）
const EPS = 0.0008;                   // 顶面换材质时的微小抬升（prism + poly 的两片做法）
const OVER = 0.03125;                 // 沿轨探出 1/32 格（**枕木 / 岔口板 / 斜向板**沿用；见文件头）
// ★★ 人工 2026-10-08：「这几种铁路铁的**水平轨超出边界太多**，但是**道床伸出量不够**，
//    以及**上下坡铁轨的铁轨长度不够**」⇒ 本组把"钢轨"与"道床"两个探出量**分开**（原来是同一个 OVER）：
const OVER_RAIL = 0.0234375;          // 钢轨沿轨探出 **3/128 格**（原 1/32；先试过 1/64 —— 人工 2026-10-08「又缩短太多了」）
// ⚠ 道床板**只补到 1/32**（不再放大到 1/16）：探 1/16 会把邻格（斜向半格）的枕木盖掉。
const TOL = 0.001;                    // 钢轨"到头"容差（必须 > clipBox 的 0.0005）

// ---------------------------------------------------------------- 交叉：Y 向轨道再挪一份
// ★ 人工 2026-10-06：「把 SCCA 和 SECA 的交叉轨道模型中的 y 方向轨道应用（2,-1）的偏移」
//   —— 人工先报了 (−2,+1)、随即更正为 **(2,−1)**，本文件按**更正后的数**落。
//   ⚠ 人工那条只点了 **A8（SCCA）与 A25（SECA）**；本组（A9 `SFCA`）**沿用同一口径**，
//     理由 = **同族自洽**：交叉瓦片里那条 Y 轨必须与本组自己的直线 Y 轨对齐
//     （量过：吃了 G1 的 `CROSS_Y_EXTRA` 时横向偏 1.34px，抵掉之后 0.44px）。
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
/** 只有交叉那一件吃这份增量（A8 的作业表用 `plate:`、A25 用 `bed:`；本组同 A8） */
const isCrossing = (job) => job.bed === 'crossing' || job.plate === 'crossing';

// ---------------------------------------------------------------- 材质
const MAT = {
  plate: 'concrete_mid',              // 板体 / 板缝壁（中性冷灰，渲出 ≈(155,157,160)）
  seam: 'panel_seam',                 // 板缝顶面（96,96,96；`_seam` 族 ⇒ 颗粒 0）—— 横缝与**纵缝**共用
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
 *              'y'      整格直线 / 平交道口：横向 = y
 *              'diag'   斜向半格轨（切 N 角）：横向 = x + y
 *              'cross'  交叉 / 三向 / 四向：两个方向混在一个模型里 ⇒ 逐坐标判
 *              'slope'  坡道：横向 = y，但**沿轨不探出**
 *   plate   道床板的发射口径（null = 本件没有板面，纯 overlay）
 *              'box'       直向板（板缝 + 挡台）
 *              'boxplain'  平交道口的**素面**板（不排缝、不放挡台，理由见文件头 ③）
 *              'diag'      斜向板（板缝 + 挡台，裁到瓦片 + OVER）
 *              'sheared'   坡道板（板缝只画半条 + 挡台用 5 个 quad 手写）
 *              'crossing'  十字板（素面）
 *              'junction3' 六边形板（素面）
 *              'junction4' 八边形板（素面）
 */
const JOBS = [
  { src: 'probe_track_x', dst: 'G11_track_x', kind: 'y', over: true, plate: 'box',
    note: 'underlay 槽 0/1（RTO_X / RTO_Y）：BAL-F 纵连板 + SLE-3 宽枕 + RAI-3 长轨（完整画面）' },
  { src: 'G1_rail_straight', dst: 'G11_rail_straight', kind: 'y', over: true, plate: null,
    note: 'overlay 槽 0/1：透明底，只有宽枕 + 长轨（道岔瓦片上引擎逐段叠它）' },

  { src: 'probe_half_upper', dst: 'G11_track_half', kind: 'diag', over: true, plate: 'diag',
    note: 'underlay 槽 2-5（RTO_N / S / E / W）：切 N 角的半格轨' },
  { src: 'probe_half_upper', dst: 'G11_z_track_half_m', kind: 'diag', over: true, plate: 'diag',
    note: 'underlay 槽 3/4（RTO_S / RTO_E）专用：半格轨的"镜像版"——'
      + '本组没有第三轨可翻，所以它与 `G11_track_half` **逐面相同**，存在的唯一理由是'
      + '**槽位对齐**（照 A10 `G8_z_track_half_m` 的先例：那两件实测差异 0 行）' },
  { src: 'G1_rail_halftrack', dst: 'G11_rail_half', kind: 'diag', over: true, plate: null,
    note: 'overlay 槽 2-5：半格轨的宽枕 + 钢轨层' },

  { src: 'G1_track_slope', dst: 'G11_track_slope', kind: 'slope', over: false, railOver: true, plate: 'sheared',
    note: 'underlay 槽 6-9（RTO_SLOPE_NE / SE / SW / NW）：坡道的**道床板不探出**（两端探出去会穿地 / 顶格位），'
      + '但**钢轨要探**（★ 人工 2026-10-08「上下坡铁轨的铁轨长度不够」）—— 见 railOver' },
  { src: 'G1_rail_slope', dst: 'G11_rail_slope', kind: 'slope', over: true, plate: null,
    note: 'overlay 槽 6-9：坡道的宽枕 + 钢轨层（★ 人工 2026-10-08：钢轨**要**探出 —— 沿轨 3/128，'
      + 'z 不动；道床那条坡道板仍 `over: false`，两端探出会穿地 / 顶格位）' },

  { src: 'G1_crossing', dst: 'G11_crossing', kind: 'cross', over: true, plate: 'crossing',
    note: 'underlay 槽 10（RTO_CROSSING_XY）：交叉（十字素面板 + 两个方向的宽枕 / 钢轨）' },
  { src: 'G1_junction3', dst: 'G11_junction3', kind: 'cross', over: true, plate: 'junction3',
    note: 'underlay 槽 11-14：三向道岔的六边形板（**素面**，同 A12 / A10 / A8 / A25）' },
  { src: 'G1_junction4', dst: 'G11_junction4', kind: 'cross', over: true, plate: 'junction4',
    note: 'underlay 槽 15：四向道岔的八边形板（**素面**，同上）' },

  // ⚠ **本组没有平交道口**（`SFCA` 是 310 km/h 高铁、全封闭 ⇒ `RAILTYPE_FLAG_NO_LEVEL_CROSSING`，
  //   与同为高铁的 `SGCA` / `SECA` 一致；人工 2026-10-08 口径）⇒ **不出 `G11_levelcrossing`**，
  //   NML 那边也不给 `level_crossings:`。`plate: 'boxplain'` 那条分支因此在本组用不上（留着备用）。

  // ⚠ **本组的"镜像半格件"（`G11_z_track_half_m`）是 `G11_track_half` 的逐面副本**：
  //   A12 / A10 里那个镜像件存在的唯一理由是"把第三轨翻到另一侧"，而本组是 25kV
  //   架空接触网、**没有第三轨** ⇒ 板带 / 钢轨 / 宽枕 / 板缝 / 纵缝全部关于 y = 0.5 对称
  //   （A10 的那对文件实测差异 **0 行**）。留着它是为了**槽位对齐**与 spriteset 结构
  //   与 A10 / A8 逐条可比 —— `rect` / `xrel` / `yrel` 也照它们的镜像件抄。
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
/** 钢轨专用（见 A5 文件头那条 0.0005 的教训：源里钢轨被 clipBox 钳在 0.0005）
 *  ⚠ 用 `OVER_RAIL`（1/64），不用 `OVER` —— 人工 2026-10-08：钢轨超出边界太多。
 *  ⚠ 坡道钢轨也走这里：只在 x 上探、**z 一个数不动** —— 坡道两端各自邻着**平轨**
 *    （低端同层、高端上一层），保持 z 正好与邻格平轨重合（偏差 ≤ 0.5px）。 */
function railExt(v) {
  if (v <= TOL) return -OVER_RAIL;
  if (v >= 1 - TOL) return OVER_RAIL;
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

/** 凸多边形按 **s = 第 0 个分量** 裁剪（Sutherland–Hodgman）—— `prismSleeper()` 专用
 *
 *  ⚠⚠ 2026-10-08 修掉一个**从 A5 起就存在**的错（SECA / SDCA 实机「斜向的半格
 *     枕木稀疏」）：`prismSleeper()` 里的多边形已经在 `(s, t) = (x+y, x−y)` 空间里，
 *     **s 就是第 0 个分量**；而 `clipS()` 是给**世界坐标** `(x, y)` 写的，判据是 `x + y`。
 *     把 (s,t) 喂给 `clipS()` ⇒ 判据变成 `s + t`（= 2x，与分带线毫无关系）⇒ 除极少数巧合，
 *     每条枕木的 5 条分带全被裁成 < 3 点丢掉 ⇒ **枕木顶面只剩一块素混凝土**（挡肩 / 槽全没了）。
 *     实测（`G10_track_half`，55 个源枕木 prism）：修前发出 **15** 条顶面带（肩 4 / 槽 4）、
 *     `metal_pale` 面 **0** 个；修后 **127** 条（肩 36 / 槽 36 / 中 55）、丢弃 **0**。
 *     ⚠ 三份同源副本（`gen-a5-heavy` / `gen-a8-crts1` / `gen-a9-hsballast`）**必须一起改**。
 */
function clipS1(pts, a, b) {
  const cut = (poly, keep) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const fp = keep === 'ge' ? p[0] - a : b - p[0];
      const fq = keep === 'ge' ? q[0] - a : b - q[0];
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

/** 半平面裁剪：a·x + b·y − c ≥ 0 */
function halfPlane(p, a, b, c) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const A = p[i], B = p[(i + 1) % p.length];
    const va = a * A[0] + b * A[1] - c, vb = a * B[0] + b * B[1] - c;
    if (va >= 0) out.push(A);
    if ((va >= 0) !== (vb >= 0)) {
      const t = va / (va - vb);
      out.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]);
    }
  }
  return out;
}

/** 裁到瓦片 [0,1]²（`m` = 向外多留多少格） */
function clipTile(p, m = 0) {
  let q = p;
  q = halfPlane(q, 1, 0, -m);
  q = halfPlane(q, 0, 1, -m);
  q = halfPlane(q, -1, 0, -1 - m);
  q = halfPlane(q, 0, -1, -1 - m);
  const out = [];
  for (const v of q) {
    const w = [N(v[0]), N(v[1])];
    const last = out[out.length - 1];
    if (!last || Math.hypot(w[0] - last[0], w[1] - last[1]) > 1e-6) out.push(w);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
  return out;
}

/** 斜向映射：局部 (x 沿轨, y 横向) → 世界 (x,y)，轨道线为 x+y = 0.5（切 N 角） */
const mapD = (x, y) => [N((y + (x - 0.5)) / 2), N((y - (x - 0.5)) / 2)];
const mapDPts = (pts) => pts.map(([x, y]) => mapD(x, y));

/** 直向：轴对齐的 box（`long` 的件沿轨两端各探出 OVER） */
function emitBox(L, b) {
  const o = b.long ? OVER : 0;
  L.push(`box ${fmt(b.x0 - o)} ${fmt(b.y0)} ${fmt(b.z0)}  ${fmt(b.x1 + o)} ${fmt(b.y1)} ${fmt(b.z1)}   `
    + `${b.mat}${b.top ? ` top=${b.top}` : ''}`);
}

/** 斜向：沿轨铺满整格再裁到瓦片（口径见 gen-a12-metro.mjs 的 emitDiag） */
function emitDiag(L, b) {
  const X0 = b.long ? -1 : b.x0;
  const X1 = b.long ? 2 : b.x1;
  const m = b.clip ?? (b.long ? OVER : 0);
  const poly = clipTile(ccw([mapD(X0, b.y0), mapD(X1, b.y0), mapD(X1, b.y1), mapD(X0, b.y1)]), m);
  if (poly.length < 3) return;
  const P = poly.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join('  ');
  if (b.top) {
    L.push(`prism ${fmt(b.z0)} ${fmt(b.z1 - EPS)}  ${b.mat}  ${P}`);
    L.push(`poly ${fmt(b.z1)}  ${b.top}  ${P}`);
  } else {
    L.push(`prism ${fmt(b.z0)} ${fmt(b.z1)}  ${b.mat}  ${P}`);
  }
}

/** 坡道：每个顶点 z += RISE·(1−x)，六个面都用 quad 手写（**两端都不探出**） */
function emitSheared(L, b) {
  const z = (x, zz) => N(zz + RISE * (1 - x));
  const P = (x, y, zz) => [N(x), N(y), z(x, zz)];
  const A = P(b.x0, b.y0, b.z0), B = P(b.x1, b.y0, b.z0), C = P(b.x1, b.y1, b.z0), D = P(b.x0, b.y1, b.z0);
  const A2 = P(b.x0, b.y0, b.z1), B2 = P(b.x1, b.y0, b.z1), C2 = P(b.x1, b.y1, b.z1), D2 = P(b.x0, b.y1, b.z1);
  const q = (p1, p2, p3, p4, mat) => L.push(`quad ${[...p1, ...p2, ...p3, ...p4].map(fmt).join(' ')}  ${mat}`);
  q(A2, B2, C2, D2, b.top || b.mat);   // 顶面 +z
  q(A, D, C, B, b.mat);                 // 底面 −z
  q(A, B, B2, A2, b.mat);               // −y 侧
  q(D2, C2, C, D, b.mat);               // +y 侧
  q(A2, D2, D, A, b.mat);               // −x 侧
  q(B, C, C2, B2, b.mat);               // +x 侧
}

/** 发一块水平多边形柱（轴对齐用 box，多边形用 prism；两者都吃 `top=`） */
function emitSlab(L, b) {
  if (b.poly) {
    const P = ccw(b.poly).map((p) => `${fmt(p[0])},${fmt(p[1])}`).join('  ');
    L.push(`prism ${fmt(b.z0)} ${fmt(b.z1)}  ${b.mat}  ${P}`);
  } else {
    emitBox(L, b);
  }
}

// =============================================================================
// 三、`BAL-F` 板（本组唯一的新几何）—— 横缝每 1 格 + **板面正中一条沿轨纵缝**，不放挡台
// =============================================================================
/**
 * 板缝位（局部 x）：`JOINT_P` 的整数倍。
 * ⚠ 锚在局部 x = 0 ⇒ 直线上相邻两格对得上；`1 / JOINT_P` 是整数 ⇒ 局部 x = 1
 *   也是缝位（**这条就是文件头说的"必须整除 1 格"**）。
 */
function jointTs(X0, X1) {
  const out = [];
  for (let k = Math.ceil(X0 / JOINT_P - 1e-9); k * JOINT_P <= X1 + 1e-9; k++) out.push(N(k * JOINT_P));
  return out;
}

/**
 * 板体 / 板缝交替的若干段（轴对齐的**局部**坐标；怎么落进世界由发射器决定）。
 *
 *   @param edgeFull  true ⇒ 瓦片边那道缝画**整条**（各自向外多伸 `JOINT_W/2`）。
 *                    直向 / 斜向 / 平交道口用这个：相邻两格画的是逐字相同的一块几何，
 *                    瓦片边界那一列像素落在缝**内部**，精灵接缝不会在缝正中留亮线。
 *                    false ⇒ 只画落在本格里的那一半（**坡道专用** —— 坡道两端
 *                    都不许探出，见文件头 ②）。
 */
function plateSegs(X0, X1, { edgeFull = true, clip = 0 } = {}) {
  const hw = JOINT_W / 2;
  const lo = edgeFull ? X0 - hw : X0;
  const hi = edgeFull ? X1 + hw : X1;
  const raw = [];
  let cur = lo;
  for (const t of jointTs(X0, X1)) {
    const a = N(Math.max(lo, t - hw)), b = N(Math.min(hi, t + hw));
    if (b <= a + 1e-9) continue;
    if (a > cur + 1e-9) raw.push({ x0: cur, x1: a, joint: false });
    raw.push({ x0: a, x1: b, joint: true });
    cur = b;
  }
  if (cur < hi - 1e-9) raw.push({ x0: cur, x1: hi, joint: false });

  /** 拼一块：`recess` = 这一段是**缝**（横缝整幅 / 纵缝只占中间那一条）
   *  ⚠ 缝段的 z 到缝底为止、**顶面换深色**；侧壁仍是板体色（露在瓦片边上的那面才不显眼）。 */
  const mk = (x0, x1, y0, y1, recess) => ({
    x0: N(x0), x1: N(x1), y0: N(y0), y1: N(y1), z0: 0,
    z1: recess ? N(PLATE_Z - JOINT_D) : PLATE_Z,
    mat: MAT.plate, top: recess ? MAT.seam : undefined,
    clip: clip || undefined,
  });

  const res = [];
  for (const s of raw) {
    // 横缝段：整幅降到缝底（纵缝在那里也已经到缝底了 ⇒ 不必再切）
    if (s.joint) { res.push(mk(s.x0, s.x1, BAND[0], BAND[1], true)); continue; }
    // ★ `BAL-F` 的**纵向施工缝**：板体段在 y 上再切三片（外 / 中缝 / 外）
    res.push(mk(s.x0, s.x1, BAND[0], SEAM_Y - hw, false));
    res.push(mk(s.x0, s.x1, SEAM_Y - hw, SEAM_Y + hw, true));
    res.push(mk(s.x0, s.x1, SEAM_Y + hw, BAND[1], false));
  }
  return res;
}

// ⚠ **本组没有凸形挡台**（`BAL-F` / CRTS II 没有这一构件，人工 2026-10-08 裁定）⇒
//   A8 的 `bossQuad()` / `bossBox()` / `bossDiag()` / `bossSheared()` 四个函数与
//   `BOSS_R` / `BOSS_Z1` 两个常量在这里**整段删除**（`emitPlate()` 里也一并去掉那三处调用）。

/** 交叉（X 带 ∪ Y 带）—— 拆成 3 块互不重叠的轴对齐板（形状照抄 A12） */
function slabCrossing() {
  const [a, b] = BAND;
  return [
    { x0: 0, x1: 1, y0: a, y1: b, z0: 0, z1: PLATE_Z, mat: MAT.plate },   // X 带
    { x0: a, x1: b, y0: 0, y1: a, z0: 0, z1: PLATE_Z, mat: MAT.plate },   // Y 带（北侧）
    { x0: a, x1: b, y0: b, y1: 1, z0: 0, z1: PLATE_Z, mat: MAT.plate },   // Y 带（南侧）
  ];
}
/** 三向道岔（基准朝向 = 缺**西**臂）= 矩形 + 梯形 = 六边形（人工 2026-10-03 裁定） */
function slabJunction3() {
  const [a, b] = BAND;
  return [{ poly: [[a, 0], [b, 0], [1, a], [1, b], [b, 1], [a, 1]], z0: 0, z1: PLATE_Z, mat: MAT.plate }];
}
/** 四向道岔 = 正八边形（整格切掉四个 45° 角） */
function slabJunction4() {
  const [a, b] = BAND;
  return [{ poly: [[a, 0], [b, 0], [1, a], [1, b], [b, 1], [a, 1], [0, b], [0, a]], z0: 0, z1: PLATE_Z, mat: MAT.plate }];
}

/**
 * 道床板阶段：把源模型里的道砟**整族换成** `BAL-F` 纵连板。
 * 三种平放的板（直向 / 斜向 / 坡道）各自带**横缝每 1 格 + 沿轨纵缝**、**不放挡台**；
 * 岔口三张**素面**（纵缝也不画 —— 板形是多边形，X/Y 两条纵缝会在十字中心织在一起）。
 */
function emitPlate(job, L, stats) {
  const K = job.plate;
  if (!K) return;
  if (K === 'box') {
    for (const b of plateSegs(0, 1, { edgeFull: true })) { emitBox(L, b); stats.plate++; }
    // ★★ 人工 2026-10-08「**道床伸出量不够**」：板的沿轨探出从 ±(JOINT_W/2) = ±0.005 补到 `OVER`（1/32）。
    //   ⚠ **不能把最外侧那段缝往外拉** —— 那会把瓦片边那条板缝拉宽，而缝宽必须恒为 `JOINT_W`
    //     （板缝的节奏是这一档的身份）。做法 = **在缝的外侧再接一条板面高度的素板**（apron）。
    //   ⚠ 初版做到 1/16，实机被人工否掉（「半格铁轨现在没有枕木」）—— 探出去的精灵会**盖住
    //     邻格的内容**，1/16（8.9px）时正好把斜向半格的枕木压掉。**探出量不是越大越好**。
    //   ⚠ 所以这里只补到 `OVER = 1/32`（= A10 / A25 道床一直以来的量），缝宽 / 缝位仍不动。
    //   ★ A9 的 apron **也要带纵缝**（切成三片）—— 否则那条沿轨纵缝每格都会在瓦片边断 4.47px。
    const hw = JOINT_W / 2;
    const apron = (x0, x1) => [
      { x0, x1, y0: BAND[0], y1: SEAM_Y - hw },
      { x0, x1, y0: SEAM_Y - hw, y1: SEAM_Y + hw },
      { x0, x1, y0: SEAM_Y + hw, y1: BAND[1] },
    ];
    for (const [a, b] of [[-OVER, -hw], [1 + hw, 1 + OVER]]) {
      apron(a, b).forEach((s, i) => {
        // 中间那一条是**缝底高度**（纵缝延续出去），两侧是板面高度
        const recess = i === 1;
        emitBox(L, { x0: s.x0, x1: s.x1, y0: s.y0, y1: s.y1, z0: 0, z1: recess ? N(PLATE_Z - JOINT_D) : PLATE_Z,
          mat: MAT.plate, top: recess ? MAT.seam : undefined });
        stats.plate++;
      });
    }
    // ⚠ 不放凸形挡台（`BAL-F` 没有这一构件）
  } else if (K === 'boxplain') {
    emitBox(L, { long: true, x0: 0, x1: 1, y0: BAND[0], y1: BAND[1], z0: 0, z1: PLATE_Z, mat: MAT.plate });
    stats.plate++;
  } else if (K === 'diag') {
    for (const b of plateSegs(-1, 2, { edgeFull: true, clip: OVER })) { emitDiag(L, b); stats.plate++; }
  } else if (K === 'sheared') {
    for (const b of plateSegs(0, 1, { edgeFull: false })) { emitSheared(L, b); stats.plate++; }
  } else if (K === 'crossing') {
    for (const b of slabCrossing()) { emitBox(L, b); stats.plate++; }
  } else if (K === 'junction3') {
    for (const b of slabJunction3()) { emitSlab(L, b); stats.plate++; }
  } else if (K === 'junction4') {
    for (const b of slabJunction4()) { emitSlab(L, b); stats.plate++; }
  } else {
    throw new Error(`未知的板口径 plate=${K}`);
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
    const poly = clipS1(P, p, q);
    if (poly.length < 3) continue;
    const z = zoneOf((p + q) / 2 - (ctx.shift.s ?? 0));
    // ★ 挡肩那一档的**顶面**要换材质（`M_SH` = `metal_pale`）—— 与 `boxSleeper()`
    //   （侧面 `z.mat` / 顶面 `z.top`）和 `quadSleeperGroup()`（`z.pad ? M_PAD : z.top`）
    //   **同一口径**。`prism` 没有 `top=` 修饰符 ⇒ 走 `emitDiag()` 那套两片做法：
    //   prism 到 `z − EPS` ＋ 一片 `poly` 顶面。
    //   ⚠ 2026-10-08 修：修前这里只发 `z.mat` ⇒ 斜向枕木的挡肩顶与枕身同色，
    //     实机读作"枕木稀疏 / 看不清"（SECA / SDCA）。
    const bb = poly.map(back);
    if (z.top && z.top !== z.mat) {
      out.push(emitPrism(Z_BASE, z.z - EPS, bb, z.mat));
      out.push(emitPoly(z.z, bb, z.top));
    } else {
      out.push(emitPrism(Z_BASE, z.z, bb, z.mat));
    }
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
  // ★ 人工 2026-10-08：钢轨的探出量与道床**解耦** —— 坡道那两件 `over: false`（板不许探），
  //   但钢轨要探（原来坡道两端一点不探 ⇒ 实机看着"短一截"）。
  const over = job.over || job.railOver;
  if (rec.kw === 'box') {
    const b = [...rec.box];
    if (over) {
      if (b[0] <= TOL) b[0] = -OVER_RAIL;
      if (b[3] >= 1 - TOL) b[3] = 1 + OVER_RAIL;
      if (b[1] <= TOL) b[1] = -OVER_RAIL;
      if (b[4] >= 1 - TOL) b[4] = 1 + OVER_RAIL;
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
  const stats = { lines: 0, out: 0, plate: 0, sleep: 0, rail: 0, drop: 0, other: 0 };
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

    // ---- 道砟：**整族删掉**（本组改成 `BAL-F` 纵连板，见下面的板阶段）----
    //   `stone_dark` 只在「prism 且 z ≤ 0.006」时并进来 —— 那是坡脚散粒。
    //   ⚠ 平交道口的 `stone_dark` 是三块 **box** 铺板（道面）—— 本组不做道口，用不上。
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

  // ---- 板阶段（把删掉的道砟换成 `BAL-F` 纵连板）----
  emitPlate(job, body, stats);
  stats.out += stats.plate;

  const hdr = [
    '# =============================================================================',
    `# ${job.dst} —— A9 组（\`SFCA\` 高速铁路 310 km/h）· ${job.note}`,
    '#',
    '# 【本文件由 tools/gen-a11-crts2.mjs 生成（**整件重写**），请勿手改；改口径改生成器】',
    `#   源 = models/${job.src}.model；kind=${job.kind}、沿轨探出 OVER=${OVER} 格${job.over ? '' : '（本件**不探出**）'}`,
    '#   道床 = `BAL-F` 无砟·CRTS II **纵连板**（板顶 0.0078 · 横向宽接缝**每 1 格** 宽 0.0100 深 0.0028'
      + ' · **板面正中一条沿轨纵缝**同规格 · **不放凸形挡台**）',
    '#   轨枕 = `SLE-3` 混凝土宽枕（U 形承轨槽，与 A5 / A8 / A25 **同一批模型口径**）',
    '#   钢轨 = `RAI-3` 长轨（几何 = `RAI-1` 一字不动，只换 metal_dark / metal_pale）',
    '#   轨顶 0.0230 与板顶 0.0078 的理由见生成器文件头。',
    `#   自检：入 ${stats.lines} 行 → 出 ${stats.out} 行；`
      + `**删掉道砟 ${stats.drop} 面**、新出板件 ${stats.plate} 面、枕木 ${stats.sleep} 件、钢轨 ${stats.rail} 面、原样 ${stats.other} 行`,
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

// ⚠ 取景用的 `zmax` **照抄源模型那一行**（本组不自己定）：板顶 0.0078 与源里的道砟
//   顶面同高、轨顶 0.0230 一个数没动 ⇒ 源的 `zmax` 对本组同样成立，
//   同表九件共用同一个并集取景框。
export function generate() {
  const files = [];
  for (const job of JOBS) {
    const srcFile = path.join(ROOT, 'models', `${job.src}.model`);
    if (!fs.existsSync(srcFile)) { log(`  × 跳过 ${job.dst}：源 ${job.src}.model 不存在`); continue; }
    const { file, stats } = processJob(job);
    files.push(file);
    log(`  → ${rel(file).padEnd(36)} 入 ${String(stats.lines).padStart(4)} → 出 ${String(stats.out).padStart(4)} 行`
      + `   删道砟 ${String(stats.drop).padStart(3)} · 板 ${String(stats.plate).padStart(2)} ·`
      + ` 枕 ${String(stats.sleep).padStart(3)} · 轨 ${String(stats.rail).padStart(2)}`);
  }
  return files;
}

if (isMain(import.meta.url)) {
  const t0 = Date.now();
  log('生成 A9 组（SFCA）模型：BAL-F CRTS II 纵连板（板顶 0.0078 + 横缝每 1 格 + 沿轨纵缝，不放挡台）+ SLE-3 宽枕 + RAI-3 长轨');
  const files = generate();
  log(`✔ 生成 ${files.length} 个模型，用时 ${((Date.now() - t0) / 1000).toFixed(2)} s`);
  log('  下一步：make sprite → 抄模板 → make check');
}
