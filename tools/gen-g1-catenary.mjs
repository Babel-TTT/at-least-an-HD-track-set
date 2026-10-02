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
//   半弧（2 格跨的一半，p=0 在杆位、p=1 在跨中）：
//       z(p) = z杆位 − D·(2p − p²)
//   短弧（1 格跨，两端都是杆）：
//       z(p) = z杆位 − D·4p(1−p)
//   D：接触线 0.0180 · 承力索 0.0550（人工裁定：**1 格跨同深**，不按 L² 缩）
//   `z杆位` 是「相对引擎给定原点」的 —— 引擎另外抬
//   `ELRAIL_ELEVATION = 10` 单位 = **0.2552 格**（elrail.cpp:1281），所以模型里
//   写 HC = 0.1448 / HM = 0.2448，游戏里才是 0.40 / 0.50 格。
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
const UP_DZ = -9 * UNIT;           // 上坡：引擎多抬 9 单位 ⇒ 内容降 9
const DOWN_DZ = +1 * UNIT;         // 下坡：引擎少抬 1 单位 ⇒ 内容升 1

const arcHalf = (p, D) => D * (2 * p - p * p);   // 2 格跨的一半
const arcShort = (p, D) => D * 4 * p * (1 - p);  // 1 格跨

// 两根线：接触线（下、细、深色）+ 承力索（上、粗、浅色）
const LINES = [
  { z: HC, D: DC, W: WC, mat: C.c, tag: '接触线（contact）' },
  { z: HM, D: DM, W: WM, mat: C.m, tag: '承力索（messenger）' },
];

/** 带 z 整体偏移的一组线（斜坡补偿用） */
const linesAt = (dz) => LINES.map((L) => ({ ...L, z: L.z + dz }));

const HDR = (name, why) =>
  '# =============================================================================\n'
  + '# ' + name + ' —— 接触网导线（' + why + '）\n'
  + '#\n'
  + '# 【本文件由 tools/gen-g1-catenary.mjs 生成，请勿手改】\n'
  + '#   接触线杆位 z=' + N(HC) + ' 下垂 ' + N(DC) + ' · 承力索杆位 z=' + N(HM) + ' 下垂 ' + N(DM) + '\n'
  + '#   （模型里的 z 是"相对引擎原点"的；引擎另外抬 ELRAIL_ELEVATION = 0.2552 格）\n'
  + '#   竖直半厚：接触线 ' + N(WC) + ' · 承力索 ' + N(WM) + '；' + SEG + ' 段折线\n'
  + '# =============================================================================\n\n';

const q = (pts, mat) => 'quad ' + pts.map(([x, y, z]) => N(x) + ' ' + N(y) + ' ' + N(z)).join('  ') + '   ' + mat;

/**
 * 直向模型（沿瓦片 x 轴，横向 ±y）
 * @param {(p:number)=>number} dip  p = 沿格参数 0..1 → 下垂量
 * @param {number[]} drops         吊弦的沿格位置
 */
