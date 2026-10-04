// =============================================================================
// tools/gen-a15-narrow.mjs —— 生成 A15 组（`NACN` 窄轨）的模型
//
//   node tools/gen-a15-narrow.mjs
//
// 人工 2026-10-04 批准新建（铁律 L3 的申请），只写 `models/G5_*.model`。
//
// -----------------------------------------------------------------------------
// 【口径：§6 确认门（人工 2026-10-04 四项全按推荐值裁定）】
//
//   覆盖轨道 `NACN` —— 窄轨铁路 · 1900 · 80km/h（字母 A 档 ⇒ 95）· 23t · 非电
//   A15 组 = 道床 `BAL-D` + 轨枕 `SLE-1` + 钢轨 `RAI-7` + 洞口 `TUN-7`
//   **横向收窄 k = 0.70**（米轨 1000mm）：道床宽 / 枕木长 / 轨距**一起乘 k**。
//   ⚠ k 是**整个窄轨族**的口径（以后 `NBCN` `NBCA` `NCCA` `dBCN` 都沿用），
//     要改只改这一行然后重跑本工具。
//
// -----------------------------------------------------------------------------
// 【为什么是「从 G1 收窄」而不是重画一套】
//
//   A15 与 A1（G1）**断面形状完全同族**，差的三件事只有：
//     ① 道床 / 轨距 / 枕木一起按 k 收窄（这正是 `BAL-D` / `RAI-7` 的定义：
//        「道床整体收窄，轨距视觉变窄」「断面细、轨距窄」）
//     ② 洞口改成**小断面拱**（`TUN-7`）
//     ③ 沿轨两端各探出 `OVER`（盖瓦片接缝，2026-10-04 定；见 gen-a12-metro.mjs 文件头）
//
//   G1 的几何是实机调了十几轮的结果（道砟 32×5 高度场 + 边缘抖动 + 坡脚散粒、
//   枕木三段材质、道岔/交叉的并集与逐方向屏幕偏移…）。**重画一遍只会更差**，
//   所以本工具对 `models/` 下**已存在的 G1 模型**做仿射收窄：
//   一行行读、一行行写，产物仍是完全写死的字面量（符合 flatiso 的要求）。
//
// -----------------------------------------------------------------------------
// 【收窄怎么算 —— 最容易错的地方是「横向」是哪一维】
//
//   横向 = 与轨向垂直的那一维。三种模型用三种坐标：
//
//     `kind: 'y'`     整格直线 / 坡道 / 道口 / 隧道里的轨道
//                     横向 = y（轨道线 y = 0.5）
//                     ⇒ y' = 0.5 + k·(y − 0.5)，**全模型每个顶点都收**
//
//     `kind: 'diag'`  斜向半格轨（切 N 角，轨道线 x + y = 0.5）
//                     横向 = x + y
//                     ⇒ (x,y) 各挪 (k−1)·(x+y−0.5)/2（沿 (1,1) 收向中线）
//                     ⚠ 不乘 √2：模型自己已经按 1/√2 缩过横断面（人工 2026-09 裁定）
//
//     `kind: 'cross'` 交叉 / 三向 / 四向（**两个方向混在一个模型里**）
//                     逐坐标判：|x−0.5| ≤ 0.195 才收 x，|y−0.5| ≤ 0.195 才收 y
//                     板带正好是 0.5±0.18（含抖动）⇒ 等价于「X 带收 y、Y 带收 x、
//                     中央方块两边都收」；而且**共用顶点映射到同一位置**
//                     ⇒ 并集不会裂开（按"面片"分类会裂，2026-10-04 推演过）
//
//     `kind:'tunnel'` 隧道口：**只有 |y−0.5| ≤ 0.16 那一段跟着收**
//                     （拱洞 + 拱腹 + 洞身暗幕 + 洞内轨道）；
//                     **端墙 / 压顶 / 仰面 / 翼墙一格不动** —— 那些尺寸是用来
//                     「盖住原版草山包」的，动了就盖不住（TUN-5 逐字抄 TUN-1 就是这个原因）。
//                     轨道材质见 `TRACK_MATS`（洞内道砟/枕木/钢轨）。
//                     拱顶高度**不动**（0.2000 保持）⇒ 洞口变成「窄而高」的小断面拱。
//
// -----------------------------------------------------------------------------
// 【探出边界（盖接缝）】
//
//   碰到瓦片边、且沿轨全长的顶点各向外挪 OVER（1/32 格）：
//     整格 / 道口：x = 0 → −OVER、x = 1 → 1+OVER
//     斜向：        x = 0 的顶点 x −= OVER；y = 0 的顶点 y −= OVER（同理 1 那一侧）
//     交叉 / 道岔： 两条轴都按上面的规则
//                   ⚠ **例外：钢轨**。源模型里沿轨通长的钢轨是 `box`，被
//                     `gen-g1-switches.mjs` 的 `clipBox` 钳在 [0.0005, 0.9995]
//                     （见那边的 `CLIP0/CLIP1`），**不是正好 0 / 1** ⇒ 靠「贴边」
//                     判据探不出去；而道砟板是 `quad`、正好 0/1，**反而探了**。
//                     结果瓦片缝上是一条 ≈4px 的光板 —— 实机看就是「钢轨不够长」。
//                     ⇒ 钢轨单独用放宽到 `RAIL_EDGE_TOL`(=0.001 > 0.0005) 的判据。
//                     枕木不探（与直向件一致：源里枕木本来就内缩 0.012/0.988）。
//     隧道：        **只有轨道材质**探出（洞门 / 压顶 / 仰面 / 翼墙不动）
//   ⚠ **坡道不探出**（与 gen-a12-metro.mjs 同口径）：高端再往外延会顶大格位、
//     低端再往外延会穿地；坡道两端的缝交给**邻格直向件的探出**去盖。
//
//   为什么必须探出去：精灵在瓦片边界上切齐，缝上只剩两边的抗锯齿像素；
//   相邻两格的几何各探出一点才会**叠上**、由后画的那张盖住缝。
//   1/32 格 = 横向 4px / 纵向 2px @4x，且 < flatiso 的 OVERFLOW_ALLOW(1/16)。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { ROOT, log, rel, isMain } from './util.mjs';

