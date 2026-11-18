// =============================================================================
// tools/gen-g1-depot.mjs —— 生成 **车库**「库 A 红砖机车库」的 4 个模型
//
//   node tools/gen-g1-depot.mjs
//
// 产出（**整份重写，别手改**）：
//   models/G1_depot_a.model      库 A 整栋（门朝 +y；4 个朝向 = 4 个入口方向）
//   models/G1_depot_na.model     遮车层 A（剖切面 `x + y > 1`）
//   models/G1_depot_nb.model     遮车层 B（剖切面 `x > y`）
//   models/G1_depot_nc.model     遮车层 C（剖切面 `x < y`）
//
// -----------------------------------------------------------------------------
// 【引擎口径（官方 wiki `NML:Railtypes` §depots，四来源一致）】
//
//   `depots` 回调 **6 张精灵**，绘制顺序 **建筑 → 车 → 近墙**：
//     槽 0 「NE wall」给 SE 入口   槽 1 SE 建筑
//     槽 2 「NW wall」给 SW 入口   槽 3 SW 建筑
//     槽 4 NE 建筑                 槽 5 NW 建筑
//   （wiki：「2 sprites for each south-ish, 1 sprite for each north-ish. Like original depots.」）
//
// -----------------------------------------------------------------------------
// 【★ 两层怎么切 —— 抄隧道那套"水平面"，不是竖直半空间】（人工 2026-11-18 裁定）
//
//   `tunnels:` / `tunnel_overlay:` 的切法是**按"车能不能盖到"横切一刀**：
//     底图 = 车下面的（轨道 + 洞内），遮车层 = 车永远到不了的（拱以上）。
//
//   车库照抄这个口径 —— **车顶 0.29 < 檐口 0.34 ⇒ 车永远盖不到屋面**：
//     · 整栋（槽 1/3/4/5）= 全部：屋面 + 四片墙 + 洞内轨道 + 场坪
//     · 遮车层（槽 0/2）= **只有墙身**：近侧纵墙（含三樘窗）+ 前山墙（含门洞/门套/侧壁）
//       ⚠ **屋面一根都不进遮车层** —— 第一版把整幅屋面塞了进去，结果遮车层自己
//         就是一整栋房子，一偏就成「同一格里两栋完整的房子」
//         （人工实机：「弄了两个完整建模还调错偏移了」）。
//     · 门楣牌在门洞上方（z 0.305~0.335），车顶到不了 ⇒ **只进整栋**。
//     · 远侧纵墙 / 后山墙 / 场坪 / 洞内 ⇒ 车后面，**只进整栋**。
//
//   剖切面（每个朝向各不相同，所以吐 3 个遮车层模型 A/B/C）：
//     v0  x + y > 1        v1  x > y           v2  x + y < 1        v3  x < y
//   接图：槽 0 ← A 的 v0、槽 2 ← C 的 v3。
//
//   ⚠ 遮车层走 sortable 那一趟，**落地原点比底图低 120 px** ⇒ 模板 `yrel = −172`
//     （底图 −52 再上移 120；抄自己实机验证的隧道那一对，见 `docs/踩坑.md` A8）。
//
// -----------------------------------------------------------------------------
// 【形体（格；1 格 = 13.9 m，4x 下 1 px = 0.089 m）】
//
//   占地 1×1 · **端头库房**：+y 山墙一樘门、**−y 山墙是实墙**
//     （人工 2026-11-18：「黑洞的问题不是有黑洞，而是**两头都有洞**，正常背面应该是墙」）
//   勒脚 0.000~0.050 `concrete_dark` · 墙身 0.050~0.340 `brick_red` · 屋脊 0.500
//   墙体 0.14~0.86 × 0.04~0.96（10.0 × 12.8 m）· 墙厚 0.050 · 出檐 0.035
//   门洞 0.36 宽 × 0.30 高（5.0 × 4.2 m）——**净高 0.30 是硬指标**，车高约 0.29
//
//   ★ **库内是看得穿的**：道砟 + 枕木 + 两条钢轨 + 两侧内灰墙 + 后墙内面 + 天花，
//     前门洞望进去 → 轨道 → 后墙，一眼读出"这是车库、里面能停一列车"。
//
//   ⚠ 4x 下**砖缝是亚像素**（一层砖 0.075 m = 0.0054 格 = 0.76 px）⇒ 砖的质感只能靠
//     `brick_*` 的颗粒（±5.5%）；`courses` 画砖缝会变成噪声。瓦垄（0.025 格 = 2.8 px）
//     反而看得见，用 `gable` 的 tileRows / tileCols。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { ROOT, log, rel, isMain } from './util.mjs';

