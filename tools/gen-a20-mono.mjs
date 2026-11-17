// =============================================================================
// tools/gen-a20-mono.mjs —— 生成 **A20（`MONO` 跨座式单轨）** 与
//                              **A21（`MGLV` 磁浮）** 的模型
//
//   node tools/gen-a20-mono.mjs
//
// 人工 2026-11-18 指示「弄单轨和磁悬浮」= 按铁律 L3 批准新建本生成器；
// **只写 `models/G23_*.model`（A20）与 `models/G24_*.model`（A21）**。
//
// -----------------------------------------------------------------------------
// 【口径（`美术要素方案.md` §1 的三行 + §2 第 33/34 行）】
//
//   A20 `MONO` 跨座式单轨（重庆单轨）：
//     道床 **`BAL-L`** = 「混凝土梁体 + 走行面，**无道床无枕**」
//     轨枕 **`SLE-6`** = 「导向轮组 / 悬浮架 —— 无枕木，只有机械装置」
//     钢轨 **`RAI-8`** = 「单轨 / 磁浮走行面 —— **无传统钢轨**」
//     洞口 **`TUN-9`** = 「**无（高架）** —— 不做隧道口」
//     电气化 **`EL-NONE`**（供电轨在梁侧）
//   A21 `MGLV` 磁浮（上海磁浮）：
//     道床 **`BAL-M`** = 「梁体 + 导向面 + 定子铁芯缝」
//     其余同上（`SLE-6` / `RAI-8` / `TUN-9` / `EL-NONE`）
//
// -----------------------------------------------------------------------------
// 【核心想法：梁体 = 「把 G1 的道砟板带**横向压窄**再**抬成实体**」】
//
//   这两族与前面 24 个组完全不同 —— 它们**没有道砟、没有枕木、没有钢轨**，
//   整条轨道就是一个**混凝土梁体**。但梁体的**平面轮廓**恰好就是 G1 的道砟板带：
//   直线是 0.36 宽的带、斜向是切角的带、交叉 / 三向 / 四向是并集板 —— 全部实机调过十几轮。
//
//   ⇒ 不去重算 OpenTTD 的轨道几何（那是最容易错的地方），而是：
//     ① 只取源模型的 **`gravel` 面**（= 道砟板带，高度场那层网格）；
//     ② 用与 `gen-a15-narrow.mjs` **同一套横向映射**把它压窄到梁宽（k 见下表）；
//     ③ **丢掉源里所有的 z**，改成「顶面 = 地面 + T」的平板（坡道按 `z(x) = RISE·(1−x)` 抬）；
//     ④ 从板带的**边界棱**（只被一个面用到的棱）自动生成两侧的**墙**。
//   ⇒ 交叉 / 三向 / 四向 / 斜向的梁体全部**自动**得到，一行几何都不用手算。
//
//   ① 的判据：`gravel` 只出现在道砟板带里（G1 里道砟就是 `gravel`，枕木是 `wood_*`、
//   钢轨是 `rust`、坡脚散粒是 `stone_dark`）⇒ 按材质筛是干净的。
//
// -----------------------------------------------------------------------------
//【数字（1 m = 0.0731 格，见 `美术要素方案.md` §1.1 的换算锚点）】
//
//                   梁宽 k          T（梁体可见高度）   材料（顶 / 侧 / 底裙）
//   A20 `BAL-L`  0.85 m ⇒ k=0.17  0.45 m ⇒ T=0.0320    concrete_mid / concrete / trim_dark
//   A21 `BAL-M`  2.40 m ⇒ k=0.48  0.50 m ⇒ T=0.0360    concrete_mid / metal_dark / metal_seam
//
//   ⚠ **梁体为什么只有 0.45 m 高**：现实里的单轨梁高 1.5 m、磁浮梁 ~1.2 m —— 但本管线
//     只能把轨道画在**地面高度**上，而 OpenTTD 的车辆精灵是**按地面高度**画的。
//     梁体一旦超过约 0.05 格（0.7 m），车就会"陷进梁里"。⇒ 取 0.45/0.50 m，
//     读作「地面上的导向梁」，也是原版 MONO / MGLV 轨道的观感口径。
//
//   ⚠ **`SLE-6` 本轮不画**：单轨的导向轮组装在**车上**、梁上每 25 m 才一道接缝（1.8 格，
//     逐格贴图表达不了）；磁浮的定子铁芯每 1.2 m 一块（0.088 格 ≈ 1.2 px @4x，
//     一格 11 块）—— 两者在本尺度都画不出且会把梁面弄脏。已登记待人工裁。
//
//   ⚠ **`RAI-8` 也不单独出图**：梁顶面本身就是走行面。⇒ `underlay` 与 `track_overlay`
//     共用**同一批模型**（前面的组里这两层不同，是因为 underlay 有道床、overlay 只有钢轨）。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { ROOT, log, rel, isMain } from './util.mjs';

