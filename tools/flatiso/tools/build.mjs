// 命令行入口：模型 → 精灵 → 图集 + 元数据 + 预览页。
//
//   node tools/build.mjs                          全部模型，默认观感
//   node tools/build.mjs --only res_cottage       只出某个模型
//   node tools/build.mjs --preset bright --ss 4   更亮 / 更高超采样
//   node tools/build.mjs --rotations 1            只出正面一个朝向
//   node tools/build.mjs --flat                   额外导出单张 PNG

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeView } from '../core/project.mjs';
import { makeLook, PRESETS } from '../core/look.mjs';
import { prepareModel, unionFrame, renderModel, listModelFiles } from '../core/bake.mjs';
import { packSheets, writeSheets, darken, contactSheet, upscale, checker } from '../core/atlas.mjs';
import { encodePNG } from '../core/png.mjs';
import { previewHtml } from '../core/preview.mjs';
import { grfManifest, rotatedFootprint, zoomLevelName } from '../core/grf.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s.startsWith('--')) {
      const k = s.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      a[k] = v;
    } else a._.push(s);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const modelsDir = String(args.models ?? path.join(ROOT, 'models'));
const outName = String(args.name ?? 'atlas');
const outDir = String(args.out ?? path.join(ROOT, 'out', outName));
const rotations = Number(args.rotations ?? 4);
const rotStep = Number(args['rot-step'] ?? 90);
const ss = Number(args.ss ?? 3);
const cols = Number(args.cols ?? 8);
const tilePx = Number(args['tile-px'] ?? 256);
const zPxOverride = args.zpx ? Number(args.zpx) : null;
const preset = String(args.preset ?? 'stylized');
const flat = !!args.flat;
const cull = !args['no-cull'];
// ★ 人工授权（本工程 实现计划.md D5）：只加"镜像"能力，不放宽任何检查。
//   core/project.mjs 里本来就有 mirror 分支，这里把它接到命令行即可。
const mirror = !!args.mirror;
// 描边默认关（见 core/raster.mjs 末尾的说明）；要就显式传 --outline
const outline = !!args.outline;

if (!PRESETS[preset]) {
  console.error(`未知观感预设「${preset}」。可用：${Object.keys(PRESETS).join(', ')}`);
  process.exit(2);
}

const view = makeView({ tilePx, zPx: zPxOverride, mirror });
const lookOpts = { preset };
if (args['no-grain']) lookOpts.grain = { enabled: false };
if (args['grain-amount'] !== undefined) lookOpts.grain = { ...(lookOpts.grain ?? {}), amount: Number(args['grain-amount']) };
if (args['grain-scale'] !== undefined) lookOpts.grain = { ...(lookOpts.grain ?? {}), scale: Number(args['grain-scale']) };
const look = makeLook(lookOpts);

let files = listModelFiles(modelsDir);
if (args.only) {
  const want = String(args.only).split(',').map((s) => s.trim());
  files = files.filter((f) => want.includes(path.basename(f, '.model')));
}
if (!files.length) {
  console.error(`没有找到模型：${modelsDir}`);
  process.exit(2);
}

console.log(`flatiso 构建`);
console.log(`  模型目录  ${modelsDir}`);
console.log(`  输出目录  ${outDir}`);
console.log(`  投影      tilePx=${view.tilePx}  1x1 = ${view.tilePx}×${view.tilePx / 2}px  zPx=${view.zPx.toFixed(3)}`);
console.log(`  观感      ${preset}   朝向 ${rotations}×${rotStep}°   超采样 ${ss}×`);
console.log('');

const items = [];
let warnCount = 0;
const t0 = Date.now();

for (const file of files) {
  const stem = path.basename(file, '.model');
  let prepared;
  try {
    prepared = prepareModel(fs.readFileSync(file, 'utf8'), {
      name: stem,
      aoRays: look.aoRays, aoDist: look.aoDist, aoSteps: look.aoSteps, aoBias: look.aoBias,
    });
  } catch (e) {
    console.error(`  ✗ ${stem}: ${e.message}`);
    process.exitCode = 1;
    continue;
  }
  const { meta, mesh, warnings } = prepared;
  if (warnings.length) {
    warnCount += warnings.length;
    for (const w of warnings) console.warn(`  ! ${stem}: ${w}`);
  }

  const t1 = Date.now();
  const frame = unionFrame(prepared, view, { rotations, rotStep, pad: 3 });
  const rendered = renderModel(prepared, view, look, { frame, rotations, rotStep, ss, cull, outline });

  // 逐朝向算 OpenTTD 锚点：地图上"该格西北角格角点"在精灵里的像素位置。
  // 模型绕占地中心旋转，所以 (0,0,0) 这个物理点转到 r 朝向时落在别处，要跟着转。
  const [fw, fd] = meta.footprint;
  const pivot = [fw / 2, fd / 2];
  const pivotScreen = view.project(pivot[0], pivot[1], 0);

  rendered.frames.forEach((f, r) => {
    const ang = (r * rotStep * Math.PI) / 180;
    const c = Math.cos(ang), s = Math.sin(ang);
    const dx = 0 - pivot[0], dy = 0 - pivot[1];
    const rx = pivot[0] + dx * c - dy * s;
    const ry = pivot[1] + dx * s + dy * c;
    const q = view.project(rx, ry, 0);
    items.push({
      id: `${meta.name}#${r}`,
      name: meta.name,
      group: meta.group,
      footprint: meta.footprint,
      rot: r,
      azimuth: (r * rotStep) % 360,
      frames: [f],
      frame,
      originOffset: [q[0] - pivotScreen[0], q[1] - pivotScreen[1]],
      footprintRotated: rotatedFootprint(fw, fd, r * rotStep),
    });
  });

  const bb = mesh.bbox();
  console.log(
    `  ✓ ${stem.padEnd(22)} ${meta.group.padEnd(12)} 占地 ${meta.footprint.join('×')}  ` +
    `面 ${String(mesh.faces.length).padStart(5)}  高 ${bb.mx[2].toFixed(2)}  格位 ${frame.w}×${frame.h}  ` +
    `${rotations} 朝向 ${Date.now() - t1} ms`,
  );
}