// ---------------------------------------------------------------- 口径常量
const K = 0.70;              // 横向收窄比例（米轨 1000mm）★ 窄轨族统一口径
const OVER = 0.03125;        // 沿轨探出（1/32 格）
const CROSS_EDGE = 0.195;    // 交叉/道岔：判"这一维属于哪条带"的阈值（带半宽 0.18 + 抖动）
const ARCH_EDGE = 0.160;     // 隧道：拱洞/洞身那一段的横向半径（TUN-1 的 ARCH_R = 0.155）

/**
 * 钢轨「沿轨到头」的容差（见文件头「探出边界」）。
 * 源里钢轨是 `box`，被 `gen-g1-switches.mjs` 的 clipBox 钳在 **0.0005 / 0.9995**，
 * 所以判「到头」不能用「正好 0/1」，容差必须 > 0.0005。
 * 只给钢轨放宽：枕木是 0.012/0.988（本来就该内缩，不能探）。
 */
const RAIL_EDGE_TOL = 0.001;
const RAIL_MAT = /^rust$/;

/** 洞里的「轨道」材质 —— 只有这些才跟着收窄 + 探出，其余（stone* / dirt / trim_black）是洞门 */
const TRACK_MATS = /^(gravel|wood|wood_dark|wood_seam|rust|metal)$/;

/**
 * 作业表：源模型 → 产物模型。
 *   kind  收窄方式（见文件头）
 *   over  沿轨探出边界（坡道 false）
 *   edge  cross / tunnel 用的阈值
 */
