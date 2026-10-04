// 多边形网格容器 + 低层图元。
//
// 约定
// ----
// * 世界坐标：x 向东、y 向南、z 向上，单位是**瓦片**（1.0 = 一个 1x1 瓦片的边长）。
//   建筑占地的西北角格角点是 (0,0,0)，占地范围 [0,w]x[0,d]。
// * 多边形顶点环绕方向从**外侧看逆时针**，法线即由此推出（Newell 法，允许轻微非平面）。
// * 每个面带一个 `gid`（面组）：描边通道只在 gid 不同、或同 gid 内折角超过阈值时画线。
//   所以"哪里有线"是建模时决定的，不是渲染器强加的。
// * `occ` 为真的图元会往 `mesh.occluders` 里塞一个 AABB，供 AO 光线步进加速。

import { norm, sub, cross, dot } from './vec.mjs';

const EPS = 1e-9;

/** Newell 法求多边形法线（对非平面多边形也稳定）。 */
export function newell(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz);
  return l < EPS ? [0, 0, 1] : [nx / l, ny / l, nz / l];
}

export class Mesh {
  constructor(name = '') {
    this.name = name;
    this.pos = [];        // 顶点：x,y,z 展平
    this.ao = [];         // 每顶点遮蔽系数，1 = 完全没被遮
    this.faces = [];      // { v:[idx...], mat, n:[..], gid, noocc }
    this.occluders = [];  // AABB { mn:[x,y,z], mx:[x,y,z] }
    this.warn = [];
    this._gid = 0;
  }

  newGid() { return this._gid++; }

  vert(x, y, z) {
    this.pos.push(x, y, z);
    this.ao.push(1);
    return this.ao.length - 1;
  }

  /**
   * 加一个多边形面。
   * @param {number[]} idx   顶点索引（外看逆时针）
   * @param {string} mat     材质名
   * @param {{normal?:number[], gid?:number, noocc?:boolean}} [o]
   */
  face(idx, mat, o = {}) {
    const pts = idx.map((i) => [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]]);
    const n = o.normal ? norm(o.normal) : newell(pts);
    this.faces.push({ v: idx, mat, n, gid: o.gid ?? this._gid });
    return this.faces.length - 1;
  }

  /** 注册一个遮挡盒（AO 会用）。 */
  occlude(mn, mx) {
    this.occluders.push({ mn: mn.slice(), mx: mx.slice() });
  }

  bbox() {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < this.pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = this.pos[i + k];
        if (v < mn[k]) mn[k] = v;
        if (v > mx[k]) mx[k] = v;
      }
    }
    return { mn, mx };
  }
}

// ---------------------------------------------------------------- 基础面

export function addPoly(mesh, pts, mat, o = {}) {
  const idx = pts.map((p) => mesh.vert(p[0], p[1], p[2]));
  if (idx.length < 3) return -1;
  return mesh.face(idx, mat, o);
}

export function addQuad(mesh, p0, p1, p2, p3, mat, o) {
  return addPoly(mesh, [p0, p1, p2, p3], mat, o);
}

export function addTri(mesh, p0, p1, p2, mat, o) {
  return addPoly(mesh, [p0, p1, p2], mat, o);
}

/** 扇形三角化一个（近似凸的）多边形，共用一个 gid，避免内部出现假分缝。 */
export function addFan(mesh, pts, mat, o = {}) {
  const idx = pts.map((p) => mesh.vert(p[0], p[1], p[2]));
  const gid = o.gid ?? mesh._gid;
  for (let i = 1; i < idx.length - 1; i++) mesh.face([idx[0], idx[i], idx[i + 1]], mat, { ...o, gid });
  return gid;
}

// ---------------------------------------------------------------- 定向着色面
// 手写模型最容易犯的错就是把面绕反 —— 渲染出来是黑的，但又不缺面，很难查。
// 所以屋顶这类容易绕错的图元一律走这几个 helper：显式说明"这一面应该朝哪"，
// 由 helper 按 Newell 结果决定要不要反序。

function oriented(pts, want) {
  const n = newell(pts);
  return n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0 ? pts.slice().reverse() : pts;
}

export function addPolyO(mesh, pts, want, mat, o = {}) {
  return addPoly(mesh, oriented(pts, want), mat, { ...o, normal: want });
}

