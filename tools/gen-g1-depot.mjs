// =============================================================================
// tools/gen-g1-depot.mjs —— 生成 **车库**「库 A 红砖机车库」的 2 个模型
//
//   node tools/gen-g1-depot.mjs
//
// 产出（**整份重写，别手改**）：
//   models/G1_depot_a.model      库 A **结构层**（墙 + 屋面 + 门套 + 门楣牌）—— 画在车**之上**
//   models/G1_depot_na.model     库 A **地面层**（场坪 + 库内地坪/内墙 + 道砟 + 枕木 + 钢轨）
//                                —— 画在车**之下**
//
// -----------------------------------------------------------------------------
// 【★ 引擎的实际图层关系（人工 2026-11-18 实机指出，三次纠正后定案）】
//
//   depots 的 6 张精灵里，槽 0/2（"wall"）与槽 1/3/4/5（"building"）的上下关系是：
//
//        **槽 0/2（na，地面层） → 车 → 槽 1/3/4/5（a，结构层）**
//
//   ⇒ 人工原话：「游戏里实际上图层关系 **a 是在 na 上面的**，也就是 a 盖住车辆盖住 na。
//      所以 **a 不应该有门那一块**（参考 xUSSR），然后 **铁轨应该在 na**」。
//
//   ⇒ 因此分工是（**照抄隧道那两层**：`tunnels:` 在车下放轨道，`tunnel_overlay:` 在车上放结构）：
//
//     · `a`（结构层，画在车上）= 四片外纵/山墙 + 屋面 + 门套 + 门楣牌 + 门外场坪两侧
//       **前山墙的门洞是一刀真洞**（不填任何东西）⇒ 车从洞里露出来；
//       ⚠ 门洞那一块**绝不能有面**：有面就把车盖死了（人工："a 不应该有门那一块"）。
//     · `na`（地面层，画在车下）= 场坪 + 库内地坪 + 两侧内墙 + 后墙内面 + 天花
//       + 道砟 + 枕木 + **两条钢轨** + 门口碎石门槛 ⇒ 车压在钢轨上（人工："铁轨应该在 na"）。
//
//   ★ 这样两层**走同一趟绘制**（都在瓦片循环里，一前一后）⇒ **模板偏移完全一样
//     （−131,−52），不需要任何遮车层的 −120 手调** —— 前几版"两栋房子"的病根
//     （把遮车层当 sortable、另给一套偏移）就此消失。
//
//   ★ 槽 0 和槽 2 用的是**同一张地面层精灵**：地面/轨道与朝向无关。
//
// -----------------------------------------------------------------------------
// 【形体（格；1 格 = 13.9 m，4x 下 1 px = 0.089 m）】
//
//   占地 1×1 · **端头库房**：+y 山墙一樘门、**−y 山墙是实墙**（+ 一樘小高窗）
//   勒脚 0.000~0.050 `concrete_dark` · 墙身 0.050~0.340 `brick_red` · 屋脊 0.500
//   墙体 0.14~0.86 × 0.04~0.96（10.0 × 12.8 m）· 墙厚 0.050 · 出檐 0.035
//   门洞 0.36 宽 × 0.30 高（5.0 × 4.2 m）——**净高 0.30 是硬指标**，车高约 0.29
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
 * 洞口按 Z_PL 分成上下两半，各在自己的层里切。
 */
function wall2(b, side, at, u0, u1, holes) {
  for (const [z0, z1, mat] of [[0, A.Z_PL, 'concrete_dark'], [A.Z_PL, A.Z_EAVE, 'brick_red']]) {
    const hs = clipHoles(holes, u0, u1, z0, z1).filter((h) => h[3] > h[1] + 1e-6);
    b.line(`wall ${side} ${N(at)} ${N(u0)} ${N(u1)} ${N(z0)} ${N(z1)}`
      + (hs.length ? '  ' + hs.map((h) => h.map(N).join(',')).join(' ') : '')
      + `  ${mat} thick=${N(A.T)}`);
  }
}

// =========================================================== 地面层（车之下）
/**
 * `na`：**画在车下面的全部**。车压在钢轨上（人工：「铁轨应该在 na」）。
 * 场坪 + 库内地坪 + 内墙 + 后墙内面 + 天花 + 道砟 + 枕木 + 两条钢轨 + 门口门槛。
 */
