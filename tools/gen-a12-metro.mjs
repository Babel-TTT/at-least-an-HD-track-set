// =============================================================================
// tools/gen-a12-metro.mjs —— 生成 A12 组（`SAC3` 第三轨地铁）的模型
//
//   node tools/gen-a12-metro.mjs          （或 make metro）
//
// 产出（**会被本工具整件重写**，别手改）：
//   models/G4_track_x.model        underlay 槽 0/1  整体道床 + 无枕扣件座 + 第三轨（完整画面）
//   models/G4_track_half.model     underlay 槽 2-5  切 N 角的半格轨（4 朝向给 N/E/S/W）
//   models/G4_track_slope.model    underlay 槽 6-9  坡道（基准朝向 SLOPE_NE）
//   models/G4_crossing.model       underlay 槽 10   交叉（自带两组钢轨）
//   models/G4_junction3.model      underlay 槽 11-14 三向道岔（只有道床板）
//   models/G4_junction4.model      underlay 槽 15   四向道岔（只有道床板）
//   models/G4_rail_straight.model  overlay  槽 0/1  钢轨层（透明底）
//   models/G4_rail_half.model      overlay  槽 2-5  钢轨层（半格轨）
//   models/G4_rail_slope.model     overlay  槽 6-9  钢轨层（坡道）
//   models/G4_z_track_half_m.model underlay 槽 3/4  半格轨**镜像版**（第三轨在 −y 侧）
//   models/G4_z_rail_half_m.model  overlay  槽 3/4  同上，钢轨层
//
//   为什么要有「镜像版」（人工 2026-10-03 实机截图的第三轨左右交错）：
//     引擎给斜向链的两个槽位是 LEFT(RTO_W) 与 RIGHT(RTO_E)，取图朝向 v1 / v3 —— 同一模型
//     相差 180°，第三轨必然被甩到直线两侧。补一个关于带中心镜像的模型，取它的 v2/v3
//     接到 RTO_S / RTO_E，同一根直线上的第三轨才落在同一侧。
//     ⚠ 模型名 `G4_z_*`（排在同表所有 `G4_t*` 之后）是**故意的**：
//       atlas 按模型名排序给格位，排在最后才不会挤动前面 36 张精灵的 rect。
//
// 为什么用生成器（人工 2026-10-03 批准，见 docs/建模标准.md 台账）：
//   ① 斜向要按 `c = x+y`、`d = x−0.5` 的对角坐标算，再裁到瓦片里（光半轨那件就有
//      25 个承轨台 × 2 条轨 × 4 个角点 = 200 个坐标）；
//   ② 坡道要把**每个顶点**按 `z += RISE·(1−x)` 剪切 —— `box`/`prism` 都是轴对齐的，做不到；
//   ③ 交叉/道岔要做板带并集，且**不能有共面重叠**（会 z-fighting）。
//
// -----------------------------------------------------------------------------
// 口径（全部与 G1 共用，理由：道岔/交叉的并集规则、实机调好的锚点都靠它）
//   轨道中心 y = 0.5 · 板带 y ∈ [0.32, 0.68]（= G1 道砟同宽）
//   钢轨中心 y = 0.4484 / 0.5516（= 1435 mm）· 轨顶 z = 0.0230 · 板顶 z = 0.0100
//   枕位（= 扣件座位置）与 G1 的枕木同一条：t = 0.012 + k·0.04，k = 0…24
//   第三轨在 **+y 外侧**（人工：「镜头视角的外侧 + 覆盖板」）
//
// 斜向映射（照 G1 的 `probe_half_upper`：**切 N 角**那一半，轨道线 x+y = 0.5）
//   c = y     d = x − 0.5        (x,y) = ((c+d)/2, (c−d)/2)
//   ★ 不乘 √2：G1 是**按屏幕像素**对齐的 —— 斜向两轨在屏幕上的间距与直向一样是 6.6 px
//   ★ 这个映射是**镜像**（det = −1/2）⇒ 映射后顶点序会翻，本工具统一用 ccw() 归正
//
// ⚠ 交叉 / 道岔**不做中央排水沟**（沟已被整体取消，见上）；
//   但交叉里的第三轨**必须在另一条轨道的板带处断开**（见第 7 件）。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT, log, rel, isMain } from './util.mjs';

// ---------------------------------------------------------------- 口径常量
const BAND = [0.3200, 0.6800];          // 道床板带
const SLAB_Z = 0.0100;                  // 板顶
// 【人工 2026-10-03】去掉中央排水沟（原来 0.48~0.52 一条沟）：
//   斜向半格轨的那块板会被沟纵向切成两条窄带，两条带在瓦片里的位置不同 ⇒
//   各自被瓦片边界裁掉的长度也不同（一条 x±y 到 ±0.32、另一条到 ±0.5），
//   实机里就是「板缺半截、连钢轨都短一根」。改成**一整块板**，与 G1 同形。
const RAILS = [0.4484, 0.5516];         // 钢轨中心
const RAIL_HW = 0.0040, RAIL_Z0 = 0.0100, RAIL_Z1 = 0.0230;
const SEAT = { n: 25, t0: 0.0120, pitch: 0.0400, len: 0.0160, hw: 0.0140, z1: 0.0175 };
const THIRD = { c: 0.5925, hw: 0.0035, z1: 0.0180 };   // 接触轨
const COVER = { hw: 0.0085, z1: 0.0210 };              // 覆盖板
const RISE = 0.2041;                                   // 一格坡道的抬升（与 gen-g1-slope 同源）
const EPS = 0.0008;                                    // 顶面换材质时的微小抬升

// ---------------------------------------------------------------- A13 道床（`BAL-I`）
// 【人工 2026-10-05，A13 确认门（D11）：道床 `BAL-I` + C8 四项全按推荐】
// 【人工 2026-10-06，**推翻"浮置板"那一版**】：「`BAL-I` **不要浮置版了**，改成
//   **浅色混凝土**（**不要暖色**）」⇒ 方案 B：**素面板**。
//
//   历史（别再走回头路）：2026-10-05 那版把 `BAL-I` 做成 `BAL-H` + 「板缝（0.25 格 /
//   宽 0.010 / 深 0.0025，缝底 = 减振垫顶面的深灰）+ 减振垫层（0.004 格厚）+
//   板带两侧各 0.010 宽的减振垫边缘线」。**现在整套删掉**：板缝、减振垫、边缘线一个不留，
//   只把板体换成**浅色中性混凝土** `concrete_light`（本地增补，见
//   `tools/flatiso/core/materials.mjs`；基色 (184,191,203) ⇒ 顶面渲出 ≈(185,185,185)）。
//   旧版几何留在 `git show a0ec626:tools/gen-a12-metro.mjs` 与 `models/G7_*.model`。
//
//   ⇒ `BAL-I` = **`BAL-H` 的板带 + 另一种板面材质**（几何**逐字相同**，一个数没动）。
//     ⚠ 由此推出一条必须一起改的账，见本文件 §11 的 ★：**交叉 / 三向 / 四向**那三张
//       道床板**也要重画**（它们也有板面）—— 上一版能"复用 A12 的 `metro.png`"是因为
//       那时板面与 A12 同色；现在板面变浅了，再复用就会在岔口露出一块中灰的旧色。