const sheets = packSheets(items, { cols });
fs.mkdirSync(outDir, { recursive: true });
const filesWritten = writeSheets(outDir, sheets);

// ---- flat 单张导出 ------------------------------------------------------
if (flat) {
  const dir = path.join(outDir, 'sprites');
  fs.mkdirSync(dir, { recursive: true });
  for (const s of sheets) {
    for (const sp of s.sprites) {
      const [rx, ry, rw, rh] = sp.rect;
      const cropped = { w: rw, h: rh, rgba: s._px.subarray(0) };
      const buf = new Uint8Array(rw * rh * 4);
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const src = ((ry + y) * s._W + rx + x) * 4, dst = (y * rw + x) * 4;
          buf[dst] = s._px[src]; buf[dst + 1] = s._px[src + 1];
          buf[dst + 2] = s._px[src + 2]; buf[dst + 3] = s._px[src + 3];
        }
      }
      fs.writeFileSync(path.join(dir, `${sp.id}.png`), encodePNG(rw, rh, buf));
    }
  }
  console.log(`  → ${sheets.reduce((n, s) => n + s.sprites.length, 0)} 张单图 → ${path.relative(ROOT, path.join(outDir, 'sprites'))}`);
}

// ---- 元数据 -------------------------------------------------------------
const atlas = {
  format: 'flatiso-atlas/1',
  generated: new Date().toISOString(),
  view: {
    tilePx: view.tilePx,
    HW: view.HW,
    HH: view.HH,
    zPx: view.zPx,
    projection: `screen_x = (x - y) * ${view.HW}; screen_y = (x + y) * ${view.HH} - z * ${view.zPx.toFixed(4)}`,
    note: '1x1 瓦片 = 256×128 px 菱形；瓦片一条边水平跨 128 px。x 向东、y 向南、z 向上，单位为瓦片。',
  },
  look: {
    preset,
    sun: look.sun, sunColor: look.sunColor, skyColor: look.skyColor, groundColor: look.groundColor,
    ambient: look.ambient, sunIntensity: look.sunIntensity, sunSoftness: look.sunSoftness,
    aoStrength: look.aoStrength, aoDirect: look.aoDirect,
    outlineSilhouette: look.outlineSilhouette, outlineCrease: look.outlineCrease, creaseAngle: look.creaseAngle,
  },
  sheetOrder: sheets.map((s) => s.key),
  sheets: sheets.map((s) => ({
    key: s.key,
    footprint: s.footprint,
    file: s.file,
    preview: s.preview,
    cell: s.cell,
    cols: s.cols,
    rows: s.rows,
    size: s.size,
    anchor: s.anchor,
    count: s.sprites.length,
    sprites: s.sprites,
  })),
};
fs.writeFileSync(path.join(outDir, 'atlas.json'), JSON.stringify(atlas, null, 2) + '\n');

// ---- 预览页 -------------------------------------------------------------
const b64 = {};
for (const s of sheets) {
  b64[s.key] = Buffer.from(encodePNG(s._W, s._H, s._px)).toString('base64');
}
fs.writeFileSync(path.join(outDir, 'preview.html'), previewHtml(atlas, b64));

// ---- OpenTTD 对接（只出图 + 摆放清单，不写 NML）--------------------------
{
  const d = path.join(outDir, '32bpp');
  fs.mkdirSync(d, { recursive: true });
  for (const s of sheets) fs.writeFileSync(path.join(d, s.file), encodePNG(s._W, s._H, s._px));

  const manifest = grfManifest(atlas);
  fs.writeFileSync(path.join(outDir, 'openttd.json'), JSON.stringify(manifest, null, 2) + '\n');

  const zl = zoomLevelName(view.tilePx);
  if (!zl) console.warn(`  ! tilePx=${view.tilePx} 不对应 OpenTTD 的标准缩放档（64 / 128 / 256）`);
  console.log(`  → 出图：32bpp/（图集副本）· openttd.json（摆放清单）  ${zl ? `[${zl}]` : ''}`);
}

// ---- 一张总的对照图（每个模型第一个朝向）--------------------------------
{
  const firsts = items.filter((it) => it.rot === 0).map((it) => it.frames[0]);
  if (firsts.length) {
    const cs = contactSheet(firsts);
    fs.writeFileSync(path.join(outDir, 'contact.png'), encodePNG(cs.w, cs.h, cs.rgba));
    const up = upscale(cs, 2);
    fs.writeFileSync(path.join(outDir, 'contact_2x.png'), encodePNG(up.w, up.h, up.rgba));
  }
}

const total = sheets.reduce((n, s) => n + s.sprites.length, 0);
console.log('');
console.log(`完成：${items.length / rotations} 个模型 / ${total} 张精灵 / ${sheets.length} 张图集，用时 ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (warnCount) console.log(`注意：${warnCount} 条几何警告`);
for (const s of sheets) {
  console.log(`  ${s.file.padEnd(10)} ${String(s.size[0]).padStart(5)}×${String(s.size[1]).padEnd(5)} 格位 ${s.cell[0]}×${s.cell[1]}  ${s.cols}×${s.rows}  ${s.sprites.length} 张`);
}
console.log(`  → ${path.relative(ROOT, path.join(outDir, 'atlas.json'))}`);
console.log(`  → ${path.relative(ROOT, path.join(outDir, 'preview.html'))}`);

export { checker, darken };
