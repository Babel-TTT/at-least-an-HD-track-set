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

// ---- 洞口（端墙 + 拱）-------------------------------------------------------
const WALL_X0 = 0.0000;              // 端墙背面（朝洞里）
const WALL_X1 = 0.0900;              // 端墙正面（朝来车方向）—— 可见面
const WALL_Y0 = 0.1400;              // 端墙左边界
const WALL_Y1 = 0.8600;              // 端墙右边界
const WALL_TOP = 0.5200;             // 墙顶

const ARCH_CY = 0.5000;              // 拱心（y）
const ARCH_R = 0.1700;               // 拱半径：半宽 = 起拱线到拱顶的高
const ARCH_SPRING = 0.1900;          // 起拱线 z
const ARCH_CROWN = ARCH_SPRING + ARCH_R;   // 拱顶 z = 0.36
const ARCH_Y0 = ARCH_CY - ARCH_R;    // 0.33
const ARCH_Y1 = ARCH_CY + ARCH_R;    // 0.67
const NA = 48;                       // 拱线细分

const COPING_X0 = -0.0140;           // 压顶：比墙身四周各出挑一点
const COPING_X1 = WALL_X1 + 0.0140;
const COPING_Y0 = WALL_Y0 - 0.0220;
const COPING_Y1 = WALL_Y1 + 0.0220;
const COPING_TOP = WALL_TOP + 0.0460;

const BORE_X0 = 0.0300;              // 洞口暗腔（一块黑板，堵住拱洞）
const BORE_X1 = 0.0400;
const BORE_TOP = ARCH_CROWN + 0.0150;

/** 拱线：给定 y 返回拱腹的 z；超出拱跨返回 null（= 落到地面） */
function archZ(y) {
  const d = Math.abs(y - ARCH_CY);
  if (d >= ARCH_R) return null;
  return ARCH_SPRING + Math.sqrt(ARCH_R * ARCH_R - d * d);
}

// ---------------------------------------------------------------------------
// 图元。顶点绕序**照抄 tools/gen-g1-slope.mjs 的 slab()**（那套渲染出来是对的，
// 不要自己另推一套绕序）。
// ---------------------------------------------------------------------------

/** 轴对齐长方体（顶面 + 4 侧面，不做底面） */
function box(x0, y0, x1, y1, zb, zt, side, top = null) {
  const L = [];
  L.push('quad ' + N(x1) + ' ' + N(y0) + ' ' + N(zt) +
         '  ' + N(x1) + ' ' + N(y1) + ' ' + N(zt) +
         '  ' + N(x0) + ' ' + N(y1) + ' ' + N(zt) +
         '  ' + N(x0) + ' ' + N(y0) + ' ' + N(zt) +
         '   ' + (top ?? side));
  const side4 = [
    [[x1, y0, zt], [x1, y1, zt], [x1, y1, zb], [x1, y0, zb]],   // x = x1
    [[x0, y0, zt], [x0, y0, zb], [x0, y1, zb], [x0, y1, zt]],   // x = x0
    [[x0, y0, zt], [x1, y0, zt], [x1, y0, zb], [x0, y0, zb]],   // y = y0
    [[x0, y1, zt], [x0, y1, zb], [x1, y1, zb], [x1, y1, zt]],   // y = y1
  ];
  for (const f of side4) {
    L.push('quad ' + f.map(([x, y, z]) => N(x) + ' ' + N(y) + ' ' + N(z)).join('  ') + '   ' + side);
  }
  return L;
}

/** 单个 quad（4 个 [x,y,z]） */
function q4(pts, mat) {
  return 'quad ' + pts.map(([x, y, z]) => N(x) + ' ' + N(y) + ' ' + N(z)).join('  ') + '   ' + mat;
}

