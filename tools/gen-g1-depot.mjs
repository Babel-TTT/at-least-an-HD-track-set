// =============================================================================
// tools/gen-g1-depot.mjs —— 生成 **车库**「库 A 红砖机车库」的 2 个模型
//
//   node tools/gen-g1-depot.mjs                 # 默认风格 red（红砖·灰石棉瓦）
//   node tools/gen-g1-depot.mjs --style=grey    # 青砖·灰瓦
//   node tools/gen-g1-depot.mjs --style=plaster # 水泥抹灰·红瓦
//
// 产出（**整份重写，别手改**）：
//   models/G1_depot_a.model      库 A **结构层**（墙 + 屋面 + 门套 + 楣带）—— 画在车**之上**
//   models/G1_depot_na.model     库 A **地面层**（场坪 + 库内地坪/内墙/天花 + 道砟枕木钢轨）
//                                —— 画在车**之下**
//
// -----------------------------------------------------------------------------
// 【★ 引擎的实际图层关系（人工 2026-11-18 实机指出，三次纠正后定案）】
//
//        **槽 0/2（na，地面层） → 车 → 槽 1/3/4/5（a，结构层）**
//
//   ⇒ `a` 盖住车、车盖住 `na`。所以：
//     · `a` 的门洞必须是一刀真洞（有面就把车盖死）；
//     · 铁轨必须留在 `na`（车压在轨上）；
//     · `a` **不能有库内地面** —— 它画在车上，库内铺任何地坪都会把
//       库内的车、道砟、枕木一起盖住（v66 的「库内一块米色大板」就是这么来的）。
//
// -----------------------------------------------------------------------------
// 【v66 五条修正（人工 2026-11-18 第 4 轮反馈）】
//
//   ① **偏移**：`a` / `na` **同一格位同一偏移**（263×184 ⇒ −131,−52，四朝向全同）。
//      逐朝向不同的 (−3,−116)/(−131,−180)/(−259,−116) 是 flatiso 按"绕占地中心旋转后
//      模型自身原点的位置"算的，**不是**引擎要的瓦片原点 ⇒ 一律不用（见工具口径）。
//   ② **门洞落地**：门洞下沿不留任何面。`wall` 的 `reveal=no` 去掉洞口四周的
//      补面（其中"洞下沿"那条是横贯门口、亮砖色的**假门槛**），门洞两侧另用
//      **混凝土门樘盒子**贴住（真几何，不是共面贴片 ⇒ 不会闪）。
//   ③ **地面只留一份在 `a` 之外**：`a` 的场坪只铺**墙体外侧一圈**
//      （x 0.02~0.14 / 0.86~0.98、y 0.02~0.04 / 0.96~0.98），库内一律不铺。
//      v66 之前是两条通长的板条，穿过库内 ⇒ 库内一道凸起的"门槛"。
//   ④ **门槛只留 `na` 一条，且与地坪齐平**：(v66) 直接删掉凸出 0.016 的碎石条，
//      改由库内地坪一路铺到门面（y 到 0.96）+ 轨枕钢轨铺到瓦片边（y 0~1）。
//      ⇒ 门口的地面是**连续的**，没有台阶、没有第二道门槛。
//   ⑤ **风格**：红砖 + 白漆窗套 + 水泥勒脚 + 水泥檐口压顶 + 石棉瓦（大张、无横缝），
//      而不是"欧式页岩瓦 + 窄条黑窗"。窗改**贴面窗**（不挖洞）：
//      4x 下挖洞的洞壁是亮砖色、还会和窗框打架，贴面窗反而干净。
//
// -----------------------------------------------------------------------------
// 【形体（格；1 格 = 13.9 m，4x 下 1 px = 0.089 m）】
//
//   占地 1×1 · 端头库房：+y 山墙一樘大门、−y 山墙实墙（+ 一樘高窗）
//   勒脚 0~0.055 · 墙身 0.055~0.340 · 檐口压顶 0.300~0.336 · 屋脊 0.500
//   墙体 0.14~0.86 × 0.04~0.96（10.0 × 12.8 m）· 墙厚 0.050 · 出檐 0.032
//   门洞 0.40 宽 × 0.30 高（5.6 × 4.2 m）——净高 0.30 是硬指标，车高约 0.29
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
  Z_PL: 0.055,                   // 勒脚顶（砖墙起点）
  Z_EAVE: 0.340,                 // 檐口（4.7 m）
  Z_RIDGE: 0.500,                // 屋脊（6.9 m）
  Z_DOOR: 0.300,                 // 门洞净高（4.2 m）
  UD0: 0.300, UD1: 0.700,        // 门洞（0.40 格 = 5.6 m）
  OVER: 0.032,                   // 出檐
  JAMB: 0.026,                   // 门套宽（挑在墙垛上）
  LIN: 0.008,                    // 门樘内衬厚（贴在洞口侧壁上，遮住亮砖色）
  PAD0: 0.020, PAD1: 0.980,      // 场坪边
  Z_COR: 0.300, Z_COR1: 0.336,   // 檐口压顶（同时是门楣过梁）
};
const XI0 = A.XL + A.T, XI1 = A.XR - A.T;   // 洞内净空 0.19 / 0.81
const YI0 = A.YB + A.T, YI1 = A.YF - A.T;   // 0.09 / 0.91

