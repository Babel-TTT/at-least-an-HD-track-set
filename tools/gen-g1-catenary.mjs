// =============================================================================
// tools/gen-g1-catenary.mjs —— 生成接触网**导线**的 6 个模型
//
//   node tools/gen-g1-catenary.mjs        （或加个 make 目标）
//
// 产出（**会被本工具整份重写**，别手改）：
//   models/G1_wire_x_sw.model         直向：2 格跨的**前半**（杆在 S–W 端 x=1）
//   models/G1_wire_x_ne.model         直向：2 格跨的**后半**（杆在 N–E 端 x=0）
//   models/G1_wire_x_short.model      直向：**1 格跨**（两端都有杆）
//   models/G1_wire_ns_w_n.model       斜向（贴 W 角）：杆在 N 端
//   models/G1_wire_ns_w_s.model       斜向（贴 W 角）：杆在 S 端
//   models/G1_wire_ns_w_short.model   斜向（贴 W 角）：1 格跨
//
// -----------------------------------------------------------------------------
// 【为什么是这 3 张】（核自 src/table/elrail_data.h；人工 2026-10-02 指出）
//
//   `_rail_wires[5][TRACK_END][4]` 的第 3 维 = **本格有几处立杆**：
//     只有一端有杆 → 这一格是 **2 格跨的一半**（另一半在隔壁那格）
//     两端都有杆   → 这一格是 **1 格跨的完整弧**
//   ⇒ 每个方向 3 张：前半 / 后半 / 短跨。
//   旁证：`enum WireSpriteOffset` 里第三张就叫 **`WSO_X_SHORT`** ✓
//
//   （上一版把这三张当成"同一条整格线、只是接线头颜色不同"——错的，
//     于是每格自成一条对称弧、两端永远接不上隔壁的弧。）
//
// -----------------------------------------------------------------------------
// 【只出 6 个模型，4 个朝向全用上】
//   flatiso 的 90° 旋转 R(x,y) = (1−y, x) 把「贴 W 角」的斜线转到「贴 S 角」⇒
//     直向：X 向用 v0 · Y 向用 v1
//     斜向：NS_W_* 用 v0 · EW_S_* 用 v1 · NS_E_* 用 v2 · EW_N_* 用 v3
//   （四个朝向正好对应引擎那 4 个轨道位：LEFT / LOWER / RIGHT / UPPER ✓）
//
// -----------------------------------------------------------------------------
// 【剖面】
//   形状函数返回**单位下垂**（0..1），每根线再乘自己的 D：
//       半弧（2 格跨的一半；q = 离杆位的归一距离，q=0 在杆位、q=1 在跨中）
//           shape(q) = 2q − q²
//       短弧（1 格跨，两端都是杆；q = 沿格归一坐标）
//           shape(q) = 4q(1−q)
//       ⇒ z = z杆位 − D·shape(q)
//   D：接触线 0.0000（人工：拉平，现实里接触线就是靠张力拉平的）
//      承力索 0.1500
//   ⚠ **两根线的 D 必须各用各的**。早先版本把 DC 直接喂进形状函数，
//     LINES[] 里承力索自己的 D 从来没被读到 ⇒ 两根线永远同深
//     （DC 改成 0 之后就是两条笔直的线，改 DM 只动高度不动弧度）。
//   `z杆位` 是「相对引擎给定原点」的 —— 引擎另外抬
//   `ELRAIL_ELEVATION = 10` 单位 = **0.2552 格**（elrail.cpp:1281），所以模型里
//   写 HC = 0.1448 / HM = 0.3248，游戏里才是 **0.40 / 0.58 格**。
//
// -----------------------------------------------------------------------------
// 【绕序】`quad` 不带法线，flatiso 用 Newell 按顶点序算法线，反了会被背面剔除。
//   直向（x 沿轴、横向 ±y）：
//       顶面   A−(z+) B−(z+) B+(z+) A+(z+)
//       侧面−y A−(z−) B−(z−) B−(z+) A−(z+)
//       侧面+y A+(z+) B+(z+) B+(z−) A+(z−)
//   斜向（s/t 坐标）：(s,t)→(x,y) 是**镜像**（det = −2）⇒ 上面那套法线朝**内**，
//   必须整组反过来：
//       顶面   A+(z+) B+(z+) B−(z+) A−(z+)
//       侧面−t A−(z+) B−(z+) B−(z−) A−(z−)
//       侧面+t A+(z−) B+(z−) B+(z+) A+(z+)
//   （两套都按 Newell 手算核过顶面 nz > 0。）
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { ROOT, log, rel, isMain } from './util.mjs';

