// =============================================================================
// tools/gen-a15-narrow.mjs —— 生成 **A15 组（`NACN` 窄轨）** 与
//                              **A24 组（`dBCN` 准轨-窄轨套轨）** 的模型
//
//   node tools/gen-a15-narrow.mjs
//
// 人工 2026-10-04 批准新建（铁律 L3 的申请），只写 `models/G5_*.model`。
// 人工 2026-11-18：**追加第二节**出 `models/G18_*.model`（A24 / `dBCN`）。
//   A24 借窄轨族的同一个 `K = 0.70` —— 但**方向相反**：窄轨族把整条断面收窄，
//   套轨则是「准轨断面加宽 + 把同一对钢轨按 K 再画一遍」。两节共用本文件的
//   四套映射（y / diag / cross / tunnel）与探出规则，见第二节的文件头。
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
function xformLine(job, raw, xf = xform) {
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
      const [nx, ny] = xf(job, x, y, mat);
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
    const [nx0, ny0] = xf(job, x0, y0, mat);
    const [nx1, ny1] = xf(job, x1, y1, mat);
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
      const [nx, ny] = xf(job, x, y, mat);
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

// =============================================================================
// 第二节：A24 组（`dBCN` 准轨-窄轨套轨）—— 断面加宽 + **四根轨**
//
//   `BAL-K` 有砟·套轨 + `SLE-1` 木枕 + **`RAI-10` 四轨** + `TUN-8` 套轨加宽断面拱
//   覆盖 `dBCN`（CSV：1435/1067/1000mm · 1950 · 100km/h · 23t · 非电）
//
// 【为什么能坐在第一节旁边】A24 与 A15 是**同一件事的两个方向**：
//   A15 = 准轨断面 × K（0.70）           → 窄轨
//   A24 = 准轨断面 × W（10/9）           → 套轨的**道床与枕木**
//         + 同一对钢轨按 K 再画一遍       → **内侧那一对**（米轨 1000mm）
//   ⇒ 两个尺度都是本工程已有的：K 是窄轨族口径；W 就是 A5 的 `BAL-B`
//     「横向 ×1.1111」（见 gen-a5-heavy.mjs 文件头）⇒ 道床 0.36 → 0.40 格。
//
// 【每一层是谁】
//   层             材质                          这一轮怎么变
//   -------------  ----------------------------  ---------------------------------
//   道砟 / 枕木    gravel, wood_*, stone_dark    × W（道床 0.36 → 0.40、枕木 0.18 → 0.20）
//   钢轨           rust（`top=metal`）           **一格不动** —— 外面那一对就是准轨原尺寸
//                  ↑ 再按 K 复制一遍              → 内侧那一对（1000mm）
//   ⇒ `RAI-10` =「准轨原样 + 0.70 倍的自己」，这就是「四根轨」最省的定义。
//
//   ★ 两个尺度**各自有物理依据**（不是凑数）：本包 1 格 = 13.9 m（见 probe_track_x
//     文件头）。准轨轨距 0.1032 格 = 1.435 m ✓；乘 K = 0.70 得 0.0722 格 = 1.004 m ✓
//     ⇒ 内侧那对**就是米轨真值**。1067 那一档落在 0.0770 格，与 1000 只差 0.0024 格
//     （3.4 cm / **0.3 px @4x**）⇒ 一张图同时服务 1067 与 1000，不必分两套。
//
//   ⚠ 钢轨**不能**乘 W：乘了外面那对就变成 0.1147 格 = 1.59 m，不再是 1435。
//   ⚠ 也不会「乘两次」：`xformW` 对钢轨取 S = 1（原样），只有**复制那一遍**才取 K。
//
// 【洞口 TUN-8】源 = `G1_tunnel2_stone*`（TUN-2 素混凝土端墙拱，落位表第 3 行）。
//   沿用 `kind:'tunnel'` 的老口径：
//     · 洞内轨道（道砟 / 枕木）**整条** × W ⇒ 洞口内侧的砟带与 BAL-K 逐格对齐；
//     · 拱洞 / 拱腹 / 洞身暗幕 / 洞口倒角（|y−0.5| ≤ 0.16）**× W** ⇒「加宽拱圈」；
//     · **端墙 / 压顶 / 仰面 / 翼墙 / 山体裙一格不动** —— 那些尺寸是用来盖住原版
//       草山包的，动了就盖不住（与 A15 的 TUN-7 同一条理由）。
//   ⇒ 洞跨 0.31 → 0.344 格（+11%），**拱顶高度不动** ⇒ 宽一点、扁一点的套轨洞。
//   ⚠ 与 A15 的唯一差别：A15 连洞内轨道也按「|y−0.5| ≤ 0.16」判，本组改成
//     「轨道材质整条按 W」—— 套轨道床比准轨宽，只按 0.16 判会把洞内砟带外缘留在
//     0.3083（准轨值）而洞外已到 0.2870 ⇒ 洞口一圈 2.1 cm 台阶。
//
// 【平交道口不放大】`G1_levelcrossing` 的砟带只有两侧各一条（中间让公路透出来），
//   宽度由**公路开口**定、不由轨道断面定 ⇒ `noWiden`，只补内侧那对钢轨。
// =============================================================================

/** 非钢轨层的横向放大：道床 0.36 → 0.40 格（与 `BAL-B` 的「横向 ×1.1111」同一口径） */
const W_BED = 10 / 9;

/** 钢轨层（含轨顶 `metal` 面）—— 这一层**不放大**，只用来复制出内侧那一对 */
const RAIL_ALL = /^(rust|metal)$/;

const widen = (c, s) => (s === 1 ? c : 0.5 + s * (c - 0.5));

/**
 * A24 的顶点映射：与第一节 `xform()` **逐分支同构**，只把「统一收窄 K」换成
 * 「按材质取 S」—— 钢轨 S = 1（不动），其余 S = `W_BED`。
 */
function xformW(job, x, y, mat) {
  // `job.railS` 只有第三节（宽轨）会传：钢轨层的横向尺度由它给，缺省 1（= A24 的口径）。
  const s = job.noWiden ? 1 : (RAIL_ALL.test(mat) ? (job.railS ?? 1) : W_BED);
  const track = TRACK_MATS.test(mat);
  switch (job.kind) {
    case 'y':
      return [N(x + (job.over ? ext(x) : 0)), N(widen(y, s))];
    case 'diag': {
      const d = (s - 1) * ((x + y) - 0.5) / 2;      // 沿 (1,1) 放向中线外
      let nx = x + d, ny = y + d;
      if (job.over) {
        const e = OVER / Math.SQRT2;
        if (near0(y)) { nx += e; ny -= e; }
        if (near0(x)) { nx -= e; ny += e; }
        if (near1(y)) { nx -= e; ny += e; }
        if (near1(x)) { nx += e; ny -= e; }
      }
      return [N(nx), N(ny)];
    }
    case 'cross': {
      let nx = Math.abs(x - 0.5) <= job.edge ? widen(x, s) : x;
      let ny = Math.abs(y - 0.5) <= job.edge ? widen(y, s) : y;
      if (job.over) {
        const rail = RAIL_MAT.test(mat);
        nx += rail ? railExt(x) : ext(x);
        ny += rail ? railExt(y) : ext(y);
      }
      return [N(nx), N(ny)];
    }
    case 'tunnel': {
      // 洞内轨道整条放大（见本节文件头）；钢轨 S = 1 ⇒ 仍是准轨原尺寸
      if (track) return [N(x + (job.over ? ext(x) : 0)), N(widen(y, s))];
      return [x, Math.abs(y - 0.5) <= job.edge ? N(widen(y, s)) : y];
    }
    default:
      throw new Error(`未知 kind: ${job.kind}`);
  }
}

/** 取一行的材质名（图元不同位置不同）—— 只用于判「这一行是不是钢轨」 */
function matOfLine(raw) {
  const t = raw.trim().split(/\s+/);
  switch (t[0]) {
    case 'quad': return t[13];
    case 'box': return t[7];
    case 'prism': return t[3];
    case 'poly': return t[2];
    default: return null;
  }
}

/**
 * A24 作业表：源模型 → 产物模型。
 *   `kind` / `over` / `edge` 与第一节同义；`noWiden` = 整件不放大（只补内侧钢轨）。
 *   ⚠ 洞口**四件全要**：`tunnel_overlay:` 那层虽然不含轨道，但**洞口外形加宽了**，
 *     与 A4 复用 A1 的 `probe_tunnel_over_2` 的情况不同（那次 TUN-2 一字未改）。
 */
const JOBS24 = [
  { src: 'probe_track_x', dst: 'G18_track_x', kind: 'y', over: true,
    note: 'underlay 槽 0/1（RTO_X / RTO_Y）：加宽道床 + 木枕 + 四根轨（完整画面）' },
  { src: 'G1_rail_straight', dst: 'G18_rail_straight', kind: 'y', over: true,
    note: 'overlay 槽 0/1：钢轨层（透明底，四根轨 + 枕木）' },
  { src: 'probe_half_upper', dst: 'G18_track_half', kind: 'diag', over: true,
    note: 'underlay 槽 2-5（RTO_N / S / E / W）：切 N 角的半格套轨' },
  { src: 'G1_rail_halftrack', dst: 'G18_rail_half', kind: 'diag', over: true,
    note: 'overlay 槽 2-5：半格轨的钢轨层' },
  { src: 'G1_track_slope', dst: 'G18_track_slope', kind: 'y', over: false,
    note: 'underlay 槽 6-9：坡道（z 已含 RISE，只横向加宽，沿轨不探出）' },
  { src: 'G1_rail_slope', dst: 'G18_rail_slope', kind: 'y', over: false,
    note: 'overlay 槽 6-9：坡道的钢轨层' },
  { src: 'G1_crossing', dst: 'G18_crossing', kind: 'cross', over: true, edge: CROSS_EDGE,
    note: 'underlay 槽 10（RTO_CROSSING_XY）：交叉，自带两组钢轨（→ 四组）' },
  { src: 'G1_junction3', dst: 'G18_junction3', kind: 'cross', over: true, edge: CROSS_EDGE,
    note: 'underlay 槽 11-14：三向道岔（只有道床板，没有钢轨）' },
  { src: 'G1_junction4', dst: 'G18_junction4', kind: 'cross', over: true, edge: CROSS_EDGE,
    note: 'underlay 槽 15：四向道岔（只有道床板）' },
  { src: 'G1_levelcrossing', dst: 'G18_levelcrossing', kind: 'y', over: true, noWiden: true,
    note: 'level_crossings 的轨道图（取图 v0 → X 槽、v3 → Y 槽）—— **不放大**，只补内侧轨' },
  { src: 'G1_tunnel2_stone', dst: 'G18_tunnel8', kind: 'tunnel', over: true, edge: ARCH_EDGE,
    note: 'tunnels: 组（A 组：远半）—— 洞内加宽道床/枕木/四轨 + 翼墙 + 洞门远半' },
  { src: 'G1_tunnel2_stone_b', dst: 'G18_tunnel8_b', kind: 'tunnel', over: true, edge: ARCH_EDGE,
    note: 'tunnels: 组（B 组：近半）' },
  { src: 'G1_tunnel2_stone_over', dst: 'G18_tunnel8_over', kind: 'tunnel', over: true, edge: ARCH_EDGE,
    note: 'tunnel_overlay: 组（A 组：近半 + 洞顶）—— 不含轨道，但外形加宽了' },
  { src: 'G1_tunnel2_stone_over_b', dst: 'G18_tunnel8_over_b', kind: 'tunnel', over: true, edge: ARCH_EDGE,
    note: 'tunnel_overlay: 组（B 组：远半 + 洞顶）' },
];

function headerFor24(job, stats) {
  return [
    '# =============================================================================',
    `# ${job.dst} —— A24 组（\`dBCN\` 准轨-窄轨套轨）· ${job.note}`,
    '#',
    '# 【本文件由 tools/gen-a15-narrow.mjs 的**第二节**生成，请勿手改】',
    `#   源 = models/${job.src}.model（G1 / TUN-2 的几何，实机调过的口径）`,
    `#   道床 / 枕木 × ${W_BED.toFixed(4)}（0.36 → 0.40 格，与 BAL-B 的「横向 ×1.1111」同口径）；`
      + '钢轨网格不动',
    `#   钢轨 = 源里那一对**原样保留** + 同一对按 k = ${K} 再画一遍 ⇒ 四根（RAI-10）`,
    `#   方式 kind=${job.kind}、沿轨探出 OVER=${OVER} 格${job.over ? '' : '（本件**不探出**）'}`
      + `${job.noWiden ? '、**本件不放大**（平交道口砟带由公路开口定）' : ''}`,
    '#   口径与"为什么这么加宽"见本工具第二节的文件头。',
    '#',
    `# 自检：顶点挪动 ${stats.moved} 个、内侧钢轨副本 ${stats.copies} 行；`
      + `模型空间 bbox x[${stats.x0}, ${stats.x1}] y[${stats.y0}, ${stats.y1}]`,
    '# =============================================================================',
    '',
  ].join('\n');
}

export function generateA24() {
  const files = [];
  for (const job of JOBS24) {
    const srcFile = path.join(ROOT, 'models', `${job.src}.model`);
    if (!fs.existsSync(srcFile)) {
      log(`  × 跳过 ${job.dst}：源 ${job.src}.model 不存在`);
      continue;
    }
    const src = fs.readFileSync(srcFile, 'utf8').split('\n');

    const body = [];
    const stats = { moved: 0, copies: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    let seenHead = false;
    for (const raw of src) {
      if (!/^\S/.test(raw)) continue;                     // 空行 / 注释一律丢掉（重新写头）
      const kw = raw.trim().split(/\s+/)[0];
      if (kw === 'name') { body.push(`name      ${job.dst}`); seenHead = true; continue; }
      if (kw === 'group' || kw === 'footprint' || kw === 'zmax') { body.push(raw.trimEnd()); continue; }

      const { line, moved } = xformLine(job, raw, xformW);
      stats.moved += moved;
      body.push(line);

      // ★ 钢轨那一层：原件照留，再按 k = 0.70 复制一条（= 内侧那一对）
      if (RAIL_ALL.test(matOfLine(raw))) {
        const copy = xformLine(job, raw, xform);          // 第一节的收窄映射（k = K）
        body.push(copy.line);
        stats.copies++;
      }

      if (kw === 'quad' || kw === 'box') {
        const n = line.trim().split(/\s+/).slice(1).map(Number);
        const count = kw === 'quad' ? 4 : 2;
        for (let i = 0; i < count; i++) {
          const x = n[i * 3], y = n[i * 3 + 1];
          if (!Number.isFinite(x) || !Number.isFinite(y)) break;
          stats.x0 = Math.min(stats.x0, x); stats.x1 = Math.max(stats.x1, x);
          stats.y0 = Math.min(stats.y0, y); stats.y1 = Math.max(stats.y1, y);
        }
      }
    }
    if (!seenHead) log(`  ⚠ ${job.src} 里没有 name 行`);

    const out = path.join(ROOT, 'models', `${job.dst}.model`);
    fs.writeFileSync(out, headerFor24(job, stats) + body.join('\n') + '\n', 'utf8');
    files.push(out);
    log(`  → ${rel(out).padEnd(40)} ${String(body.length).padStart(4)} 行  挪动 ${stats.moved} 顶点`
      + `  内侧轨 ${String(stats.copies).padStart(2)} 行`
      + `  bbox x[${stats.x0.toFixed(4)}, ${stats.x1.toFixed(4)}] y[${stats.y0.toFixed(4)}, ${stats.y1.toFixed(4)}]`);
  }
  return files;
}

// =============================================================================
// 第三节：A18 组（`DBDN` 准轨-俄罗斯宽轨套轨）＋ A22 组（`BBDN` 纯 1520 宽轨）
//
//   覆盖 `DBDN`（CSV：1435/1520mm · 1898 · 120km/h · 25t · 非电）
//        `BBDN`（CSV：1520mm      · 1898 · 120km/h · 25t · 非电）
//   道床 `BAL-K`（= 第二节那个加宽道床 **0.40 格**，一个数不改）+ `SLE-1` 木枕
//   + 洞口 `TUN-8`（= 第二节那个加宽拱，一个数不改）
//   钢轨：A18 = **`RAI-5`**（四根：1435 内侧 + 1520 外侧）
//         A22 = **`RAI-9`**（两根：1520）
//
// -----------------------------------------------------------------------------
// 【本轮一个数都不新造 —— 新东西只有"钢轨的横向尺度"】
//
//   A24（第二节）已经把 `BAL-K` 加宽道床与 `TUN-8` 造出来了，本组**整件沿用**；
//   与 A24 的差别只在钢轨那一层取哪个尺度：
//
//     家族   钢轨遍数            结果                轨距（格 / 米）
//     ----   ------------------  ------------------  --------------------------
//     A24    [1, K]             四根（窄轨在内）    0.1032 / 0.0722 = 1435 / 1004
//     A18    [1, S_BROAD]       四根（宽轨在外）    0.1032 / 0.1093 = 1435 / 1520
//     A22    [S_BROAD]          两根                0.1093          = 1520
//
//   ⇒ 第三节 = 第二节的同一个 `xformW()` + 同一个 `W_BED`，只多一个 `S_BROAD`。
//
// 【S_BROAD 是纯比值，不依赖"一格几米"】
//
//   `probe_track_x` 文件头的轨距口径：准轨 **0.1032 格 ↔ 1.435 m**
//   ⇒ 1520 mm 落在 0.1032 × 1520/1435 = **0.1093118 格**，反算回来正好 1.520 m ✓
//   顶点级（源轨心 y = 0.5 ± 0.0516、断面 0.0080 格）：
//     · 轨心 → 0.5 ± **0.0546559**，即 y = 0.4453 / 0.5547
//     · 断面 → 0.0085 格（+5.9% = **0.06 px @4x**，看不见）
//
//   ⚠ A24 的复制那遍是**收窄**（k = 0.70，断面跟着变细 = 60kg → 50kg 观感）；
//     本组是**放大**（S > 1），断面跟着略微变粗 —— 同一段代码的另一个方向，
//     而且 1520 用 R65 / 1435 用 60kg 本来也粗一点，方向是对的。
//
// 【四根轨在 4x 下会并成一根 —— 这是对的】
//
//   1435 与 1520 只差 **85 mm = 0.0062 格 = 0.8 px @4x**（screen_x = Δy · 128 / 格），
//   而一根轨的断面本身就有 0.0080 格 ≈ 1.0 px ⇒ 每侧那两根**必然糊成一根约 1.4 px 宽的轨**。
//   现实里的 1435/1520 套轨就是这样（两轨中心距 85 mm、轨头宽 70 mm，几乎贴死），
//   所以 **A18 与 A22 在图上的差别只有"每侧厚一点 / 薄一点"** —— 不是画错，
//   是本尺度（1 格 = 13.9 m）能表达的极限。要更醒目只能靠 C8 的地图色与名称。
//
// 【为什么道床还用 0.40 而不是单线标准的 0.36】
//
//   `美术要素方案.md` §3.1 的 A18/A19/A22/A23 四行都写 `BAL-K` + `TUN-8`
//   （"三条的道床与隧道口都暂按加宽复用套轨那套…要分开画再拆 `BAL-K2` / `TUN-8b`"）。
//   本轮照办 —— 好处是三个家族（A18 / A22 / A24）的**道床与洞门逐字相同**，
//   分表格位也必然同族（263×149 / 263×167），模板可以逐条照抄；
//   代价是纯 1520 的道床偏宽（缺口已登记在 `美术要素方案.md` §3.1）。
// =============================================================================

/** 1520 / 1435 —— 宽轨相对准轨的横向比值（本组唯一的新尺度） */
const S_BROAD = 1520 / 1435;

/**
 * 两个宽轨家族：只差「钢轨画几遍」。
 *   `railPasses` = 钢轨层的横向尺度序列（第一个是原件，其余是复制件）
 *   `tunnel`     = 洞口模型名后缀（两族各出一套，因为 `tunnels:` 那层含洞内轨道）
 */
const WIDE_FAMS = [
  {
    group: 'A18', prefix: 'G19', tunnel: 'tunnel8wide',
    railTypes: '`RAI-5`',
    railNote: '四根：准轨那对**原样**（0.1032 格 = 1.435 m）+ 同一对按 S 放大一遍'
      + '（0.1093 格 = 1.520 m，**在外侧**）',
    railPasses: [1, S_BROAD],
    sheet: 'dualwide',
  },
  {
    group: 'A22', prefix: 'G20', tunnel: 'tunnel8broad',
    railTypes: '`RAI-9`',
    railNote: '两根：**只**画按 S 放大那一遍（轨距 0.1093 格 = **1.520 m**）',
    railPasses: [S_BROAD],
    sheet: 'wide',
  },
];

/** 作业表 —— 与 `JOBS24` 逐条同源同参，只把产物名换成本族的 */
function jobsWide(fam) {
  const p = fam.prefix, t = fam.tunnel;
  return [
    { src: 'probe_track_x', dst: `${p}_track_x`, kind: 'y', over: true,
      note: 'underlay 槽 0/1（RTO_X / RTO_Y）：加宽道床 + 木枕 + 宽轨钢轨（完整画面）' },
    { src: 'G1_rail_straight', dst: `${p}_rail_straight`, kind: 'y', over: true,
      note: 'overlay 槽 0/1：钢轨层（透明底，钢轨 + 枕木）' },
    { src: 'probe_half_upper', dst: `${p}_track_half`, kind: 'diag', over: true,
      note: 'underlay 槽 2-5（RTO_N / S / E / W）：切 N 角的半格宽轨' },
    { src: 'G1_rail_halftrack', dst: `${p}_rail_half`, kind: 'diag', over: true,
      note: 'overlay 槽 2-5：半格轨的钢轨层' },
    { src: 'G1_track_slope', dst: `${p}_track_slope`, kind: 'y', over: false,
      note: 'underlay 槽 6-9：坡道（z 已含 RISE，只横向加宽，沿轨不探出）' },
    { src: 'G1_rail_slope', dst: `${p}_rail_slope`, kind: 'y', over: false,
      note: 'overlay 槽 6-9：坡道的钢轨层' },
    { src: 'G1_crossing', dst: `${p}_crossing`, kind: 'cross', over: true, edge: CROSS_EDGE,
      note: 'underlay 槽 10（RTO_CROSSING_XY）：交叉，自带两组钢轨' },
    { src: 'G1_junction3', dst: `${p}_junction3`, kind: 'cross', over: true, edge: CROSS_EDGE,
      note: 'underlay 槽 11-14：三向道岔（只有道床板，没有钢轨）' },
    { src: 'G1_junction4', dst: `${p}_junction4`, kind: 'cross', over: true, edge: CROSS_EDGE,
      note: 'underlay 槽 15：四向道岔（只有道床板）' },
    { src: 'G1_levelcrossing', dst: `${p}_levelcrossing`, kind: 'y', over: true, noWiden: true,
      note: 'level_crossings 的轨道图（v0 → X 槽、v3 → Y 槽）—— 道床**不放大**，钢轨照挪到宽轨位' },
    { src: 'G1_tunnel2_stone', dst: `${p}_${t}`, kind: 'tunnel', over: true, edge: ARCH_EDGE,
      note: 'tunnels: 组（A 组：远半）—— 洞内加宽道床/枕木/宽轨 + 翼墙 + 洞门远半' },
    { src: 'G1_tunnel2_stone_b', dst: `${p}_${t}_b`, kind: 'tunnel', over: true, edge: ARCH_EDGE,
      note: 'tunnels: 组（B 组：近半）' },
    { src: 'G1_tunnel2_stone_over', dst: `${p}_${t}_over`, kind: 'tunnel', over: true, edge: ARCH_EDGE,
      note: 'tunnel_overlay: 组（A 组：近半 + 洞顶）—— 不含轨道，外形与 A24 的 TUN-8 逐字相同' },
    { src: 'G1_tunnel2_stone_over_b', dst: `${p}_${t}_over_b`, kind: 'tunnel', over: true, edge: ARCH_EDGE,
      note: 'tunnel_overlay: 组（B 组：远半 + 洞顶）' },
  ];
}

function headerForWide(fam, job, stats) {
  return [
    '# =============================================================================',
    `# ${job.dst} —— ${fam.group} 组宽轨（${fam.railTypes}）· ${job.note}`,
    '#',
    '# 【本文件由 tools/gen-a15-narrow.mjs 的**第三节**生成，请勿手改】',
    `#   源 = models/${job.src}.model（G1 / TUN-2 的几何，实机调过的口径）`,
    `#   道床 / 枕木 × ${W_BED.toFixed(4)}（0.36 → 0.40 格，与 A24 的 \`BAL-K\` 逐字相同）`,
    `#   钢轨 = ${fam.railNote}`,
    `#          S = 1520/1435 = ${S_BROAD.toFixed(6)} ⇒ 轨心 0.5 ± 0.0546559（准轨是 ±0.0516）、`
      + '断面 0.0080 → 0.0085 格',
    `#   方式 kind=${job.kind}、沿轨探出 OVER=${OVER} 格${job.over ? '' : '（本件**不探出**）'}`
      + `${job.noWiden ? '、**道床不放大**（平交道口砟带由公路开口定）' : ''}`,
    '#   口径与"为什么四根轨在 4x 下会并成一根"见本工具第三节的文件头。',
    '#',
    `# 自检：顶点挪动 ${stats.moved} 个、钢轨行 ${stats.rails} 条（每条画 ${fam.railPasses.length} 遍）`
      + `、模型空间 bbox x[${stats.x0}, ${stats.x1}] y[${stats.y0}, ${stats.y1}]`,
    '# =============================================================================',
    '',
  ].join('\n');
}

export function generateWide() {
  const files = [];
  for (const fam of WIDE_FAMS) {
    for (const job of jobsWide(fam)) {
      const srcFile = path.join(ROOT, 'models', `${job.src}.model`);
      if (!fs.existsSync(srcFile)) {
        log(`  × 跳过 ${job.dst}：源 ${job.src}.model 不存在`);
        continue;
      }
      const src = fs.readFileSync(srcFile, 'utf8').split('\n');

      const body = [];
      const stats = { moved: 0, rails: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
      let seenHead = false;
      for (const raw of src) {
        if (!/^\S/.test(raw)) continue;                     // 空行 / 注释一律丢掉（重新写头）
        const kw = raw.trim().split(/\s+/)[0];
        if (kw === 'name') { body.push(`name      ${job.dst}`); seenHead = true; continue; }
        if (kw === 'group' || kw === 'footprint' || kw === 'zmax') { body.push(raw.trimEnd()); continue; }

        const isRail = RAIL_ALL.test(matOfLine(raw));
        if (isRail) stats.rails++;
        // 钢轨层：按 `railPasses` 逐个尺度各画一遍；其余层只画一遍（S = W_BED 在 xformW 里）
        const passes = isRail ? fam.railPasses : [null];
        for (const s of passes) {
          const j = s === null ? job : { ...job, railS: s, noWiden: false };
          const { line, moved } = xformLine(j, raw, xformW);
          stats.moved += moved;
          body.push(line);
          if (kw === 'quad' || kw === 'box') {
            const n = line.trim().split(/\s+/).slice(1).map(Number);
            const count = kw === 'quad' ? 4 : 2;
            for (let i = 0; i < count; i++) {
              const x = n[i * 3], y = n[i * 3 + 1];
              if (!Number.isFinite(x) || !Number.isFinite(y)) break;
              stats.x0 = Math.min(stats.x0, x); stats.x1 = Math.max(stats.x1, x);
              stats.y0 = Math.min(stats.y0, y); stats.y1 = Math.max(stats.y1, y);
            }
          }
        }
      }
      if (!seenHead) log(`  ⚠ ${job.src} 里没有 name 行`);

      const out = path.join(ROOT, 'models', `${job.dst}.model`);
      fs.writeFileSync(out, headerForWide(fam, job, stats) + body.join('\n') + '\n', 'utf8');
      files.push(out);
      log(`  → ${rel(out).padEnd(44)} ${String(body.length).padStart(4)} 行  挪动 ${stats.moved} 顶点`
        + `  轨行 ${String(stats.rails).padStart(3)} ×${fam.railPasses.length}`
        + `  bbox x[${stats.x0.toFixed(4)}, ${stats.x1.toFixed(4)}] y[${stats.y0.toFixed(4)}, ${stats.y1.toFixed(4)}]`);
    }
  }
  return files;
}

// =============================================================================
// 第四节：A19 组（`DBDA`）＋ A23 组（`BBDA`）—— 只换枕木：`SLE-1` → `SLE-2`
//
//   覆盖 `DBDA`（CSV：1435/1520mm · 25kV AC · 1980 · 120km/h · 25t）
//        `BBDA`（CSV：1520mm      · 25kV AC · 1950 · 120km/h · 25t）
//   与第三节的两族**只差枕木**：道床 `BAL-K` / 钢轨 `RAI-5`（四根）/ `RAI-9`（两根）
//   / 洞口 `TUN-8` 全部逐面沿用，只把木枕（`SLE-1`）换成 Ⅱ 型混凝土枕（`SLE-2`）。
//
// -----------------------------------------------------------------------------
// 【做法：与 A16 / A17 同一套「拼装」，但底板已经是加宽后的产物】
//
//   ① 底板 = **第三节的产物**（`models/G19_*.model` / `G20_*.model`） —— 它已经是
//      「G1 的几何 × 10/9 + 宽轨钢轨」，道砟 / 坡度 / 岔口并集 / 洞门 / 钢轨全在里面。
//   ② 枕木 = `models/G3_*.model`（A3 = `BAL-A` + `SLE-2`）里 **`SLE-2` 那一层**，
//      用**第三节的同一个 `xformW`**（道床 ×10/9）变换后贴上去。
//   ③ 洞内枕木**不能**从 `G3_tunnel3*` 借（TUN-3 的洞门也是 `concrete`），
//      改用 `G2_tunnel2_stone*`（A2 = TUN-2 + `SLE-2`）—— 它**就是**本族的洞门族
//      （`TUN-8` = TUN-2 ×10/9），洞内轨道层的切片方式与底板**同源**，
//      而且 A4 那一轮已经验证过它的 `concrete / concrete_seam / trim_dark` 闸门
//      只圈住洞内枕木、不会削到洞门（洞门是 `concrete_dark` + 4 面 `panel_seam`）。
//
//   ⚠ **闸门**（沿用 A16 生成器，实测零冲突）：
//        SLE-1 = `wood_dark` / `wood_seam`   ← 从底板删掉
//        SLE-2 = `concrete` / `concrete_seam` / `trim_dark`  ← 从 G3 / G2 借
//      `G19_*` / `G20_*` 全部 28 件里 `concrete*` / `trim_dark` 一个都没有
//      （实测材质表：gravel wood_dark wood_seam rust metal stone_dark trim_black
//       metal_seam panel_seam concrete_dark dirt）；反方向 `wood*` 在 `G3_*` / `G2_*` 里也没有。
//
//   ⚠ **一个已知的 0.7 px 偏差（接受）**：`SLE-2` 的 U 形承轨槽按准轨 ±0.0516 做，
//     整层 ×10/9 后槽落到 ±0.0573，而本族两根轨在 ±0.0516（1435）与 ±0.0547（1520）。
//     ⇒ 槽落在**外侧那根轨的外面**约 0.0026 格 = 0.33 px。要精确对位就得「只拉长枕木、
//     不动槽」，那不是仿射变换（得逐个面改），而 0.33 px 在 1x 下是 0.08 px —— 接受，记账。
//
//   ⚠ **平交道口仍然 `noWiden`**：那一条的枕木在底板里就是 0.18（砟带由公路开口定），
//     所以借来的枕木也要按 s = 1 放，不能跟着 ×10/9。
// =============================================================================

/** A16 生成器的闸门：SLE-1（木枕）与 SLE-2（Ⅱ 型混凝土枕） */
const SLE1_MAT = /^wood(_dark|_seam)?$/;
const SLE2_MAT = /^(concrete|concrete_seam|trim_dark)$/;
const FACE_KW = /^(box|quad|prism|poly)$/;

const MOD_FAMS = [
  {
    id: 'A19', prefix: 'G21', base: 'G19', tunnel: 'tunnel8wide', rails: '`RAI-5`',
    codes: '`DBDA` 电气化准轨-俄罗斯宽轨套轨 · 25kV AC · 1980 · 120km/h',
  },
  {
    id: 'A23', prefix: 'G22', base: 'G20', tunnel: 'tunnel8broad', rails: '`RAI-9`',
    codes: '`BBDA` 电气化俄罗斯宽轨 · 25kV AC · 1950 · 120km/h',
  },
];

/** 地面件：与第三节同名同参；`sl` = 借枕木的源（G3 = A3 的 SLE-2） */
const MOD_JOBS = [
  { name: 'track_x', kind: 'y', over: true, sl: 'G3_track_x',
    note: 'underlay 槽 0/1（RTO_X / RTO_Y）：加宽道床 + Ⅱ 型混凝土枕 + 宽轨钢轨' },
  { name: 'rail_straight', kind: 'y', over: true, sl: 'G3_rail_straight',
    note: 'overlay 槽 0/1：钢轨层（透明底，钢轨 + 枕木）' },
  { name: 'track_half', kind: 'diag', over: true, sl: 'G3_track_half',
    note: 'underlay 槽 2-5（RTO_N / S / E / W）：切 N 角的半格宽轨' },
  { name: 'rail_half', kind: 'diag', over: true, sl: 'G3_rail_half',
    note: 'overlay 槽 2-5：半格轨的钢轨层' },
  { name: 'track_slope', kind: 'y', over: false, sl: 'G3_track_slope',
    note: 'underlay 槽 6-9：坡道（z 已含 RISE，只横向加宽，沿轨不探出）' },
  { name: 'rail_slope', kind: 'y', over: false, sl: 'G3_rail_slope',
    note: 'overlay 槽 6-9：坡道的钢轨层' },
  { name: 'crossing', kind: 'cross', over: true, edge: CROSS_EDGE, sl: 'G3_crossing',
    note: 'underlay 槽 10（RTO_CROSSING_XY）：交叉，自带两组钢轨' },
  { name: 'junction3', kind: 'cross', over: true, edge: CROSS_EDGE, sl: null,
    note: 'underlay 槽 11-14：三向道岔（只有道床板，没有枕木）' },
  { name: 'junction4', kind: 'cross', over: true, edge: CROSS_EDGE, sl: null,
    note: 'underlay 槽 15：四向道岔（只有道床板）' },
  { name: 'levelcrossing', kind: 'y', over: true, noWiden: true, sl: 'G3_levelcrossing',
    note: 'level_crossings 的轨道图（v0 → X 槽、v3 → Y 槽）—— 道床与枕木都**不放大**' },
];

/** 洞口件：`tunnels:` 两层借 `G2_tunnel2_stone*` 的 SLE-2；`tunnel_overlay:` 两层无轨道 */
const MOD_TUNNELS = [
  { suf: '', base: 'G2_tunnel2_stone', note: 'tunnels: 组（A 组：远半）' },
  { suf: '_b', base: 'G2_tunnel2_stone_b', note: 'tunnels: 组（B 组：近半）' },
  { suf: '_over', base: null, note: 'tunnel_overlay: 组（A 组：近半 + 洞顶）—— 不含轨道，逐字照抄' },
  { suf: '_over_b', base: null, note: 'tunnel_overlay: 组（B 组：远半 + 洞顶）—— 逐字照抄' },
];

/** 取若干行的 x/y/z 外接框（用于「借来的枕木落在原来的位置没有」这条自检） */
function bboxOf(lines) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const raw of lines) {
    const t = raw.trim().split(/\s+/);
    const put = (x, y, z) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      if (Number.isFinite(z)) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    };
    if (t[0] === 'box') { put(+t[1], +t[2], +t[3]); put(+t[4], +t[5], +t[6]); }
    else if (t[0] === 'quad') { for (let i = 0; i < 4; i++) put(+t[1 + i * 3], +t[2 + i * 3], +t[3 + i * 3]); }
    else if (t[0] === 'prism' || t[0] === 'poly') {
      const at = t[0] === 'prism' ? 4 : 3;
      if (t[0] === 'prism') { z0 = Math.min(z0, +t[1]); z1 = Math.max(z1, +t[2]); }
      else { z0 = Math.min(z0, +t[1]); z1 = Math.max(z1, +t[1]); }
      for (const p of t.slice(at)) { const [a, b] = p.split(','); put(+a, +b, NaN); }
    }
  }
  return { x0, x1, y0, y1, z0, z1 };
}

