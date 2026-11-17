// =============================================================================
// tools/gen-a16-narrow-modern.mjs —— 生成 A16 组（`NBCN` / `NBCA` 现代窄轨）的模型
//
//   node tools/gen-a16-narrow-modern.mjs
//
// 人工 2026-11-17 批准新建（铁律 L3 的申请；人工原话：「轨距按照1000 柱子按原来的，继续」）。
// **只写 `models/G14_*.model`**。
//
// -----------------------------------------------------------------------------
// 【口径】
//
//   覆盖两条：
//     `NBCN` 现代窄轨铁路 · 1930 · 130km/h · 23t · 非电
//     `NBCA` 电气化窄轨铁路 · 25kV AC · 1950 · 130km/h · 23t（**同一套几何**，只多接触网）
//
//   A16 = 道床 **`BAL-D`** + 轨枕 **`SLE-2`** + 钢轨 **`RAI-7`** + 洞口 **`TUN-7`**
//        + 电气化（仅 `NBCA`）**`EL-25` + `PYL-C2`**（人工 2026-11-17：「柱子按原来的」）
//
//   ★ **与 A15（`NACN`）的唯一差别就是轨枕**：`SLE-1` 木枕 → `SLE-2` 混凝土枕（Ⅱ型，
//     横断面带 U 形承轨槽）。道床 / 钢轨 / 洞口**逐面相同**（都是 k = 0.70 的米轨 1000mm 口径）。
//
// -----------------------------------------------------------------------------
// 【做法：不重画，做两次「已收窄的现成几何」的拼装】
//
//   ① 底板 = **A15 的产物**（`models/G5_*.model`）—— 它就是「G1 的几何按 k = 0.70 收窄」，
//      实机调过的道砟 / 坡度 / 岔口并集 / 洞门全都在里面，**一个数都不用重算**。
//   ② 枕木 = **A3 的产物**（`models/G3_*.model`）里的 **`SLE-2` 那一层** —— 用 A15 同一套
//      `xform()` 把它收窄，再顶掉 A15 里的 `SLE-1`。
//
//   ⇒ 判据是**材质**（实测，见文件末尾的表）：
//        A15 的 `SLE-1` = `wood_dark` / `wood_seam`（**只有枕木用**，道床是 `gravel`）
//        A3  的 `SLE-2` = `concrete` / `concrete_seam` / `trim_dark`
//        ⚠ 但只有**轨道类**模型能这么筛 —— `G3_tunnel3*` 的**洞门也是 `concrete`**
//          （TUN-3 是混凝土洞门）⇒ 洞口的枕木改用 `G3_track_x` 那份**直的** `SLE-2`：
//          实测 TUN-1 / TUN-7 的洞内轨道是**平的**（道砟 z 0.0005~0.0061、枕木 z 0~0.01、
//          y 0.41~0.59），与 `G3_track_x` 的枕木**完全对得上**；
//          而且 A/B 两半的轨道层**逐面相同**（引擎一次只取其中一张）⇒ 不用按 y = 0.5 切。
//
//   ⚠ **为什么不从 A3 直接收窄**：A3 的道床是 `BAL-A`（平断面）、洞口是 `TUN-3`（混凝土），
//     而 A16 要的是 `BAL-D` + `TUN-7`（石砌、窄断面拱）—— 只有「枕木那一层」该借 A3。
//
// -----------------------------------------------------------------------------
// 【收窄变换：与 tools/gen-a15-narrow.mjs **逐字同源**】
//
//     kind 'y'      直线 / 坡道 / 道口 / 洞内轨道：y' = 0.5 + k·(y − 0.5)
//     kind 'diag'   斜向半格（轨道线 x + y = 0.5）：(x,y) 各挪 (k−1)(x+y−0.5)/2
//     kind 'cross'  交叉 / 三向 / 四向：逐坐标判 |x−0.5| ≤ 0.195 / |y−0.5| ≤ 0.195
//     探出边界：沿轨两端各 OVER（1/32 格）；坡道不探（见 gen-a15-narrow.mjs 文件头）
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { ROOT, log, rel, isMain } from './util.mjs';

