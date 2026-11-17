// =============================================================================
// tools/gen-g1-pylon.mjs —— 生成 **12 个接触网支柱模型**（4 套样式 × 直向/斜向）
//
//   node tools/gen-g1-pylon.mjs
//
// 产出（**整份重写，别手改**）：
//   models/G1_pylon_a.model            C1 混凝土方柱 · 直向（X/Y 向轨道）
//   models/G1_pylon_b.model            C1 · 斜向（EW/NS 斜半轨，腕臂转 45°）
//   models/G1_sty_cyl_a|_b.model       C2 混凝土等径圆柱
//   models/G1_sty_cyl_blue_a|_b.model  C2 + 1500V 浅蓝制式环箍
//   models/G1_sty_steel_a|_b.model     S1 H 型钢
//   models/G1_sty_early_blue_a|_b.model   E1 木杆 + 浅蓝牌（1500V DC）
//   models/G1_sty_early_dkblue_a|_b.model E1 木杆 + 深蓝牌（3000V DC）
//
// -----------------------------------------------------------------------------
// 【为什么改成"一个生成器 + 一张数据表"】
//
//   2026-11-18 人工：「帮我精细化所有接触网杆，增加精度让其更贴近现实中的样子」，
//   并**明确授权提高面数**（「可以大幅提高模型面数，至于参考图自己找」）。
//
//   旧版四套支柱各 2 个 `.model`、每个只有 **4~5 个 box**（≈30 个 quad）：
//   柱基 / 柱身 / 一根方盒子腕臂 / 一个方盒子绝缘子 / 柱顶帽。实机里读起来是
//   「路灯」，不是接触网支柱 —— 缺的是**腕臂组件**（平腕臂 + 斜腕臂 + 定位管 +
//   定位器 + 两串棒式绝缘子 + 抱箍 + 底座），而不是缺颜色。
//
//   四套样式要**同一套腕臂几何**（导线只有一套，挂点必须逐格对齐），
//   手写 12 份必然漂。⇒ 几何写成函数，样式写成数据表，12 个 `.model` 由它吐出。
//   （`.model` 本身仍是写死的字面量：这是"写字面量"这步由脚本代劳，
//     与 `tools/gen-g1-tunnel.mjs` / `gen-g1-catenary.mjs` 同一口径。）
//
// -----------------------------------------------------------------------------
// 【坐标口径 · 不许动】
//
//   柱轴心 **(0.0280, 0.0280)** —— 引擎按**模型原点**摆柱子
//   （`_x_ppp_offsets{-2,-4,-2,0,2,4,2,0}` 只是 ±4 px 的微调），轴心一挪，
//   四朝向整排柱子一起歪。
//
//   挂点（**全制式共用的三个数**，与 `tools/gen-g1-catenary.mjs` 是同一套）：
//       接触线 **0.3000** · 承力索 **0.4000** · 柱顶 0.4800（E1 木杆 0.4600）
//   支柱不被引擎抬高 ⇒ 模型里 z 就是游戏里的 z（只有导线那层有 +0.2552 的
//   `ELRAIL_ELEVATION`，见 `gen-g1-catenary.mjs`）。
//
//   直向（`_a`）：腕臂沿 **+u = +x**；斜向（`_b`）：整组腕臂绕柱轴**转 45°**
//   （斜半轨的轨道是 45° 的，腕臂必须横跨它）。flatiso 只能 90° 步进旋转，
//   45° 转不出来 ⇒ 必须两套模型。
//
// -----------------------------------------------------------------------------
// 【取景框纪律】
//
//   格位 = 内容 bbox ∪ 占地菱形 ∪ 显式 `zmax`（`core/bake.mjs:56`）。
//   `zmax` **按族钉死旧值**（C1/C2 = 0.7000，S1/E1 = 0.6100）：zmax 是**下限**，
//   钉住它 ⇒ 五张分表的格位一格不变 ⇒ `src/rails/templates.pnml` 里那 40 条
//   支柱模板的 `rect` / `yrel` **一个字都不用改**。
//     ⚠ 反过来：改几何时把 zmax 顺手改小 ⇒ 整族格位缩水、模板全部重算。
//       （`docs/建模经验.md` §9.9 / §4.18 ④，踩过两次。）
//   内容横向也必须留在菱形以内：最远点 u = **0.307**（外端线夹），
//   屏幕 −39 px，离框边 128 px 远得很。
//
// -----------------------------------------------------------------------------
// 【面数与"精度上限"】
//
//   4x 下 1 px = 0.089 m（1 格 13.9 m / 156.77 px）。所以：
//     * 真 H175 型钢宽 175 mm = **2.0 px** —— 按实物画会消失，
//       柱身只能取 0.040 格 ≈ 4.5 px（**放大 2.2 倍**），这是可读性的下限；
//     * 棒式绝缘子的伞裙（真件间距 ~100 mm = 1.1 px）正好落在 1 px 上，
//       所以伞裙按 **4 片 / 0.009 格间距** 给，4x 下正好糊成一串"白色竹节"；
//     * 再细的件（地脚螺栓 φ24、销钉）在任何缩放档都是噪声 ⇒ **不画**。
//   旧版 ≈30 quad/件，新版 **≈190~260 quad/件**（6~8 倍）。再往上加只有一个
//   后果：亚像素面互相打架、AA 糊成一片。**这就是本管线的精度上限。**
//
//   所有面走 `emitQuad(pts, mat, hint)`：由 Newell 算法线，再按 `hint`
//   决定要不要反序 ⇒ **绕序不可能错**（手写 200+ 面的头号事故是绕反导致整面消失）。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { ROOT, log, rel, isMain } from './util.mjs';