function headerForMod(fam, job, stats) {
  return [
    '# =============================================================================',
    `# ${job.dst} —— ${fam.id} 组（${fam.codes}）· ${job.note}`,
    '#',
    '# 【本文件由 tools/gen-a15-narrow.mjs 的**第四节**生成，请勿手改】',
    `#   底板 = models/${job.base}.model（= 第三节的产物：BAL-K 加宽道床 + ${fam.rails} + TUN-8）`,
    job.sl
      ? `#   枕木 = models/${job.sl}.model 里的 SLE-2（${SLE2_MAT.source}），同一个 xformW 加宽`
      : '#   枕木 = 无（这件本来就没有枕木层）',
    `#   删掉底板的 SLE-1 = ${stats.dropped} 面（wood_dark / wood_seam），换成 SLE-2 = ${stats.added} 面`,
    `#   kind=${job.kind}、沿轨探出 OVER=${OVER} 格${job.over ? '' : '（本件**不探出**）'}`
      + `${job.noWiden ? '、**道床与枕木都不放大**（平交道口）' : ''}`,
    stats.align
      ? `#   对位自检：借来的枕木与原来的木枕 bbox 偏差 Δx=${stats.align.dx} Δy=${stats.align.dy} Δz=${stats.align.dz}`
      : '#   对位自检：本件没有枕木层',
    '#   拼装口径与「承轨槽 0.33 px 偏差」见本工具第四节文件头。',
    '# =============================================================================',
    '',
  ].join('\n');
}

