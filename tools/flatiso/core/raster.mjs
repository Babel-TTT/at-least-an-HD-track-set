// 离线光栅器。
//
//  1. 把所有顶点转到"以取景基准点为原点"的屏幕坐标（2:1 等距正交）。
//  2. 每个面算一次**平面着色**：基色 × (半球环境光 + 柔和平行光)。
//     逐像素只再乘一个 AO 系数 —— 没有法线插值、没有逐像素光照、
//     没有 BRDF。这就是"平涂为主"的来源。
//  3. 半空间光栅化 + Z 缓冲，超采样后在**线性空间**做带 Alpha 权重的解析，
//     最后开方回到显示空间（相当于 gamma 2 的廉价近似）。
//  4. 描边通道：按相邻像素的"面 ID / 面组 / 折角"决定是否压一条深色线。
//     所以"哪里有线"完全由建模决定，渲染器不擅自加线。

import { materialInfo } from './materials.mjs';
import { NEUTRAL } from './grade.mjs';
import { NO_GRAIN, grainAt } from './grain.mjs';

const EMPTY = -1;

/** 把网格绕 (cx,cy) 旋转 ang，法线同步旋转。返回新的顶点数组。 */
function rotateMesh(mesh, ang, cx, cy) {
  const n = mesh.ao.length;
  const out = new Float64Array(n * 3);
  const rot = new Float64Array(mesh.faces.length * 3);
  if (!ang) {
    for (let i = 0; i < n * 3; i++) out[i] = mesh.pos[i];
    mesh.faces.forEach((f, i) => { rot[i * 3] = f.n[0]; rot[i * 3 + 1] = f.n[1]; rot[i * 3 + 2] = f.n[2]; });
    return { pos: out, nrm: rot };
  }
  const c = Math.cos(ang), s = Math.sin(ang);
  for (let i = 0; i < n; i++) {
    const x = mesh.pos[i * 3] - cx, y = mesh.pos[i * 3 + 1] - cy, z = mesh.pos[i * 3 + 2];
    out[i * 3] = cx + x * c - y * s;
    out[i * 3 + 1] = cy + x * s + y * c;
    out[i * 3 + 2] = z;
  }
  mesh.faces.forEach((f, i) => {
    const x = f.n[0], y = f.n[1], z = f.n[2];
    rot[i * 3] = x * c - y * s;
    rot[i * 3 + 1] = x * s + y * c;
    rot[i * 3 + 2] = z;
  });
  return { pos: out, nrm: rot };
}

/**
 * 渲染一次。
 *
 * @param {import('./mesh.mjs').Mesh} mesh
 * @param {ReturnType<import('./project.mjs').makeView>} view
 * @param {ReturnType<import('./look.mjs').makeLook>} look
 * @param {object} opts
 * @param {number} [opts.rot]       绕 pivot 旋转的弧度
 * @param {number[]} [opts.pivot]   pivot（世界 XY）
 * @param {number[]} [opts.frame]   [x0,y0,x1,y1] 强制取景（相对 pivot 投影，整数像素）
 * @param {number[][]} [opts.extra] 额外纳入包围盒的世界点
 * @param {number} [opts.ss]        超采样倍率
 * @param {number} [opts.pad]       取景外扩像素
 */