// ---------------------------------------------------------------- 口径常量（同 A15）
const K = 0.70;              // 横向收窄比例（米轨 1000mm）
const OVER = 0.03125;        // 沿轨探出（1/32 格）
const CROSS_EDGE = 0.195;    // 交叉/道岔：判"这一维属于哪条带"的阈值
const ARCH_EDGE = 0.160;     // 隧道：拱洞那一段的横向半径（本工具只用于 transform 的一致性）
const RAIL_EDGE_TOL = 0.001;
const RAIL_MAT = /^rust$/;

/** A15 里属于 `SLE-1`（木枕）的材质 —— 要删掉的那一层 */
const SLE1_MAT = /^wood(_dark|_seam)?$/;
/** A3 里属于 `SLE-2`（混凝土枕）的材质 —— 要借过来的那一层 */
const SLE2_MAT = /^(concrete|concrete_seam|trim_dark)$/;

/**
 * 作业表：A15 产物（底板） → A16 产物；`kind/over/edge` 与 gen-a15-narrow.mjs 的同一件**必须一致**
 * （借来的 SLE-2 要用同一套变换收窄）；`sleeper` = 借枕木的 A3 模型（`null` = 这件本来就没有枕木）。
 */
const JOBS = [
  { from: 'G5_track_x', dst: 'G14_track_x', kind: 'y', over: true, sleeper: 'G3_track_x', alt: 'G3_track_x',
    note: 'underlay 槽 0/1（RTO_X / RTO_Y）：道床 BAL-D + SLE-2 混凝土枕 + 两根轨（完整画面）' },
  { from: 'G5_rail_straight', dst: 'G14_rail_straight', kind: 'y', over: true, sleeper: 'G3_rail_straight',
    note: 'overlay 槽 0/1：钢轨层（透明底，只有钢轨 + 枕木）' },
  { from: 'G5_track_half', dst: 'G14_track_half', kind: 'diag', over: true, sleeper: 'G3_track_half',
    note: 'underlay 槽 2-5（RTO_N / S / E / W）：切 N 角的半格轨' },
  { from: 'G5_rail_half', dst: 'G14_rail_half', kind: 'diag', over: true, sleeper: 'G3_rail_half',
    note: 'overlay 槽 2-5：半格轨的钢轨层' },
  { from: 'G5_track_slope', dst: 'G14_track_slope', kind: 'y', over: false, sleeper: 'G3_track_slope',
    note: 'underlay 槽 6-9：坡道（z 已含 RISE，只横向收窄，沿轨不探出）' },
  { from: 'G5_rail_slope', dst: 'G14_rail_slope', kind: 'y', over: false, sleeper: 'G3_rail_slope',
    note: 'overlay 槽 6-9：坡道的钢轨层' },
  { from: 'G5_crossing', dst: 'G14_crossing', kind: 'cross', over: true, edge: CROSS_EDGE, sleeper: 'G3_crossing',
    note: 'underlay 槽 10（RTO_CROSSING_XY）：交叉，自带两组钢轨' },
  { from: 'G5_junction3', dst: 'G14_junction3', kind: 'cross', over: true, edge: CROSS_EDGE, sleeper: null,
    note: 'underlay 槽 11-14：三向道岔（只有道床板，没有枕木）' },
  { from: 'G5_junction4', dst: 'G14_junction4', kind: 'cross', over: true, edge: CROSS_EDGE, sleeper: null,
    note: 'underlay 槽 15：四向道岔（只有道床板）' },
  { from: 'G5_levelcrossing', dst: 'G14_levelcrossing', kind: 'y', over: true, sleeper: 'G3_levelcrossing',
    note: 'level_crossings 的轨道图（取图 v0 → X 槽、v3 → Y 槽）' },
  // ---- 洞口 TUN-7（石砌小断面拱）：枕木借 `G3_track_x` 那份**直的** SLE-2 ----
  { from: 'G5_tunnel7', dst: 'G14_tunnel7', kind: 'y', over: true, sleeper: 'G3_track_x',
    note: 'tunnels: 组（A 组：远半）—— 洞内道床/枕木/钢轨/暗幕 + 翼墙 + 洞门远半' },
  { from: 'G5_tunnel7_b', dst: 'G14_tunnel7_b', kind: 'y', over: true, sleeper: 'G3_track_x',
    note: 'tunnels: 组（B 组：近半）' },
  { from: 'G5_tunnel7_over', dst: 'G14_tunnel7_over', kind: 'y', over: true, sleeper: null,
    note: 'tunnel_overlay: 组（A 组：近半 + 洞顶）—— 不含轨道，逐字照抄 A15' },
  { from: 'G5_tunnel7_over_b', dst: 'G14_tunnel7_over_b', kind: 'y', over: true, sleeper: null,
    note: 'tunnel_overlay: 组（B 组：远半 + 洞顶）—— 逐字照抄 A15' },
];

