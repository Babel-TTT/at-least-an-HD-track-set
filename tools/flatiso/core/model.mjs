// `.model` 手写构件清单 → 网格。
//
// 设计立场
// --------
// **模型是资产，不是程序。** 一个 `.model` 文件里只有一行行字面量构件：
// 没有循环、没有条件、没有随机数、没有"算法生成"。每一面墙的尺寸、
// 每一扇窗的位置都是写死的数字 —— 和在建模软件里一件件摆出来是一回事。
// 本模块只负责把这份清单**解释**成 Mesh；渲染器完全不知道模型怎么来的。
//
// 坐标
// ----
// 世界坐标 x、y 在地面上，z 向上，单位是**瓦片**（1.0 = 一个 1x1 瓦片边长）。
// 占地的西北角格角点是 (0,0,0)，占地必须是 [0,w]×[0,d] 的整瓦片。
// 投影口径对齐 OpenTTD：+x 朝屏幕左下、+y 朝屏幕右下，
// 所以**正面朝 +y**（门窗、店面、月台都放在 +y 面）。
//
// 语法
// ----
// 一行一个构件：`关键字 位置参数... [键=值...]`；`#` 起注释；裸词当布尔标记。
//
//   name res_cottage        group residential        footprint 1 1
//   zmax 0.68               可选：显式声明最高点（保证同类精灵格位一致）
//
// 通用修饰：`gid=N` 复用面组（默认每条构件独占一组，构件之间自然出现分缝线）；
//           `noocc` 不参与 AO 遮挡。
//
// 基础图元
//   plate  x0 y0 x1 y1 z                mat
//   box    x0 y0 z0 x1 y1 z1            mat [top=] [bottom=] [noocc]
//   quad   x0 y0 z0  x1 y1 z1  x2 y2 z2  x3 y3 z3   mat
//   poly   z  mat  x,y x,y x,y ...
//   prism  z0 z1  mat  x,y x,y ...
//   cyl    cx cy z0 z1 r0 r1 seg        mat
//   gable  x0 y0 x1 y1 zEave zRidge  <x|y>  over   mat [side=] [bottom=] [tileRows=] [tileCols=] [tileW=] [tileMat=] [tileStagger=]
//   hip    x0 y0 x1 y1 zEave zRidge  inset  over   mat [side=] [bottom=]
//   shed   x0 y0 x1 y1 zLow zHigh  <+x|-x|+y|-y>   mat [side=] [bottom=] [tileRows=] [tileCols=] [tileW=] [tileMat=] [tileStagger=]
//
// 线脚（"纹理"的来源：把分缝画成真的有宽度的几何）
//   strip  x0 y0 z0  x1 y1 z1   <法线>   <线宽>   mat   [lift=] [gid=]
//   courses <side> at  u0 u1 v0 v1   <rows> <cols>   mat   [w=] [stagger=] [lift=]
//     ±x 面 u=y,v=z；±y 面 u=x,v=z；±z 面 u=x,v=y。rows-1 条横缝，每垄 cols 片错缝。
//
// 构件（统一按「朝向 → 平面坐标 at → 面上矩形 → 材质」排列）
//   wall   <side> at  u0 u1 v0 v1   <洞口 u0,v0,u1,v1>...   mat  [thick=0.03] [reveal=no] [noocc]
//   win    <side> at  u0 u1 z0 z1   glass  [frame=] [frameW=] [mull=] [depth=] [inset=] [sill=no] [lit]
//   door   <side> at  u0 u1 z0 z1   mat    [frame=] [frameW=] [depth=] [inset=] [step=N] [stepMat=]
//   rail   <side> at  u0 u1 z0 z1   mat    [post=] [t=]
//   step   <side> at  u0 u1 z       [steps=] [mat=] [depth=]
//   awning <side> at  u0 u1 z       [depth=] [mat=] [band=] [drop=]
//   sign   <side> at  u0 u1 z0 z1   mat    [depth=] [trim=]
//   chimney x0 y0 x1 y1 z0 z1       mat    [cap=] [vent=no]
//   roofunit x0 y0 x1 y1 z          mat    [h=] [grille=no]
//   tank   cx cy z0 h r             mat    [seg=] [cap=] [legs=no]
//   tree   cx cy r h                trunk-mat crown-mat  [seg=] [tr=] [th=]
//   hedge  x0 y0 x1 y1 z            mat    [inset=] [top=]
//   lamp   cx cy z0 h               mat    [head=]
//
// `<side>` 是 +x / -x / +y / -y；`at` 是该面的平面坐标
// （+x/-x 面填 x 值，+y/-y 面填 y 值）；`u` 沿墙的水平方向
// （+x/-x 面是 y，+y/-y 面是 x）。

