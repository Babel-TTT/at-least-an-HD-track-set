// =============================================================================
// tools/gen-g1-depot.mjs —— 生成 **车库**「库 A」的 3 个模型
//
//   node tools/gen-g1-depot.mjs                 # 默认风格 brick（旧样式 + 不鲜艳砖色）
//   node tools/gen-g1-depot.mjs --style=red     # 鲜艳红砖
//   node tools/gen-g1-depot.mjs --style=grey    # 青砖
//
// 产出（**整份重写，别手改**）：
//   models/G1_depot_na.model   地面层（场坪/库内地坪/内墙/天花/道砟枕木钢轨 **+ 门套两根立柱**）
//                              —— 画在车**之下**
//   models/G1_depot_a.model    结构层·**近柱在 UD1**（v0 的近侧）  —— 画在车**之上**
//   models/G1_depot_nb.model   结构层·**近柱在 UD0**（v3 的近侧）  —— 槽 3 专用
//
// -----------------------------------------------------------------------------
// 【图层关系（人工实机，2026-11-18）】
//
//        **槽 0/2（na，地面层） → 车 → 槽 1/3/4/5（a / nb，结构层）**
//
// -----------------------------------------------------------------------------
// 【v67：门套立柱按"离镜头远近"拆层（人工 2026-11-19 原话）】
//
//   「类似隧道那样，**远离视角一侧的洞柱图像是在地面层上的**，这样车经过时才能被遮住」
//
//   深度 ≈ x+y（相机在 +x+y）。门在 y=YF，两根立柱分别在 x=UD0 端与 x=UD1 端：
//     v0（深 = x+y）        ：x 大的那根近 ⇒ **近柱 = UD1**，远柱 = UD0
//     v3（深 = 2 − x − y）  ：x 大的那根远 ⇒ **近柱 = UD0**，远柱 = UD1   ← 逐朝向翻转！
//   远柱比车远 ⇒ 必须在车**下面**（`na`）；近柱比车近 ⇒ 必须在车**上面**（结构层）。
//   ⇒ 与 `G1_tunnel_stone` / `G1_tunnel_stone_b` 那对 A/B 组同构。
//
//   落地做法（最省模型数）：
//     · `na` 里**两根都放** —— 远柱天然正确；近柱那根与结构层的复制品逐像素重合，
//       结构层盖在上面，看/用都没有差别。
//     · 结构层按朝向出两版：`a`（近柱 UD1，喂 v0）· `nb`（近柱 UD0，喂 v3）。
//       槽 4/5（门朝远）用 `a` 的 v1/v2 —— 柱子在那两个朝向被墙挡着，无所谓。
//
// -----------------------------------------------------------------------------
// 【形体（格；1 格 = 13.9 m，4x 下 1 px = 0.089 m）· v65 样式】
//
//   占地 1×1 · 端头库房：+y 山墙一樘大门、−y 山墙实墙（+ 一樘高窗）
//   勒脚 0~0.050 · 墙身 0.050~0.340 · 屋脊 0.500
//   墙体 0.14~0.86 × 0.04~0.96（10.0 × 12.8 m）· 墙厚 0.050 · 出檐 0.035
//   门洞 0.36 宽 × 0.30 高（5.0 × 4.2 m）——净高 0.30 是硬指标，车高约 0.29
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
  JAMB: 0.022,                   // 门套宽（挑在墙垛上）
  PROUD: 0.008,                  // 门套挑出墙面
  LIN: 0.008,                    // 门樘内衬厚（贴洞口侧壁，遮住亮砖色）
  PAD0: 0.020, PAD1: 0.980,      // 场坪边
};
const XI0 = A.XL + A.T, XI1 = A.XR - A.T;   // 洞内净空 0.19 / 0.81
const YI0 = A.YB + A.T, YI1 = A.YF - A.T;   // 0.09 / 0.91

/** 侧墙窗（三樘，z 0.215~0.295；4x 下 20 × 12.5 px） */
const WIN = [[0.200, 0.340], [0.420, 0.560], [0.640, 0.780]];
const Z_W0 = 0.215, Z_W1 = 0.295;

