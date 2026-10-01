// OpenTTD 对接层：**只出图，不写 NML**。
//
// 本工程负责把模型渲染成能直接用的 32bpp RGBA 精灵，并把"怎么摆"这件事说清楚；
// GRF / NML 的编写是 GRF 工程自己的事，不在这里做。
// 所以这个模块只产出一份**给程序读的清单**（openttd.json），不做代码生成。
//
// 清单里每条精灵给的是：
//   * `rect`      —— 在图集里的像素矩形（整格）
//   * `xrel/yrel` —— 精灵左上角相对「格子锚点」的偏移（OpenTTD/NML 里就是取负号的那个）
//   * 缩放档      —— tilePx=256 对应 OpenTTD 的 4× 额外缩放档
//   * 逐朝向占地  —— 模型绕占地中心旋转，2×1 转到 90° 就变成 1×2
//
// 坐标系：世界 x 向屏幕左下、y 向屏幕右下、z 向上，1 单位 = 1 瓦片，
// 与 OpenTTD 的 `RemapCoords(x,y,z) = (2*(y-x), x+y-z)` 轴向一致，
// 所以按 RemapCoords 摆出来的位置不需要额外镜像。

/** tilePx → NML 缩放档常量名（只是给清单一个可读标签，不生成代码）。 */
export function zoomLevelName(tilePx) {
  if (tilePx === 64) return 'ZOOM_LEVEL_NORMAL';
  if (tilePx === 128) return 'ZOOM_LEVEL_IN_2X';
  if (tilePx === 256) return 'ZOOM_LEVEL_IN_4X';
  return null;
}

/** 旋转后的占地矩形（模型空间，单位瓦片）。 */
export function rotatedFootprint(w, d, deg) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const cx = w / 2, cy = d / 2;
  const pts = [[0, 0], [w, 0], [w, d], [0, d]].map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  });
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const r = (v) => Math.round(v * 1e6) / 1e6;
  return [
    [r(Math.min(...xs)), r(Math.min(...ys))],
    [r(Math.max(...xs)), r(Math.max(...ys))],
  ];
}

/**
 * 每个精灵在磁盘清单里的条目。
 * @param {object} atlas atlas.json 的内容
 */
export function grfManifest(atlas) {
  const zoom = zoomLevelName(atlas.view.tilePx);
  const entries = [];
  for (const sheet of atlas.sheets) {
    for (const sp of sheet.sprites) {
      entries.push({
        id: sp.id,
        sheet: sheet.file,
        rect: sp.rect,
        size: [sp.rect[2], sp.rect[3]],
        xrel: sp.xrel,
        yrel: sp.yrel,
        zoom: atlas.view.tilePx,
        zoomLevel: zoom,
        bitDepth: 32,
        view: sp.rot,
        azimuth: sp.azimuth,
        footprint: sheet.footprint,
        footprintRotated: sp.footprintRotated,
        /** 占地中心在精灵内的像素（不随朝向变化，可作为备选锚点） */
        centerAnchor: sheet.anchor,
      });
    }
  }
  return {
    format: 'flatiso-openttd/1',
    note: [
      '32bpp RGBA 图集清单。NML/GRF 的编写不在本工程范围内。',
      `tilePx=${atlas.view.tilePx} → ${zoom}`,
      'xrel/yrel 是相对「该朝向的模型原点（占地西北角格角点）投影」的偏移，取负号，单位是精灵像素。',
      'footprintRotated 是模型绕占地中心旋转后的占地矩形；2×1 的 90°/270° 朝向会变成 1×2。',
      '摆放：屏幕位置 = ((tileX - tileY) * HW, (tileX + tileY) * HH)，再减去 (-xrel, -yrel) 的绝对值。',
    ],
    zoomLevel: zoom,
    bitDepth: 32,
    view: atlas.view,
    entries,
  };
}
