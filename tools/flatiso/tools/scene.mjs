// 合成预览：按**引擎侧的摆放公式**把图集里的精灵拼成一张等距小城。
//
//   node tools/scene.mjs
//   node tools/scene.mjs --scale 2
//
// 这不是"再渲染一遍"，而是拿图集 PNG 直接贴 —— 所以它同时是一次端到端验证：
// 如果 anchor / cell 算错了，楼就会错位、穿地或者对不上格子。
// 布局是写死的字面量地图，跟建模一样不放随机数。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePNG, encodePNG } from '../core/png.mjs';
import { materialColor } from '../core/materials.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const OUT = path.join(ROOT, 'out', 'atlas');

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s.startsWith('--')) a[s.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else a._.push(s);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const scale = Number(args.scale ?? 1);

// ---- 读图集 ---------------------------------------------------------------
const atlas = JSON.parse(fs.readFileSync(path.join(OUT, 'atlas.json'), 'utf8'));
const HW = atlas.view.HW, HH = atlas.view.HH, ZPX = atlas.view.zPx;
const sheets = new Map();
for (const s of atlas.sheets) sheets.set(s.key, { meta: s, img: decodePNG(fs.readFileSync(path.join(OUT, s.file))) });

const spriteOf = (name, rot) => {
  for (const s of sheets.values()) {
    const hit = s.meta.sprites.find((x) => x.name === name && x.rot === rot);
    if (hit) return { sp: hit, sheet: s };
  }
  throw new Error(`图集里没有 ${name}#${rot}`);
};

// ---- 场景（字面量）--------------------------------------------------------
// '.' 草地  'g' 深草地  'p' 混凝土铺装  'a' 沥青  'k' 路缘
// x=7 是南北向道路，y=6/7 是东西向道路，十字路口在 (7,6)。
const MAP = [
  '.......a........',
  '..pp...a..pp....',
  '..pp...a..pp....',
  '.....p.a.p......',
  '.......a........',
  'kkkkkkkakkkkkkkk',
  'aaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
  'kkkkkkkakkkkkkkk',
  '..pp...a.pp.....',
  '..pp...a........',
  '..pp...a........',
  '....pp.a........',
];

const BUILDINGS = [
  // 模型,               朝向, 格 x, 格 y
  { name: 'res_apartment', rot: 0, tx: 2, ty: 1 },
  { name: 'com_bldg90', rot: 0, tx: 6, ty: 0 },
  { name: 'com_hotel90', rot: 0, tx: 12, ty: 0 },
  { name: 'com_office', rot: 0, tx: 10, ty: 1 },
  { name: 'res_cottage', rot: 0, tx: 5, ty: 3 },
  { name: 'res_bungalow', rot: 0, tx: 13, ty: 3 },
  { name: 'res_bungalow', rot: 1, tx: 5, ty: 11 },
  { name: 'svc_kiosk', rot: 0, tx: 9, ty: 3 },
  { name: 'ind_factory', rot: 0, tx: 2, ty: 9 },
  { name: 'ind_warehouse', rot: 0, tx: 9, ty: 9 },
  { name: 'res_terrace', rot: 0, tx: 4, ty: 12 },
  // 顺便验一下旋转后的锚点与占地（2x1 转 90° 会变成 1x2）
  { name: 'res_cottage', rot: 1, tx: 13, ty: 4 },
  { name: 'svc_kiosk', rot: 3, tx: 13, ty: 10 },
  { name: 'res_terrace', rot: 1, tx: 11, ty: 10 },
];

// 地形颜色直接读材质表 —— 这样模型自带的绿地（plate）和场景地形永远一致
const TILE = {
  '.': materialColor('grass'),
  g: materialColor('grass_dark'),
  p: materialColor('concrete_pad'),
  a: materialColor('asphalt'),
  k: materialColor('kerb'),
};

const D = MAP.length;          // 深（y 方向格数）
const W = MAP[0].length;       // 宽（x 方向格数）
const HEAD = Math.ceil(2.6 * ZPX);   // 最高的楼 com_office z=2.40
const PAD = 10;
const CW = (W + D) * HW + PAD * 2;
const CH = (W + D) * HH + HEAD + PAD * 2;
const OX = D * HW + PAD;
const OY = HEAD + PAD;

const buf = new Uint8Array(CW * CH * 4);   // 透明背景
const P = (x, y, z = 0) => [OX + (y - x) * HW, OY + (x + y) * HH - z * ZPX];

function px(x, y, c, a = 1) {
  if (x < 0 || y < 0 || x >= CW || y >= CH) return;
  const i = (y * CW + x) * 4;
  const inv = 1 - a;
  buf[i] = buf[i] * inv + c[0] * a;
  buf[i + 1] = buf[i + 1] * inv + c[1] * a;
  buf[i + 2] = buf[i + 2] * inv + c[2] * a;
  buf[i + 3] = Math.min(255, buf[i + 3] + 255 * a);
}

/** 2:1 菱形瓦片填充（宽 2·half、高 2·half/2）。 */
function tileDiamond(tx, ty, c) {
  const cx = OX + (ty - tx) * HW;
  const top = OY + (tx + ty) * HH;
  for (let dy = 0; dy <= 2 * HH; dy++) {
    const h = dy <= HH ? 2 * dy : 2 * (2 * HH - dy);
    const y = top + dy;
    for (let x = cx - h; x < cx + h; x++) px(x, y, c);
    // 下两条边压一条细缝，让格子读得出来
    if (h > 1) {
      px(cx - h, y, [c[0] * 0.86, c[1] * 0.86, c[2] * 0.86]);
      px(cx + h - 1, y, [c[0] * 0.86, c[1] * 0.86, c[2] * 0.86]);
    }
  }
}

/** 把图集里的一格贴到屏幕上（alpha 合成）。 */
function blit(meta, img, sx, sy, dx, dy) {
  for (let y = 0; y < meta.cell[1]; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= CH) continue;
    for (let x = 0; x < meta.cell[0]; x++) {
      const txp = dx + x;
      if (txp < 0 || txp >= CW) continue;
      const s = ((sy + y) * img.width + sx + x) * 4;
      const a = img.rgba[s + 3] / 255;
      if (a <= 0) continue;
      px(txp, ty, [img.rgba[s], img.rgba[s + 1], img.rgba[s + 2]], a);
    }
  }
}