const N = (v) => v.toFixed(4);

// ---- 口径：改这里就行 -------------------------------------------------------
const HC = 0.1448;                 // 接触线：一步不动（游戏里 0.40）—— **人工：不要弧度**
const HM = 0.3248;                 // 承力索挂点（游戏里 0.58；腕臂跟着抬到 0.58）
const DC = 0.0000;                 // 接触线下垂 = 0（直线，张力拉平）
const DM = 0.1500;                 // 承力索下垂（游戏里跨中降到 0.43，仍高于接触线 0.03）
const WC = 0.0030;                 // 接触线竖直半厚（人工：再细点）
const WM = 0.0045;                 // 承力索竖直半厚
const WY = 0.0045;                 // 直向：横向半宽（y 方向 ±）
const DT = 0.010000;               // 斜向：t 方向半宽（人工：再细点）
const T0 = 0.0000;                 // 斜向：画在瓦片**正中**的 t 基准（= 瓦片主对角线）
                                   // ⚠ 不是 0.5！引擎会用包络盒 (8,0)/(0,8) 自己挪半格到左/右半轨
const SEG = 5;                     // 折线段数（结点 = SEG+1）
const DROP_S = [0.2, 0.4, 0.6, 0.8];      // 直向吊弦位置（沿格）
const DROP_D = [0.25, 0.5, 0.75];         // 斜向吊弦位置（沿半格）
const DROP_W = 0.0030;             // 吊弦半粗
// 两根线：接触线（下、细、**最深**）+ 承力索（上、粗、次深）
//   人工：「线颜色深点」⇒ 接触线 metal_dark(94,100,106) → **trim_dark(62,66,71)**、
//   承力索 metal_seam(122,127,132) → **metal_dark(94,100,106)**
const C = { c: 'trim_dark', m: 'metal_dark' };

// 斜坡补偿：引擎对上/下坡的导线额外抬 ELRAIL_ELEVRAISE = 19 / ELRAIL_EVLOWER = 9
// 单位（平地 10）⇒ 模型里的内容要**反向**挪同样的量，游戏里才是同一高度。
//   1 格 = 8 单位 ⇒ 1 单位 = 0.2041/8 = 0.0255125 格
const UNIT = 0.2041 / 8;
const UP_DZ = -9 * UNIT;           // 上坡低端：引擎多抬 9 单位 ⇒ 内容降 9
const DOWN_DZ = +1 * UNIT;         // 下坡低端：引擎少抬 1 单位 ⇒ 内容升 1

// ★ 坡道：导线要**跟着坡面斜**，不是水平（人工 2026-10-02：「按和上坡铁轨一样的坡度」）。
//   一格坡道抬 8 单位 = **RISE = 0.2041 格 = 32 px @4x**（与 tools/gen-g1-slope.mjs 同源）。
//   引擎的 origin 以**瓦片最低角**为准（`ELRAIL_ELEVRAISE = ELEVATION + TILE_HEIGHT + 1`），
//   而平地的 `ELEVATION = 10` 正是"离地 10 单位" ⇒ 低端就是上面那两个常量 ✓，
//   高端要再加一个 RISE：
//     上坡（SLOPE_SW，x=1 那头高）：x=0 → UP_DZ(−9 单位)  · x=1 → UP_DZ + RISE(−1 单位)
//     下坡（SLOPE_NE，x=0 那头高）：x=1 → DOWN_DZ(+1 单位) · x=0 → DOWN_DZ + RISE(+9 单位)
//   ⚠ 上一版两端都写的是低端那个常量 ⇒ **高端差整整一个 RISE（32 px），会插进坡里**。
const RISE = 0.2041;

// 单位形状（0..1），实际下垂 = 每根线自己的 D × shape
const arcHalf = (q) => 2 * q - q * q;            // 2 格跨的一半
const arcShort = (q) => 4 * q * (1 - q);         // 1 格跨

