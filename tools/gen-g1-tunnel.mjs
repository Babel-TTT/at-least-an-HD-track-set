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
const SLAB_TOP = LEV * 0.9800;       // 板顶 0.2000 —— 抬高，几乎顶到仰面

const ARCH_CY = 0.5000;              // 拱心（y）—— **也是左右切分线**
const ARCH_R = 0.1550;               // 拱半径 = 洞宽的一半（0.31 格 = 4.3 m）
const ARCH_SPRING = SLAB_TOP - ARCH_R;   // 起拱线 = 0.0200
const ARCH_CROWN = SLAB_TOP;         // 拱顶（半圆拱）
const ARCH_Y0 = ARCH_CY - ARCH_R;    // 0.365
const ARCH_Y1 = ARCH_CY + ARCH_R;    // 0.635
const NA = 48;                       // 拱线细分

// ---- 仰面（绿）：**水平**的山顶面（人工裁定：不做斜升，斜升会把洞口压矮）---
//   高度 = 一层地形；**末端完全填满瓦片边缘**（y 0→1）。
//   ⚠ 必须归 tunnel_overlay: 层 —— 原版那个草山包画在这一层，
//     放进 tunnels:（更早画）会被它盖住。
const HILL_X0 = SLAB_X0;             // 0.68（前沿）
const HILL_X1 = 0.0000;              // 0（瓦片后沿，填满整条边）
const HILL_Z1 = LEV;                 // 0.2041（水平顶面）
const HILL_Y0 = 0.0000;              // ★ 填满瓦片边缘
const HILL_Y1 = 1.0000;

// ---- 压顶：板顶出挑的一圈 ---------------------------------------------------
const COPING_X0 = SLAB_X0 - 0.0120;
const COPING_X1 = SLAB_X1 + 0.0120;
const COPING_Y0 = SLAB_Y0 - 0.0180;
const COPING_Y1 = SLAB_Y1 + 0.0180;
const COPING_TOP = SLAB_TOP + 0.0140;

// ---- 洞口暗幕：贴在板背面之后的一块黑板，堵住拱洞 --------------------------
const BORE_X = SLAB_X0 - 0.0100;     // 0.67（板后 0.01）

// ---- 八字锥坡护坡（人工裁定 B）：只剩 0.2 格，做**急坡** --------------------
const WING_X0 = SLAB_X1;             // 0.80（起于板正面）
const WING_X1 = 0.9800;              // 0.98（0.18 格内降完 —— 急坡）
const WING_Z0 = SLAB_TOP * 0.8500;   // 0.1318（低于板顶，让板露出来）
const WING_Z1 = 0.0200;              // 收到地面
const WING_YI = 0.3150;              // 内侧边（贴道砟肩 0.32）
const WING_YO0 = SLAB_Y0;            // 靠板端的外侧边
const WING_YO1 = 0.0300;             // 远端外张到 0.03（八字张开）

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