// ---------------------------------------------------------------- 小工具
const N = (v) => {
  const s = v.toFixed(4);
  return s === '-0.0000' ? '0.0000' : s;
};
const V = {
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
};

/** Newell 法线（与 `core/mesh.mjs` 的 newell 逐字同式，只是不归一） */
function newellRaw(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

// ---------------------------------------------------------------- 口径（库 A）
const A = {
  XL: 0.140, XR: 0.860,          // 墙体外皮（跨度 0.72 格 = 10.0 m）
  YB: 0.040, YF: 0.960,          // 进深（0.92 格 = 12.8 m）
  T: 0.050,                      // 墙厚
  Z_PL: 0.050,                   // 勒脚顶（砖墙起点）
  Z_EAVE: 0.340,                 // 檐口（4.7 m）
  Z_RIDGE: 0.500,                // 屋脊（6.9 m）
  Z_DOOR: 0.300,                 // 门洞净高（4.2 m）
  UD0: 0.320, UD1: 0.680,        // 门洞（0.36 格 = 5.0 m）
  OVER: 0.035,                   // 出檐
  JAMB: 0.022,                   // 门套宽
  PROUD: 0.008,                  // 门套挑出墙面
};
const XI0 = A.XL + A.T, XI1 = A.XR - A.T;   // 洞内净空 0.19 / 0.81
const YI0 = A.YB + A.T, YI1 = A.YF - A.T;   // 0.09 / 0.91

/** 侧墙窗（三樘，z 0.215~0.295；4x 下 20 × 12.5 px） */
const WIN = [[0.200, 0.340], [0.420, 0.560], [0.640, 0.780]];
const Z_W0 = 0.215, Z_W1 = 0.295;

/** 门楣牌（白底；三个汉字要 CJK 点阵表，本轮先留白 —— 见方案 §1.7.7 ⑤） */
const SIGN = { u0: 0.340, u1: 0.660, z0: 0.305, z1: 0.335 };

// ---------------------------------------------------------------- 库内轨道
/**
 * 库内轨道口径**照抄 `tools/gen-g1-tunnel.mjs` 的洞内那套**
 * （`B0/B1` 道砟带宽、`SLEEPER_TOP`、`RAIL_BASE/TOP`、`RAIL_Y` 两条钢轨），
 * 这样库里的轨和库外 `SADN` 的轨是同一副样子 —— 只是不抬 z。
 */
const TR = {
  B0: 0.3200, B1: 0.6800,                          // 道砟带宽（与洞内一致）
  BED: 0.0078,                                     // 砟顶
  SLEEPER_TOP: 0.0100,
  RAIL_TOP: 0.0230,
  RAIL_X: [[0.4444, 0.4524], [0.5476, 0.5556]],    // 两条钢轨的 x 区间（1435mm）
  SL_STEP: 0.0400, SL_HALF: 0.0900, SL_T: 0.0200,  // 枕木：沿 x 长 0.18、厚 0.02、间距 0.04
};

// ---------------------------------------------------------------- 发射器
class Builder {
  constructor() { this.lines = []; this.quads = 0; }

  /** 一个四边形面。`hint` = 该面**应当朝外**的方向；绕序由它兜底。 */
  quad(pts, mat, hint) {
    const nn = newellRaw(pts);
    if (V.len(nn) < 1e-9) throw new Error('退化面（法线为 0）：' + JSON.stringify(pts));
    const p = V.dot(nn, hint) < 0 ? pts.slice().reverse() : pts;
    this.lines.push('quad ' + p.map((q) => N(q[0]) + ' ' + N(q[1]) + ' ' + N(q[2])).join('  ')
      + '   ' + mat);
    this.quads++;
  }

  /** 长方体（6 面）。`top` 给顶面换材质。 */
  box(x0, y0, z0, x1, y1, z1, mat, top) {
    const a = [x0, y0], b = [x1, y0], c = [x1, y1], d = [x0, y1];
    const p = (q, z) => [q[0], q[1], z];
    this.quad([p(a, z1), p(b, z1), p(c, z1), p(d, z1)], top || mat, [0, 0, 1]);
    this.quad([p(a, z0), p(b, z0), p(c, z0), p(d, z0)], mat, [0, 0, -1]);
    this.quad([p(b, z0), p(c, z0), p(c, z1), p(b, z1)], mat, [1, 0, 0]);
    this.quad([p(c, z0), p(d, z0), p(d, z1), p(c, z1)], mat, [0, 1, 0]);
    this.quad([p(d, z0), p(a, z0), p(a, z1), p(d, z1)], mat, [-1, 0, 0]);
    this.quad([p(a, z0), p(b, z0), p(b, z1), p(a, z1)], mat, [0, -1, 0]);
  }

  /** 贴在墙面上的竖直四边形（自动绕序）。±x 面 u=y，±y 面 u=x */
  face(side, at, u0, u1, z0, z1, mat) {
    const hint = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0] }[side];
    const p = (u, z) => (side === '+x' || side === '-x' ? [at, u, z] : [u, at, z]);
    this.quad([p(u0, z0), p(u1, z0), p(u1, z1), p(u0, z1)], mat, hint);
  }

  line(s) { this.lines.push(s); }
  text() { return this.lines.join('\n') + '\n'; }
}

