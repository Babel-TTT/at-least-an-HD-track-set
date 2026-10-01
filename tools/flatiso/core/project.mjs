// 固定 2:1 等距正交投影。**口径对齐 OpenTTD 的 RemapCoords**。
//
//   screen_x = (y - x) * HW
//   screen_y = (x + y) * HH - z * zPx
//
// 其中 HW = tilePx/2、HH = tilePx/4。于是 1x1 世界格投成
// tilePx 宽 × tilePx/2 高的菱形（**严格 2:1**）：
// 瓦片的一条边水平跨 tilePx/2 = 128 px，整个 1x1 瓦片横跨 256 px。
//
// 与 OpenTTD 的关系：OpenTTD 里一个瓦片是 16 个世界单位，
// `RemapCoords(x,y,z) = (2*(y-x), (x+y) - z)`，即一瓦片 = 32×16 px。
// 本管线取 tilePx = 256（= OpenTTD 原版 64px 瓦片的 4 倍，正好是 4× 额外缩放档），
// 但**轴向符号完全一致**：
// **+x 朝屏幕左下、+y 朝屏幕右下**，正面朝 +y（右下那一面）。
// 于是精灵可以按 RemapCoords 的结果直接摆到 OpenTTD 风格的地图上，
// 不需要额外镜像。想换成相反的手性用 `mirror: true`。
//
// zPx 的取值不是随手挑的
// ----------------------
// 要求"2:1 的菱形 + 真正的正交相机"，就唯一确定了竖直方向的缩放。
// 设相机方位角 45°、仰角 φ（从水平面算），整体缩放 S：
//     screen_x = S/√2 · (x - y)                         → S = HW·√2
//     screen_y = S·(cosφ/√2·(x+y) - sinφ·z)
// 2:1 要求 x+y 的系数等于 HH：HW·cosφ = HW/2  →  cosφ = 1/2，仰角恰为 30°。
// 于是
//     zPx = S·sinφ = HW·√2·(√3/2) = HW·√6/2 ≈ 156.767（tilePx=256 时）
// 这时一个 1x1x1 的立方体三条棱才会等长，房顶、烟囱的高度比例才不失真。
// 传更小的 zPx（例如 128）会得到"压扁"的观感 —— 那是风格选择，不是几何正确。

import { norm } from './vec.mjs';

export const DEFAULT_TILE_PX = 256;

export function makeView(opts = {}) {
  const tilePx = opts.tilePx ?? DEFAULT_TILE_PX;
  const HW = tilePx / 2;
  const HH = tilePx / 4;
  const zPx = opts.zPx ?? (HW * Math.sqrt(6)) / 2;
  const mirror = !!opts.mirror;
  const sgn = mirror ? -1 : 1;

  const project = (x, y, z) => [sgn * (y - x) * HW, (x + y) * HH - z * zPx];

  // 投影为 (0,0) 的那个世界方向（由场景指向相机）。
  const viewAxis = norm([1, 1, (2 * HH) / zPx]);
  // 深度：越靠近观察者的点越大。
  const depthK = (2 * HH) / zPx;
  const depth = (x, y, z) => x + y + depthK * z;

  return {
    tilePx,
    HW,
    HH,
    zPx,
    depthK,
    mirror,
    viewAxis,
    project,
    depth,
    /** 世界格角点 (tx,ty) 在屏幕上的位置（z=0）。 */
    tileToScreen: (tx, ty) => [sgn * (ty - tx) * HW, (tx + ty) * HH],
    /** 朝向 r 的方位角（度）。 */
    azimuth: (r, step) => (r * step) % 360,
  };
}

/**
 * 逐个朝向的相机旋转量。定义为绕世界 Z 轴旋转**模型**，等价于反向旋转相机；
 * 用 90° 的整数倍时占地仍然是整瓦片，所以 4 个朝向最省事。
 */
export function rotationAngle(r, step) {
  return (r * step * Math.PI) / 180;
}
