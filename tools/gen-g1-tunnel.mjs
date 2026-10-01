// =============================================================================
// tools/gen-g1-tunnel.mjs —— 生成 G1 的 TUN-1「料石端墙拱」两个模型
//
//   node tools/gen-g1-tunnel.mjs        （或 make tunnel）
//
// 产出（**会被本工具整份重写**，别手改）：
//   models/G1_tunnel_stone.model        tunnels: 组（地面层）4 朝向
//                                       = 道砟 + 轨枕 + 钢轨 + 洞口暗腔
//   models/G1_tunnel_stone_over.model   tunnel_overlay: 组（立体层）4 朝向
//                                       = 料石端墙 + 半圆拱 + 压顶
//
// -----------------------------------------------------------------------------
// 【为什么分两层】（核自官方 wiki，见 docs/建模经验.md §7.8）
//
//   https://newgrf-specs.tt-wiki.net/index.php?title=NML:Railtypes
//
//   `tunnels`：1 sprite for each direction，4 张。
//   `tunnel_overlay`：一旦定义，该轨道的隧道改按另一套画：
//       先画基底的草地 underlay → 再画 `tunnels` 的图 → 再画车 →
//       再画草地 overlay → 最后画 `tunnel_overlay` 的图。
//     并且明确写着：**草地底图不含轨道和洞口的任何部分，必须由轨道包自己画全。**
//
// -----------------------------------------------------------------------------
// 【基准朝向：DiagDirection NE —— 洞口在 x=0 那条边】
//
//   本工程 flatiso 坐标 ≡ OpenTTD 瓦片坐标：
//     screen_x = (y−x)·128      screen_y = (x+y)·64 − z·156.7673
//   四角（与坡道那套一致，已实机验证）：北 N=(0,0) 东 E=(0,1) 南 S=(1,1) 西 W=(1,0)
//
//   DiagDir NE 的邻格偏移是 (−1,0)（OpenTTD `_tileoffs_by_diagdir`），
//   投影到屏幕是**右上** ⇒ 隧道往右上去 ⇒ 洞门立在 **N–E 边 = x=0 那条边**。
//   而 DiagDir NE 对应 Axis::X ⇒ 瓦片上的轨道是 TRACK_X，
//   它正好从 S–W 边（x=1）穿到 N–E 边（x=0）—— 轨道从 x=1 进来、在 x=0 进洞 ✓
//
//   ⇒ 基准模型：轨道沿 x，洞门在 x=0。**与 SLOPE_NE 的基准朝向完全相同。**
//
//   槽位          洞口所在边      flatiso 边    瓦片轨道
//   NE（引擎槽0）  N–E（右上）     x=0 边        TRACK_X
//   SE（引擎槽1）  E–S（右下）     y=1 边        TRACK_Y
//   SW（引擎槽2）  S–W（左下）     x=1 边        TRACK_X
//   NW（引擎槽3）  W–N（左上）     y=0 边        TRACK_Y
//
// -----------------------------------------------------------------------------
// 【取图顺序 v0=NE v1=NW v2=SW v3=SE】——与坡道完全一样
//   绕占地中心转模型（flatiso core/raster.mjs:19-42），90° 那步是 (x,y)→(1−y,x)
//   ⇒ view k 把 view0 位于角 C 的特征搬到 R^(−k)(C)，R 是引擎四重旋转（北→东→南→西）
//   v0 抬 N–E 边，于是 v0=NE v1=NW v2=SW v3=SE
//
//   ⚠ 引擎槽位顺序（NE/SE/SW/NW）⇒ 喂图必须是 v0, v3, v2, v1
//
//   ⚠⚠ 注意：官方 wiki 说 `tunnels` 的顺序是「SW, NW, NE, SE」。
//        这与本地引擎源码 `_tileoffs_by_diagdir`（第 0 项 = NE）以及
//        JP+ 的实际产物都对不上，详见 docs/建模经验.md 的隧道一节。
//        本工程**按引擎顺序**接线；实机一看便知，改 src/rails/railsprite.pnml 四行即可。
//
// -----------------------------------------------------------------------------
// 【v1 范围】人工裁定：**先只做端墙 + 拱**，石砌护坡下一轮再加。
//   所以这里没有护坡（翼墙 / 锥坡），只有：
//     端墙（含拱洞）+ 半圆拱圈 + 墙顶压顶
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { ROOT, log, rel, isMain } from './util.mjs';

const N = (v) => v.toFixed(4);
const SLEEPER_MAT = ['wood_dark', 'wood_seam', 'wood_dark', 'wood_seam'];

// ---- 轨道（与 probe_track_x / 坡道那套完全一致，这里只是不抬 z）-------------
const B0 = 0.32, B1 = 0.68;          // 道砟带宽
const CN = 32, RN = 5;               // 道砟网格
const SLEEPER_BASE = 0.0000;
const SLEEPER_TOP = 0.0100;
const RAIL_BASE = 0.0100;
const RAIL_TOP = 0.0230;
const RAIL_Y = [[0.5476, 0.5556], [0.4444, 0.4524]];   // 两条钢轨的 y 区间

// ---- v4 布局（人工裁定 2026-10）：**洞门立在瓦片后半部，后面留出仰面** ------
//
//   核心修正：v1~v3 都把洞口贴在瓦片后沿（x=0），结果**后面一点空间都没有**，
//   仰面只能挤进墙厚里 0.016 格（= 等于没做）。现在把洞门往里挪到瓦片后半部，
//   后面 0.30 格腾出来给仰面。
//
//   x = 0 瓦片后沿（山那一侧）      x = 1 前沿（来车方向）
//   y 横向，中线 0.5 = 轨道中心     z 向上，地面 = 0
//
//     x:  0 ─────────── 0.28 ─── 0.42 ──────────────────── 1
//         │  仰面/山体  │  拱形板  │    道砟 + 轨道 + 护坡      │
//         │  升到 0.2041 │  红+蓝   │                          │
//
//   ★ 总高度 = **一层地形**（LEV）。人工实测确认：一格坡抬 32 px @4x，
//     而我们的 G1_track_slope 在实机里是对的 ⇒ 一层地形 = 32/156.7673 = 0.2041 格。
const LEV = 0.2041;                  // 一层地形的高度（flatiso z）