// 两根线：接触线（下、细、深色）+ 承力索（上、粗、浅色）
//   dz(x)：沿格坐标 x ∈ [0,1] → z 偏移（平坡恒 0，坡道是斜的）
const LINES = [
  { z: HC, D: DC, W: WC, mat: C.c, tag: '接触线（contact）', dz: () => 0 },
  { z: HM, D: DM, W: WM, mat: C.m, tag: '承力索（messenger）', dz: () => 0 },
];

/** 换一组 dz(x) 的线（斜坡用；diagonal 那边始终用 LINES，斜向没有坡道槽位） */
const linesAt = (dzf) => LINES.map((L) => ({ ...L, dz: dzf }));

const HDR = (name, why, dz) =>
  '# =============================================================================\n'
  + '# ' + name + ' —— 接触网导线（' + why + '）\n'
  + '#\n'
  + '# 【本文件由 tools/gen-g1-catenary.mjs 生成，请勿手改】\n'
  + '#   接触线杆位 z=' + N(HC) + ' 下垂 ' + N(DC) + ' · 承力索杆位 z=' + N(HM) + ' 下垂 ' + N(DM) + '\n'
  + '#   （模型里的 z 是"相对引擎原点"的；引擎另外抬 ELRAIL_ELEVATION = 0.2552 格）\n'
  + '#   坡道：沿格 z 偏移 x=0 → ' + N(dz(0)) + ' · x=1 → ' + N(dz(1))
  + (Math.abs(dz(1) - dz(0)) > 1e-9 ? '   ← 跟着坡面斜 RISE = ' + N(RISE) + ' 格' : '   （平坡）') + '\n'
  + '#   竖直半厚：接触线 ' + N(WC) + ' · 承力索 ' + N(WM) + '；' + SEG + ' 段折线\n'
  + '# =============================================================================\n\n';

const q = (pts, mat) => 'quad ' + pts.map(([x, y, z]) => N(x) + ' ' + N(y) + ' ' + N(z)).join('  ') + '   ' + mat;

/**
 * 直向模型（沿瓦片 x 轴，横向 ±y）
 * @param {(p:number)=>number} shape  p = 沿格坐标 x∈[0,1] → **单位**下垂 0..1
 * @param {number[]} drops           吊弦的沿格位置
 */
function straight(name, why, shape, drops, lines = LINES) {
  const dz = lines[0].dz ?? (() => 0);
  const out = [];
  for (const L of lines) {
    out.push('# --- ' + L.tag + ' ---');
    for (let i = 0; i < SEG; i++) {
      const xa = i / SEG, xb = (i + 1) / SEG;
      const za = L.z + L.dz(xa) - L.D * shape(xa), zb = L.z + L.dz(xb) - L.D * shape(xb);
      const A = { p: [xa, 0.5 - WY], m: [xa, 0.5 + WY] };
      const B = { p: [xb, 0.5 - WY], m: [xb, 0.5 + WY] };
      const P = (o, z) => [o[0], o[1], z];
      out.push(q([P(A.p, za + L.W), P(B.p, zb + L.W), P(B.m, zb + L.W), P(A.m, za + L.W)], L.mat));
      out.push(q([P(A.p, za - L.W), P(B.p, zb - L.W), P(B.p, zb + L.W), P(A.p, za + L.W)], L.mat));
      out.push(q([P(A.m, za + L.W), P(B.m, zb + L.W), P(B.m, zb - L.W), P(A.m, za - L.W)], L.mat));
    }
  }
  out.push('');
  out.push('# --- 吊弦 ×' + drops.length + ' ---');
  for (const p of drops) {
    const zc = HC + dz(p) - DC * shape(p), zm = HM + dz(p) - DM * shape(p);
    out.push('box ' + N(p - DROP_W) + ' ' + N(0.5 - DROP_W) + ' ' + N(zc) + '  '
      + N(p + DROP_W) + ' ' + N(0.5 + DROP_W) + ' ' + N(zm) + '   ' + C.m + ' top=' + C.m);
  }
  return { name, text: HDR(name, why, dz) + 'name      ' + name + '\ngroup     misc\nfootprint 1 1\nzmax      ' + N(HM + WM) + '\n\n' + out.join('\n') + '\n' };
}

