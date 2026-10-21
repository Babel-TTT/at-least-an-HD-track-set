// =============================================================================
// tools/tunnel-inner.mjs —— 洞口模型里「洞内轨道」的识别与重发（共 3 支变体用）
//
// 人工 2026-10-21：「怎么 SCCA, SDCA, SECA, SFCA, SDDA 的隧道图像里的轨道样式和
//   实际普通的轨道样式不同？」→ 查到根因：**洞口是 A10 从 A3 的 `G3_tunnel3` 派生的，
//   洞内的轨道（枕木 + 钢轨）从来没重发过** ⇒ 一直是 A3 那套 `SLE-2`（枕长 0.18、
//   挡肩 `concrete` 亮白、槽底 `trim_dark` 黑），而外面是 `SLE-3` 宽枕
//   （枕长 0.19、挡肩顶 `metal_pale` 冷白、槽底 `panel_seam`）；`SDDA` 用的 `TUN-3`
//   更原始，连钢轨都还是 `RAI-1` 的 `rust`/`metal`。
//
// 本模块做两件事（**只碰洞内轨道，洞门结构一个顶点不动**）：
//   ① `sleeperSlots()` —— 从源模型的 quad 行里认出洞内枕木，给出 25 个「槽位」的
//      `[x0, x1]`（枕木沿 x 的厚度范围；枕木沿 y 恒为 0.410…0.590 = SLE-2 的 0.18 长）
//   ② `emitSleeper3()` / `emitSleeper4()` —— 按目标轨枕口径**重发**枕木
//
// ★ 判据为什么是「面」的 z_max ∈ [0.0070, 0.0105]：
//   源洞口模型是**整格**模型，同一个文件里既有洞门、也有道床、轨枕、钢轨。
//   实测（`G3_tunnel3*` / `G8_tunnel4*` 逐面统计）：
//     · 道床（源 `BAL-A`）面的 z_max ≤ **0.0061**
//     · 轨枕面的 z_max ∈ {0.0075, 0.0087, 0.0095, **0.0100**}
//     · 钢轨面的 z_max = **0.0230**（轨顶，全包硬约束）
//     · 洞门结构最低的顶面 = 0.0450
//   ⇒ 窗口 [0.0070, 0.0105] **只框住轨枕**，两头都留了余量。
//   ⚠ 与 `gen-a10-slab.mjs` 的 `PORTAL_ZMIN`（0.0300）是**两把不同的尺**：
//     那把分的是「洞内 / 洞门」，这把分的是「轨枕 / 道床+钢轨」。
//   ⚠ 必须按**面**取 z_max，不能按顶点（墙脚侧面从 z = 0 起）。
//
// ★ 槽位怎么从源里取：轨枕面全是 quad，每个洞内枕木的 5 条分带 + 底座共 4~5 个面，
//   但它们的 x 范围只有两个值（`x0` / `x1`）⇒ 把所有轨枕面的 x 端点汇总去重排序，
//   必然得到 50 个值 = 25 对 `[x0, x1]`（实测 `0.0040 … 0.9960`，厚 0.016、间距 0.04067）。
//   **不写死位置** —— 源换了（例如 A3 以后调了枕木相位）自动跟着走。
// =============================================================================

const fmt = (v) => Number(v).toFixed(4);
const N = (v) => Number(Number(v).toFixed(6));

/** 轨枕面的 z_max 窗口（见文件头 ★） */
export const SLEEPER_ZMAX = [0.0070, 0.0105];

/** 一行 `quad` 拆成 token；非 quad 返回 null */
function quadTokens(line) {
  const t = line.trim().split(/\s+/);
  return t[0] === 'quad' && t.length >= 14 ? t : null;
}

/** 一行 quad 的 z_max */
export function quadZMax(t) {
  let z = 0;
  for (let i = 0; i < 4; i++) z = Math.max(z, Number(t[3 + i * 3]));
  return z;
}

/** 这一面是不是洞内轨枕（按面 z_max 判，见文件头 ★） */
export function isInnerSleeper(line) {
  const t = quadTokens(line);
  if (!t) return false;
  const z = quadZMax(t);
  return z >= SLEEPER_ZMAX[0] && z <= SLEEPER_ZMAX[1];
}

/**
 * 从源模型的 quad 行里抽出洞内枕木的槽位（沿 x 的 `[x0, x1]`）。
 * 返回**升序**的 25 对（源换了会自动跟着走）。
 */
