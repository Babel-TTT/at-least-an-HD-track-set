// 模型 → 精灵。负责取景、多朝向、统一格位。
//
// 取景策略（"排列规则、便于程序使用"的关键）
// ------------------------------------------
// 同一个占地的所有建筑共用**完全相同的格位尺寸**，而且每个朝向共用
// **同一个取景框**。于是：
//   * 格位里对应"占地中心在地面的投影"的那个像素，在同一张图集里是常量
//     —— 引擎只需要一个 anchor，不用逐个精灵查表；
//   * 精灵都摆在规则网格里，(col,row) 直接乘格子尺寸就是矩形。
//
// 之所以用"占地中心"而不是"西北角"当锚点：绕占地中心旋转时锚点**不变**，
// 2x1 的楼转 90° 之后仍然对得上；用角点的话每个朝向的锚点都不一样。

import fs from 'node:fs';
import path from 'node:path';

import { parseModel } from './model.mjs';
import { validateMesh } from './mesh.mjs';
import { bakeAO, bakeContact } from './ao.mjs';
import { renderSprite, measureFrame } from './raster.mjs';

/**
 * 解析并烘焙一个模型（不含渲染）。
 * @returns {{meta:object, mesh:object, warnings:string[], pivot:number[]}}
 */
export function prepareModel(text, opts = {}) {
  const { meta, mesh } = parseModel(text, opts);
  // 第 4 个参数 = 允许探出名义占地的量（见 core/mesh.mjs 的 OVERFLOW_ALLOW）。
  // 传 undefined 就用模块默认值。
  const warnings = validateMesh(mesh, meta.footprint, opts.tol ?? 0.02, opts.overflow);
  if (opts.ao !== false) {
    bakeAO(mesh, {
      rays: opts.aoRays ?? 20,
      dist: opts.aoDist ?? 0.9,
      steps: opts.aoSteps ?? 16,
      bias: opts.aoBias ?? 0.012,
    });
  }
  bakeContact(mesh, opts.contactFloor ?? 0.86, opts.contactHeight ?? 0.10);
  return { meta, mesh, warnings, pivot: [meta.footprint[0] / 2, meta.footprint[1] / 2] };
}

/**
 * 求某个模型在全部朝向下共用的取景框（相对"占地中心投影"的屏幕坐标）。
 * @returns {{x0:number,y0:number,w:number,h:number}}
 */
export function unionFrame(prepared, view, opts = {}) {
  const { meta, mesh, pivot } = prepared;
  const [fw, fd] = meta.footprint;
  const rotations = opts.rotations ?? 4;
  const step = opts.rotStep ?? 90;
  const pad = opts.pad ?? 3;

  // 占地菱形四角 + 可选的高度天花板，保证同占地的精灵格位一致
  const extra = [[0, 0, 0], [fw, 0, 0], [fw, fd, 0], [0, fd, 0]];
  if (meta.zmax) extra.push([pivot[0], pivot[1], meta.zmax]);

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let r = 0; r < rotations; r++) {
    const f = measureFrame(mesh, view, {
      rot: (r * step * Math.PI) / 180,
      pivot,
      extra,
      pad,
    });
    x0 = Math.min(x0, f.x0); y0 = Math.min(y0, f.y0);
    x1 = Math.max(x1, f.x0 + f.w); y1 = Math.max(y1, f.y0 + f.h);
  }
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * 渲染一个模型的全部朝向。
 * @param {object} prepared
 * @param {object} view
 * @param {object} look
 * @param {{frame:object, rotations:number, rotStep:number, ss:number}} opts
 * @returns {{meta, frames:Array<{w,h,rgba}>, pivot:number[]}}
 */
export function renderModel(prepared, view, look, opts = {}) {
  const { meta, mesh, pivot } = prepared;
  const rotations = opts.rotations ?? 4;
  const step = opts.rotStep ?? 90;
  const frame = opts.frame;
  const frames = [];
  for (let r = 0; r < rotations; r++) {
    const img = renderSprite(mesh, view, look, {
      rot: (r * step * Math.PI) / 180,
      pivot,
      frame: [frame.x0, frame.y0, frame.w, frame.h],
      ss: opts.ss ?? 3,
      outline: opts.outline,
      cull: opts.cull,
    });
    frames.push({ w: img.w, h: img.h, rgba: img.rgba, anchorX: img.anchorX, anchorY: img.anchorY });
  }
  return { meta, frames, pivot };
}

/** 目前不需要 measureOnly 分支，但保留参数校验，避免静默走错路。 */
export function assertFrame(frame) {
  if (!frame || !(frame.w > 0) || !(frame.h > 0)) throw new Error('取景框非法');
}

export function loadModelFile(file) {
  return fs.readFileSync(file, 'utf8');
}

export function listModelFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.model')).sort().map((f) => path.join(dir, f));
}
