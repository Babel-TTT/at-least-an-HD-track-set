// =============================================================================
// tools/gen-a10-slab.mjs —— A10 组（`SGCA` 高速无砟 CRTS III）模型生成器
//
// 人工 2026-10-05 批准新建（铁律 L3 的申请），**只写 `models/G8_*.model`**。
//
// 口径（A10 确认门，人工裁定「全部按拟采用执行」）：
//   道床 `BAL-G` 无砟·CRTS III / 双块式 · 轨枕 `SLE-4` 双块式 · 钢轨 `RAI-3` 长轨
//   洞口 `TUN-4` 高速大跨度环框拱（帽檐）· 电气化 `EL-25` + `PYL-S1` H 型钢（无牌）
//   C8：速度 **0 = 无限制**（wiki：`speed_limit: 0` 即无限制）· 费用 40/20 · 地图色 0x63
//       `SORT_ELECTRIC` · **禁止平交道口** · 曲线 1.0 · 局部 id 19
//
// -----------------------------------------------------------------------------
// 为什么**从既有模型派生**（而不是重新画）
// -----------------------------------------------------------------------------
// A15 / A5 / A3 一路验证过的做法：从**结构最接近**的既有 `.model` 读文本、按规则改写。
// 本轮的两个源：
//
//   * **轨道 ← `G4_*`（A12 `SAC3` 的整体道床地铁）**
//     它是全包里唯一一组「**无砟板 + 板带式的扣件/块 + 钢轨**」的模型，而且
//     三个发射器（直向 `box` / 斜向 `prism` / 坡道 `quad`）的几何都是**实机返工过三轮**
//     才对的（见 `docs/建模经验.md` §4.11~§4.13）—— 重画等于把那些坑再趟一遍。
//     `BAL-G` 与 `BAL-H` 的差别只有四条，全都能在文本层面做：
//       ① 去掉**第三轨 + 罩**（`SGCA` 是 25kV 架空接触网，没有供电轨）
//       ② 板面从「一整块」改成「**两条承轨台 + 三条低带**」（= 自密实层/板面低带的台阶）
//       ③ `granite_grey` 的小扣件座 → `concrete` 的**双块式混凝土块**（SLE-4）
//       ④ `rust`/`metal` 的旧轨 → `metal_dark`/`metal_pale` 的**长轨**（RAI-3）
//
//   * **洞口 ← `G3_tunnel3*`（A3 的 TUN-3 现代混凝土端墙拱）**
//     它已经是「**提亮过的现代混凝土 + 顶部截水沟**」的拱形洞门，且**没有** TUN-6 那圈
//     加固环框（TUN-4 要的是**帽檐**，另加比拆掉简单）。TUN-4 = 它再
//       ① 端墙加宽到 **0.80 格**、洞跨加宽到 **0.40 格**、拱顶抬到 **0.215**
//       ② 洞内道床 `gravel` → `concrete_mid`（无砟）、钢轨按 RAI-3 换色
//       ③ 洞口正面上方**新增一圈挑出的帽檐**（含**手写的底面** —— 这是 TUN-5 那轮的教训）
//       ④ **洞门配色**（人工 2026-10-06）：「高铁的隧道应该换用**更灰**而不是更暖的混凝土。
//          **顶坡**则改成**暖色水泥**材质」⇒ 洞门结构（源 `concrete` 暖亮）→ 冷灰
//          `concrete_mid`；顶坡（仰面）+ 顶坡侧面（源 `dirt` 土黄）→ 暖色水泥 `concrete`。
//          只用 **z 高度** 把洞门与洞内道床分开（0.0300 空档），判据与理由见 `retintTunnel()`。
//
// -----------------------------------------------------------------------------
// 铁律（照着做，别绕）
// -----------------------------------------------------------------------------
//   * **轨顶 `z = 0.0230` 一个数都不许动** —— 动了车会浮起来 / 沉下去（G2 那轮人工定的）。
//     所以"承轨台"只能靠**把板面其余部分降下去**做出来，不能把台子抬起来。
//   * **A 组 / B 组的分层原样保留**：洞口那四个模型是「`tunnels:` 远/近半 × `tunnel_overlay:`
//     近/远半」，派生时**逐文件独立改写**就不会破坏它；帽檐在拱顶之上，按
//     `archBeam()` 那条「拱顶以上整块归 overlay、不参与左右切分」的裁定
//     **两个 overlay 模型各加一份**。
//   * **只写 `models/G8_*.model`**，`src/` 下的模板 / spriteset / railtype 一律手写 `edit`。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { ROOT, log, rel, isMain } from './util.mjs';

// ---------------------------------------------------------------- 口径常量
const BAND = [0.3200, 0.6800];        // 道床板带（与 G1 / A12 同宽 0.36 格 = 5.0 m）
const SLAB_Z = 0.0100;                // 板顶（= 承轨台面；A12 也是这个值，**不动**）
const LOW_Z = 0.0025;                 // 板面低带（自密实层一侧）顶面 ⇒ 台阶 0.0075 格 = 1.2 px
const RAILS = [0.4484, 0.5516];       // 钢轨中心（= 1435mm，与全包一致）
const TAI_HW = 0.0200;                // 承轨台半宽 ⇒ 台宽 0.040 格 = 0.56 m（居中于钢轨）
const RAIL_HW = 0.0040;               // 钢轨半宽（= RAI-1 的值，RAI-3 不改几何）