// ---------------------------------------------------------------- 探出边界
// 【人工 2026-10-04】「把各向铁轨（包括道床）稍微延长出边界一点，以弥补
//   道床+枕木+铁轨固有高度带来的图像缺损」。
//
// 为什么必须探出去（这是**瓦片接缝**的成因，不是审美）：
//   * 精灵在瓦片边界上是**切齐**的 —— 相邻两格的板 / 钢轨各自止于同一条世界直线，
//     那条线上只剩两边的抗锯齿半透明像素；两块摆回去，缝上就多一条 1px 的暗线。
//   * 轨道又偏偏是**唯一必须首尾严格对上**的细线（`docs/建模经验.md` §3），
//     高度越高、接缝越明显；尽头还会缺一小块。
//   ⇒ 让几何**沿轨两端各探出 `OVER`**，相邻精灵就**叠上**：后画的那一张盖住缝。
//     OpenTTD 的轨道精灵本来就是这样互相重叠的（格位 263px 装 256px 的瓦片）。
//
// 为什么是 1/32：
//   * 只要 1px 就能盖住缝，`OVER` 是余量；探出去的部分在**近端**会被后画的邻格盖掉
//     （引擎按瓦片从远到近画），在**远端**则叠在邻格之上 —— 太小盖不住、太大就成了
//     "道床戳进别人家"。1/32 格 = 4 px 横向 / 2 px 纵向 @4x，正好。
//   * 探出量必须 < flatiso 的 `OVERFLOW_ALLOW`（1/16 格，见 tools/flatiso/core/mesh.mjs），
//     否则每次构建都会刷"超出占地"警告 —— 这条是**允许**的用法，不该报警。
//
// ⚠ 只延长"沿轨全长"的件（板 / 钢轨 / 第三轨 / 罩，模型里 `long: true`）；
//   扣件座是离散小块，延长会变成一条长条（同 G1 的口径）。
// ⚠ **坡道不延长**，两端各有硬理由（见 `emitSheared`）。
const OVER = 0.03125;                                  // 1/32 格

const MAT = {
  // 人工 2026-10-03：「混凝土还是太黄了，颜色改成 (160,160,160) 左右」
  //   ⇒ 板用本地新增的中性灰 `concrete_mid`(160,160,160)（见 tools/flatiso/VENDORED.md 的登记），
  //     沟底 / 承轨台各自再暗一档，且都用中性（不暖）的灰。
  slab: 'concrete_mid', groove: 'granite_grey_seam', seat: 'granite_grey',
  rail: 'rust', railTop: 'metal',
  third: 'rust', thirdTop: 'metal',
  cover: 'wood_dark', coverTop: 'wood_seam',
  // A13 道床（`BAL-I`）：**浅色中性混凝土**（本地新增，2026-10-06 人工：「不要浮置版了，
  //   改成浅色混凝土（不要暖色）」）。基色 (184,191,203) ⇒ 顶面渲出 ≈(185,185,185)，
  //   与 A12 的 `concrete_mid`（渲出 ≈(160,160,160)）同族、亮 25 档、同样**不暖**。
  //   ⚠ 与 `concrete_mid` 一样是相对上游 flatiso 的**本地增补**，同步上游时别丢
  //     （见 tools/flatiso/VENDORED.md）。
  slabLight: 'concrete_light',
};

const fmt = (v) => v.toFixed(4);
const N = (v) => Number(v.toFixed(6));

// ---------------------------------------------------------------- 形状表
// 每个形状 = 轴对齐的一"块"：x 沿轨（0…1）、y 横向（绝对坐标）、z 上下、材质
function trackShapes({ slab = true, rails = true, seats = true, third = true, flip = false,
                       slabMat = MAT.slab } = {}) {
  // flip = 把第三轨/罩挪到板带**另一侧**（关于带中心 y = 0.5 镜像）。
  //   板 / 钢轨 / 扣件座本来就关于 0.5 对称，镜像后逐字不变。
  //   用途见下面第 3b/4b 件：斜向链上 LEFT 与 RIGHT 差 180°，不镜像的话第三轨
  //   会在同一条直线上左右交替（实机截图就是那样）。
  //
  // slabMat = 板体材质。默认 `MAT.slab`（A12 的中性中灰 `concrete_mid`）；
  //   A13 的 `BAL-I` 传 `MAT.slabLight`（浅色中性混凝土）—— **只换材质、几何不动**。
  const S = [];
  if (slab) {
    S.push({ long: true, x0: 0, x1: 1, y0: BAND[0], y1: BAND[1], z0: 0, z1: SLAB_Z, mat: slabMat });
  }
  if (rails) for (const c of RAILS) {
    S.push({ long: true, x0: 0, x1: 1, y0: c - RAIL_HW, y1: c + RAIL_HW, z0: RAIL_Z0, z1: RAIL_Z1, mat: MAT.rail, top: MAT.railTop });
  }
  if (seats) for (let k = 0; k < SEAT.n; k++) {
    const t = SEAT.t0 + k * SEAT.pitch;
    for (const c of RAILS) {
      S.push({ x0: t, x1: t + SEAT.len, y0: c - SEAT.hw, y1: c + SEAT.hw, z0: RAIL_Z0, z1: SEAT.z1, mat: MAT.seat });
    }
  }
  if (third) {
    const c = flip ? 1 - THIRD.c : THIRD.c;
    S.push({ long: true, x0: 0, x1: 1, y0: c - THIRD.hw, y1: c + THIRD.hw, z0: RAIL_Z0, z1: THIRD.z1, mat: MAT.third, top: MAT.thirdTop });
    S.push({ long: true, x0: 0, x1: 1, y0: c - COVER.hw, y1: c + COVER.hw, z0: THIRD.z1, z1: COVER.z1, mat: MAT.cover, top: MAT.coverTop });
  }
  return S;
}

// ---------------------------------------------------------------- 多边形工具
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

/** 裁到瓦片 [0,1]²（`m` = 向外多留多少格，用于"探出边界盖接缝"，见 `OVER`） */
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
const mapD = (x, y) => [(y + (x - 0.5)) / 2, (y - (x - 0.5)) / 2];

// ---------------------------------------------------------------- 三个发射器
/** 直向：轴对齐的 box（`long` 的件沿轨两端各探出 `OVER`，见文件头的说明） */
function emitBox(L, b) {
  const o = b.long ? OVER : 0;
  L.push(`box ${fmt(b.x0 - o)} ${fmt(b.y0)} ${fmt(b.z0)}  ${fmt(b.x1 + o)} ${fmt(b.y1)} ${fmt(b.z1)}   `
    + `${b.mat}${b.top ? ` top=${b.top}` : ''}`);
}

/** 斜向：**沿轨道方向铺满整格**，再裁到瓦片，用 prism / poly
 *
 *  ★ 形状口径（人工 2026-10-03 第三轮，给了示意图）：
 *    半格轨的板 = **板带 ∩ 瓦片**，端部由**瓦片边**（世界 x=1 / y=0）切出来
 *    ⇒ 屏幕上是"左右竖直、上下 2:1 斜切"的**梯形**。相邻两格正好共用那条斜边，
 *      拼起来无缝；而且**整块都在瓦片内**，不会被邻格精灵（地面 / 别的板）盖掉。
 *
 *  ⚠ 走过的两条弯路，都写在这儿别再犯：
 *    ① 只取局部 x∈[0,1]（= 理想矩形的端部，沿 `x±y = const` 垂直切）：
 *       那块板的世界坐标有两个角出瓦片（y<0 / x>1）；出瓦片的部分**会**被邻格精灵盖住
 *       （后画的瓦片盖先画的），实机里就只剩中间一个矩形，接缝处露白。
 *    ② 把那条理想矩形整块发出去（不裁）：同理，溢出的角被盖，反而更差。
 *    ⇒ 正确做法是**反着来**：让几何**铺满**瓦片（比瓦片长），交给 `clipTile` 去切。
 *      被切掉的正好是瓦片外那部分 —— 本来就不该由这一格画。
 *
 *  只有"沿轨全长"的件（板 / 钢轨 / 第三轨 / 罩，模型里带 `long: true`）才延长；
 *  扣件座是离散的小块，局部 x 本来就按整格排好，延长会变成一条长条。
 *
 *  ★ 2026-10-04（人工）：`long` 的件裁到**外扩 `OVER` 的瓦片**（`[−OVER, 1+OVER]²`），
 *    于是相邻两格的板 / 钢轨**重叠** —— 盖住瓦片边界上那条 1px 接缝。
 *    理由与取值见文件头的「探出边界」一节。
 */