// ---------------------------------------------------------------- 近半剖切
/**
 * 一片墙（`side` + 平面坐标 `at` + 面内横轴 [u0,u1]）里属于近半的那一段。
 * 返回 null = 整片都在远侧。
 *
 *   plane = null  → 整片（整栋）
 *   plane = 'A'   → 近 ⟺ x + y > 1  ⇒ u > 1 − at（四个立面同一条式）
 *   plane = 'B'   → 近 ⟺ x > y      ⇒ ±x 面（at = x）u < at；±y 面（at = y）u > at
 *   plane = 'C'   → 近 ⟺ x < y      ⇒ B 的补集
 */
function seg(side, at, u0, u1, plane) {
  if (!plane) return [u0, u1];
  const xFace = side === '+x' || side === '-x';
  let lo = u0, hi = u1;
  if (plane === 'A') {
    lo = Math.max(lo, 1 - at);
  } else if (plane === 'B') {
    if (xFace) hi = Math.min(hi, at); else lo = Math.max(lo, at);
  } else {
    if (xFace) lo = Math.max(lo, at); else hi = Math.min(hi, at);
  }
  return hi - lo < 1e-6 ? null : [lo, hi];
}

/** 把洞口夹进 [u0,u1]×[v0,v1]（越界的丢掉） */
function clipHoles(holes, u0, u1, v0, v1) {
  const out = [];
  for (const [hu0, hv0, hu1, hv1] of holes) {
    const a = Math.max(hu0, u0), b = Math.min(hu1, u1);
    const c = Math.max(hv0, v0), d = Math.min(hv1, v1);
    if (b - a > 1e-6 && d - c > 1e-6) out.push([a, c, b, d]);
  }
  return out;
}

/**
 * 两段式墙：勒脚（`concrete_dark` 0~Z_PL）+ 墙身（`brick_red` Z_PL~Z_EAVE）。
 * 洞口按 Z_PL 分成上下两半，各在自己的层里切 —— 门洞因而能一直开到地面。
 */
function wall2(b, side, at, u0, u1, holes, plane) {
  const sp = seg(side, at, u0, u1, plane);
  if (!sp) return;
  const [s0, s1] = sp;
  for (const [z0, z1, mat] of [[0, A.Z_PL, 'concrete_dark'], [A.Z_PL, A.Z_EAVE, 'brick_red']]) {
    const hs = clipHoles(holes, s0, s1, z0, z1).filter((h) => h[3] > h[1] + 1e-6);
    b.line(`wall ${side} ${N(at)} ${N(s0)} ${N(s1)} ${N(z0)} ${N(z1)}`
      + (hs.length ? '  ' + hs.map((h) => h.map(N).join(',')).join(' ') : '')
      + `  ${mat} thick=${N(A.T)}`);
  }
}