const JOBS = [
  // ---- 轨道：underlay（自带道砟 + 轨枕 + 钢轨，G1 的规矩）----
  { src: 'probe_track_x', dst: 'G5_track_x', kind: 'y', over: true,
    note: 'underlay 槽 0/1（RTO_X / RTO_Y）：道床 + 木枕 + 两根轨（完整画面）' },
  // ---- 轨道：overlay（透明底，只有钢轨 + 轨枕）----
  { src: 'G1_rail_straight', dst: 'G5_rail_straight', kind: 'y', over: true,
    note: 'overlay 槽 0/1：钢轨层（透明底）' },
  // ---- 斜向（切 N 角）----
  { src: 'probe_half_upper', dst: 'G5_track_half', kind: 'diag', over: true,
    note: 'underlay 槽 2-5（RTO_N / S / E / W）：切 N 角的半格轨' },
  { src: 'G1_rail_halftrack', dst: 'G5_rail_half', kind: 'diag', over: true,
    note: 'overlay 槽 2-5：半格轨的钢轨层' },
  // ---- 坡道（**不探出**）----
  { src: 'G1_track_slope', dst: 'G5_track_slope', kind: 'y', over: false,
    note: 'underlay 槽 6-9：坡道（z 已含 RISE，只横向收窄，沿轨不探出）' },
  { src: 'G1_rail_slope', dst: 'G5_rail_slope', kind: 'y', over: false,
    note: 'overlay 槽 6-9：坡道的钢轨层' },
  // ---- 交叉 / 道岔（只有道床板，钢轨走 overlay）----
  { src: 'G1_crossing', dst: 'G5_crossing', kind: 'cross', over: true, edge: CROSS_EDGE,
    note: 'underlay 槽 10（RTO_CROSSING_XY）：交叉，自带两组钢轨' },
  { src: 'G1_junction3', dst: 'G5_junction3', kind: 'cross', over: true, edge: CROSS_EDGE,
    note: 'underlay 槽 11-14：三向道岔（只有道床）' },
  { src: 'G1_junction4', dst: 'G5_junction4', kind: 'cross', over: true, edge: CROSS_EDGE,
    note: 'underlay 槽 15：四向道岔（只有道床）' },
  // ---- 平交道口（道床只在两侧各留约 0.094 格，中间让公路透出来）----
  { src: 'G1_levelcrossing', dst: 'G5_levelcrossing', kind: 'y', over: true,
    note: 'level_crossings 的轨道图（取图 v0 → X 槽、v3 → Y 槽）' },
  // ---- 洞口 TUN-7：窄轨小断面拱（端墙外形照 TUN-1，只收拱洞与洞内轨道）----
  { src: 'G1_tunnel_stone', dst: 'G5_tunnel7', kind: 'tunnel', over: true, edge: ARCH_EDGE,
    note: 'tunnels: 组（A 组：远半）—— 洞内道床/轨枕/钢轨/暗幕 + 翼墙 + 洞门远半' },
  { src: 'G1_tunnel_stone_b', dst: 'G5_tunnel7_b', kind: 'tunnel', over: true, edge: ARCH_EDGE,
    note: 'tunnels: 组（B 组：近半）' },
  { src: 'G1_tunnel_stone_over', dst: 'G5_tunnel7_over', kind: 'tunnel', over: true, edge: ARCH_EDGE,
    note: 'tunnel_overlay: 组（A 组：近半 + 洞顶）' },
  { src: 'G1_tunnel_stone_over_b', dst: 'G5_tunnel7_over_b', kind: 'tunnel', over: true, edge: ARCH_EDGE,
    note: 'tunnel_overlay: 组（B 组：远半 + 洞顶）' },
];

// ---------------------------------------------------------------- 顶点变换
const N = (v) => Number(v.toFixed(4));
const near0 = (v) => v <= 1e-4;
const near1 = (v) => v >= 1 - 1e-4;
/** 碰到瓦片边就向外让开 OVER（否则 0） */
function ext(v) {
  if (near0(v)) return -OVER;
  if (near1(v)) return OVER;
  return 0;
}
/**
 * 钢轨专用的「到头」判据：把 `RAIL_EDGE_TOL` 的贴边缝也算到头。
 * 见文件头：源钢轨是 clipBox 出来的 0.0005 / 0.9995，单靠 ext() 永远探不出去。
 */
function railExt(v) {
  if (v <= RAIL_EDGE_TOL) return -OVER;
  if (v >= 1 - RAIL_EDGE_TOL) return OVER;
  return 0;
}
const narrow = (c) => 0.5 + K * (c - 0.5);

/**
 * 一个顶点 (x,y) 在 `mat` 面里的落点。
 * ⚠ 判「是否碰到瓦片边」一律用**原始坐标**（收窄会把边界上的点挪走）。
 */