function emitDiag(L, b) {
  const X0 = b.long ? -1 : b.x0;
  const X1 = b.long ? 2 : b.x1;
  const m = b.long ? OVER : 0;
  const poly = clipTile(ccw([
    mapD(X0, b.y0), mapD(X1, b.y0), mapD(X1, b.y1), mapD(X0, b.y1),
  ]), m);
  if (poly.length < 3) return;
  const P = poly.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join('  ');
  if (b.top) {
    L.push(`prism ${fmt(b.z0)} ${fmt(b.z1 - EPS)}  ${b.mat}  ${P}`);
    L.push(`poly ${fmt(b.z1)}  ${b.top}  ${P}`);
  } else {
    L.push(`prism ${fmt(b.z0)} ${fmt(b.z1)}  ${b.mat}  ${P}`);
  }
}

/** 坡道：每个顶点 z += RISE·(1−x)，六个面都用 quad 手写
 *
 *  ⚠ **坡道件不探出边界**（与直向 / 半格不同），两端各有硬理由：
 *    * 高端（x=0）再往外延 = 抬得更高（z = RISE·(1−x)），会把格位从 263×149 顶到
 *      ~157 ⇒ 同表 40 张精灵的 rect 全被挤移位（本工程最贵的一种返工）；
 *      而且那一段本该是**上一层平的**地面，几何上就不该继续斜上去。
 *    * 低端（x=1）再往外延 = z < 0 ⇒ 直接**穿地**（flatiso 会报穿地）。
 *  ⇒ 坡道两端的接缝交给**邻格直向件的探出**去盖（直向件在坡道这一侧也探出了）。
 */
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

// ---------------------------------------------------------------- 道床板（交叉 / 道岔用）
//   `mat` 参数 = 板体材质（2026-10-06 起要能给 A13 传 `MAT.slabLight`）：
//   默认 `MAT.slab` ⇒ A12 的输出**逐字不变**。
/** 交叉（X 带 ∪ Y 带）—— 拆成 3 块互不重叠的轴对齐板 */
function slabCrossing(z0 = 0, z1 = SLAB_Z, mat = MAT.slab) {
  return [
    { x0: 0, x1: 1, y0: BAND[0], y1: BAND[1], z0, z1, mat },                 // X 带
    { x0: BAND[0], x1: BAND[1], y0: 0, y1: BAND[0], z0, z1, mat },           // Y 带（北侧）
    { x0: BAND[0], x1: BAND[1], y0: BAND[1], y1: 1, z0, z1, mat },           // Y 带（南侧）
  ];
}

/** 三向道岔（基准朝向 = 缺**西**臂）—— **矩形 + 梯形** = 六边形
 *   人工 2026-10-03：「三向的做成矩形和梯形的组合」。
 *   形状 = 矩形（x 0.32~0.68 全 y，北/南两臂）+ 东侧梯形（x=0.68 到 x−y=0.68 / x+y=1.68 两条 45° 切边）。
 *   45° 切的进深 0.32 = 对角线板带半宽 0.18 的补（0.5 − 0.18）——与交叉板带同一口径。 */
function slabJunction3(z0 = 0, z1 = SLAB_Z, mat = MAT.slab) {
  const a = BAND[0], b = BAND[1];
  return [{
    poly: [[a, 0], [b, 0], [1, a], [1, b], [b, 1], [a, 1]],
    z0, z1, mat,
  }];
}

/** 四向道岔 = **正八边形**：整格切掉四个 45° 角
 *   人工 2026-10-03：「四向的类似正八边形」。
 *   八条边 = 瓦片四条边（各被切掉 0.5−0.18 = 0.32 的两端）+ 四条 45° 切边；
 *   切边正好是对角线板带（|x+y−0.5| ≤ 0.18 及其镜像）的外沿。 */
function slabJunction4(z0 = 0, z1 = SLAB_Z, mat = MAT.slab) {
  const a = BAND[0], b = BAND[1];
  return [{
    poly: [[a, 0], [b, 0], [1, a], [1, b], [b, 1], [a, 1], [0, b], [0, a]],
    z0, z1, mat,
  }];
}

/** 交叉瓦片的**全部**形状：道床板（十字，自带两组钢轨）+ 两个方向的钢轨/扣件座
 *   + 第三轨/罩在对方板带处断开成两段。
 *
 *   ★ 单独成函数是为了让 A12（`BAL-H`）与 A13（`BAL-I`）**共用同一份**：
 *     A13 只要把 `slabMat` 换成浅色混凝土，其余（两组钢轨、断口位置）逐字相同。
 *     ⇒ 岔口不会出现"板面颜色与直线段不一致"（2026-10-06 那条教训，见 §11 的 ★）。
 */
function crossingShapes(slabMat = MAT.slab) {
  const L = [];
  for (const b of slabCrossing(0, SLAB_Z, slabMat)) emitBox(L, b);
  // X 向：钢轨 + 扣件座（整格）
  for (const b of trackShapes({ slab: false, third: false })) emitBox(L, b);
  // Y 向：钢轨 + 扣件座（沿 y 走）
  const yDir = (b) => ({ x0: b.y0, x1: b.y1, y0: b.x0, y1: b.x1, z0: b.z0, z1: b.z1, mat: b.mat, top: b.top });
  for (const b of trackShapes({ slab: false, third: false })) emitBox(L, yDir(b));
  // 第三轨 / 罩：**两个方向都在对方轨道占的板带里断开**（人工 2026-10-03 排查）
  //   现实里接触轨过交叉必须断开，否则钢轨会把它短路；图形上也免得两根钢轨
  //   压着一条穿过去的第三轨。断口 = 对方的板带 [BAND[0], BAND[1]]（宽 0.36）。
  //   四段（每方向 2 段 × 第三轨/罩 2 层）互不重叠 —— 别改成整格，会与对方共面相交。
  for (const [z0, z1, hw, mat, top] of [
    [RAIL_Z0, THIRD.z1, THIRD.hw, MAT.third, MAT.thirdTop],
    [THIRD.z1, COVER.z1, COVER.hw, MAT.cover, MAT.coverTop],
  ]) {
    for (const [t0, t1] of [[0, BAND[0]], [BAND[1], 1]]) {
      // X 向那根：沿 x 走，横向在 y = THIRD.c
      emitBox(L, { x0: t0, x1: t1, y0: THIRD.c - hw, y1: THIRD.c + hw, z0, z1, mat, top });
      // Y 向那根：沿 y 走，横向在 x = THIRD.c
      emitBox(L, { x0: THIRD.c - hw, x1: THIRD.c + hw, y0: t0, y1: t1, z0, z1, mat, top });
    }
  }
  return L;
}


/** 发一块水平多边形柱（轴对齐的用 box，三角形用 prism） */
function emitSlab(L, b) {
  if (b.poly) {
    const P = ccw(b.poly).map((p) => `${fmt(p[0])},${fmt(p[1])}`).join('  ');
    L.push(`prism ${fmt(b.z0)} ${fmt(b.z1)}  ${b.mat}  ${P}`);
  } else {
    emitBox(L, b);
  }
}