/**
 * 斜向模型 —— **画在瓦片正中**：s = x+y ∈ [0.5,1.5]，t = x−y ≡ T0 ± DT，T0 = 0。
 *
 *   ⚠ 2026-10-02 从"贴 W 角"（T0 = 0.5）改成正中，核自 elrail_data.h:387-404：
 *     斜向只有 6 个槽位（WSO_EW_SHORT / NS_SHORT / EW_E / NS_S / EW_W / NS_N），
 *     **没有** NS_W/NS_E/EW_N/EW_S 之分 —— 引擎给 LEFT/RIGHT（UPPER/LOWER）
 *     用**同一个精灵**，靠包络盒 origin `(8,0)` / `(0,8)`（屏幕上 ±64 px = 半格）
 *     挪到左/右半轨。所以模型必须居中，否则引擎再挪一次就整条错半格。
 *   ⇒ 配套：模板里斜向那 6 条 **x 不补偿**（让引擎的半格平移生效）、
 *     **y 补偿**（掉 z 抬升 −8 px）⇒ 6 条全是 `−131, −101`。
 *
 * @param {(p:number)=>number} shape  p = 沿半格参数 0..1 → **单位**下垂 0..1
 */
function diagonal(name, why, shape, drops) {
  const out = [];
  const pt = (s, t) => [(s + t) / 2, (s - t) / 2];
  for (const L of LINES) {    out.push('# --- ' + L.tag + ' ---');
    for (let i = 0; i < SEG; i++) {
      const sa = 0.5 + i / SEG, sb = 0.5 + (i + 1) / SEG;
      const pa = i / SEG, pb = (i + 1) / SEG;
      const za = L.z - L.D * shape(pa), zb = L.z - L.D * shape(pb);
      const Am = pt(sa, T0 + DT), Ap = pt(sa, T0 - DT);
      const Bm = pt(sb, T0 + DT), Bp = pt(sb, T0 - DT);
      const P = (o, z) => [o[0], o[1], z];
      // 斜向绕序 = 直向那套的**镜像反序**（(s,t)→(x,y) 是镜像，det = −1/2）。
      // 映射：直向的 −y 侧 ↔ 这里的 t− 侧（Ap），+y 侧 ↔ t+ 侧（Am）。
      //   ⚠ 2026-10-02 修：上一版这里写反了方向，结果**所有面法线朝内**
      //     （out/check-normals.mjs 报接触线 15/15 面 n=(0,0,−1)、侧面 n=(∓0.71,±0.71,0)），
      //     斜向导线被整片背面剔除 ⇒ 实机里只剩 3 根吊弦在飘。
      out.push(q([P(Am, za + L.W), P(Bm, zb + L.W), P(Bp, zb + L.W), P(Ap, za + L.W)], L.mat));  // 顶面
      out.push(q([P(Ap, za + L.W), P(Bp, zb + L.W), P(Bp, zb - L.W), P(Ap, za - L.W)], L.mat));  // t− 侧
      out.push(q([P(Am, za - L.W), P(Bm, zb - L.W), P(Bm, zb + L.W), P(Am, za + L.W)], L.mat));  // t+ 侧
    }
  }
  out.push('');
  out.push('# --- 吊弦 ×' + drops.length + ' ---');
  for (const p of drops) {
    const s = 0.5 + p;
    const [cx, cy] = pt(s, T0);
    const zc = HC - DC * shape(p), zm = HM - DM * shape(p);
    out.push('box ' + N(cx - DROP_W) + ' ' + N(cy - DROP_W) + ' ' + N(zc) + '  '
      + N(cx + DROP_W) + ' ' + N(cy + DROP_W) + ' ' + N(zm) + '   ' + C.m + ' top=' + C.m);
  }
  return { name, text: HDR(name, why, () => 0) + 'name      ' + name + '\ngroup     misc\nfootprint 1 1\nzmax      ' + N(HM + WM) + '\n\n' + out.join('\n') + '\n' };
}