// ---------------------------------------------------------------- 构件
/** 场坪 + 门口碎石门槛（门槛压住车轮，遮车层也要有） */
function ground(b, plane) {
  if (!plane) {
    b.quad([[0.020, 0.020, 0.004], [0.980, 0.020, 0.004], [0.980, 0.980, 0.004], [0.020, 0.980, 0.004]],
      'concrete_pad', [0, 0, 1]);
  }
  const yc = A.YF;
  // 往里多铺 0.06：盖住 `wall` 洞口底面那一圈**砖色**的门坎（不然门口一条亮红）
  b.box(A.UD0, Math.min(yc - 0.060, yc + 0.040), 0.000,
    A.UD1, Math.max(yc - 0.060, yc + 0.040), 0.016, 'gravel', 'gravel');
}

/**
 * 洞内：**道砟 + 枕木 + 钢轨 + 两侧内灰墙 + 后墙内面 + 天花**（**只进整栋**）。
 *
 * ⚠ 第一版做成「近黑六面盒子 + 两头都堵」⇒ 实机「不管朝前朝后，门洞里都是黑洞」。
 *   端头库房该是：**前门洞 → 轨道 → 后墙**，一眼看进去能读出这是车库。
 */
function interior(b) {
  const zc = A.Z_DOOR;
  // 库内地坪（砟带两侧的灰）—— 用**暗灰**：flatiso 不做室内遮蔽，亮材质会让洞内像露天的院子
  b.quad([[XI0, YI0, 0.0030], [XI1, YI0, 0.0030], [XI1, YI1, 0.0030], [XI0, YI1, 0.0030]],
    'trim_dark', [0, 0, 1]);
  // 道砟带（暗灰，不是露天的 `gravel`）
  b.box(TR.B0, YI0, 0.0000, TR.B1, YI1, TR.BED, 'panel_seam', 'panel_seam');
  // 枕木
  for (let y = YI0 + 0.0200; y + TR.SL_T <= YI1 - 0.0040; y += TR.SL_STEP) {
    b.box(0.5 - TR.SL_HALF, y, TR.BED, 0.5 + TR.SL_HALF, y + TR.SL_T,
      TR.SLEEPER_TOP, 'wood_dark', 'wood_seam');
  }
  // 钢轨（两条，1435mm；洞内唯一该发亮的细线）
  for (const [x0, x1] of TR.RAIL_X) {
    b.box(x0, YI0, TR.SLEEPER_TOP, x1, YI1, TR.RAIL_TOP, 'metal_dark', 'metal');
  }
  // 两侧内墙（暗灰）
  for (const [at, side] of [[XI0 + 0.002, '+x'], [XI1 - 0.002, '-x']]) {
    b.face(side, at, YI0, YI1, 0.0000, zc, 'trim_dark');
  }
  // 后墙内面（后山墙自己画的是双面，这里压一层暗灰，免得洞内一片红砖）
  b.face('+y', YI0 + 0.002, XI0, XI1, 0.0000, zc, 'trim_dark');
  // 天花（门洞净高，最暗）
  b.quad([[XI0, YI0, zc], [XI0, YI1, zc], [XI1, YI1, zc], [XI1, YI0, zc]], 'trim_black', [0, 0, -1]);
}