export function generateModern() {
  const files = [];
  for (const fam of MOD_FAMS) {
    const jobs = [
      ...MOD_JOBS.map((j) => ({
        ...j, base: `${fam.base}_${j.name}`, dst: `${fam.prefix}_${j.name}`,
      })),
      ...MOD_TUNNELS.map((t) => ({
        ...t, kind: 'tunnel', over: true, edge: ARCH_EDGE, sl: t.base,
        base: `${fam.base}_${fam.tunnel}${t.suf}`, dst: `${fam.prefix}_${fam.tunnel}${t.suf}`,
      })),
    ];

    for (const job of jobs) {
      const srcPath = path.join(ROOT, 'models', `${job.base}.model`);
      if (!fs.existsSync(srcPath)) {
        log(`  × 跳过 ${job.dst}：底板 ${job.base}.model 不存在`);
        continue;
      }
      const srcText = fs.readFileSync(srcPath, 'utf8').split('\n');
      const head = srcText.filter((l) => /^(name|group|footprint|zmax)\s/.test(l));
      const src = srcText.filter((l) => FACE_KW.test(l.trim().split(/\s+/)[0]));

      const kept = [];
      const droppedLines = [];
      for (const raw of src) {
        if (SLE1_MAT.test(matOfLine(raw))) { droppedLines.push(raw); continue; }
        kept.push(raw);
      }

      const sleeperLines = [];
      let clipped = 0;
      if (job.sl) {
        const slPath = path.join(ROOT, 'models', `${job.sl}.model`);
        if (!fs.existsSync(slPath)) {
          log(`  × 跳过 ${job.dst}：枕木源 ${job.sl}.model 不存在`);
          continue;
        }
        const slFaces = fs.readFileSync(slPath, 'utf8').split('\n')
          .filter((l) => FACE_KW.test(l.trim().split(/\s+/)[0]))
          .filter((l) => SLE2_MAT.test(matOfLine(l)));
        // ★ 借来的枕木层必须落在「原来那层木枕的外接框」里 —— 否则会在切角处戳出砟带。
        //   实测只有斜向件（`track_half` / `rail_half`）会：A3 的斜向件把**切角那条边**
        //   也按 OVER/√2 探了出去（它自己整件外移 0.0221 格），而本族的底板
        //   （`probe_half_upper` 系）没有 —— 借过来再加宽 10/9 就变成 0.035 格（4.5 px）戳出。
        //   判据：逐面比外接框，超出容差 0.003 格的一律丢掉（等价于退回到 probe 的切角口径）。
        const TOL = 0.003;
        const woodBox = droppedLines.length ? bboxOf(droppedLines) : null;
        for (const raw of slFaces) {
          const line = xformLine(job, raw, xformW).line;
          if (woodBox) {
            const b = bboxOf([line]);
            const outside = b.x0 < woodBox.x0 - TOL || b.x1 > woodBox.x1 + TOL
              || b.y0 < woodBox.y0 - TOL || b.y1 > woodBox.y1 + TOL;
            if (outside) { clipped++; continue; }
          }
          sleeperLines.push(line);
        }
        if (!slFaces.length) log(`  ⚠ ${job.dst}：${job.sl} 里没有 SLE-2 面`);
      }

      // 对位自检：原来的木枕 vs 贴上去的 SLE-2（bbox 差值）
      let align = null;
      if (droppedLines.length && sleeperLines.length) {
        const a = bboxOf(droppedLines), b = bboxOf(sleeperLines);
        align = {
          dx: `${(b.x0 - a.x0).toFixed(4)}/${(b.x1 - a.x1).toFixed(4)}`,
          dy: `${(b.y0 - a.y0).toFixed(4)}/${(b.y1 - a.y1).toFixed(4)}`,
          dz: `${(b.z0 - a.z0).toFixed(4)}/${(b.z1 - a.z1).toFixed(4)}`,
        };
      }

      const body = [...kept, ...sleeperLines];
      const group = head.find((l) => /^group\s/.test(l)) || 'group     misc';
      const footprint = head.find((l) => /^footprint\s/.test(l)) || 'footprint 1 1';
      const zmax = head.find((l) => /^zmax\s/.test(l)) || 'zmax      0.0280';

      const stats = { dropped: droppedLines.length, added: sleeperLines.length, align };
      const out = path.join(ROOT, 'models', `${job.dst}.model`);
      fs.writeFileSync(out, headerForMod(fam, job, stats)
        + `name      ${job.dst}\n${group.trimEnd()}\n${footprint.trimEnd()}\n${zmax.trimEnd()}\n\n`
        + body.join('\n') + '\n', 'utf8');
      files.push(out);
      log(`  → ${rel(out).padEnd(48)} 面 ${String(body.length).padStart(4)}`
        + `（删 ${String(droppedLines.length).padStart(3)} / 加 ${String(sleeperLines.length).padStart(3)}）`
        + (align ? `  对位 Δx=${align.dx} Δy=${align.dy} Δz=${align.dz}` : ''));
    }
  }
  return files;
}

