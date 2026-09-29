// =============================================================================
// tools/gen-template.mjs —— gfx/openttd.json → src/rails/templates.pnml
//
// flatiso 产出的 openttd.json 里，每个「模型 × 朝向」都带
//   rect[x,y,w,h] / xrel / yrel / azimuth / footprint
// 本工具把它翻成 NML 的 sprite template。
//
// 注意：这里生成的是 **摆放事实**（坐标），不是几何。几何本体是 models/*.model，
//       所以不违反 flatiso「模型是资产不是程序」的铁律。
//
// 槽位顺序（哪张喂给 underlay 的哪一槽）是**有语义的**，写在手写的
// src/rails/railsprite.pnml 里，不在这里生成 —— 便于人工审阅。
//
// 每个 template 内条目的顺序 = 朝向顺序（view 0..N-1），与 flatiso 的
// --rot-step 一致。调用方依赖这一点来选槽位。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { config, log, fail, rel, isMain, anchorToXrelYrel } from './util.mjs';

export function genTemplate() {
  const cfg = config();
  const manifestPath = path.join(cfg.gfxDir, 'openttd.json');
  if (!fs.existsSync(manifestPath)) fail(`找不到 ${rel(manifestPath)} —— 先跑 make render`);

  const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entries = man.entries ?? [];
  if (!entries.length) fail('openttd.json 里没有 entries');

  // 按模型名分组，保持朝向顺序
  const byModel = new Map();
  for (const e of entries) {
    const name = String(e.id).split('#')[0];
    if (!byModel.has(name)) byModel.set(name, []);
    byModel.get(name).push(e);
  }
  for (const list of byModel.values()) list.sort((a, b) => (a.view ?? 0) - (b.view ?? 0));

  const sheets = [...new Set(entries.map((e) => e.sheet))];
  const zoom = man.zoomLevel ?? 'ZOOM_LEVEL_IN_4X';

  const L = [];
  L.push('// ============================================================================');
  L.push('// templates.pnml —— 【自动生成，请勿手改】');
  L.push('//');
  L.push('// 由 tools/gen-template.mjs 从 gfx/openttd.json 生成。');
  L.push('// 要改坐标 → 改 models/*.model 后重跑 `make sprite`，不要改本文件。');
  L.push('//');
  L.push(`// 缩放档 ${zoom}   格位来源 ${sheets.join(', ')}`);
  L.push(`// 共 ${byModel.size} 个模型 / ${entries.length} 张精灵`);
  L.push('//');
  L.push('// 每个朝向一张单条目 template（t_<模型>_v<朝向>），由手写的');
  L.push('// src/rails/railsprite.pnml 决定「哪张喂给引擎的哪一槽」。');
  L.push('//');
  L.push('// xrel/yrel 由 centerAnchor 反推（相对瓦片原点 = 菱形上顶点），');
  L.push('// **不是** openttd.json 里 flatiso 自己的 xrel/yrel —— 后者是相对');
  L.push('// 「旋转后占地矩形的西北角」，对 1×1 模型在 view 1/2/3 会差半格。');
  L.push('// 详见 docs/定标.md。');
  L.push('// ============================================================================');
  L.push('');

  for (const [name, list] of byModel) {
    for (const e of list) {
      const [x, y, w, h] = e.rect;
      const { xrel, yrel } = anchorToXrelYrel(e, man.view);
      const file = `gfx/${e.sheet}`;
      L.push(`template t_${name}_v${e.view ?? 0}() {`);
      L.push(
        `  [${x}, ${y}, ${w}, ${h}, ${xrel}, ${yrel}, "${file}"]` +
        `   // az ${e.azimuth ?? 0}`,
      );
      L.push('}');
    }
    L.push('');
  }

  const outFile = path.join(cfg.srcDir, 'rails', 'templates.pnml');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, L.join('\n'), 'utf8');

  // 同时给 check.mjs / 人工看的机读清单
  const map = {};
  for (const [name, list] of byModel) {
    map[name] = list.map((e) => ({
      view: e.view ?? 0,
      azimuth: e.azimuth ?? 0,
      sheet: e.sheet,
      rect: e.rect,
      xrel: e.xrel,
      yrel: e.yrel,
      footprint: e.footprint,
    }));
  }
  const mapFile = path.join(cfg.srcDir, 'rails', 'sprite_map.json');
  fs.writeFileSync(mapFile, JSON.stringify(map, null, 2) + '\n', 'utf8');

  log(`✔ 模板 ${rel(outFile)}   模型 ${byModel.size} / 精灵 ${entries.length}`);
  log(`✔ 清单 ${rel(mapFile)}`);
  return map;
}

if (isMain(import.meta.url)) {
  genTemplate();
}
