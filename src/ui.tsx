import * as React from 'react';
import { createRoot } from 'react-dom/client';
import './ui.css';

type Msg =
  | { type: 'status'; text: string }
  | { type: 'warn'; text: string }
  | { type: 'progress'; text: string }
  | { type: 'done'; json: string; levels: any[] }
  | { type: 'error'; text: string };

// ---------- Canvas Preview Helpers ----------

type Vec2 = [ number, number ];
type Viewport = { scale: number; offsetX: number; offsetY: number };
type ScaleMode = 'fit' | 'ppu';

function rapierToCanvas([ x, y ]: Vec2, level: { width: number; height: number }, view: Viewport): Vec2 {
  // Rapier: центр-орижин, Y-вверх → Canvas: левый-верх, Y-вниз
  const tlx = level.width / 2 + x;
  const tly = level.height / 2 - y;
  return [ view.offsetX + tlx * view.scale, view.offsetY + tly * view.scale ];
}

function drawPolyline(ctx: CanvasRenderingContext2D, pts: Vec2[]) {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function drawPolygon(ctx: CanvasRenderingContext2D, pts: Vec2[]) {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.stroke();
}

function rotated(p: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [ p[0] * c - p[1] * s, p[0] * s + p[1] * c ];
}

function add(a: Vec2, b: Vec2): Vec2 {
  return [ a[0] + b[0], a[1] + b[1] ];
}

function rectCorners(size: Vec2): Vec2[] {
  const [ w, h ] = size;
  const hw = w / 2, hh = h / 2;
  return [ [ -hw, -hh ], [ hw, -hh ], [ hw, hh ], [ -hw, hh ] ];
}

function drawCollider(
  ctx: CanvasRenderingContext2D,
  collider: any,
  go: any,
  level: { width: number; height: number },
  view: Viewport,
) {
  // world (Rapier) transform of this collider relative to level center
  const goRot = go.rotation as number;
  const goPos = go.position as Vec2;
  const colRot = (collider.rotation || 0) as number;
  const colPos = (collider.position || [ 0, 0 ]) as Vec2;

  const worldRot = goRot + colRot;
  const worldPos: Vec2 = add(goPos, rotated(colPos, goRot));

  switch (collider.type) {
    case 'Cuboid': {
      const corners = rectCorners(collider.size as Vec2).map(p => rotated(p, worldRot)).map(p => add(p, worldPos));
      const pts = corners.map(p => rapierToCanvas(p, level, view));
      drawPolygon(ctx, pts);
      break;
    }
    case 'Ball': {
      const center = rapierToCanvas(worldPos, level, view);
      ctx.beginPath();
      ctx.arc(center[0], center[1], collider.radius * view.scale, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'ConvexHull': {
      const pts = (collider.vertices as Vec2[])
        .map(v => rotated(v, worldRot))
        .map(v => add(v, worldPos))
        .map(p => rapierToCanvas(p, level, view));
      drawPolygon(ctx, pts);
      break;
    }
    case 'Polyline': {
      const pts = (collider.vertices as Vec2[])
        .map(v => rotated(v, worldRot))
        .map(v => add(v, worldPos))
        .map(p => rapierToCanvas(p, level, view));
      drawPolyline(ctx, pts);
      break;
    }
    case 'Trimesh': {
      const verts = (collider.triangles.vertices as Vec2[])
        .map(v => rotated(v, worldRot))
        .map(v => add(v, worldPos))
        .map(p => rapierToCanvas(p, level, view));
      const idx = collider.triangles.indices as number[];
      for (let i = 0; i < idx.length; i += 3) {
        const a = verts[idx[i]], b = verts[idx[i + 1]], c = verts[idx[i + 2]];
        drawPolygon(ctx, [ a, b, c ]);
      }
      break;
    }
    case 'Compound': {
      for (const ch of collider.children as any[]) {
        const pseudoGO = { position: worldPos, rotation: worldRot };
        drawCollider(ctx, ch, pseudoGO, level, view);
      }
      break;
    }
  }
}

function autoViewport(
  level: { width: number; height: number; meta?: any },
  canvas: HTMLCanvasElement,
  mode: 'fit' | 'ppu',
): Viewport {
  const pad = 12;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const ppu = level?.meta?.units?.pixelsPerUnit ?? 1;

  if (mode === 'ppu') {
    // 1 unit = PPU px (как «исходные размеры» в Фигме)
    return { scale: Math.max(ppu, 0.0001), offsetX: pad, offsetY: pad };
  }

  // mode === 'fit' — подгон по окну
  const scale = Math.max(
    0.0001,
    Math.min((cssW - pad * 2) / level.width, (cssH - pad * 2) / level.height),
  );
  return { scale, offsetX: pad, offsetY: pad };
}

function drawLevelPreview(canvas: HTMLCanvasElement, level: any, showGrid = true, scaleMode: ScaleMode = 'ppu') {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (canvas.width !== cssW * dpr) canvas.width = cssW * dpr;
  if (canvas.height !== cssH * dpr) canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#24a0ff';

  const view = autoViewport(level, canvas, scaleMode);

  // level frame
  const tl = rapierToCanvas([ -level.width / 2, level.height / 2 ], level, view);
  const br = rapierToCanvas([ level.width / 2, -level.height / 2 ], level, view);
  ctx.strokeStyle = '#888';
  drawPolygon(ctx, [ [ tl[0], tl[1] ], [ br[0], tl[1] ], [ br[0], br[1] ], [ tl[0], br[1] ] ]);

  if (showGrid) drawGrid(ctx, { width: level.width, height: level.height }, view);

  // colliders + RB center markers
  for (const go of level.gameObjects as any[]) {
    if (go.collider) {
      ctx.strokeStyle = '#24a0ff';
      drawCollider(ctx, go.collider, go, { width: level.width, height: level.height }, view);
    }

    // RigidBody center (GameObject.position) — constant pixel size
    const centerPx = rapierToCanvas(go.position as Vec2, level, view);
    ctx.save();
    ctx.strokeStyle = '#e33';
    ctx.lineWidth = 1.5;
    drawCrosshair(ctx, centerPx, 6);
    ctx.restore();
  }
}

// ---------- UI ----------

function App() {
  const [ status, setStatus ] = React.useState('Idle');
  const [ warnings, setWarnings ] = React.useState<string[]>([]);
  const [ json, setJson ] = React.useState('');
  const [ levels, setLevels ] = React.useState<any[]>([]);
  const [ levelIndex, setLevelIndex ] = React.useState(0);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [ scaleMode, setScaleMode ] = React.useState<ScaleMode>('ppu');
  const [ showGrid, setShowGrid ] = React.useState<boolean>(true);

  const [ ppu, setPpu ] = React.useState<number>(1);

  React.useEffect(() => {
    window.onmessage = (e) => {
      const msg = e.data.pluginMessage as Msg;
      if (!msg) return;
      if (msg.type === 'status') setStatus(msg.text);
      if (msg.type === 'warn') setWarnings(w => [ ...w, msg.text ]);
      if (msg.type === 'progress') setStatus(msg.text);
      if (msg.type === 'done') {
        setStatus('Done');
        setJson(msg.json);
        setLevels(msg.levels || []);
        setLevelIndex(0);
      }
      if (msg.type === 'error') {
        setStatus('Error');
        setWarnings(w => [ ...w, msg.text ]);
      }
    };
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!levels[levelIndex]) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    drawLevelPreview(canvas, levels[levelIndex], showGrid, scaleMode);
  }, [ levels, levelIndex, json ]);

  React.useEffect(() => {
    const onResize = () => {
      const canvas = canvasRef.current;
      if (canvas && levels[levelIndex]) drawLevelPreview(canvas, levels[levelIndex], showGrid, scaleMode);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [ levels, levelIndex ]);

  const download = () => {
    const blob = new Blob([ json ], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'level-export.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="wrap">
      <div className="header">
        <h2>Rapier 2D Collider Export</h2>
        <div className="actions">
          <label title="Pixels per Unit (PPU). All exported distances will be divided by this value.">
            PPU:&nbsp;
            <input
              type="number"
              step="0.1"
              min="0.0001"
              value={ppu}
              onChange={(e) => setPpu(Math.max(0.0001, Number(e.target.value) || 1))}
              style={{ width: 80 }}
            />
          </label>
          <label>
            &nbsp;Scale:&nbsp;
            <select value={scaleMode} onChange={e => setScaleMode(e.target.value as ScaleMode)}>
              <option value="ppu">1:1 (PPU)</option>
              <option value="fit">Fit</option>
            </select>
          </label>

          {/* NEW: grid toggle */}
          <label>
            &nbsp;<input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)}/>
            &nbsp;Grid
          </label>
          <button onClick={() => parent.postMessage({ pluginMessage: { type: 'export', ppm: ppu } }, '*')}>Export
          </button>
          <span className="status"><pre>{status}</pre></span>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="warn">
          <strong>Warnings</strong>
          <ul>
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="previewRow">
        <div className="previewPanel">
          <div className="toolbar">
            <label>
              Level:&nbsp;
              <select value={levelIndex} onChange={(e) => setLevelIndex(parseInt(e.target.value))}>
                {levels.map((lv, i) => <option value={i} key={i}>{lv.name || `Level ${i + 1}`}</option>)}
              </select>
            </label>
            <button onClick={download} disabled={!json}>Download JSON</button>
          </div>
          <canvas ref={canvasRef} className="previewCanvas"/>
        </div>

        <div className="jsonPanel">
          <pre className="jsonOut">{json}</pre>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App/>);

function drawCrosshair(ctx: CanvasRenderingContext2D, p: Vec2, size = 6) {
  const [ x, y ] = p;
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  ctx.lineTo(x + size, y);
  ctx.moveTo(x, y - size);
  ctx.lineTo(x, y + size);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
  ctx.stroke();
}

function niceStep(pxPerUnit: number, targetPx = 64): number {
  const raw = targetPx / Math.max(pxPerUnit, 1e-6); // шаг в «единицах»
  const pow10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const candidates = [ 1, 2, 5, 10 ].map(m => m * pow10);
  for (const c of candidates) if (raw <= c) return c;
  return 10 * pow10;
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  level: { width: number; height: number },
  view: Viewport,
) {
  const dpr = window.devicePixelRatio || 1;

  // границы уровня в «единицах» (Rapier Y-up)
  const xMin = -level.width / 2;
  const xMax = level.width / 2;
  const yMin = -level.height / 2;
  const yMax = level.height / 2;

  const stepU = niceStep(view.scale);         // шаг сетки в «единицах»
  const majorEvery = 5;                       // каждая 5-я — мажорная

  ctx.save();
  ctx.lineWidth = 1 / dpr;

  // вертикальные линии
  let i = Math.ceil(xMin / stepU);
  for (let x = i * stepU, k = i; x <= xMax; x += stepU, k++) {
    const a = rapierToCanvas([ x, yMin ], level, view);
    const b = rapierToCanvas([ x, yMax ], level, view);
    ctx.beginPath();
    ctx.strokeStyle = (k % majorEvery === 0) ? '#e0e0e0' : '#f2f2f2';
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  // горизонтальные линии
  i = Math.ceil(yMin / stepU);
  for (let y = i * stepU, k = i; y <= yMax; y += stepU, k++) {
    const a = rapierToCanvas([ xMin, y ], level, view);
    const b = rapierToCanvas([ xMax, y ], level, view);
    ctx.beginPath();
    ctx.strokeStyle = (k % majorEvery === 0) ? '#e0e0e0' : '#f2f2f2';
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  // оси X/Y (по центру уровня)
  ctx.strokeStyle = '#d2d2d2';
  ctx.beginPath();
  let a = rapierToCanvas([ xMin, 0 ], level, view);
  let b = rapierToCanvas([ xMax, 0 ], level, view);
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();

  ctx.beginPath();
  a = rapierToCanvas([ 0, yMin ], level, view);
  b = rapierToCanvas([ 0, yMax ], level, view);
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();

  ctx.restore();
}