/** 后山墙高窗 */
const BWIN = { u0: 0.320, u1: 0.680, z0: 0.215, z1: 0.295 };

/** 门楣牌（白底；三个汉字要 CJK 点阵表，见方案 §1.7.7 ⑤） */
const SIGN = { u0: 0.340, u1: 0.660, z0: 0.305, z1: 0.335 };

// ---------------------------------------------------------------- 风格表
//
// 风格只换**材质名**，几何完全一样 ⇒ 三套的格位、模板、偏移一字不差。
//   brick = 默认（人工 2026-11-19：「建筑样式返回上一种，但是颜色不要那么鲜艳」）
//           ⇒ 形体退回 v65，砖色用更闷的 brick_brown(140,90,68)
const STYLES = {
  brick: { wall: 'brick_brown', roof: 'roof_slate', roofSeam: 'roof_slate_seam', ridge: 'roof_slate_dark' },
  red: { wall: 'brick_red', roof: 'roof_slate', roofSeam: 'roof_slate_seam', ridge: 'roof_slate_dark' },
  grey: { wall: 'brick_grey', roof: 'roof_slate', roofSeam: 'roof_slate_seam', ridge: 'roof_slate_dark' },
};
const argOf = (k, d) => {
  const a = process.argv.find((s) => s.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const STYLE_NAME = argOf('style', 'brick');
const S = STYLES[STYLE_NAME];
if (!S) throw new Error(`未知风格「${STYLE_NAME}」，可用：${Object.keys(STYLES).join(' / ')}`);

/** 固定材质（不随风格变） */
const M = {
  plinth: 'concrete_dark', jamb: 'concrete', sign: 'sign_white',
  frame: 'metal_dark', glass: 'glass_dark', fascia: 'trim_dark',
  floor: 'trim_dark', ceil: 'trim_black', wallIn: 'trim_dark',
  ballast: 'panel_seam', sleeperA: 'wood_dark', sleeperB: 'wood_seam',
};

// ---------------------------------------------------------------- 库内轨道
/**
 * 口径照抄 `models/G1_rail_straight.model`（overlay 那套）：
 *   钢轨 x 0.4444~0.4524 / 0.5476~0.5556，z 0.010~0.023，**贯穿 y 0~1**（rust 身 + metal 顶）；
 *   砟顶 0.0078；枕木 0.012 起步、步距 0.04。⇒ 在瓦片边界上和外线轨逐像素重合。
 */
const TR = {
  B0: 0.3200, B1: 0.6800,
  BED: 0.0078,
  SLEEPER_TOP: 0.0100,
  RAIL_BASE: 0.0100, RAIL_TOP: 0.0230,
  RAIL_X: [[0.4444, 0.4524], [0.5476, 0.5556]],
  SL_STEP: 0.0400, SL_HALF: 0.0900, SL_T: 0.0200,
  SL_Y0: 0.0120, SL_Y1: 0.9880,
};

// ---------------------------------------------------------------- 发射器
class Builder {
  constructor() { this.lines = []; this.quads = 0; }

  quad(pts, mat, hint) {
    const nn = newellRaw(pts);
    if (V.len(nn) < 1e-9) throw new Error('退化面（法线为 0）：' + JSON.stringify(pts));
    const p = V.dot(nn, hint) < 0 ? pts.slice().reverse() : pts;
    this.lines.push('quad ' + p.map((q) => N(q[0]) + ' ' + N(q[1]) + ' ' + N(q[2])).join('  ')
      + '   ' + mat);
    this.quads++;
  }

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

  face(side, at, u0, u1, z0, z1, mat) {
    const hint = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0] }[side];
    const p = (u, z) => (side === '+x' || side === '-x' ? [at, u, z] : [u, at, z]);
    this.quad([p(u0, z0), p(u1, z0), p(u1, z1), p(u0, z1)], mat, hint);
  }

  line(s) { this.lines.push(s); }
  text() { return this.lines.join('\n') + '\n'; }
}