// ===========================================================================
// TUN-5 地铁矩形洞门（`tunnels:` + `tunnel_overlay:` 两层 × A/B 两组 = 4 个模型）
//
//   人工 2026-10-03（§6 确认门）：「本期就做 TUN-5：矩形洞门端墙，**不做护坡**」。
//
//   ⚠ 为什么必须照抄 TUN-1 的**外形尺寸与盖土几何**：
//     定义了 `tunnel_overlay:` 之后，引擎只是把原版隧道换成「**只有草的**底图」
//     —— **形状还在**，那个草山包永远在那儿，只能靠我们的图盖住它。
//     所以下面这些常量、以及「压顶 + 仰面 + 山体侧壁（翼墙）」的算法
//     **与 tools/gen-g1-tunnel.mjs 逐字同源**（那边是实机调了 4 轮才对的）；
//     改这里之前先看那边，或者两个文件一起改。
//
//   与 TUN-1 的差别只有两处：
//     ① 洞口从**半圆拱**改成**矩形**（宽 0.32 格 = 4.4 m，净高 0.20 = 拱顶同高）
//     ② 材质用**素混凝土**：洞门所有面 + 顶坡 + 顶坡侧面 = `concrete_mid`（本地新增的
//        中性冷灰，见下），只有洞内两侧内壁留 `panel_seam` 压暗
//
//   分层（照 TUN-1 的结论）：
//     引擎顺序 = 草地底 → `tunnels:` → 车 → 草地覆盖 → `tunnel_overlay:`
//     ⇒ 「被车遮」的（洞内、洞门下半、翼墙）归 tunnels:
//     ⇒ 「遮车」的（墙身上半、过梁、压顶、仰面）归 tunnel_overlay:
//     ⇒ overlay 是一张 sortable sprite，**只能放离镜头近的那半**
//       ⇒ 按 y=0.5 切两半、配两套分组 = 4 个模型（同 TUN-1）
// ===========================================================================
const TU = {
  X0: 0.6800, X1: 0.8000,          // 端墙厚度（正面 x=0.80 = 从外量 0.2，与 TUN-1 同）
  Y0: 0.1600, Y1: 0.8400,          // 端墙宽 0.68 格 = 9.5 m
  TOP: 0.2720,                      // 板顶（= TUN-1）
  OY0: 0.3400, OY1: 0.6600,        // 矩形洞口 y 区间（宽 0.32）
  OH: 0.2000,                       // 洞口净高（= TUN-1 的拱顶高，接口一致）
  SPLIT_Z: 0.0450,                  // z 切分线（= TUN-1 的起拱线）
  COP: { x0: 0.6680, x1: 0.8120, y0: 0.1420, y1: 0.8580, top: 0.2860 },   // 压顶（= TUN-1）
  HX0: 0.6800, HX1: 0.0000, HZ1: 0.2041,                                  // 仰面（= TUN-1）
  BORE_X: 0.7200,                   // 洞内暗幕（人工 2026-10-03/04：往里 0.08 格，两侧露出的部分由洞口内壁挡住）
  // ---------------------------------------------------------------------------
  // 材质（人工 2026-10-04 定）：
  //
  //   ① 「洞门侧面材质有点怪」——原来端墙两侧的**外端面**用 `granite_grey_seam`：
  //      那是**分缝**材质，`GRAIN_RULES` 把 `*_seam` 一族颗粒全部归零（就是一条细线用的），
  //      铺成一大片面 = 一块没有颗粒、又比正面暗一档的死灰；紧挨着的端墙正面是带颗粒的
  //      `concrete_mid` ⇒ 一眼就不像同一堵墙。
  //      ⇒ 洞门**所有有面积的面**统一 `concrete_mid`。**朝向的明暗交给管线的逐法线光照**
  //        —— 证据就在眼前：压顶顶面与端墙正面**同材质**，渲出来一亮一暗。
  //        不要再拿不同材质去硬分正侧面（那正是这次"怪"的来源）。
  //
  //   ② 顶坡（仰面）+ 顶坡侧面（坡的两条侧边三角、翼墙的土坡三角）原来用 `dirt`
  //      ⇒ 一并换混凝土，整个「洞门 + 坡」是一体素混凝土。
  //
  //   `I` 仍是洞内两侧内壁 —— 那是洞里的暗部，**要压暗**，保留 `panel_seam`。
  //
  //   ⚠ `D` 这个名字现在等于 `W`（值一样），留着是为了标出"外端面/侧脸"这几张面；
  //     将来若要给侧脸单独一档更暗的冷灰（本地材质表还没有），只改这一行即可。
  W: 'concrete_mid',
  D: 'concrete_mid',                // 原 granite_grey_seam：分缝材质当大面铺 ⇒ 显平、显怪
  I: 'panel_seam',
  HILL: 'concrete_mid',             // 原 dirt：顶坡 + 顶坡侧面
};
/** 仰面（顶坡）在 x 处的高度：洞口 = 板顶，向山体斜降到一层地形 */
const hillZ5 = (x) => TU.TOP + (TU.HZ1 - TU.TOP) * (TU.HX0 - x) / (TU.HX0 - TU.HX1);

/** Newell 法线（与 flatiso core/mesh.mjs 同式） */
function newell5(p) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}
/** 发一个「朝向已保证」的 quad（want = 期望外法线方向） */
function q5(L, pts, want, mat) {
  let p = pts;
  const n = newell5(pts);
  if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) p = pts.slice().reverse();
  L.push(`quad ${p.flat().map(fmt).join(' ')}  ${mat}`);
}

/** 洞内轨道：与 G4_track_x **同源**（整格道床 + 钢轨 + 扣件座 + 第三轨），只是多了暗幕 */
function metroTunnelGround() {
  const L = [];
  for (const b of trackShapes()) emitBox(L, b);
  // 洞口暗幕 —— 两条口径（人工 2026-10-03 实机截图：「黑幕位置靠后」）：
  //   ① **x 贴着洞口平面**（正面 X1 = 0.80，取 0.795）。原来放 0.67（端墙背面再往里
  //      0.13 格），等距投影后整块往屏幕右侧跑 0.13×128 ≈ 17 px ⇒ 从洞口右边露出去，
  //      洞里变成「左边一块黑、右边露出灰色内壁」——顺手也毁掉了洞口两侧那两根
  //      "柱子"（= 内壁）的左右对称。
  //   ② **z 从道床顶面起**（0.030），不要从 0 起 —— 否则暗幕会切进道床和钢轨。
  const z0 = 0.0300;
  q5(L, [[TU.BORE_X, TU.OY0, z0], [TU.BORE_X, TU.OY0, TU.OH + 0.006],
         [TU.BORE_X, TU.OY1, TU.OH + 0.006], [TU.BORE_X, TU.OY1, z0]],
     [1, 0, 0], 'trim_black');
  return L;
}

/** 洞门下半（z < SPLIT_Z）：两垛墙脚 + 洞口两侧内壁 + 洞口顶棚（不可见，不画） */
function portalLow5() {
  const L = [];
  const { X0, X1, Y0, Y1, OY0, OY1, OH, SPLIT_Z, W, D, I } = TU;
  // 墙脚（洞口左右各一垛）
  q5(L, [[X1, Y0, SPLIT_Z], [X1, Y0, 0], [X1, OY0, 0], [X1, OY0, SPLIT_Z]], [1, 0, 0], W);
  q5(L, [[X1, OY1, SPLIT_Z], [X1, OY1, 0], [X1, Y1, 0], [X1, Y1, SPLIT_Z]], [1, 0, 0], W);
  // 洞口两侧内壁（朝洞内）
  q5(L, [[X0, OY0, OH], [X1, OY0, OH], [X1, OY0, 0], [X0, OY0, 0]], [0, 1, 0], I);
  q5(L, [[X0, OY1, OH], [X0, OY1, 0], [X1, OY1, 0], [X1, OY1, OH]], [0, -1, 0], I);
  // 墙脚外端面
  q5(L, [[X0, Y0, SPLIT_Z], [X1, Y0, SPLIT_Z], [X1, Y0, 0], [X0, Y0, 0]], [0, -1, 0], D);
  q5(L, [[X0, Y1, SPLIT_Z], [X0, Y1, 0], [X1, Y1, 0], [X1, Y1, SPLIT_Z]], [0, 1, 0], D);
  return L;
}