import {
  Mesh, addPoly, addQuad, addQuadO, addBox, addPlate,
  addPrism, addCyl, addGable, addHip, addShed, addStrip, addCourses, norm,
} from './mesh.mjs';

// ---------------------------------------------------------------- 词法

const SIDES = ['+x', '-x', '+y', '-y', '+z', '-z'];

const NORMALS = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
};

/** 法线既可以写 +y / -x 这种朝向词，也可以写 nx,ny,nz。 */
function normalToken(tok, no) {
  if (NORMALS[tok]) return NORMALS[tok].slice();
  const p = String(tok).split(',').map(Number);
  if (p.length === 3 && p.every(Number.isFinite)) return p;
  throw new Error(`第 ${no} 行：法线要写成 ${SIDES.join(' / ')} 或 nx,ny,nz，得到「${tok}」`);
}

function tokenize(line) {
  const hash = line.indexOf('#');
  const body = hash >= 0 ? line.slice(0, hash) : line;
  return body.trim().split(/\s+/).filter(Boolean);
}

class Line {
  constructor(tokens, no) { this.t = tokens; this.no = no; this.i = 0; }

  bad(msg) { throw new Error(`第 ${this.no} 行：${msg}`); }

  num(what) {
    const s = this.t[this.i++];
    const v = Number(s);
    if (s === undefined || !Number.isFinite(v)) this.bad(`${what} 需要数字，得到「${s}」`);
    return v;
  }
  int(what) {
    const v = this.num(what);
    if (!Number.isInteger(v)) this.bad(`${what} 需要整数，得到 ${v}`);
    return v;
  }
  word(what) {
    const s = this.t[this.i++];
    if (s === undefined) this.bad(`缺少${what}`);
    if (s.includes('=')) this.bad(`${what} 不能写成键值对`);
    return s;
  }
  side() {
    const s = this.word('朝向');
    if (!SIDES.includes(s)) this.bad(`朝向只能是 ${SIDES.join(' / ')}，得到「${s}」`);
    return s;
  }
  /** 剩余的 key=value 与裸标记。 */
  opts() {
    const o = {};
    for (; this.i < this.t.length; this.i++) {
      const s = this.t[this.i];
      const eq = s.indexOf('=');
      if (eq < 0) { o[s] = true; continue; }          // 裸标记：noocc / lit …
      const k = s.slice(0, eq), v = s.slice(eq + 1);
      if (v === '' || v === 'yes' || v === 'true' || v === 'on') o[k] = true;
      else if (v === 'no' || v === 'false' || v === 'off') o[k] = false;
      else o[k] = Number.isFinite(Number(v)) ? Number(v) : v;
    }
    return o;
  }
  done() { if (this.i < this.t.length) this.bad(`多余的参数「${this.t[this.i]}」`); }
}