function xform(job, x, y, mat) {
  const track = TRACK_MATS.test(mat);
  switch (job.kind) {
    case 'y': {
      return [N(x + (job.over ? ext(x) : 0)), N(narrow(y))];
    }
    case 'diag': {
      const s = (K - 1) * ((x + y) - 0.5) / 2;      // 沿 (1,1) 收向中线
      let nx = x + s, ny = y + s;
      // ⚠ 斜向的"沿轨"方向是 (1,−1)（不是 x 或 y 单轴）：
      //   在 y = 0 那头沿轨外延 ⇒ Δ = +d·(1,−1)；在 x = 0 那头 ⇒ Δ = −d·(1,−1)。
      //   两端都满足 Δx + Δy = 0 ⇒ **横向坐标 x+y 不变**、只有轨长变长（不会把端面拉宽）。
      //   d = OVER/√2：沿轨外延 OVER 那么长，投影到屏幕是横向 ≈5.7px（比直向的 4px 还多）。
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
      let nx = Math.abs(x - 0.5) <= job.edge ? narrow(x) : x;
      let ny = Math.abs(y - 0.5) <= job.edge ? narrow(y) : y;
      if (job.over) {
        // ★ 钢轨（rust）用放宽的判据：源里它是 clipBox 的 0.0005/0.9995，
        //   道砟板是 0/1 —— 两边用同一把尺子就会出现「板探了、轨没探」的 4px 光板。
        const rail = RAIL_MAT.test(mat);
        nx += rail ? railExt(x) : ext(x);
        ny += rail ? railExt(y) : ext(y);
      }
      return [N(nx), N(ny)];
    }
    case 'tunnel': {
      if (track) return [N(x + (job.over ? ext(x) : 0)), N(narrow(y))];
      // 洞门：只有拱洞 / 洞身那一段跟着收；端墙、压顶、仰面、翼墙一格不动
      return [x, Math.abs(y - 0.5) <= job.edge ? N(narrow(y)) : y];
    }
    default:
      throw new Error(`未知 kind: ${job.kind}`);
  }
}

// ---------------------------------------------------------------- 行变换
const F = (v) => (Number.isFinite(v) ? N(v) : v);
const WARNED = new Set();          // 每个作业只警告一次

/** 变换一行构件；返回 { line, moved } —— moved = 顶点被挪动过的个数 */
function xformLine(job, raw) {
  const t = raw.trim().split(/\s+/);
  const kw = t[0];
  let moved = 0;

  if (kw === 'quad') {
    // quad x0 y0 z0  x1 y1 z1  x2 y2 z2  x3 y3 z3   mat [mods...]
    const nums = t.slice(1, 13).map(Number);
    if (nums.length !== 12 || nums.some((v) => !Number.isFinite(v))) return { line: raw, moved: 0 };
    const mat = t[13];
    const mods = t.slice(14);
    const out = [];
    for (let i = 0; i < 4; i++) {
      const x = nums[i * 3], y = nums[i * 3 + 1], z = nums[i * 3 + 2];
      const [nx, ny] = xform(job, x, y, mat);
      if (nx !== N(x) || ny !== N(y)) moved++;
      out.push(`${nx} ${ny} ${N(z)}`);
    }
    return { line: `quad ${out[0]}  ${out[1]}  ${out[2]}  ${out[3]}   ${[mat, ...mods].join(' ')}`, moved };
  }

  if (kw === 'box') {
    // box x0 y0 z0  x1 y1 z1  mat [mods...]
    // box 是轴对齐的；本生成器的映射**逐坐标可分**（含 cross / tunnel），所以两个对角点够定形。
    // ⚠ 例外是 diag（横向 = x+y，两轴耦合）—— 那里出现 box 就必须按四角变换。
    if (job.kind === 'diag' && !WARNED.has(job.dst)) {
      WARNED.add(job.dst);
      log(`  ⚠ ${job.dst}：斜向作业里出现 box —— 横向映射与两轴耦合，`
        + '当前只变换两个对角点，**几何会错**；请改本工具或换源模型');
    }
    const [x0, y0, z0, x1, y1, z1] = t.slice(1, 7).map(Number);
    if ([x0, y0, z0, x1, y1, z1].some((v) => !Number.isFinite(v))) return { line: raw, moved: 0 };
    const mat = t[7];
    const mods = t.slice(8);
    // 底面两个角点与顶面两个角点各变换一次（box 是轴对齐的，两个角够定形）
    const [nx0, ny0] = xform(job, x0, y0, mat);
    const [nx1, ny1] = xform(job, x1, y1, mat);
    for (const [a, b, c, d] of [[x0, y0, nx0, ny0], [x1, y1, nx1, ny1]]) {
      if (a !== c || b !== d) moved++;
    }
    return { line: `box ${nx0} ${ny0} ${N(z0)}  ${nx1} ${ny1} ${N(z1)}  ${[mat, ...mods].join(' ')}`, moved };
  }

  if (kw === 'prism' || kw === 'poly') {
    // prism z0 z1 mat  x,y x,y ...        poly z mat  x,y x,y ...
    const zAt = kw === 'prism' ? [1, 2] : [1];
    const matAt = kw === 'prism' ? 3 : 2;
    const zs = zAt.map((i) => Number(t[i]));
    if (zs.some((v) => !Number.isFinite(v))) return { line: raw, moved: 0 };
    const mat = t[matAt];
    const pts = t.slice(matAt + 1);
    const outp = pts.map((p) => {
      const [xs, ys] = p.split(',');
      const x = Number(xs), y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return p;
      const [nx, ny] = xform(job, x, y, mat);
      if (nx !== N(x) || ny !== N(y)) moved++;
      return `${nx},${ny}`;
    });
    const head = kw === 'prism' ? `prism ${N(zs[0])} ${N(zs[1])}  ${mat}` : `poly ${N(zs[0])}  ${mat}`;
    return { line: `${head}  ${outp.join('  ')}`, moved };
  }

  return { line: raw, moved: 0 };      // 其他行原样保留
}

