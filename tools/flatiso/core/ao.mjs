// 离线烘焙的环境光遮蔽（AO）。
//
// 做法很朴素：对每个**空间位置**（不是每个顶点 —— 顶点是按面复制的，
// 按顶点算会让相邻面的公共棱上出现明暗错缝），在法线半球上打一圈低差异
// 光线，沿光线步进检测是否撞到其它图元的 AABB。撞到就越近越黑。
//
// 两个刻意的取舍：
//  * 只对**轴对齐包围盒**求交。手写模型的图元本来就是盒子/棱柱为主，
//    盒级遮挡已经能抓到"屋檐下""两翼之间""院子里"这些主要暗部，
//    而 AABB 求交极快，整栋楼的 AO 是毫秒级的。
//  * 结果只是**乘性系数**，由 look.aoStrength 缩放后才生效。要求是"轻微 AO"，
//    所以默认只压 30%，而且直射光被压得更少（见 raster.mjs）。

import { norm } from './vec.mjs';

// 半球采样方向：黄金角螺旋，避免明显的带状条纹。
function hemiDirs(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const phi = Math.acos(1 - t * 0.995);
    const th = i * 2.399963229728653;
    out.push([Math.sin(phi) * Math.cos(th), Math.sin(phi) * Math.sin(th), Math.cos(phi)]);
  }
  return out;
}

const ORTHO = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** 用任意单位向量构造正交基。 */
function basis(n) {
  const ax = Math.abs(n[0]);
  const ref = ax < 0.9 ? ORTHO[0] : ORTHO[1];
  const b = norm([
    n[1] * ref[2] - n[2] * ref[1],
    n[2] * ref[0] - n[0] * ref[2],
    n[0] * ref[1] - n[1] * ref[0],
  ]);
  const t = norm([
    n[1] * b[2] - n[2] * b[1],
    n[2] * b[0] - n[0] * b[2],
    n[0] * b[1] - n[1] * b[0],
  ]);
  return [b, t];
}

function buildGrid(boxes, cell) {
  const map = new Map();
  const key = (i, j, k) => i * 73856093 + j * 19349663 + k * 83492791;
  boxes.forEach((b, bi) => {
    const i0 = Math.floor(b.mn[0] / cell), i1 = Math.floor(b.mx[0] / cell);
    const j0 = Math.floor(b.mn[1] / cell), j1 = Math.floor(b.mx[1] / cell);
    const k0 = Math.floor(b.mn[2] / cell), k1 = Math.floor(b.mx[2] / cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (let k = k0; k <= k1; k++) {
          const kk = key(i, j, k);
          const arr = map.get(kk);
          if (arr) arr.push(bi); else map.set(kk, [bi]);
        }
      }
    }
  });
  return { map, cell, key };
}

const inside = (b, x, y, z, pad) =>
  x > b.mn[0] + pad && x < b.mx[0] - pad &&
  y > b.mn[1] + pad && y < b.mx[1] - pad &&
  z > b.mn[2] + pad && z < b.mx[2] - pad;

/**
 * 烘焙逐顶点 AO。就地写入 `mesh.ao`。
 * @param {import('./mesh.mjs').Mesh} mesh
 * @param {{rays?:number,dist?:number,steps?:number,cell?:number}} opts
 */
