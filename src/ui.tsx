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

type Vec2 = [number, number];

type Viewport = { scale: number; offsetX: number; offsetY: number };

function rapierToCanvas([x,y]: Vec2, level: { width:number; height:number }, view: Viewport): Vec2 {
  // Rapier: центр-орижин, Y-вверх → Canvas: левый-верх, Y-вниз
  const tlx = level.width / 2 + x;
  const tly = level.height / 2 - y;
  return [view.offsetX + tlx * view.scale, view.offsetY + tly * view.scale];
}

function drawPolyline(ctx: CanvasRenderingContext2D, pts: Vec2[]) {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function drawPolygon(ctx: CanvasRenderingContext2D, pts: Vec2[]) {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.stroke();
}

function rotated(p: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [p[0]*c - p[1]*s, p[0]*s + p[1]*c];
}

function add(a: Vec2, b: Vec2): Vec2 { return [a[0]+b[0], a[1]+b[1]]; }

function rectCorners(size: Vec2): Vec2[] {
  const [w,h] = size; const hw=w/2, hh=h/2;
  return [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
}

function drawCollider(
  ctx: CanvasRenderingContext2D,
  collider: any,
  go: any,
  level: { width:number; height:number },
  view: Viewport
) {
  // world (Rapier) transform of this collider relative to level center
  const goRot = go.rotation as number;
  const goPos = go.position as Vec2;
  const colRot = (collider.rotation || 0) as number;
  const colPos = (collider.position || [0,0]) as Vec2;

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
      ctx.arc(center[0], center[1], collider.radius * view.scale, 0, Math.PI*2);
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
      for (let i=0;i<idx.length;i+=3) {
        const a = verts[idx[i]], b = verts[idx[i+1]], c = verts[idx[i+2]];
        drawPolygon(ctx, [a,b,c]);
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

function autoViewport(level: { width:number; height:number }, canvas: HTMLCanvasElement): Viewport {
  const pad = 12;
  let scale = Math.min((canvas.width - pad*2)/level.width, (canvas.height - pad*2)/level.height);
  scale = 0.5;
  return { scale, offsetX: pad, offsetY: pad };
}

function drawLevelPreview(canvas: HTMLCanvasElement, level: any) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth; const cssH = canvas.clientHeight;
  if (canvas.width !== cssW*dpr) canvas.width = cssW*dpr;
  if (canvas.height !== cssH*dpr) canvas.height = cssH*dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);

  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#24a0ff';

  const view = autoViewport(level, canvas);

  // level frame
  const tl = rapierToCanvas([-level.width/2, level.height/2], level, view);
  const br = rapierToCanvas([ level.width/2,-level.height/2], level, view);
  ctx.strokeStyle = '#888';
  drawPolygon(ctx, [[tl[0],tl[1]],[br[0],tl[1]],[br[0],br[1]],[tl[0],br[1]]]);

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
  const [status, setStatus] = React.useState('Idle');
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [json, setJson] = React.useState('');
  const [levels, setLevels] = React.useState<any[]>([]);
  const [levelIndex, setLevelIndex] = React.useState(0);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    window.onmessage = (e) => {
      const msg = e.data.pluginMessage as Msg;
      if (!msg) return;
      if (msg.type === 'status') setStatus(msg.text);
      if (msg.type === 'warn') setWarnings(w => [...w, msg.text]);
      if (msg.type === 'progress') setStatus(msg.text);
      if (msg.type === 'done') { setStatus('Done'); setJson(msg.json); setLevels(msg.levels || []); setLevelIndex(0); }
      if (msg.type === 'error') { setStatus('Error'); setWarnings(w => [...w, msg.text]); }
    };
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    if (!levels[levelIndex]) { const ctx = canvas.getContext('2d'); if (ctx) ctx.clearRect(0,0,canvas.width,canvas.height); return; }
    drawLevelPreview(canvas, levels[levelIndex]);
  }, [levels, levelIndex, json]);

  React.useEffect(() => {
    const onResize = () => { const canvas = canvasRef.current; if (canvas && levels[levelIndex]) drawLevelPreview(canvas, levels[levelIndex]); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [levels, levelIndex]);

  const download = () => {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'level-export.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="wrap">
      <div className="header">
        <h2>Rapier 2D Collider Export</h2>
        <div className="actions">
          <button onClick={() => parent.postMessage({ pluginMessage: { type: 'export' } }, '*')}>Export</button>
          <span className="status">{status}</span>
        </div>
      </div>

      {warnings.length>0 && (
        <div className="warn">
          <strong>Warnings</strong>
          <ul>
            {warnings.map((w,i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <div className="previewRow">
        <div className="previewPanel">
          <div className="toolbar">
            <label>
              Level:&nbsp;
              <select value={levelIndex} onChange={(e) => setLevelIndex(parseInt(e.target.value))}>
                {levels.map((lv, i) => <option value={i} key={i}>{lv.name || `Level ${i+1}`}</option>)}
              </select>
            </label>
            <button onClick={download} disabled={!json}>Download JSON</button>
          </div>
          <canvas ref={canvasRef} className="previewCanvas" />
        </div>

        <div className="jsonPanel">
          <pre className="jsonOut">{json}</pre>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);

function drawCrosshair(ctx: CanvasRenderingContext2D, p: Vec2, size = 6) {
  const [x, y] = p;
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