export function renderSprite(mesh, view, look, opts = {}) {
  const ss = opts.ss ?? 3;
  const pad = opts.pad ?? 2;
  const cull = opts.cull !== false;
  const ang = opts.rot ?? 0;
  const pivot = opts.pivot ?? [0, 0];
  const { pos, nrm } = rotateMesh(mesh, ang, pivot[0], pivot[1]);

  const A = view.project(pivot[0], pivot[1], 0);
  const nv = mesh.ao.length;

  // ---- 屏幕坐标（相对 pivot 投影）--------------------------------------
  const SX = new Float64Array(nv), SY = new Float64Array(nv);
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  for (let i = 0; i < nv; i++) {
    const p = view.project(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    SX[i] = p[0] - A[0];
    SY[i] = p[1] - A[1];
    if (SX[i] < mnx) mnx = SX[i];
    if (SX[i] > mxx) mxx = SX[i];
    if (SY[i] < mny) mny = SY[i];
    if (SY[i] > mxy) mxy = SY[i];
  }

  // ---- 取景 ------------------------------------------------------------
  let x0, y0, w, h;
  if (opts.frame) {
    [x0, y0, w, h] = opts.frame;
  } else {
    // 额外点（一般是占地菱形的四个角）必须落在格内，保证同占地的精灵尺寸一致
    for (const q of opts.extra ?? []) {
      const p = view.project(q[0], q[1], q[2] ?? 0);
      const sx = p[0] - A[0], sy = p[1] - A[1];
      if (sx < mnx) mnx = sx; if (sx > mxx) mxx = sx;
      if (sy < mny) mny = sy; if (sy > mxy) mxy = sy;
    }
    x0 = Math.floor(mnx) - pad;
    y0 = Math.floor(mny) - pad;
    w = Math.ceil(mxx) + pad - x0 + 1;
    h = Math.ceil(mxy) + pad - y0 + 1;
  }
  if (!(w > 0) || !(h > 0)) throw new Error('取景为空：网格没有可渲染的内容');

  const W = w * ss, H = h * ss;
  const N = W * H;
  const col = new Float32Array(N * 3);
  const cov = new Float32Array(N);
  const zb = new Float32Array(N).fill(-Infinity);
  const fid = new Int32Array(N).fill(EMPTY);

  // ---- 逐面平面着色 + 光栅化 -------------------------------------------
  const nf = mesh.faces.length;
  const fGid = new Int32Array(nf);
  const fN = new Float64Array(nf * 3);
  const fCol = new Float64Array(nf * 3);   // 线性空间基色
  const fAmb = new Float64Array(nf * 3);   // 环境项（含色调）
  const fDif = new Float64Array(nf * 3);   // 直射项（含色调）
  const fLit = new Float64Array(nf * 3);   // 镜面 + 自发光
  const fGrain = new Float64Array(nf);     // 该面的颗粒幅度
  const fPlaneD = new Float64Array(nf);    // 面平面方程的常数项 n·p0（反解世界坐标用）

  // 半程向量：只为了让玻璃有一点亮边，不做能量守恒
  const hv = [
    look.sun[0] + view.viewAxis[0],
    look.sun[1] + view.viewAxis[1],
    look.sun[2] + view.viewAxis[2],
  ];
  const hl = Math.hypot(hv[0], hv[1], hv[2]) || 1;

  for (let fi = 0; fi < nf; fi++) {
    const f = mesh.faces[fi];
    fGid[fi] = f.gid;
    const nx = nrm[fi * 3], ny = nrm[fi * 3 + 1], nz = nrm[fi * 3 + 2];
    fN[fi * 3] = nx; fN[fi * 3 + 1] = ny; fN[fi * 3 + 2] = nz;
    const info = materialInfo(f.mat);
    const { amb, dif } = look.faceLight([nx, ny, nz]);
    let k = 0;
    if (info.spec > 0) {
      const nd = (nx * hv[0] + ny * hv[1] + nz * hv[2]) / hl;
      if (nd > 0) k = info.spec * Math.pow(nd, 26);
    }
    const em = info.emissive;
    fGrain[fi] = info.grain ?? 0;
    const va = mesh.faces[fi].v[0];
    fPlaneD[fi] = nx * pos[va * 3] + ny * pos[va * 3 + 1] + nz * pos[va * 3 + 2];
    for (let c = 0; c < 3; c++) {
      const v = info.color[c] / 255;
      fCol[fi * 3 + c] = v * v;                       // 基色转线性（gamma 2 近似）
      fAmb[fi * 3 + c] = amb[c];
      fDif[fi * 3 + c] = dif[c];
      fLit[fi * 3 + c] = em + (c === 0 ? k : k * (c === 1 ? 0.98 : 0.95));
    }
  }

  for (let fi = 0; fi < nf; fi++) {
    const v = mesh.faces[fi].v;
    // 背面剔除：只画朝向相机的面。
    // 这一步不只是省时间 —— 单面片（招牌、地面片、栏杆、窗框）如果被画了背面，
    // 因为它在深度上更靠前，会把后面的东西整块糊掉，出现"凭空一块黑板"。
    if (cull) {
      const d = fN[fi * 3] * view.viewAxis[0] + fN[fi * 3 + 1] * view.viewAxis[1] + fN[fi * 3 + 2] * view.viewAxis[2];
      if (d <= 0.0001) continue;
    }
    const amb = [fAmb[fi * 3], fAmb[fi * 3 + 1], fAmb[fi * 3 + 2]];
    const dif = [fDif[fi * 3], fDif[fi * 3 + 1], fDif[fi * 3 + 2]];
    const sp = [fLit[fi * 3], fLit[fi * 3 + 1], fLit[fi * 3 + 2]];
    const emis = 0;
    for (let t = 1; t < v.length - 1; t++) {
      const ia = v[0], ib = v[t], ic = v[t + 1];
      const ax = SX[ia] * ss - x0 * ss, ay = SY[ia] * ss - y0 * ss;
      const bx = SX[ib] * ss - x0 * ss, by = SY[ib] * ss - y0 * ss;
      const cx = SX[ic] * ss - x0 * ss, cy = SY[ic] * ss - y0 * ss;
      const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const maxx = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
      const miny = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const maxy = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
      if (minx > maxx || miny > maxy) continue;
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      const inv = 1 / area;

      const br = fCol[fi * 3], bg = fCol[fi * 3 + 1], bb = fCol[fi * 3 + 2];
      const ao0 = mesh.ao[ia], ao1 = mesh.ao[ib], ao2 = mesh.ao[ic];
      const kA = look.aoStrength, kD = look.aoDirect * look.aoStrength;
      const px0 = pos[ia * 3], py0 = pos[ia * 3 + 1], pz0 = pos[ia * 3 + 2];
      const px1 = pos[ib * 3], py1 = pos[ib * 3 + 1], pz1 = pos[ib * 3 + 2];
      const px2 = pos[ic * 3], py2 = pos[ic * 3 + 1], pz2 = pos[ic * 3 + 2];
      const depthK = view.depthK;

      for (let py = miny; py <= maxy; py++) {
        const fy = py + 0.5;
        for (let pxi = minx; pxi <= maxx; pxi++) {
          const fx = pxi + 0.5;
          const w0 = ((bx - fx) * (cy - fy) - (by - fy) * (cx - fx)) * inv;
          if (w0 < 0) continue;
          const w1 = ((cx - fx) * (ay - fy) - (cy - fy) * (ax - fx)) * inv;
          if (w1 < 0) continue;
          const w2 = 1 - w0 - w1;
          if (w2 < 0) continue;

          const di = py * W + pxi;
          // 深度用重心插值出来的世界坐标算，避免透视/斜面上的误差
          const wx = px0 * w0 + px1 * w1 + px2 * w2;
          const wy = py0 * w0 + py1 * w1 + py2 * w2;
          const wz = pz0 * w0 + pz1 * w1 + pz2 * w2;
          const dz = wx + wy + depthK * wz;
          if (dz <= zb[di]) continue;
          zb[di] = dz;
          fid[di] = fi;

          const ao = ao0 * w0 + ao1 * w1 + ao2 * w2;
          const d = 1 - ao;
          const lr = amb[0] * (1 - kA * d) + dif[0] * (1 - kD * d) + sp[0] + emis;
          const lg = amb[1] * (1 - kA * d) + dif[1] * (1 - kD * d) + sp[1] + emis;
          const lb = amb[2] * (1 - kA * d) + dif[2] * (1 - kD * d) + sp[2] + emis;
          const o = di * 3;
          col[o] = br * lr;
          col[o + 1] = bg * lg;
          col[o + 2] = bb * lb;
          cov[di] = 1;
        }
      }
    }
  }

  // ---- 超采样解析（线性空间 + Alpha 加权）------------------------------
  const rgba = new Uint8Array(w * h * 4);
  const outFid = new Int32Array(w * h).fill(EMPTY);
  const invSS = 1 / (ss * ss);
  const g = look.gamma;
  const invG = 1 / g;
  const grade = look.grade ?? NEUTRAL;
  const ot = look.outlineTint ?? [1, 1, 1];
  const grain = look.grain ?? NO_GRAIN;
  const grainOn = grain.enabled;
  const grainScale = grain.scale, grainAmount = grain.amount, grainTwo = grain.twoOctave;
  const HW = view.HW, HH = view.HH, zPx = view.zPx;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, gg = 0, b = 0, a = 0, bestZ = -Infinity, bestFid = EMPTY;
      const base = (y * ss) * W + x * ss;
      for (let sy = 0; sy < ss; sy++) {
        let di = base + sy * W;
        for (let sx = 0; sx < ss; sx++, di++) {
          if (!cov[di]) continue;
          const o = di * 3;
          r += col[o]; gg += col[o + 1]; b += col[o + 2];
          a += 1;
          if (zb[di] > bestZ) { bestZ = zb[di]; bestFid = fid[di]; }
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        let cr = Math.pow(Math.max(0, r / a), invG);
        let cg = Math.pow(Math.max(0, gg / a), invG);
        let cb = Math.pow(Math.max(0, b / a), invG);

        // ---- 材质颗粒（见 core/grain.mjs）-----------------------------
        // 采样点必须是「像素中心的世界坐标」，不能沿用子样本的 —— 否则颗粒强度
        // 会随 ss 变化、斜面上还会起摩尔纹。这里用像素中心的屏幕位置 + 该面的
        // 平面方程反解出世界坐标：
        //     (y-x)·HW = sx ;  (x+y)·HH - z·zPx = sy ;  n·p = d
        // 三个方程、三个未知数，Cramer 直接解。
        if (grainOn) {
          const fi = bestFid;
          const amp = fi >= 0 ? fGrain[fi] * grainAmount : 0;
          if (amp > 0) {
            const na = fN[fi * 3], nb = fN[fi * 3 + 1], nc = fN[fi * 3 + 2];
            const c0 = HH * nc + zPx * nb;
            const c1 = HH * nc + zPx * na;
            const det = -HW * (c0 + c1);
            if (det > 1e-9 || det < -1e-9) {
              const sx = x0 + x + 0.5, sy = y0 + y + 0.5, dd = fPlaneD[fi];
              const t = sy * nc + zPx * dd;
              const gx = (sx * c0 - HW * t) / det;
              const gy = (-HW * t - sx * c1) / det;
              const gz = (-HW * (HH * dd - sy * nb) - HW * (HH * dd - sy * na) + sx * HH * (nb - na)) / det;
              const m = grainAt(gx, gy, gz, grainScale, amp, grainTwo);
              cr *= m; cg *= m; cb *= m;
            }
          }
        }

        // ---- 色彩分级（显示空间，见 core/grade.mjs）--------------------
        if (grade.enabled) {
          // 1) 对比：以 pivot 为支点线性拉开（支点要落在图的实际中调上，
          //    写死在 0.5 会把偏亮的图越推越平）
          const k = grade.contrast;
          if (k !== 1) {
            const pv = grade.pivot;
            cr = pv + (cr - pv) * k;
            cg = pv + (cg - pv) * k;
            cb = pv + (cb - pv) * k;
          }
          // 2) 每通道分档（可选）：平版印刷式的色阶
          const st = grade.steps, pull = grade.stepPull;
          if (st > 0 && pull !== 0) {
            cr += pull * (Math.round(cr * st) / st - cr);
            cg += pull * (Math.round(cg * st) / st - cg);
            cb += pull * (Math.round(cb * st) / st - cb);
          }
          // 3) 饱和度
          const lum = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
          const sat = grade.saturation;
          cr = lum + (cr - lum) * sat;
          cg = lum + (cg - lum) * sat;
          cb = lum + (cb - lum) * sat;
          // 4) 分离调色：阴影往冷、高光往暖 —— 风格化最主要的一步
          const amt = grade.splitAmount;
          if (amt !== 0) {
            const t = lum < 0 ? 0 : lum > 1 ? 1 : lum;
            const iv = 1 - t;
            cr += (grade.shadowTint[0] * iv + grade.highlightTint[0] * t) * amt;
            cg += (grade.shadowTint[1] * iv + grade.highlightTint[1] * t) * amt;
            cb += (grade.shadowTint[2] * iv + grade.highlightTint[2] * t) * amt;
          }
        }

        rgba[o] = cr >= 1 ? 255 : cr <= 0 ? 0 : (cr * 255 + 0.5) | 0;
        rgba[o + 1] = cg >= 1 ? 255 : cg <= 0 ? 0 : (cg * 255 + 0.5) | 0;
        rgba[o + 2] = cb >= 1 ? 255 : cb <= 0 ? 0 : (cb * 255 + 0.5) | 0;
        const ca = a * invSS;
        rgba[o + 3] = ca >= 1 ? 255 : (ca * 255 + 0.5) | 0;
        outFid[y * w + x] = bestFid;
      }
    }
  }

  // ---- 描边（折角 / 面组边界 / 剪影）----------------------------------
  // **默认不画**：描边改成 opt-in。形体越细碎，它越不像"勾轮廓"，而像给整张图
  // 蒙了一层暗网 —— 这栋 5552 面的楼里有 45% 的像素被它碰过、整体压暗 16%。
  // 而且色持（outlineTint 往蓝紫推）在白色面砖上会直接读成"灰"。
  // 想要就显式传 { outline: true }。
  if (opts.outline === true) {
    const sil = opts.outlineSilhouette ?? look.outlineSilhouette;
    const cre = opts.outlineCrease ?? look.outlineCrease;
    const ccos = look.creaseCos;
    const NB = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const me = outFid[i];
        if (me === EMPTY) continue;
        let f = 1;
        for (const [dx, dy] of NB) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) { if (sil < f) f = sil; continue; }
          const other = outFid[ny * w + nx];
          if (other === me) continue;
          let k;
          if (other === EMPTY) k = sil;
          else if (fGid[other] !== fGid[me]) k = cre;
          else {
            const d = fN[me * 3] * fN[other * 3] + fN[me * 3 + 1] * fN[other * 3 + 1] + fN[me * 3 + 2] * fN[other * 3 + 2];
            k = d < ccos ? cre : 1;
          }
          if (k < f) f = k;
        }
        if (f < 1) {
          // 描边「色持」：不是压成黑，而是往深蓝紫收敛。
          // 这一招是插画/预渲染资产里最常见的做法 —— 纯黑轮廓会显得脏且廉价。
          const o = i * 4;
          const vr = rgba[o] * f * ot[0], vg = rgba[o + 1] * f * ot[1], vb = rgba[o + 2] * f * ot[2];
          rgba[o] = vr >= 255 ? 255 : (vr + 0.5) | 0;
          rgba[o + 1] = vg >= 255 ? 255 : (vg + 0.5) | 0;
          rgba[o + 2] = vb >= 255 ? 255 : (vb + 0.5) | 0;
        }
      }
    }
  }

  return { w, h, anchorX: -x0, anchorY: -y0, rgba, fid: outFid };
}