export function sleeperSlots(srcLines) {
  const xs = new Set();
  for (const line of srcLines) {
    if (!isInnerSleeper(line)) continue;
    const t = quadTokens(line);
    const x = [];
    for (let i = 0; i < 4; i++) x.push(N(Number(t[1 + i * 3])));
    xs.add(Math.min(...x));
    xs.add(Math.max(...x));
  }
  const list = [...xs].sort((a, b) => a - b);
  if (list.length % 2 !== 0) {
    throw new Error(`洞内枕木的 x 端点不是偶数个（${list.length}）—— 规则可能失效，先数面`);
  }
  const slots = [];
  for (let i = 0; i < list.length; i += 2) slots.push([list[i], list[i + 1]]);
  return slots.sort((a, b) => a[0] - b[0]);
}

/**
 * 按 `SLE-3`（混凝土宽枕 + U 形承轨槽）重发**一根**洞内枕木。
 *   数值逐条取自已装机的 A8/A25/A9 直向轨（`G9_track_x` 实测）：
 *     枕长 0.19（y 0.405…0.595）· 厚 0.016 · 底座 z 0→0.0075（`concrete_mid`，顶 `concrete_seam`）
 *     分带线 0.4300 / 0.4660 / 0.5340 / 0.5700（**与 SLE-2 同一条线**，所以槽正对钢轨）
 *       外侧两挡肩 → z 0.0100 `concrete_mid`，顶 `metal_pale`
 *       两个承轨槽 → z 0.0087 `panel_seam`
 *       中间体     → z 0.0095 `concrete_mid`
 */
export function emitSleeper3(L, x0, x1) {
  const box = (y0, y1, z0, z1, mat, top) =>
    L.push(`box ${fmt(x0)} ${fmt(y0)} ${fmt(z0)}  ${fmt(x1)} ${fmt(y1)} ${fmt(z1)}  ${mat}${top ? ' top=' + top : ''}`);
  box(0.4050, 0.5950, 0.0000, 0.0075, 'concrete_mid', 'concrete_seam');
  box(0.4050, 0.4300, 0.0075, 0.0100, 'concrete_mid', 'metal_pale');
  box(0.4300, 0.4660, 0.0075, 0.0087, 'panel_seam', 'panel_seam');
  box(0.4660, 0.5340, 0.0075, 0.0095, 'concrete_mid', 'concrete_mid');
  box(0.5340, 0.5700, 0.0075, 0.0087, 'panel_seam', 'panel_seam');
  box(0.5700, 0.5950, 0.0075, 0.0100, 'concrete_mid', 'metal_pale');
}

/**
 * 按 `SLE-4`（双块式：两块 + 中间连系杆的位置留空）重发**一个**洞内枕位。
 *   数值取自已装机的 A10 直向轨（`G8_track_x` 实测）：
 *     每块 y = 钢轨中心 ± 0.014 ⇒ 0.4344…0.4624 与 0.5376…0.5656 · z 0.0100→0.0175 · `concrete`
 *   ⚠ 洞内没有 A10 的 `BAL-G` 承轨台（那是道床那一层，本模块不动），
 *     所以两块**底面在 0.0100** —— 比洞内道床面（≈0.006）高 0.004 格 ≈ 0.5 px，看不出来。
 */
export function emitSleeper4(L, x0, x1) {
  const box = (y0, y1) =>
    L.push(`box ${fmt(x0)} ${fmt(y0)} 0.0100  ${fmt(x1)} ${fmt(y1)} 0.0175  concrete`);
  box(0.4344, 0.4624);
  box(0.5376, 0.5656);
}

/** `RAI-1` → `RAI-3` 的**钢轨换色**（只动材质字段，坐标一个数不动）
 *  `rust`（锈褐侧面）→ `metal_dark`；`metal`（暗银顶面）→ `metal_pale`。
 *  ⚠ 只喂**钢轨那一层**的行（判据见 `isRailFace`）。
 */
export function retintRailLine(line) {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'quad') return line;
  const mi = 13;
  let m = t[mi];
  if (m === 'rust') m = 'metal_dark';
  else if (m === 'metal') m = 'metal_pale';
  return [...t.slice(0, mi), m].join(' ');
}

/** 钢轨面：z_max = 0.0230（轨顶，全包硬约束）且材质是 `rust` / `metal` 系 */
export function isRailFace(line) {
  const t = quadTokens(line);
  if (!t) return false;
  if (Math.abs(quadZMax(t) - 0.0230) > 1e-3) return false;
  return ['rust', 'metal', 'metal_dark', 'metal_pale'].includes(t[13]);
}