export function addQuadO(mesh, p0, p1, p2, p3, want, mat, o = {}) {
  return addPolyO(mesh, [p0, p1, p2, p3], want, mat, o);
}

export function addTriO(mesh, p0, p1, p2, want, mat, o = {}) {
  return addPolyO(mesh, [p0, p1, p2], want, mat, o);
}

// ---------------------------------------------------------------- 线脚
//
// 这一组是"纹理"的来源：**不做逐像素图案，而是把分缝画成真的有宽度的几何**。
// 瓦垄、砖缝、幕墙竖梃、金属板肋、腰线、雨水管 —— 全都是薄薄一条四边形，
// 沿表面法线抬起一点点避免深度打架，颜色用基材暗一档的 *_seam 材质。
//
// 好处是：线脚跟着透视走（等距下横垄会在坡面上正确收窄）、
// 会吃到 AO、会进描边通道，而且**哪里有线完全由 .model 决定**。

/**
 * 在表面上画一条有宽度的线脚。
 * @param {number[]} p0 起点
 * @param {number[]} p1 终点
 * @param {number[]} n  所在表面的外法线（决定带宽朝哪个方向铺开）
 * @param {number} w    线宽（世界单位；tilePx=256 时 0.010 ≈ 1.5 px）
 */
export function addStrip(mesh, p0, p1, n, w, mat, o = {}) {
  const nn = norm(n);
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const dl = Math.hypot(dx, dy, dz);
  if (dl < 1e-9) return -1;
  const dir = [dx / dl, dy / dl, dz / dl];
  let side = cross(dir, nn);
  const sl = Math.hypot(side[0], side[1], side[2]);
  if (sl < 1e-9) return -1;          // 线方向与法线平行，铺不开
  side = [side[0] / sl, side[1] / sl, side[2] / sl];
  const h = w / 2;
  const lift = o.lift ?? 0.0018;     // ≈ 0.28 px，只为躲开深度打架
  const ox = nn[0] * lift, oy = nn[1] * lift, oz = nn[2] * lift;
  const q = (p, s) => [p[0] + ox + side[0] * s, p[1] + oy + side[1] * s, p[2] + oz + side[2] * s];
  return addPolyO(mesh, [q(p0, -h), q(p1, -h), q(p1, h), q(p0, h)], nn, mat, o);
}

/**
 * 在平行四边形表面上铺「成排分缝 + 错缝竖缝」。
 * 表面 = o0 + U·su + V·sv，su/sv ∈ [0,1]。
 *
 * @param {number} rows 沿 V 的分垄数（产生 rows-1 条横向分缝；1 表示不分垄）
 * @param {number} cols 每垄沿 U 的分片数（产生错缝竖缝；<2 表示不画竖缝）
 */
export function addCourses(mesh, o0, U, V, n, rows, cols, w, mat, o = {}) {
  const r = Math.max(1, Math.round(rows));
  const c = Math.max(0, Math.round(cols));
  const stag = o.stagger ?? 0.5;
  const P = (su, sv) => [
    o0[0] + U[0] * su + V[0] * sv,
    o0[1] + U[1] * su + V[1] * sv,
    o0[2] + U[2] * su + V[2] * sv,
  ];
  const pass = { gid: o.gid, lift: o.lift };
  for (let k = 1; k < r; k++) {
    const sv = k / r;
    addStrip(mesh, P(0, sv), P(1, sv), n, w, mat, pass);
  }
  if (c < 2) return;
  for (let k = 0; k < r; k++) {
    const sv0 = k / r, sv1 = (k + 1) / r;
    const off = r > 1 ? (k % 2) * stag : 0;
    for (let j = 0; j < c; j++) {
      const su = (j + off) / c;
      if (su <= 1e-3 || su >= 1 - 1e-3) continue;
      addStrip(mesh, P(su, sv0), P(su, sv1), n, w, mat, pass);
    }
  }
}

/** 屋顶图元上的瓦垄开关：读 `tileRows` / `tileCols` / `tileW` / `tileMat` / `tileStagger`。 */
function addTiling(mesh, o, gid, o0, U, V, n) {
  if (!o.tileRows && !o.tileCols) return;
  addCourses(mesh, o0, U, V, n, o.tileRows ?? 1, o.tileCols ?? 1,
    o.tileW ?? 0.009, o.tileMat ?? 'panel_seam',
    { gid, stagger: o.tileStagger ?? 0.5, lift: o.tileLift });
}