/** `1.2,0.3` → [1.2, 0.3] */
function xy(s, no) {
  const parts = String(s).split(',');
  if (parts.length !== 2) throw new Error(`第 ${no} 行：坐标要写成 x,y，得到「${s}」`);
  const a = Number(parts[0]), b = Number(parts[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`第 ${no} 行：坐标不是数字「${s}」`);
  return [a, b];
}

// ---------------------------------------------------------------- 墙面基

/** 把"某个朝向的平面"换算成世界空间的基。u 是面内水平方向，v 是面内竖直方向。 */
function wallFrame(side, at) {
  switch (side) {
    case '+x': return { n: [1, 0, 0], p: (u, v) => [at, u, v] };
    case '-x': return { n: [-1, 0, 0], p: (u, v) => [at, u, v] };
    case '+y': return { n: [0, 1, 0], p: (u, v) => [u, at, v] };
    case '-y': return { n: [0, -1, 0], p: (u, v) => [u, at, v] };
    case '+z': return { n: [0, 0, 1], p: (u, v) => [u, v, at] };
    default: return { n: [0, 0, -1], p: (u, v) => [u, v, at] };
  }
}

/** 贴在该墙面上的四边形，沿外法线偏移 off。 */
function planarQuad(mesh, f, u0, u1, z0, z1, off, mat, o) {
  const n = f.n;
  const q = (u, z) => { const p = f.p(u, z); return [p[0] + n[0] * off, p[1] + n[1] * off, p[2]]; };
  addQuadO(mesh, q(u0, z0), q(u1, z0), q(u1, z1), q(u0, z1), n, mat, o);
}

// ---------------------------------------------------------------- 构件

/** 门前台阶：沿外法线一级级降下去，最靠墙的一级最高。 */
function stoop(mesh, f, u0, u1, zTop, steps, mat, G, depth = 0.095) {
  const n = f.n;
  const a = f.p(u0, 0), b = f.p(u1, 0);
  const q = (pt, out, z) => [pt[0] + n[0] * out, pt[1] + n[1] * out, z];
  for (let k = 0; k < steps; k++) {
    const out0 = depth * k, out1 = depth * (k + 1);
    const hz = (zTop * (steps - k)) / steps;
    const g = G.fresh();
    addQuadO(mesh, q(a, out0, hz), q(b, out0, hz), q(b, out1, hz), q(a, out1, hz), [0, 0, 1], mat, { gid: g, noocc: true });
    addQuadO(mesh, q(a, out1, 0), q(b, out1, 0), q(b, out1, hz), q(a, out1, hz), n, mat, { gid: g, noocc: true });
    if (k < steps - 1) {
      const hz2 = (zTop * (steps - k - 1)) / steps;
      addQuadO(mesh, q(a, out1, hz2), q(b, out1, hz2), q(b, out1, hz), q(a, out1, hz), n, mat, { gid: g, noocc: true });
    }
  }
}

/** 从位置参数里读出「朝向 + 平面坐标 + 面上矩形」。 */
function rect(L) {
  const side = L.side();
  const at = L.num('at（平面坐标）');
  const u0 = L.num('u0'), u1 = L.num('u1');
  const z0 = L.num('z0'), z1 = L.num('z1');
  return { side, at, u0, u1, z0, z1, f: wallFrame(side, at) };
}

function cWin(mesh, L, G) {
  const r = rect(L);
  const glass = L.word('玻璃材质');
  const o = L.opts();
  const frame = o.frame ?? 'trim_white';
  const depth = o.depth ?? 0.012;
  const inset = o.inset ?? 0;          // 整体往墙里沉多少（配合 wall 的洞口用）
  const g = G.fresh();

  // 玻璃面比窗框再内凹一点，形成自遮蔽
  planarQuad(mesh, r.f, r.u0, r.u1, r.z0, r.z1, depth * 0.35 - inset, o.lit ? 'glass_lit' : glass, { gid: G.fresh() });
  // 四条边框
  const fw = Math.min(o.frameW ?? 0.035, (r.u1 - r.u0) / 2.4, (r.z1 - r.z0) / 2.4);
  planarQuad(mesh, r.f, r.u0, r.u0 + fw, r.z0, r.z1, depth - inset, frame, { gid: g });
  planarQuad(mesh, r.f, r.u1 - fw, r.u1, r.z0, r.z1, depth - inset, frame, { gid: g });
  planarQuad(mesh, r.f, r.u0 + fw, r.u1 - fw, r.z1 - fw, r.z1, depth - inset, frame, { gid: g });
  planarQuad(mesh, r.f, r.u0 + fw, r.u1 - fw, r.z0, r.z0 + fw, depth - inset, frame, { gid: g });
  // 窗台（始终挑出墙面，不跟着 inset 沉进去 —— 窗台本来就是凸的）
  if (o.sill !== false) {
    const sm = typeof o.sill === 'string' ? o.sill : frame;
    planarQuad(mesh, r.f, r.u0 - 0.02, r.u1 + 0.02, r.z0 - 0.032, r.z0, depth * 1.6, sm, { gid: G.fresh() });
  }
  // 竖梃分格（默认半宽 0.007：带窗上 mull 动辄十几根，粗一点就糊成条纹了）
  if (o.mull) {
    const n = Math.max(0, Math.round(o.mull) - 1);
    const span = (r.u1 - r.u0 - 2 * fw) / (n + 1);
    const mw = Math.min(o.mullW ?? 0.007, span * 0.25);
    for (let k = 1; k <= n; k++) {
      const u = r.u0 + fw + span * k;
      planarQuad(mesh, r.f, u - mw, u + mw, r.z0 + fw, r.z1 - fw, depth * 1.05 - inset, frame, { gid: g });
    }
  }
}

function cDoor(mesh, L, G) {
  const r = rect(L);
  const mat = L.word('门板材质');
  const o = L.opts();
  const frame = o.frame ?? 'trim_white';
  const fw = o.frameW ?? 0.05;
  const depth = o.depth ?? 0.014;
  const inset = o.inset ?? 0;
  const g = G.fresh();
  planarQuad(mesh, r.f, r.u0, r.u1, r.z0, r.z1, depth * 0.5 - inset, mat, { gid: G.fresh() });
  planarQuad(mesh, r.f, r.u0 - fw, r.u0, r.z0, r.z1 + fw, depth - inset, frame, { gid: g });
  planarQuad(mesh, r.f, r.u1, r.u1 + fw, r.z0, r.z1 + fw, depth - inset, frame, { gid: g });
  planarQuad(mesh, r.f, r.u0 - fw, r.u1 + fw, r.z1, r.z1 + fw, depth - inset, frame, { gid: g });
  if (o.step) stoop(mesh, r.f, r.u0, r.u1, r.z0, Math.max(1, Math.round(o.step)), o.stepMat ?? 'stone_dark', G);
}

/**
 * `wall` —— 一片墙，**按洞口自动切分**，并为每个洞口生成四个侧壁（真窗洞）。
 *
 *   wall <朝向> at  u0 u1 v0 v1   <洞口 u0,v0,u1,v1>...   <材质>   [thick=] [gid=] [noocc] [reveal=no]
 *
 * 为什么需要它：`box` 画的是实心体，渲染器又没有 CSG、不能挖洞。
 * 想让玻璃真的退进墙里，墙本身就必须真的是围着洞口砌起来的一圈实体 ——
 * 否则退进去的玻璃和侧壁都会被墙的正面挡住（深度上墙更靠前）。
 * 手写这件事极易出错（一个数字错一位就是一条缝或一块重叠），所以交给这里切。
 *
 * 切法是"断头台"式：先在 u 方向切出通高墙垛，再给每个洞口补"窗下墙"和"过梁"。
 * 因此**洞口之间在 u 方向不能重叠** —— 重叠会让上下两块互相压住，这里直接报错。
 *
 * 墙从 `at` 往内做 `thick` 厚，洞口侧壁就从外表面一直做到内表面；
 * 玻璃/窗框用 `win ... inset=<thick>` 沉到洞底。
 */
function cWall(mesh, L, G) {
  const side = L.side();
  const at = L.num('at（平面坐标）');
  const a0 = L.num('u0'), a1 = L.num('u1');
  const b0 = L.num('v0'), b1 = L.num('v1');
  const uA = Math.min(a0, a1), uB = Math.max(a0, a1);
  const vA = Math.min(b0, b1), vB = Math.max(b0, b1);

  const holes = [];
  while (L.i < L.t.length && L.t[L.i].includes(',')) {
    const raw = L.t[L.i++];
    const p = raw.split(',').map(Number);
    if (p.length !== 4 || !p.every(Number.isFinite)) L.bad(`洞口要写成 u0,v0,u1,v1，得到「${raw}」`);
    holes.push([Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.max(p[0], p[2]), Math.max(p[1], p[3])]);
  }
  const mat = L.word('材质');
  const o = L.opts();
  const thick = o.thick ?? 0.03;
  if (!(thick > 1e-6)) L.bad('wall 的 thick 必须大于 0');

  const sorted = holes.slice().sort((p, q) => p[0] - q[0]);
  for (const h of sorted) {
    if (h[0] < uA - 1e-6 || h[2] > uB + 1e-6 || h[1] < vA - 1e-6 || h[3] > vB + 1e-6) {
      L.bad(`洞口 ${h.join(',')} 超出墙面范围 [${uA},${uB}]×[${vA},${vB}]`);
    }
  }

  const f = wallFrame(side, at);
  const gid = o.gid ?? G.fresh();
  const occ = !o.noocc;
  const P = (u, v, d) => {
    const p = f.p(u, v);
    return [p[0] + f.n[0] * d, p[1] + f.n[1] * d, p[2] + f.n[2] * d];
  };
  const piece = (puA, pvA, puB, pvB) => {
    if (puB - puA < 1e-6 || pvB - pvA < 1e-6) return;
    const a = P(puA, pvA, 0), b = P(puB, pvB, -thick);
    addBox(mesh, a[0], a[1], a[2], b[0], b[1], b[2], mat, { gid, occ });
  };

  // 切分：先按所有洞口的 u 边界把墙切成竖条，再在每条竖条里取洞口 v 区间的补集。
  // 这样"同一 u 范围、竖直堆叠的七层窗带"也是合法的 —— 只要洞口彼此不重叠。
  const uEdges = new Set([uA, uB]);
  for (const h of sorted) { uEdges.add(h[0]); uEdges.add(h[2]); }
  const us = [...uEdges].sort((a, b) => a - b);
  for (let i = 0; i < us.length - 1; i++) {
    const su0 = us[i], su1 = us[i + 1];
    if (su1 - su0 < 1e-6) continue;
    const spans = sorted
      .filter((h) => h[0] < su1 - 1e-6 && h[2] > su0 + 1e-6)
      .map((h) => [h[1], h[3]])
      .sort((a, b) => a[0] - b[0]);
    let cur = vA;
    for (const sp of spans) {
      if (sp[0] > cur + 1e-6) piece(su0, cur, su1, sp[0]);
      if (sp[1] > cur) cur = sp[1];
    }
    if (vB > cur + 1e-6) piece(su0, cur, su1, vB);
  }

  // 3) 洞口侧壁：外表面一直做到内表面
  if (o.reveal !== false) {
    const p00 = P(0, 0, 0), p10 = P(1, 0, 0), p01 = P(0, 1, 0);
    const uVec = norm([p10[0] - p00[0], p10[1] - p00[1], p10[2] - p00[2]]);
    const vVec = norm([p01[0] - p00[0], p01[1] - p00[1], p01[2] - p00[2]]);
    const neg = (q) => [-q[0], -q[1], -q[2]];
    for (const h of sorted) {
      const jambs = [[h[0], uVec], [h[2], neg(uVec)]];
      for (const j of jambs) {
        addQuadO(mesh, P(j[0], h[1], 0), P(j[0], h[3], 0), P(j[0], h[3], -thick), P(j[0], h[1], -thick), j[1], mat, { gid });
      }
      const bands = [[h[1], vVec], [h[3], neg(vVec)]];
      for (const b of bands) {
        addQuadO(mesh, P(h[0], b[0], 0), P(h[2], b[0], 0), P(h[2], b[0], -thick), P(h[0], b[0], -thick), b[1], mat, { gid });
      }
    }
  }
}

function cStep(mesh, L, G) {
  const side = L.side();
  const at = L.num('at（平面坐标）');
  const u0 = L.num('u0'), u1 = L.num('u1'), z = L.num('z');
  const o = L.opts();
  stoop(mesh, wallFrame(side, at), u0, u1, z, Math.max(1, Math.round(o.steps ?? 2)),
    o.mat ?? 'stone_dark', G, o.depth ?? 0.095);
}

function cRail(mesh, L, G) {
  const r = rect(L);
  const mat = L.word('材质');
  const o = L.opts();
  const t = o.t ?? 0.028;
  const spacing = o.post ?? 0.16;
  const g = G.fresh();
  planarQuad(mesh, r.f, r.u0, r.u1, r.z1 - t, r.z1, 0, mat, { gid: g, noocc: true });
  planarQuad(mesh, r.f, r.u0, r.u1, r.z0 + t, r.z0 + 2 * t, 0, mat, { gid: g, noocc: true });
  const n = Math.max(1, Math.round((r.u1 - r.u0) / spacing));
  for (let k = 0; k <= n; k++) {
    const u = r.u0 + ((r.u1 - r.u0) * k) / n;
    planarQuad(mesh, r.f, u - t / 2, u + t / 2, r.z0, r.z1, 0, mat, { gid: g, noocc: true });
  }
}

function cAwning(mesh, L, G) {
  const side = L.side();
  const at = L.num('at（平面坐标）');
  const u0 = L.num('u0'), u1 = L.num('u1'), z = L.num('z');
  const o = L.opts();
  const depth = o.depth ?? 0.18;
  const mat = o.mat ?? 'awning_red';
  const band = o.band ?? 'trim_white';
  const drop = o.drop ?? 0.06;
  const f = wallFrame(side, at);
  const n = f.n;
  const q = (u, out, zz) => { const p = f.p(u, zz); return [p[0] + n[0] * out, p[1] + n[1] * out, zz]; };
  const g = G.fresh();
  addQuadO(mesh, q(u0, 0, z + drop), q(u1, 0, z + drop), q(u1, depth, z - drop), q(u0, depth, z - drop),
    [n[0] * 0.35, n[1] * 0.35, 0.94], mat, { gid: g });
  addQuadO(mesh, q(u0, depth, z - drop), q(u1, depth, z - drop), q(u1, depth, z - drop - 0.07), q(u0, depth, z - drop - 0.07),
    [n[0], n[1], 0], band, { gid: G.fresh() });
}

function cSign(mesh, L, G) {
  const r = rect(L);
  const mat = L.word('材质');
  const o = L.opts();
  const d = o.depth ?? 0.035;
  const g = G.fresh();
  planarQuad(mesh, r.f, r.u0, r.u1, r.z0, r.z1, d, mat, { gid: g, noocc: true });
  if (o.trim !== false) {
    planarQuad(mesh, r.f, r.u0, r.u1, r.z0, r.z1, d * 0.55,
      typeof o.trim === 'string' ? o.trim : 'trim_dark', { gid: G.fresh(), noocc: true });
  }
}

function cChimney(mesh, L, G) {
  const x0 = L.num('x0'), y0 = L.num('y0'), x1 = L.num('x1'), y1 = L.num('y1');
  const z0 = L.num('z0'), z1 = L.num('z1');
  const mat = L.word('材质');
  const o = L.opts();
  addBox(mesh, x0, y0, z0, x1, y1, z1, mat, { gid: G.fresh() });
  if (o.cap !== false) {
    addBox(mesh, x0 - 0.014, y0 - 0.014, z1, x1 + 0.014, y1 + 0.014, z1 + 0.035,
      typeof o.cap === 'string' ? o.cap : 'trim_dark', { gid: G.fresh(), noocc: true });
  }
  if (o.vent) {
    addCyl(mesh, (x0 + x1) / 2, (y0 + y1) / 2, z1 + 0.035, z1 + 0.075,
      (x1 - x0) * 0.22, (x1 - x0) * 0.22, 8, 'metal_dark', { gid: G.fresh(), noocc: true });
  }
}

function cRoofUnit(mesh, L, G) {
  const x0 = L.num('x0'), y0 = L.num('y0'), x1 = L.num('x1'), y1 = L.num('y1'), z = L.num('z');
  const mat = L.word('材质');
  const o = L.opts();
  const h = o.h ?? 0.09;
  addBox(mesh, x0, y0, z, x1, y1, z + h, mat, { gid: G.fresh() });
  if (o.grille !== false) {
    const gy = (y0 + y1) / 2;
    addBox(mesh, x0 + 0.03, gy - 0.02, z + h * 0.2, x1 - 0.03, gy + 0.02, z + h * 0.8,
      typeof o.grille === 'string' ? o.grille : 'metal_dark', { gid: G.fresh(), noocc: true });
  }
}

function cTank(mesh, L, G) {
  const cx = L.num('cx'), cy = L.num('cy'), z0 = L.num('z0'), h = L.num('h'), r = L.num('r');
  const mat = L.word('材质');
  const o = L.opts();
  const seg = Math.round(o.seg ?? 10);
  addCyl(mesh, cx, cy, z0, z0 + h, r, r, seg, mat, { gid: G.fresh() });
  addCyl(mesh, cx, cy, z0 + h, z0 + h + 0.03, r * 1.06, r * 1.06, seg,
    typeof o.cap === 'string' ? o.cap : 'metal_dark', { gid: G.fresh(), noocc: true });
  if (o.legs !== false) {
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      addBox(mesh, cx + sx * r * 0.6 - 0.018, cy + sy * r * 0.6 - 0.018, 0,
        cx + sx * r * 0.6 + 0.018, cy + sy * r * 0.6 + 0.018, z0, 'metal_dark', { gid: G.fresh(), noocc: true });
    }
  }
}