// ---- 画 ------------------------------------------------------------------
for (let ty = 0; ty < D; ty++) {
  for (let tx = 0; tx < W; tx++) {
    const ch = MAP[ty][tx] ?? '.';
    tileDiamond(tx, ty, TILE[ch] ?? TILE['.']);
  }
}

// 画家算法：按 (x+y) 从小到大，越靠前的越后画
const order = [...BUILDINGS].sort((a, b) => (a.tx + a.ty) - (b.tx + b.ty) || a.tx - b.tx);
for (const b of order) {
  const { sp, sheet } = spriteOf(b.name, b.rot);
  const [fw, fd] = sheet.meta.footprint;
  // 旋转 90°/270° 时占地跟着转
  const rw = b.rot % 2 === 0 ? fw : fd;
  const rd = b.rot % 2 === 0 ? fd : fw;
  const cx = b.tx + rw / 2, cy = b.ty + rd / 2;
  const p = P(cx, cy);
  const dx = Math.round(p[0] - sheet.meta.anchor[0]);
  const dy = Math.round(p[1] - sheet.meta.anchor[1]);
  blit(sheet.meta, sheet.img, sp.col * sheet.meta.cell[0], sp.row * sheet.meta.cell[1], dx, dy);
  console.log(`  ${b.name.padEnd(15)} rot${b.rot}  @(${b.tx},${b.ty})  画在 (${dx},${dy})  anchor (${sheet.meta.anchor})`);
}

// ---- 输出 ----------------------------------------------------------------
const dir = path.join(ROOT, 'out', 'preview');
fs.mkdirSync(dir, { recursive: true });
const out = scale === 1 ? buf : (() => {
  const w = CW * scale, h = CH * scale;
  const o = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (((y / scale) | 0) * CW + ((x / scale) | 0)) * 4;
      const d = (y * w + x) * 4;
      o[d] = buf[s]; o[d + 1] = buf[s + 1]; o[d + 2] = buf[s + 2]; o[d + 3] = buf[s + 3];
    }
  }
  return o;
})();
const file = path.join(dir, scale === 1 ? 'scene.png' : `scene_${scale}x.png`);
fs.writeFileSync(file, encodePNG(CW * scale, CH * scale, out));
console.log(`\n场景 ${W}×${D} 格 · ${BUILDINGS.length} 栋 → ${path.relative(ROOT, file)}  ${CW * scale}×${CH * scale}`);