/** 墙身：勒脚（concrete_dark）+ 墙身（wallMat）两段，**都不挖洞**（窗是贴面窗） */
function wall2(b, side, at, u0, u1) {
  b.line(`wall ${side} ${N(at)} ${N(u0)} ${N(u1)} 0.0000 ${N(A.Z_PL)}  ${M.plinth} thick=${N(A.T)}`);
  b.line(`wall ${side} ${N(at)} ${N(u0)} ${N(u1)} ${N(A.Z_PL)} ${N(A.Z_EAVE)}  ${S.wall} thick=${N(A.T)}`);
}

/** 贴面窗（不挖洞）：metal_dark 窗框 + 深色玻璃 + metal_dark 窗台（v65 样式） */
function windowAt(b, side, at, u0, u1, z0, z1) {
  b.line(`win ${side} ${N(at)} ${N(u0)} ${N(u1)} ${N(z0)} ${N(z1)}  ${M.glass}`
    + ` frame=${M.frame} frameW=0.014 mull=2 depth=0.010 inset=0 sill=${M.frame}`);
}

/** 门套立柱（0.022 宽、0.30 高、挑出墙面 0.008） */
function doorPost(b, u0, u1) {
  b.box(u0, A.YF - 0.002, 0.0000, u1, A.YF + A.PROUD, A.Z_DOOR, M.jamb);
}

// =========================================================== 地面层（车之下）
/**
 * `na`：**画在车下面的全部**。车压在钢轨上。
 * 场坪 + 库内地坪（一路铺到门面）+ 内墙 + 天花 + 道砟 + 枕木 + 钢轨 + **门套两根立柱**。
 */
function groundLayer(b) {
  // 场坪（整格）
  b.quad([[A.PAD0, A.PAD0, 0.0040], [A.PAD1, A.PAD0, 0.0040],
    [A.PAD1, A.PAD1, 0.0040], [A.PAD0, A.PAD1, 0.0040]], 'concrete_pad', [0, 0, 1]);
  // 库内地坪（暗灰）：flatiso 不做室内遮蔽，亮材质会让洞内像露天院子。
  // ★ 一路铺到门面（y = YF）⇒ 门洞下沿和库外场坪连成一片（没有凸门槛）。
  b.quad([[XI0, YI0, 0.0046], [XI1, YI0, 0.0046], [XI1, A.YF, 0.0046], [XI0, A.YF, 0.0046]],
    M.floor, [0, 0, 1]);
  // 两侧内墙（暗灰）。后墙内面不另加面：结构层那榀后山墙自己画了双面。
  for (const [at, side] of [[XI0 + 0.002, '+x'], [XI1 - 0.002, '-x']]) {
    b.face(side, at, YI0, A.YF, 0.0046, A.Z_DOOR, M.wallIn);
  }
  // 天花（暗）
  b.quad([[XI0, YI0, A.Z_DOOR], [XI0, A.YF, A.Z_DOOR],
    [XI1, A.YF, A.Z_DOOR], [XI1, YI0, A.Z_DOOR]], M.ceil, [0, 0, -1]);
  // 道砟带（贯穿整格）
  b.box(TR.B0, 0.0000, 0.0000, TR.B1, 1.0000, TR.BED, M.ballast, M.ballast);
  // 枕木（两档交替）
  for (let y = TR.SL_Y0, k = 0; y + TR.SL_T <= TR.SL_Y1 + 1e-9; y += TR.SL_STEP, k++) {
    b.box(0.5 - TR.SL_HALF, y, 0.0000, 0.5 + TR.SL_HALF, y + TR.SL_T, TR.SLEEPER_TOP,
      k % 2 ? M.sleeperB : M.sleeperA, M.sleeperB);
  }
  // 两条钢轨（与 G1_rail_straight 同材质、同 z、贯穿 0~1）
  for (const [x0, x1] of TR.RAIL_X) {
    b.box(x0, 0.0000, TR.RAIL_BASE, x1, 1.0000, TR.RAIL_TOP, 'rust', 'metal');
  }
  // ★ 门套两根立柱都放地面层：远侧那根本来就该被车盖住；
  //   近侧那根在这里只是"垫底"，结构层同一根盖在它上面（逐像素重合）。
  doorPost(b, A.UD0 - A.JAMB, A.UD0);
  doorPost(b, A.UD1, A.UD1 + A.JAMB);
}