export function bakeAO(mesh, opts = {}) {
  const rays = opts.rays ?? 20;
  const dist = opts.dist ?? 0.9;
  const steps = opts.steps ?? 16;
  const cell = opts.cell ?? 0.25;
  const bias = opts.bias ?? 0.012;
  const nv = mesh.ao.length;

  if (!mesh.occluders.length) { mesh.ao.fill(1); return mesh; }

  const grid = buildGrid(mesh.occluders, cell);
  const dirs = hemiDirs(rays);

  // 按位置分组：把坐标量化到 1e-3 网格做键，位置相同的顶点共用一次计算。
  const groups = new Map();
  for (let i = 0; i < nv; i++) {
    const x = mesh.pos[i * 3], y = mesh.pos[i * 3 + 1], z = mesh.pos[i * 3 + 2];
    const k = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
    let g = groups.get(k);
    if (!g) { g = { x, y, z, verts: [], nx: 0, ny: 0, nz: 0 }; groups.set(k, g); }
    g.verts.push(i);
  }
  // 位置处的平均法线（按面共享顶点累加即可，不必加权 —— 只求方向）
  for (const f of mesh.faces) {
    for (const vi of f.v) {
      const k = `${Math.round(mesh.pos[vi * 3] * 1000)},${Math.round(mesh.pos[vi * 3 + 1] * 1000)},${Math.round(mesh.pos[vi * 3 + 2] * 1000)}`;
      const g = groups.get(k);
      if (!g) continue;
      g.nx += f.n[0]; g.ny += f.n[1]; g.nz += f.n[2];
    }
  }

  for (const g of groups.values()) {
    const nl = Math.hypot(g.nx, g.ny, g.nz);
    const n = nl < 1e-6 ? [0, 0, 1] : [g.nx / nl, g.ny / nl, g.nz / nl];
    const [b1, b2] = basis(n);
    const ox = g.x + n[0] * bias, oy = g.y + n[1] * bias, oz = g.z + n[2] * bias;

    // 顶点所在的那个盒子要跳过（否则所有表面都会自己遮自己）
    const gk = grid.key(Math.floor(g.x / cell), Math.floor(g.y / cell), Math.floor(g.z / cell));
    let self = -1;
    const here = grid.map.get(gk);
    if (here) for (const bi of here) if (inside(mesh.occluders[bi], g.x, g.y, g.z, 0.006)) { self = bi; break; }

    let occ = 0, wsum = 0;
    for (let r = 0; r < rays; r++) {
      const d = dirs[r];
      const dx = d[0] * b1[0] + d[1] * b2[0] + d[2] * n[0];
      const dy = d[0] * b1[1] + d[1] * b2[1] + d[2] * n[1];
      const dz = d[0] * b1[2] + d[1] * b2[2] + d[2] * n[2];
      const nd = dx * n[0] + dy * n[1] + dz * n[2];
      if (nd <= 0.02) continue;
      const w = nd * d[2] > 0 ? nd * (0.35 + 0.65 * d[2]) : nd * 0.35;
      wsum += w;
      for (let s = 1; s <= steps; s++) {
        const t = (s / steps) * dist;
        const sx = ox + dx * t, sy = oy + dy * t, sz = oz + dz * t;
        if (sz < -0.001) break;                       // 地面以下不再有意义
        const arr = grid.map.get(grid.key(Math.floor(sx / cell), Math.floor(sy / cell), Math.floor(sz / cell)));
        if (!arr) continue;
        let hit = false;
        for (const bi of arr) {
          if (bi === self) continue;
          const b = mesh.occluders[bi];
          if (sx > b.mn[0] && sx < b.mx[0] && sy > b.mn[1] && sy < b.mx[1] && sz > b.mn[2] && sz < b.mx[2]) { hit = true; break; }
        }
        if (hit) { occ += w * (1 - (s - 1) / steps); break; }
      }
    }
    const a = wsum > 0 ? 1 - occ / wsum : 1;
    const v = a < 0.05 ? 0.05 : a > 1 ? 1 : a;
    for (const vi of g.verts) mesh.ao[vi] = v;
  }
  return mesh;
}

/**
 * 接地遮蔽：离地越近越暗一点点。这是纯粹的造型手段 —— 让建筑"坐"在地上，
 * 而不是飘着。`floor` 是贴在 z=0 处的系数，`height` 是衰减高度（世界单位）。
 */
export function bakeContact(mesh, floor = 0.86, height = 0.10, power = 1.0) {
  for (let i = 0; i < mesh.ao.length; i++) {
    const z = mesh.pos[i * 3 + 2];
    const t = z <= 0 ? 0 : z >= height ? 1 : z / height;
    const k = floor + (1 - floor) * Math.pow(t, power);
    mesh.ao[i] *= k;
  }
  return mesh;
}