// ---------------------------------------------------------------- 口径常量
const RISE = 0.2041;        // 一格坡道抬高（与 gen-g1-slope / gen-a15-narrow 同源）
const OVER = 0.03125;       // 沿轨探出（1/32 格，与 gen-a15-narrow 同口径）
const CROSS_EDGE = 0.195;   // 交叉/道岔：判"这一维属于哪条带"的阈值
const SKIRT_H = 0.0035;     // 底裙（暗色收头）的高度

/**
 * 两族。`k` = 梁宽相对「G1 道砟板带 0.36 格」的横向比例；`T` = 梁体可见高度。
 * `mat` = 顶面 / 侧面 / 底裙三种材质。
 */
const FAMS = [
  {
    id: 'A20', prefix: 'G23', code: 'MONO', bed: 'BAL-L', sleeper: 'SLE-6', rail: 'RAI-8',
    label: '跨座式单轨（重庆单轨）· PC 轨道梁',
    k: 0.17, T: 0.0320,
    mat: { top: 'concrete_mid', side: 'concrete', skirt: 'trim_dark' },
    beamW: '0.85 m', beamH: '0.45 m',
  },
  {
    id: 'A21', prefix: 'G24', code: 'MGLV', bed: 'BAL-M', sleeper: 'SLE-6', rail: 'RAI-8',
    label: '磁浮（上海磁浮）· 高架导向梁',
    k: 0.48, T: 0.0360,
    mat: { top: 'concrete_mid', side: 'metal_dark', skirt: 'metal_seam' },
    beamW: '2.40 m', beamH: '0.50 m',
  },
];

/**
 * 作业表：源模型的**道砟板带** → 梁体。
 *   `kind` 与 `gen-a15-narrow.mjs` 同义（y / diag / slope / cross），
 *   决定横向是哪一维、以及坡道要不要按 RISE 抬。
 *   ⚠ 这里**不产** track_half 的镜像件、也不产 levelcrossing（单轨/磁浮不做平交道口）。
 */
const JOBS = [
  { src: 'probe_track_x', dst: 'track_x', kind: 'y', over: true,
    note: 'underlay 槽 0/1 + overlay 槽 0/1（RTO_X / RTO_Y）：整格梁体' },
  { src: 'probe_half_upper', dst: 'track_half', kind: 'diag', over: true,
    note: 'underlay / overlay 槽 2-5（RTO_N / S / E / W）：切 N 角的半格梁体' },
  { src: 'probe_track_x', dst: 'track_slope', kind: 'slope', over: false,
    note: 'underlay / overlay 槽 6-9：坡道梁体（顶面沿 z(x) = RISE·(1−x) 抬）' },
  { src: 'G1_crossing', dst: 'crossing', kind: 'cross', over: true, edge: CROSS_EDGE,
    note: 'underlay 槽 10（RTO_CROSSING_XY）：十字，两条梁体并集' },
  { src: 'G1_junction3', dst: 'junction3', kind: 'cross', over: true, edge: CROSS_EDGE,
    note: 'underlay 槽 11-14：三向（只有梁体枢纽板，各方向的梁由 overlay 画）' },
  { src: 'G1_junction4', dst: 'junction4', kind: 'cross', over: true, edge: CROSS_EDGE,
    note: 'underlay 槽 15：四向（同上）' },
];

// ---------------------------------------------------------------- 顶点变换
const N = (v) => Number(v.toFixed(4));
const near0 = (v) => v <= 1e-4;
const near1 = (v) => v >= 1 - 1e-4;
const S = (v) => String(N(v));