/** 屋面（双坡，屋脊沿 y）+ 脊瓦 + 封檐板。**只进整栋** */
function roof(b) {
  const tile = ' tileRows=6 tileCols=16 tileW=0.009 tileMat=roof_slate_seam';
  b.line(`gable ${N(A.XL)} ${N(A.YB)} ${N(A.XR)} ${N(A.YF)} ${N(A.Z_EAVE)} ${N(A.Z_RIDGE)}`
    + ` y ${N(A.OVER)}  roof_slate side=brick_red bottom=trim_dark` + tile);
  b.box(0.478, 0.030, A.Z_RIDGE - 0.014, 0.522, 0.970, A.Z_RIDGE + 0.016,
    'roof_slate_dark', 'roof_slate_dark');
  for (const [x, d] of [[A.XL - A.OVER, -1], [A.XR + A.OVER, 1]]) {
    b.box(d < 0 ? x - 0.006 : x, A.YB - A.OVER, A.Z_EAVE - 0.012,
      d < 0 ? x : x + 0.006, A.YF + A.OVER, A.Z_EAVE + 0.010, 'trim_dark');
  }
}

/**
 * 前山墙（+y，一樘门）：门洞 + 混凝土门套 + 门楣牌。
 * `side` / `at` 是这一榀所在的外墙面；`out` 是朝外的符号（+y 面 = +1）。
 */
function gable(b, side, at, out, plane) {
  const sp = seg(side, at, A.XL, A.XR, plane);
  if (!sp) return;
  const [s0, s1] = sp;
  // ⚠ 山墙**不分两段**（不像纵墙）：大门洞要一直开到地面，若勒脚/砖墙分两层，
  //   砖墙底面会在门洞里露出一条 0.05 高的亮红横带（第一版就是这样）。
  //   ⇒ 整片砖墙 0~檐口，勒脚改成**贴面**（洞两侧各一条），门洞里干干净净。
  const hs = clipHoles([[A.UD0, 0, A.UD1, A.Z_DOOR]], s0, s1, 0, A.Z_EAVE);
  b.line(`wall ${side} ${N(at)} ${N(s0)} ${N(s1)} 0.0000 ${N(A.Z_EAVE)}`
    + (hs.length ? '  ' + hs.map((h) => h.map(N).join(',')).join(' ') : '')
    + `  brick_red thick=${N(A.T)}`);
  // 勒脚贴面（只在门洞两侧）
  for (const [u0, u1] of [[A.XL, A.UD0], [A.UD1, A.XR]]) {
    const s2 = seg(side, at, u0, u1, plane);
    if (!s2) continue;
    b.face(side, at + out * 0.002, s2[0], s2[1], 0.000, A.Z_PL, 'concrete_dark');
  }
  const yIn = at - out * 0.002;                 // 门套的贴面
  const yOut = at + out * A.PROUD;
  // 门套（混凝土，挑出墙面 0.008）
  for (const [u0, u1] of [[A.UD0 - A.JAMB, A.UD0], [A.UD1, A.UD1 + A.JAMB]]) {
    if (!seg(side, at, u0, u1, plane)) continue;
    b.box(Math.min(u0, u1), Math.min(yIn, yOut), 0.000, Math.max(u0, u1), Math.max(yIn, yOut),
      A.Z_DOOR, 'concrete');
  }
  // 洞口侧壁也包成混凝土（`wall` 切出来的侧壁是砖色，45° 下门洞右边会露出一条红）
  for (const [x, s] of [[A.UD0 + 0.0005, '+x'], [A.UD1 - 0.0005, '-x']]) {
    if (!seg(side, at, x, x + 0.001, plane)) continue;
    b.face(s, x, at - out * A.T, at, 0.000, A.Z_DOOR, 'concrete');
  }
  // 门楣牌（白底，占满过梁）：在门洞上方、车顶（0.29）到不了 ⇒ **只进整栋**
  if (!plane) b.face(side, at + out * 0.003, SIGN.u0, SIGN.u1, SIGN.z0, SIGN.z1, 'sign_white');
  // 门扇：**不做**（开着的门扇不管怎么摆都会挡在门口）
}

/**
 * 后山墙（−y，**实墙**，一樘小高窗）：
 * 人工 2026-11-18：「黑洞的问题不是有黑洞，而是**两头都有洞**，正常背面应该是墙」。
 */
function backGable(b, side, at, out, plane) {
  const sp = seg(side, at, A.XL, A.XR, plane);
  if (!sp) return;
  wall2(b, side, at, A.XL, A.XR, [[A.UD0, Z_W0, A.UD1, Z_W1]], plane);
  const s2 = seg(side, at, A.UD0, A.UD1, plane);
  if (s2) {
    b.line(`win ${side} ${N(at)} ${N(s2[0])} ${N(s2[1])} ${N(Z_W0)} ${N(Z_W1)}`
      + `  glass_dark frame=metal_dark frameW=0.014 mull=2 depth=0.010 inset=${N(A.T)}`);
  }
}