function cTree(mesh, L, G) {
  const cx = L.num('cx'), cy = L.num('cy'), r = L.num('r'), h = L.num('h');
  const trunkMat = L.word('树干材质');
  const crownMat = L.word('树冠材质');
  const o = L.opts();
  const seg = Math.round(o.seg ?? 8);
  const th = o.th ?? h * 0.32;                 // 树干高
  const tr = o.tr ?? Math.min(r * 0.16, 0.022); // 树干半径
  // 树冠做成上下两段圆锥拼出的"柠檬形"，比方柱状圆台更像树。
  addCyl(mesh, cx, cy, 0, th, tr, tr * 0.8, seg, trunkMat, { gid: G.fresh(), noocc: true });
  addCyl(mesh, cx, cy, th * 0.6, th + (h - th) * 0.45, r * 0.68, r, seg, crownMat, { gid: G.fresh(), noocc: true });
  addCyl(mesh, cx, cy, th + (h - th) * 0.45, h, r, 0, seg, crownMat, { gid: G.fresh(), noocc: true });
}

function cHedge(mesh, L, G) {
  const x0 = L.num('x0'), y0 = L.num('y0'), x1 = L.num('x1'), y1 = L.num('y1'), z = L.num('z');
  const mat = L.word('材质');
  const o = L.opts();
  const inset = o.inset ?? 0.012;
  addBox(mesh, x0 + inset, y0 + inset, 0, x1 - inset, y1 - inset, z, mat, { gid: G.fresh(), noocc: true });
  if (o.top !== false) {
    addPlate(mesh, x0 + inset, y0 + inset, x1 - inset, y1 - inset, z + 0.0015,
      typeof o.top === 'string' ? o.top : mat, { gid: G.fresh() });
  }
}

