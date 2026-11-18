// =============================================================================
// tools/gen-g1-depot.mjs —— 生成 **车库**「库 A 红砖机车库」的 4 个模型
//
//   node tools/gen-g1-depot.mjs
//
// 产出（**整份重写，别手改**）：
//   models/G1_depot_a.model      库 A 整栋（门朝 ±y；4 个朝向 = 4 个入口方向）
//   models/G1_depot_na.model     近侧墙 A（剖切面 `x + y > 1`）
//   models/G1_depot_nb.model     近侧墙 B（剖切面 `x > y`）
//   models/G1_depot_nc.model     近侧墙 C（剖切面 `x < y`）
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
//   ⇒ 一个整栋模型转 4 个朝向就是 4 个入口方向；**近墙 = 同一栋房子"近半"的同一批面**，
//     数字逐字相同 ⇒ 与建筑像素级对齐（同一张分表 ⇒ 格位 / xrel / yrel 完全一样）。
//
// -----------------------------------------------------------------------------
// 【近半到底怎么切 —— 每个朝向切法不同，所以要 3 个近墙模型】
//
//   相机在 +x+y ⇒ 深度 ≈ x+y。真正的规则是「**比车更近的面**」：
//
//     朝向 v 的可见立面是固定的两片；把相机方向转回模型空间，
//     近半就是过瓦片中心、垂直于该朝向视线的那个半平面。
//
//   设整栋模型被转过 R^v（R = 绕 z +90°：(x,y)→(−y,x)），则四个朝向的近半平面是：
//
//     v0  x + y > 1        v1  x > y
//     v2  x + y < 1        v3  x < y
//
//   ⇒ v0/v2 互为 180°、v1/v3 互为 180°，但**四个平面各不相同**，一个模型切不出来。
//     所以吐 3 个近墙模型（A / B / C），接图时每个槽各取**对得上那个朝向**的一格。
//     本轮只接 slot0 ← A 的 v0、slot2 ← B 的 v1（对不上就换 C 的 v3，见 §1.7.7 ①）。
//
//   ⚠ 近墙是**画在车之上的叠加图**，里面只能有「比车更近」的面。
//     地面 / 洞内的地板天花后墙 / 远侧墙**一律不进近墙** —— 它们都在车后面，
//     放进去就会在 2D 叠加时糊掉整栋（第一版踩过：洞内地坪把整面砖墙涂成灰的）。
//     洞内的东西由整栋那张画好，透过门洞看得见。
//
//   ⚠ 屋面**整个**进所有近墙：车顶 0.29 < 檐口 0.34，屋面对车只做遮挡、不改遮挡关系。
//
// -----------------------------------------------------------------------------
// 【形体（格；1 格 = 13.9 m，4x 下 1 px = 0.089 m）】
//
//   占地 1×1 · 轨道沿 ±y（±y 两个山墙各一樘门 = **通过式库房**）
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
const Z_FLOOR = 0.012;                      // 洞内地面

/** 侧墙窗（三樘，z 0.215~0.295；4x 下 20 × 12.5 px） */
const WIN = [[0.200, 0.340], [0.420, 0.560], [0.640, 0.780]];
const Z_W0 = 0.215, Z_W1 = 0.295;

/** 门楣牌（白底；三个汉字要 CJK 点阵表，本轮先留白 —— 见方案 §1.7.7 ⑤） */
const SIGN = { u0: 0.340, u1: 0.660, z0: 0.305, z1: 0.335 };

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
/** 场坪 + 门口碎石门槛（门槛压住车轮，近墙也要有） */
function ground(b, plane) {
  if (!plane) {
    b.quad([[0.020, 0.020, 0.004], [0.980, 0.020, 0.004], [0.980, 0.980, 0.004], [0.020, 0.980, 0.004]],
      'concrete_pad', [0, 0, 1]);
  }
  for (const [yc, side] of [[A.YF, '+y'], [A.YB, '-y']]) {
    const s = side === '+y' ? 1 : -1;
    // 往里多铺 0.06：盖住 `wall` 洞口底面那一圈**砖色**的门坎（不然门口一条亮红）
    b.box(A.UD0, Math.min(yc - s * 0.060, yc + s * 0.040), 0.000,
      A.UD1, Math.max(yc - s * 0.060, yc + s * 0.040), 0.016, 'gravel', 'gravel');
  }
}