/** 洞门上半（默认 z ∈ [SPLIT_Z, TOP]）：两垛墙身正面 + 外端面
 *
 *  ⚠ **可分段调用**（人工 2026-10-04：「和洞口（也就是洞顶下沿，不是洞顶上沿）同高」）：
 *    柱身要按 z 切成两段 —— 与**过梁同高**的那一段（z ∈ [OH, TOP]）整块进 overlay，
 *    其余（z ∈ [SPLIT_Z, OH]）仍按 y 切左右。
 *    理由：过梁（lintel5）本来就在 overlay；柱子同一高度那段若留在 tunnels:，
 *    会被引擎在它之后画的那层**草地覆盖**压掉 ⇒ 实机里柱子和过梁之间裂开一道缝。
 *    将来改 TU.OH / TU.TOP 时，这两段的分界自动跟着动。
 */
function portalHigh5({ z0 = TU.SPLIT_Z, z1 = TU.TOP } = {}) {
  const L = [];
  const { X0, X1, Y0, Y1, OY0, OY1, W, D } = TU;
  q5(L, [[X1, Y0, z1], [X1, Y0, z0], [X1, OY0, z0], [X1, OY0, z1]], [1, 0, 0], W);
  q5(L, [[X1, OY1, z1], [X1, OY1, z0], [X1, Y1, z0], [X1, Y1, z1]], [1, 0, 0], W);
  q5(L, [[X0, Y0, z1], [X1, Y0, z1], [X1, Y0, z0], [X0, Y0, z0]], [0, -1, 0], D);
  q5(L, [[X0, Y1, z1], [X0, Y1, z0], [X1, Y1, z0], [X1, Y1, z1]], [0, 1, 0], D);
  return L;
}

/** 过梁（洞口正上方那块墙身）：整块归 overlay，**不参与左右切分**（同 TUN-1 的石梁） */
function lintel5() {
  const L = [];
  const { X0, X1, OY0, OY1, TOP, OH, W, D } = TU;
  q5(L, [[X1, OY0, TOP], [X1, OY1, TOP], [X1, OY1, OH], [X1, OY0, OH]], [1, 0, 0], W);
  q5(L, [[X0, OY0, TOP], [X0, OY0, OH], [X0, OY1, OH], [X0, OY1, TOP]], [-1, 0, 0], D);
  q5(L, [[X0, OY0, TOP], [X0, OY1, TOP], [X1, OY1, TOP], [X1, OY0, TOP]], [0, 0, 1], D);
  return L;
}

/** 压顶 + 仰面（梯形）：整块归 overlay（同 TUN-1 的 upperAlways） */
function always5() {
  const L = [];
  const { COP, HX0, HX1, Y0, Y1, HILL } = TU;
  q5(L, [[COP.x1, COP.y0, COP.top], [COP.x1, COP.y0, TU.TOP], [COP.x1, COP.y1, TU.TOP], [COP.x1, COP.y1, COP.top]], [1, 0, 0], TU.D);
  // ★ 压顶的**背面**（x = COP.x0）—— 人工 2026-10-04：「**我说的是洞顶的背面**」。
  //   ⚠ 对照 TUN-1（`tools/gen-g1-tunnel.mjs`）：那边的压顶是**直接调 `box()`** 的，
  //     而 `box()` = **顶面 + 4 个侧面**（只不做底面）。TUN-5 这里当初是手抄的，
  //     **漏抄了 `x = x0` 这一个侧面** ⇒ 洞顶背面根本没有面；
  //     管线又是**背面剔除**的（`core/raster.mjs` 的 `cull`：只画朝向相机的面）⇒
  //     相机转到背面那两个朝向时，那一条就是**透明缝**（精灵里直接透出背景）。
  //   ⇒ 补齐成和 `box()` 一样的 4 个侧面（底面仍然不做，与 TUN-1 一致）。
  q5(L, [[COP.x0, COP.y0, COP.top], [COP.x0, COP.y1, COP.top], [COP.x0, COP.y1, TU.TOP], [COP.x0, COP.y0, TU.TOP]], [-1, 0, 0], TU.D);
  q5(L, [[COP.x1, COP.y0, COP.top], [COP.x1, COP.y1, COP.top], [COP.x0, COP.y1, COP.top], [COP.x0, COP.y0, COP.top]], [0, 0, 1], TU.W);
  q5(L, [[COP.x1, COP.y0, COP.top], [COP.x0, COP.y0, COP.top], [COP.x0, COP.y0, TU.TOP], [COP.x1, COP.y0, TU.TOP]], [0, -1, 0], TU.D);
  q5(L, [[COP.x1, COP.y1, COP.top], [COP.x1, COP.y1, TU.TOP], [COP.x0, COP.y1, TU.TOP], [COP.x0, COP.y1, COP.top]], [0, 1, 0], TU.D);
  q5(L, [[HX1, 0, hillZ5(HX1)], [HX0, Y0, hillZ5(HX0)], [HX0, Y1, hillZ5(HX0)], [HX1, 1, hillZ5(HX1)]], [0, 0, 1], HILL);
  // 山坡的**两条侧边**（人工 2026-10-03：「隧道图像没有侧边」；2026-10-04：「侧面应该是
  //   一个三角形」）：仰面是张梯形土坡，y 方向的两条边原来悬空（坡面 0.2041~0.272，
  //   离地面还有 0.2 格），从侧面看就是"一张土纸贴在山体上"。
  //   ⇒ 各补**一块三角形**：端墙那一侧的竖边（由端墙端面收口）+ 坡面边缘 + 落到地面。
  //     不要再补矩形 —— 那会和翼墙的三角面叠在一起，形状糊成一团。
  const zA = hillZ5(HX1), zB = hillZ5(HX0);
  //   ⚠ flatiso 的 `quad` 只认 4 点 ⇒ 三角形**末点重复**（同 wing5 的写法）
  q5(L, [[HX0, Y1, zB], [HX0, Y1, 0], [HX1, 1, zA], [HX1, 1, zA]], [0, 1, 0], HILL);
  q5(L, [[HX0, Y0, zB], [HX0, Y0, 0], [HX1, 0, zA], [HX1, 0, zA]], [0, -1, 0], HILL);
  return L;
}

/** 翼墙（竖向三角）+ 山体侧壁：与 gen-g1-tunnel.mjs 的 wingWall 同源（sgn>0 = +y 侧） */
function wing5(sgn) {
  const L = [];
  const Y = (v) => (sgn > 0 ? 1 - v : v);
  const ny = sgn > 0 ? 1 : -1;
  const yP = Y(TU.Y0), yE = sgn > 0 ? 1 : 0;
  const T = [TU.X1, yP, TU.TOP], B = [TU.X1, yP, 0];
  const C = [TU.HX1, yE, TU.HZ1], F = [TU.HX0, yP, 0];
  q5(L, [T, B, C, C], [0, ny, 0], TU.W);
  q5(L, [C, [TU.HX0, yP, hillZ5(TU.HX0)], F, F], [0, ny, 0], TU.HILL);
  return L;
}

/** 按顶点平均 y 把 quad 行切成「远半 / 近半」（同 gen-g1-tunnel.mjs 的 splitByY） */
function split5(lines) {
  const lo = [], hi = [];
  for (const l of lines) {
    if (!l.startsWith('quad')) { lo.push(l); continue; }
    const n = l.slice(4).trim().split(/\s+/);
    const ys = [1, 4, 7, 10].map((i) => Number(n[i]));
    ((ys.reduce((a, b) => a + b, 0) / ys.length) >= 0.5 ? hi : lo).push(l);
  }
  return { lo, hi };
}