function groundLayer(b) {
  // 场坪（整格）
  b.quad([[0.020, 0.020, 0.0040], [0.980, 0.020, 0.0040], [0.980, 0.980, 0.0040], [0.020, 0.980, 0.0040]],
    'concrete_pad', [0, 0, 1]);
  // 库内地坪（暗灰：flatiso 不做室内遮蔽，亮材质会让洞内像露天院子）
  b.quad([[XI0, YI0, 0.0046], [XI1, YI0, 0.0046], [XI1, YI1, 0.0046], [XI0, YI1, 0.0046]],
    'trim_dark', [0, 0, 1]);
  // 两侧内墙（暗灰）。⚠ 后墙内面**不另加面**：结构层那榀后山墙自己画了双面，
  //   再压一层会和它 z-fighting（实机/出图都是两层砖/灰互相咬）。库内后墙就是砖的，真实。
  for (const [at, side] of [[XI0 + 0.002, '+x'], [XI1 - 0.002, '-x']]) {
    b.face(side, at, YI0, YI1, 0.0046, A.Z_DOOR, 'trim_dark');
  }
  b.quad([[XI0, YI0, A.Z_DOOR], [XI0, YI1, A.Z_DOOR], [XI1, YI1, A.Z_DOOR], [XI1, YI0, A.Z_DOOR]],
    'trim_black', [0, 0, -1]);
  // 道砟带 + 枕木 + 两条钢轨
  b.box(TR.B0, YI0, 0.0000, TR.B1, YI1, TR.BED, 'panel_seam', 'panel_seam');
  for (let y = YI0 + 0.0200; y + TR.SL_T <= YI1 - 0.0040; y += TR.SL_STEP) {
    b.box(0.5 - TR.SL_HALF, y, TR.BED, 0.5 + TR.SL_HALF, y + TR.SL_T,
      TR.SLEEPER_TOP, 'wood_dark', 'wood_seam');
  }
  for (const [x0, x1] of TR.RAIL_X) {
    b.box(x0, YI0, TR.SLEEPER_TOP, x1, YI1, TR.RAIL_TOP, 'metal_dark', 'metal');
  }
  // 门口碎石门槛（车压在上面）
  b.box(A.UD0, A.YF - 0.060, 0.000, A.UD1, A.YF + 0.040, 0.016, 'gravel', 'gravel');
}

// =========================================================== 结构层（车之上）
/**
 * `a`：**画在车上面的全部**。所以**门洞那一块必须是一刀真洞**（不能有任何面，
 * 有面就把车盖死了 —— 人工：「a 不应该有门那一块」）。
 * 场坪只铺**砟带两侧两条**：中间那条归 `na` 的钢轨，铺了就把轨盖掉。
 */
const APRON = [[0.020, 0.300], [0.700, 0.980]];
function structure(b) {
  for (const [x0, x1] of APRON) {
    b.quad([[x0, 0.020, 0.0052], [x1, 0.020, 0.0052], [x1, 0.980, 0.0052], [x0, 0.980, 0.0052]],
      'concrete_pad', [0, 0, 1]);
  }
  gable(b, '+y', A.YF, +1);        // 前山墙：门洞（真洞）
  backGable(b, '-y', A.YB, -1);    // 后山墙：实墙 + 一樘小高窗
  sideWall(b, '+x', A.XR);
  sideWall(b, '-x', A.XL);
  roof(b);
}

/** 前山墙（+y，一樘门）：门洞 = 真洞 + 混凝土门套 + 门楣牌 */
function gable(b, side, at, out) {
  // ⚠ 山墙**不分两段**（不像纵墙）：大门洞要一直开到地面，若勒脚/砖墙分两层，
  //   砖墙底面会在门洞里露出一条 0.05 高的亮红横带。
  const hs = clipHoles([[A.UD0, 0, A.UD1, A.Z_DOOR]], A.XL, A.XR, 0, A.Z_EAVE);
  b.line(`wall ${side} ${N(at)} ${N(A.XL)} ${N(A.XR)} 0.0000 ${N(A.Z_EAVE)}`
    + (hs.length ? '  ' + hs.map((h) => h.map(N).join(',')).join(' ') : '')
    + `  brick_red thick=${N(A.T)}`);
  // 勒脚贴面（只在门洞两侧）
  for (const [u0, u1] of [[A.XL, A.UD0], [A.UD1, A.XR]]) {
    b.face(side, at + out * 0.002, u0, u1, 0.000, A.Z_PL, 'concrete_dark');
  }
  const yIn = at - out * 0.002;
  const yOut = at + out * A.PROUD;
  // 门套（混凝土，挑出墙面 0.008）—— 在车之上，所以门洞两侧的框要留在这一层
  for (const [u0, u1] of [[A.UD0 - A.JAMB, A.UD0], [A.UD1, A.UD1 + A.JAMB]]) {
    b.box(Math.min(u0, u1), Math.min(yIn, yOut), 0.000, Math.max(u0, u1), Math.max(yIn, yOut),
      A.Z_DOOR, 'concrete');
  }
  // 洞口侧壁包成混凝土（`wall` 切出来的侧壁是砖色，45° 下会露出一条红）
  for (const [x, s] of [[A.UD0 + 0.0005, '+x'], [A.UD1 - 0.0005, '-x']]) {
    b.face(s, x, at - out * A.T, at, 0.000, A.Z_DOOR, 'concrete');
  }
  // 门楣牌（白底，占满过梁）
  b.face(side, at + out * 0.003, SIGN.u0, SIGN.u1, SIGN.z0, SIGN.z1, 'sign_white');
  // 门扇：不做（开着的门扇不管怎么摆都会挡在门口）
}