function straight(name, why, dip, drops, lines = LINES) {
  const out = [];
  for (const L of lines) {
    out.push('# --- ' + L.tag + ' ---');
    for (let i = 0; i < SEG; i++) {
      const xa = i / SEG, xb = (i + 1) / SEG;
      const za = L.z - dip(xa), zb = L.z - dip(xb);
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
    const zc = HC - dip(p), zm = HM - dip(p);
    out.push('box ' + N(p - DROP_W) + ' ' + N(0.5 - DROP_W) + ' ' + N(zc) + '  '
      + N(p + DROP_W) + ' ' + N(0.5 + DROP_W) + ' ' + N(zm) + '   ' + C.m + ' top=' + C.m);
  }
  return { name, text: HDR(name, why) + 'name      ' + name + '\ngroup     misc\nfootprint 1 1\nzmax      ' + N(HM + WM) + '\n\n' + out.join('\n') + '\n' };
}

/**
 * 斜向模型（贴 W 角那条：s = x+y ∈ [0.5,1.5]，t = x−y ≡ 0.5 ± DT）
 * @param {(p:number)=>number} dip  p = 沿半格参数 0..1 → 下垂量
 */
function diagonal(name, why, dip, drops) {
  const out = [];
  const pt = (s, t) => [(s + t) / 2, (s - t) / 2];
  for (const L of LINES) {    out.push('# --- ' + L.tag + ' ---');
    for (let i = 0; i < SEG; i++) {
      const sa = 0.5 + i / SEG, sb = 0.5 + (i + 1) / SEG;
      const pa = i / SEG, pb = (i + 1) / SEG;
      const za = L.z - dip(pa), zb = L.z - dip(pb);
      const Am = pt(sa, 0.5 + DT), Ap = pt(sa, 0.5 - DT);
      const Bm = pt(sb, 0.5 + DT), Bp = pt(sb, 0.5 - DT);
      const P = (o, z) => [o[0], o[1], z];
      // 注意：斜向绕序与直向**相反**（(s,t)→(x,y) 是镜像）
      out.push(q([P(Ap, za + L.W), P(Bp, zb + L.W), P(Bm, zb + L.W), P(Am, za + L.W)], L.mat));
      out.push(q([P(Am, za + L.W), P(Bm, zb + L.W), P(Bm, zb - L.W), P(Am, za - L.W)], L.mat));
      out.push(q([P(Ap, za - L.W), P(Bp, zb - L.W), P(Bp, zb + L.W), P(Ap, za + L.W)], L.mat));
    }
  }
  out.push('');
  out.push('# --- 吊弦 ×' + drops.length + ' ---');
  for (const p of drops) {
    const s = 0.5 + p;
    const [cx, cy] = pt(s, 0.5);
    const zc = HC - dip(p), zm = HM - dip(p);
    out.push('box ' + N(cx - DROP_W) + ' ' + N(cy - DROP_W) + ' ' + N(zc) + '  '
      + N(cx + DROP_W) + ' ' + N(cy + DROP_W) + ' ' + N(zm) + '   ' + C.m + ' top=' + C.m);
  }
  return { name, text: HDR(name, why) + 'name      ' + name + '\ngroup     misc\nfootprint 1 1\nzmax      ' + N(HM + WM) + '\n\n' + out.join('\n') + '\n' };
}

export function generateCatenary() {
  // 直向：3 种形状 × 3 种坡度（平/上/下）。dip 的自变量一律是"离杆位多远"：
  //   sw：杆在 x=1 ⇒ p = 1−x；ne：杆在 x=0 ⇒ p = x；short：两端都是杆（对称）
  const SHAPES = [
    ['sw', '2 格跨前半：杆在 S–W 端 x=1', (p) => arcHalf(1 - p, DC), ''],
    ['ne', '2 格跨后半：杆在 N–E 端 x=0', (p) => arcHalf(p, DC), ''],
    ['short', '1 格跨（两端都是杆）', (p) => arcShort(p, DC), ''],
  ];
  const ELEV = [
    ['', '平', 0],
    ['_up', '上坡', UP_DZ],
    ['_down', '下坡', DOWN_DZ],
  ];
  const made = [];
  for (const [key, why, dip] of SHAPES) {
    for (const [suf, elName, dz] of ELEV) {
      made.push(straight('G1_wire_x_' + key + suf, why + '·' + elName, dip, DROP_S, linesAt(dz)));
    }
  }
  // 斜向三张（贴 W 角那条；斜线只有平瓦片，引擎给的 z_offset 全是 ELEVATION）。
  // 自变量是"沿半格离杆位多远"：
  //   n：杆在 N 端（s=0.5）；s：杆在 S 端（s=1.5）；short：对称
  made.push(diagonal('G1_wire_ns_w_n', '斜向 2 格跨前半：杆在 N 端', (p) => arcHalf(1 - p, DC), DROP_D));
  made.push(diagonal('G1_wire_ns_w_s', '斜向 2 格跨后半：杆在 S 端', (p) => arcHalf(p, DC), DROP_D));
  made.push(diagonal('G1_wire_ns_w_short', '斜向 1 格跨（两端都是杆）', (p) => arcShort(p, DC), DROP_D));
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
  log('  剖面   半弧 z(p)=z端−D(2p−p²) · 短弧 z(p)=z端−D·4p(1−p)');
  log('  下垂   接触线 ' + N(DC) + ' · 承力索 ' + N(DM) + '（1 格跨同深）');
  log('  槽位   直向 X=v0 / Y=v1；斜向 NS_W=v0 · EW_S=v1 · NS_E=v2 · EW_N=v3');
  log('');
  log('  下一步：make render → 更新 src/rails/templates.pnml → make check');
}