// ---- 道砟（平铺，与坡道那版同风格）----------------------------------------
function ballast(seed) {
  const rnd = (() => { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const wav = [];
  for (let i = 0; i <= CN; i++) wav.push([(rnd() - 0.5) * 2 * 0.012, (rnd() - 0.5) * 2 * 0.012]);
  const yb = (r, i) => (r === 0 ? B0 + wav[i][0] : r === RN ? B1 + wav[i][1] : B0 + (B1 - B0) * r / RN);
  const hz = (r, i) => 0.0005 + 0.005 * (0.5 + 0.5 * Math.sin(i * 1.7 + r * 2.3)) + 0.0006 * ((i * 7 + r * 13) % 5) / 4;
  const L = [];
  const X = (i) => i / CN;
  for (let r = 0; r < RN; r++) for (let i = 0; i < CN; i++) {
    const x0 = X(i), x1 = X(i + 1), y0 = yb(r, i), y1 = yb(r + 1, i);
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

// ---- 洞口暗腔（地面层的黑）------------------------------------------------
function bore() {
  return box(BORE_X0, ARCH_Y0 + 0.006, BORE_X1, ARCH_Y1 - 0.006, 0, BORE_TOP, 'trim_black', 'trim_black');
}

// ---- 端墙（含拱洞）+ 压顶 --------------------------------------------------
function portal() {
  const L = [];
  const FRONT = WALL_X1;

  // 左右两个墙墩（整高，不含拱洞）
  L.push(...box(WALL_X0, WALL_Y0, FRONT, ARCH_Y0, 0, WALL_TOP, 'stone', 'stone_dark'));
  L.push(...box(WALL_X0, ARCH_Y1, FRONT, WALL_Y1, 0, WALL_TOP, 'stone', 'stone_dark'));

  // 拱上腹墙：每个 y 条带的底边沿拱线 —— 这自然切出半圆拱洞
  const yOf = (i) => ARCH_Y0 + (ARCH_Y1 - ARCH_Y0) * i / NA;
  for (let i = 0; i < NA; i++) {
    const y0 = yOf(i), y1 = yOf(i + 1);
    const z0 = archZ(Math.min(y0 + 1e-6, ARCH_CY)) ?? ARCH_SPRING;
    const z1 = archZ(Math.max(y1 - 1e-6, ARCH_CY)) ?? ARCH_SPRING;
    // 正面（朝 +x）
    L.push(q4([[FRONT, y0, WALL_TOP], [FRONT, y1, WALL_TOP], [FRONT, y1, z1], [FRONT, y0, z0]], 'stone'));
    // 拱腹（内拱面）
    L.push(q4([[FRONT, y0, z0], [WALL_X0, y0, z0], [WALL_X0, y1, z1], [FRONT, y1, z1]], 'stone_seam'));
  }

  // 拱洞两侧的内壁（竖直段，从地面到起拱线）
  L.push(q4([[WALL_X0, ARCH_Y0, ARCH_SPRING], [FRONT, ARCH_Y0, ARCH_SPRING],
             [FRONT, ARCH_Y0, 0], [WALL_X0, ARCH_Y0, 0]], 'stone_seam'));
  L.push(q4([[WALL_X0, ARCH_Y1, ARCH_SPRING], [WALL_X0, ARCH_Y1, 0],
             [FRONT, ARCH_Y1, 0], [FRONT, ARCH_Y1, ARCH_SPRING]], 'stone_seam'));

  // 端墙两端面（y = WALL_Y0 / WALL_Y1）
  L.push(q4([[WALL_X0, WALL_Y0, WALL_TOP], [FRONT, WALL_Y0, WALL_TOP],
             [FRONT, WALL_Y0, 0], [WALL_X0, WALL_Y0, 0]], 'stone_dark'));
  L.push(q4([[WALL_X0, WALL_Y1, WALL_TOP], [WALL_X0, WALL_Y1, 0],
             [FRONT, WALL_Y1, 0], [FRONT, WALL_Y1, WALL_TOP]], 'stone_dark'));

  // 墙顶（被压顶盖住，但补上以防露缝）
  L.push(q4([[WALL_X0, WALL_Y0, WALL_TOP], [WALL_X0, WALL_Y1, WALL_TOP],
             [FRONT, WALL_Y1, WALL_TOP], [FRONT, WALL_Y0, WALL_TOP]], 'stone_dark'));

  // 压顶（出挑的一圈）
  L.push(...box(COPING_X0, COPING_Y0, COPING_X1, COPING_Y1, WALL_TOP, COPING_TOP, 'stone_dark', 'stone'));

  return L;
}

// ---------------------------------------------------------------------------
function header(name, title, extra) {
  return '# =============================================================================\n'
    + '# ' + name + ' —— ' + title + '\n#\n'
    + '# 【本文件由 tools/gen-g1-tunnel.mjs 生成，请勿手改】\n#\n'
    + extra
    + '# =============================================================================\n\n';
}

const WHY = '# TUN-1 料石端墙拱（人工裁定：v1 只做端墙 + 拱，护坡下一轮）\n'
  + '# 基准朝向 = DiagDir NE：洞口在 x=0 那条边（N–E），轨道沿 x\n'
  + '# 取图顺序 v0=NE  v1=NW  v2=SW  v3=SE\n'
  + '#   ⚠ 引擎槽位顺序是 NE/SE/SW/NW ⇒ 喂图是 v0, v3, v2, v1\n'
  + '# 尺寸：端墙 y∈[0.14,0.86] 高 0.52；拱半宽 0.17、起拱 0.19、拱顶 0.36\n'
  + '# 偏移不烘进几何：由人在 Sprite Aligner 里调（docs/建模经验.md §7.3）\n'
  + '#\n';

export function generateTunnel() {
  const ball = ballast(20261001);
  const sleep = sleepers();
  const rail = rails();
  const br = bore();
  const wall = portal();

  const out = [];

  // underlay：tunnels: 组 —— 道砟 + 轨枕 + 钢轨 + 洞口暗腔
  {
    let s = header('G1_tunnel_stone', 'G1 几何组：TUN-1 料石端墙拱 —— tunnels: 组（地面层）', WHY);
    s += 'name      G1_tunnel_stone\ngroup     misc\nfootprint 1 1\n\n';
    s += '# --- 洞口暗腔 ' + br.length + ' 面 ---\n' + br.join('\n') + '\n';
    s += '\n# --- 道砟 ' + CN + 'x' + RN + ' = ' + ball.length + ' 面 ---\n' + ball.join('\n') + '\n';
    s += '\n# --- 轨枕 25 根 x 3 段（每根 6 面）---\n' + sleep.join('\n') + '\n';
    s += '\n# --- 钢轨 2 根（每根 6 面）---\n' + rail.join('\n') + '\n';
    out.push(['G1_tunnel_stone', s, br.length + ball.length + sleep.length + rail.length]);
  }

  // overlay：tunnel_overlay: 组 —— 端墙 + 半圆拱 + 压顶
  {
    let s = header('G1_tunnel_stone_over', 'G1 几何组：TUN-1 料石端墙拱 —— tunnel_overlay: 组（立体层）', WHY
      + '# ⚠ 本层是**立体层**，由引擎当 sortable sprite 画在最上面；\n'
      + '#   底下的草地由基础包提供，**不含任何洞口部分** —— 洞口必须全在这里。\n#\n');
    s += 'name      G1_tunnel_stone_over\ngroup     misc\nfootprint 1 1\n\n';
    s += '# --- 端墙 ' + wall.length + ' 面 ---\n' + wall.join('\n') + '\n';
    out.push(['G1_tunnel_stone_over', s, wall.length]);
  }

  for (const [name, text, nf] of out) {
    const f = path.join(ROOT, 'models', name + '.model');
    fs.writeFileSync(f, text, 'utf8');
    log(`  ✔ ${rel(f).padEnd(40)} ${String(text.split('\n').length).padStart(4)} 行   ${nf} 面`);
  }
  log('');
  log('  洞口   端墙 x∈[' + N(WALL_X0) + ',' + N(WALL_X1) + ']  y∈[' + N(WALL_Y0) + ',' + N(WALL_Y1) + ']  高 ' + N(WALL_TOP));
  log('  拱     半宽 ' + N(ARCH_R) + '  起拱 z=' + N(ARCH_SPRING) + '  拱顶 z=' + N(ARCH_CROWN));
  log('  压顶   顶 z=' + N(COPING_TOP));
  log('');
  log('  下一步：make render → make sprites（核对锚点）→ make check');
  return out;
}

if (isMain(import.meta.url)) {
  log('生成 G1 隧道（TUN-1 料石端墙拱）：');
  generateTunnel();
}
