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
  ZW0: 0.215, ZW1: 0.295,        // 侧墙窗台 / 上沿
  BW: { u0: 0.320, u1: 0.680, z0: 0.215, z1: 0.295 },   // 后墙高窗
  SIGN: { u0: 0.340, u1: 0.660, z0: 0.305, z1: 0.335 }, // 门楣牌
};
D.YI0 = D.YB + D.T;              // 库内净空起点（后墙内表面）

/** 侧墙贴面窗：三樘（v73 口径） */
const WIN = [[0.200, 0.340], [0.420, 0.560], [0.640, 0.780]];

// ---------------------------------------------------------------- 库内轨道
// 口径照抄 `models/G1_rail_straight.model`：轨 x 0.4444~0.4524 / 0.5476~0.5556，
// z 0.010~0.023，贯穿 y 0~1；砟顶 0.0078；枕木 0.012 起、步距 0.040。
const TR = {
  B0: 0.320, B1: 0.680,
  BED: 0.0078,
  SL_TOP: 0.0100, SL_STEP: 0.0400, SL_HALF: 0.0900, SL_T: 0.0200,
  SL_Y0: 0.0120, SL_Y1: 0.9880,
  RAIL_BASE: 0.0100, RAIL_TOP: 0.0230,
  RAIL_X: [[0.4444, 0.4524], [0.5476, 0.5556]],
};

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

/** 一段带勒脚的墙（勒脚 + 墙身，都不挖洞；窗是贴面窗） */
function wallWithPlinth(b, side, at, u0, u1) {
  b.line(`wall ${side} ${N(at)} ${N(u0)} ${N(u1)} 0.0000 ${N(D.ZPL)}  ${M.plinth} thick=${N(D.T)}`);
  b.line(`wall ${side} ${N(at)} ${N(u0)} ${N(u1)} ${N(D.ZPL)} ${N(D.ZE)}  ${S.wall} thick=${N(D.T)}`);
}

/** 一樘贴面窗 */
function windowAt(b, side, at, u0, u1, z0, z1) {
  b.line(`win ${side} ${N(at)} ${N(u0)} ${N(u1)} ${N(z0)} ${N(z1)}  ${M.glass}`
    + ` frame=${M.frame} frameW=0.014 mull=2 depth=0.010 inset=0 sill=${M.frame}`);
}

/**
 * 前端墙（+y 山墙）—— **画在 0/2 层（车之前）**。
 *
 * 依据 docs/建模经验.md §4.52：这块端墙会被车挡住，所以它和地面、轨道同层；
 * 壳体（车之后画）里**整块不画**，挖掉范围与这里严丝合缝（同一份代码生成）。
 */
function frontGable(b) {
  // 墙身 + 一刀真门洞（reveal=no 免得补出"洞下沿"那条假门槛）
  b.line(`wall +y ${N(D.YF)} ${N(D.XL)} ${N(D.XR)} 0.0000 ${N(D.ZE)}`
    + `  ${N(D.D0)},0.0000,${N(D.D1)},${N(D.ZD)}  ${S.wall} thick=${N(D.T)} reveal=no`);
  // 勒脚贴面（门洞两侧）
  for (const [u0, u1] of [[D.XL, D.D0], [D.D1, D.XR]]) {
    b.face('+y', D.YF + 0.002, u0, u1, 0.0000, D.ZPL, M.plinth);
  }
  // 门洞两侧内壁（进深 = 墙厚）
  b.face('+x', D.D0, D.YF - D.T, D.YF, 0.0000, D.ZD, M.jamb);
  b.face('-x', D.D1, D.YF - D.T, D.YF, 0.0000, D.ZD, M.jamb);
  // 门套立柱（挑出墙面）
  b.box(D.D0 - D.PW, D.YF - 0.002, 0.0000, D.D0, D.YF + D.PR, D.ZD, M.jamb);
  b.box(D.D1, D.YF - 0.002, 0.0000, D.D1 + D.PW, D.YF + D.PR, D.ZD, M.jamb);
  // 门楣牌
  b.face('+y', D.YF + 0.003, D.SIGN.u0, D.SIGN.u1, D.SIGN.z0, D.SIGN.z1, M.sign);
}