/** 一榀纵墙（三樘高窗） */
function sideWall(b, side, at, plane) {
  wall2(b, side, at, A.YB, A.YF, WIN.map(([u0, u1]) => [u0, Z_W0, u1, Z_W1]), plane);
  for (const [u0, u1] of WIN) {
    const sp = seg(side, at, u0, u1, plane);
    if (!sp) continue;
    b.line(`win ${side} ${N(at)} ${N(sp[0])} ${N(sp[1])} ${N(Z_W0)} ${N(Z_W1)}`
      + `  glass_dark frame=metal_dark frameW=0.014 mull=2 depth=0.010 inset=${N(A.T)}`);
  }
}

// ---------------------------------------------------------------- 整栋 / 遮车层
function build(plane) {
  const b = new Builder();
  ground(b, plane);
  if (!plane) interior(b);
  gable(b, '+y', A.YF, +1, plane);          // 前山墙：门
  backGable(b, '-y', A.YB, -1, plane);      // 后山墙：实墙（plane 时 seg 自动返回 null）
  sideWall(b, '+x', A.XR, plane);           // 近侧纵墙（要进遮车层）
  sideWall(b, '-x', A.XL, plane);           // 远侧纵墙：seg 会把远段切掉，只剩近半那条角
  if (!plane) roof(b);                      // ★ 屋面：车顶 0.29 < 檐口 0.34 ⇒ 只进整栋
  return b;
}

// ---------------------------------------------------------------- 模型清单
const JOBS = [
  { name: 'G1_depot_a', plane: null, why: '库 A 整栋（端头库房：+y 门 / −y 实墙；含库内轨道）' },
  { name: 'G1_depot_na', plane: 'A', why: '遮车层 A · 剖切面 x+y>1（朝向 v0 用）' },
  { name: 'G1_depot_nb', plane: 'B', why: '遮车层 B · 剖切面 x>y（朝向 v1 用）' },
  { name: 'G1_depot_nc', plane: 'C', why: '遮车层 C · 剖切面 x<y（朝向 v3 用）' },
];

const HDR = (job) =>
  '# =============================================================================\n'
  + '# ' + job.name + ' —— 机车库「库 A」（' + job.why + '）\n'
  + '#\n'
  + '# 【本文件由 tools/gen-g1-depot.mjs 生成，请勿手改】\n'
  + '#\n'
  + '#   占地 1×1 · 端头库房（+y 一樘门 / −y 实墙）· 勒脚 0.050 / 檐口 0.340 / 屋脊 0.500\n'
  + '#   墙体 0.14~0.86 × 0.04~0.96 · 墙厚 0.050 · 出檐 0.035 · 脊瓦顶 0.516\n'
  + '#   库内：道砟 0.32~0.68 / 枕木 0.010 / 钢轨 0.023（与库外 SADN 同一套口径）\n'
  + '#\n'
  + '#   `zmax` 四个模型全钉 0.5200 ⇒ 同一张分表、同一格位、同一组 xrel/yrel。\n'
  + '#   ⚠ 遮车层（na/nb/nc）**只有墙身、没有屋面** —— 屋面车永远盖不到，留在整栋那张。\n'
  + '# =============================================================================\n\n';

export function generateDepots() {
  const made = [];
  for (const job of JOBS) {
    const b = build(job.plane);
    const text = HDR(job)
      + 'name      ' + job.name + '\n'
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
  log('生成机车库「库 A」（整栋 + 3 个遮车层 = 4 个模型 × 4 朝向 = 16 张精灵）：');
  const made = generateDepots();
  const tot = made.reduce((s, m) => s + m.quads, 0);
  log('');
  log('  合计 ' + made.length + ' 个模型 / ' + tot + ' 个四边形面');
  log('  下一步：node tools/build.mjs --step render → node tools/sprites.mjs');
}