// ---------------------------------------------------------------- 盒体

/**
 * 长方体。`mat` 可以是字符串（六面同一材质），也可以是
 * `{ all, top, bottom, side, px, nx, py, ny }` 这样的分面材质表。
 */
export function addBox(mesh, x0, y0, z0, x1, y1, z1, mat, o = {}) {
  const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
  const [az, bz] = z0 <= z1 ? [z0, z1] : [z1, z0];
  const M = (key, dflt) => (typeof mat === 'string' ? mat : (mat[key] ?? mat.all ?? dflt));
  const gid = o.gid ?? mesh._gid;
  const P = (x, y, z) => [x, y, z];

  addQuad(mesh, P(ax, ay, bz), P(bx, ay, bz), P(bx, by, bz), P(ax, by, bz), M('top', 'wall'), { gid, normal: [0, 0, 1] });
  addQuad(mesh, P(ax, by, az), P(bx, by, az), P(bx, ay, az), P(ax, ay, az), M('bottom', 'wall'), { gid, normal: [0, 0, -1] });
  addQuad(mesh, P(bx, ay, az), P(bx, by, az), P(bx, by, bz), P(bx, ay, bz), M('px', 'wall'), { gid, normal: [1, 0, 0] });
  addQuad(mesh, P(ax, by, az), P(ax, ay, az), P(ax, ay, bz), P(ax, by, bz), M('nx', 'wall'), { gid, normal: [-1, 0, 0] });
  addQuad(mesh, P(ax, by, az), P(bx, by, az), P(bx, by, bz), P(ax, by, bz), M('py', 'wall'), { gid, normal: [0, 1, 0] });
  addQuad(mesh, P(bx, ay, az), P(ax, ay, az), P(ax, ay, bz), P(bx, ay, bz), M('ny', 'wall'), { gid, normal: [0, -1, 0] });

  if (o.occ !== false) mesh.occlude([ax, ay, az], [bx, by, bz]);
  return gid;
}

/** 地面铺装片（单面朝上）。 */
export function addPlate(mesh, x0, y0, x1, y1, z, mat, o = {}) {
  const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
  return addQuad(mesh, [ax, ay, z], [bx, ay, z], [bx, by, z], [ax, by, z], mat, { gid: o.gid ?? mesh._gid, normal: [0, 0, 1] });
}

// ---------------------------------------------------------------- 棱柱 / 回转体

/** 把 XY 平面上的凸多边形（外看逆时针）沿 Z 拉成棱柱。 */
export function addPrism(mesh, poly, z0, z1, mat, o = {}) {
  const [az, bz] = z0 <= z1 ? [z0, z1] : [z1, z0];
  const gid = o.gid ?? mesh._gid;
  const M = (key) => (typeof mat === 'string' ? mat : (mat[key] ?? mat.all ?? 'wall'));
  const n = poly.length;
  const bottom = poly.map((p) => [p[0], p[1], bz]);
  addPoly(mesh, bottom, M('top'), { gid, normal: [0, 0, 1] });
  addPoly(mesh, bottom.slice().reverse(), M('bottom'), { gid, normal: [0, 0, -1] });
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    addQuad(mesh, [a[0], a[1], az], [b[0], b[1], az], [b[0], b[1], bz], [a[0], a[1], bz], M('side'), { gid });
  }
  if (o.occ !== false) {
    let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    for (const p of poly) { mnx = Math.min(mnx, p[0]); mny = Math.min(mny, p[1]); mxx = Math.max(mxx, p[0]); mxy = Math.max(mxy, p[1]); }
    mesh.occlude([mnx, mny, az], [mxx, mxy, bz]);
  }
  return gid;
}