/** 碰到瓦片边就向外让开 OVER（否则 0）—— 与 gen-a15-narrow 同一个「盖瓦片接缝」口径 */
function ext(v) {
  if (near0(v)) return -OVER;
  if (near1(v)) return OVER;
  return 0;
}

/**
 * 把源顶点 (x,y) 压到梁体位置的**横向映射**（与 `gen-a15-narrow.mjs` 的 `xform` 逐分支同构，
 * 只把 k 换成各族的 `belt.k`）。
 * @returns {[number, number, number]} [x', y', 地面 z]  —— 地面 z 只有坡道不为 0
 */
function place(fam, job, x, y) {
  const k = fam.k;
  const shrink = (c) => 0.5 + k * (c - 0.5);
  switch (job.kind) {
    case 'y':
      return [N(x + (job.over ? ext(x) : 0)), N(shrink(y)), 0];
    case 'slope':
      return [N(x), N(shrink(y)), RISE * (1 - x)];
    case 'diag': {
      const s = (k - 1) * ((x + y) - 0.5) / 2;
      let nx = x + s, ny = y + s;
      if (job.over) {
        const d = OVER / Math.SQRT2;
        if (near0(y)) { nx += d; ny -= d; }
        if (near0(x)) { nx -= d; ny += d; }
        if (near1(y)) { nx -= d; ny += d; }
        if (near1(x)) { nx += d; ny -= d; }
      }
      // ⚠ 斜向件的**梁端**会被这个映射推出瓦片：横向映射沿 (1,1) 走，(1−k) 越大推得越远
      //   （本例 k = 0.17 ⇒ 顶点 (0.65,0) 落到 y = −0.084，超过 flatiso 的 1/16 允许出界）。
      //   ⇒ 夹回 [−OVER, 1+OVER]：等价于「梁端沿瓦片边切齐」，也是相邻两格对接该有的样子。
      nx = Math.min(Math.max(nx, -OVER), 1 + OVER);
      ny = Math.min(Math.max(ny, -OVER), 1 + OVER);
      return [N(nx), N(ny), 0];
    }
    case 'cross': {
      const edge = job.edge ?? CROSS_EDGE;
      const nx = Math.abs(x - 0.5) <= edge ? shrink(x) : x;
      const ny = Math.abs(y - 0.5) <= edge ? shrink(y) : y;
      return [N(nx + (job.over ? ext(x) : 0)), N(ny + (job.over ? ext(y) : 0)), 0];
    }
    default:
      throw new Error(`未知 kind: ${job.kind}`);
  }
}

// ---------------------------------------------------------------- 板带 → 梁体
const FACE_KW = /^(quad|box)$/;
const matOf = (t) => (t[0] === 'quad' ? t[13] : t[7]);

/** 读源模型里 `gravel` 面的顶点表（按原环绕方向），非 gravel / 非四边形一律丢掉
 *
 *  ⚠ `cross` 类（十字 / 三向 / 四向）的源板带是**整块大板**（三向 = 矩形+梯形、四向 = 正八边形），
 *  不是两条带的并集 ⇒ 照着压窄只会把中间两条带缩小、四周留下 0.36 宽的板
 *  （实测：一个整瓦片的混凝土大台子）。所以先按**轨道带**过滤：只留下重心落在
 *  `|x−0.5| ≤ BAND` 或 `|y−0.5| ≤ BAND` 的面 —— 剩下正好是"十字形"的骨架，
 *  再压窄就是各方向梁体的并集（各方向的梁本来也会被 overlay 再画一遍）。
 */
const BAND = 0.185;
function plateOf(srcPath, job) {
  const faces = [];
  for (const raw of fs.readFileSync(srcPath, 'utf8').split('\n')) {
    const t = raw.trim().split(/\s+/);
    if (!FACE_KW.test(t[0])) continue;
    if (matOf(t) !== 'gravel') continue;
    if (t[0] === 'box') {
      // box 只在源里表示"整块板"，取它的四个角（俯视）
      const [x0, y0] = [Number(t[1]), Number(t[2])];
      const [x1, y1] = [Number(t[4]), Number(t[5])];
      faces.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    } else {
      const p = [];
      for (let i = 0; i < 4; i++) p.push([Number(t[1 + i * 3]), Number(t[2 + i * 3])]);
      faces.push(p);
    }
  }
  if (job.kind !== 'cross') return faces;
  const kept = faces.filter((p) => {
    const cx = p.reduce((s, q) => s + q[0], 0) / 4;
    const cy = p.reduce((s, q) => s + q[1], 0) / 4;
    return Math.abs(cx - 0.5) <= BAND || Math.abs(cy - 0.5) <= BAND;
  });
  return kept;
}