function tunnel5Models() {
  // ★ 分层口径（人工 2026-10-04 定稿，别再反复）：
  //
  //   tunnels: 底图 = 洞内道床 / 轨道 / 暗幕 + 翼墙×2
  //                 + 洞门（柱脚 + 柱身）的**远半**
  //   overlay      = 洞门（柱脚 + 柱身）的**近半**
  //                 + **柱顶与过梁同高那一段（z ∈ [OH, TOP]）—— 整块，不分左右**
  //                 + 压顶 / 仰面 / 过梁
  //
  //   分界的由来（人工：「和洞口（也就是洞顶下沿，不是洞顶上沿）同高」）：
  //   过梁 lintel5() 本来就占 z ∈ [OH, TOP] 且在 overlay；柱子同一高度那段若留在
  //   tunnels:，会被引擎在它之后画的那层**草地覆盖**压掉 ⇒ 实机里柱子与过梁之间
  //   裂开一道缝。所以这一段必须跟着过梁一起进 overlay。
  //   ⚠ 柱脚 / 柱身仍按 y = 0.5 切（一根柱子整根在同一层），只是把最上面这一段
  //     额外整块加到两组 overlay 里 —— 不是把柱子切开。
  const base = [...metroTunnelGround(), ...wing5(-1), ...wing5(+1)];
  const low = split5(portalLow5());                    // 柱脚：按 y 切左右
  const high = split5(portalHigh5({ z1: TU.OH }));     // 柱身（洞口上沿以下）：按 y 切左右
  const crown = portalHigh5({ z0: TU.OH });            // 柱顶（与过梁同高）：整块
  const always = always5();
  const lintel = lintel5();
  const H = (name, title, extra) => '# =============================================================================\n'
    + `# ${name} —— ${title}\n#\n`
    + '# 【本文件由 tools/gen-a12-metro.mjs 生成，请勿手改】\n#\n'
    + extra
    + '# =============================================================================\n\n';
  const WHY = '# TUN-5 地铁矩形洞门（A12 / `SAC3`）\n'
    + '# 基准朝向 = DiagDir NE：洞口在 x=0 那条边（N–E），轨道沿 x\n'
    + '# 取图顺序 v0=NE  v1=NW  v2=SW  v3=SE；⚠ 引擎槽位顺序是 NE/SE/SW/NW ⇒ 喂图 v0,v3,v2,v1\n'
    + '#\n'
    + '# 【为什么四个模型】overlay 是一张 sortable sprite，只能放「离镜头近」的半边：\n'
    + '#   v0/v3 近半 = y ≥ 0.5      v1/v2 近半 = y < 0.5\n'
    + '#   A 组（_v0/_v3 用）：tunnels:=远半  overlay=近半\n'
    + '#   B 组（_v1/_v2 用）：tunnels:=近半  overlay=远半\n'
    + '#\n'
    + '# ⚠ 端墙尺寸（x 0.68~0.80 / 宽 y 0.16~0.84 / 板顶 0.272 / 压顶 / 仰面 / 翼墙）\n'
    + '#   **与 gen-g1-tunnel.mjs 的 TUN-1 逐字同源** —— 那是实机调了 4 轮才盖住\n'
    + '#   原版草山包的形状，别自己发明。\n';
  const out = [];
  const asm = (name, title, body, extra) => {
    const s = H(name, title, WHY + (extra || ''))
      + `name      ${name}\ngroup     misc\nfootprint 1 1\nzmax      0.2140\n\n`
      + body.join('\n') + '\n';
    out.push([name, s]);
  };
  asm('G4_tunnel5', 'A12 地铁洞口 TUN-5 —— tunnels: 组（A 组：远半）',
      [...base, ...low.lo, ...high.lo],
      '# --- 洞内轨道 + 暗幕 + 翼墙×2 + **洞门（柱脚 + 柱身）的远半** ---\n'
      + '#     （柱顶那一段不在这儿：它整块跟着过梁进了 tunnel_overlay）\n');
  asm('G4_tunnel5_over', 'A12 地铁洞口 TUN-5 —— tunnel_overlay: 组（A 组：近半 + 柱顶整块）',
      [...low.hi, ...high.hi, ...crown, ...always, ...lintel],
      '# --- **洞门近半（柱脚 + 柱身）** + **柱顶（与过梁同高，z ∈ [OH, TOP]，整块）**\n'
      + '#     + 压顶 + 仰面 + 过梁 ---\n');
  asm('G4_tunnel5_b', 'A12 地铁洞口 TUN-5 —— tunnels: 组（B 组：近半）',
      [...base, ...low.hi, ...high.hi],
      '# --- 洞内轨道 + 暗幕 + 翼墙×2 + **洞门（柱脚 + 柱身）的近半** ---\n'
      + '#     （柱顶那一段不在这儿：它整块跟着过梁进了 tunnel_overlay）\n');
  asm('G4_tunnel5_over_b', 'A12 地铁洞口 TUN-5 —— tunnel_overlay: 组（B 组：远半 + 柱顶整块）',
      [...low.lo, ...high.lo, ...crown, ...always, ...lintel],
      '# --- **洞门远半（柱脚 + 柱身）** + **柱顶（与过梁同高，z ∈ [OH, TOP]，整块）**\n'
      + '#     + 压顶 + 仰面 + 过梁 ---\n');
  return out;
}

// ---------------------------------------------------------------- 写文件
function header(name, lines) {
  return lines.filter((l) => l !== null).join('\n') + '\n';
}

function model(name, { zmax, notes, group = 'A12 组（`SAC3` 第三轨地铁）' }, body) {
  const head = [
    `# =============================================================================`,
    `# ${name} —— ${group}`,
    `#`,
    ...notes.map((n) => `# ${n}`),
    `#`,
    `# ⚠ 本文件由 tools/gen-a12-metro.mjs 生成（**整件重写**），别手改；改口径改生成器。`,
    `# =============================================================================`,
    ``,
    `name      ${name}`,
    `group     misc`,
    `footprint 1 1`,
    `zmax      ${zmax}`,
    ``,
  ].join('\n');
  const file = path.join(ROOT, 'models', `${name}.model`);
  fs.writeFileSync(file, head + body + '\n');
  return file;
}

// ---------------------------------------------------------------- 各件
const FLAT = 0.0280;                       // 平轨件的取景上限（与 G1 同）
const SLOPE = N(FLAT + RISE);              // 坡道件要罩住抬起来的那头