// ---------------------------------------------------------------- 顶点变换（同 A15）
const N = (v) => Number(v.toFixed(4));
const near0 = (v) => v <= 1e-4;
const near1 = (v) => v >= 1 - 1e-4;
function ext(v) {
  if (near0(v)) return -OVER;
  if (near1(v)) return OVER;
  return 0;
}
function railExt(v) {
  if (v <= RAIL_EDGE_TOL) return -OVER;
  if (v >= 1 - RAIL_EDGE_TOL) return OVER;
  return 0;
}
const narrow = (c) => 0.5 + K * (c - 0.5);

function xform(job, x, y, mat) {
  switch (job.kind) {
    case 'y':
      return [N(x + (job.over ? ext(x) : 0)), N(narrow(y))];
    case 'diag': {
      const s = (K - 1) * ((x + y) - 0.5) / 2;
      let nx = x + s, ny = y + s;
      if (job.over) {
        const d = OVER / Math.SQRT2;
        if (near0(y)) { nx += d; ny -= d; }
        if (near0(x)) { nx -= d; ny += d; }
        if (near1(y)) { nx -= d; ny += d; }
        if (near1(x)) { nx += d; ny -= d; }
      }
      return [N(nx), N(ny)];
    }
    case 'cross': {
      let nx = Math.abs(x - 0.5) <= (job.edge ?? CROSS_EDGE) ? narrow(x) : x;
      let ny = Math.abs(y - 0.5) <= (job.edge ?? CROSS_EDGE) ? narrow(y) : y;
      if (job.over) {
        const rail = RAIL_MAT.test(mat);
        nx += rail ? railExt(x) : ext(x);
        ny += rail ? railExt(y) : ext(y);
      }
      return [N(nx), N(ny)];
    }
    default:
      throw new Error(`未知 kind: ${job.kind}`);
  }
}

// ---------------------------------------------------------------- 行处理
const FACE_KW = /^(box|quad|prism|poly)$/;

/** 取一行的材质名（位置随图元不同） */
function matOf(t) {
  switch (t[0]) {
    case 'box': return t[7];
    case 'quad': return t[13];
    case 'prism': return t[3];
    case 'poly': return t[2];
    default: return null;
  }
}

/** 只变换坐标、原样保留材质与修饰（`top=` 等） */
function xformLine(job, raw) {
  const t = raw.trim().split(/\s+/);
  const kw = t[0];
  if (kw === 'box') {
    const [x0, y0, z0, x1, y1, z1] = t.slice(1, 7).map(Number);
    const mat = t[7], mods = t.slice(8);
    const [nx0, ny0] = xform(job, x0, y0, mat);
    const [nx1, ny1] = xform(job, x1, y1, mat);
    return `box ${nx0} ${ny0} ${N(z0)}  ${nx1} ${ny1} ${N(z1)}  ${[mat, ...mods].join(' ')}`;
  }
  if (kw === 'quad') {
    const n = t.slice(1, 13).map(Number);
    const mat = t[13], mods = t.slice(14);
    const out = [];
    for (let i = 0; i < 4; i++) {
      const [nx, ny] = xform(job, n[i * 3], n[i * 3 + 1], mat);
      out.push(`${nx} ${ny} ${N(n[i * 3 + 2])}`);
    }
    return `quad ${out[0]}  ${out[1]}  ${out[2]}  ${out[3]}   ${[mat, ...mods].join(' ')}`;
  }
  if (kw === 'prism' || kw === 'poly') {
    const mat = kw === 'prism' ? t[3] : t[2];
    const at = kw === 'prism' ? 4 : 3;
    const zs = kw === 'prism' ? [N(Number(t[1])), N(Number(t[2]))] : [N(Number(t[1]))];
    const pts = t.slice(at).map((p) => {
      const [xs, ys] = p.split(',');
      const [nx, ny] = xform(job, Number(xs), Number(ys), mat);
      return `${nx},${ny}`;
    });
    const head = kw === 'prism' ? `prism ${zs[0]} ${zs[1]}  ${mat}` : `poly ${zs[0]}  ${mat}`;
    return `${head}  ${pts.join('  ')}`;
  }
  return raw;
}