// =============================================================================
// 图层 A —— 地面与门洞里面（槽 0/2，画在车之前，会被列车压住）
// =============================================================================
function emitGround(b, inner) {
  const [IX0, IX1] = inner;
  // ① 场坪
  b.quad([[0.020, 0.020, 0.0040], [0.980, 0.020, 0.0040],
    [0.980, 0.980, 0.0040], [0.020, 0.980, 0.0040]], 'concrete_pad', [0, 0, 1]);

  // ② 门洞里能看见的三块暗面 —— 这就是 xUSSR 那 24×25 小块的内容
  //    只画门洞宽度：多画没用（壳体在车之后，会把洞外的一切盖住），只会把小块做大。
  //    暗地坪
  b.quad([[IX0, D.YI0, 0.0046], [IX1, D.YI0, 0.0046],
    [IX1, D.YF, 0.0046], [IX0, D.YF, 0.0046]], M.floor, [0, 0, 1]);
  //    暗后墙内面（法线朝 +y，朝库内）
  b.face('+y', D.YI0 + 0.001, IX0, IX1, 0.0040, D.ZD, M.wallIn);
  //    暗天花（法线朝下）
  b.quad([[IX0, D.YI0, D.ZD], [IX0, D.YF, D.ZD],
    [IX1, D.YF, D.ZD], [IX1, D.YI0, D.ZD]], M.ceil, [0, 0, -1]);

  // ③ 道砟 + 枕木 + 钢轨（贯穿整格；钢轨就是小块里那几条"铁轨图案"）
  b.box(TR.B0, 0.0000, 0.0000, TR.B1, 1.0000, TR.BED, M.ballast, M.ballast);
  for (let y = TR.SL_Y0, k = 0; y + TR.SL_T <= TR.SL_Y1 + 1e-9; y += TR.SL_STEP, k++) {
    b.box(0.5 - TR.SL_HALF, y, 0.0000, 0.5 + TR.SL_HALF, y + TR.SL_T, TR.SL_TOP,
      k % 2 ? M.sleeperB : M.sleeperA, M.sleeperB);
  }
  for (const [x0, x1] of TR.RAIL_X) {
    b.box(x0, 0.0000, TR.RAIL_BASE, x1, 1.0000, TR.RAIL_TOP, 'rust', 'metal');
  }

  // ④ 前端墙（会被车挡住 ⇒ 和地面同层）
  frontGable(b);
}

// =============================================================================
// 图层 B —— 壳体（槽 1/3/4/5，画在车之后；门洞里一个像素都不许有）
// =============================================================================
function emitShell(b, hole) {
  // ★ v77：**前端墙整块不画**（见 docs/建模经验.md §4.52）。
  //   它「会被车挡住」⇒ 和地面一起搬到 0/2 层（emitGround 里的 frontGable）。
  //   这里只画不会被车挡住的部分：后山墙 / 两侧纵墙 / 屋面 / 脊瓦 / 封檐。

  // ---------------------------------------------------------------- 后山墙（−y）
  wallWithPlinth(b, '-y', D.YB, D.XL, D.XR);
  windowAt(b, '-y', D.YB - 0.001, D.BW.u0, D.BW.u1, D.BW.z0, D.BW.z1);

  // ---------------------------------------------------------------- 两侧纵墙
  for (const side of ['+x', '-x']) {
    const at = side === '+x' ? D.XR : D.XL;
    wallWithPlinth(b, side, at, D.YB, D.YF);
    const off = side === '+x' ? 0.001 : -0.001;
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
const JOBS = [
  { name: 'G1_depot', layer: 'shell', hole: 'far',
    why: '壳体（不含前端墙）→ 槽 1/4/5' },
  { name: 'G1_depot_wa', layer: 'ground', inner: 'far',
    why: '地面+轨道+前端墙 → 槽 0（车之前画）' },
  { name: 'G1_depot_wb', layer: 'ground', inner: 'near',
    why: '同上 → 槽 2（车之前画）' },
  { name: 'G1_depot_x', layer: 'shell', hole: 'near',
    why: '壳体（同上，x 对称 ⇒ 与 A 相同）→ 槽 3' },
];
const SPAN = {
  far: [D.D0, D.MID],
  near: [D.MID, D.D1],
};

const header = (job) => `# =============================================================================
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
#   库内轨道：道砟 ${N(TR.B0)}~${N(TR.B1)} / 枕顶 ${N(TR.SL_TOP)} / 轨顶 ${N(TR.RAIL_TOP)}
# =============================================================================

`;

export function generateDepots() {
  const made = [];
  for (const job of JOBS) {
    const b = new Builder();
    if (job.layer === 'shell') emitShell(b, SPAN[job.hole]);
    else emitGround(b, SPAN[job.inner]);
    const text = header(job)
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
  log('生成机车库「库 A」（风格 ' + STYLE_NAME + '；壳体 1 + 地面 2 = 3 个模型 × 4 朝向）：');
  const made = generateDepots();
  const tot = made.reduce((s, m) => s + m.quads, 0);
  log('');
  log('  合计 ' + made.length + ' 个模型 / ' + tot + ' 个四边形面');
  log('  下一步：node tools/build.mjs --step render → node tools/check.mjs');
}