/** 洞内（**只进整栋**，见文件头 ⚠）。全部近黑：4x 下洞内不该有比墙还亮的面 */
function interior(b) {
  const zc = A.Z_DOOR;
  b.quad([[XI0, YI0, Z_FLOOR], [XI1, YI0, Z_FLOOR], [XI1, YI1, Z_FLOOR], [XI0, YI1, Z_FLOOR]],
    'trim_black', [0, 0, 1]);
  b.quad([[XI0, YI0, zc], [XI0, YI1, zc], [XI1, YI1, zc], [XI1, YI0, zc]], 'trim_black', [0, 0, -1]);
  for (const [at, hint] of [[YI0, [0, 1, 0]], [YI1, [0, -1, 0]]]) {
    b.quad([[XI0, at, Z_FLOOR], [XI0, at, zc], [XI1, at, zc], [XI1, at, Z_FLOOR]], 'trim_black', hint);
  }
  for (const [at, side] of [[XI0 + 0.002, '+x'], [XI1 - 0.002, '-x']]) {
    b.face(side, at, YI0, YI1, Z_FLOOR, zc, 'trim_black');
  }
}

/** 屋面（双坡，屋脊沿 y）+ 脊瓦 + 封檐板。所有近墙都整片带上（见文件头 ⚠） */
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
 * 一榀山墙（门 + 门套 + 门楣牌 + 门扇）。
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
  const yIn = at - out * 0.002;                 // 门套 / 牌子的贴面
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
  // 门楣牌（白底，占满过梁）
  const su = seg(side, at, SIGN.u0, SIGN.u1, plane);
  if (su) b.face(side, at + out * 0.003, su[0], su[1], SIGN.z0, SIGN.z1, 'sign_white');
  // 门扇：**不做**。开着的门扇不管怎么摆都会挡在门口
  //   （开 90° 贴内侧墙 ⇒ 45° 视角下正好从门洞看进来是一大块棕板，第一版就是这样）。
  //   库里常年敞着门，门口保持通透；门套 + 门楣牌已经足够读作"车库大门"。
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

// ---------------------------------------------------------------- 整栋 / 近墙
function build(plane) {
  const b = new Builder();
  ground(b, plane);
  if (!plane) interior(b);
  gable(b, '+y', A.YF, +1, plane);
  gable(b, '-y', A.YB, -1, plane);
  sideWall(b, '+x', A.XR, plane);
  sideWall(b, '-x', A.XL, plane);
  roof(b);
  return b;
}

// ---------------------------------------------------------------- 模型清单
const JOBS = [
  { name: 'G1_depot_a', plane: null, why: '库 A 整栋（门朝 ±y，通过式）' },
  { name: 'G1_depot_na', plane: 'A', why: '近墙 A · 剖切面 x+y>1（朝向 v0 用）' },
  { name: 'G1_depot_nb', plane: 'B', why: '近墙 B · 剖切面 x>y（朝向 v1 用）' },
  { name: 'G1_depot_nc', plane: 'C', why: '近墙 C · 剖切面 x<y（朝向 v3 用）' },
];

const HDR = (job) =>
  '# =============================================================================\n'
  + '# ' + job.name + ' —— 机车库「库 A」（' + job.why + '）\n'
  + '#\n'
  + '# 【本文件由 tools/gen-g1-depot.mjs 生成，请勿手改】\n'
  + '#\n'
  + '#   占地 1×1 · 轨道沿 ±y · 勒脚 0.050 / 檐口 0.340 / 屋脊 0.500 / 门洞 0.36×0.30\n'
  + '#   墙体 0.14~0.86 × 0.04~0.96 · 墙厚 0.050 · 出檐 0.035 · 脊瓦顶 0.516\n'
  + '#\n'
  + '#   `zmax` 四个模型全钉 0.5200 ⇒ 同一张分表、同一格位、同一组 xrel/yrel，\n'
  + '#   近墙叠在整栋上严丝合缝（见美术要素方案.md §1.7.7 ②）。\n'
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
  log('生成机车库「库 A」（整栋 + 3 个近墙 = 4 个模型 × 4 朝向 = 16 张精灵）：');
  const made = generateDepots();
  const tot = made.reduce((s, m) => s + m.quads, 0);
  log('');
  log('  合计 ' + made.length + ' 个模型 / ' + tot + ' 个四边形面');
  log('  下一步：node tools/build.mjs --step render → node tools/sprites.mjs');
}