/** 圆柱 / 圆台（r1 = 0 时是圆锥）。 */
export function addCyl(mesh, cx, cy, z0, z1, r0, r1, seg, mat, o = {}) {
  const [az, bz] = z0 <= z1 ? [z0, z1] : [z1, z0];
  if (r1 <= 0) {
    const gid = o.gid ?? mesh._gid;
    const ring = [];
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      ring.push([cx + Math.cos(th) * r0, cy + Math.sin(th) * r0, az]);
    }
    const apex = [cx, cy, bz];
    for (let i = 0; i < seg; i++) addTri(mesh, ring[i], ring[(i + 1) % seg], apex, mat, { gid });
    addPoly(mesh, ring.slice().reverse(), mat, { gid, normal: [0, 0, -1] });
    if (o.occ !== false) mesh.occlude([cx - r0, cy - r0, az], [cx + r0, cy + r0, bz]);
    return gid;
  }
  const poly = [];
  for (let i = 0; i < seg; i++) {
    const th = (i / seg) * Math.PI * 2;
    poly.push([cx + Math.cos(th) * r0, cy + Math.sin(th) * r0]);
  }
  return addPrism(mesh, poly, az, bz, mat, o);
}

// ---------------------------------------------------------------- 屋顶

const OV = (a, b, over) => [a - over, b + over];

/** 双坡屋顶（人字顶）。axis='x' 表示屋脊平行于 X 轴。 */
export function addGable(mesh, x0, y0, x1, y1, zEave, zRidge, axis, over, mat, o = {}) {
  const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
  const [ex0, ex1] = OV(ax, bx, over);
  const [ey0, ey1] = OV(ay, by, over);
  const gid = o.gid ?? mesh._gid;
  const M = (key) => (typeof mat === 'string' ? mat : (mat[key] ?? mat.all ?? 'roof'));
  const rise = zRidge - zEave;

  if (axis === 'x') {
    const yr = (ay + by) / 2;
    const half = (ey1 - ey0) / 2;
    const nS = norm([0, rise, half]);       // 南坡外向法线
    const nN = norm([0, -rise, half]);      // 北坡
    addQuadO(mesh, [ex0, yr, zRidge], [ex1, yr, zRidge], [ex1, ey1, zEave], [ex0, ey1, zEave], nS, M('roof'), { gid });
    addQuadO(mesh, [ex1, yr, zRidge], [ex0, yr, zRidge], [ex0, ey0, zEave], [ex1, ey0, zEave], nN, M('roof'), { gid });
    addTriO(mesh, [ex1, ey0, zEave], [ex1, ey1, zEave], [ex1, yr, zRidge], [1, 0, 0], M('side'), { gid });
    addTriO(mesh, [ex0, ey1, zEave], [ex0, ey0, zEave], [ex0, yr, zRidge], [-1, 0, 0], M('side'), { gid });
    addQuadO(mesh, [ex0, ey0, zEave], [ex0, ey1, zEave], [ex1, ey1, zEave], [ex1, ey0, zEave], [0, 0, -1], M('bottom'), { gid });
    // 两坡的瓦垄：o0 取脊线，U 沿脊，V 沿坡向下
    addTiling(mesh, o, gid, [ex0, yr, zRidge], [ex1 - ex0, 0, 0], [0, ey1 - yr, zEave - zRidge], nS);
    addTiling(mesh, o, gid, [ex0, yr, zRidge], [ex1 - ex0, 0, 0], [0, ey0 - yr, zEave - zRidge], nN);
    if (o.occ !== false) mesh.occlude([ex0, ey0, zEave], [ex1, ey1, zRidge]);
  } else {
    const xr = (ax + bx) / 2;
    const half = (ex1 - ex0) / 2;
    const nE = norm([rise, 0, half]);
    const nW = norm([-rise, 0, half]);
    addQuadO(mesh, [xr, ey0, zRidge], [xr, ey1, zRidge], [ex1, ey1, zEave], [ex1, ey0, zEave], nE, M('roof'), { gid });
    addQuadO(mesh, [xr, ey1, zRidge], [xr, ey0, zRidge], [ex0, ey0, zEave], [ex0, ey1, zEave], nW, M('roof'), { gid });
    addTriO(mesh, [ex1, ey1, zEave], [ex0, ey1, zEave], [xr, ey1, zRidge], [0, 1, 0], M('side'), { gid });
    addTriO(mesh, [ex0, ey0, zEave], [ex1, ey0, zEave], [xr, ey0, zRidge], [0, -1, 0], M('side'), { gid });
    addQuadO(mesh, [ex0, ey0, zEave], [ex0, ey1, zEave], [ex1, ey1, zEave], [ex1, ey0, zEave], [0, 0, -1], M('bottom'), { gid });
    addTiling(mesh, o, gid, [xr, ey0, zRidge], [0, ey1 - ey0, 0], [ex1 - xr, 0, zEave - zRidge], nE);
    addTiling(mesh, o, gid, [xr, ey0, zRidge], [0, ey1 - ey0, 0], [ex0 - xr, 0, zEave - zRidge], nW);
    if (o.occ !== false) mesh.occlude([ex0, ey0, zEave], [ex1, ey1, zRidge]);
  }
  return gid;
}