/** 侧墙窗（三樘贴面窗，z 0.150~0.270） */
const WIN = [[0.150, 0.310], [0.420, 0.580], [0.690, 0.850]];
const Z_W0 = 0.150, Z_W1 = 0.270;

/** 后山墙高窗 */
const BWIN = { u0: 0.340, u1: 0.660, z0: 0.200, z1: 0.280 };

/** 砖垛（侧墙外皮上的竖壁柱，避开窗） */
const PIL = [0.365, 0.635];
const PIL_W = 0.030, PIL_P = 0.012;

/** 门楣牌（白底；三个汉字要 CJK 点阵表，本轮先留白 —— 见方案 §1.7.7 ⑤） */
const SIGN = { u0: 0.360, u1: 0.640, z0: 0.306, z1: 0.330 };

// ---------------------------------------------------------------- 风格表
//
// 风格只换**材质名**，几何完全一样 ⇒ 三套的格位、模板、偏移一字不差。
//   红砖  = 国内 80~90 年代工矿库房最常见的「红砖 + 白漆窗 + 水泥勒脚 + 灰石棉瓦」
//   青砖  = 清水青砖 + 灰瓦（更老、江南/民国风味）
//   抹灰  = 水泥砂浆抹面 + 红瓦（更"厂", 也更像 90 年代后的段修库）
const STYLES = {
  red: {
    wall: 'brick_red', wallSeam: 'brick_seam',
    roof: 'roof_slate', roofSeam: 'roof_slate_seam', ridge: 'roof_slate_dark',
    band: 'concrete', plinth: 'concrete_dark', fascia: 'concrete',
    frame: 'trim_white', glass: 'glass_dark', sill: 'concrete', jamb: 'concrete',
  },
  grey: {
    wall: 'brick_grey', wallSeam: 'brick_grey_seam',
    roof: 'roof_slate', roofSeam: 'roof_slate_seam', ridge: 'roof_slate_dark',
    band: 'concrete', plinth: 'concrete_dark', fascia: 'concrete',
    frame: 'trim_white', glass: 'glass_dark', sill: 'concrete', jamb: 'concrete',
  },
  plaster: {
    wall: 'plaster_grey', wallSeam: 'plaster_grey_seam',
    roof: 'roof_tile', roofSeam: 'roof_tile_seam', ridge: 'roof_tile_dark',
    band: 'plaster_white', plinth: 'concrete_dark', fascia: 'plaster_white',
    frame: 'trim_white', glass: 'glass_blue', sill: 'concrete', jamb: 'plaster_white',
  },
};
const argOf = (k, d) => {
  const a = process.argv.find((s) => s.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const STYLE_NAME = argOf('style', 'red');
const S = STYLES[STYLE_NAME];
if (!S) throw new Error(`未知风格「${STYLE_NAME}」，可用：${Object.keys(STYLES).join(' / ')}`);

// ---------------------------------------------------------------- 库内轨道
/**
 * 库内轨道口径**照抄直线轨 `models/G1_rail_straight.model`**（overlay 那套）：
 *   两条钢轨 x 0.4444~0.4524 / 0.5476~0.5556，z 0.010~0.023，**贯穿 y 0~1**
 *   （rust 侧面 + metal 顶面）；砟顶 0.0078；枕木 0.012 起步、步距 0.04。
 * ⇒ 库里的轨和门外的直线轨是同一副样子，而且**在瓦片边界上对得上**。
 */
const TR = {
  B0: 0.3200, B1: 0.6800,                          // 道砟带宽（与洞内一致）
  BED: 0.0078,                                     // 砟顶
  SLEEPER_TOP: 0.0100,
  RAIL_BASE: 0.0100, RAIL_TOP: 0.0230,
  RAIL_X: [[0.4444, 0.4524], [0.5476, 0.5556]],    // 两条钢轨的 x 区间（1435mm）
  SL_STEP: 0.0400, SL_HALF: 0.0900, SL_T: 0.0200,  // 枕木：沿 x 长 0.18、厚 0.02、间距 0.04
  SL_Y0: 0.0120, SL_Y1: 0.9880,
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
    if (top) {
      this.quad([p(a, z1), p(b, z1), p(c, z1), p(d, z1)], top, [0, 0, 1]);
      this.quad([p(a, z0), p(b, z0), p(c, z0), p(d, z0)], mat, [0, 0, -1]);
    } else {
      this.quad([p(a, z1), p(b, z1), p(c, z1), p(d, z1)], mat, [0, 0, 1]);
      this.quad([p(a, z0), p(b, z0), p(c, z0), p(d, z0)], mat, [0, 0, -1]);
    }
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

/**
 * 墙身：勒脚（`concrete_dark`）+ 墙身（`wallMat`）两段，**都不挖洞**。
 * `wall` 构件在这里只当"有厚度的墙板"用（thick=墙厚）。
 */
function wall2(b, side, at, u0, u1, wallMat) {
  b.line(`wall ${side} ${N(at)} ${N(u0)} ${N(u1)} 0.0000 ${N(A.Z_PL)}  ${S.plinth} thick=${N(A.T)}`);
  b.line(`wall ${side} ${N(at)} ${N(u0)} ${N(u1)} ${N(A.Z_PL)} ${N(A.Z_EAVE)}  ${wallMat} thick=${N(A.T)}`);
}

/** 贴面窗（**不挖洞**）：白漆窗框 + 深色玻璃 + 混凝土窗台 */
function windowAt(b, side, at, u0, u1, z0, z1) {
  b.line(`win ${side} ${N(at)} ${N(u0)} ${N(u1)} ${N(z0)} ${N(z1)}  ${S.glass}`
    + ` frame=${S.frame} frameW=0.013 mull=2 depth=0.010 inset=0 sill=${S.sill}`);
}

// =========================================================== 地面层（车之下）
/**
 * `na`：**画在车下面的全部**。车压在钢轨上。
 * 场坪 + 库内地坪（一路铺到门面）+ 内墙 + 天花 + 道砟 + 枕木 + 两条钢轨。
 * ⚠ 这里**没有**任何凸起的门槛：门口就是库内地坪的延续。
 */
function groundLayer(b) {
  // 场坪（整格）
  b.quad([[A.PAD0, A.PAD0, 0.0040], [A.PAD1, A.PAD0, 0.0040],
    [A.PAD1, A.PAD1, 0.0040], [A.PAD0, A.PAD1, 0.0040]], 'concrete_pad', [0, 0, 1]);
  // 库内地坪（暗灰）：flatiso 不做室内遮蔽，亮材质会让洞内像露天院子。
  // ★ 一路铺到 **门面**（y = YF），门洞下沿因此和库外的场坪连成一片。
  b.quad([[XI0, YI0, 0.0046], [XI1, YI0, 0.0046], [XI1, A.YF, 0.0046], [XI0, A.YF, 0.0046]],
    'trim_dark', [0, 0, 1]);
  // 两侧内墙（暗灰）。⚠ 后墙内面**不另加面**：结构层那榀后山墙自己画了双面。
  for (const [at, side] of [[XI0 + 0.002, '+x'], [XI1 - 0.002, '-x']]) {
    b.face(side, at, YI0, A.YF, 0.0046, A.Z_DOOR, 'trim_dark');
  }
  // 天花（暗）：洞顶，遮住"往上看到屋面内面"的亮块
  b.quad([[XI0, YI0, A.Z_DOOR], [XI0, A.YF, A.Z_DOOR],
    [XI1, A.YF, A.Z_DOOR], [XI1, YI0, A.Z_DOOR]], 'trim_black', [0, 0, -1]);
  // 道砟带（贯穿整格，与门外直线轨的道砟接得上）
  b.box(TR.B0, 0.0000, 0.0000, TR.B1, 1.0000, TR.BED, 'panel_seam', 'panel_seam');
  // 枕木（暗色两档交替，避免整条枕木带糊成一片）
  for (let y = TR.SL_Y0, k = 0; y + TR.SL_T <= TR.SL_Y1 + 1e-9; y += TR.SL_STEP, k++) {
    b.box(0.5 - TR.SL_HALF, y, 0.0000, 0.5 + TR.SL_HALF, y + TR.SL_T, TR.SLEEPER_TOP,
      k % 2 ? 'wood_seam' : 'wood_dark', 'wood_seam');
  }
  // 两条钢轨（与 G1_rail_straight 同材质、同 z、贯穿 0~1）
  for (const [x0, x1] of TR.RAIL_X) {
    b.box(x0, 0.0000, TR.RAIL_BASE, x1, 1.0000, TR.RAIL_TOP, 'rust', 'metal');
  }
}

// =========================================================== 结构层（车之上）
/**
 * `a`：**画在车上面的全部** ⇒ 库内不能有任何面（会把车盖住）。
 * 场坪只在**墙体外侧铺一圈**（北侧两个朝向只有这一张精灵，得有地给楼站）。
 */
function structure(b) {
  for (const [x0, y0, x1, y1] of [
    [A.PAD0, A.PAD0, A.XL, A.PAD1],        // −x 侧
    [A.XR, A.PAD0, A.PAD1, A.PAD1],        // +x 侧
    [A.XL, A.PAD0, A.XR, A.YB],            // −y 侧（山墙外）
    [A.XL, A.YF, A.XR, A.PAD1],            // +y 侧（门口外）
  ]) {
    b.quad([[x0, y0, 0.0052], [x1, y0, 0.0052], [x1, y1, 0.0052], [x0, y1, 0.0052]],
      'concrete_pad', [0, 0, 1]);
  }
  doorGable(b);
  backGable(b);
  sideWall(b, '+x', A.XR);
  sideWall(b, '-x', A.XL);
  cornice(b);
  roof(b);
}

/** 前山墙（+y，一樘大门）：真洞 + 混凝土门樘 + 楣带 + 门楣牌 */
function doorGable(b) {
  // ⚠ `reveal=no`：否则 `wall` 会给洞口四周补面，其中"洞下沿"那条是
  //   横贯门口、亮砖色的**假门槛**（v65 实机/出图里那条红横杠）。
  const hole = `${N(A.UD0)},0.0000,${N(A.UD1)},${N(A.Z_DOOR)}`;
  b.line(`wall +y ${N(A.YF)} ${N(A.XL)} ${N(A.XR)} 0.0000 ${N(A.Z_EAVE)}`
    + `  ${hole}  ${S.wall} thick=${N(A.T)} reveal=no`);
  // 勒脚贴面（门洞两侧，不跨门口）
  for (const [u0, u1] of [[A.XL, A.UD0], [A.UD1, A.XR]]) {
    b.face('+y', A.YF + 0.002, u0, u1, 0.0000, A.Z_PL, S.plinth);
  }
  // 门樘内衬（真几何：贴在洞口两侧的竖壁上，遮住亮砖色）
  for (const [u0, u1] of [[A.UD0, A.UD0 + A.LIN], [A.UD1 - A.LIN, A.UD1]]) {
    b.box(u0, A.YF - A.T, 0.0000, u1, A.YF + 0.001, A.Z_DOOR, S.jamb);
  }
  // 门套（混凝土，挑在墙垛上 0.008）
  for (const [u0, u1] of [[A.UD0 - A.JAMB, A.UD0], [A.UD1, A.UD1 + A.JAMB]]) {
    b.box(u0, A.YF - 0.002, 0.0000, u1, A.YF + 0.008, A.Z_DOOR, S.jamb);
  }
}

/** 后山墙（−y，实墙 + 一樘高窗）：人工「正常背面应该是墙」 */
function backGable(b) {
  wall2(b, '-y', A.YB, A.XL, A.XR, S.wall);
  windowAt(b, '-y', A.YB - 0.001, BWIN.u0, BWIN.u1, BWIN.z0, BWIN.z1);
}

/** 一榀纵墙（三樘贴面窗 + 两道砖垛） */
function sideWall(b, side, at) {
  wall2(b, side, at, A.YB, A.YF, S.wall);
  for (const [u0, u1] of WIN) windowAt(b, side, at + (side === '+x' ? 0.001 : -0.001), u0, u1, Z_W0, Z_W1);
  const s = side === '+x' ? 1 : -1;
  for (const y of PIL) {
    b.box(Math.min(at, at + s * PIL_P), y - PIL_W / 2, A.Z_PL,
      Math.max(at, at + s * PIL_P), y + PIL_W / 2, A.Z_COR, S.wall);
  }
}

/** 檐口压顶（水泥一圈，同时当门楣过梁）+ 门楣牌 */
function cornice(b) {
  b.box(A.XL - 0.008, A.YB - 0.008, A.Z_COR, A.XR + 0.008, A.YF + 0.008, A.Z_COR1, S.band);
  b.face('+y', A.YF + 0.0105, SIGN.u0, SIGN.u1, SIGN.z0, SIGN.z1, 'sign_white');
}

/** 屋面（双坡，屋脊沿 y）：石棉瓦大张（无横缝）+ 脊瓦 + 封檐板 */
function roof(b) {
  // tileRows=1 ⇒ 不画横向搭接缝（大片石棉瓦）；tileCols ⇒ 沿脊的板肋（顺坡向下）
  const tile = ` tileRows=1 tileCols=22 tileW=0.006 tileMat=${S.roofSeam}`;
  b.line(`gable ${N(A.XL)} ${N(A.YB)} ${N(A.XR)} ${N(A.YF)} ${N(A.Z_EAVE)} ${N(A.Z_RIDGE)}`
    + ` y ${N(A.OVER)}  ${S.roof} side=${S.wall} bottom=trim_dark` + tile);
  // 脊瓦
  b.box(0.478, 0.026, A.Z_RIDGE - 0.014, 0.522, 0.974, A.Z_RIDGE + 0.016, S.ridge, S.ridge);
  // 封檐板（两侧檐口）
  for (const [x, d] of [[A.XL - A.OVER, -1], [A.XR + A.OVER, 1]]) {
    b.box(d < 0 ? x - 0.006 : x, A.YB - A.OVER, A.Z_EAVE - 0.014,
      d < 0 ? x : x + 0.006, A.YF + A.OVER, A.Z_EAVE + 0.008, S.fascia);
  }
}

// ---------------------------------------------------------------- 模型清单
const JOBS = [
  { name: 'G1_depot_a', kind: 'structure', why: '结构层（墙/屋面/门樘/楣带）· 画在车**之上**' },
  { name: 'G1_depot_na', kind: 'ground', why: '地面层（场坪/库内/道砟枕木钢轨）· 画在车**之下**' },
];

const HDR = (job) =>
  '# =============================================================================\n'
  + '# ' + job.name + ' —— 机车库「库 A」（' + job.why + '）\n'
  + '#\n'
  + '# 【本文件由 tools/gen-g1-depot.mjs 生成，请勿手改】风格：' + STYLE_NAME + '\n'
  + '#\n'
  + '#   占地 1×1 · 端头库房（+y 一樘大门 / −y 实墙）· 勒脚 0.055 / 檐口 0.340 / 屋脊 0.500\n'
  + '#   墙体 0.14~0.86 × 0.04~0.96 · 墙厚 0.050 · 出檐 0.032 · 脊瓦顶 0.516\n'
  + '#   库内轨道：道砟 0.32~0.68 / 枕顶 0.010 / 轨顶 0.023（与库外 G1_rail_straight 同一套）\n'
  + '#\n'
  + '#   `zmax` 两个模型全钉 0.5200 ⇒ 同一张分表、同一格位、同一组 xrel/yrel（−131,−52）。\n'
  + '#   ⚠ 图层顺序：**na（地面层） → 车 → a（结构层）**。\n'
  + '#     所以 `a` 的门洞必须是一刀真洞（有面就把车盖死），且 **`a` 里没有库内地面**；\n'
  + '#     钢轨必须留在 `na`（车压在上面），并贯穿到瓦片边（y 0~1）才和门外的轨接得上。\n'
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
  log('生成机车库「库 A」（风格 ' + STYLE_NAME + '；结构层 a + 地面层 na = 2 个模型 × 4 朝向 = 8 张精灵）：');
  const made = generateDepots();
  const tot = made.reduce((s, m) => s + m.quads, 0);
  log('');
  log('  合计 ' + made.length + ' 个模型 / ' + tot + ' 个四边形面');
  log('  下一步：node tools/build.mjs --step render → node tools/sprites.mjs');
}