// ---- 拱形板（洞门本体）：一块**有厚度的板**，中间开半圆拱洞 -----------------
//   人工裁定：位置**从朝外那面量 0.2** ⇒ 板正面在 x = 0.80。
//   为什么必须这么靠外：定义了 tunnel_overlay 后引擎换用 SPR_RAILTYPE_TUNNEL_BASE
//   （注释 "tunnel sprites with **grass only**"）—— **只换材质、形状还在**，
//   原版那个草山包永远在那儿，只能靠我们的图去盖住它。
const SLAB_X0 = 0.6800;              // 板背面（朝山）
const SLAB_X1 = 0.8000;              // 板正面（朝来车）—— 从外量 0.2
const SLAB_Y0 = 0.1600;              // 板宽 0.68 格 = 9.5 m
const SLAB_Y1 = 0.8400;
const SLAB_TOP = 0.2720;             // 【变体 2】板顶加高（原 LEV*0.98 = 0.2000）

const ARCH_CY = 0.5000;              // 拱心（y）—— **也是左右切分线**
const ARCH_R = 0.1550;               // 拱半径 = 洞宽的一半（0.31 格 = 4.3 m）
// ★ 人工裁定：**拱顶固定**（洞的尺寸不动），板顶单独往上抬 ⇒
//   拱顶到板顶之间出现一条 SLAB_TOP-ARCH_CROWN = 0.0720 厚的**石梁**（见 archBeam()）。
const ARCH_CROWN = 0.2000;           // 拱顶（**不跟随 SLAB_TOP**）
const ARCH_SPRING = ARCH_CROWN - ARCH_R;   // 起拱线 = 0.0450
const ARCH_Y0 = ARCH_CY - ARCH_R;    // 0.365
const ARCH_Y1 = ARCH_CY + ARCH_R;    // 0.635
const NA = 128;                      // 拱线细分（原来 48 —— 太粗，拱边出现锯齿台阶）

// ---- 仰面（绿）：**水平**的山顶面（人工裁定：不做斜升，斜升会把洞口压矮）---
//   高度 = 一层地形；**末端完全填满瓦片边缘**（y 0→1）。
//   ⚠ 必须归 tunnel_overlay: 层 —— 原版那个草山包画在这一层，
//     放进 tunnels:（更早画）会被它盖住。
const HILL_X0 = SLAB_X0;             // 0.68（前沿）
const HILL_X1 = 0.0000;              // 0（瓦片后沿）
const HILL_Z1 = LEV;                 // 0.2041（山体在后沿处的高度 —— 必须 = 一层地形）
// ★ 人工裁定 2026-10（看完手绘「图二」之后）：
//     "A 两侧收窄到石门宽度，让斜坡成为山体侧面"
//     "然后把仰面做成从洞口到山体斜降下去的"
//     再修："仰面收窄了但是还是矩形，我希望做成贴合侧面的梯形效果"
//   ⇒ 仰面（顶坡）做成**梯形**：
//       后沿（x=HILL_X1）满宽 y∈[0,1]，前沿（x=HILL_X0）只有石门宽 y∈[SLAB_Y0,SLAB_Y1]；
//       两条斜边正好贴住斜面（竖向翼墙）的走向 —— 从洞口石柱顶一路撇到瓦片后角。
//     高度：x=HILL_X0（洞口）处 = SLAB_TOP，向山体降到 x=HILL_X1 处的 HILL_Z1。
const HILL_Y0 = 0.0000;              // 瓦片后沿的左端（仰面在这里满宽）
const HILL_Y1 = 1.0000;              // 瓦片后沿的右端

/** 仰面在 x 处的高度：洞口 = SLAB_TOP，向山体斜降到 HILL_Z1 */
function hillZ(x) {
  const t = (HILL_X0 - x) / (HILL_X0 - HILL_X1);      // x=HILL_X0 → 0，x=HILL_X1 → 1
  return SLAB_TOP + (HILL_Z1 - SLAB_TOP) * t;
}

/** 锥坡/斜坡在 x 处的高度：洞口正面(SLAB_X1)为 0，到瓦片后沿为 HILL_Z1 */
function rampZ(x) {
  return HILL_Z1 * (SLAB_X1 - x) / SLAB_X1;
}

// ---- 压顶：板顶出挑的一圈 ---------------------------------------------------
const COPING_X0 = SLAB_X0 - 0.0120;
const COPING_X1 = SLAB_X1 + 0.0120;
const COPING_Y0 = SLAB_Y0 - 0.0180;
const COPING_Y1 = SLAB_Y1 + 0.0180;
const COPING_TOP = SLAB_TOP + 0.0140;

// ---- 洞口暗幕：贴在板背面之后的一块黑板，堵住拱洞 --------------------------
const BORE_X = SLAB_X0 - 0.0100;     // 0.67（板后 0.01）

// ---- 八字翼墙 / 锥坡的尺寸（见下面的 wing()）--------------------------------
//   （旧版那对 x∈[0.80,0.98] 的"八字锥坡护坡"已删除，改成整片翼墙 + 锥坡）

// ---- 轨道：**保持原有枕木间距与纹理尺度**，只把板前面那部分留下 -------------
//   ⚠ 不是把整格等比例压缩！上一版犯过这个错（25 根枕木被压进 0.58 格）。
//   人工裁定：**铺满整格**（原来只在板前面 0.2 格，太短）——
//   板后面那截被仰面（overlay 层）盖住看不见，但保证与邻格接轨连续。
const ZMAX_PIN = '0.2140';           // 钉死取景框（= 当前最高点：压顶顶 0.2140）
const TRACK_X0 = 0.0000;
const TRACK_X1 = 1.0000;

/** 拱线：给定 y 返回拱腹的 z；超出拱跨返回 null（= 落到地面） */
function archZ(y) {
  const d = Math.abs(y - ARCH_CY);
  if (d >= ARCH_R) return null;
  return ARCH_SPRING + Math.sqrt(ARCH_R * ARCH_R - d * d);
}

// ---------------------------------------------------------------------------
// 图元朝向：**显式给目标法线，绕序自动纠正**
//
// ⚠⚠ 踩过的坑（2026-10，实机"四个朝向都像凹进去"）：
//   flatiso 的 `quad` 不传法线时，法线是**按顶点绕序用 Newell 法算的**
//   （core/mesh.mjs:56 `const n = o.normal ? norm(o.normal) : newell(pts)`）。
//   而 flatiso 自己的 `box` 原语（mesh.mjs:213-218）**每一步都显式传了 normal**，
//   所以它不在乎绕序 —— 从它那儿"抄绕序"是抄不到的，抄来也是错的。
//   从 gen-g1-slope.mjs 的 slab() 抄来的那套侧面绕序**四个面全是反的**：
//     x=x1 → 算出 −x 、x=x0 → 算出 +x 、y=y0 → 算出 +y 、y=y1 → 算出 −y
//   坡道那边没暴露是因为枕木/钢轨侧面只有 0.01 格高，是细条；
//   隧道端墙是一整面大平板，一上去就穿帮。
//
//   ⇒ 本文件一律用 q4o(pts, want, mat)：把**应该朝哪**写出来，绕序机器纠正。
// ---------------------------------------------------------------------------