/** 单坡 / 锯齿屋顶：屋面沿 dir 指定的方向由 zHigh 降到 zLow，整体封闭成楔形。 */
export function addShed(mesh, x0, y0, x1, y1, zLow, zHigh, dir, mat, o = {}) {
  const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
  const gid = o.gid ?? mesh._gid;
  const M = (key) => (typeof mat === 'string' ? mat : (mat[key] ?? mat.all ?? 'roof'));
  const alongY = dir === '+y' || dir === '-y';
  const rise = zHigh - zLow;

  if (alongY) {
    const yH = dir === '+y' ? ay : by;
    const yL = dir === '+y' ? by : ay;
    const run = yL - yH;                       // 有向水平进深
    // 坡面法线：沿坡向是 (0, run, -rise)，外法线在 YZ 平面内转 90° 取朝上的那个
    const n = norm([0, rise, run]);
    addQuadO(mesh, [ax, yH, zHigh], [bx, yH, zHigh], [bx, yL, zLow], [ax, yL, zLow], n, M('roof'), { gid });
    addTiling(mesh, o, gid, [ax, yH, zHigh], [bx - ax, 0, 0], [0, run, -rise], n);
    addTriO(mesh, [ax, yL, 0], [ax, yH, 0], [ax, yH, zHigh], [-1, 0, 0], M('side'), { gid });
    addTriO(mesh, [bx, yH, 0], [bx, yL, 0], [bx, yL, zLow], [1, 0, 0], M('side'), { gid });
    addQuadO(mesh, [ax, yH, 0], [ax, yH, zHigh], [bx, yH, zHigh], [bx, yH, 0], [0, -1, 0], M('side'), { gid });
    addQuadO(mesh, [bx, yL, 0], [bx, yL, zLow], [ax, yL, zLow], [ax, yL, 0], [0, 1, 0], M('side'), { gid });
  } else {
    const xH = dir === '+x' ? ax : bx;
    const xL = dir === '+x' ? bx : ax;
    const run = xL - xH;
    const n = norm([rise, run, 0]);
    addQuadO(mesh, [xH, ay, zHigh], [xH, by, zHigh], [xL, by, zLow], [xL, ay, zLow], n, M('roof'), { gid });
    addTiling(mesh, o, gid, [xH, ay, zHigh], [0, by - ay, 0], [run, 0, -rise], n);
    addTriO(mesh, [xL, ay, 0], [xH, ay, 0], [xH, ay, zHigh], [0, -1, 0], M('side'), { gid });
    addTriO(mesh, [xH, by, 0], [xL, by, 0], [xL, by, zLow], [0, 1, 0], M('side'), { gid });
    addQuadO(mesh, [xH, ay, 0], [xH, ay, zHigh], [xH, by, zHigh], [xH, by, 0], [-1, 0, 0], M('side'), { gid });
    addQuadO(mesh, [xL, by, 0], [xL, by, zLow], [xL, ay, zLow], [xL, ay, 0], [1, 0, 0], M('side'), { gid });
  }
  addQuadO(mesh, [ax, ay, 0], [ax, by, 0], [bx, by, 0], [bx, ay, 0], [0, 0, -1], M('bottom'), { gid });
  if (o.occ !== false) mesh.occlude([ax, ay, 0], [bx, by, Math.max(zLow, zHigh)]);
  return gid;
}