const EPS = 0.0008;                   // 顶面换材质时的微小抬升（与 A12 同值）
const MAT = {
  tai: 'concrete',                    // 承轨台（暖灰白，比低带亮）
  low: 'concrete_mid',                // 板面低带（中性冷灰）
  blk: 'concrete',                    // SLE-4 双块式块（与承轨台同色 ⇒ 靠**凸出板面**与台面区分）
  rail: 'metal_dark',                 // RAI-3 侧面/轨腰（长轨：亮钢，不是锈）
  railTop: 'metal_pale',              // RAI-3 顶面（最亮的一层）
  bore: 'concrete_mid',               // 洞内道床（无砟）
  // ★ TUN-4 的洞门配色（人工 2026-10-06：「高铁的隧道应该换用**更灰**而不是更暖的混凝土。
  //   **顶坡**则改成**暖色水泥**材质」）：
  //     portal = 洞门结构（端墙正/侧/顶、压顶、石梁、墙脚、翼墙立三角、山体侧壁、拱圈…）
  //              由源里的 `concrete`(186,182,173 暖) 改成**冷灰** `concrete_mid`
  //              —— 即 2026-10-03 人工为混凝土定的那档「(160,160,160) 左右」的中性灰
  //              （源是 `tools/flatiso/core/materials.mjs` 的**本地新增**，见 VENDORED.md）。
  //     hill   = 顶坡（仰面）+ 顶坡侧面，源里是 `dirt`(138,115,88 土黄) ⇒ 换成**暖色水泥**
  //              `concrete`(186,182,173)。所以这轮的动作是**把暖色从墙上挪到坡上**：
  //              洞门 = 冷灰、坡 = 暖灰（渲出来墙 ≈(167,164,164) vs 坡 ≈(181,173,163)，
  //              R−B 由 3 拉到 18，一眼分得开；与 TUN-5 地铁洞门「全 `concrete_mid`」的区别
  //              就落在顶坡这一块上）。
  portal: 'concrete_mid',
  hill: 'concrete',
};

const fmt = (v) => Number(v).toFixed(4);
const N = (v) => Number(Number(v).toFixed(6));

// =============================================================================
// 一、通用：多边形的三个发射器（**与 tools/gen-a12-metro.mjs 同源逐字**）
//
//   为什么不 import：那两个发射器里每一行都对应一次实机返工（斜向"铺满整格再裁"、
//   探出 `OVER` 盖接缝），分家之后各自演进更安全；这里只抄**当前**这一版的口径，
//   并在下面注明来源。改口径时两个文件要一起改。
// =============================================================================
const OVER = 0.03125;                 // 1/32 格：**斜向 / 岔口**沿用（见文件头）
// ★★ 人工 2026-10-08：「这几种铁路铁的**水平轨超出边界太多**，但是**道床伸出量不够**，
//    以及**上下坡铁轨的铁轨长度不够**」⇒ 把"钢轨"与"道床"两个探出量**分开**（原来是同一个 OVER）：
const OVER_RAIL = 0.0234375;          // 钢轨沿轨探出 **3/128 格**（原 1/32；先试过 1/64 —— 人工 2026-10-08「又缩短太多了」；坡道原来 0 ⇒ 这里同时是**加长**）
// ⚠ 道床**不再放大**（人工 2026-10-08：「半格铁轨现在没有枕木」）：探出去的精灵会盖住
//   邻格的内容 —— 道床探 1/16（8.9px）时把斜向半格的枕木盖掉了。道床维持原 `OVER`（1/32）。

/** 有向面积 */
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

/** 斜向映射：局部 (x 沿轨, y 横向) → 世界 (x,y)，轨道线为 x+y = 0.5 */
const mapD = (x, y) => [(y + (x - 0.5)) / 2, (y - (x - 0.5)) / 2];

function emitBox(L, b) {
  // ★ 人工 2026-10-08：道床的探出量**试过 1/16，实机证明会把邻格（斜向半格）的枕木盖掉**
  //   ⇒ 回到 `OVER = 1/32`（"道床伸出量不够"只对 A8 那块 ±0.005 的板成立，已用 apron 补上）。
  const o = b.long ? OVER : 0;
  L.push(`box ${fmt(b.x0 - o)} ${fmt(b.y0)} ${fmt(b.z0)}  ${fmt(b.x1 + o)} ${fmt(b.y1)} ${fmt(b.z1)}   `
    + `${b.mat}${b.top ? ` top=${b.top}` : ''}`);
}