const vkey = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;

/**
 * 板带 → 梁体实体：顶面 + 两侧墙 + 底裙。
 *
 * 墙的环绕方向：源板带的顶面是**从外侧看逆时针**（`core/mesh.mjs` 的口径），
 * ⇒ 沿边界棱 a→b 走时外侧在**右手边**，外法线 = (dy, −dx)。
 * ⇒ 侧墙按 `a底 → b底 → b顶 → a顶` 排列正好是「从外侧看逆时针」，不用再猜。
 */
function beamOf(fam, job, plate) {
  const T = fam.T;
  const V = plate.map((quad) => quad.map(([x, y]) => {
    const [nx, ny, gz] = place(fam, job, x, y);
    return { x: nx, y: ny, gz, key: `${nx.toFixed(4)},${ny.toFixed(4)}` };
  }));

  const out = [];
  const quad = (p0, p1, p2, p3, mat) => {
    out.push(`quad ${S(p0[0])} ${S(p0[1])} ${S(p0[2])}  ${S(p1[0])} ${S(p1[1])} ${S(p1[2])}`
      + `  ${S(p2[0])} ${S(p2[1])} ${S(p2[2])}  ${S(p3[0])} ${S(p3[1])} ${S(p3[2])}   ${mat}`);
  };

  // ① 顶面（保留源的环绕方向；z 换成「地面 + T」）
  for (const q of V) {
    quad(
      [q[0].x, q[0].y, q[0].gz + T], [q[1].x, q[1].y, q[1].gz + T],
      [q[2].x, q[2].y, q[2].gz + T], [q[3].x, q[3].y, q[3].gz + T], fam.mat.top,
    );
  }

  // ② 边界棱 → 两侧墙 + 底裙
  //
  //   ⚠ **不能只按「这条棱只被用了一次」判边界**：`G1_track_slope` 的板带是分条拼的
  //   （实测 419 条棱里有 **198 条只出现一次**，而真正的外轮廓只有 ~74 条），
  //   照那个判据会在梁面上立起 120 多片**内部竖鳍**。
  //   ⇒ 再加一道**严格包含**测试：若某条棱的中点**严格落在另一个板面内部**，它就是内部缝，
  //     不是轮廓（真轮廓的中点只会落在别人的*边*上，不会严格在内部）。
  const insideAny = (px, py, skip) => {
    for (let qi = 0; qi < V.length; qi++) {
      if (qi === skip) continue;
      const q = V[qi];
      let ok = true;
      for (let i = 0; i < 4 && ok; i++) {
        const a = q[i], b = q[(i + 1) % 4];
        const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
        if (!(cross > 1e-7)) ok = false;          // 板面是 CCW ⇒ 严格内部要求四边都 > 0
      }
      if (ok) return true;
    }
    return false;
  };

  const edges = new Map();          // key → { a, b, n, face }
  for (let fi = 0; fi < V.length; fi++) {
    const q = V[fi];
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      if (a.key === b.key) continue;
      const kk = a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
      const hit = edges.get(kk);
      if (hit) hit.n++;
      else edges.set(kk, { a, b, n: 1, face: fi });
    }
  }
  let walls = 0, dropped = 0;
  for (const e of edges.values()) {
    if (e.n !== 1) continue;
    const { a, b } = e;
    // 中点是否严格落在某个板面内部 ⇒ 内部缝
    if (insideAny((a.x + b.x) / 2, (a.y + b.y) / 2, e.face)) { dropped++; continue; }
    const sk = (p, dz) => [p.x, p.y, p.gz + dz];
    // 底裙（下段，暗色收头）
    quad(sk(a, 0), sk(b, 0), sk(b, SKIRT_H), sk(a, SKIRT_H), fam.mat.skirt);
    // 主墙（上段）
    quad(sk(a, SKIRT_H), sk(b, SKIRT_H), sk(b, T), sk(a, T), fam.mat.side);
    walls++;
  }
  return { lines: out, walls, dropped };
}