// =========================================================== 结构层（车之上）
/**
 * `a` / `nb`：**画在车上面的全部** ⇒ 库内不能有任何面（会把车盖住）。
 * 场坪只铺**墙体外侧一圈**（槽 4/5 只有这一张精灵，得有地给楼站）。
 * `nearPost` = 'UD1'（v0 的近侧）或 'UD0'（v3 的近侧）—— 只画**近侧那一根**立柱。
 */
function structure(b, nearPost) {
  for (const [x0, y0, x1, y1] of [
    [A.PAD0, A.PAD0, A.XL, A.PAD1],        // −x 侧
    [A.XR, A.PAD0, A.PAD1, A.PAD1],        // +x 侧
    [A.XL, A.PAD0, A.XR, A.YB],            // −y 侧（山墙外）
    [A.XL, A.YF, A.XR, A.PAD1],            // +y 侧（门口外）
  ]) {
    b.quad([[x0, y0, 0.0052], [x1, y0, 0.0052], [x1, y1, 0.0052], [x0, y1, 0.0052]],
      'concrete_pad', [0, 0, 1]);
  }
  doorGable(b, nearPost);
  backGable(b);
  sideWall(b, '+x', A.XR);
  sideWall(b, '-x', A.XL);
  roof(b);
}

/** 前山墙（+y，一樘大门）：真洞 + 混凝土门樘内衬 + **近侧那根**立柱 + 门楣牌 */
function doorGable(b, nearPost) {
  // ⚠ `reveal=no`：否则 `wall` 会给洞口四周补面，其中"洞下沿"那条是
  //   横贯门口、亮砖色的假门槛。
  const hole = `${N(A.UD0)},0.0000,${N(A.UD1)},${N(A.Z_DOOR)}`;
  b.line(`wall +y ${N(A.YF)} ${N(A.XL)} ${N(A.XR)} 0.0000 ${N(A.Z_EAVE)}`
    + `  ${hole}  ${S.wall} thick=${N(A.T)} reveal=no`);
  // 勒脚贴面（门洞两侧，不跨门口）
  for (const [u0, u1] of [[A.XL, A.UD0], [A.UD1, A.XR]]) {
    b.face('+y', A.YF + 0.002, u0, u1, 0.0000, A.Z_PL, M.plinth);
  }
  // 门樘内衬（贴在洞口两侧竖壁上，遮住亮砖色）
  for (const [u0, u1] of [[A.UD0, A.UD0 + A.LIN], [A.UD1 - A.LIN, A.UD1]]) {
    b.box(u0, A.YF - A.T, 0.0000, u1, A.YF + 0.001, A.Z_DOOR, M.jamb);
  }
  // ★ 只画近侧那根立柱（远侧那根在 `na` 里）
  if (nearPost === 'UD0') doorPost(b, A.UD0 - A.JAMB, A.UD0);
  else doorPost(b, A.UD1, A.UD1 + A.JAMB);
  // 门楣牌
  b.face('+y', A.YF + 0.003, SIGN.u0, SIGN.u1, SIGN.z0, SIGN.z1, M.sign);
}

/** 后山墙（−y，实墙 + 一樘高窗）：人工「正常背面应该是墙」 */
function backGable(b) {
  wall2(b, '-y', A.YB, A.XL, A.XR);
  windowAt(b, '-y', A.YB - 0.001, BWIN.u0, BWIN.u1, BWIN.z0, BWIN.z1);
}

/** 一榀纵墙（三樘贴面窗） */
function sideWall(b, side, at) {
  wall2(b, side, at, A.YB, A.YF);
  const off = side === '+x' ? 0.001 : -0.001;
  for (const [u0, u1] of WIN) windowAt(b, side, at + off, u0, u1, Z_W0, Z_W1);
}