/** 四坡屋顶（庑殿顶）。inset 为屋脊两端内缩量。 */
export function addHip(mesh, x0, y0, x1, y1, zEave, zRidge, inset, over, mat, o = {}) {
  const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
  const [ex0, ex1] = OV(ax, bx, over);
  const [ey0, ey1] = OV(ay, by, over);
  const cx = (ax + bx) / 2, cy = (ay + by) / 2;
  const r0 = [Math.min(ex0 + inset, cx - 1e-4), cy, zRidge];
  const r1 = [Math.max(ex1 - inset, cx + 1e-4), cy, zRidge];
  const gid = o.gid ?? mesh._gid;
  const M = (key) => (typeof mat === 'string' ? mat : (mat[key] ?? mat.all ?? 'roof'));
  const A = [ex0, ey0, zEave], B = [ex1, ey0, zEave], C = [ex1, ey1, zEave], D = [ex0, ey1, zEave];
  const rise = zRidge - zEave;
  const hd = (ey1 - ey0) / 2;
  const nS = norm([0, rise, hd]);
  const nN = norm([0, -rise, hd]);
  const nW = norm([rise, 0, ex0 - r0[0]]);   // 西坡：high=r0[0] low=ex0
  const nE = norm([rise, 0, ex1 - r1[0]]);   // 东坡：high=r1[0] low=ex1
  addQuadO(mesh, D, C, r1, r0, nS, M('roof'), { gid });             // 南坡
  addQuadO(mesh, B, A, r0, r1, nN, M('roof'), { gid });             // 北坡
  addTriO(mesh, [ex0, ey1, zEave], [ex0, ey0, zEave], r0, nW, M('roof'), { gid });   // 西坡
  addTriO(mesh, [ex1, ey0, zEave], [ex1, ey1, zEave], r1, nE, M('roof'), { gid });    // 东坡
  // 南北两坡是梯形，横垄长度会变，addCourses 只处理平行四边形，故此处不铺瓦垄
  addQuadO(mesh, A, B, C, D, [0, 0, -1], M('bottom'), { gid });
  if (o.occ !== false) mesh.occlude([ex0, ey0, zEave], [ex1, ey1, zRidge]);
  return gid;
}

// ---------------------------------------------------------------- 自检

/**
 * **允许几何探出「名义占地」的量**（单位：瓦片）。
 *
 * 为什么要有这个量（人工 2026-10-04）：
 *   精灵在瓦片边界上是**切齐**的 —— 两块相邻瓦片的精灵各自止于同一条世界直线，
 *   那条线上只剩两边的抗锯齿半透明像素，拼起来就是**一条 1px 的接缝**；
 *   轨道的尽头还会出现小缺口。让几何**略微探出边界**，相邻精灵就**叠上**，
 *   接缝被后画的那一张盖掉（OpenTTD 的精灵本来就互相重叠）。
 *
 * 所以 `footprint` 是**名义**占地，不是硬边界：
 *   * 出界 ≤ `OVERFLOW_ALLOW`  —— **完全正常**，连警告都不报（合法用法）；
 *   * 出界 >  `OVERFLOW_ALLOW` —— **仍然只是警告**（可能真的画错/被裁），不致命。
 *
 * 注意：真正的硬墙不在几何上，而在**画布**上 —— 内容一旦探到取景框边缘就会被裁，
 * 那一条由 `tools/check.mjs` 的"内容贴到格位边缘"检查兜住。
 */
export const OVERFLOW_ALLOW = 0.0625;   // 1/16 格 ≈ 16 px（tilePx = 256）

/** 检查网格是否越界 / 穿地 / 退化。`allow` 见 `OVERFLOW_ALLOW`。 */
export function validateMesh(mesh, footprint, tol = 0.02, allow = OVERFLOW_ALLOW) {
  const w = [];
  const { mn, mx } = mesh.bbox();
  if (!mesh.pos.length) { w.push('空网格'); return w; }
  if (footprint) {
    const over = Math.max(-mn[0], -mn[1], mx[0] - footprint[0], mx[1] - footprint[1]);
    if (over > allow + tol) {
      w.push(`超出占地 [${footprint}] ${over.toFixed(3)} 格（允许 ${allow}）：`
        + `x[${mn[0].toFixed(3)},${mx[0].toFixed(3)}] y[${mn[1].toFixed(3)},${mx[1].toFixed(3)}]`);
    }
  }
  if (mn[2] < -0.005) w.push(`穿地：z=${mn[2].toFixed(4)}`);
  let deg = 0;
  for (const f of mesh.faces) {
    if (f.v.length < 3) deg++;
    const l = Math.hypot(f.n[0], f.n[1], f.n[2]);
    if (!(l > 0.5)) deg++;
  }
  if (deg) w.push(`退化面 ${deg} 个`);
  return w;
}

export { sub, cross, dot, norm };
