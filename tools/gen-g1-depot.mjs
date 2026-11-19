// =============================================================================
// tools/gen-g1-depot.mjs —— 机车库「库 A」模型生成器
//
//   ★ 2026-11-19 v74：**整份重写**。旧文件里 na/nb/nc/a/wa/wb 那一串历史包袱
//     全部作废；这里只有一张尺寸表 + 两个发射函数，一切按下面【一】的结论生成。
//
//   node tools/gen-g1-depot.mjs                 # 默认 brick（不艳的砖色）
//   node tools/gen-g1-depot.mjs --style=red     # 鲜艳红砖
//   node tools/gen-g1-depot.mjs --style=grey    # 青砖
//
// -----------------------------------------------------------------------------
// 【一、xUSSR / 官方例子量出来的结论，以及它对应的每一处构造】
//
//   (1) 绘制顺序：**槽 0/2 → 列车 → 槽 1/3/4/5**
//       ⇒ 库内(0/2) 是被车压住的那层；壳体(1/3/4/5) 是挡车的那层。
//
//   (2) xUSSR 那块 24×25（291 px）画的是「门洞里面」：暗内墙 + 地坪 + 钢轨，
//       与整栋像素重合率仅 8% ⇒ 它不是副本，是**补整栋缺掉的那块**。
//       ⇒ 本文件：壳体把门洞开成一刀真洞（洞里 0 像素）；
//                  地面层在**门洞透视范围内**画暗地坪 / 暗后墙内面 / 暗天花 + 轨道。
//
//   (3) 量法：xUSSR `depot.png` 的 槽1(SE入口) 与 槽5(NW入口,转180°) 对减，
//       「只有槽1 缺」的整块 = 列41-59 × 行31-48（约 19×18，平行四边形，
//       左边竖直、上下 2:1 斜边）⇒ 缺口贴在 **+y 那面竖墙**上。
//       另：槽1 与 槽3 左右镜像逐像素差 = 0 ⇒ 两个"开门"朝向是同一张图翻转。
//       ⇒ 本文件：门洞就开在 +y 山墙上（朝屏幕右下，正面朝 +y 是本工地的铁律）。
//
//   (4) 小块占整栋 19%（291/1532 px），官方例子那块 16×8 占 5.3%
//       ⇒ 门洞不该占满整面墙。本文件：门洞 0.36 格宽（墙长 0.72 的 50%），
//         高 0.30 格，两侧各留 0.18 的墙垛；门洞以上 0.04 是实墙 + 门楣牌。
//
//   (5) 门套 / 门楣 / 门楣牌 放在**壳体**里（车之后画）⇒ 它们会切在车前面，
//       车头被门框削一刀；小块里不放任何"应该压在车上"的东西。
//
// -----------------------------------------------------------------------------
// 【二、三个模型（wa/wb 内容相同，只为让 templates.pnml 六行不用改）】
//
//   G1_depot      壳体 → 槽 1/3/4/5 : 前山墙(门洞真洞) / 洞内壁 / 门套 / 门楣 /
//                                     后山墙 / 两侧纵墙 / 勒脚 / 屋面 / 脊瓦 / 封檐
//   G1_depot_wa   地面 → 槽 0       : 场坪 / 道砟枕木钢轨(整格) /
//   G1_depot_wb   地面 → 槽 2         门洞透视范围内的暗地坪·暗后墙内面·暗天花
//
// -----------------------------------------------------------------------------
// 【三、形体（格；1 格 = 13.9 m，4x 下 1 px = 0.089 m）】
//
//   占地 1×1 · 端头库房：+y 山墙一樘大门、−y 山墙实墙（+ 一樘高窗）
//   墙外皮    x 0.140 ~ 0.860（10.0 m）· y 0.040 ~ 0.960（12.8 m）
//   墙厚      0.050（0.70 m）
//   勒脚      0 ~ 0.045（0.63 m）`concrete_dark`
//   檐口      0.340（4.7 m）· 屋脊 0.500（7.0 m）· 出檐 0.035
//   门洞      0.320 ~ 0.680（0.36 格 = 5.0 m 宽）× 高 0.300（4.2 m，车高约 0.29）
//             门套立柱 0.020 宽、挑出墙面 0.008；门楣过梁挑出 0.012
//   侧墙      每侧 3 樘贴面窗（窗台 0.215，上沿 0.295）
//   zmax      0.5200（脊瓦顶）—— 与旧版一致，**格位必须仍是 263×184**
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { ROOT, log, rel, isMain } from './util.mjs';