/**
 * 只求取景框，不渲染。用于先确定整组精灵的统一格位尺寸。
 * @returns {{x0:number,y0:number,w:number,h:number}}
 */
export function measureFrame(mesh, view, opts = {}) {
  const pad = opts.pad ?? 2;
  const ang = opts.rot ?? 0;
  const pivot = opts.pivot ?? [0, 0];
  const { pos } = rotateMesh(mesh, ang, pivot[0], pivot[1]);
  const A = view.project(pivot[0], pivot[1], 0);
  let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  const nv = mesh.ao.length;
  for (let i = 0; i < nv; i++) {
    const p = view.project(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    const sx = p[0] - A[0], sy = p[1] - A[1];
    if (sx < mnx) mnx = sx; if (sx > mxx) mxx = sx;
    if (sy < mny) mny = sy; if (sy > mxy) mxy = sy;
  }
  for (const q of opts.extra ?? []) {
    const p = view.project(q[0], q[1], q[2] ?? 0);
    const sx = p[0] - A[0], sy = p[1] - A[1];
    if (sx < mnx) mnx = sx; if (sx > mxx) mxx = sx;
    if (sy < mny) mny = sy; if (sy > mxy) mxy = sy;
  }
  const x0 = Math.floor(mnx) - pad;
  const y0 = Math.floor(mny) - pad;
  return { x0, y0, w: Math.ceil(mxx) + pad - x0 + 1, h: Math.ceil(mxy) + pad - y0 + 1 };
}