function cLamp(mesh, L, G) {
  const cx = L.num('cx'), cy = L.num('cy'), z0 = L.num('z0'), h = L.num('h');
  const mat = L.word('杆材质');
  const o = L.opts();
  addCyl(mesh, cx, cy, z0, z0 + h, 0.017, 0.013, 6, mat, { gid: G.fresh(), noocc: true });
  addBox(mesh, cx - 0.045, cy - 0.045, z0 + h, cx + 0.045, cy + 0.045, z0 + h + 0.035,
    typeof o.head === 'string' ? o.head : 'metal_pale', { gid: G.fresh(), noocc: true });
}

/**
 * `strip` —— 一条线脚。
 *   strip  x0 y0 z0  x1 y1 z1   <法线>   <线宽>   <材质>   [lift=] [gid=]
 * 法线写 +y / -x / +z 之类的朝向词，或 nx,ny,nz。线宽是世界单位
 * （tilePx=256 时 0.010 ≈ 1.5 px）。
 */
function cStrip(mesh, L, G) {
  const p0 = [L.num('x0'), L.num('y0'), L.num('z0')];
  const p1 = [L.num('x1'), L.num('y1'), L.num('z1')];
  const n = normalToken(L.word('法线'), L.no);
  const w = L.num('线宽');
  const mat = L.word('材质');
  const o = L.opts();
  addStrip(mesh, p0, p1, n, w, mat, { gid: o.gid ?? G.fresh(), lift: o.lift });
}