export function generate() {
  const files = [];

  // 1) 直向 underlay（完整画面）
  {
    const L = [];
    for (const b of trackShapes()) emitBox(L, b);
    files.push(model('G4_track_x', {
      zmax: fmt(FLAT),
      notes: [
        'underlay 槽 0/1（RTO_X / RTO_Y）：整体道床（`BAL-H`）+ 无枕扣件座（`SLE-5`）',
        '+ 第三轨（`RAI-4`）—— 完整画面（G1 的规矩：underlay 自带钢轨，overlay 才去掉道床）',
        '',
        '口径：板带 y 0.32~0.68（与 G1 道砟同宽）· 板顶 0.010 · **无中央排水沟**（人工 2026-10-03 去掉）',
        '      钢轨中心 0.4484 / 0.5516（=1435mm）· 轨顶 0.0230 · 扣件座 25 个（间距 0.04）',
        '      第三轨在 +y 外侧（人工：镜头视角的外侧）+ 木质覆盖板',
      ],
    }, header('G4_track_x', L)));
  }

  // 2) 直向 overlay（只有钢轨层）
  {
    const L = [];
    for (const b of trackShapes({ slab: false, third: false })) emitBox(L, b);
    files.push(model('G4_rail_straight', {
      zmax: fmt(FLAT),
      notes: [
        'overlay 槽 0/1（RTO_X / RTO_Y）：**透明底、只画钢轨 + 扣件座**',
        '（核自 rail_cmd.cpp:3796-3816：道岔瓦片 = 道床 underlay + 逐段 overlay 钢轨）',
        '',
        '⚠ **不含第三轨/罩**（人工 2026-10-03 排查）：道岔瓦片上引擎会按轨位**逐段**叠这张图',
        '   （三向道岔要叠 X/Y/N/S/E/W 里的 3 张）⇒ 第三轨会同时出现 3 套、互相穿插。',
        '   去掉之后道岔口没有第三轨 —— 与 G1 一样，也正是现实里道岔处该做的（接触轨必须断开）。',
      ],
    }, header('G4_rail_straight', L)));
  }

  // 3) 半格轨（斜向，切 N 角）
  {
    const L = [];
    for (const b of trackShapes()) emitDiag(L, b);
    files.push(model('G4_track_half', {
      zmax: fmt(FLAT),
      notes: [
        'underlay 槽 2-5（RTO_N / RTO_S / RTO_E / RTO_W）：**切 N 角的半格轨**',
        '（轨道线 x+y = 0.5，从 N 边中点到 W 边中点；4 个朝向给出 4 个角）',
        '',
        '斜向映射 c = y、d = x−0.5 ⇒ (x,y) = ((c+d)/2, (c−d)/2)；不乘 √2，',
        '因为 G1 是按**屏幕像素**对齐的（斜向两轨在屏上的间距同样是 6.6 px）。',
        '映射是镜像（det = −1/2），顶点序由 ccw() 统一归正。',
      ],
    }, header('G4_track_half', L)));
  }

  // 4) 半格轨 overlay
  {
    const L = [];
    for (const b of trackShapes({ slab: false, third: false })) emitDiag(L, b);
    files.push(model('G4_rail_half', {
      zmax: fmt(FLAT),
      notes: [
        'overlay 槽 2-5：半格轨的**钢轨层**（透明底，无道床）',
        '',
        '同样**不含第三轨/罩**（道岔瓦片会逐段叠这张图，见 G4_rail_straight 的说明）。',
      ],
    }, header('G4_rail_half', L)));
  }

  // 3b) 半格轨**镜像版**：第三轨在板带另一侧，供 RTO_S / RTO_E 用
  //     （overlay 层不用镜像 —— 它不含第三轨，而板/钢轨本来就对称。）
  {
    const L = [];
    for (const b of trackShapes({ flip: true })) emitDiag(L, b);
    files.push(model('G4_z_track_half_m', {
      zmax: fmt(FLAT),
      notes: [
        'underlay 槽 3/4（RTO_S / RTO_E）专用：半格轨的**镜像版**（第三轨在 −y 侧）',
        '',
        '镜像是关于板带中心 y = 0.5 做的 ⇒ 板 / 钢轨 / 扣件座与原版逐字相同，',
        '只有第三轨 + 罩换到另一侧。接法（见 railsprite.pnml）：',
        '  RTO_N ← G4_track_half.v0     RTO_W ← G4_track_half.v1',
        '  RTO_S ← **本件.v2**          RTO_E ← **本件.v3**',
        '引擎给斜向链的 LEFT 取 v1、RIGHT 取 v3（相差 180°）；本件的 180° 再把镜像翻回来，',
        '于是同一条直线上的第三轨落在同一侧（人工 2026-10-03 实机截图的左右交错）。',
      ],
    }, header('G4_z_track_half_m', L)));
  }

  // 5) 坡道（基准 SLOPE_NE：z += RISE·(1−x)）
  {
    const L = [];
    for (const b of trackShapes()) emitSheared(L, b);
    files.push(model('G4_track_slope', {
      zmax: fmt(SLOPE),
      notes: [
        'underlay 槽 6-9（RTO_SLOPE_NE / SE / SW / NW）：坡道',
        '',
        '基准朝向 = SLOPE_NE，地面 z 只随 x 变：`z(x) = RISE·(1−x)`（RISE = 0.2041 = 一格',
        '坡道抬 32 px @4x，与 tools/gen-g1-slope.mjs 同源）。每个顶点都按这个抬 ⇒ 整条',
        '道床/钢轨自然贴成斜面；box/prism 都是轴对齐的，所以六个面全用 quad 手写。',
        '4 个朝向给出 4 个坡向（喂图顺序 v0,v3,v2,v1，见 railsprite.pnml）。',
      ],
    }, header('G4_track_slope', L)));
  }

  // 6) 坡道 overlay
  {
    const L = [];
    for (const b of trackShapes({ slab: false, third: false })) emitSheared(L, b);
    files.push(model('G4_rail_slope', {
      zmax: fmt(SLOPE),
      notes: [
        'overlay 槽 6-9：坡道的**钢轨层**（透明底，无道床、无第三轨 —— 同 G4_rail_straight 的理由）',
      ],
    }, header('G4_rail_slope', L)));
  }

  // 7) 交叉（X ∪ Y，自带两组钢轨）—— 形状见 `crossingShapes()`（A13 的浅色板共用同一份）
  {
    const L = crossingShapes();
    files.push(model('G4_crossing', {
      zmax: fmt(FLAT),
      notes: [
        'underlay 槽 10（RTO_CROSSING_XY）：交叉，**自带两组钢轨**（G1 的交叉也是这样）',
        '',
        '道床板 = X 带 ∪ Y 带（十字），拆成 3 块互不重叠的轴对齐板（共面重叠会 z-fighting）；',
        '板本身已无排水沟。两组钢轨/扣件座各自整格；',
        '第三轨与罩**两个方向都在对方板带处断开成两段**。',
      ],
    }, header('G4_crossing', L)));
  }

  // 8) 三向道岔（只有道床板）
  {
    const L = [];
    for (const b of slabJunction3()) emitSlab(L, b);
    files.push(model('G4_junction3', {
      zmax: fmt(FLAT),
      notes: [
        'underlay 槽 11-14（RTO_JUNCTION_SW / NE / SE / NW）：三向道岔的道床板',
        '',
        '**只有道床板，没有钢轨**（同 G1：道岔瓦片由引擎逐段叠 overlay 的钢轨层）。',
        '形状（人工 2026-10-03 裁定）= **矩形 + 梯形** = 六边形：',
        '  (0.32,0) (0.68,0) (1,0.32) (1,0.68) (0.68,1) (0.32,1)',
        '—— 矩形是北/南两臂（x 0.32~0.68 全 y），东侧那两条 45° 斜边是梯形；',
        '   缺的那条臂（基准朝向左边的"西"）由 4 个朝向转到 NE/SW/SE/NW 四个槽位上。',
        '   45° 切的进深 0.32 = 对角线板带半宽 0.18 的补（0.5 − 0.18），与交叉板带同口径。',
      ],
    }, header('G4_junction3', L)));
  }

  // 9) 四向道岔（十字 + 北/南角三角）
  {
    const L = [];
    for (const b of slabJunction4()) emitSlab(L, b);
    files.push(model('G4_junction4', {
      zmax: fmt(FLAT),
      notes: [
        'underlay 槽 15（RTO_JUNCTION_NSEW）：四向道岔的道床板',
        '',
        '形状（人工 2026-10-03 裁定）= **正八边形**：整格切掉四个 45° 角。',
        '  (0.32,0) (0.68,0) (1,0.32) (1,0.68) (0.68,1) (0.32,1) (0,0.68) (0,0.32)',
        '八条边 = 瓦片四条边（各被切掉 0.5−0.18 = 0.32 的两端）+ 四条 45° 斜边；',
        '斜边正好是对角线板带（|x+y−0.5| ≤ 0.18 及其镜像）的外沿。',
        '同样不带钢轨（overlay 负责）。',
      ],
    }, header('G4_junction4', L)));
  }

  // 10) 洞口 TUN-5（地铁矩形洞门）—— 4 个模型：地面层 ×2（A/B 组）+ 立体层 ×2
  for (const [name, text] of tunnel5Models()) {
    const f = path.join(ROOT, 'models', `${name}.model`);
    fs.writeFileSync(f, text);
    files.push(f);
  }

  // ===========================================================================
  // 11) A13 组（`SBC3` 第三轨地铁 · 道床 `BAL-I`）—— **七件：凡是有板面的都要重画**
  //
  //   人工 2026-10-05 确认门（D11）批准：道床 `BAL-I`、轨枕 `SLE-5`、钢轨 `RAI-4`、
  //   洞口 **复用 TUN-5**、电气化 **无**（第三轨 ⇒ `EL-NONE`，不设 CATENARY flag）。
  //   C8：地图色 **0x62** · `SORT_ELECTRIC` · **禁平交道口** · 曲线限速 1.0 ·
  //        120 km/h · 费用 10 / 5（CSV 第 8 列）。
  //
  //   ★ 2026-10-06 人工改口径：「`BAL-I` **不要浮置版了**，改成**浅色混凝土**（不要暖色）」
  //     ⇒ 方案 B = **素面板**（板缝 / 减振垫 / 边缘线全部不要），只把板体换成
  //       `concrete_light`。于是 `BAL-I` 与 `BAL-H` 的差别**只剩板面材质**。
  //
  //   ★★ **由此必须一起重画的是"有板面的每一件"**（这条是上一版留下的坑，记在这儿）：
  //       上一版板面与 A12 同色，所以「交叉 / 三向 / 四向」三张道床板 + 桥面可以
  //       **逐字复用 `gfx/metro.png`**；现在板面变浅了，再复用就会在**岔口**
  //       （以及桥面）露出一块**中灰的旧板**——直线段是浅色、岔口是中灰，一眼就是错的。
  //       ⇒ 本组出 **7 件**：
  //           · 带板带的四件：直向 / 半格 / 镜像半格 / 坡道
  //           · **交叉 / 三向 / 四向**三张道床板（形状照旧：十字 / 六边形 / 八边形）
  //         仍然复用 A12 的只有：**overlay 三件**（纯钢轨层，本来就没有道床）、
  //         **洞口四件**（TUN-5，A12/A13 共用）、桥面以外的其余。
  //       ⚠ 摆位值（`xrel/yrel`）这七件**全部等于 A12 对应那件**：模型几何逐字相同
  //         （只差材质名），格位也一样（263×147，与 metro 表同）⇒ `templates.pnml`
  //         里 `t_G7_*` 的 xrel/yrel 照抄 `t_G4_*`，只有 `rect` 是本表的格位。
  // ===========================================================================
  const A13 = 'A13 组（`SBC3` 第三轨地铁 · `BAL-I` 浅色混凝土道床）';
  const SLAB_LIGHT = MAT.slabLight;
  const A13_NOTE = [
    `道床 \`BAL-I\`（无砟·**浅色混凝土**素面板）= \`BAL-H\` 的板带换板面材质 \`${SLAB_LIGHT}\``,
    '（本地增补；基色 (184,191,203) ⇒ 顶面渲出 ≈(185,185,185)，**中性、不暖**）。',
    '**没有板缝、没有减振垫、没有边缘线**（人工 2026-10-06 推翻"浮置板"那一版，方案 B）。',
    '',
    '⚠ 本件与 A12 的 `G4_*` **几何逐字相同、只差板面材质**：轨枕 `SLE-5` / 钢轨 / 第三轨 /',
    '  扣件座 / 板带宽度 / 板顶 0.010 一个数没动 ⇒ 格位与摆位值同 G4（`xrel/yrel` 照抄）。',
  ];

  // 11a) 直向板（underlay 槽 0/1）
  {
    const L = [];
    for (const b of trackShapes({ slabMat: SLAB_LIGHT })) emitBox(L, b);
    files.push(model('G7_track_x', {
      zmax: fmt(FLAT), group: A13,
      notes: [
        'underlay 槽 0/1（RTO_X / RTO_Y）：**浅色混凝土地铁道床**完整画面',
        '（板 + 扣件座 + 钢轨 + 第三轨）',
        ...A13_NOTE,
      ],
    }, header('G7_track_x', L)));
  }
  // 11b) 半格轨（斜向，切 N 角；underlay 槽 2-5）
  {
    const L = [];
    for (const b of trackShapes({ slabMat: SLAB_LIGHT })) emitDiag(L, b);
    files.push(model('G7_track_half', {
      zmax: fmt(FLAT), group: A13,
      notes: [
        'underlay 槽 2 / 5（RTO_N / RTO_W）：浅色道床的切 N 角半格轨',
        ...A13_NOTE,
      ],
    }, header('G7_track_half', L)));
  }
  // 11c) 半格轨镜像版（第三轨在 −y 侧；underlay 槽 3/4）
  {
    const L = [];
    for (const b of trackShapes({ slabMat: SLAB_LIGHT, flip: true })) emitDiag(L, b);
    files.push(model('G7_z_track_half_m', {
      zmax: fmt(FLAT), group: A13,
      notes: [
        'underlay 槽 3/4（RTO_S / RTO_E）专用：浅色道床半格轨的**镜像版**（第三轨在 −y 侧）',
        ...A13_NOTE,
        '',
        '镜像关于板带中心 y = 0.5 做 ⇒ 板 / 钢轨 / 扣件座本来就关于 0.5 对称、逐字不变，',
        '只有第三轨 + 罩换到另一侧。理由与接法见 `G4_z_track_half_m`（A12，逐字同源）。',
      ],
    }, header('G7_z_track_half_m', L)));
  }
  // 11d) 坡道（基准 SLOPE_NE；underlay 槽 6-9）
  {
    const L = [];
    for (const b of trackShapes({ slabMat: SLAB_LIGHT })) emitSheared(L, b);
    files.push(model('G7_track_slope', {
      zmax: fmt(SLOPE), group: A13,
      notes: [
        'underlay 槽 6-9（RTO_SLOPE_NE / SE / SW / NW）：浅色道床坡道',
        ...A13_NOTE,
        '',
        '⚠ 坡道**不探出边界**（两端各有硬理由，见 `emitSheared`）。',
      ],
    }, header('G7_track_slope', L)));
  }
  // 11e) 交叉（underlay 槽 10）—— 形状与 A12 共用 `crossingShapes()`，只换板面材质
  {
    const L = crossingShapes(SLAB_LIGHT);
    files.push(model('G7_crossing', {
      zmax: fmt(FLAT), group: A13,
      notes: [
        'underlay 槽 10（RTO_CROSSING_XY）：浅色道床的交叉，**自带两组钢轨**',
        ...A13_NOTE,
        '',
        '★ 上一版这件**复用 A12 的中灰板**，板面变浅后复用就会在岔口露出一块中灰 —— 见 §11 的 ★★。',
      ],
    }, header('G7_crossing', L)));
  }
  // 11f) 三向道岔（underlay 槽 11-14）
  {
    const L = [];
    for (const b of slabJunction3(0, SLAB_Z, SLAB_LIGHT)) emitSlab(L, b);
    files.push(model('G7_junction3', {
      zmax: fmt(FLAT), group: A13,
      notes: [
        'underlay 槽 11-14（RTO_JUNCTION_SW / NE / SE / NW）：浅色道床的**三向道岔板**',
        ...A13_NOTE,
        '',
        '形状（六边形 = 矩形 + 梯形）与 A12 的 `G4_junction3` 逐字相同，只有板面材质不同。',
        '**只有道床板、没有钢轨**（道岔瓦片由引擎逐段叠 overlay 的钢轨层）。',
      ],
    }, header('G7_junction3', L)));
  }
  // 11g) 四向道岔（underlay 槽 15）
  {
    const L = [];
    for (const b of slabJunction4(0, SLAB_Z, SLAB_LIGHT)) emitSlab(L, b);
    files.push(model('G7_junction4', {
      zmax: fmt(FLAT), group: A13,
      notes: [
        'underlay 槽 15（RTO_JUNCTION_NSEW）：浅色道床的**四向道岔板**',
        ...A13_NOTE,
        '',
        '形状（正八边形）与 A12 的 `G4_junction4` 逐字相同，只有板面材质不同。',
        '**只有道床板、没有钢轨**（同上）。',
      ],
    }, header('G7_junction4', L)));
  }

  return files;
}

if (isMain(import.meta.url)) {
  const t0 = Date.now();
  const files = generate();
  for (const f of files) log(`  → ${rel(f)}`);
  log(`✔ 生成 ${files.length} 个模型，用时 ${((Date.now() - t0) / 1000).toFixed(2)} s`);
}
