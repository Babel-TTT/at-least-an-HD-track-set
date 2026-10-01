// 自包含预览页：切朝向 / 切缩放 / 切底色 / 看单张。
// 生成一个不依赖任何外部资源的 HTML。

export function previewHtml(atlas, sheetsB64) {
  const data = JSON.stringify({ atlas, sheets: sheetsB64 });
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8">
<title>flatiso 精灵预览</title>
<style>
  :root { --bg:#12161f; --panel:#1b2130; --line:#2c3446; --fg:#d8dee9; --dim:#8b96ab; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:13px/1.5 ui-monospace,Consolas,"Cascadia Mono",monospace; }
  header { padding:14px 18px; border-bottom:1px solid var(--line); display:flex; gap:18px; flex-wrap:wrap; align-items:center; }
  h1 { font-size:14px; margin:0; font-weight:600; letter-spacing:.04em; }
  .ctl { display:flex; gap:6px; align-items:center; }
  .ctl label { color:var(--dim); }
  button { background:var(--panel); color:var(--fg); border:1px solid var(--line);
           border-radius:5px; padding:3px 9px; cursor:pointer; font:inherit; }
  button[aria-pressed="true"] { background:#33507e; border-color:#4a6ba6; }
  main { padding:18px; }
  .grid { display:flex; flex-wrap:wrap; gap:14px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:10px; }
  .card h3 { margin:0 0 6px; font-size:12px; font-weight:600; color:var(--dim); }
  canvas { display:block; image-rendering:pixelated; }
  .meta { color:var(--dim); font-size:11px; margin-top:6px; }
</style></head>
<body>
<header>
  <h1>FLATISO · 固定 2:1 等距预渲染</h1>
  <div class="ctl"><label>缩放</label><span id="z"></span></div>
  <div class="ctl"><label>底色</label>
    <button data-bg="checker" aria-pressed="true">棋盘</button>
    <button data-bg="dark">深色</button>
    <button data-bg="white">白</button>
  </div>
  <div class="ctl"><label>朝向</label><span id="rot"></span></div>
</header>
<main><div class="grid" id="grid"></div></main>
<script id="payload" type="application/json">${data}</script>
<script>
const P = JSON.parse(document.getElementById('payload').textContent);
const A = P.atlas;
let bgMode = 'checker';
let zoom = 1;
const imgs = {};
for (const s of A.sheets) { const im = new Image(); im.src = 'data:image/png;base64,' + P.sheets[s.key]; imgs[s.key] = im; }

const rotBar = document.getElementById('rot');
const maxRot = Math.max(...A.sheets.map(s => Math.max(...s.sprites.map(x => x.rot)))) + 1;
let rot = 0;
for (let r = 0; r < maxRot; r++) {
  const b = document.createElement('button'); b.textContent = r;
  b.setAttribute('aria-pressed', r === rot);
  b.onclick = () => { rot = r; [...rotBar.querySelectorAll('button')].forEach((x,i)=>x.setAttribute('aria-pressed', i===rot)); draw(); };
  rotBar.appendChild(b);
}
const zBar = document.getElementById('z');
for (const z of [0.25, 0.5, 1, 2]) {
  const b = document.createElement('button'); b.textContent = z + 'x';
  b.setAttribute('aria-pressed', z === zoom);
  b.onclick = () => { zoom = z; [...zBar.querySelectorAll('button')].forEach((x,i)=>x.setAttribute('aria-pressed', [0.25,0.5,1,2][i]===zoom)); draw(); };
  zBar.appendChild(b);
}
document.querySelectorAll('[data-bg]').forEach(b => b.onclick = () => {
  bgMode = b.dataset.bg;
  document.querySelectorAll('[data-bg]').forEach(x => x.setAttribute('aria-pressed', x === b));
  draw();
});

const grid = document.getElementById('grid');
for (const s of A.sheets) {
  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML = '<h3>' + s.key + ' · ' + s.sprites.length + ' 张 · 格位 ' + s.cell[0] + '×' + s.cell[1] + '</h3>';
  const cv = document.createElement('canvas'); cv.dataset.sheet = s.key;
  card.appendChild(cv);
  const m = document.createElement('div'); m.className = 'meta';
  m.textContent = 'anchor [' + s.anchor[0] + ',' + s.anchor[1] + ']  cols ' + s.cols;
  card.appendChild(m);
  grid.appendChild(card);
}

function draw() {
  for (const s of A.sheets) {
    const cv = document.querySelector('canvas[data-sheet="' + s.key + '"]');
    const k = Math.max(0.25, Math.min(4, zoom * (s.key === '2x2' ? 0.6 : s.key === '2x1' ? 0.8 : 1)));
    const list = s.sprites.filter(x => x.rot === rot);
    const cols = Math.max(1, Math.min(list.length, 8));
    const rows = Math.ceil(list.length / cols);
    cv.width = s.cell[0] * k * cols; cv.height = s.cell[1] * k * rows;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (bgMode !== 'checker') { ctx.fillStyle = bgMode === 'dark' ? '#1a1e28' : '#ffffff'; ctx.fillRect(0,0,cv.width,cv.height); }
    list.forEach((sp, i) => {
      const x = (i % cols) * s.cell[0] * k, y = ((i / cols) | 0) * s.cell[1] * k;
      if (bgMode === 'checker') {
        const cs = 8;
        for (let yy = 0; yy < s.cell[1]*k; yy += cs) for (let xx = 0; xx < s.cell[0]*k; xx += cs) {
          ctx.fillStyle = (((xx/cs|0)+(yy/cs|0)) & 1) ? '#3e4452' : '#2a2f3a';
          ctx.fillRect(x+xx, y+yy, cs, cs);
        }
      }
      const sx = sp.col * s.cell[0], sy = sp.row * s.cell[1];
      ctx.drawImage(imgs[s.key], sx, sy, s.cell[0], s.cell[1], x, y, s.cell[0]*k, s.cell[1]*k);
    });
  }
}
draw();
</script>
</body></html>`;
}