/**
 * `courses` —— 一片平面上的成排分缝（砖缝 / 板缝 / 抹灰分格 / 幕墙竖梃 / 瓦垄）。
 *   courses  <朝向> at  u0 u1 v0 v1   <rows> <cols>   <材质>   [w=] [stagger=] [lift=]
 * ±x 面：u=y、v=z；±y 面：u=x、v=z；±z 面：u=x、v=y（at 就是 z）。
 * rows 是分垄数（产生 rows-1 条横缝），cols 是每垄片数（产生错缝竖缝）。
 * 只想画竖梃就写 rows=1；只想画横缝就写 cols=1、rows=N。
 */
function cCourses(mesh, L, G) {
  const side = L.side();
  const at = L.num('at（平面坐标）');
  const u0 = L.num('u0'), u1 = L.num('u1');
  const v0 = L.num('v0'), v1 = L.num('v1');
  const rows = L.int('rows'), cols = L.int('cols');
  const mat = L.word('材质');
  const o = L.opts();
  const f = wallFrame(side, at);
  const a = f.p(u0, v0), b = f.p(u1, v0), c = f.p(u0, v1);
  const U = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const V = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  addCourses(mesh, a, U, V, f.n, rows, cols, o.w ?? 0.009, mat, {
    gid: o.gid ?? G.fresh(),
    stagger: o.stagger ?? 0.5,
    lift: o.lift,
  });
}