if (isMain(import.meta.url)) {
  const t0 = Date.now();
  log(`生成 A15 组（NACN 窄轨）模型：k = ${K}（米轨 1000mm）、OVER = ${OVER}`);
  const files = generate();
  log(`✔ 生成 ${files.length} 个模型，用时 ${((Date.now() - t0) / 1000).toFixed(2)} s`);

  const t1 = Date.now();
  log(`生成 A24 组（dBCN 准轨-窄轨套轨）模型：道床 ×${W_BED.toFixed(4)}、内侧轨距 k = ${K}`);
  const files24 = generateA24();
  log(`✔ 生成 ${files24.length} 个模型，用时 ${((Date.now() - t1) / 1000).toFixed(2)} s`);

  const t2 = Date.now();
  log(`生成 A18 / A22 组（宽轨）模型：道床 ×${W_BED.toFixed(4)}、钢轨横向 S = ${S_BROAD.toFixed(6)}`
    + `（A18 四根 = [1, S]、A22 两根 = [S]）`);
  const filesW = generateWide();
  log(`✔ 生成 ${filesW.length} 个模型，用时 ${((Date.now() - t2) / 1000).toFixed(2)} s`);

  const t3 = Date.now();
  log('生成 A19 / A23 组（宽轨电气化）模型：底板 = A18 / A22 产物，枕木换 SLE-2');
  const filesM = generateModern();
  log(`✔ 生成 ${filesM.length} 个模型，用时 ${((Date.now() - t3) / 1000).toFixed(2)} s`);
  log('  下一步：make render → 抄模板 → make check');
}