/** 后山墙（−y，实墙 + 一樘小高窗）：人工「正常背面应该是墙」 */
function backGable(b, side, at, out) {
  wall2(b, side, at, A.XL, A.XR, [[A.UD0, Z_W0, A.UD1, Z_W1]]);
  b.line(`win ${side} ${N(at)} ${N(A.UD0)} ${N(A.UD1)} ${N(Z_W0)} ${N(Z_W1)}`
    + `  glass_dark frame=metal_dark frameW=0.014 mull=2 depth=0.010 inset=${N(A.T)}`);
}

/** 一榀纵墙（三樘高窗） */
function sideWall(b, side, at) {
  wall2(b, side, at, A.YB, A.YF, WIN.map(([u0, u1]) => [u0, Z_W0, u1, Z_W1]));
  for (const [u0, u1] of WIN) {
    b.line(`win ${side} ${N(at)} ${N(u0)} ${N(u1)} ${N(Z_W0)} ${N(Z_W1)}`
      + `  glass_dark frame=metal_dark frameW=0.014 mull=2 depth=0.010 inset=${N(A.T)}`);
  }
}

/** 屋面（双坡，屋脊沿 y）+ 脊瓦 + 封檐板 */
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

// ---------------------------------------------------------------- 模型清单
const JOBS = [
  { name: 'G1_depot_a', kind: 'structure', why: '结构层（墙/屋面/门套/门楣牌）· 画在车**之上**' },
  { name: 'G1_depot_na', kind: 'ground', why: '地面层（场坪/库内/道砟枕木钢轨）· 画在车**之下**' },
];

const HDR = (job) =>
  '# =============================================================================\n'
  + '# ' + job.name + ' —— 机车库「库 A」（' + job.why + '）\n'
  + '#\n'
  + '# 【本文件由 tools/gen-g1-depot.mjs 生成，请勿手改】\n'
  + '#\n'
  + '#   占地 1×1 · 端头库房（+y 一樘门 / −y 实墙）· 勒脚 0.050 / 檐口 0.340 / 屋脊 0.500\n'
  + '#   墙体 0.14~0.86 × 0.04~0.96 · 墙厚 0.050 · 出檐 0.035 · 脊瓦顶 0.516\n'
  + '#   库内轨道：道砟 0.32~0.68 / 枕顶 0.010 / 轨顶 0.023（与库外 SADN、洞内同一套口径）\n'
  + '#\n'
  + '#   `zmax` 两个模型全钉 0.5200 ⇒ 同一张分表、同一格位、同一组 xrel/yrel。\n'
  + '#   ⚠ 图层顺序：**na（地面层） → 车 → a（结构层）**。\n'
  + '#     所以 `a` 的门洞必须是一刀真洞（有面就把车盖死），钢轨必须留在 `na`（车压在上面）。\n'
  + '# =============================================================================\n\n';

export function generateDepots() {
  const made = [];
  for (const job of JOBS) {
    const b = new Builder();
    if (job.kind === 'ground') groundLayer(b); else structure(b);
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
  log('生成机车库「库 A」（结构层 a + 地面层 na = 2 个模型 × 4 朝向 = 8 张精灵）：');
  const made = generateDepots();
  const tot = made.reduce((s, m) => s + m.quads, 0);
  log('');
  log('  合计 ' + made.length + ' 个模型 / ' + tot + ' 个四边形面');
  log('  下一步：node tools/build.mjs --step render → node tools/sprites.mjs');
}