// ---------------------------------------------------------------- 解释器

const COMPONENTS = {
  win: cWin, door: cDoor, rail: cRail, awning: cAwning, sign: cSign,
  step: cStep, tree: cTree, hedge: cHedge, tank: cTank, roofunit: cRoofUnit,
  lamp: cLamp, chimney: cChimney, strip: cStrip, courses: cCourses, wall: cWall,
};

export function parseModel(text, opts = {}) {
  const mesh = new Mesh(opts.name ?? '');
  const meta = { name: '', group: 'misc', footprint: null, zmax: null };
  // 每条构件默认独占一个面组，构件之间自然出现分缝线；`gid=N` 可以手动合并。
  const G = { fresh: () => { const g = mesh.newGid(); mesh._gid = g + 1; return g; } };
  G.fresh();

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const t = tokenize(lines[i]);
    if (!t.length) continue;
    const kw = t[0];
    const L = new Line(t, i + 1);
    L.i = 1;

    switch (kw) {
      case 'name': meta.name = L.word('名字'); L.done(); break;
      case 'group': meta.group = L.word('分组'); L.done(); break;
      case 'footprint': meta.footprint = [L.int('占地宽'), L.int('占地深')]; L.done(); break;
      case 'zmax': meta.zmax = L.num('最高点'); L.done(); break;
      case 'tag': meta.tag = L.word('标签'); L.done(); break;

      case 'plate': {
        const a = [L.num('x0'), L.num('y0'), L.num('x1'), L.num('y1'), L.num('z')];
        const mat = L.word('材质'); const o = L.opts();
        addPlate(mesh, a[0], a[1], a[2], a[3], a[4], mat, { gid: o.gid ?? G.fresh() });
        break;
      }
      case 'box': {
        const a = [L.num('x0'), L.num('y0'), L.num('z0'), L.num('x1'), L.num('y1'), L.num('z1')];
        const mat = L.word('材质'); const o = L.opts();
        addBox(mesh, a[0], a[1], a[2], a[3], a[4], a[5],
          o.top || o.bottom ? { all: mat, top: o.top ?? mat, bottom: o.bottom ?? mat } : mat,
          { ...o, gid: o.gid ?? G.fresh(), occ: !o.noocc });
        break;
      }
      case 'quad': {
        const a = [];
        for (let k = 0; k < 12; k++) a.push(L.num('顶点坐标'));
        const mat = L.word('材质'); const o = L.opts();
        addQuad(mesh, [a[0], a[1], a[2]], [a[3], a[4], a[5]], [a[6], a[7], a[8]], [a[9], a[10], a[11]],
          mat, { gid: o.gid ?? G.fresh() });
        break;
      }
      case 'poly': {
        const z = L.num('z'); const mat = L.word('材质');
        const pts = [];
        while (L.i < L.t.length && !L.t[L.i].includes('=')) pts.push(xy(L.t[L.i++], L.no));
        const o = L.opts();
        if (pts.length < 3) L.bad('poly 至少要 3 个点');
        addPoly(mesh, pts.map((p) => [p[0], p[1], z]), mat, { gid: o.gid ?? G.fresh(), normal: [0, 0, 1] });
        break;
      }
      case 'prism': {
        const z0 = L.num('z0'), z1 = L.num('z1'); const mat = L.word('材质');
        const pts = [];
        while (L.i < L.t.length && !L.t[L.i].includes('=')) pts.push(xy(L.t[L.i++], L.no));
        const o = L.opts();
        if (pts.length < 3) L.bad('prism 至少要 3 个点');
        addPrism(mesh, pts, z0, z1, mat, { gid: o.gid ?? G.fresh(), occ: !o.noocc });
        break;
      }
      case 'cyl': {
        const a = [L.num('cx'), L.num('cy'), L.num('z0'), L.num('z1'), L.num('r0'), L.num('r1'), L.int('seg')];
        const mat = L.word('材质'); const o = L.opts();
        addCyl(mesh, a[0], a[1], a[2], a[3], a[4], a[5], a[6], mat, { gid: o.gid ?? G.fresh(), occ: !o.noocc });
        break;
      }
      case 'gable': {
        const a = [L.num('x0'), L.num('y0'), L.num('x1'), L.num('y1'), L.num('zEave'), L.num('zRidge')];
        const axis = L.word('屋脊轴'); const over = L.num('出檐');
        const mat = L.word('材质'); const o = L.opts();
        if (axis !== 'x' && axis !== 'y') L.bad('屋脊轴只能是 x 或 y');
        addGable(mesh, a[0], a[1], a[2], a[3], a[4], a[5], axis, over,
          o.side || o.bottom ? { all: mat, roof: mat, side: o.side ?? mat, bottom: o.bottom ?? mat } : mat,
          { ...o, gid: o.gid ?? G.fresh(), occ: !o.noocc });
        break;
      }
      case 'hip': {
        const a = [L.num('x0'), L.num('y0'), L.num('x1'), L.num('y1'), L.num('zEave'), L.num('zRidge'), L.num('inset'), L.num('over')];
        const mat = L.word('材质'); const o = L.opts();
        addHip(mesh, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7],
          o.side || o.bottom ? { all: mat, roof: mat, side: o.side ?? mat, bottom: o.bottom ?? mat } : mat,
          { ...o, gid: o.gid ?? G.fresh(), occ: !o.noocc });
        break;
      }
      case 'shed': {
        const a = [L.num('x0'), L.num('y0'), L.num('x1'), L.num('y1'), L.num('zLow'), L.num('zHigh')];
        const dir = L.word('坡向'); const mat = L.word('材质'); const o = L.opts();
        if (!['+x', '-x', '+y', '-y'].includes(dir)) L.bad('坡向只能是 +x / -x / +y / -y');
        addShed(mesh, a[0], a[1], a[2], a[3], a[4], a[5], dir,
          o.side || o.bottom ? { all: mat, roof: mat, side: o.side ?? mat, bottom: o.bottom ?? mat } : mat,
          { ...o, gid: o.gid ?? G.fresh(), occ: !o.noocc });
        break;
      }
      default: {
        const fn = COMPONENTS[kw];
        if (!fn) L.bad(`未知关键字「${kw}」`);
        fn(mesh, L, G);
        L.done();
      }
    }
  }

  if (!meta.name) throw new Error('缺少 name');
  if (!meta.footprint) throw new Error('缺少 footprint');
  if (meta.footprint[0] < 1 || meta.footprint[1] < 1) throw new Error('占地必须是正整数瓦片');
  mesh.name = meta.name;
  return { meta, mesh };
}