export function generateCatenary() {
  // 直向：3 种形状 × 3 种坡度（平/上/下）。形状函数的自变量一律是
  // **离杆位的归一距离 q**（q=0 在杆上，q=1 在跨中），再乘各自的 D：
  //   sw：杆在 x=1 ⇒ q = 1−x；ne：杆在 x=0 ⇒ q = x；short：两端都是杆（对称）
  const SHAPES = [
    ['sw', '2 格跨前半：杆在 S–W 端 x=1', (x) => arcHalf(1 - x), ''],
    ['ne', '2 格跨后半：杆在 N–E 端 x=0', (x) => arcHalf(x), ''],
    ['short', '1 格跨（两端都是杆）', (x) => arcShort(x), ''],
  ];
  // 三种坡度。dz(x) 是"沿格坐标 x → z 偏移"：
  //   平坡恒 0；坡道在**低端**用引擎补偿常量、往高端再加一个 RISE（跟着坡面斜）✓
  const ELEV = [
    ['', '平', () => 0],
    ['_up', '上坡（x=1 那头高）', (x) => UP_DZ + RISE * x],
    ['_down', '下坡（x=0 那头高）', (x) => DOWN_DZ + RISE * (1 - x)],
  ];
  const made = [];
  for (const [key, why, dip] of SHAPES) {
    for (const [suf, elName, dz] of ELEV) {
      made.push(straight('G1_wire_x_' + key + suf, why + '·' + elName, dip, DROP_S, linesAt(dz)));
    }
  }
  // 斜向三张（贴 W 角那条；斜线只有平瓦片，引擎给的 z_offset 全是 ELEVATION）。
  // 这里 p = s − 0.5 ∈ [0,1]，也就是"沿半格从 s=0.5 那头算起"。
  //
  // ⚠ **哪头是 N 端**（这一版刚倒过来，之前是反的）：
  //   引擎里 NS_W 的 bbox = (8,0,8,8)：dx∈[8,16] ⇒ x∈[0.5,1]、
  //   dy∈[0,8] ⇒ y∈[0,0.5]，正好贴 W 角 (1,0) ✓（dx↔我们的 x、dy↔我们的 y）。
  //   这条斜线两端是 (0.5,0)=s0.5 和 (1,0.5)=s1.5。引擎 N 角在 (0,0)、S 角 (16,16)，
  //   (8,0) 落在北边那条边上 ⇒ **s=0.5 那头是 N 端**。
  //   ⇒ n（杆在 N 端）q = p；s（杆在 S 端）q = 1−p。
  made.push(diagonal('G1_wire_ns_w_n', '斜向 2 格跨前半：杆在 N 端 (s=0.5)', (p) => arcHalf(p), DROP_D));
  made.push(diagonal('G1_wire_ns_w_s', '斜向 2 格跨后半：杆在 S 端 (s=1.5)', (p) => arcHalf(1 - p), DROP_D));
  made.push(diagonal('G1_wire_ns_w_short', '斜向 1 格跨（两端都是杆）', (p) => arcShort(p), DROP_D));
  for (const m of made) {
    const f = path.join(ROOT, 'models', m.name + '.model');
    fs.writeFileSync(f, m.text, 'utf8');
    log('  ✔ ' + rel(f).padEnd(40) + String(m.text.split('\n').length).padStart(4) + ' 行');
  }
  return made;
}

if (isMain(import.meta.url)) {
  log('生成接触网导线（6 个模型）：');
  generateCatenary();
  log('');
  log('  剖面   半弧 shape(q)=2q−q² · 短弧 shape(q)=4q(1−q)（单位形状 × 各自 D）');
  log('  下垂   接触线 ' + N(DC) + ' · 承力索 ' + N(DM) + '（1 格跨同深）');
  log('  坡道   RISE ' + N(RISE) + ' 格／格：上坡 ' + N(UP_DZ) + '→' + N(UP_DZ + RISE)
    + ' · 下坡 ' + N(DOWN_DZ + RISE) + '→' + N(DOWN_DZ) + '（低端 = 引擎补偿常量）');
  log('  槽位   直向 X=v0 / Y=v1；斜向 NS_W=v0 · EW_S=v1 · NS_E=v2 · EW_N=v3');
  log('');
  log('  下一步：make render → 更新 src/rails/templates.pnml → make check');
}