function emitDiag(L, b) {
  const X0 = b.long ? -1 : b.x0;
  const X1 = b.long ? 2 : b.x1;
  const poly = clipTile(ccw([
    mapD(X0, b.y0), mapD(X1, b.y0), mapD(X1, b.y1), mapD(X0, b.y1),
  ]), b.long ? OVER : 0);
  if (poly.length < 3) return;
  const P = poly.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join('  ');
  if (b.top) {
    L.push(`prism ${fmt(b.z0)} ${fmt(b.z1 - EPS)}  ${b.mat}  ${P}`);
    L.push(`poly ${fmt(b.z1)}  ${b.top}  ${P}`);
  } else {
    L.push(`prism ${fmt(b.z0)} ${fmt(b.z1)}  ${b.mat}  ${P}`);
  }
}

const RISE = 0.2041;                  // 一格坡道抬高（与 gen-g1-slope / A12 同源）
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

// ---------------------------------------------------------------- 板面（BAL-G）
/** `/BAL-G` 的板面 = **两条承轨台**（坐在钢轨正下方）+ **三条低带**（中央 + 两侧外缘）
 *
 *   ⚠ **钢轨必须始终坐在 0.0100 的台面上** —— 所以是"把别处降下去"而不是"把台子抬起来"，
 *     轨顶 0.0230 一个数没动（见文件头铁律）。
 *   ⚠ 台宽 0.040（±0.020）是**可见性下限**：再窄在 4x 下就只有 2~3 px，看不出是"台"了。
 */
const STRIPS = (() => {
  const out = [];
  let cur = BAND[0];
  for (const c of RAILS) {
    const a = N(c - TAI_HW), b = N(c + TAI_HW);
    out.push({ y0: cur, y1: a, z1: LOW_Z, mat: MAT.low });
    out.push({ y0: a, y1: b, z1: SLAB_Z, mat: MAT.tai });
    cur = b;
  }
  out.push({ y0: cur, y1: BAND[1], z1: LOW_Z, mat: MAT.low });
  return out;
})();

/** 把板面按发射器吐出来（`kind` = box / diag / sheared） */
function emitSlab(L, kind) {
  for (const s of STRIPS) {
    const b = { long: true, x0: 0, x1: 1, y0: s.y0, y1: s.y1, z0: 0, z1: s.z1, mat: s.mat };
    if (kind === 'box') emitBox(L, b);
    else if (kind === 'diag') emitDiag(L, b);
    else emitSheared(L, b);
  }
}

/** 交叉的道床板：X 带（横向 = y）+ **两个 Y 带**（横向 = x）各拆成 5 条
 *
 *   ★★ 人工 2026-10-08：「**只有 SGCA 的交叉轨道板需要延伸**」（先前那句"SGCA 的轨道板"
 *   我误落到了**直向**板上，人工随即更正）。根因与本轮的实测数字：
 *
 *   ① 直向板的探出量是 **`OVER` = 1/32 格**（沿轨 4.47px，见 `emitBox`），所以**邻格那件
 *      直向板会探进交叉瓦片 4.47px**，它的**端面**（法线 +x / +y 的那张竖面，材质
 *      `concrete_mid`，渲出来比板面暗 ~25 档）就停在**瓦片边内侧 4.47px 处**。
 *   ② 交叉这一格画得**比远处邻格晚**（x+y 更大 = 更近）⇒ 本该由**交叉自己的板**盖住那条端面；
 *      可这版十字板的四条臂**正好停在瓦片边上**（不挂 `long`，抄自 A12 `slabCrossing()`），
 *      叠加 δ 偏移后还短 1.79px ⇒ 缝上留一条**暗线**。
 *   ③ **实测剖面**（把交叉瓦片与四邻摆成一格链、按模板值合成，沿接缝法线取 20px 平均亮度，
 *      见 `out/rimg/sgca_crossing_slab_ab.png`）：交叉|−x 缝最低 **126.7**，
 *      而**同样条件下的"直|直"缝**（两块 `G8_track_x` 之间）是 **134.4** —— 多暗那 8 档
 *      就是邻格端面露出来的部分。
 *
 *   ⇒ 与 **A8 / A25 / A12 同口径**：十字板的**四条臂各沿自己的臂方向探出 `OVER`**。
 *   ⚠ 只探"沿臂方向"：X 带探 ±x、两个 Y 带探 ±y；**横向（板带宽度 / 条带位置）一个数不动**。
 *   ⚠ 探出去的部分落在 **+x / +y 侧**会被后画的邻格盖掉（不可见），落在 **−x / −y 侧**
 *     正好盖住邻格端面 —— 两侧都只有好处。
 */
function emitCrossingSlab(L) {
  const strip = (x0, x1, y0, y1, z1, mat) => emitBox(L, { x0, x1, y0, y1, z0: 0, z1, mat });
  for (const s of STRIPS) strip(-OVER, 1 + OVER, s.y0, s.y1, s.z1, s.mat);            // X 带 → ±x
  for (const [ya, yb] of [[-OVER, BAND[0]], [BAND[1], 1 + OVER]]) {                  // 两个 Y 带 → ±y
    for (const s of STRIPS) strip(s.y0, s.y1, ya, yb, s.z1, s.mat);
  }
}