// ---------------------------------------------------------------- 主流程
function headerFor(job, srcName, stats) {
  return [
    '# =============================================================================',
    `# ${job.dst} —— A15 组（\`NACN\` 窄轨）· ${job.note}`,
    '#',
    `# 【本文件由 tools/gen-a15-narrow.mjs 生成，请勿手改】`,
    `#   源 = models/${srcName}.model（G1 的几何，实机调过的口径），横向收窄 k = ${K}（米轨 1000mm）`,
    `#   方式 kind=${job.kind}、沿轨探出 OVER=${OVER} 格${job.over ? '' : '（本件**不探出**）'}`,
    `#   收窄口径与"为什么这么收"见 tools/gen-a15-narrow.mjs 的文件头。`,
    '#',
    `# 自检：顶点挪动 ${stats.moved} 个；模型空间 bbox x[${stats.x0}, ${stats.x1}] y[${stats.y0}, ${stats.y1}]`,
    '# =============================================================================',
    '',
  ].join('\n');
}

export function generate() {
  const files = [];
  for (const job of JOBS) {
    const srcFile = path.join(ROOT, 'models', `${job.src}.model`);
    if (!fs.existsSync(srcFile)) {
      log(`  × 跳过 ${job.dst}：源 ${job.src}.model 不存在`);
      continue;
    }
    const src = fs.readFileSync(srcFile, 'utf8').split('\n');

    const body = [];
    const stats = { moved: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, faces: 0 };
    let seenHead = false;
    for (const raw of src) {
      if (!/^\S/.test(raw)) continue;                     // 空行 / 注释一律丢掉（重新写头）
      const kw = raw.trim().split(/\s+/)[0];
      if (kw === 'name') { body.push(`name      ${job.dst}`); seenHead = true; continue; }
      if (kw === 'group' || kw === 'footprint' || kw === 'zmax') { body.push(raw.trimEnd()); continue; }
      const { line, moved } = xformLine(job, raw);
      stats.moved += moved;
      if (moved) stats.faces++;
      if (kw === 'quad' || kw === 'box') {
        const n = line.trim().split(/\s+/).slice(1).map(Number);
        // quad = 12 个数（4 个顶点）；box = 6 个数（两个对角点）
        const count = kw === 'quad' ? 4 : 2;
        for (let i = 0; i < count; i++) {
          const x = n[i * 3], y = n[i * 3 + 1];
          if (!Number.isFinite(x) || !Number.isFinite(y)) break;
          stats.x0 = Math.min(stats.x0, x); stats.x1 = Math.max(stats.x1, x);
          stats.y0 = Math.min(stats.y0, y); stats.y1 = Math.max(stats.y1, y);
        }
      }
      body.push(line);
    }
    if (!seenHead) log(`  ⚠ ${job.src} 里没有 name 行`);

    const out = path.join(ROOT, 'models', `${job.dst}.model`);
    fs.writeFileSync(out, headerFor(job, job.src, stats) + body.join('\n') + '\n', 'utf8');
    files.push(out);
    log(`  → ${rel(out).padEnd(40)} ${String(body.length).padStart(4)} 行  挪动 ${stats.moved} 顶点`
      + `  bbox x[${stats.x0.toFixed(4)}, ${stats.x1.toFixed(4)}] y[${stats.y0.toFixed(4)}, ${stats.y1.toFixed(4)}]`);
  }
  return files;
}

if (isMain(import.meta.url)) {
  const t0 = Date.now();
  log(`生成 A15 组（NACN 窄轨）模型：k = ${K}（米轨 1000mm）、OVER = ${OVER}`);
  const files = generate();
  log(`✔ 生成 ${files.length} 个模型，用时 ${((Date.now() - t0) / 1000).toFixed(2)} s`);
  log('  下一步：make render → 抄模板 → make check');
}