// ---------------------------------------------------------------- 主流程
function headerFor(fam, job, dst, stats) {
  return [
    '# =============================================================================',
    `# ${dst} —— ${fam.id} 组（\`${fam.code}\` ${fam.label}）· ${job.note}`,
    '#',
    '# 【本文件由 tools/gen-a20-mono.mjs 生成，请勿手改】',
    `#   源 = models/${job.src}.model 里的 **gravel 板带**（= G1 的道砟平面轮廓，实机调过）`,
    `#   板带 → 梁体：横向压窄 k = ${fam.k}（梁宽 ${fam.beamW}）、顶面抬到地面 + ${fam.T}（梁高 ${fam.beamH}）`,
    `#   材料：顶 ${fam.mat.top} / 侧 ${fam.mat.side} / 底裙 ${fam.mat.skirt}（裙高 ${SKIRT_H}）`,
    `#   ${fam.bed} = 本组道床；${fam.sleeper} 与 ${fam.rail} **不出图**（梁顶即走行面），`,
    '#     理由见本工具文件头的两条 ⚠。',
    '#',
    `# 自检：源 gravel 面 ${stats.faces} 个 → 顶面 ${stats.faces} + 侧墙 ${stats.walls * 2}（含底裙）；`
      + `模型空间 bbox x[${stats.x0}, ${stats.x1}] y[${stats.y0}, ${stats.y1}] z 到 ${stats.zmax}`,
    '# =============================================================================',
    '',
  ].join('\n');
}

export function generate() {
  const files = [];
  for (const fam of FAMS) {
    for (const job of JOBS) {
      const dst = `${fam.prefix}_${job.dst}`;
      const srcFile = path.join(ROOT, 'models', `${job.src}.model`);
      if (!fs.existsSync(srcFile)) {
        log(`  × 跳过 ${dst}：源 ${job.src}.model 不存在`);
        continue;
      }
      const plate = plateOf(srcFile, job);
      if (!plate.length) {
        log(`  × 跳过 ${dst}：${job.src} 里没有 gravel 板带`);
        continue;
      }
      const { lines, walls } = beamOf(fam, job, plate);

      // 自检用：模型空间 bbox + zmax
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, zm = 0;
      for (const line of lines) {
        const n = line.trim().split(/\s+/).slice(1, 13).map(Number);
        for (let i = 0; i < 4; i++) {
          x0 = Math.min(x0, n[i * 3]); x1 = Math.max(x1, n[i * 3]);
          y0 = Math.min(y0, n[i * 3 + 1]); y1 = Math.max(y1, n[i * 3 + 1]);
          zm = Math.max(zm, n[i * 3 + 2]);
        }
      }

      const out = path.join(ROOT, 'models', `${dst}.model`);
      const text = headerFor(fam, job, dst, {
        faces: plate.length, walls, x0: N(x0), x1: N(x1), y0: N(y0), y1: N(y1), zmax: N(zm),
      })
        + `name      ${dst}\ngroup     misc\nfootprint 1 1\nzmax      ${N(zm).toFixed(4)}\n\n`
        + lines.join('\n') + '\n';
      fs.writeFileSync(out, text, 'utf8');
      files.push(out);
      log(`  → ${rel(out).padEnd(34)} 面 ${String(lines.length).padStart(4)}`
        + `（板 ${String(plate.length).padStart(3)} + 侧墙 ${String(walls * 2).padStart(3)}）`
        + `  bbox x[${N(x0)}, ${N(x1)}] y[${N(y0)}, ${N(y1)}] zmax ${N(zm).toFixed(4)}`);
    }
  }
  return files;
}

if (isMain(import.meta.url)) {
  const t0 = Date.now();
  log('生成 A20（MONO 跨座式单轨）/ A21（MGLV 磁浮）模型：梁体 = G1 道砟板带压窄 + 抬成实体');
  const files = generate();
  log(`✔ 生成 ${files.length} 个模型，用时 ${((Date.now() - t0) / 1000).toFixed(2)} s`);
  log('  下一步：make render → 抄模板 → make check');
}