// =============================================================================
// 二、读源模型 + 逐行改写
// =============================================================================
const SRC_DIR = path.join(ROOT, 'models');

function readSrc(name) {
  return fs.readFileSync(path.join(SRC_DIR, `${name}.model`), 'utf8').split('\n');
}

/** 取一个图元的顶点（世界坐标），`box` 取四个角 */
function verticesOf(kw, t) {
  if (kw === 'box') {
    const [, x0, y0, , x1, y1] = t.map(Number);
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }
  const pts = [];
  if (kw === 'quad') {
    for (let i = 0; i < 4; i++) pts.push([Number(t[1 + i * 3]), Number(t[2 + i * 3])]);
  } else if (kw === 'prism' || kw === 'poly') {
    for (let i = 0; i < t.length; i++) {
      if (!t[i].includes(',')) continue;
      const [x, y] = t[i].split(',').map(Number);
      pts.push([x, y]);
    }
  }
  return pts;
}

/** 判断一个图元是不是「第三轨 / 罩」
 *
 *   `SGCA` 是 25kV 架空接触网、没有供电轨 ⇒ A12 里的第三轨（`rust`）与罩（`wood_dark`）
 *   整族都要删。判据 = **材质闸门 + 横向带宽**，两条缺一不可：
 *
 *   ① **材质闸门**：只可能是 `rust` / `metal`（第三轨本体与它的顶面）、
 *      `wood_dark` / `wood_seam`（罩与罩顶）。⚠ **只按材质不行** —— A12 的钢轨侧面也是 `rust`。
 *   ② **横向带宽**：第三轨中心在局部横向 `0.5925`、罩在 `0.584~0.601`
 *      ⇒ 横向带落在 `[0.575, 0.615]` 之内才算。镜像件（`z_track_half_m`）的第三轨被翻到
 *      `1 − 0.5925 = 0.4075` ⇒ 再加一个窗口 `[0.387, 0.428]`。
 *
 *   ⚠ **"横向"必须逐图元判对**，这里踩过一次坑：坡道那六个面里，枕块的**端面**是
 *     `x = 常量`（沿轨退化成一条线），如果把 `x` 当成横向，`x = 0.588 / 0.612` 正好撞进
 *     第三轨的窗口 ⇒ **误删 4 个块**（`G8_rail_slope` 表面积少 4 个）。所以：
 *       · 沿轨退化成线（`Δx ≈ 0`）⇒ 横向取 **y 的跨度**
 *       · 横向退化成线（`Δy ≈ 0`）⇒ 横向取 **y**（该侧面所在的 y）
 *       · 都不退化 ⇒ 取**窄的那一维**（交叉的两个方向靠这条分开：X 向窄维是 y、Y 向是 x）
 *     · 斜向件（`prism` / `poly`，经 `mapD`）的横向**就是 `s = x + y`**（见 `mapD` 的推导），
 *       一个 `prism` 就是一个整体脚印，没有"端面"这一层。
 */
const KILL_BANDS = [[0.575, 0.615], [0.387, 0.428]];
const DEL_MAT = new Set(['rust', 'metal', 'wood_dark', 'wood_seam']);

function matOf(kw, t) {
  if (kw === 'box') return t[7];
  if (kw === 'quad') return t[13];
  return t[kw === 'prism' ? 3 : 2];
}

function isThirdRail(kw, t) {
  if (!DEL_MAT.has(matOf(kw, t))) return false;
  const pts = verticesOf(kw, t);
  if (!pts.length) return false;
  const span = (f) => {
    let a = Infinity, b = -Infinity;
    for (const p of pts) { const v = f(p); a = Math.min(a, v); b = Math.max(b, v); }
    return [a, b];
  };
  const inBand = (b) => KILL_BANDS.some(([a, z]) => b[0] > a && b[1] < z);
  if (kw === 'box' || kw === 'quad') {
    const [dx0, dx1] = span((p) => p[0]);
    const [dy0, dy1] = span((p) => p[1]);
    const dx = dx1 - dx0, dy = dy1 - dy0;
    let band;
    if (dx < 1e-4 || dy < 1e-4) band = [dy0, dy1];
    else band = (dx < dy) ? [dx0, dx1] : [dy0, dy1];
    return inBand(band);
  }
  return inBand(span((p) => p[0] + p[1]));
}

/** 材质替换（只动"材质字段"，不碰坐标） */
function retint(line) {
  const t = line.split(/\s+/);
  const kw = t[0];
  if (kw === 'box') {
    t[7] = t[7] === 'granite_grey' ? MAT.blk : t[7];
    t[7] = t[7] === 'rust' ? MAT.rail : t[7];
    if (t[8] === 'top=metal') t[8] = `top=${MAT.railTop}`;
    return t.join(' ');
  }
  if (kw === 'prism' || kw === 'poly') {
    const mi = kw === 'prism' ? 3 : 2;
    t[mi] = t[mi] === 'granite_grey' ? MAT.blk : t[mi];
    t[mi] = t[mi] === 'rust' ? MAT.rail : t[mi];
    t[mi] = t[mi] === 'metal' ? MAT.railTop : t[mi];
    return t.join(' ');
  }
  if (kw === 'quad') {
    let m = t[13];
    m = m === 'granite_grey' ? MAT.blk : m;
    m = m === 'rust' ? MAT.rail : m;
    m = m === 'metal' ? MAT.railTop : m;
    return [...t.slice(0, 13), m].join(' ');
  }
  return line;
}

