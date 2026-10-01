// 自检：验证投影比例、光栅化、光照、AO、描边都能跑通，并产出一张能肉眼看的 PNG。
// 这里手搓一个"盒体 + 女儿墙 + 单坡顶"的小东西，不经过 .model 解析器。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Mesh, addBox, addPlate, addGable, addCyl, validateMesh } from '../core/mesh.mjs';
import { makeView } from '../core/project.mjs';
import { makeLook } from '../core/look.mjs';
import { bakeAO, bakeContact } from '../core/ao.mjs';
import { renderSprite } from '../core/raster.mjs';
import { encodePNG } from '../core/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'out', 'smoke');
fs.mkdirSync(OUT, { recursive: true });

const view = makeView({ tilePx: 256 });
console.log(`投影自检：tilePx=${view.tilePx}  HW=${view.HW}  HH=${view.HH}  zPx=${view.zPx.toFixed(4)}`);
{
  const a = view.project(0, 0, 0), b = view.project(1, 0, 0), c = view.project(0, 1, 0), d = view.project(1, 1, 0);
  console.log(`  1x1 瓦片四角 (0,0)=${fmt(a)} (1,0)=${fmt(b)} (0,1)=${fmt(c)} (1,1)=${fmt(d)}`);
  console.log(`  → 菱形 ${Math.abs(b[0] - c[0])} 宽 × ${Math.abs(d[1] - a[1])} 高（应为 256 × 128）`);
  console.log(`  → 一条边水平跨 ${Math.abs(b[0] - a[0])} px，竖直跨 ${Math.abs(b[1] - a[1])} px（应为 128 / 64）`);
  const z1 = view.project(0, 0, 1);
  console.log(`  → 一个世界单位高度 = ${Math.abs(z1[1])} px`);
}

// ---- 手搓一个测试模型（1x1 占地）--------------------------------------
const m = new Mesh('smoke');
addPlate(m, 0, 0, 1, 1, 0.004, 'concrete_pad');                 // 地坪
addBox(m, 0.12, 0.14, 0.01, 0.88, 0.86, 0.30, { top: 'stone', all: 'plaster_cream' });   // 主体
addBox(m, 0.12, 0.14, 0.30, 0.88, 0.86, 0.315, 'stone');        // 檐口线脚
addGable(m, 0.12, 0.14, 0.88, 0.86, 0.315, 0.52, 'x', 0.05, { roof: 'roof_tile', side: 'brick_red', bottom: 'trim_dark' });
addBox(m, 0.62, 0.34, 0.42, 0.74, 0.46, 0.60, 'brick_red');     // 烟囱
addBox(m, 0.60, 0.32, 0.60, 0.76, 0.48, 0.63, 'trim_dark');     // 烟囱帽
addBox(m, 0.20, 0.14, 0.05, 0.36, 0.155, 0.14, 'glass_dark');   // 西窗
addBox(m, 0.60, 0.14, 0.05, 0.76, 0.155, 0.14, 'glass');        // 西窗 2
addBox(m, 0.42, 0.855, 0.02, 0.58, 0.875, 0.15, 'wood_dark');   // 南门
addCyl(m, 0.84, 0.16, 0.01, 0.10, 0.05, 0.05, 10, 'trunk');     // 树干
addCyl(m, 0.84, 0.16, 0.10, 0.30, 0.10, 0.0, 10, 'foliage');    // 树冠

const warns = validateMesh(m, [1, 1]);
console.log(`几何自检：${warns.length ? warns.join('；') : '通过'}  面数=${m.faces.length} 顶点=${m.ao.length}`);

// ---- 烘焙 --------------------------------------------------------------
const look = makeLook();          // 默认 soft
const t0 = Date.now();
bakeAO(m, { rays: look.aoRays, dist: look.aoDist, steps: look.aoSteps });
bakeContact(m, 0.86, 0.10);
console.log(`AO 烘焙 ${Date.now() - t0} ms`);

// ---- 渲染 --------------------------------------------------------------
const diamond = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
for (let r = 0; r < 4; r++) {
  const t = Date.now();
  const img = renderSprite(m, view, look, {
    rot: (r * Math.PI) / 2,
    pivot: [0.5, 0.5],
    extra: diamond,
    ss: 3,
  });
  fs.writeFileSync(path.join(OUT, `smoke_r${r}.png`), encodePNG(img.w, img.h, img.rgba));
  if (r === 0) {
    console.log(`渲染 ${img.w}x${img.h}  anchor=(${img.anchorX},${img.anchorY})  ${Date.now() - t} ms`);
    const cover = img.rgba.filter((_, i) => i % 4 === 3 && img.rgba[i] > 0).length;
    console.log(`  不透明像素 ${cover} / ${img.w * img.h}（占位 ${((cover / (img.w * img.h)) * 100).toFixed(1)}%）`);
    console.log(ascii(img));
  }
}

// 拼一张 4 朝向的对照图，白底
{
  const cells = [];
  let cw = 0, chh = 0;
  for (let r = 0; r < 4; r++) {
    const img = renderSprite(m, view, look, { rot: (r * Math.PI) / 2, pivot: [0.5, 0.5], extra: diamond, ss: 3 });
    cells.push(img); cw = Math.max(cw, img.w); chh = Math.max(chh, img.h);
  }
  const sheet = new Uint8Array(cw * 4 * chh * 4).fill(255);
  cells.forEach((img, i) => {
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        const s = (y * img.w + x) * 4, d = (y * cw * 4 + i * cw + x) * 4;
        const a = img.rgba[s + 3] / 255;
        for (let c = 0; c < 3; c++) sheet[d + c] = sheet[d + c] * (1 - a) + img.rgba[s + c] * a;
      }
    }
  });
  fs.writeFileSync(path.join(OUT, 'smoke_4rot.png'), encodePNG(cw * 4, chh, sheet));
  console.log(`写出 out/smoke/smoke_4rot.png  ${cw * 4}x${chh}`);
}

function fmt(p) { return `(${p[0].toFixed(0)},${p[1].toFixed(0)})`; }

function ascii(img) {
  const ramp = ' .:-=+*#%@';
  const lines = [];
  const step = Math.max(1, Math.round(img.w / 64));
  for (let y = 0; y < img.h; y += step * 2) {
    let s = '';
    for (let x = 0; x < img.w; x += step) {
      const i = (y * img.w + x) * 4;
      const a = img.rgba[i + 3] / 255;
      if (a < 0.2) { s += ' '; continue; }
      const l = (img.rgba[i] * 0.3 + img.rgba[i + 1] * 0.6 + img.rgba[i + 2] * 0.1) / 255;
      s += ramp[Math.min(ramp.length - 1, Math.max(1, Math.round(l * (ramp.length - 1))))];
    }
    lines.push(s);
  }
  return lines.join('\n');
}