/**
 * 多边形法线（**Newell 法**，对全部顶点求和）
 *
 * ⚠⚠ 2026-10 踩的坑：原来用「前三个顶点的叉积」。拱洞腹墙的条带里，
 *   左侧那批的**前三个顶点全在拱顶高度上**（z1 恰好 = ARCH_CROWN），三点共线
 *   ⇒ 叉积为 0 ⇒ q4o 判不出该朝哪边 ⇒ 绕序没被纠正 ⇒ 整批被判成背面**剔掉**，
 *   黑洞从缝里透出来，洞口边缘就是一把梳子（人工报的"破碎"）。
 *   Newell 法对重复顶点 / 共线不退化，换成它。
 */
function faceNormal(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

/** 输出一个 quad，保证其法线朝向 want（反向就翻转顶点序） */
function q4o(pts, want, mat) {
  const n = faceNormal(pts);
  const d = n[0] * want[0] + n[1] * want[1] + n[2] * want[2];
  const p = d >= 0 ? pts : [...pts].reverse();
  return 'quad ' + p.map(([x, y, z]) => N(x) + ' ' + N(y) + ' ' + N(z)).join('  ') + '   ' + mat;
}

/** 轴对齐长方体（顶面 + 4 侧面，不做底面）。法线全部显式朝外。 */
function box(x0, y0, x1, y1, zb, zt, side, top = null) {
  const P = (x, y, z) => [x, y, z];
  return [
    q4o([P(x0, y0, zt), P(x1, y0, zt), P(x1, y1, zt), P(x0, y1, zt)], [0, 0, 1], top ?? side),   // 顶
    q4o([P(x1, y0, zb), P(x1, y0, zt), P(x1, y1, zt), P(x1, y1, zb)], [1, 0, 0], side),         // x=x1
    q4o([P(x0, y0, zb), P(x0, y1, zb), P(x0, y1, zt), P(x0, y0, zt)], [-1, 0, 0], side),        // x=x0
    q4o([P(x0, y0, zb), P(x0, y0, zt), P(x1, y0, zt), P(x1, y0, zb)], [0, -1, 0], side),        // y=y0
    q4o([P(x0, y1, zb), P(x1, y1, zb), P(x1, y1, zt), P(x0, y1, zt)], [0, 1, 0], side),         // y=y1
  ];
}

// ---- 道砟（平铺，与坡道那版同风格）----------------------------------------
function ballast(seed) {
  const rnd = (() => { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const wav = [];
  for (let i = 0; i <= CN; i++) wav.push([(rnd() - 0.5) * 2 * 0.012, (rnd() - 0.5) * 2 * 0.012]);
  const yb = (r, i) => (r === 0 ? B0 + wav[i][0] : r === RN ? B1 + wav[i][1] : B0 + (B1 - B0) * r / RN);
  const hz = (r, i) => 0.0005 + 0.005 * (0.5 + 0.5 * Math.sin(i * 1.7 + r * 2.3)) + 0.0006 * ((i * 7 + r * 13) % 5) / 4;
  const L = [];
  const X = (i) => i / CN;         // ★ 原尺度 —— 绝不压缩
  for (let r = 0; r < RN; r++) for (let i = 0; i < CN; i++) {
    const x0 = X(i);
    const x1 = X(i + 1), y0 = yb(r, i), y1 = yb(r + 1, i);
    L.push('quad ' + N(x1) + ' ' + N(y0) + ' ' + N(hz(r, i + 1)) +
           '  ' + N(x1) + ' ' + N(y1) + ' ' + N(hz(r + 1, i + 1)) +
           '  ' + N(x0) + ' ' + N(y1) + ' ' + N(hz(r + 1, i)) +
           '  ' + N(x0) + ' ' + N(y0) + ' ' + N(hz(r, i)) + '   gravel');
  }
  return L;
}

// ---- 轨枕 / 钢轨（沿 x，平铺）---------------------------------------------
function sleepers() {
  const L = [];
  const NT = 25, HW = 0.008;
  for (let i = 0; i < NT; i++) {
    const t = 0.012 + 0.976 * i / (NT - 1);
    // 铺满整格：不再按洞口裁掉枕木
    for (let s = 0; s < 3; s++) {
      const a = 0.41 + 0.06 * s, b = a + 0.06;
      L.push(...box(t - HW, a, t + HW, b, SLEEPER_BASE, SLEEPER_TOP, SLEEPER_MAT[(i + s) % 4], 'wood_seam'));
    }
  }
  return L;
}

function rails() {
  const L = [];
  for (const [a, b] of RAIL_Y) L.push(...box(0, a, 1, b, RAIL_BASE, RAIL_TOP, 'rust', 'metal'));
  return L;
}

// ---- 【已删除】八字锥坡护坡（原 WING_* 那一套）----------------------------
//   人工裁定 2026-10：**护坡删掉**。
//   理由：形状一直没调对，而洞口两侧现在已经有「斜面（竖向翼墙）+ 斜坡（锥坡）」
//   承担边坡这件事，留着只会互相打架。原来那 4 个面 ×2 已从模型里移除。


// ---------------------------------------------------------------------------
// ★ 锥坡（斜坡）+ 山体侧壁 —— 按人工手绘「图二」+ 人工文字说明
//
//   人工原话：
//     "给 tunnel stone over 添加斜面和斜坡。注意两边都要改，
//      注意不要生成多余的面防止遮挡其他精灵"
//     "斜面应该是垂直于地面。斜面的尺寸是连接**顶上那格的瓦片边缘点**，
//      石门柱子底端和顶端的三角形。斜坡则和斜面共边"
//     追问"第三个点落在哪条瓦片边" → 人工答：**D，靠山一侧的角**。
//
//   ⚠ 人工后续裁定 2026-10：**斜面（竖向翼墙那块三角形）删掉**，
//     仰面（梯形斜顶）和山体侧壁不动。这里只留斜坡 + 侧壁。
//
//   三个确定的点（右翼写出来；左翼把 y → 1−y 镜像）：
//     石柱底端 B = (SLAB_X1, 0.84, 0)
//     山侧角点 C = (0,       1,    HILL_Z1)   ← 山体顶面在瓦片后沿的那个角
//     落地外缘 D = (SLAB_X1, 1,    0)
//   ⇒ 斜坡 = 四边形 B-C2-C-D（平面 z = rampZ(x)，与 y 无关）：
//       从瓦片后沿的角点一路斜降到洞口正面处的地面。
// ---------------------------------------------------------------------------
function wingWall(sgn) {
  const Y = (v) => (sgn > 0 ? 1 - v : v);
  const ny = sgn > 0 ? 1 : -1;                     // 外侧朝外的方向
  const yP = Y(SLAB_Y0);                           // 石柱外侧面（左 0.16 / 右 0.84）
  const yE = sgn > 0 ? 1.0000 : 0.0000;            // 瓦片外沿（左 0 / 右 1）
  const P = (x, y, z) => [x, y, z];
  const T = P(SLAB_X1, yP, SLAB_TOP);              // 石柱顶端（斜面删除后已不用，留着做参照）
  const B = P(SLAB_X1, yP, 0);                     // 石柱底端
  const C = P(HILL_X1, yE, HILL_Z1);               // 靠山一侧的瓦片角点
  const D = P(SLAB_X1, yE, 0);                     // 斜坡落地外缘
  // ⚠ flatiso 的 quad 只认 12 个数（4 个顶点）—— 三角形要把末点重复一次
  const TRI = (a, b, c, want, mat) => q4o([a, b, c, c], want, mat);
  // ★ 仰面做成梯形之后，山体侧面就只剩「梯形斜边 → 斜坡面」之间那一条竖直三角：
  //     上边 = 仰面斜边（洞口石柱顶 → 瓦片后角）
  //     下边 = 斜坡面（正好落在斜坡平面上，共边）
  //     前边 = 洞口处那根竖直线
  const C2 = P(HILL_X1, yP, HILL_Z1);              // 同一角、但贴在石门侧面那条
  const F = P(HILL_X0, yP, 0);                     // 山体侧壁下边前端（落到地面）
  return [
    // ★ 侧面（竖向三角）：石柱顶端 / 底端 + 靠山一侧的瓦片角 —— 人工要求保留
    TRI(T, B, C, [0, ny, 0], 'stone'),
    // 山体侧壁（仰面斜边往下封到地面）
    TRI(C, P(HILL_X0, yP, hillZ(HILL_X0)), F, [0, ny, 0], 'dirt'),
  ];
}

// ---- 隧道内壁（拱腹曲面）---------------------------------------------------
//
//   ★ 人工指出："tunnel stone 内壁没有渲染出来的问题"；后又指出
//     "隧道内拱有边缘出现透明模糊情况"。
//
//   第二版的错：整条半圆柱都生成，靠镜头那一半的法线朝外被**背面剔除**，
//   而"剔除 / 保留"的交界落在分段边界上 ⇒ 一排梳齿，再叠抗锯齿就成了毛边。
//
//   ⇒ 现在**只生成真正看得见的那一段弧**，交界落在精确临界角上，是一条干净的直线。
//     可见条件： n·v > 0，其中 n = (0, −sinθ, −cosθ)、v 的 (y,z) = (±0.6104, 0.4984)
//     ⇒ tanθ0 = 0.4984/0.6104 = 2/√6 = depthK ⇒ θ0 = atan(2/√6) ≈ 39.26°
//     ⇒ 可见弧段：θ ∈ [−90°, −θ0]（镜像到 +y 侧就是 _b 组）
//
//   ★ 人工裁定："拱洞分左右" —— 临界角逐朝向不同：
//       v0 / v3 看的是 −y 侧   ⇒ A 组用 soffit(+1)
//       v1 / v2 看的是 +y 侧   ⇒ B 组用 soffit(−1)
//     两者都整块落在**远侧**，所以直接进 tunnels: 组，不参与左右切分。
//   ★ 人工指出第二版仍然 "破碎"：在临界角附近，曲面**几乎是刀片边缘对着镜头**，
//     每段的投影宽度不到 1px，叠上 3× 抗锯齿就成了一条虚线毛边。
//     （实测 `--no-cull` 重渲染锯齿依旧 ⇒ 与背面剔除无关，是"太薄"。）
//   ⇒ 可见弧**提前一点收口**（ARC_CUT 余量），让收口那条边落在还有正常宽度的位置，
//     边缘就是一条干净直线；临界角到收口之间那点极薄的弧交给黑洞去接。
const TH0 = Math.atan(2 / Math.sqrt(6));   // ≈ 0.6853 rad = 39.26°
const ARC_CUT = 0.20;                      // 收口余量（rad，≈11.5°）

/**
 * 拱腹内表面（只出可见的那一段弧，且提前收口）
 * @param {1|-1} vis  +1 = 弧在 −y 侧（A 组，给 v0/v3 用）；−1 = 镜像到 +y 侧
 */
function soffit(vis) {
  const L = [];
  const NS = 48;                             // 可见弧段细分
  const a0 = -Math.PI / 2, a1 = -(TH0 + ARC_CUT);
  const at = (th, x) => {
    const y = ARCH_CY + Math.sin(th) * ARCH_R;
    return [x, vis > 0 ? y : 1 - y, ARCH_SPRING + Math.cos(th) * ARCH_R];
  };
  for (let i = 0; i < NS; i++) {
    const t0 = a0 + (a1 - a0) * i / NS;
    const t1 = a0 + (a1 - a0) * (i + 1) / NS;
    const tm = (t0 + t1) / 2;
    const my = ARCH_CY + Math.sin(tm) * ARCH_R;
    const mz = ARCH_SPRING + Math.cos(tm) * ARCH_R;
    // 法线：由拱腹指向拱心（朝隧道空腔）；vis<0 时 y 被镜像，y 分量翻号
    const n = [0, vis > 0 ? -(my - ARCH_CY) : (my - ARCH_CY), -(mz - ARCH_SPRING)];
    L.push(q4o([at(t0, SLAB_X1), at(t1, SLAB_X1), at(t1, SLAB_X0), at(t0, SLAB_X0)],
      n, 'stone_seam'));
  }
  return L;
}

// ---- 洞口暗幕（红）：贴在端墙后面的一张黑板 --------------------------------
//   人工裁定：**不画筒体**。列车进入洞口后应当被「洞门正面 + 仰面」完全挡住，
//   所以这里只需要一块从拱洞里透出来的暗面，让人看出"那是个洞"。
//   放在端墙厚度之内（x 略 > 0），因此**不越出 1×1 占地**。
function bore() {
  const x = BORE_X;                     // 黑板所在的 x
  return [
    q4o([[x, ARCH_Y0, 0], [x, ARCH_Y0, ARCH_CROWN + 0.006],
         [x, ARCH_Y1, ARCH_CROWN + 0.006], [x, ARCH_Y1, 0]],
      [1, 0, 0], 'trim_black'),
  ];
}

// ===========================================================================
// 洞门按 **z 切两半**（人工裁定：不是按"墙/地"切，是按"被车遮 / 遮车"切）
//
//   引擎绘制顺序：草地底 → tunnels: → 车 → 草地覆盖 → tunnel_overlay:
//   ⇒ 起拱线(0.19)**以下**连同护坡、拱腹、洞内，全部归 tunnels:（会被车压过）
//   ⇒ 起拱线**以上**的墙身 + 拱圈 + 压顶，归 tunnel_overlay:（专门遮车）
//   —— 这就是别的轨道包里"只有半边图像来遮盖车辆"的那半边。
// ===========================================================================

/** 地面层（红）：护坡 + 洞门下半。起拱线只有 0.018，所以"下半"几乎只剩护坡。 */
function portalLower() {
  const L = [];
  const FRONT = SLAB_X1;

  // 墙墩下半（起拱线以下，很薄的一条）
  if (ARCH_SPRING > 0.002) {
    L.push(...box(SLAB_X0, SLAB_Y0, FRONT, ARCH_Y0, 0, ARCH_SPRING, 'stone', 'stone_dark'));
    L.push(...box(SLAB_X0, ARCH_Y1, FRONT, SLAB_Y1, 0, ARCH_SPRING, 'stone', 'stone_dark'));
  }
  // 拱洞两侧的内壁（起拱线以下）
  if (ARCH_SPRING > 0.002) {
    L.push(q4o([[SLAB_X0, ARCH_Y0, ARCH_SPRING], [FRONT, ARCH_Y0, ARCH_SPRING],
                [FRONT, ARCH_Y0, 0], [SLAB_X0, ARCH_Y0, 0]], [0, 1, 0], 'stone_seam'));
    L.push(q4o([[SLAB_X0, ARCH_Y1, ARCH_SPRING], [SLAB_X0, ARCH_Y1, 0],
                [FRONT, ARCH_Y1, 0], [FRONT, ARCH_Y1, ARCH_SPRING]], [0, -1, 0], 'stone_seam'));
  }

  // ★ 斜坡（锥坡）+ 山体侧壁 ×2 —— 按人工手绘「图二」
  L.push(...wingWall(-1));
  L.push(...wingWall(+1));

  return L;
}

/** 遮车层（蓝 + 绿）：端墙正面（含拱洞）+ 拱圈 + 压顶 + 仰面 */
function portalUpper() {
  const L = [];
  const FRONT = SLAB_X1;
  const P = (x, y, z) => [x, y, z];

  // 墙墩正面（拱洞两侧），0 → **拱顶**（拱顶以上那截石梁另出，见 archBeam()）
  L.push(q4o([[FRONT, SLAB_Y0, ARCH_CROWN], [FRONT, SLAB_Y0, 0],
              [FRONT, ARCH_Y0, 0], [FRONT, ARCH_Y0, ARCH_CROWN]], [1, 0, 0], 'stone'));
  L.push(q4o([[FRONT, ARCH_Y1, ARCH_CROWN], [FRONT, ARCH_Y1, 0],
              [FRONT, SLAB_Y1, 0], [FRONT, SLAB_Y1, ARCH_CROWN]], [1, 0, 0], 'stone'));

  // 拱上腹墙：每个 y 条带的底边沿拱线 —— 这自然切出半圆拱洞，也是"遮车的半边"
  //   只画到拱顶；拱顶以上到板顶那一段是**石梁**，归 tunnel_overlay:（见 archBeam()）
  //
  //   ⚠⚠ 2026-10 人工报「拱洞外立面大量小三角形没渲染出来」的根因在这里：
  //     原来写的是
  //       z0 = archZ(Math.min(y0 + 1e-6, ARCH_CY))
  //       z1 = archZ(Math.max(y1 - 1e-6, ARCH_CY))
  //     而 archZ(ARCH_CY) 恰好 = ARCH_CROWN ⇒ **右半每条带的 z0、左半每条带的 z1
  //     都被钳到拱顶**，左边那条边整个塌成一个点。于是每条带只剩右边一根细长三角形，
  //     带与带之间全是洞 —— 上墙看起来就是一把梳子。
  //     archZ 在拱跨内处处有定义，**根本不用钳**；只在两端点（d 恰好 = R）取不到时
  //     回落到起拱线，那正是拱脚。
  const yOf = (i) => ARCH_Y0 + (ARCH_Y1 - ARCH_Y0) * i / NA;
  for (let i = 0; i < NA; i++) {
    const y0 = yOf(i), y1 = yOf(i + 1);
    const z0 = archZ(y0) ?? ARCH_SPRING;
    const z1 = archZ(y1) ?? ARCH_SPRING;
    L.push(q4o([[FRONT, y0, ARCH_CROWN], [FRONT, y1, ARCH_CROWN], [FRONT, y1, z1], [FRONT, y0, z0]],
      [1, 0, 0], 'stone'));
  }

  // 端墙两端面（只到拱顶）—— 朝墙外
  L.push(q4o([[SLAB_X0, SLAB_Y0, ARCH_CROWN], [FRONT, SLAB_Y0, ARCH_CROWN],
              [FRONT, SLAB_Y0, 0], [SLAB_X0, SLAB_Y0, 0]], [0, -1, 0], 'stone_dark'));
  L.push(q4o([[SLAB_X0, SLAB_Y1, ARCH_CROWN], [SLAB_X0, SLAB_Y1, 0],
              [FRONT, SLAB_Y1, 0], [FRONT, SLAB_Y1, ARCH_CROWN]], [0, 1, 0], 'stone_dark'));

  // （墙顶挪到 archBeam() —— 它在拱顶之上，属于石梁）

  return L;
}

// ---------------------------------------------------------------------------
// ★ 恒归 tunnel_overlay: 的整块几何（**不参与左右切分**）
//
//   压顶 + 仰面 + 两侧封边：它们要么在车之上、要么就是"山体"本身，
//   按 y 切左右没有意义（切了反而会在另一半露出破口）。
// ---------------------------------------------------------------------------
function upperAlways() {
  const L = [];
  const P = (x, y, z) => [x, y, z];

  // 压顶（出挑的一圈）
  L.push(...box(COPING_X0, COPING_Y0, COPING_X1, COPING_Y1, SLAB_TOP, COPING_TOP, 'stone_dark', 'stone'));

  // ★ 仰面（顶坡）：**梯形**（前沿石门宽 → 后沿满宽）+ **从洞口向山体斜降**
  //   ⚠ 人工裁定：**不做斜升**（斜升会把洞口压矮）—— 这里是**向山体降**，不是升。
  //   两条斜边贴住斜面（竖向翼墙）的走向，所以侧面不用再单独封。
  L.push(q4o([P(HILL_X1, HILL_Y0, hillZ(HILL_X1)), P(HILL_X0, SLAB_Y0, hillZ(HILL_X0)),
              P(HILL_X0, SLAB_Y1, hillZ(HILL_X0)), P(HILL_X1, HILL_Y1, hillZ(HILL_X1))],
             [0, 0, 1], 'dirt'));
  // ⚠ 人工裁定 2026-10：**不画正面、不画侧面、也不画后沿立面**。
  //   本层是画在车之上的 sortable sprite，立起来的面会挡住邻格的精灵；
  //   而且人工明确要求去掉 x=0 那条边上那块竖直立面（"顶坡的背面"）。
  //   ⇒ 仰面只留顶面这一块梯形板。
  return L;
}

// ---------------------------------------------------------------------------
// ★ 石梁：拱顶(ARCH_CROWN) → 板顶(SLAB_TOP) 这一段（人工裁定 2026-10）
//
//   **整块归 tunnel_overlay:，不参与左右切分。**
//   理由：它完全在车之上，不存在"被车遮"的情形，按 y 切左右没有意义。
//   为什么单独成一个函数：splitByY() 是按 y 切的，而石梁必须整块进 overlay，
//   所以在 generateTunnel() 里直接追加到 overlay 那一侧，不经过 splitByY。
// ---------------------------------------------------------------------------
function archBeam() {
  const L = [];
  const FRONT = SLAB_X1;
  // 两端墙墩的正面（拱顶以上那段）
  L.push(q4o([[FRONT, SLAB_Y0, SLAB_TOP], [FRONT, SLAB_Y0, ARCH_CROWN],
              [FRONT, ARCH_Y0, ARCH_CROWN], [FRONT, ARCH_Y0, SLAB_TOP]], [1, 0, 0], 'stone'));
  L.push(q4o([[FRONT, ARCH_Y1, SLAB_TOP], [FRONT, ARCH_Y1, ARCH_CROWN],
              [FRONT, SLAB_Y1, ARCH_CROWN], [FRONT, SLAB_Y1, SLAB_TOP]], [1, 0, 0], 'stone'));
  // 拱顶正上方那一段
  L.push(q4o([[FRONT, ARCH_Y0, SLAB_TOP], [FRONT, ARCH_Y1, SLAB_TOP],
              [FRONT, ARCH_Y1, ARCH_CROWN], [FRONT, ARCH_Y0, ARCH_CROWN]], [1, 0, 0], 'stone'));
  // 两端面（拱顶以上）
  L.push(q4o([[SLAB_X0, SLAB_Y0, SLAB_TOP], [FRONT, SLAB_Y0, SLAB_TOP],
              [FRONT, SLAB_Y0, ARCH_CROWN], [SLAB_X0, SLAB_Y0, ARCH_CROWN]], [0, -1, 0], 'stone_dark'));
  L.push(q4o([[SLAB_X0, SLAB_Y1, SLAB_TOP], [SLAB_X0, SLAB_Y1, ARCH_CROWN],
              [FRONT, SLAB_Y1, ARCH_CROWN], [FRONT, SLAB_Y1, SLAB_TOP]], [0, 1, 0], 'stone_dark'));
  // ★ 背面 x=SLAB_X0（人工指出"石梁的反面没渲染" —— 原来漏了这一面）
  L.push(q4o([[SLAB_X0, SLAB_Y0, SLAB_TOP], [SLAB_X0, SLAB_Y0, ARCH_CROWN],
              [SLAB_X0, SLAB_Y1, ARCH_CROWN], [SLAB_X0, SLAB_Y1, SLAB_TOP]], [-1, 0, 0], 'stone_dark'));
  // 梁顶（被压顶盖住，补上防露缝）
  L.push(q4o([[SLAB_X0, SLAB_Y0, SLAB_TOP], [SLAB_X0, SLAB_Y1, SLAB_TOP],
              [FRONT, SLAB_Y1, SLAB_TOP], [FRONT, SLAB_Y0, SLAB_TOP]], [0, 0, 1], 'stone_dark'));
  return L;
}

// ---------------------------------------------------------------------------
// ★ 左右切分（人工裁定）：按**相机深度**把整块洞门（含护坡）劈成两半
//
//   flatiso 的深度 = x + y，越大越靠近镜头。
//   洞门是绕轨道中线 y=0.5 的一个"拱环"，所以：
//     y ≥ 0.5 的那半（离镜头近）—— 挡在车前面 ⇒ tunnel_overlay:（遮车）
//     y <  0.5 的那半（离镜头远）—— 车进来后在它前面 ⇒ tunnels:（被车遮）
//
//   ⇒ 不再按"板正面/板背面"切，而是**按 y 切**。这样拱环和两片护坡
//     会自然分成左右两半，各自进对的那一层。
// ---------------------------------------------------------------------------

/** 把一串 quad 行按顶点平均 y 分成「远半 / 近半」 */
function splitByY(lines) {
  const lo = [], hi = [];
  for (const l of lines) {
    if (!l.startsWith('quad')) { lo.push(l); continue; }
    const n = l.slice(4).trim().split(/\s+/);
    const ys = [1, 4, 7, 10].map((i) => Number(n[i]));
    const yAvg = ys.reduce((a, b) => a + b, 0) / ys.length;
    (yAvg >= ARCH_CY ? hi : lo).push(l);
  }
  return { lo, hi };
}

// ---------------------------------------------------------------------------
function header(name, title, extra) {
  return '# =============================================================================\n'
    + '# ' + name + ' —— ' + title + '\n#\n'
    + '# 【本文件由 tools/gen-g1-tunnel.mjs 生成，请勿手改】\n#\n'
    + extra
    + '# =============================================================================\n\n';
}

const WHY = '# TUN-1 料石端墙拱（八字翼墙 + 锥坡）\n'
  + '# 基准朝向 = DiagDir NE：洞口在 x=0 那条边（N–E），轨道沿 x\n'
  + '# 取图顺序 v0=NE  v1=NW  v2=SW  v3=SE\n'
  + '#   ⚠ 引擎槽位顺序是 NE/SE/SW/NW ⇒ 喂图是 v0, v3, v2, v1\n'
  + '#\n'
  + '# 【为什么是四个模型】（人工裁定：总共四个模型就够了）\n'
  + '#   引擎绘制顺序：草地底 → tunnels: → 车 → 草地覆盖 → tunnel_overlay:\n'
  + '#   tunnel_overlay: 是**整张 sortable sprite**，它要么整体在车之前、要么整体在车之后。\n'
  + '#   所以 overlay 里**只能放"离镜头近"的那半边**，远的那半必须留给 tunnels:。\n'
  + '#\n'
  + '#   而"哪半边离镜头近"是**逐朝向变化**的（绕占地中心转模型 ⇒ 近半也随之转）：\n'
  + '#     v0 近半 = y ≥ 0.5      v3 近半 = y ≥ 0.5\n'
  + '#     v1 近半 = y <  0.5     v2 近半 = y <  0.5\n'
  + '#   一个 .model 只能写死一种分组 ⇒ 需要**两套分组**：\n'
  + '#     A 组（_v0/_v3 用）：tunnels:=远半  tunnel_overlay:=近半\n'
  + '#     B 组（_v1/_v2 用）：tunnels:=近半  tunnel_overlay:=远半\n'
  + '#   两层 × 两套分组 = **4 个模型**。\n'
  + '#\n';

export function generateTunnel() {
  const ball = ballast(20261001);
  const sleep = sleepers();
  const rail = rails();
  const br = bore();                       // 暗幕：强制归"被车遮"层
  // ★ 拱腹内壁：只出可见弧段，A 组 −y 侧 / B 组 +y 侧（人工裁定"拱洞分左右"）
  const innerA = soffit(+1);
  const innerB = soffit(-1);
  // 需要按"离镜头远近"切左右两半的全部几何（洞门 + 侧壁 + 斜坡）
  const { lo: halfFar, hi: halfNear } = splitByY([...portalLower(), ...portalUpper()]);
  const always = upperAlways();            // 压顶 + 仰面 + 山体侧壁（整块，不切左右）
  const beam = archBeam();                 // ★ 石梁：整块归 overlay，不经过 splitByY

  const track = [...ball, ...sleep, ...rail, ...br];
  // A 组（给 v0/v3）：拱腹可见弧在 −y 侧；B 组（给 v1/v2）：镜像到 +y 侧
  const groundA = [...track, ...innerA];
  const groundB = [...track, ...innerB];

  const out = [];

  // ---- A 组：v0 / v3 用 ----------------------------------------------------
  {
    let s = header('G1_tunnel_stone', 'G1 几何组：TUN-1 料石端墙拱 —— tunnels: 组（A 组：远半）', WHY);
    s += 'name      G1_tunnel_stone\ngroup     misc\nfootprint 1 1\n';
    s += 'zmax      ' + ZMAX_PIN + '\n\n';
    s += '# --- 道砟 / 轨枕 / 钢轨 / 洞口暗幕 / **拱腹内壁（−y 侧可见弧）** ---\n' + groundA.join('\n') + '\n';
    s += '\n# --- 洞门 + 锥坡 + 山体侧壁：**远半**（y < ' + N(ARCH_CY) + '）---\n'
       + halfFar.join('\n') + '\n';
    out.push(['G1_tunnel_stone', s, groundA.length + halfFar.length]);
  }
  {
    let s = header('G1_tunnel_stone_over', 'G1 几何组：TUN-1 料石端墙拱 —— tunnel_overlay: 组（A 组：近半）', WHY
      + '# ⚠ 本层由引擎当 sortable sprite 画在**车之上**，所以只放"需要遮车"的部分。\n'
      + '#   仰面/压顶/石梁必须在本层 —— 原版那个草山包也画在这一层。\n#\n');
    s += 'name      G1_tunnel_stone_over\ngroup     misc\nfootprint 1 1\n';
    s += 'zmax      ' + ZMAX_PIN + '\n\n';
    s += '# --- 洞门 + 锥坡 + 山体侧壁：**近半**（y ≥ ' + N(ARCH_CY) + '）---\n'
       + halfNear.join('\n') + '\n';
    s += '\n# --- 压顶 + 仰面 + 山体侧壁（整块）---\n' + always.join('\n') + '\n';
    s += '\n# --- ★ 石梁（拱顶→板顶）：整块，不切左右 ---\n' + beam.join('\n') + '\n';
    out.push(['G1_tunnel_stone_over', s, halfNear.length + always.length + beam.length]);
  }

  // ---- B 组：v1 / v2 用（左右切分翻转）------------------------------------
  {
    let s = header('G1_tunnel_stone_b', 'G1 几何组：TUN-1 料石端墙拱 —— tunnels: 组（B 组：近半）', WHY);
    s += 'name      G1_tunnel_stone_b\ngroup     misc\nfootprint 1 1\n';
    s += 'zmax      ' + ZMAX_PIN + '\n\n';
    s += '# --- 道砟 / 轨枕 / 钢轨 / 洞口暗幕 / **拱腹内壁（+y 侧可见弧）** ---\n' + groundB.join('\n') + '\n';
    s += '\n# --- 洞门 + 锥坡 + 山体侧壁：**近半**（y ≥ ' + N(ARCH_CY) + '）---\n'
       + halfNear.join('\n') + '\n';
    out.push(['G1_tunnel_stone_b', s, groundB.length + halfNear.length]);
  }
  {
    let s = header('G1_tunnel_stone_over_b', 'G1 几何组：TUN-1 料石端墙拱 —— tunnel_overlay: 组（B 组：远半）', WHY
      + '# ⚠ 本层由引擎当 sortable sprite 画在**车之上**，所以只放"需要遮车"的部分。\n'
      + '#   仰面/压顶/石梁必须在本层 —— 原版那个草山包也画在这一层。\n#\n');
    s += 'name      G1_tunnel_stone_over_b\ngroup     misc\nfootprint 1 1\n';
    s += 'zmax      ' + ZMAX_PIN + '\n\n';
    s += '# --- 洞门 + 锥坡 + 山体侧壁：**远半**（y < ' + N(ARCH_CY) + '）---\n'
       + halfFar.join('\n') + '\n';
    s += '\n# --- 压顶 + 仰面 + 山体侧壁（整块）---\n' + always.join('\n') + '\n';
    s += '\n# --- ★ 石梁（拱顶→板顶）：整块，不切左右 ---\n' + beam.join('\n') + '\n';
    out.push(['G1_tunnel_stone_over_b', s, halfFar.length + always.length + beam.length]);
  }

  for (const [name, text, nf] of out) {
    const f = path.join(ROOT, 'models', name + '.model');
    fs.writeFileSync(f, text, 'utf8');
    log(`  ✔ ${rel(f).padEnd(44)} ${String(text.split('\n').length).padStart(4)} 行   ${nf} 面`);
  }

  // -------------------------------------------------------------------------
  // ★ TUN-2 —— 素混凝土端墙拱
  //
  //   人工裁定（美术要素方案.md §3.2）：P2-G1 覆盖 `SADN` `SBDN` `SBEd` `SBDD`，
  //   四种**共用道床/轨枕/钢轨**（BAL-C / SLE-1 / RAI-1），**只换隧道口**：
  //     `SADN` → `TUN-1`（料石端墙拱）    其余三种 → `TUN-2`（素混凝土端墙拱）
  //   美术定位（§1.4）："灰色素混凝土端墙 + 拱圈"，民国～新中国早期。
  //
  //   ⇒ 与 TUN-1 的差别**只是材质**（料石 → 素混凝土：去缝、换灰），几何一字不改。
  //     所以这里**不重写一套几何**，而是把上面刚生成的文本做一次「材质替换 + 改名」。
  //     好处：两边永远同步，不会各改各的漂移；改几何只改一处。
  //
  //   配色（人工 2026-10：「SBDN 隧道深点、灰点」）：
  //     stone      → concrete_dark      144,140,132   主色（原 concrete 186,182,173 偏亮偏暖）
  //     stone_dark → panel_seam          96,  96,  96   暗面（原 concrete_dark 144,140,132）
  //     stone_seam → metal_seam         122,127,132   内壁（原 concrete_seam 152,149,141）
  //   整体比原来深一档，而且 R≈G≈B（去掉了暖调，所以"更灰"）。要再调就改这三行。
  //
  //   模型名 `G1_tunnel2_*`，**单独一张表**（tools/sheets.mjs 的 `tunnel2`，
  //   登记在 `tunnel` **之前** —— 后者的正则是 /^G1_tunnel/，会先把 tunnel2 吃掉；
  //   而单独一张表才不会把 TUN-1 那 20 张精灵的格位顶移位）。
  // -------------------------------------------------------------------------
  {
    for (const [name, text, nf] of out) {
      // 四个名字都以 G1_tunnel_stone 开头 ⇒ 一次替换就够
      const t = text.split('G1_tunnel_stone').join('G1_tunnel2_stone')
        .replace(/\bstone_seam\b/g, 'metal_seam')
        .replace(/\bstone_dark\b/g, 'panel_seam')
        .replace(/\bstone\b/g, 'concrete_dark')
        .replace(/TUN-1 料石端墙拱/g, 'TUN-2 素混凝土端墙拱')
        .replace(/TUN-2 素混凝土端墙拱\n/,
                 'TUN-2 素混凝土端墙拱\n'
               + '# 【与 TUN-1 的关系】**几何完全一致，只换材质**（料石 → 素混凝土）。\n'
               + '#   本文件由 tools/gen-g1-tunnel.mjs 从 TUN-1 的文本替换而来。\n'
               + '#   要改几何 → 改 TUN-1 那一套（本文件跟着变）；要改配色 → 改下面的材质名。\n');
      const nn = name.replace('G1_tunnel_stone', 'G1_tunnel2_stone');
      const f = path.join(ROOT, 'models', nn + '.model');
      fs.writeFileSync(f, t, 'utf8');
      log(`  ✔ ${rel(f).padEnd(44)} ${String(t.split('\n').length).padStart(4)} 行   ${nf} 面   （TUN-2 素混凝土）`);
    }
  }
  log('');
  log('  洞口   端墙 x∈[' + N(SLAB_X0) + ',' + N(SLAB_X1) + ']  y∈[' + N(SLAB_Y0) + ',' + N(SLAB_Y1) + ']  高 ' + N(SLAB_TOP));
  log('  拱     半宽 ' + N(ARCH_R) + '  起拱 z=' + N(ARCH_SPRING) + '  拱顶 z=' + N(ARCH_CROWN) + '  内壁 ' + NA + ' 段');
  log('  边坡   护坡已删除、斜坡已删除；只剩侧面（竖向三角）+ 山体侧壁 ×2');
  log('  切分   overlay 只放"离镜头近"的半边；v1/v2 用 _b 组（切分翻转）');
  log('');
  log('  下一步：make render → make sprites（核对锚点）→ make check');
  return out;
}

if (isMain(import.meta.url)) {
  log('生成 G1 隧道（TUN-1 料石端墙拱）：');
  const made = generateTunnel();

  // ---- 【临时诊断】把两层合进一个模型，单独渲染，看引擎实际的叠加效果 ----
  //   只在本文件被 --diag 调用时生成；**看完请删掉 models/G1_tunnel_diag*.model**
  //   （它们匹配 /^G1_tunnel/，会影响正式的隧道分表）
  if (process.argv.includes('--diag')) {
    const boreColor = (process.argv.find((a) => a.startsWith('--bore-color=')) || '').split('=')[1] || 'trim_black';
    const bodyOf = (t) => t.split('\n')
      .filter((l) => /^(quad|plate|box|tri|poly|prism|cyl|gable|hip|shed)\s/.test(l.trim()))
      .join('\n');
    const pairs = [['G1_tunnel_diag', made[0][1], made[1][1]],
                   ['G1_tunnel_diag_b', made[2][1], made[3][1]]];
    for (const [name, under, over] of pairs) {
      const s = header(name, 'TEMP 诊断：tunnels + tunnel_overlay 两层合一', WHY)
        + 'name      ' + name + '\ngroup     misc\nfootprint 1 1\nzmax      ' + ZMAX_PIN + '\n\n'
        + bodyOf(under).replace(/trim_black/g, boreColor)
        + '\n' + bodyOf(over) + '\n';
      const f = path.join(ROOT, 'models', name + '.model');
      fs.writeFileSync(f, s, 'utf8');
      log(`  ⚠ 临时诊断模型 ${rel(f)}（看完请删）`);
    }
  }
}