// ---------------------------------------------------------------- 数值小工具
const N = (v) => {
  const s = v.toFixed(4);
  return s === '-0.0000' ? '0.0000' : s;
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.sqrt(dot(a, a));

/** Newell 法线（定绕序用，不归一化） */
function newellRaw(pts) {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

// ---------------------------------------------------------------- 尺寸表
const D = {
  // ⚠ 这四个数一起决定"取景框高度"。格位必须留在 263×184，
  //    否则 templates.pnml 里人工调的 (−131,−52) 全部要重来。
  //    实测：XL=0.130 / YB=0.030 / ZE=0.335 / OVER=0.030 会把封檐板外角顶高 1 px ⇒ 格位 185。
  XL: 0.140, XR: 0.860,          // 墙外皮 x
  YB: 0.040, YF: 0.960,          // 墙外皮 y（+y = 大门面）
  T: 0.050,                      // 墙厚（0.70 m）
  ZPL: 0.050,                    // 勒脚顶
  ZE: 0.340,                     // 檐口
  ZR: 0.500,                     // 屋脊
  OVER: 0.035,                   // 出檐
  D0: 0.320, D1: 0.680,          // 门洞 x 范围（0.36 宽 = 5.0 m）
  MID: 0.500,                    // 门洞中线：**只有一半是可通的门洞**（见下）
  ZD: 0.300,                     // 门洞高（4.2 m；车高约 0.29，净高 0.30 是硬指标）
  PW: 0.022,                     // 门套立柱宽
  PR: 0.008,                     // 门套挑出墙面
  ZW0: 0.222, ZW1: 0.282,        // 侧墙窗台 / 上沿（v82：压扁到 0.06，窗台略上移）
                                 //   顶面必须离檐口 ≥0.055：出檐 0.035 在 30° 视角下投影 ≈0.06，
                                 //   再往上就被檐口阴影带压住，看着像从屋檐下挂下来的一条。
  BW: { u0: 0.320, u1: 0.680, z0: 0.222, z1: 0.282 },   // 后墙高窗（跟着上移压扁）
  SIGN: { u0: 0.340, u1: 0.660, z0: 0.305, z1: 0.335 }, // 门楣牌
};
D.YI0 = D.YB + D.T;              // 库内净空起点（后墙内表面）

/** 侧墙贴面窗：三樘（v73 口径） */
const WIN = [[0.200, 0.340], [0.420, 0.560], [0.640, 0.780]];

// ---------------------------------------------------------------- 库内轨道
// 引轨：**只有钢轨**略微伸出门口（几个像素），道砟和枕木留在 tile 内。
//   Y_BED  道砟/枕木 → 0.9800（收进场坪边缘以内，门口外面不留灰板）
//   Y_RAIL 钢轨       → 1.0250（门外约 3 px，看着连上，又不显眼）
const Y_BED = 0.9800;
const Y_RAIL = 1.0250;
const SL_STEP = 0.0400, SL_T = 0.0200, SL_Y0 = 0.0120;

// ---------------------------------------------------------------- 轨道断面表
// 库 A 的 17 条轨道**各做一套**（人工 2026-11-19：「就是每种轨道都做一种，类似隧道那样」）。
// 数值全部从各族 `models/*_track_x.model` 的横断面**实测**（2026-11-19 量），
// 不是估计值 —— 换一条轨道就换一组数，像隧道口那样逐条接。
//
//   bed     道床 [y0, y1, zTop, 顶面材质]
//   sleeper 枕木 {y0,y1,z1, side, top}   —— 木枕 / 混凝土枕只差材质
//   rails   每根钢轨的 [y0, y1]（1/2/4 根，各族的轨距与根数都在这里）
//   rz      钢轨 [底 z, 顶 z]
const TRACK_SPECS = {
  // ---- A1：BAL-Cb 褐色道床 + SLE-1 木枕 + RAI-1 准轨 -------------------------
  SADN: { bed: [0.3080, 0.6920, 0.0055, 'roof_shingle'],
    sleeper: { y0: 0.4100, y1: 0.5900, z1: 0.0100, side: 'wood_dark', top: 'wood_seam' },
    rails: [[0.4444, 0.4524], [0.5476, 0.5556]], rz: [0.0100, 0.0230] },
  // ---- A1：BAL-C + SLE-1 + RAI-1 --------------------------------------------
  SBDN: { bed: [0.3080, 0.6920, 0.0055, 'gravel'],
    sleeper: { y0: 0.4100, y1: 0.5900, z1: 0.0100, side: 'wood_dark', top: 'wood_seam' },
    rails: [[0.4444, 0.4524], [0.5476, 0.5556]], rz: [0.0100, 0.0230] },
  SBEd: { bed: [0.3080, 0.6920, 0.0055, 'gravel'],
    sleeper: { y0: 0.4100, y1: 0.5900, z1: 0.0100, side: 'wood_dark', top: 'wood_seam' },
    rails: [[0.4444, 0.4524], [0.5476, 0.5556]], rz: [0.0100, 0.0230] },
  SBDD: { bed: [0.3080, 0.6920, 0.0055, 'gravel'],
    sleeper: { y0: 0.4100, y1: 0.5900, z1: 0.0100, side: 'wood_dark', top: 'wood_seam' },
    rails: [[0.4444, 0.4524], [0.5476, 0.5556]], rz: [0.0100, 0.0230] },
  // ---- A2：BAL-C + SLE-2 混凝土枕（带承轨槽）+ RAI-1 ------------------------
  SBDA: { bed: [0.3080, 0.6920, 0.0055, 'gravel'],
    sleeper: { y0: 0.4100, y1: 0.5900, z1: 0.0100, side: 'concrete', top: 'concrete', groove: [0.4300, 0.5700, 'trim_dark'] },
    rails: [[0.4444, 0.4524], [0.5476, 0.5556]], rz: [0.0100, 0.0230] },
  // ---- A4：BAL-B 宽砟 + SLE-1 木枕 + RAI-2 重载轨 ---------------------------
  SAEN: { bed: [0.2867, 0.7133, 0.0065, 'gravel'],
    sleeper: { y0: 0.4100, y1: 0.5900, z1: 0.0100, side: 'wood_dark', top: 'wood_seam' },
    rails: [[0.4432, 0.4536], [0.5464, 0.5568]], rz: [0.0085, 0.0230] },
  // ---- A5：BAL-B + SLE-3 新混凝土枕 + RAI-2 --------------------------------
  SBEN: { bed: [0.2867, 0.7133, 0.0065, 'gravel'],
    sleeper: { y0: 0.4050, y1: 0.5950, z1: 0.0100, side: 'concrete_mid', top: 'concrete_mid', groove: [0.4300, 0.5700, 'panel_seam'] },
    rails: [[0.4432, 0.4536], [0.5464, 0.5568]], rz: [0.0085, 0.0230] },
  SBEA: { bed: [0.2867, 0.7133, 0.0065, 'gravel'],
    sleeper: { y0: 0.4050, y1: 0.5950, z1: 0.0100, side: 'concrete_mid', top: 'concrete_mid', groove: [0.4300, 0.5700, 'panel_seam'] },
    rails: [[0.4432, 0.4536], [0.5464, 0.5568]], rz: [0.0085, 0.0230] },
  // ---- A15/A16/A17：BAL-D 窄砟 + SLE-1/2/3 + RAI-7 窄轨（1067/1000）--------
  NACN: { bed: [0.3656, 0.6344, 0.0055, 'gravel'],
    sleeper: { y0: 0.4370, y1: 0.5630, z1: 0.0100, side: 'wood_dark', top: 'wood_seam' },
    rails: [[0.4611, 0.4667], [0.5333, 0.5389]], rz: [0.0100, 0.0230] },
  NBCN: { bed: [0.3656, 0.6344, 0.0055, 'gravel'],
    sleeper: { y0: 0.4370, y1: 0.5630, z1: 0.0100, side: 'concrete', top: 'concrete', groove: [0.4510, 0.5490, 'trim_dark'] },
    rails: [[0.4611, 0.4667], [0.5333, 0.5389]], rz: [0.0100, 0.0230] },
  NBCA: { bed: [0.3656, 0.6344, 0.0055, 'gravel'],
    sleeper: { y0: 0.4370, y1: 0.5630, z1: 0.0100, side: 'concrete', top: 'concrete', groove: [0.4510, 0.5490, 'trim_dark'] },
    rails: [[0.4611, 0.4667], [0.5333, 0.5389]], rz: [0.0100, 0.0230] },
  NCCA: { bed: [0.3656, 0.6344, 0.0055, 'gravel'],
    sleeper: { y0: 0.4335, y1: 0.5665, z1: 0.0100, side: 'concrete_mid', top: 'concrete_mid', groove: [0.4510, 0.5490, 'panel_seam'] },
    rails: [[0.4611, 0.4667], [0.5333, 0.5389]], rz: [0.0100, 0.0230] },
  // ---- A18/A19/A22/A23/A24：BAL-K 加宽砟，钢轨根数各不同 --------------------
  //   dBCN = 1435 外 + 1004 内（RAI-10，四根）
  dBCN: { bed: [0.2867, 0.7133, 0.0065, 'gravel'],
    sleeper: { y0: 0.4000, y1: 0.6000, z1: 0.0100, side: 'wood_dark', top: 'wood_seam' },
    rails: [[0.4444, 0.4524], [0.4611, 0.4667], [0.5333, 0.5389], [0.5476, 0.5556]], rz: [0.0100, 0.0230] },
  //   DBDN = 1435 内 + 1520 外（RAI-5，四根）
  DBDN: { bed: [0.2867, 0.7133, 0.0065, 'gravel'],
    sleeper: { y0: 0.4000, y1: 0.6000, z1: 0.0100, side: 'wood_dark', top: 'wood_seam' },
    rails: [[0.4411, 0.4496], [0.4444, 0.4524], [0.5476, 0.5556], [0.5504, 0.5589]], rz: [0.0100, 0.0230] },
  //   DBDA = 同 DBDN，换 SLE-2 混凝土枕
  DBDA: { bed: [0.2867, 0.7133, 0.0065, 'gravel'],
    sleeper: { y0: 0.4000, y1: 0.6000, z1: 0.0100, side: 'concrete', top: 'concrete', groove: [0.4222, 0.5778, 'trim_dark'] },
    rails: [[0.4411, 0.4496], [0.4444, 0.4524], [0.5476, 0.5556], [0.5504, 0.5589]], rz: [0.0100, 0.0230] },
  //   BBDN = 纯 1520 宽轨（RAI-9，两根）
  BBDN: { bed: [0.2867, 0.7133, 0.0065, 'gravel'],
    sleeper: { y0: 0.4000, y1: 0.6000, z1: 0.0100, side: 'wood_dark', top: 'wood_seam' },
    rails: [[0.4411, 0.4496], [0.5504, 0.5589]], rz: [0.0100, 0.0230] },
  //   BBDA = 同 BBDN，换 SLE-2
  BBDA: { bed: [0.2867, 0.7133, 0.0065, 'gravel'],
    sleeper: { y0: 0.4000, y1: 0.6000, z1: 0.0100, side: 'concrete', top: 'concrete', groove: [0.4222, 0.5778, 'trim_dark'] },
    rails: [[0.4411, 0.4496], [0.5504, 0.5589]], rz: [0.0100, 0.0230] },

  // ===========================================================================
  // 库 B（≥160 km/h 的 8 条）—— 2026-11-19 同样从 `models/G*_track_x.model` 实测。
  //   与库 A 的区别不只是轨距，而是**道床类型**：有砟碎石 / 无砟板 / 高速厚砟 / 双块式。
  //   railMat 不写就是库 A 那套（侧面 rust + 顶面 metal）；现代族是 metal_dark + metal_pale。
  //   可选字段（只有库 B 用得上，库 A 全没有 ⇒ 生成结果逐字节不变）：
  //     shoulders [[x0,x1,zTop]]  砟肩（高速有砟，肩顶高于床面）
  //     joints    数             无砟板缝间隔（沿轨）
  //     blocks    {x:[[x0,x1]], z1, mat}  双块式承轨台（沿轨每 0.04 一组，跟枕木同排）
  //     railMat   ['侧面', '顶面']
  // ===========================================================================
  // ---- G3（SCDN/SCDA）：BAL-A 标准碎石 + SLE-2 U 形混凝土枕 + RAI-1 -----------
  SCDN: { bed: [0.3193, 0.6809, 0.0055, 'gravel'],
    sleeper: { y0: 0.4100, y1: 0.5900, z1: 0.0100, side: 'concrete', top: 'concrete', groove: [0.4300, 0.5700, 'trim_dark'] },
    rails: [[0.4444, 0.4524], [0.5476, 0.5556]], rz: [0.0100, 0.0230] },
  SCDA: { bed: [0.3193, 0.6809, 0.0055, 'gravel'],
    sleeper: { y0: 0.4100, y1: 0.5900, z1: 0.0100, side: 'concrete', top: 'concrete', groove: [0.4300, 0.5700, 'trim_dark'] },
    rails: [[0.4444, 0.4524], [0.5476, 0.5556]], rz: [0.0100, 0.0230] },
  // ---- G12（SDDA）：BAL-A 平断面 + SLE-3 宽枕 + RAI-3 长轨 --------------------
  SDDA: { bed: [0.3200, 0.6800, 0.0078, 'gravel'],
    sleeper: { y0: 0.4050, y1: 0.5950, z1: 0.0100, side: 'concrete_mid', top: 'concrete_mid', groove: [0.4300, 0.5700, 'panel_seam'] },
    rails: [[0.4444, 0.4524], [0.5476, 0.5556]], rz: [0.0100, 0.0230], railMat: ['metal_dark', 'metal_pale'] },
  // ---- G9（SCCA/SDCA）：BAL-E 无砟·CRTS I 单元板（板缝每 1/3 格）-------------
  SCCA: { bed: [0.3200, 0.6800, 0.0078, 'concrete_mid'], joints: 0.3333,
    sleeper: { y0: 0.4050, y1: 0.5950, z1: 0.0100, side: 'concrete_mid', top: 'concrete_mid', groove: [0.4300, 0.5700, 'panel_seam'] },
    rails: [[0.4444, 0.4524], [0.5476, 0.5556]], rz: [0.0100, 0.0230], railMat: ['metal_dark', 'metal_pale'] },
  SDCA: { bed: [0.3200, 0.6800, 0.0078, 'concrete_mid'], joints: 0.3333,
    sleeper: { y0: 0.4050, y1: 0.5950, z1: 0.0100, side: 'concrete_mid', top: 'concrete_mid', groove: [0.4300, 0.5700, 'panel_seam'] },
    rails: [[0.4444, 0.4524], [0.5476, 0.5556]], rz: [0.0100, 0.0230], railMat: ['metal_dark', 'metal_pale'] },
  // ---- G10（SECA）：BAL-N 高速有砟（砟肩堆高 0.0188 / 坡脚 0.1644）-----------
  SECA: { bed: [0.3356, 0.6644, 0.0078, 'granite_grey'],
    shoulders: [[0.3356, 0.3721, 0.0188], [0.6279, 0.6644, 0.0188]],
    sleeper: { y0: 0.4050, y1: 0.5950, z1: 0.0100, side: 'concrete_mid', top: 'concrete_mid', groove: [0.4300, 0.5700, 'panel_seam'] },
    rails: [[0.4444, 0.4524], [0.5476, 0.5556]], rz: [0.0100, 0.0230], railMat: ['metal_dark', 'metal_pale'] },
  // ---- G11（SFCA）：BAL-F 无砟·CRTS II 纵连板（横缝每 1 格）------------------
  SFCA: { bed: [0.3200, 0.6800, 0.0078, 'concrete_mid'], joints: 1.0000,
    sleeper: { y0: 0.4050, y1: 0.5950, z1: 0.0100, side: 'concrete_mid', top: 'concrete_mid', groove: [0.4300, 0.5700, 'panel_seam'] },
    rails: [[0.4444, 0.4524], [0.5476, 0.5556]], rz: [0.0100, 0.0230], railMat: ['metal_dark', 'metal_pale'] },
  // ---- G8（SGCA）：BAL-G 无砟板 + SLE-4 **双块**（无通长枕木）-----------------
  SGCA: { bed: [0.3200, 0.6800, 0.0025, 'concrete_mid'],
    blocks: { x: [[0.4284, 0.4564], [0.5436, 0.5716]], z1: 0.0175, mat: 'concrete' },
    sleeper: null,
    rails: [[0.4444, 0.4524], [0.5476, 0.5556]], rz: [0.0100, 0.0230], railMat: ['metal_dark', 'metal_pale'] },
};

/** 库 A 的 17 条（与 `美术要素方案.md` §1.7.2 的分组一致） */
const LIB_A = ['SADN', 'SBDN', 'SBDA', 'SBEd', 'SBDD', 'SAEN', 'SBEN', 'SBEA',
  'NACN', 'NBCN', 'NBCA', 'NCCA', 'dBCN', 'DBDN', 'DBDA', 'BBDN', 'BBDA'];

/** 库 B 的 8 条（≥160 km/h） */
const LIB_B = ['SCDN', 'SCDA', 'SDDA', 'SCCA', 'SDCA', 'SECA', 'SFCA', 'SGCA'];

// ★ 人工 2026-11-19：「这个最好也先做一种轨道，调好了在铺开」
//   ⇒ 库 B **先只出 `SCDN` 一种地面层**，壳体 + 库内轨道调好后，把它改成 `LIB_B` 即可铺开。
const LIB_B_DO = ['SCDN'];

/** 兼容旧口径：准轨断面（模板 `t_G1_depot_wa_v0` 那一组仍是它） */
const TR = TRACK_SPECS.SBDN;

// ---------------------------------------------------------------- 材质
const STYLES = {
  brick: { wall: 'brick_brown', roof: 'roof_slate', seam: 'roof_slate_seam', ridge: 'roof_slate_dark' },
  red: { wall: 'brick_red', roof: 'roof_slate', seam: 'roof_slate_seam', ridge: 'roof_slate_dark' },
  grey: { wall: 'brick_grey', roof: 'roof_slate', seam: 'roof_slate_seam', ridge: 'roof_slate_dark' },
};
const argOf = (k, d) => {
  const a = process.argv.find((s) => s.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const STYLE_NAME = argOf('style', 'brick');
const S = STYLES[STYLE_NAME];
if (!S) throw new Error(`未知风格「${STYLE_NAME}」，可用：${Object.keys(STYLES).join(' / ')}`);

/** 固定材质 */
const M = {
  plinth: 'concrete_dark', jamb: 'concrete',
  sign: 'sign_white', frame: 'metal_dark', glass: 'glass_dark',
  fascia: 'trim_dark', soffit: 'trim_dark',
  floor: 'trim_dark', ceil: 'trim_black', wallIn: 'trim_dark',
  ballast: 'panel_seam', sleeperA: 'wood_dark', sleeperB: 'wood_seam',
};

// ---------------------------------------------------------------- 发射器
//
// `.model` 只能是一行行字面量；这个类只负责把坐标算好、绕序摆正、数字格式化。
class Builder {
  constructor() {
    this.lines = [];
    this.quads = 0;
  }

  /** 任意四边形；`hint` 是期望朝向，反了就整体反序 */
  quad(pts, mat, hint) {
    const nn = newellRaw(pts);
    if (norm(nn) < 1e-9) throw new Error('退化面（法线为 0）：' + JSON.stringify(pts));
    const p = dot(nn, hint) < 0 ? pts.slice().reverse() : pts;
    this.lines.push('quad ' + p.map((q) => N(q[0]) + ' ' + N(q[1]) + ' ' + N(q[2])).join('  ')
      + '   ' + mat);
    this.quads++;
  }

  /** 实心盒（6 面，顶面可换材质） */
  box(x0, y0, z0, x1, y1, z1, mat, top) {
    const a = [x0, y0];
    const b = [x1, y0];
    const c = [x1, y1];
    const d = [x0, y1];
    const p = (q, z) => [q[0], q[1], z];
    this.quad([p(a, z1), p(b, z1), p(c, z1), p(d, z1)], top || mat, [0, 0, 1]);
    this.quad([p(a, z0), p(b, z0), p(c, z0), p(d, z0)], mat, [0, 0, -1]);
    this.quad([p(b, z0), p(c, z0), p(c, z1), p(b, z1)], mat, [1, 0, 0]);
    this.quad([p(c, z0), p(d, z0), p(d, z1), p(c, z1)], mat, [0, 1, 0]);
    this.quad([p(d, z0), p(a, z0), p(a, z1), p(d, z1)], mat, [-1, 0, 0]);
    this.quad([p(a, z0), p(b, z0), p(b, z1), p(a, z1)], mat, [0, -1, 0]);
  }

  /** 竖直墙面上的一块面（`side` 决定平面基，见 skill §2） */
  face(side, at, u0, u1, z0, z1, mat) {
    const hint = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0] }[side];
    const p = (u, z) => (side === '+x' || side === '-x' ? [at, u, z] : [u, at, z]);
    this.quad([p(u0, z0), p(u1, z0), p(u1, z1), p(u0, z1)], mat, hint);
  }

  /** 原样写入一行（`wall` / `win` / `gable` 这类构件关键字） */
  line(s) {
    this.lines.push(s);
  }

  text() {
    return this.lines.join('\n') + '\n';
  }
}

/**
 * 一段带勒脚的墙（勒脚 + 墙身）。
 * `holes` 是真窗洞 `[u0,z0,u1,z1]`，交给 `wall` 切成围洞的一圈实体 ——
 * 玻璃再用 `win inset=<墙厚>` 沉到洞底，才真的有"凹进去"和内壁阴影（v82）。
 */
function wallWithPlinth(b, side, at, u0, u1, holes = []) {
  b.line(`wall ${side} ${N(at)} ${N(u0)} ${N(u1)} 0.0000 ${N(D.ZPL)}  ${M.plinth} thick=${N(D.T)}`);
  const hs = holes.length
    ? '  ' + holes.map((h) => `${N(h[0])},${N(h[1])},${N(h[2])},${N(h[3])}`).join('  ')
    : '';
  b.line(`wall ${side} ${N(at)} ${N(u0)} ${N(u1)} ${N(D.ZPL)} ${N(D.ZE)}${hs}  ${S.wall} thick=${N(D.T)}`);
}

/**
 * 一樘窗：玻璃沉进真窗洞，无框无窗台。
 *
 * `inset` 是玻璃离外墙面的距离。**不能给满墙厚 0.05**：镜头俯角 30°，
 * 视线沿 (1,1,0.8165) 走，洞深 0.05 / 洞高 0.06 时，洞口上沿会把玻璃遮掉大半，
 * 只剩顶上一条 2 px 的蓝线（v82 第一次就是这么翻车的）。
 * 取 0.028 ⇒ 玻璃露出的高度约 0.042（约 6~7 px），既有洞壁阴影又不至于看不见。
 */
const WIN_INSET = 0.028;

function windowAt(b, side, at, u0, u1, z0, z1) {
  b.line(`win ${side} ${N(at)} ${N(u0)} ${N(u1)} ${N(z0)} ${N(z1)}  ${M.glass}`
    + ` frame=${M.glass} frameW=0.014 mull=2 depth=0.012 inset=${N(WIN_INSET)} sill=no`);
}

/**
 * 前端墙（+y 山墙）—— 按「会不会被车挡住」切成四块，分进两层。
 *
 *   壳体（车之后画 ⇒ 遮住车）：近侧墙垛 + **门洞上方的横槛**（含门楣牌）+ 近侧门樘/门套柱
 *   0/2 层（车之前画 ⇒ 被车遮住）：远侧墙垛 + 远侧门樘/门套柱
 *
 * v79 的两处订正（相对 v78）：
 *   ①  横槛回到壳体。v78 把远侧段整块（0→檐口）放进 0/2 层，于是门洞**上方**也变成
 *       "被车盖住"⇒ 车一过，门楣以上到檐口整片墙连屋顶一起消失（屋顶右半悬空）。
 *       「顶上的横槛」和近侧墙垛是同一堵墙的延续，必须连成一体留在壳体。
 *   ②  远侧墙垛留在 0/2 层不变（它在车外面，车要能压住它）。
 *
 * 分界仍取门洞的边 D0 / D1 ⇒ 门洞本身从不被切开。
 */
function frontGable(b, part) {
  const YF = D.YF;
  // ================= 壳体：近侧墙垛 + 门洞上方的横槛 =================
  if (part === 'nearHi' || part === 'nearLo') {
    const hi = part === 'nearHi';
    // 墙体从门洞左沿到墙端，只在门洞处开一个 0~ZD 的真洞 ⇒ 洞上方自然就是横槛
    const x0 = hi ? D.D0 : D.XL;
    const x1 = hi ? D.XR : D.D1;
    const edge = hi ? D.D1 : D.D0;            // 贴着门洞的那条边
    b.line(`wall +y ${N(YF)} ${N(x0)} ${N(x1)} 0.0000 ${N(D.ZE)}`
      + `  ${N(D.D0)},0.0000,${N(D.D1)},${N(D.ZD)}  ${S.wall} thick=${N(D.T)} reveal=no`);
    // 勒脚只贴在实墙垛那一段（门洞下面没有勒脚）
    if (hi) b.face('+y', YF + 0.002, D.D1, x1, 0.0000, D.ZPL, M.plinth);
    else b.face('+y', YF + 0.002, x0, D.D0, 0.0000, D.ZPL, M.plinth);
    // 门樘内壁 + 门套柱
    b.face(hi ? '-x' : '+x', edge, YF - D.T, YF, 0.0000, D.ZD, M.jamb);
    if (hi) b.box(edge, YF - 0.002, 0.0000, edge + D.PW, YF + D.PR, D.ZD, M.jamb);
    else b.box(edge - D.PW, YF - 0.002, 0.0000, edge, YF + D.PR, D.ZD, M.jamb);
    // 门楣牌跟着横槛走
    b.face('+y', YF + 0.003, D.SIGN.u0, D.SIGN.u1, D.SIGN.z0, D.SIGN.z1, M.sign);
    return;
  }
  // ================= 0/2 层：远侧墙垛（只有实墙，没有横槛） =================
  const hi = part === 'farHi';
  const x0 = hi ? D.D1 : D.XL;                // 实墙垛范围
  const x1 = hi ? D.XR : D.D0;
  const edge = hi ? D.D1 : D.D0;
  b.line(`wall +y ${N(YF)} ${N(x0)} ${N(x1)} 0.0000 ${N(D.ZE)}  ${S.wall} thick=${N(D.T)} reveal=no`);
  b.face('+y', YF + 0.002, x0, x1, 0.0000, D.ZPL, M.plinth);
  // 洞口这条边的内壁 + 门套柱
  b.face(hi ? '-x' : '+x', edge, YF - D.T, YF, 0.0000, D.ZD, M.jamb);
  if (hi) b.box(edge, YF - 0.002, 0.0000, edge + D.PW, YF + D.PR, D.ZD, M.jamb);
  else b.box(edge - D.PW, YF - 0.002, 0.0000, edge, YF + D.PR, D.ZD, M.jamb);
}

// =============================================================================
// 图层 A —— 地面与门洞里面（槽 0/2，画在车之前，会被列车压住）
// =============================================================================

/**
 * 库内轨道：道床（有砟）/ 道床板（无砟） + 砟肩 + 板缝 + 枕木/双块 + 钢轨。
 * **库 A / 库 B 共用一份**，只吃 `TRACK_SPECS` 里的断面表。
 */
function emitTrack(b, sp) {
  const rm = sp.railMat || ['rust', 'metal'];
  // ① 道床或道床板
  b.box(sp.bed[0], 0.0000, 0.0000, sp.bed[1], Y_BED, sp.bed[2], sp.bed[3], sp.bed[3]);
  // ② 砟肩（只有高速有砟有：肩顶比床面高，看着"更厚"）
  for (const [x0, x1, z] of sp.shoulders || []) {
    b.box(x0, 0.0000, 0.0000, x1, Y_BED, z, sp.bed[3], sp.bed[3]);
  }
  // ③ 板缝（无砟才有：沿轨一条条横缝，无砟轨道的"身份"）
  if (sp.joints) {
    for (let y = sp.joints * 0.5; y < Y_BED - 1e-9; y += sp.joints) {
      b.box(sp.bed[0] + 0.002, y - 0.0050, sp.bed[2], sp.bed[1] - 0.002, y + 0.0050,
        sp.bed[2] + 0.0006, 'panel_seam', 'panel_seam');
    }
  }
  // ④ 枕木（木枕/混凝土枕）或双块（无通长枕木，只有承轨台）
  for (let y = SL_Y0; y + SL_T <= Y_BED + 1e-9; y += SL_STEP) {
    if (sp.sleeper) {
      b.box(sp.sleeper.y0, y, 0.0000, sp.sleeper.y1, y + SL_T, sp.sleeper.z1,
        sp.sleeper.side, sp.sleeper.top);
    }
    if (sp.blocks) {
      for (const [x0, x1] of sp.blocks.x) {
        b.box(x0, y, 0.0000, x1, y + 0.0160, sp.blocks.z1, sp.blocks.mat, sp.blocks.mat);
      }
    }
  }
  // ⑤ 钢轨
  for (const [x0, x1] of sp.rails) {
    b.box(x0, 0.0000, sp.rz[0], x1, Y_RAIL, sp.rz[1], rm[0], rm[1]);
  }
}

function emitGround(b, job) {
  const sink = job.sink;
  // ① 场坪
  b.quad([[0.020, 0.020, 0.0040], [0.980, 0.020, 0.0040],
    [0.980, 0.980, 0.0040], [0.020, 0.980, 0.0040]], 'concrete_pad', [0, 0, 1]);

  // ② 库内（门洞里能看见的那一片）
  //    ⚠ 必须铺**整个库内净宽**，不能只铺门洞宽度：镜头在 +x+y，视线斜着穿门洞，
  //    能看见的库内范围比门洞宽得多（门洞 0.32~0.68，实际可见到 x≈0.25）。
  //    v78 只铺门洞宽 ⇒ 门洞左半边露出米色的场坪，像地上铺了一块白布。
  const IX0 = D.XL + D.T;
  const IX1 = D.XR - D.T;
  //    暗地坪
  b.quad([[IX0, D.YI0, 0.0046], [IX1, D.YI0, 0.0046],
    [IX1, D.YF, 0.0046], [IX0, D.YF, 0.0046]], M.floor, [0, 0, 1]);
  //    暗后墙内面（法线朝 +y，朝库内）
  b.face('+y', D.YI0 + 0.001, IX0, IX1, 0.0040, D.ZD, M.wallIn);
  //    暗天花（法线朝下）
  b.quad([[IX0, D.YI0, D.ZD], [IX0, D.YF, D.ZD],
    [IX1, D.YF, D.ZD], [IX1, D.YI0, D.ZD]], M.ceil, [0, 0, -1]);
  // ★ 远侧纵墙的**库内内表面**（v79 新增）
  //    镜头在 +x+y，透门洞往里看，能看见的只有远离镜头那面纵墙的内皮；
  //    它在列车的**后面**，所以要留在 0/2 层让车把它压住 —— 放在壳体里就会反压车。
  //    近侧纵墙的内皮永远背对镜头 ⇒ 不必下沉。
  const inSide = sink === '+x' ? '-x' : '+x';
  const inAt = sink === '+x' ? D.XR - D.T - 0.001 : D.XL + D.T + 0.001;
  b.face(inSide, inAt, D.YI0, D.YF, 0.0000, D.ZE, M.wallIn);

  // ③ 道砟 + 枕木 + 钢轨 —— **按本条轨道的断面表画**（每条各不相同）
  emitTrack(b, TRACK_SPECS[job.spec] || TR);

  // ④ 前端墙的**远侧墙垛**（被车遮住 ⇒ 和地面同层）
  frontGable(b, job.front);
}

// =============================================================================
// 图层 B —— 壳体（槽 1/3/4/5，画在车之后；门洞里一个像素都不许有）
// =============================================================================
function emitShell(b, job) {
  const sink = job.sink;
  // 前端墙的**近侧墙垛 + 横槛**画在这里（车之后画 ⇒ 遮住车）；远侧墙垛在 0/2 层。
  frontGable(b, job.front);

  // ---------------------------------------------------------------- 后山墙（−y）
  wallWithPlinth(b, '-y', D.YB, D.XL, D.XR, [[D.BW.u0, D.BW.z0, D.BW.u1, D.BW.z1]]);
  windowAt(b, '-y', D.YB - 0.001, D.BW.u0, D.BW.u1, D.BW.z0, D.BW.z1);

  // ---------------------------------------------------------------- 两侧纵墙
  const sideHoles = WIN.map(([u0, u1]) => [u0, D.ZW0, u1, D.ZW1]);
  for (const side of ['+x', '-x']) {
    const at = side === '+x' ? D.XR : D.XL;
    const off = side === '+x' ? 0.001 : -0.001;
    if (side === sink) {
      // 远侧纵墙：内皮已下沉到 0/2 层（否则会反压列车）。
      // 这里只留一块单面外皮 + 勒脚 + 贴面窗，**不能**用 wall+thick（那会再生成一层内皮）。
      b.face(side, at, D.YB, D.YF, 0.0000, D.ZPL, M.plinth);
      b.face(side, at, D.YB, D.YF, D.ZPL, D.ZE, S.wall);
      for (const [u0, u1] of WIN) windowAt(b, side, at + off, u0, u1, D.ZW0, D.ZW1);
      continue;
    }
    wallWithPlinth(b, side, at, D.YB, D.YF, sideHoles);
    for (const [u0, u1] of WIN) windowAt(b, side, at + off, u0, u1, D.ZW0, D.ZW1);
  }

  // ---------------------------------------------------------------- 屋面
  b.line(`gable ${N(D.XL)} ${N(D.YB)} ${N(D.XR)} ${N(D.YF)} ${N(D.ZE)} ${N(D.ZR)}`
    + ` y ${N(D.OVER)}  ${S.roof} side=${S.wall} bottom=${M.soffit}`
    + ` tileRows=6 tileCols=16 tileW=0.009 tileMat=${S.seam}`);
  // 脊瓦
  b.box(0.478, D.YB, D.ZR - 0.014, 0.522, D.YF, D.ZR + 0.016, S.ridge, S.ridge);
  // 封檐板（沿 y 两条）
  for (const [x, d] of [[D.XL - D.OVER, -1], [D.XR + D.OVER, 1]]) {
    b.box(d < 0 ? x - 0.006 : x, D.YB - D.OVER, D.ZE - 0.012,
      d < 0 ? x : x + 0.006, D.YF + D.OVER, D.ZE + 0.010, M.fascia);
  }
}

// =============================================================================
// 模型清单
// ⚠ 名字必须以 `G1_depot` 开头（`tools/sheets.mjs` 用 /^G1_depot/ 分表）
// ⚠ 三个模型 zmax 都钉 0.5200 ⇒ 同格位 263×184 ⇒ templates.pnml 六行 (−131,−52) 不用改
// =============================================================================
// ⚠ "远端一半"逐朝向翻转：同一份壳体模型没法在 v0 和 v3 都让远侧是洞
//   ⇒ 两个壳体模型（互为 x 镜像）+ 两个地面模型，一共 16 张，正好 8×2 一张表。
//
//   `sink` = 哪一面纵墙是「远离镜头」那面（它的内皮要下沉到 0/2 层）。
//     v0 / v1 朝向：深度 = x + y（或 1−y+x）⇒ x 小那面（−x）远
//     v2 / v3 朝向：深度 = 2−x−y（或 1−x+y）⇒ x 大那面（+x）远
const JOBS = [
  { name: 'G1_depot', layer: 'shell', front: 'nearHi', sink: '-x',
    why: '壳体：后山墙/近侧纵墙/屋面 + 前端墙近侧墙垛与横槛（遮车）→ 槽 1/4' },
  { name: 'G1_depot_wa', layer: 'ground', front: 'farLo', sink: '-x', spec: 'SBDN',
    why: '地面+轨道+库内+远侧纵墙内皮+前端墙远侧墙垛（被车遮）→ 槽 0' },
  { name: 'G1_depot_wb', layer: 'ground', front: 'farHi', sink: '+x', spec: 'SBDN',
    why: '同上，镜像 → 槽 2' },
  { name: 'G1_depot_x', layer: 'shell', front: 'nearLo', sink: '+x',
    why: '壳体，镜像（近侧墙垛在 x 小那头）→ 槽 3/5' },
];

// ---------------------------------------------------------------------------
// 库 A 的 17 条：**每条一套地面层**（人工 2026-11-19：「就是每种轨道都做一种，类似隧道那样」）。
//   命名 `G1_depot_z_<label>_se|sw`：前缀 `z` 保证字母序排在 `G1_depot_x` **之后**
//   ⇒ 图集前两行（原 4 个模型 16 格）位置不变 ⇒ `templates.pnml` 那六行不用动。
//   `_se` = 槽 0 那版（近侧墙垛在 x 大端）· `_sw` = 槽 2 那版（镜像）。
//   壳体（4 张）17 条共用，不重复出。
// ---------------------------------------------------------------------------
for (const label of LIB_A) {
  JOBS.push({
    name: `G1_depot_z_${label}_se`, layer: 'ground', front: 'farLo', sink: '-x', spec: label,
    why: `SE 入口地面层 · ${label} 的库内轨道（${TRACK_SPECS[label].rails.length} 轨）`,
  });
  JOBS.push({
    name: `G1_depot_z_${label}_sw`, layer: 'ground', front: 'farHi', sink: '+x', spec: label,
    why: `SW 入口地面层（镜像）· ${label} 的库内轨道（${TRACK_SPECS[label].rails.length} 轨）`,
  });
}

// =============================================================================
// 库 B —— 「现代动车段」（彩钢 · 低坡 · 卷帘门）        `美术要素方案.md` §1.7.3
//
//   人工 2026-11-19：「这个最好也先做一种轨道，调好了在铺开」
//   ⇒ 先只出 `SCDN` 一条（`LIB_B_DO`），壳体 + 库内轨道核过之后再铺满 8 条。
//
//   尺寸（格；1 格 = 13.9 m，4x 下 1 px = 0.089 m）
//     勒脚   granite_grey  0 → 0.045
//     墙身   tile_grey    0.045 → 0.380（+ 彩钢板竖缝 courses，窗带上下各一段）
//     腰带   trim_blue    0.300 → 0.320 一圈
//     檐口板 metal_dark   0.360 → 0.380 一圈
//     檐口 0.376 · 屋脊 0.460（坡 1:4.3 ≈ 低坡 1:5）· **平檐口不出檐**（见 DB 里那段说明）
//     门洞 0.38 宽（0.310 ~ 0.690）× 0.32 高 —— 比库 A 宽 0.02、高 0.02
//     卷帘门：门洞顶上那个"筒"（滚起来的帘）+ 两侧导轨
//     门头带：采光带（玻璃）+ 上下唇，**兼作雨篷**（挑出 0.022）
//     招牌 sign_cn_red 0.30 × 0.026（红底白字「动车段」，4x 才认得出字）
//     侧墙通长窗带 0.230~0.290（铝合金框 + 镀膜玻璃，12 根竖梃）
//
//   ⚠ 命名带 `zz`：字母序排在 `G1_depot_z_*`（库 A 的地面层）**之后**
//     ⇒ 图集前 19 行一格不动 ⇒ templates.pnml 里已有的 40 行 rect 不用改。
//   ⚠ `zmax` 仍钉 0.5200（实际最高点 0.460）⇒ 格位仍 263×184、锚点不变
//     ⇒ 六个槽的「逐朝向偏移」与库 A 逐槽同一套值，不用重调。
// =============================================================================
const DB = {
  XL: 0.140, XR: 0.860,          // 墙外皮 x（与库 A 同宽 0.72）
  YB: 0.040, YF: 0.960,          // 墙外皮 y（同深 0.92）
  T: 0.050,                      // 墙厚
  ZPL: 0.045,                    // 勒脚顶
  ZB0: 0.300, ZB1: 0.320,        // 蓝腰带（门口断开；门楣 0.320 正好压在腰带顶上）
  ZW: 0.360,                     // 墙身顶＝彩钢板竖缝上端
  ZF0: 0.368, ZF1: 0.376,        // 檐口板（metal_dark 一圈）
  // ★ 人工 2026-11-19：「把库 B 压矮，塞进 184 的框」
  //   檐口 0.376（原方案 0.380）+ **不出檐**（彩钢板建筑的平檐口）
  //   ⇒ 取景框上沿不再超过库 A 那条"檐口板外角"线 ⇒ 格位仍是 263×184、
  //     锚点不变 ⇒ 六个槽的 xrel/yrel 与库 A 逐槽同一套值。
  ZE: 0.376,                     // 檐口
  ZR: 0.460,                     // 屋脊（低坡 1:4.3）
  OVER: 0.000,                   // 出檐（0 = 平檐口；给了就会把格位顶高）
  D0: 0.310, D1: 0.690,          // 门洞 x 范围（0.38 宽）
  ZD: 0.320,                     // 门洞高
  // 卷帘箱：门洞正上方那个盒子，挂在**外皮**上（洞内不放 —— 放了就成了两个箱子）
  DRUM: { z0: 0.3200, z1: 0.3400, out: 0.020 },
  GUIDE: { w: 0.016, out: 0.012 },              // 卷帘门两侧导轨
  SIGN: { u0: 0.350, u1: 0.650, z0: 0.3400, z1: 0.3680 },
  WINW: { u0: 0.100, u1: 0.900, z0: 0.230, z1: 0.290 },   // 侧墙通长窗带
  WINB: { u0: 0.240, u1: 0.760, z0: 0.240, z1: 0.300 },   // 后山墙窗带
  PIPE: 0.026,                                   // 雨水管离墙角
};
DB.YI0 = DB.YB + DB.T;

const MB = {
  plinth: 'granite_grey',
  // 人工 2026-11-19：「能把外墙弄得更白一些，然后有金属光泽吗」
  //
  //   ① 白：tile_grey(198,195,188) → **trim_white(240,237,230)**。
  //      比 tile_white(228) 再白一档，而且要的是它 **颗粒 0** 的属性 ——
  //      tile_* 族有 ±3.8% 颗粒，4x 下整片墙看起来像砂岩/瓷砖；
  //      金属漆面是**光洁**的，所以宁可要"没有颗粒"也不要"更白但有颗粒"。
  //   ② 金属：flatiso 的 `spec` 是 `pow(N·H, 26)`，只有法线贴着半角向量的面才吃到，
  //      **平面墙永远是 0**（实测：加了也不亮）。所以墙面能做的只有三件：
  //        a. 光洁无颗粒（上面那条）
  //        b. **冷灰硬缝**（metal_seam 122,127,132）代替同色系缝 → 像压型板的折边阴影
  //        c. 缝边再画一条**冷金属棱**（metal_pale 190,195,199）→ 明暗成对
  //      真高光得把墙做成**有棱面的压型板**（法线 ±15° 才吃 spec），那是下一轮的事。
  wall: 'trim_white', seam: 'metal_seam', ribHi: 'metal_pale',
  band: 'trim_blue', fascia: 'metal',
  roof: 'roof_metal', rib: 'metal_rib', ridge: 'metal',
  metal: 'metal', metalLite: 'metal_pale', metalDark: 'metal_dark',
  glass: 'glass_blue', sign: 'sign_cn_red',
  floor: 'trim_dark', ceil: 'trim_black', wallIn: 'trim_dark',
};

/** 库 B 的墙：勒脚 + 墙身（一直做到檐口，中间不留空档） */
function wallB(b, side, at, u0, u1, holes = []) {
  b.line(`wall ${side} ${N(at)} ${N(u0)} ${N(u1)} 0.0000 ${N(DB.ZPL)}  ${MB.plinth} thick=${N(DB.T)}`);
  const hs = holes.length
    ? '  ' + holes.map((h) => `${N(h[0])},${N(h[1])},${N(h[2])},${N(h[3])}`).join('  ')
    : '';
  b.line(`wall ${side} ${N(at)} ${N(u0)} ${N(u1)} ${N(DB.ZPL)} ${N(DB.ZE)}${hs}  ${MB.wall} thick=${N(DB.T)}`);
}

/** 蓝腰带 + 檐口板：贴在外皮上的两条通长色带（无厚度，只是面） */
function bandsB(b, side, at, u0, u1) {
  const out = side === '+x' || side === '+y' ? 0.0015 : -0.0015;
  b.face(side, at + out, u0, u1, DB.ZB0, DB.ZB1, MB.band);
  b.face(side, at + out, u0, u1, DB.ZF0, DB.ZF1, MB.fascia);
}

/**
 * 彩钢板竖缝：**一条暗缝 + 一条亮棱**（成对出现才是"压型钢板"，单靠暗缝像贴砖）
 *
 *   courses 的分缝位置 = u0 + i·(u1−u0)/n（只画内部 n−1 条），
 *   所以把**两个端点同时平移** 0.012，整组缝就整体平移 —— 不用逐条算。
 *   亮棱用 `trim_white`（240，颗粒 0，光洁），暗缝用 `metal_seam`（122，冷灰），
 *   两者中心距 0.012 ⇒ 4x 下"1 px 亮 + 1 px 暗"紧挨着，就是一道受光的棱。
 *   只画在实墙上（窗带上下各一段，绝不跨窗）。
 */
function seamsB(b, side, at, u0, u1) {
  const out = side === '+x' || side === '+y' ? 0.0015 : -0.0015;
  const A = at + out;
  for (const [z0, z1] of [[DB.ZPL, DB.WINW.z0], [DB.WINW.z1, DB.ZW]]) {
    b.line(`courses ${side} ${N(A)} ${N(u0)} ${N(u1)} ${N(z0)} ${N(z1)} 1 8  ${MB.seam} w=0.008`);
    b.line(`courses ${side} ${N(A)} ${N(u0 + 0.012)} ${N(u1 + 0.012)}`
      + ` ${N(z0)} ${N(z1)} 1 8  ${MB.ribHi} w=0.006`);
  }
}

/**
 * 通长窗带。`inset` 不能给满墙厚 —— 与库 A 同一个坑（30° 视线下洞沿会吃掉玻璃），
 * 取 0.028：玻璃露出的高度约 0.042。
 */
const WIN_INSET_B = 0.028;
function windowB(b, side, at, u0, u1, z0, z1, mull) {
  b.line(`win ${side} ${N(at)} ${N(u0)} ${N(u1)} ${N(z0)} ${N(z1)}  ${MB.glass}`
    + ` frame=${MB.metal} frameW=0.010 mull=${mull} mullW=0.006 depth=0.012`
    + ` inset=${N(WIN_INSET_B)} sill=no`);
}

/**
 * 库 B 的前端墙（+y 山墙）—— 与库 A 同一刀：**会不会被车挡住**。
 *   壳体（车之后画）：近侧墙垛 + 门洞上方横槛 + 卷帘筒 + 门头带 + 招牌 + 本侧导轨/雨水管
 *   0/2 层（车之前画）：远侧墙垛 + 本侧导轨/雨水管
 */
function frontGableB(b, part) {
  const YF = DB.YF;
  const near = part === 'nearHi' || part === 'nearLo';
  const hi = part === 'nearHi' || part === 'farHi';   // 墙垛在门洞"x 大"那一侧
  const x0 = hi ? (near ? DB.D0 : DB.D1) : DB.XL;
  const x1 = hi ? DB.XR : (near ? DB.D1 : DB.D0);
  const hole = near ? `  ${N(DB.D0)},0.0000,${N(DB.D1)},${N(DB.ZD)}` : '';
  b.line(`wall +y ${N(YF)} ${N(x0)} ${N(x1)} 0.0000 ${N(DB.ZE)}${hole}`
    + `  ${MB.wall} thick=${N(DB.T)} reveal=no`);
  // 实墙垛那一段（门洞下面的勒脚、腰带都只贴这一段）
  const s0 = near ? (hi ? DB.D1 : x0) : x0;
  const s1 = near ? (hi ? x1 : DB.D0) : x1;
  b.face('+y', YF + 0.002, s0, s1, 0.0000, DB.ZPL, MB.plinth);
  // 蓝腰带：**在门口断开**（门楣正好落在腰带顶 0.320 上，腰带"收在门头"）
  b.face('+y', YF + 0.0015, s0, s1, DB.ZB0, DB.ZB1, MB.band);
  // 檐口板：整半幅通长
  b.face('+y', YF + 0.0015, x0, x1, DB.ZF0, DB.ZF1, MB.fascia);
  // 竖缝 + 亮棱：只贴实墙垛（门洞两侧那两块），不跨门洞
  b.line(`courses +y ${N(YF + 0.0015)} ${N(s0)} ${N(s1)}`
    + ` ${N(DB.ZPL)} ${N(DB.ZE)} 1 2  ${MB.seam} w=0.008`);
  b.line(`courses +y ${N(YF + 0.0015)} ${N(s0 + 0.012)} ${N(s1 + 0.012)}`
    + ` ${N(DB.ZPL)} ${N(DB.ZE)} 1 2  ${MB.ribHi} w=0.006`);
  // 洞口那一条的门樘内壁（墙厚方向）
  b.face(hi ? '-x' : '+x', hi ? DB.D1 : DB.D0, YF - DB.T, YF, 0.0000, DB.ZD, MB.metal);
  // 卷帘门导轨（本半幅那一根）
  if (hi) {
    b.box(DB.D1, YF - 0.002, 0.0000, DB.D1 + DB.GUIDE.w, YF + DB.GUIDE.out, DB.ZD, MB.metal);
  } else {
    b.box(DB.D0 - DB.GUIDE.w, YF - 0.002, 0.0000, DB.D0, YF + DB.GUIDE.out, DB.ZD, MB.metal);
  }
  // 卷帘箱：门洞正上方那个盒子，只出一次（近半幅；它正好在门宽之内）
  if (near) {
    b.box(DB.D0, YF - 0.002, DB.DRUM.z0, DB.D1, YF + DB.DRUM.out, DB.DRUM.z1,
      MB.metal, MB.metalLite);
  }
  // 招牌（跨门洞，两半各画本半幅；实际只会有近半幅那次落在门里）
  const sx0 = Math.max(DB.SIGN.u0, x0);
  const sx1 = Math.min(DB.SIGN.u1, x1);
  if (sx1 > sx0 + 1e-9) b.face('+y', YF + 0.003, sx0, sx1, DB.SIGN.z0, DB.SIGN.z1, MB.sign);
  // 墙角雨水管（本半幅那一根）
  for (const px of [DB.XL + DB.PIPE, DB.XR - DB.PIPE]) {
    if (px < x0 - 1e-9 || px > x1 + 1e-9) continue;
    b.box(px - 0.006, YF - 0.002, 0.0000, px + 0.006, YF + 0.012, DB.ZE, MB.metal, MB.metalLite);
  }
}

/** 库 B 地面层（槽 0/2）：场坪 + 库内 + 库内轨道 + 前端墙远侧墙垛 */
function emitGroundB(b, job) {
  const sink = job.sink;
  // ① 场坪
  b.quad([[0.020, 0.020, 0.0040], [0.980, 0.020, 0.0040],
    [0.980, 0.980, 0.0040], [0.020, 0.980, 0.0040]], 'concrete_pad', [0, 0, 1]);
  // ② 库内（暗）
  const IX0 = DB.XL + DB.T;
  const IX1 = DB.XR - DB.T;
  b.quad([[IX0, DB.YI0, 0.0046], [IX1, DB.YI0, 0.0046],
    [IX1, DB.YF, 0.0046], [IX0, DB.YF, 0.0046]], MB.floor, [0, 0, 1]);
  b.face('+y', DB.YI0 + 0.001, IX0, IX1, 0.0040, DB.ZD, MB.wallIn);
  b.quad([[IX0, DB.YI0, DB.ZD], [IX0, DB.YF, DB.ZD],
    [IX1, DB.YF, DB.ZD], [IX1, DB.YI0, DB.ZD]], MB.ceil, [0, 0, -1]);
  const inSide = sink === '+x' ? '-x' : '+x';
  const inAt = sink === '+x' ? DB.XR - DB.T - 0.001 : DB.XL + DB.T + 0.001;
  b.face(inSide, inAt, DB.YI0, DB.YF, 0.0000, DB.ZE, MB.wallIn);
  // ③ 库内轨道
  emitTrack(b, TRACK_SPECS[job.spec] || TR);
  // ④ 前端墙的远侧墙垛
  frontGableB(b, job.front);
}

/** 库 B 壳体（槽 1/3/4/5）：墙 + 屋面 + 门头，门洞里一个像素都不留 */
function emitShellB(b, job) {
  const sink = job.sink;
  frontGableB(b, job.front);

  // 后山墙（−y）
  wallB(b, '-y', DB.YB, DB.XL, DB.XR, [[DB.WINB.u0, DB.WINB.z0, DB.WINB.u1, DB.WINB.z1]]);
  windowB(b, '-y', DB.YB - 0.001, DB.WINB.u0, DB.WINB.u1, DB.WINB.z0, DB.WINB.z1, 4);
  bandsB(b, '-y', DB.YB, DB.XL, DB.XR);

  // 两侧纵墙
  for (const side of ['+x', '-x']) {
    const at = side === '+x' ? DB.XR : DB.XL;
    const off = side === '+x' ? 0.001 : -0.001;
    if (side === sink) {
      // 远侧纵墙：内皮已经在 0/2 层（否则会反压列车）⇒ 这里只留一块单面外皮
      b.face(side, at, DB.YB, DB.YF, 0.0000, DB.ZPL, MB.plinth);
      b.face(side, at, DB.YB, DB.YF, DB.ZPL, DB.ZE, MB.wall);
      windowB(b, side, at + off, DB.WINW.u0, DB.WINW.u1, DB.WINW.z0, DB.WINW.z1, 12);
      bandsB(b, side, at, DB.YB, DB.YF);
      seamsB(b, side, at, DB.YB, DB.YF);
      continue;
    }
    wallB(b, side, at, DB.YB, DB.YF, [[DB.WINW.u0, DB.WINW.z0, DB.WINW.u1, DB.WINW.z1]]);
    windowB(b, side, at + off, DB.WINW.u0, DB.WINW.u1, DB.WINW.z0, DB.WINW.z1, 12);
    bandsB(b, side, at, DB.YB, DB.YF);
    seamsB(b, side, at, DB.YB, DB.YF);
  }

  // 屋面：低坡 + 沿坡向板肋（**不出檐** —— 见 DB.ZE 那段注释）
  b.line(`gable ${N(DB.XL)} ${N(DB.YB)} ${N(DB.XR)} ${N(DB.YF)} ${N(DB.ZE)} ${N(DB.ZR)}`
    + ` y ${N(DB.OVER)}  ${MB.roof} side=${MB.wall} bottom=${MB.fascia}`
    + ` tileRows=1 tileCols=22 tileW=0.008 tileMat=${MB.rib} tileStagger=0`);
  // 脊瓦
  b.box(0.484, DB.YB, DB.ZR - 0.010, 0.516, DB.YF, DB.ZR + 0.010, MB.ridge, MB.metalLite);
}

// 库 B 的模型清单（2 个壳体 + 每条轨道 2 个地面层）
const JOBS_B = [
  { lib: 'B', name: 'G1_depot_zz', layer: 'shell', front: 'nearHi', sink: '-x',
    why: '库 B 壳体（槽 1/4）：彩钢板墙 + 低坡金属屋面 + 卷帘门 + 门头带 + 招牌' },
  { lib: 'B', name: 'G1_depot_zz_x', layer: 'shell', front: 'nearLo', sink: '+x',
    why: '库 B 壳体镜像（槽 3/5）' },
];
for (const label of LIB_B_DO) {
  JOBS_B.push({
    lib: 'B', name: `G1_depot_zz_${label}_se`, layer: 'ground', front: 'farLo', sink: '-x', spec: label,
    why: `库 B SE 地面层 · ${label} 的库内轨道`,
  });
  JOBS_B.push({
    lib: 'B', name: `G1_depot_zz_${label}_sw`, layer: 'ground', front: 'farHi', sink: '+x', spec: label,
    why: `库 B SW 地面层（镜像）· ${label} 的库内轨道`,
  });
}

const headerA = (job) => `# =============================================================================
# ${job.name} —— 机车库「库 A」（${job.why}）
#
# 【本文件由 tools/gen-g1-depot.mjs 生成，请勿手改】风格：${STYLE_NAME}
#
#   图层：库内(0/2) → 列车 → 壳体(1/3/4/5)
#     壳体 = 墙/屋面/门樘/门楣（门洞是真洞，洞里 0 像素）
#     地面 = 场坪 + 道砟枕木钢轨 + 门洞透视范围内的暗地坪/暗后墙内面/暗天花
#
#   占地 1×1 · 墙皮 x ${N(D.XL)}~${N(D.XR)} × y ${N(D.YB)}~${N(D.YF)} · 墙厚 ${N(D.T)}
#   勒脚 ${N(D.ZPL)} · 檐口 ${N(D.ZE)} · 屋脊 ${N(D.ZR)} · 出檐 ${N(D.OVER)}
#   门洞 x ${N(D.D0)}~${N(D.D1)} × 高 ${N(D.ZD)} · 门套 ${N(D.PW)} 宽 / 挑出 ${N(D.PR)}
#   库内轨道：${job.spec ? `${job.spec} —— 道砟 ${N(TRACK_SPECS[job.spec].bed[0])}~${N(TRACK_SPECS[job.spec].bed[1])}`
    + ` · 轨 ${TRACK_SPECS[job.spec].rails.length} 根 · 枕 ${TRACK_SPECS[job.spec].sleeper.top}`
    : `准轨 · 轨 ${TR.rails.length} 根`}
# =============================================================================

`;

// ---------------------------------------------------------------------------
// 库 B 的文件头
// ---------------------------------------------------------------------------
const headerB = (job) => {
  const sp = job.spec ? TRACK_SPECS[job.spec] : null;
  const bedKind = !SP_IS_SLAB(sp) ? '有砟道床' : '无砟道床板';
  const sleeperText = sp
    ? (sp.sleeper ? `枕木 ${sp.sleeper.top}` : `双块式承轨台（无通长枕木）`)
    : '—';
  return `# =============================================================================
# ${job.name} —— 机车库「库 B」（${job.why}）
#
# 【本文件由 tools/gen-g1-depot.mjs 生成，请勿手改】
#
#   图层：库内(0/2) → 列车 → 壳体(1/3/4/5)
#     壳体 = 墙/屋面/卷帘门/门头带/招牌（门洞是真洞，洞里 0 像素）
#     地面 = 场坪 + 道床枕木钢轨 + 门洞透视范围内的暗地坪/暗后墙内面/暗天花
#
#   占地 1×1 · 墙皮 x ${N(DB.XL)}~${N(DB.XR)} × y ${N(DB.YB)}~${N(DB.YF)} · 墙厚 ${N(DB.T)}
#   勒脚 ${N(DB.ZPL)} · 蓝腰带 ${N(DB.ZB0)}~${N(DB.ZB1)} · 檐口板 ${N(DB.ZW)}~${N(DB.ZE)}
#   檐口 ${N(DB.ZE)} · 屋脊 ${N(DB.ZR)}（低坡 1:4.5）· 出檐 ${N(DB.OVER)}
#   门洞 x ${N(DB.D0)}~${N(DB.D1)} × 高 ${N(DB.ZD)}（真洞，卷帘卷在洞顶）
#   库内轨道：${job.spec
    ? `${job.spec} —— ${bedKind} ${N(sp.bed[0])}~${N(sp.bed[1])} 顶面 ${N(sp.bed[2])}`
      + ` · 轨 ${sp.rails.length} 根 · ${sleeperText}`
    : '—（壳体不含轨道）'}
# =============================================================================

`;
};

/** 无砟？只有库 B 的可选字段能表达（有砟一定没有 joints / blocks） */
function SP_IS_SLAB(sp) {
  return !!(sp && (sp.joints || sp.blocks));
}

const headerOf = (job) => (job.lib === 'B' ? headerB(job) : headerA(job));

export function generateDepots() {
  const made = [];
  for (const job of [...JOBS, ...JOBS_B]) {
    const b = new Builder();
    if (job.lib === 'B') {
      if (job.layer === 'shell') emitShellB(b, job);
      else emitGroundB(b, job);
    } else if (job.layer === 'shell') {
      emitShell(b, job);
    } else {
      emitGround(b, job);
    }
    const text = headerOf(job)
      + `name      ${job.name}\n`
      + 'group     misc\n'
      + 'footprint 1 1\n'
      + 'zmax      0.5200\n\n'
      + b.text();
    const f = path.join(ROOT, 'models', job.name + '.model');
    fs.writeFileSync(f, text, 'utf8');
    made.push({ name: job.name, quads: b.quads, lines: text.split('\n').length });
    log('  ✔ ' + rel(f).padEnd(46) + String(b.quads).padStart(4) + ' 面   '
      + String(text.split('\n').length).padStart(4) + ' 行');
  }
  return made;
}

if (isMain(import.meta.url)) {
  log('生成机车库「库 A」（风格 ' + STYLE_NAME + '）+ 库 B（先只出 ' + LIB_B_DO.join(' / ') + '）：');
  const made = generateDepots();
  const tot = made.reduce((s, m) => s + m.quads, 0);
  log('');
  log('  合计 ' + made.length + ' 个模型 / ' + tot + ' 个四边形面');
  log('  下一步：node tools/build.mjs --step render → node tools/check.mjs');
}