/** 洞内道床 / 钢轨的换色 + **洞门配色**（洞口那四件用）
 *
 *  ★ 怎么把「洞门结构」与「洞内道床」分开（人工 2026-10-06 的洞门配色要求）：
 *    源 `G3_tunnel3*` 是**整格**模型 —— 同一个文件里既有洞门，也有 A3 那套
 *    **U 形枕道床 + 钢轨**（SLE-2 / `BAL-A` 口径）。两边都大量用 `concrete`
 *    （道床的枕身 514 面 / 洞门约 80 面），所以**不能按材质一刀切**：
 *    那等于顺手把洞内道床也刷了（越权，且它属于 BAL-A/SLE-2 的规格）。
 *    ⇒ 判据用 **z 高度**：
 *        · 洞内道床+钢轨的所有面 **z ≤ 0.0230**（= 轨顶，全线铁律，见文件头）
 *        · 洞门结构里**最低**的一面是墙脚顶面 **0.0450**（墙脚侧面最低到 z=0，但顶面 0.045）
 *      ⇒ `0.0300` 是两者之间唯一的空档。实测（`G8_tunnel4*.model` 逐面统计）：
 *        z_max ∈ {0.0087, 0.0095, 0.0100, 0.0230} 的面 = 道床/钢轨；z_max ≥ 0.0450 的面 = 洞门。
 *      ⚠ 不要改用「源文件里的分节注释」（`# --- 洞门 …`）来切：那份注释是上游
 *        `gen-g1-tunnel.mjs` 写的，而**墙脚、山体侧壁、端墙正面的拱圈**这几张
 *        **都在那条注释之前**（在"道砟/枕/钢轨"那一节里），按注释切会漏掉它们。
 *      ⚠ 也不能按「材料 + 面数」认：`concrete_seam` / `metal_seam` 两边都有。
 *
 *  ★ `dirt` 一定是顶坡（仰面）与顶坡侧面：全包隧道模型里 `dirt` 只出现在
 *    `always5()` 的仰面梯形、两条侧边三角、`wing5()` 的土坡三角，`z_max ≥ 0.2041`。
 */
const PORTAL_ZMIN = 0.0300;

function retintTunnel(line) {
  const t = line.split(/\s+/);
  if (t[0] !== 'quad') return line;
  let m = t[13];
  let zmax = 0;
  for (let i = 0; i < 4; i++) zmax = Math.max(zmax, Number(t[3 + i * 3]));
  if (zmax > PORTAL_ZMIN) {
    if (m === 'concrete') m = MAT.portal;      // 洞门结构 → 冷灰（人工：更灰而不是更暖）
    if (m === 'dirt') m = MAT.hill;            // 顶坡 + 顶坡侧面 → 暖色水泥
  }
  if (m === 'gravel') m = MAT.bore;          // 洞内：有砟 → 无砟板
  if (m === 'rust') m = MAT.rail;
  if (m === 'metal') m = MAT.railTop;
  return [...t.slice(0, 13), m].join(' ');
}

// =============================================================================
// 三、轨道 10 件（源 = `G4_*`）
// =============================================================================
const TRACK_JOBS = [
  { src: 'G4_track_x', name: 'G8_track_x', slab: 'box', note: 'underlay 槽 0/1（RTO_X / RTO_Y）：BAL-G 无砟板 + SLE-4 双块 + RAI-3 长轨（完整画面）' },
  { src: 'G4_track_half', name: 'G8_track_half', slab: 'diag', note: 'underlay 槽 2 / 5（RTO_N / RTO_W）：切 N 角的半格轨' },
  { src: 'G4_z_track_half_m', name: 'G8_z_track_half_m', slab: 'diag', note: 'underlay 槽 3/4（RTO_S / RTO_E）：半格轨镜像版（本组无第三轨，镜像只为槽位对齐）' },
  { src: 'G4_track_slope', name: 'G8_track_slope', slab: 'sheared', note: 'underlay 槽 6-9（RTO_SLOPE_NE / SE / SW / NW）：坡道' },
  { src: 'G4_crossing', name: 'G8_crossing', slab: 'crossing', note: 'underlay 槽 10（RTO_CROSSING_XY）：交叉，自带两组钢轨' },
  { src: 'G4_junction3', name: 'G8_junction3', slab: null, note: 'underlay 槽 11-14：三向道岔的道床板（**保持素面**，同 A12）' },
  { src: 'G4_junction4', name: 'G8_junction4', slab: null, note: 'underlay 槽 15：四向道岔的道床板（**保持素面**，同 A12）' },
  { src: 'G4_rail_straight', name: 'G8_rail_straight', slab: null, note: 'overlay 槽 0/1：透明底，只有钢轨 + 双块（道岔瓦片上引擎逐段叠它）' },
  { src: 'G4_rail_half', name: 'G8_rail_half', slab: null, note: 'overlay 槽 2-5：半格轨的钢轨层' },
  { src: 'G4_rail_slope', name: 'G8_rail_slope', slab: null, note: 'overlay 槽 6-9：坡道的钢轨层' },
];