/** 交叉积（用前三个顶点） */
function faceNormal(pts) {
  const [a, b, c] = pts;
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
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

// ---- 八字锥坡护坡（人工裁定 B）--------------------------------------------
/**
 * 一片护坡：靠墙端窄、远端八字外张，顶面沿 +x 斜降到地面。
 * 四角在平面上的关系（左翼）：
 *   靠墙 x=WING_X0：外侧 y=WING_YO0 … 内侧 y=WING_YI
 *   远端 x=WING_X1：外侧 y=WING_YO1（更外）… 内侧 y=WING_YI
 * @param {1|-1} sgn  +1 = 右翼（y 大的一侧，镜像到 0.86~0.98），−1 = 左翼
 */
function wing(sgn) {
  const Y = (v) => (sgn > 0 ? 1 - v : v);         // 右翼镜像
  const yi = Y(WING_YI), yo0 = Y(WING_YO0), yo1 = Y(WING_YO1);
  const ny = sgn > 0 ? 1 : -1;                     // 外侧朝外的方向
  const P = (x, y, z) => [x, y, z];
  const dx = WING_X1 - WING_X0, dz = WING_Z0 - WING_Z1;
  const dy = yo1 - yo0;
  // 外侧斜面的法线：垂直于平面走向 (dx, dy)，指向外侧
  const oLen = Math.hypot(dx, dy) || 1;
  const nOut = [-dy / oLen * ny, dx / oLen * ny, 0];
  return [
    // 顶面（斜面）——法线朝上偏 −x
    q4o([P(WING_X0, yo0, WING_Z0), P(WING_X1, yo1, WING_Z1),
         P(WING_X1, yi, WING_Z1), P(WING_X0, yi, WING_Z0)],
      [-dz, 0, dx], 'stone'),
    // 远端面 x=WING_X1
    q4o([P(WING_X1, yo1, 0), P(WING_X1, yo1, WING_Z1),
         P(WING_X1, yi, WING_Z1), P(WING_X1, yi, 0)], [1, 0, 0], 'stone_dark'),
    // 外侧斜面（八字张开的那一面）
    q4o([P(WING_X0, yo0, 0), P(WING_X1, yo1, 0),
         P(WING_X1, yo1, WING_Z1), P(WING_X0, yo0, WING_Z0)], nOut, 'stone_dark'),
    // 内侧面（贴轨道一侧）
    q4o([P(WING_X0, yi, 0), P(WING_X0, yi, WING_Z0),
         P(WING_X1, yi, WING_Z1), P(WING_X1, yi, 0)], [0, -ny, 0], 'stone_seam'),
  ];
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

  // 八字锥坡护坡 ×2
  L.push(...wing(-1));
  L.push(...wing(+1));

  return L;
}

/** 遮车层（蓝 + 绿）：端墙正面（含拱洞）+ 拱圈 + 压顶 + 仰面 */
function portalUpper() {
  const L = [];
  const FRONT = SLAB_X1;
  const P = (x, y, z) => [x, y, z];

  // 墙墩正面（拱洞两侧），0 → 墙顶
  L.push(q4o([[FRONT, SLAB_Y0, SLAB_TOP], [FRONT, SLAB_Y0, 0],
              [FRONT, ARCH_Y0, 0], [FRONT, ARCH_Y0, SLAB_TOP]], [1, 0, 0], 'stone'));
  L.push(q4o([[FRONT, ARCH_Y1, SLAB_TOP], [FRONT, ARCH_Y1, 0],
              [FRONT, SLAB_Y1, 0], [FRONT, SLAB_Y1, SLAB_TOP]], [1, 0, 0], 'stone'));

  // 拱上腹墙：每个 y 条带的底边沿拱线 —— 这自然切出半圆拱洞，也是"遮车的半边"
  const yOf = (i) => ARCH_Y0 + (ARCH_Y1 - ARCH_Y0) * i / NA;
  for (let i = 0; i < NA; i++) {
    const y0 = yOf(i), y1 = yOf(i + 1);
    const z0 = archZ(Math.min(y0 + 1e-6, ARCH_CY)) ?? ARCH_SPRING;
    const z1 = archZ(Math.max(y1 - 1e-6, ARCH_CY)) ?? ARCH_SPRING;
    L.push(q4o([[FRONT, y0, SLAB_TOP], [FRONT, y1, SLAB_TOP], [FRONT, y1, z1], [FRONT, y0, z0]],
      [1, 0, 0], 'stone'));
  }

  // 端墙两端面 —— 朝墙外
  L.push(q4o([[SLAB_X0, SLAB_Y0, SLAB_TOP], [FRONT, SLAB_Y0, SLAB_TOP],
              [FRONT, SLAB_Y0, 0], [SLAB_X0, SLAB_Y0, 0]], [0, -1, 0], 'stone_dark'));
  L.push(q4o([[SLAB_X0, SLAB_Y1, SLAB_TOP], [SLAB_X0, SLAB_Y1, 0],
              [FRONT, SLAB_Y1, 0], [FRONT, SLAB_Y1, SLAB_TOP]], [0, 1, 0], 'stone_dark'));

  // 墙顶（被压顶盖住，补上防露缝）
  L.push(q4o([[SLAB_X0, SLAB_Y0, SLAB_TOP], [SLAB_X0, SLAB_Y1, SLAB_TOP],
              [FRONT, SLAB_Y1, SLAB_TOP], [FRONT, SLAB_Y0, SLAB_TOP]], [0, 0, 1], 'stone_dark'));

  // 压顶（出挑的一圈）
  L.push(...box(COPING_X0, COPING_Y0, COPING_X1, COPING_Y1, SLAB_TOP, COPING_TOP, 'stone_dark', 'stone'));

  // ★ 仰面（绿）：**水平山顶面**（人工裁定：不做斜升 —— 斜升会把洞口压矮）
  const HZ = HILL_Z1;
  // 顶面（水平）
  L.push(q4o([P(HILL_X1, HILL_Y0, HZ), P(HILL_X0, HILL_Y0, HZ),
              P(HILL_X0, HILL_Y1, HZ), P(HILL_X1, HILL_Y1, HZ)], [0, 0, 1], 'dirt'));
  // ⚠ 人工裁定：**不画正面和两个侧面** —— 本层是画在车之上的 sortable sprite，
  //   立起来的面会挡住邻格的精灵。只留顶面 + 后沿立面。
  // 后沿立面（瓦片后沿，**填满整条边**）
  L.push(q4o([P(HILL_X1, HILL_Y0, 0), P(HILL_X1, HILL_Y1, 0),
              P(HILL_X1, HILL_Y1, HZ), P(HILL_X1, HILL_Y0, HZ)], [-1, 0, 0], 'dirt'));

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

const WHY = '# TUN-1 料石端墙拱（人工裁定 B：八字锥坡护坡）\n'
  + '# 基准朝向 = DiagDir NE：洞口在 x=0 那条边（N–E），轨道沿 x\n'
  + '# 取图顺序 v0=NE  v1=NW  v2=SW  v3=SE\n'
  + '#   ⚠ 引擎槽位顺序是 NE/SE/SW/NW ⇒ 喂图是 v0, v3, v2, v1\n'
  + '# 尺寸：端墙 y∈[0.14,0.86] 高 0.52；拱半宽 0.17、起拱 0.19、拱顶 0.36\n'
  + '# 护坡：八字锥坡，靠墙 y∈[0.14,0.31] → 远端 y∈[0.02,0.31]，顶 0.40 斜降到 0.04\n'
  + '#\n'
  + '# 【按 z 切两半】不是按"墙/地"切，是按"被车遮 / 遮车"切：\n'
  + '#   起拱线(0.19)以下 + 护坡 + 拱腹 + 洞内 ⇒ tunnels: 组\n'
  + '#   起拱线以上墙身 + 拱圈 + 压顶       ⇒ tunnel_overlay: 组（遮车的那半边）\n'
  + '# 引擎绘制顺序：草地底 → tunnels: → 车 → 草地覆盖 → tunnel_overlay:\n'
  + '#\n';

export function generateTunnel() {
  const ball = ballast(20261001);
  const sleep = sleepers();
  const rail = rails();
  const br = bore();                       // 暗幕：强制归"被车遮"层
  const { lo: wallFar, hi: wallNear } = splitByY([...portalLower(), ...portalUpper()]);

  const out = [];

  // tunnels: 组（红 = 被车遮）—— 道砟 + 轨枕 + 钢轨 + 暗幕 + 洞门/护坡的**远半**
  {
    let s = header('G1_tunnel_stone', 'G1 几何组：TUN-1 料石端墙拱 —— tunnels: 组（地面层，被车遮的那半）', WHY);
    s += 'name      G1_tunnel_stone\ngroup     misc\nfootprint 1 1\n';
    // ★ 钉死 zmax：flatiso 拿它定取景框（core/bake.mjs:52-54 会加一个虚拟最高点），
    //   钉住之后**改几何不会改格位**，src/rails/templates.pnml 的 rect 再也不用同步。
    s += 'zmax      ' + ZMAX_PIN + '\n\n';
    s += '# --- 道砟 ---\n' + ball.join('\n') + '\n';
    s += '\n# --- 轨枕（保持原间距，只是板后面那几根不画）---\n' + sleep.join('\n') + '\n';
    s += '\n# --- 钢轨 2 根 ---\n' + rail.join('\n') + '\n';
    s += '\n# --- 洞口暗幕 ---\n' + br.join('\n') + '\n';
    s += '\n# --- 洞门 + 护坡：远半（y < ' + N(ARCH_CY) + '）---\n' + wallFar.join('\n') + '\n';
    out.push(['G1_tunnel_stone', s,
      ball.length + sleep.length + rail.length + br.length + wallFar.length]);
  }

  // tunnel_overlay: 组（蓝 = 遮车）—— 洞门 + 护坡的**近半** + 仰面
  {
    let s = header('G1_tunnel_stone_over', 'G1 几何组：TUN-1 料石端墙拱 —— tunnel_overlay: 组（遮车的那半 + 仰面）', WHY
      + '# ⚠ 本层由引擎当 sortable sprite 画在**车之上**，所以只放"需要遮车"的部分：\n'
      + '#   拱环与护坡中**离镜头近**的那半（y ≥ ' + N(ARCH_CY) + '），外加**仰面**。\n'
      + '#   仰面必须在本层 —— 原版那个草山包也画在这一层，放低层会被它盖住。\n#\n');
    s += 'name      G1_tunnel_stone_over\ngroup     misc\nfootprint 1 1\n';
    s += 'zmax      ' + ZMAX_PIN + '\n\n';
    s += '# --- 洞门 + 护坡：近半 + 仰面（y ≥ ' + N(ARCH_CY) + '）---\n' + wallNear.join('\n') + '\n';
    out.push(['G1_tunnel_stone_over', s, wallNear.length]);
  }

  for (const [name, text, nf] of out) {
    const f = path.join(ROOT, 'models', name + '.model');
    fs.writeFileSync(f, text, 'utf8');
    log(`  ✔ ${rel(f).padEnd(40)} ${String(text.split('\n').length).padStart(4)} 行   ${nf} 面`);
  }
  log('');
  log('  洞口   端墙 x∈[' + N(SLAB_X0) + ',' + N(SLAB_X1) + ']  y∈[' + N(SLAB_Y0) + ',' + N(SLAB_Y1) + ']  高 ' + N(SLAB_TOP));
  log('  拱     半宽 ' + N(ARCH_R) + '  起拱 z=' + N(ARCH_SPRING) + '  拱顶 z=' + N(ARCH_CROWN));
  log('  护坡   八字锥坡 x∈[' + N(WING_X0) + ',' + N(WING_X1) + ']  外侧 ' + N(WING_YO0) + '→' + N(WING_YO1) + '  顶 ' + N(WING_Z0) + '→' + N(WING_Z1));
  log('  切分   起拱线 z=' + N(ARCH_SPRING) + ' 以下入 tunnels: 组，以上入 tunnel_overlay: 组');
  log('');
  log('  下一步：make render → make sprites（核对锚点）→ make check');
  return out;
}

if (isMain(import.meta.url)) {
  log('生成 G1 隧道（TUN-1 料石端墙拱）：');
  generateTunnel();
}