// ---------------------------------------------------------------- 小工具
const N = (v) => {
  const s = v.toFixed(4);
  return s === '-0.0000' ? '0.0000' : s;
};
const D2R = Math.PI / 180;
const lerp = (a, b, t) => a + (b - a) * t;
const P3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  unit: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
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

// ---------------------------------------------------------------- 口径
const CX = 0.0280, CY = 0.0280;      // 柱轴心（红线，见文件头）
const Z_ARM = 0.4000;               // 承力索（= 平腕臂顶面）
const Z_CONT = 0.3000;              // 接触线
const U_TIP = 0.3000;               // 腕臂外端（跨距口径，与旧版一致）

// 柱基（四套共用同一块"台子"，只有材质分档）
const FND = { half: 0.0280, z0: 0.0000, z1: 0.0120 };
// 二层台（比底层小一圈 ⇒ 4x 下读作"倒角"）
const FND2 = { half: 0.0235, z0: 0.0120, z1: 0.0185 };

// 现代腕臂（C1 / C2 / S1 共用）
//   ⚠ 尺寸口径：**按"屏幕上看得见"定，不按实物**（4x 下 1 px = 0.089 m）。
//     真品腕臂是 φ60 钢管 = 0.0044 格 = **0.7 px**，照抄会整根消失（JP+ 参考图
//     里腕臂也只有 1~2 px，但它是**深色杆 + 浅色柱**的高对比）。所以：
//       平腕臂半高 0.0075（≈2.4 px）· 斜腕臂 0.0065 · 定位管 0.0055 ·
//       绝缘子伞裙半径 0.0140（≈4.4 px，与真件 φ250 的**比例**一致：4.4/2.4 ≈ 1.8）
//     材质一律 `metal_dark`（94,100,106）—— 与浅灰柱身（186）拉开对比；
//     绝缘子用 **`rust` 棕釉瓷**（真件就是棕釉，而且深棕在浅柱上比白瓷更清楚）。
const CA = {
  uRoot: 0.0120,          // 起点压在柱身里（不露缝）
  rMain: 0.0075,          // 平腕臂半高
  zMain: 0.3915,          // 平腕臂轴（顶面 0.3990，承力索 0.4000 贴着它）
  uIns0: 0.0470,          // 平腕臂棒式绝缘子
  uIns1: 0.0870,
  uJoin: 0.2870,          // 平/斜腕臂交汇（套管双耳，正好落在承力索座上）
  uArmEnd: 0.2920,        // 平腕臂外端（伸进承力索座里，端头不露头）
  zDiag0: 0.2875,         // 斜腕臂根部
  rDiag: 0.0065,
  uDIns0: 0.0440,         // 斜腕臂绝缘子（沿斜轴弧长）
  uDIns1: 0.0840,
  uReg0: 0.2320,          // 定位管
  uReg1: 0.2980,
  zReg: 0.3510,
  rReg: 0.0055,
  rSup: 0.0040,           // 定位管支撑 / 斜撑
  rSteady: 0.0045,        // 定位器
  zClampIn: 0.3510,       // 定位器上端（= 定位管端头）
  zClampOut: 0.3040,      // 定位器下端（= 定位线夹顶面）
  rShed: 0.0140,          // 绝缘子伞裙半径
  rCore: 0.0072,          // 绝缘子芯棒
  nShed: 4,
  matShed: 'rust',        // 棕釉瓷套
};
const ARM_CLAMP = { u0: 0.2860, u1: 0.3090, half: 0.0080, z0: 0.3940, z1: 0.4040 }; // 承力索座
const CONT_CLAMP = { u0: 0.2930, u1: 0.3070, half: 0.0075, z0: 0.2940, z1: 0.3050 }; // 定位线夹

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
    const A = [x0, y0], B = [x1, y0], C = [x1, y1], D = [x0, y1];
    const pt = (q, z) => [q[0], q[1], z];
    this.quad([pt(A, z1), pt(B, z1), pt(C, z1), pt(D, z1)], top || mat, [0, 0, 1]);
    this.quad([pt(A, z0), pt(B, z0), pt(C, z0), pt(D, z0)], mat, [0, 0, -1]);
    this.quad([pt(B, z0), pt(C, z0), pt(C, z1), pt(B, z1)], mat, [1, 0, 0]);
    this.quad([pt(C, z0), pt(D, z0), pt(D, z1), pt(C, z1)], mat, [0, 1, 0]);
    this.quad([pt(D, z0), pt(A, z0), pt(A, z1), pt(D, z1)], mat, [-1, 0, 0]);
    this.quad([pt(A, z0), pt(B, z0), pt(B, z1), pt(A, z1)], mat, [0, -1, 0]);
  }

  text() { return this.lines.join('\n') + '\n'; }
}