const readFaces = (p) => fs.readFileSync(p, 'utf8').split('\n').filter((l) => FACE_KW.test(l.trim().split(/\s+/)[0]));

// ---------------------------------------------------------------- 主流程
function headerFor(job, stats) {
  return [
    '# =============================================================================',
    `# ${job.dst} —— A16 组（\`NBCN\` / \`NBCA\` 现代窄轨·130km/h）· ${job.note}`,
    '#',
    '# 【本文件由 tools/gen-a16-narrow-modern.mjs 生成，请勿手改】',
    `#   底板 = models/${job.from}.model（= A15 的产物，G1 几何按 k = ${K} 收窄，逐面照搬）`,
    job.sleeper
      ? `#   枕木 = models/${job.sleeper}.model 里的 SLE-2（concrete / concrete_seam / trim_dark），同一套 xform 收窄`
      : '#   枕木 = 无（这件本来就没有枕木层）',
    `#   删掉 A15 的 SLE-1 = ${stats.dropped} 面（wood_dark / wood_seam），换成 SLE-2 = ${stats.added} 面`,
    `#   kind=${job.kind}、沿轨探出 OVER=${OVER} 格${job.over ? '' : '（本件**不探出**）'}`,
    '#   收窄口径见 tools/gen-a15-narrow.mjs 的文件头；拼装口径见本工具文件头。',
    '# =============================================================================',
    '',
  ].join('\n');
}

export function generate() {
  const files = [];
  for (const job of JOBS) {
    const srcPath = path.join(ROOT, 'models', `${job.from}.model`);
    if (!fs.existsSync(srcPath)) {
      log(`  × 跳过 ${job.dst}：底板 ${job.from}.model 不存在`);
      continue;
    }
    const src = readFaces(srcPath);
    const head = fs.readFileSync(srcPath, 'utf8').split('\n')
      .filter((l) => /^(name|group|footprint|zmax)\s/.test(l));

    const kept = [];
    let dropped = 0;
    for (const l of src) {
      const mat = matOf(l.trim().split(/\s+/));
      if (SLE1_MAT.test(mat)) { dropped++; continue; }     // 删掉 SLE-1
      kept.push(l);
    }

    let added = 0;
    const sleeperLines = [];
    if (job.sleeper) {
      const sleeperPath = path.join(ROOT, 'models', `${job.sleeper}.model`);
      const sc = readFaces(sleeperPath).filter((l) => SLE2_MAT.test(matOf(l.trim().split(/\s+/))));
      for (const l of sc) { sleeperLines.push(xformLine(job, l)); added++; }
      if (!sc.length) log(`  ⚠ ${job.dst}：${job.sleeper} 里没有找到 SLE-2 面`);
    }

    // 顺序：底板（bed / rails / 洞门）在前，枕木在后 —— 与源模型的绘制顺序一致
    const body = [...kept, ...sleeperLines];
    const group = head.find((l) => /^group\s/.test(l)) || 'group     misc';
    const footprint = head.find((l) => /^footprint\s/.test(l)) || 'footprint 1 1';
    const zmax = head.find((l) => /^zmax\s/.test(l)) || 'zmax      0.0280';

    const out = path.join(ROOT, 'models', `${job.dst}.model`);
    const text = headerFor(job, { dropped, added })
      + `name      ${job.dst}\n${group.trimEnd()}\n${footprint.trimEnd()}\n${zmax.trimEnd()}\n\n`
      + body.join('\n') + '\n';
    fs.writeFileSync(out, text, 'utf8');
    files.push(out);

    // 自检：材质统计
    const h = {};
    for (const l of body) {
      const m = matOf(l.trim().split(/\s+/));
      h[m] = (h[m] || 0) + 1;
    }
    log(`  → ${rel(out).padEnd(40)} 面 ${String(body.length).padStart(4)}`
      + `（删 ${dropped} / 加 ${added}）  ${JSON.stringify(h)}`);
  }
  return files;
}

if (isMain(import.meta.url)) {
  const t0 = Date.now();
  log(`生成 A16 组（NBCN / NBCA 现代窄轨）模型：底板 = A15 产物，枕木换 SLE-2、k = ${K}`);
  const files = generate();
  log(`✔ 生成 ${files.length} 个模型，用时 ${((Date.now() - t0) / 1000).toFixed(2)} s`);
  log('  下一步：make render → 抄模板 → make check');
}
