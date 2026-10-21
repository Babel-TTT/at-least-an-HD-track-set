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

/** 道床面：z_max ≤ 0.0065（实测 A3 的道砟带最高 0.0061；轨枕最低 0.0075） */
export function isBedFace(line) {
  const t = quadTokens(line);
  if (!t) return false;
  const z = quadZMax(t);
  return z > 0 && z <= 0.0065;
}

// =============================================================================
// 洞内道床的「素面近似」—— 人工 2026-10-21 第二轮：
//   「SFCA,SECA,SDCA 没改」⇒ 四条 `S_CA` 共用同一个洞口，洞内道床还是同一块素灰板，
//   没有各自的**板缝 / 砟肩堆高 / 纵缝 / 承轨台**。
//
//   ⚠ 这里是**近似**：洞内 1 格长的直线段，坡面一律做成**平顶台阶**（不做斜顶面，
//     `box` 做不出斜面）。**如实登记**：视觉特征（缝 / 埂 / 台）齐了，坡面的斜面没有。
//   数值全部取自各自的生成器（§1.1 的规格），不是新发明的数：
//     `BAL-E`（A8）板顶 0.0078 · 板缝每 1/3 格（宽 0.0100 / 深 0.0028 ⇒ 缝底 0.0050）· 凸形挡台 0.036 见方 / 顶 0.0218
//     `BAL-F`（A9）板顶 0.0078 · 横向宽接缝每 1 格（在瓦片边上，洞里看不到）· **板面正中一条沿轨纵缝**（宽 0.0100 / 深 0.0028）· 无挡台
//     `BAL-N`（A25）道心 0.0078 · 砟肩外沿 0.0188 · 坡脚 0.1644（d = |y−0.5|）· 材质 `granite_grey`
//     `BAL-G`（A10）低带 0.0025 · 承轨台 0.0100（台宽 0.040，居中于钢轨）· 材质 `concrete_mid`
// =============================================================================
const BED_BAND = [0.32, 0.68];          // 与全包一致的带宽 0.36 格
const RAIL_C = [0.4484, 0.5516];

export function emitBedLite(L, kind) {
  const [Y0, Y1] = BED_BAND;
  const box = (x0, y0, z0, x1, y1, z1, mat, top) =>
    L.push(`box ${fmt(x0)} ${fmt(y0)} ${fmt(z0)}  ${fmt(x1)} ${fmt(y1)} ${fmt(z1)}  ${mat}${top ? ' top=' + top : ''}`);

  if (kind === 'bal-e') {
    // 板分 3 段（缝在 1/3、2/3）+ 缝底 + 凸形挡台
    const J = [1 / 3, 2 / 3], JW = 0.0050;          // 缝半宽 = 0.0100 / 2
    const bounds = [0, ...J.flatMap((j) => [j - JW, j + JW]), 1];
    for (let i = 0; i + 1 < bounds.length; i += 1) {
      const a = bounds[i], b = bounds[i + 1];
      if (i % 2 === 1) continue;                     // 缝那两段单独发
      box(a, Y0, 0, b, Y1, 0.0078, 'concrete_mid', 'concrete_mid');
    }
    for (const j of J) box(j - JW, Y0, 0, j + JW, Y1, 0.0050, 'panel_seam', 'panel_seam');
    // 凸形挡台：每个缝位、两侧各一块（0.036 见方，顶 0.0218）
    for (const j of J) for (const yc of [Y0 + 0.018, Y1 - 0.018]) {
      box(j - 0.018, yc - 0.018, 0.0078, j + 0.018, yc + 0.018, 0.0218, 'concrete_mid', 'concrete_mid');
    }
  } else if (kind === 'bal-f') {
    // 板 + 正中一条沿轨纵缝（宽 0.0100 / 深 0.0028）
    box(0, Y0, 0, 1, 0.495, 0.0078, 'concrete_mid', 'concrete_mid');
    box(0, 0.505, 0, 1, Y1, 0.0078, 'concrete_mid', 'concrete_mid');
    box(0, 0.495, 0, 1, 0.505, 0.0050, 'panel_seam', 'panel_seam');
  } else if (kind === 'bal-n') {
    // 有砟·砟肩堆高：平顶台阶近似（道心 / 两道埂 / 坡脚各一档）
    const STEPS = [
      [0.3356, 0.3685, 0.0060],
      [0.3685, 0.4044, 0.0188],
      [0.4044, 0.5956, 0.0078],
      [0.5956, 0.6315, 0.0188],
      [0.6315, 0.6644, 0.0060],
    ];
    for (const [a, b, z] of STEPS) box(0, a, 0, 1, b, z, 'granite_grey', 'granite_grey');
  } else if (kind === 'bal-g') {
    // 无砟·CRTS III：低带 0.0025 + 两条承轨台 0.0100
    box(0, Y0, 0, 1, Y1, 0.0025, 'concrete_mid', 'concrete_mid');
    for (const c of RAIL_C) box(0, c - 0.0200, 0, 1, c + 0.0200, 0.0100, 'concrete_mid', 'concrete_mid');
  } else {
    throw new Error(`未知的洞内道床口径 bed=${kind}`);
  }
}