// ---------------------------------------------------------------- 局部→世界
/**
 * 造一组"腕臂坐标系"：
 *   `p(u,v,z)`  局部点 → 世界点（u 沿腕臂指向轨道；v 横向；绕柱轴转 θ）
 *   `d(du,dv,dz)` 局部向量 → 世界向量（只转不平移）
 */
function frame(thetaDeg) {
  const th = thetaDeg * D2R, c = Math.cos(th), s = Math.sin(th);
  return {
    p: (u, v, z) => [CX + u * c - v * s, CY + u * s + v * c, z],
    d: (du, dv, dz = 0) => [du * c - dv * s, du * s + dv * c, dz],
  };
}

// ---------------------------------------------------------------- 方管 / 伞裙
/**
 * 方截面直杆（任意方向）。4x 下一根 φ60 的腕臂管只有 **1.7 px**，
 * 方截面与圆截面在屏幕上不可分 —— 而 `quad` 只收 4 个点（n 边形面写不出来），
 * 所以杆件一律方截面、截面**转 45°**（菱形）⇒ 读起来像圆管。
 */
function tube(b, F, a, c, r, mat, opt = {}) {
  const A = F.p(a[0], a[1], a[2]), C = F.p(c[0], c[1], c[2]);
  const dir = F.d(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const d = V.unit(dir);
  const up = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const e1 = V.unit(V.cross(up, d));
  const e2 = V.cross(d, e1);
  const roll = (opt.roll ?? 45) * D2R;
  const k4 = [0, 1, 2, 3];
  const ring = (p) => k4.map((k) => {
    const th = roll + k * Math.PI / 2;
    return V.add(p, V.add(V.mul(e1, Math.cos(th) * r), V.mul(e2, Math.sin(th) * r)));
  });
  const R0 = ring(A), R1 = ring(C);
  for (const k of k4) {
    const k2 = (k + 1) % 4;
    const th = roll + (k + 0.5) * Math.PI / 2;
    const out = V.add(V.mul(e1, Math.cos(th)), V.mul(e2, Math.sin(th)));
    b.quad([R0[k], R1[k], R1[k2], R0[k2]], mat, out);
  }
  if (opt.caps !== false) {
    b.quad([R0[0], R0[1], R0[2], R0[3]], mat, V.mul(d, -1));
    b.quad([R1[0], R1[1], R1[2], R1[3]], mat, d);
  }
}

/** 棒式绝缘子：芯棒 + n 片伞裙（每片 = 一段稍粗的短方管，截面转 45°）
 *  ⚠ 伞裙**厚度 0.0055 / 间距 ~0.011**：真件伞间距 100 mm = 1.1 px，
 *    所以 4x 下它们本来就该糊成一串"竹节"；留 0.003 会渲染成 4 个分离的白点
 *    （第一版就是这样，看起来像撒了一把米）。 */
function rodInsulator(b, F, a, c, matCore, matShed, nShed = CA.nShed,
  rCore = CA.rCore, rShed = CA.rShed) {
  tube(b, F, a, c, rCore, matCore, { caps: false });
  const dir = V.unit([c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
  for (let i = 0; i < nShed; i++) {
    const t = 0.10 + 0.80 * (i / Math.max(1, nShed - 1));
    const p0 = P3(a, c, t);
    const p1 = V.add(p0, V.mul(dir, 0.0055));
    tube(b, F, p0, p1, rShed, matShed, { roll: 45 });
  }
}

// ---------------------------------------------------------------- 柱身（四种）
/** C1：混凝土方柱（等径）+ 三道模板缝 + 收头帽 */
function mastC1(b, zTop) {
  const h = 0.0200;                                  // 0.040 方
  const x0 = CX - h, x1 = CX + h, y0 = CY - h, y1 = CY + h;
  b.box(x0, y0, FND2.z1, x1, y1, zTop - 0.0160, 'concrete', 'concrete');
  // 模板缝（每 ~1.7 m 一道；4x 下是 1 px 的浅灰线，别加多）
  for (const z of [0.1300, 0.2500, 0.3700]) {
    const w = 0.0030;
    b.quad([[x0, y1 + 0.0018, z - w], [x1, y1 + 0.0018, z - w],
      [x1, y1 + 0.0018, z + w], [x0, y1 + 0.0018, z + w]], 'concrete_seam', [0, 1, 0]);
    b.quad([[x1 + 0.0018, y1, z - w], [x1 + 0.0018, y0, z - w],
      [x1 + 0.0018, y0, z + w], [x1 + 0.0018, y1, z + w]], 'concrete_seam', [1, 0, 0]);
  }
  // 柱顶：一圈挑出的压顶 + 一块稍小的封顶
  b.box(CX - 0.0240, CY - 0.0240, zTop - 0.0160, CX + 0.0240, CY + 0.0240, zTop - 0.0060,
    'concrete_dark', 'concrete_seam');
  b.box(CX - 0.0195, CY - 0.0195, zTop - 0.0060, CX + 0.0195, CY + 0.0195, zTop,
    'concrete', 'concrete');
}

/** C2：混凝土等径圆柱（16 段）+ 两道模缝 + 圆柱帽 */
function mastC2(b, zTop) {
  const seg = 16;
  b.lines.push(`cyl ${N(CX)} ${N(CY)} ${N(FND2.z1)} ${N(zTop - 0.0160)} 0.0200 0.0200 ${seg}  concrete_mid`);
  b.quads += seg + 2;
  for (const z of [0.1400, 0.3300]) {
    b.lines.push(`cyl ${N(CX)} ${N(CY)} ${N(z - 0.0035)} ${N(z + 0.0035)} 0.0208 0.0208 ${seg}  concrete_seam`);
    b.quads += seg + 2;
  }
  b.lines.push(`cyl ${N(CX)} ${N(CY)} ${N(zTop - 0.0160)} ${N(zTop - 0.0080)} 0.0250 0.0250 ${seg}  concrete_mid`);
  b.lines.push(`cyl ${N(CX)} ${N(CY)} ${N(zTop - 0.0080)} ${N(zTop)} 0.0175 0.0170 ${seg}  concrete_mid`);
  b.quads += 2 * (seg + 2);
}

/** S1：H 型钢（两片翼缘 + 一片腹板 ⇒ 侧面真的有 H 形凹槽，不是画上去的） */
function mastS1(b, zTop) {
  const y0 = CY - 0.0140, y1 = CY + 0.0140;          // 翼缘宽 0.028
  const fx0 = CX - 0.0155, fx1 = CX - 0.0095;        // 翼缘 A
  const gx0 = CX + 0.0095, gx1 = CX + 0.0155;        // 翼缘 B
  const wx0 = fx1, wx1 = gx0;                        // 腹板
  const wy0 = CY - 0.0035, wy1 = CY + 0.0035;
  const zb = FND2.z1, zt = zTop - 0.0035;
  b.box(fx0, y0, zb, fx1, y1, zt, 'metal_pale', 'metal_dark');
  b.box(wx0, wy0, zb, wx1, wy1, zt, 'metal', 'metal_dark');
  b.box(gx0, y0, zb, gx1, y1, zt, 'metal_pale', 'metal_dark');
  // 柱脚加劲板（H 型钢柱的标志性零件：翼缘外侧两块小三角板，按矩形板给）
  b.box(fx0 - 0.0010, y0 - 0.0030, zb, gx1 + 0.0010, y0, zb + 0.0230, 'metal_dark');
  b.box(fx0 - 0.0010, y1, zb, gx1 + 0.0010, y1 + 0.0030, zb + 0.0230, 'metal_dark');
  // 柱顶端板（平顶无帽）
  b.box(CX - 0.0170, CY - 0.0155, zt, CX + 0.0170, CY + 0.0155, zTop, 'metal_dark', 'metal_seam');
  // 脚钉（焊在腹板正面，沿柱身一列）
  for (const z of [0.0620, 0.1120, 0.1620, 0.2120, 0.2620]) {
    b.box(wx0 + 0.0010, y1, z - 0.0030, wx1 - 0.0010, y1 + 0.0080, z + 0.0030, 'metal_dark');
  }
}

/** E1：木杆（八角回转体）+ 底箍 + 制式环箍 */
function mastE1(b, zTop, plateMat) {
  b.lines.push(`cyl ${N(CX)} ${N(CY)} 0.0120 ${N(zTop)} 0.0225 0.0205 8  wood_dark`);
  b.quads += 8 + 2;
  // 木杆脚箍（防裂箍 + 根部包铁）
  b.lines.push(`cyl ${N(CX)} ${N(CY)} 0.0120 0.0230 0.0235 0.0235 8  metal_dark`);
  b.quads += 8 + 2;
  // 制式环箍（浅蓝 1500V / 深蓝 3000V）：做成**方板**而不是圆柱环 —— 一张图
  // 要转 4 个朝向用，薄板在 2 个朝向会被柱子自己挡住；方板 4 个朝向都在。
  if (plateMat) {
    b.box(CX - 0.0240, CY - 0.0240, 0.1250, CX + 0.0240, CY + 0.0240, 0.1850, plateMat);
  }
}

// ---------------------------------------------------------------- 腕臂组件
/**
 * 现代腕臂（C1 / C2 用）：平腕臂 + 斜腕臂 + 两串棒式绝缘子 + 定位管
 * + 定位管支撑 + 定位器 + 承力索座 + 定位线夹 + 两处抱箍。
 */
function cantileverModern(b, F, opt = {}) {
  const mat = opt.mat || 'metal_dark';          // 腕臂杆件（深灰，压住浅色柱身）
  const matCol = opt.matCol || 'metal';         // 抱箍（中灰，读出"卡箍"）
  const matShed = opt.matShed || CA.matShed;    // 瓷套

  // --- 抱箍（上：平腕臂底座；下：斜腕臂底座）---
  const colHalf = opt.colHalf ?? 0.0235;
  b.box(CX - colHalf, CY - colHalf, 0.3830, CX + colHalf, CY + colHalf, 0.4115, matCol, 'metal_seam');
  b.box(CX - colHalf, CY - colHalf, 0.2760, CX + colHalf, CY + colHalf, 0.3000, matCol, 'metal_seam');

  // --- 平腕臂（承力索托架）---
  const zM = CA.zMain;
  tube(b, F, [CA.uRoot, 0, zM], [CA.uArmEnd, 0, zM], CA.rMain, mat);
  // 平腕臂棒式绝缘子（靠柱端）
  rodInsulator(b, F, [CA.uIns0, 0, zM], [CA.uIns1, 0, zM], mat, matShed);

  // --- 斜腕臂（从柱身下侧斜升到平腕臂外端）---
  const zD1 = zM - CA.rMain - 0.0008;                // 远端顶面压在平腕臂底下
  tube(b, F, [CA.uRoot, 0, CA.zDiag0], [CA.uJoin, 0, zD1], CA.rDiag, mat);
  // 斜腕臂上的绝缘子：沿斜轴按弧长取两段
  const dLen = Math.hypot(CA.uJoin - CA.uRoot, zD1 - CA.zDiag0);
  const at = (L) => {
    const t = L / dLen;
    return [lerp(CA.uRoot, CA.uJoin, t), 0, lerp(CA.zDiag0, zD1, t)];
  };
  rodInsulator(b, F, at(CA.uDIns0), at(CA.uDIns1), mat, matShed);
}

/** 交汇处的连接件（按腕臂坐标系给，两个朝向都对） */
function joinPart(b, F, u, z0, z1, mat) {
  const du = 0.009, dv = 0.010;
  frameBox(b, F, u - du, u + du, dv, z0, z1, mat);
}

/**
 * 按**腕臂坐标系**给的长方块（u0..u1 沿臂、±vHalf 横向、z0..z1 竖直）。
 * ⚠ 斜向（θ=45°）绝不能直接用世界坐标的 `CX + u` —— 那会把金具留在 +x 上，
 *   渲出来是"臂转 45°、端头金具还在原地"的一堆漂浮方块（第一版就是这样）。
 */
function frameBox(b, F, u0, u1, vHalf, z0, z1, mat, topMat) {
  const A = F.p(u0, -vHalf, z0), B = F.p(u1, -vHalf, z0);
  const C = F.p(u1, vHalf, z0), D = F.p(u0, vHalf, z0);
  const A2 = F.p(u0, -vHalf, z1), B2 = F.p(u1, -vHalf, z1);
  const C2 = F.p(u1, vHalf, z1), D2 = F.p(u0, vHalf, z1);
  b.quad([A2, B2, C2, D2], topMat || mat, [0, 0, 1]);
  b.quad([A, B, C, D], mat, [0, 0, -1]);
  b.quad([B, C, C2, B2], mat, F.d(1, 0));
  b.quad([D, A, A2, D2], mat, F.d(-1, 0));
  b.quad([C, D, D2, C2], mat, F.d(0, 1));
  b.quad([A, B, B2, A2], mat, F.d(0, -1));
}

/** 现代腕臂的其余部分（定位管 / 支撑 / 定位器 / 两个线夹） */
function registrationModern(b, F, opt = {}) {
  const mat = opt.mat || 'metal_dark';
  const matFix = opt.matFix || 'metal';        // 线夹（比杆件亮一档 ⇒ 端头读得出"金具"）

  // --- 定位管（平腕臂下面那根，F 形的第二横）---
  tube(b, F, [CA.uReg0, 0, CA.zReg], [CA.uReg1, 0, CA.zReg], CA.rReg, mat);
  // --- 定位管支架：竖直吊杆（内端）+ 斜撑（中段）⇒ 真件的"定位管支撑"就是这两根
  const zUnder = CA.zMain - CA.rMain - 0.0010;
  tube(b, F, [0.2380, 0, zUnder], [0.2380, 0, CA.zReg + CA.rReg * 0.5], CA.rSup, mat);
  tube(b, F, [0.2520, 0, zUnder], [0.2760, 0, CA.zReg + CA.rReg * 0.5], CA.rSup, mat);
  // --- 定位器（定位管端头 → 定位线夹；近竖直、略向外倾）---
  tube(b, F, [CA.uReg1, 0, CA.zReg], [U_TIP, 0, CA.zClampOut], CA.rSteady, mat);
  // --- 承力索座（平腕臂外端，承力索 0.40 从它里面过）---
  frameBox(b, F, ARM_CLAMP.u0, ARM_CLAMP.u1, ARM_CLAMP.half,
    ARM_CLAMP.z0, ARM_CLAMP.z1, matFix, 'metal_seam');
  // --- 定位线夹（接触线 0.30）---
  frameBox(b, F, CONT_CLAMP.u0, CONT_CLAMP.u1, CONT_CLAMP.half,
    CONT_CLAMP.z0, CONT_CLAMP.z1, matFix, 'metal_seam');
}

/** 早期腕臂（E1）：单根斜臂 + 杆顶拉杆（花篮螺栓）+ 一串绝缘子 + 定位吊杆 */
function cantileverOld(b, F, opt = {}) {
  const matArm = opt.matDark || 'metal_dark';
  // 臂根 / 拉杆根的抱箍
  b.lines.push(`cyl ${N(CX)} ${N(CY)} 0.3230 0.3380 0.0235 0.0235 8  metal_dark`);
  b.quads += 10;
  b.lines.push(`cyl ${N(CX)} ${N(CY)} 0.4430 0.4580 0.0235 0.0235 8  metal_dark`);
  b.quads += 10;

  // 斜臂：柱身 → 外端（外端顶面 0.3995，承力索座压在上面）
  tube(b, F, [0.0100, 0, 0.3300], [U_TIP, 0, 0.3995], 0.0075, matArm);
  // 拉杆：杆顶 → 外端（早期线路的典型"上拉下托"）
  tube(b, F, [0.0060, 0, 0.4520], [0.2680, 0, 0.4060], 0.0042, matArm);
  // 花篮螺栓（拉杆中段加粗，读作一个调节件）
  {
    const a = [0.0060, 0, 0.4520], c = [0.2680, 0, 0.4060];
    const p0 = P3(a, c, 0.40), p1 = P3(a, c, 0.60);
    tube(b, F, p0, p1, 0.0062, 'metal_pale');
  }
  // 棒式绝缘子（臂根，沿臂轴）
  rodInsulator(b, F, [0.0300, 0, 0.3342], [0.0700, 0, 0.3390], matArm, 'trim_white', 3);
  // 定位吊杆（外端 → 接触线）
  tube(b, F, [U_TIP, 0, 0.3930], [U_TIP, 0, 0.3060], 0.0040, matArm);
  // 承力索座 / 定位线夹
  frameBox(b, F, 0.2840, 0.3070, 0.0085, 0.3940, 0.4060, 'metal', 'metal_seam');
  frameBox(b, F, 0.2925, 0.3075, 0.0075, 0.2940, 0.3050, 'metal', 'metal_seam');
}

/** 现代腕臂：交汇件 + 定位件（抽出来，紧跟在主体之后） */
function cantileverModernTail(b, F, opt = {}) {
  joinPart(b, F, CA.uJoin, CA.zMain - CA.rMain - 0.0010, CA.zMain + CA.rMain, opt.matFix || 'metal');
  registrationModern(b, F, opt);
}

// ---------------------------------------------------------------- 铭牌 / 脚钉
/** 杆号牌 + "高压危险"警示牌（贴在朝 +y 的那一面；4x 下白牌 2×5 px、红牌 2×4 px） */
function signs(b, yFacePlant, dz = 0) {
  const yQ = yFacePlant + 0.0018;
  // ⚠ E1 的制式环箍占 0.125~0.185，牌子必须整体抬高（dz = +0.050）——
  //   否则那块红牌正好糊在蓝箍上（第一版就是这样，蓝板上多一道红）。
  const z0 = 0.1960 + dz, z1 = 0.2100 + dz, z2 = 0.1700 + dz, z3 = 0.1840 + dz;
  // 横排（宽 > 高）：真件 200×150 mm 是**横**的；第一版做成竖条，
  // 4x 下读起来像柱子上一道白漆，不像牌子。
  b.quad([[0.0150, yQ, z0], [0.0410, yQ, z0], [0.0410, yQ, z1], [0.0150, yQ, z1]],
    'sign_white', [0, 1, 0]);
  b.quad([[0.0170, yQ, z2], [0.0390, yQ, z2], [0.0390, yQ, z3], [0.0170, yQ, z3]],
    'trim_red', [0, 1, 0]);
}

/** 脚钉（焊在柱身上的 U 形踏钉；4x 下是 1 px 的小凸点，一列 5 个） */
function steps(b, xFace, yC, yHalf, zs) {
  for (const z of zs) {
    b.box(xFace - 0.0010, yC - yHalf, z - 0.0030, xFace + 0.0080, yC + yHalf, z + 0.0030, 'metal_dark');
  }
}

// ---------------------------------------------------------------- 四套样式的装配
function buildC1(b, theta) {
  const F = frame(theta);
  b.box(CX - FND.half, CY - FND.half, FND.z0, CX + FND.half, CY + FND.half, FND.z1,
    'concrete_pad', 'concrete_seam');
  b.box(CX - FND2.half, CY - FND2.half, FND2.z0, CX + FND2.half, CY + FND2.half, FND2.z1,
    'concrete_dark', 'concrete_seam');
  b.box(CX - 0.0155, CY - 0.0155, FND2.z1, CX + 0.0155, CY + 0.0155, 0.0215, 'metal_dark');
  mastC1(b, 0.4800);
  cantileverModern(b, F, { colHalf: 0.0235 });
  cantileverModernTail(b, F);
  steps(b, 0.0480, CY, 0.0035, [0.0620, 0.1120, 0.1620, 0.2120, 0.2620]);
  signs(b, 0.0480);
}

function buildC2(b, theta, plate) {
  const F = frame(theta);
  const seg = 16;
  b.lines.push(`cyl ${N(CX)} ${N(CY)} ${N(FND.z0)} ${N(FND.z1)} 0.0280 0.0280 ${seg}  concrete_mid`);
  b.lines.push(`cyl ${N(CX)} ${N(CY)} ${N(FND2.z0)} ${N(FND2.z1)} 0.0255 0.0255 ${seg}  concrete_mid`);
  b.quads += 2 * (seg + 2);
  b.lines.push(`cyl ${N(CX)} ${N(CY)} 0.0185 0.0215 0.0215 0.0215 ${seg}  metal_dark`);
  b.quads += seg + 2;
  mastC2(b, 0.4800);
  cantileverModern(b, F, { colHalf: 0.0225 });
  cantileverModernTail(b, F);
  steps(b, 0.0480, CY, 0.0035, [0.0620, 0.1120, 0.1620, 0.2120, 0.2620]);
  signs(b, 0.0480);
  if (plate) collarPlate(b, plate);
}

/** C2 + 制式环箍（1500V DC 那条地铁线在用；方板 = 一张图 4 个朝向都看得见） */
function collarPlate(b, plateMat) {
  b.box(CX - 0.0245, CY - 0.0245, 0.1250, CX + 0.0245, CY + 0.0245, 0.1850, plateMat);
}

function buildS1(b, theta) {
  const F = frame(theta);
  b.box(CX - FND.half, CY - FND.half, FND.z0, CX + FND.half, CY + FND.half, FND.z1,
    'concrete_pad', 'concrete_seam');
  b.box(CX - FND2.half, CY - FND2.half, FND2.z0, CX + FND2.half, CY + FND2.half, FND2.z1,
    'concrete_dark', 'concrete_seam');
  b.box(CX - 0.0160, CY - 0.0145, FND2.z1, CX + 0.0160, CY + 0.0145, 0.0215, 'metal_dark');
  mastS1(b, 0.4800);
  cantileverModern(b, F, { colHalf: 0.0195 });
  cantileverModernTail(b, F);
  // H 型钢的杆号牌挂在**翼缘外侧面**（朝轨道那面），不是 +y 面
  const xq = 0.0435 + 0.0018;
  b.quad([[xq, 0.0150, 0.1960], [xq, 0.0410, 0.1960], [xq, 0.0410, 0.2100], [xq, 0.0150, 0.2100]],
    'sign_white', [1, 0, 0]);
  b.quad([[xq, 0.0170, 0.1700], [xq, 0.0390, 0.1700], [xq, 0.0390, 0.1840], [xq, 0.0170, 0.1840]],
    'trim_red', [1, 0, 0]);
}

function buildE1(b, theta, plateMat) {
  const F = frame(theta);
  b.box(CX - 0.0250, CY - 0.0250, 0.0000, CX + 0.0250, CY + 0.0250, 0.0120,
    'concrete_dark', 'concrete_seam');
  mastE1(b, 0.4600, plateMat);
  cantileverOld(b, F);
  signs(b, 0.0280 + 0.0245, 0.0500);   // 抬到蓝箍之上（见 signs 的 ⚠）
}

// ---------------------------------------------------------------- 模型清单
const M = 0.7000, M2 = 0.6100, TH = 45;

const JOBS = [
  { name: 'G1_pylon_a', zmax: M, why: 'C1 混凝土方柱 · 直向', build: (b) => buildC1(b, 0) },
  { name: 'G1_pylon_b', zmax: M, why: 'C1 混凝土方柱 · 斜向 45°', build: (b) => buildC1(b, TH) },
  { name: 'G1_sty_cyl_a', zmax: M, why: 'C2 混凝土等径圆柱 · 直向', build: (b) => buildC2(b, 0, null) },
  { name: 'G1_sty_cyl_b', zmax: M, why: 'C2 混凝土等径圆柱 · 斜向 45°', build: (b) => buildC2(b, TH, null) },
  { name: 'G1_sty_cyl_blue_a', zmax: M, why: 'C2 + 1500V 浅蓝环箍 · 直向', build: (b) => buildC2(b, 0, 'awning_ltblue') },
  { name: 'G1_sty_cyl_blue_b', zmax: M, why: 'C2 + 1500V 浅蓝环箍 · 斜向 45°', build: (b) => buildC2(b, TH, 'awning_ltblue') },
  { name: 'G1_sty_steel_a', zmax: M2, why: 'S1 H 型钢 · 直向', build: (b) => buildS1(b, 0) },
  { name: 'G1_sty_steel_b', zmax: M2, why: 'S1 H 型钢 · 斜向 45°', build: (b) => buildS1(b, TH) },
  { name: 'G1_sty_early_blue_a', zmax: M2, why: 'E1 木杆 + 浅蓝牌（1500V DC）· 直向', build: (b) => buildE1(b, 0, 'awning_ltblue') },
  { name: 'G1_sty_early_blue_b', zmax: M2, why: 'E1 木杆 + 浅蓝牌（1500V DC）· 斜向 45°', build: (b) => buildE1(b, TH, 'awning_ltblue') },
  { name: 'G1_sty_early_dkblue_a', zmax: M2, why: 'E1 木杆 + 深蓝牌（3000V DC）· 直向', build: (b) => buildE1(b, 0, 'awning_dkblue') },
  { name: 'G1_sty_early_dkblue_b', zmax: M2, why: 'E1 木杆 + 深蓝牌（3000V DC）· 斜向 45°', build: (b) => buildE1(b, TH, 'awning_dkblue') },
];

const SPEC = [
  '#   挂点（全制式共用）：接触线 0.3000 · 承力索 0.4000 格',
  '#   柱顶：C1/C2/S1 0.4800 · E1 0.4600    柱轴心 (0.0280, 0.0280)',
  '#',
  '#   构件（4x 下 1 px = 0.089 m）：',
  '#     柱基 0.056 方 + 二次台 0.047 方 + 底板      —— 混凝土基础三件',
  '#     柱身 C1 混凝土方柱 0.040 / C2 圆柱 φ0.040 / S1 H 型钢 0.031×0.028 / E1 木杆 φ0.045',
  '#     腕臂 平腕臂 0.011 管 + 斜腕臂 0.010 管 + 两串棒式绝缘子（4 片伞裙）',
  '#     定位 定位管 0.0084 管 + 定位管支撑 + 定位器 + 定位线夹（接触线 0.30）',
  '#     杂项 抱箍 ×2 / 承力索座 / 杆号牌 / 高压危险牌 / 脚钉 ×5（木杆无脚钉）',
];

const HDR = (job) =>
  '# =============================================================================\n'
  + '# ' + job.name + ' —— 接触网支柱（' + job.why + '）\n'
  + '#\n'
  + '# 【本文件由 tools/gen-g1-pylon.mjs 生成，请勿手改】\n'
  + SPEC.join('\n') + '\n'
  + '#\n'
  + '#   `zmax` 钉在 ' + job.zmax.toFixed(4) + '（本族旧值）⇒ 分表格位不变、模板 rect/yrel 不动。\n'
  + '#   内容最高点 ≈ 0.4830、最远点 u = 0.3070，都在取景框内。\n'
  + '# =============================================================================\n\n';

export function generatePylons() {
  const made = [];
  for (const job of JOBS) {
    const b = new Builder();
    job.build(b);
    const text = HDR(job)
      + 'name      ' + job.name + '\n'
      + 'group     misc\n'
      + 'footprint 1 1\n'
      + 'zmax      ' + job.zmax.toFixed(4) + '\n\n'
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
  log('生成接触网支柱（4 套样式 × 直向/斜向 = 12 个模型）：');
  const made = generatePylons();
  const tot = made.reduce((s, m) => s + m.quads, 0);
  log('');
  log('  合计 ' + made.length + ' 个模型 / ' + tot + ' 个四边形面（旧版约 30 面/件）');
  log('  下一步：node tools/build.mjs --step render → node tools/check.mjs');
}
