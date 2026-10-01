// 放大检查：把一栋建筑的 4 个朝向裁紧后并排放大，用来盯细节。
//
//   node tools/inspect.mjs res_cottage --zoom 3
//   node tools/inspect.mjs svc_kiosk --rot 2 --zoom 4
//   node tools/inspect.mjs com_office --preset bright --ss 4

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeView } from '../core/project.mjs';
import { makeLook, PRESETS } from '../core/look.mjs';
import { prepareModel, unionFrame, renderModel, listModelFiles } from '../core/bake.mjs';
import { contactSheet, upscale, checker } from '../core/atlas.mjs';
import { encodePNG } from '../core/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

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
const name = String(args._[0] ?? 'res_cottage');
const zoom = Number(args.zoom ?? 3);
const ss = Number(args.ss ?? 3);
const preset = String(args.preset ?? 'stylized');
const onlyRot = args.rot !== undefined ? Number(args.rot) : null;
const bg = args.bg === 'dark' ? [26, 30, 40] : null;

const file = listModelFiles(path.join(ROOT, 'models')).find((f) => path.basename(f, '.model') === name);
if (!file) { console.error(`找不到模型 ${name}`); process.exit(2); }

const view = makeView({ tilePx: Number(args['tile-px'] ?? 256) });
const lookOpts = { preset };
if (args['no-grain']) lookOpts.grain = { enabled: false };
if (args['grain-amount'] !== undefined) lookOpts.grain = { ...(lookOpts.grain ?? {}), amount: Number(args['grain-amount']) };
if (args['grain-scale'] !== undefined) lookOpts.grain = { ...(lookOpts.grain ?? {}), scale: Number(args['grain-scale']) };
const look = makeLook(lookOpts);
const prepared = prepareModel(fs.readFileSync(file, 'utf8'), { name, aoRays: look.aoRays, aoDist: look.aoDist, aoSteps: look.aoSteps });
const frame = unionFrame(prepared, view, { rotations: 4, rotStep: 90, pad: 3 });
const rendered = renderModel(prepared, view, look, { frame, rotations: 4, rotStep: 90, ss, outline: !!args.outline });

const rots = onlyRot === null ? [0, 1, 2, 3] : [onlyRot];
const frames = rots.map((r) => cropTight(rendered.frames[r]));

const outDir = path.join(ROOT, 'out', 'inspect');
fs.mkdirSync(outDir, { recursive: true });
const sheet = contactSheet(frames, { bg: bg ?? [255, 255, 255], gap: 10 });
const up = upscale(sheet, zoom);
const tag = (preset === 'stylized' ? '' : '_' + preset)
  + (args.outline ? '_outline' : '')
  + (args['no-grain'] ? '_nograin' : '')
  + (args['grain-amount'] !== undefined ? '_g' + args['grain-amount'] : '');
const outFile = path.join(outDir, `${name}${onlyRot === null ? '' : `_r${onlyRot}`}${tag}.png`);
fs.writeFileSync(outFile, encodePNG(up.w, up.h, up.rgba));

const { meta, mesh } = prepared;
const bb = mesh.bbox();
console.log(`${meta.name}  占地 ${meta.footprint.join('×')}  面 ${mesh.faces.length}  顶点 ${mesh.ao.length}`);
console.log(`  世界包围盒  x[${bb.mn[0].toFixed(3)}, ${bb.mx[0].toFixed(3)}]  y[${bb.mn[1].toFixed(3)}, ${bb.mx[1].toFixed(3)}]  z[${bb.mn[2].toFixed(3)}, ${bb.mx[2].toFixed(3)}]`);
console.log(`  格位 ${frame.w}×${frame.h}   朝向 ${rots.join(', ')}   放大 ${zoom}×   → ${path.relative(ROOT, outFile)}`);

/** 裁到不透明像素的紧包围盒。 */
function cropTight(img) {
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.rgba[(y * img.w + x) * 4 + 3] > 4) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return img;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * img.w + x0 + x) * 4, d = (y * w + x) * 4;
      out[d] = img.rgba[s]; out[d + 1] = img.rgba[s + 1];
      out[d + 2] = img.rgba[s + 2]; out[d + 3] = img.rgba[s + 3];
    }
  }
  return { w, h, rgba: out };
}
