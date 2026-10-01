// 材质颗粒（grain）：一层极低幅度的逐像素噪点，让平的墙面读起来"有材料"。
//
// 为什么必须挪到输出像素上算
// ------------------------
// 最省事的写法是在光栅内层循环里直接乘 —— 那里本来就有逐像素的世界坐标。
// 但那是**子样本**分辨率：ss=3 时每输出像素有 9 个子样本，颗粒会被平均掉一部分，
// 结果是**噪点强度随 ss 变化**（换 --ss 2 图就变了），斜面上还会起摩尔纹。
//
// 所以这里的做法是：在解析阶段，用「像素中心的屏幕位置 + 该面的平面方程」
// 反解出这个像素的世界坐标，再采样。于是颗粒严格锁定在输出像素网格上，
// 与 ss 无关，也不会有子样本混叠。
//
// 颗粒锚定在**世界空间**（不是屏幕空间），所以它跟着模型旋转 ——
// 同一面墙在四个朝向里是同一片颗粒，不会"游"。

/** 3D 整数哈希 → [0,1)。确定性，不用 Math.random。 */
function h3(i, j, k) {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b9);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * @param {number} scale 颗粒胞元边长（世界单位）。tilePx=256 时，
 *   1 个输出像素约等于 0.0070 世界单位（水平 143 px/单位、竖直 157 px/单位）。
 * @param {number} amp   最大偏移比例，例如 0.045 = ±4.5%
 * @param {boolean} twoOctave 叠一层 4 倍粗的，避免纯白噪声太"电子"
 * @returns {number} 乘性系数，落在 [1-amp, 1+amp]
 */
export function grainAt(x, y, z, scale, amp, twoOctave) {
  let v = h3(Math.floor(x / scale), Math.floor(y / scale), Math.floor(z / scale)) - 0.5;
  if (twoOctave) {
    const s2 = scale * 4;
    v = v * 0.72 + (h3(Math.floor(x / s2), Math.floor(y / s2), Math.floor(z / s2)) - 0.5) * 0.56;
  }
  return 1 + amp * 2 * v;
}

export function makeGrain(o = {}) {
  const g = {
    enabled: o.enabled !== false,
    scale: o.scale ?? 0.0072,
    amount: o.amount ?? 1,        // 总幅度倍率，方便一次性整体加减
    twoOctave: o.twoOctave ?? true,
  };
  g.enabled = g.enabled && g.amount > 0;
  return g;
}

export const NO_GRAIN = makeGrain({ enabled: false });