/** ★★ 人工 2026-10-08：「这几种铁路铁的**水平轨超出边界太多**」，且「**上下坡铁轨的铁轨
 *  长度不够**」—— 源 `G4_*` 里钢轨的探出是 **A12 那一轮按 `OVER = 1/32` 烘进坐标**的，
 *  这里逐坐标改：**贴到 −1/32 或 0 的端 → −OVER_RAIL；贴到 1 或 1+1/32 的端 → 1+OVER_RAIL**
 *  （`z` 一个数不动 —— 坡道两端各自邻着**平轨**，保持 z 正好与邻格平轨重合，偏差 ≤ 0.5px）。
 *  只认 `rust` / `metal`（源里的钢轨材质）；枕木 / 扣件座 / 板一个数不碰。
 *  ⚠ 生效范围 = 本组**所有含钢轨的模型**（直向 / 坡道 / **交叉** 四件 —— 交叉的 X 向钢轨
 *    也烘在坐标里；A8 / A25 的 `railFaces()` 是通用的，三条口径因此一致）。
 *    斜向半格（`G4_track_half` / `G4_z_track_half_m` / `G4_rail_half`）**不在范围**：
 *    它们的探出走"沿 45° 外扩"另一条路径（`kind === 'diag'`，仍 `OVER`），人工只点了
 *    "x 方向与 y 方向的水平轨 + 上下坡"。 */
const RAIL_JOBS = /^(G4_track_x|G4_rail_straight|G4_track_slope|G4_rail_slope|G4_crossing)$/;
function railRewrite(kw, t) {
  const mi = kw === 'box' ? 7 : kw === 'quad' ? 13 : -1;
  if (mi < 0 || !/^(rust|metal)$/.test(t[mi])) return null;
  const s = [...t];
  if (kw === 'box') {
    if (+s[1] <= 1e-4) s[1] = fmt(-OVER_RAIL);
    if (+s[4] >= 1 - 1e-4) s[4] = fmt(1 + OVER_RAIL);
  } else {
    for (let i = 0; i < 4; i++) {
      const xi = 1 + i * 3;
      if (+s[xi] <= 1e-4) s[xi] = fmt(-OVER_RAIL);
      else if (+s[xi] >= 1 - 1e-4) s[xi] = fmt(1 + OVER_RAIL);
    }
  }
  return s.join(' ');
}

function buildTrack(job) {
  const src = readSrc(job.src);
  const head = [];
  const body = [];
  for (const line of src) {
    if (/^name\s/.test(line)) { head.push(`name      ${job.name}`); continue; }
    if (!/^(box|quad|prism|poly) /.test(line)) { head.push(line); continue; }
    const t = line.split(/\s+/);
    if (isThirdRail(t[0], t)) continue;                       // ① 删第三轨 / 罩
    if (t[0] === 'box' && t[7] === 'concrete_mid') continue;  // ②a 删旧板（box 版）
    if ((t[0] === 'prism' || t[0] === 'poly') && t[t[0] === 'prism' ? 3 : 2] === 'concrete_mid'
        && job.slab !== null) continue;                       // ②b 删旧板（prism 版；道岔的板要留）
    if (t[0] === 'quad' && t[13] === 'concrete_mid') continue; // ②c 删旧板（坡道 6 面）
    if (RAIL_JOBS.test(job.src)) {                             // ⑤ 钢轨探出量单独收（人工 2026-10-08）
      const r = railRewrite(t[0], t);
      if (r) { body.push(retint(r)); continue; }
    }
    body.push(retint(line));                                  // ③④ 换材质
  }
  // ②d 把删掉的旧板换成 BAL-G 的条带（道岔那两件 `slab === null`，保持素面）
  if (job.slab === 'box') emitSlab(body, 'box');
  else if (job.slab === 'diag') emitSlab(body, 'diag');
  else if (job.slab === 'sheared') emitSlab(body, 'sheared');
  else if (job.slab === 'crossing') emitCrossingSlab(body);
  return { head, body };
}