/** 屋面（双坡，屋脊沿 y，6 × 16 瓦垄 —— v65 样式）+ 脊瓦 + 封檐板 */
function roof(b) {
  const tile = ` tileRows=6 tileCols=16 tileW=0.009 tileMat=${S.roofSeam}`;
  b.line(`gable ${N(A.XL)} ${N(A.YB)} ${N(A.XR)} ${N(A.YF)} ${N(A.Z_EAVE)} ${N(A.Z_RIDGE)}`
    + ` y ${N(A.OVER)}  ${S.roof} side=${S.wall} bottom=trim_dark` + tile);
  // 脊瓦
  b.box(0.478, 0.030, A.Z_RIDGE - 0.014, 0.522, 0.970, A.Z_RIDGE + 0.016, S.ridge, S.ridge);
  // 封檐板
  for (const [x, d] of [[A.XL - A.OVER, -1], [A.XR + A.OVER, 1]]) {
    b.box(d < 0 ? x - 0.006 : x, A.YB - A.OVER, A.Z_EAVE - 0.012,
      d < 0 ? x : x + 0.006, A.YF + A.OVER, A.Z_EAVE + 0.010, M.fascia);
  }
}

// ---------------------------------------------------------------- 模型清单
//
// ⚠ 名字决定分表里的列序（packSheets 按 name 再按 rot 排序）：
//    G1_depot_a  <  G1_depot_na  <  G1_depot_nb   ⇒ 列 0-3 / 4-7 / 8-11
//    ⇒ 既有 `a`、`na` 的 rect 全部不动，只新增 `nb` 四列。
const JOBS = [
  { name: 'G1_depot_a', kind: 'structure', near: 'UD1', why: '结构层·近柱 UD1（v0 用）· 画在车**之上**' },
  { name: 'G1_depot_na', kind: 'ground', why: '地面层（场坪/库内/轨道 + 两根门柱）· 画在车**之下**' },
  { name: 'G1_depot_nb', kind: 'structure', near: 'UD0', why: '结构层·近柱 UD0（v3 用，翻转版）· 画在车**之上**' },
];

const HDR = (job) =>
  '# =============================================================================\n'
  + '# ' + job.name + ' —— 机车库「库 A」（' + job.why + '）\n'
  + '#\n'
  + '# 【本文件由 tools/gen-g1-depot.mjs 生成，请勿手改】风格：' + STYLE_NAME + '\n'
  + '#\n'
  + '#   占地 1×1 · 端头库房（+y 一樘大门 / −y 实墙）· 勒脚 0.050 / 檐口 0.340 / 屋脊 0.500\n'
  + '#   墙体 0.14~0.86 × 0.04~0.96 · 墙厚 0.050 · 出檐 0.035 · 脊瓦顶 0.516\n'
  + '#   库内轨道：道砟 0.32~0.68 / 枕顶 0.010 / 轨顶 0.023（与 G1_rail_straight 同一套，贯穿 y 0~1）\n'
  + '#\n'
  + '#   `zmax` 三个模型全钉 0.5200 ⇒ 同一张分表、同一格位。\n'
  + '#   ⚠ 图层顺序：**na（地面层） → 车 → a / nb（结构层）**。\n'
  + '#   ⚠ 门套立柱按"离镜头远近"拆层：远柱在 na（要被车盖住），近柱在结构层（要盖住车）；\n'
  + '#     而近/远逐朝向翻转（v0 近柱 = UD1，v3 近柱 = UD0）⇒ 结构层两版 `a` / `nb`。\n'
  + '# =============================================================================\n\n';

export function generateDepots() {
  const made = [];
  for (const job of JOBS) {
    const b = new Builder();
    if (job.kind === 'ground') groundLayer(b); else structure(b, job.near);
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
  log('生成机车库「库 A」（风格 ' + STYLE_NAME + '；struct a + ground na + struct nb = 3 个模型 × 4 朝向 = 12 张精灵）：');
  const made = generateDepots();
  const tot = made.reduce((s, m) => s + m.quads, 0);
  log('');
  log('  合计 ' + made.length + ' 个模型 / ' + tot + ' 个四边形面');
  log('  下一步：node tools/build.mjs --step render → node tools/sprites.mjs');
}