// =============================================================================
// 四、洞口 4 件（源 = `G3_tunnel3*`）
//
//   `TUN-4` = `TUN-3`（提亮的现代混凝土拱洞）再：
//     ① 端墙加宽到 0.80 格、洞跨加宽到 0.40 格、拱顶抬到 0.215（见下 `mapPortal`）
//     ② 洞内道床改无砟、钢轨按 RAI-3 换色
//     ③ 洞口正面上方**新增帽檐**（两个 overlay 模型各一份）
//
//   ★★ ④ 洞内道床 / 钢轨**横向一律不动**（人工 2026-10-07 实机：「所有 S_CA 的
//      隧道铁轨比普通轨道宽一点」）。根因：`mapPortal` 的 ×1.2903 是**给洞跨**用的
//      （0.31 → 0.40 格），而它当年是**逐面**无条件施加的 ⇒ 连洞内的轨道也一起被撑开
//      1.29 倍：轨距由 0.1032 格变成 0.1331 格，轨顶面由 8 px 变成 10.3 px 宽。
//      TUN-4 又是 `SGCA` / `SCCA` / `SDCA` / `SECA` **四条 S_CA 共用的唯一洞口**
//      （见 docs/建模标准.md 台账），所以四条一起中招 —— 与你看到的完全一致。
//      ⇒ 现在按 `z_max ≤ PORTAL_ZMIN` 分成两类：道床/钢轨保持源值，只有洞门结构参与 `mapPortal`。
//
//   `mapPortal` 的横向映射是**分段线性**的（`ay = |y − 0.5|`）：
//        ay ≤ 0.155（= 洞跨半宽 0.31/2）      ⇒ ×(0.40/0.31) = ×1.2903  ⇒ 洞跨 0.40 ✓
//        0.155 < ay ≤ 0.345（= 端墙半宽 0.68/2）⇒ 线性接上：0.20 + (ay−0.155)×1.0526
//                                                ⇒ 端点 0.40 ⇒ 端墙总宽 0.80 ✓
//        ay > 0.345                            ⇒ **不动**（仰面 / 翼墙 / 山体仍铺满整格）
//     ⚠ 前两段在 `ay = 0.155` 处**必须连续**（同一个顶点既是洞口边又是端墙内边）——
//       所以第二段不能简单地"×1.176"，那样会在洞口边留下一道错位。
//     ⚠ `ay > 0.345` 处会有一次**跳变**（端墙外边 0.40 vs 不动 0.345）—— 这是**有意**的，
//       与 A5 的 TUN-6 同一口径（端墙比仰面宽一点没关系，仰面在墙背后）。
// =============================================================================
const PORTAL = { OPEN_HW: 0.155, WALL_HW: 0.345, OPEN_K: 0.40 / 0.31, Z0: 0.0450, Z_TOP: 0.2000, Z_NEW: 0.2150 };

function mapPortal(x, y, z) {
  const ay = Math.abs(y - 0.5);
  const sgn = y >= 0.5 ? 1 : -1;
  let ny = y, nz = z;
  if (ay <= PORTAL.OPEN_HW) {
    ny = 0.5 + sgn * ay * PORTAL.OPEN_K;
    if (z > PORTAL.Z0) nz = N(PORTAL.Z0 + (z - PORTAL.Z0) * ((PORTAL.Z_NEW - PORTAL.Z0) / (PORTAL.Z_TOP - PORTAL.Z0)));
  } else if (ay <= PORTAL.WALL_HW) {
    // 从洞口的 0.20 接到端墙的 0.40（两段在 ay = 0.155 处连续，见上 ⚠）
    ny = 0.5 + sgn * (0.5 * 0.40 + (ay - PORTAL.OPEN_HW) * 1.0526);
  }
  return [x, N(ny), nz];
}

/** 帽檐（人工确认门：「洞口正面一圈挑出的帽檐环框（外凸 0.030）」）
 *
 *   位置：`x ∈ [0.792, 0.844]`（端墙正面 0.80 再挑出 0.044 格 = 61 cm）、
 *         `y ∈ [0.085, 0.915]`（比加宽后的端墙 0.095~0.905 再宽一点）、
 *         `z ∈ [0.222, 0.252]`（拱顶 0.215 之上）
 *   六个面：顶 / **底** / 前 / 后 / 两侧。
 *   ⚠ **底面必须手写**（`box()` 只做顶面 + 4 个侧面）—— 等距俯视下檐板的底面是**看得见**的，
 *     漏掉就是 TUN-5 那轮"洞顶背面一条缝"的同一种错（`docs/建模经验.md` §4.12 ⑥）。
 *   ⚠ 它整块在拱顶之上 ⇒ 按 `archBeam()` 的裁定归 `tunnel_overlay:` 且**不参与左右切分**
 *     ⇒ 两个 overlay 模型各加一份（与 TUN-6 的横梁同口径）。
 */
function canopyLines() {
  const X0 = 0.7920, X1 = 0.8440, Y0 = 0.0850, Y1 = 0.9150, Z0 = 0.2220, Z1 = 0.2520;
  const V = (x, y, z) => [N(x), N(y), N(z)];
  const q = (p1, p2, p3, p4, mat) =>
    `quad ${[...p1, ...p2, ...p3, ...p4].map(fmt).join(' ')}  ${mat}`;
  const M = 'concrete_mid', D = 'concrete_dark';
  return [
    q(V(X0, Y0, Z1), V(X1, Y0, Z1), V(X1, Y1, Z1), V(X0, Y1, Z1), M),   // 顶面（挑出后朝上）
    q(V(X0, Y0, Z0), V(X0, Y1, Z0), V(X1, Y1, Z0), V(X1, Y0, Z0), D),   // **底面**（看得见，压暗）
    q(V(X1, Y0, Z0), V(X1, Y1, Z0), V(X1, Y1, Z1), V(X1, Y0, Z1), M),   // 前面（+x）
    q(V(X0, Y0, Z0), V(X0, Y0, Z1), V(X0, Y1, Z1), V(X0, Y1, Z0), M),   // 背面（−x，贴墙）
    q(V(X0, Y0, Z0), V(X1, Y0, Z0), V(X1, Y0, Z1), V(X0, Y0, Z1), M),   // 北侧（−y）
    q(V(X0, Y1, Z0), V(X0, Y1, Z1), V(X1, Y1, Z1), V(X1, Y1, Z0), M),   // 南侧（+y）
  ];
}

const TUNNEL_JOBS = [
  { src: 'G3_tunnel3', name: 'G8_tunnel4', canopy: false, note: 'tunnels: 组（A 组：远半 y<0.5）' },
  { src: 'G3_tunnel3_b', name: 'G8_tunnel4_b', canopy: false, note: 'tunnels: 组（B 组：近半 y>0.5）' },
  { src: 'G3_tunnel3_over', name: 'G8_tunnel4_over', canopy: true, note: 'tunnel_overlay: 组（A 组：近半）+ **帽檐整块**' },
  { src: 'G3_tunnel3_over_b', name: 'G8_tunnel4_over_b', canopy: true, note: 'tunnel_overlay: 组（B 组：远半）+ **帽檐整块**' },
];

function buildTunnel(job) {
  const src = readSrc(job.src);
  const head = [];
  const body = [];
  for (const line of src) {
    if (/^name\s/.test(line)) { head.push(`name      ${job.name}`); continue; }
    if (!/^quad /.test(line)) { head.push(line); continue; }
    const t = line.split(/\s+/);
    // ★ 洞内道床 / 钢轨（`z_max ≤ PORTAL_ZMIN`）**整件横向不动** ——
    //   `mapPortal` 的 ×1.2903 是**给洞跨用的**（0.31 → 0.40 格），它没有理由
    //   作用到轨道上。判据与 `retintTunnel()` 逐字同一把尺（见上面那段 ★）。
    //   ⚠ 判据必须按**面**取 z_max，不能按顶点：墙脚侧面从 z=0 起，按顶点判会把它切开。
    let zmax = 0;
    for (let i = 0; i < 4; i++) zmax = Math.max(zmax, Number(t[3 + i * 3]));
    const keep = zmax <= PORTAL_ZMIN;
    const v = [];
    for (let i = 0; i < 4; i++) {
      const x = Number(t[1 + i * 3]), y = Number(t[2 + i * 3]), z = Number(t[3 + i * 3]);
      v.push(...(keep ? [x, y, z] : mapPortal(x, y, z)));
    }
    const out = `quad ${v.map(fmt).join(' ')}  ${t[13] === 'gravel' ? MAT.bore : t[13]}`;
    body.push(retintTunnel(out));
  }
  if (job.canopy) body.push(...canopyLines());
  return { head, body };
}

// =============================================================================
// 五、写文件
// =============================================================================
function writeModel(name, head, body, note, srcName) {
  const banner = [
    '# =============================================================================',
    `# ${name} —— A10 组（\`SGCA\` 高速无砟 CRTS III）`,
    '#',
    `# ${note}`,
    '#',
    `# 【本文件由 tools/gen-a10-slab.mjs 生成（**整件重写**），请勿手改；改口径改生成器】`,
    `#   源 = models/${srcName}.model`,
    '#   BAL-G 无砟板（两条承轨台 + 三条低带）· SLE-4 双块式 · RAI-3 长轨 · TUN-4 大跨度环框拱（帽檐）',
    '#   口径与理由见生成器文件头；轨顶 0.0230 与板顶 0.0100 **一个数没动**。',
    '# =============================================================================',
    '',
  ].join('\n');
  const file = path.join(SRC_DIR, `${name}.model`);
  fs.writeFileSync(file, banner + [...head, ...body].join('\n') + '\n');
  return file;
}

export function generate() {
  const files = [];
  for (const job of TRACK_JOBS) {
    const { head, body } = buildTrack(job);
    files.push(writeModel(job.name, head, body, job.note, job.src + '（+ A12 的板面口径）'));
  }
  for (const job of TUNNEL_JOBS) {
    const { head, body } = buildTunnel(job);
    files.push(writeModel(job.name, head, body, job.note, job.src));
  }
  return files;
}

if (isMain(import.meta.url)) {
  const t0 = Date.now();
  for (const f of generate()) log(`  → ${rel(f)}`);
  log(`✔ 生成完成，用时 ${((Date.now() - t0) / 1000).toFixed(2)} s`);
}
