import { applyToPoint, Mat2x3 } from './transforms';
import { Vec2 } from './polygons';

// Convert Figma vector-like nodes to a unified polygon/polyline vertex list in WORLD space (Figma TL, Y-down)
// For simplicity, we use node.vectorPaths when available; fallback to bounding geometry for ellipses/rects.

export function getWorldPolygonVertices(node: SceneNode): Vec2[] {
  if ('vectorPaths' in node && (node as any).vectorPaths?.length) {
    const m = node.absoluteTransform as Mat2x3;
    const vp = (node as any).vectorPaths as ReadonlyArray<{ data: string }>;
    // Very simple SVG path parser for M/L/Z (straight segments). Curves are flattened by Figma in many cases.
    const verts: Vec2[] = [];
    for (const { data } of vp) {
      const cmds = data.match(/[MLZmlz][^MLZmlz]*/g) || [];
      let current: Vec2 | null = null;
      for (const c of cmds) {
        const op = c[0];
        const nums = c.slice(1).trim().split(/[ ,]+/).map(Number).filter(n => !Number.isNaN(n));
        if (op === 'M' || op === 'L') {
          for (let i=0; i<nums.length; i+=2) {
            const [xw,yw] = applyToPoint(m, nums[i], nums[i+1]);
            if (!current || (op === 'M')) current = [xw,yw];
            verts.push([xw,yw]);
          }
        }
        if (op === 'Z' || op === 'z') {
          // closed
        }
      }
    }
    return dedupeClose(verts);
  }

  // Rect/Ellipse fallback → approximate ellipse with polygon, rect with its corners
  if (node.type === 'RECTANGLE' || node.type === 'FRAME' || node.type === 'GROUP') {
    const m = node.absoluteTransform as Mat2x3;
    const w = (node as any).width as number; const h = (node as any).height as number;
    return [
      applyToPoint(m, 0, 0),
      applyToPoint(m, w, 0),
      applyToPoint(m, w, h),
      applyToPoint(m, 0, h)
    ] as Vec2[];
  }
  if (node.type === 'ELLIPSE') {
    const m = node.absoluteTransform as Mat2x3;
    const w = (node as any).width as number; const h = (node as any).height as number;
    const steps = 32;
    const verts: Vec2[] = [];
    for (let i=0;i<steps;i++) {
      const t = (i/steps)*Math.PI*2;
      const x = (w/2)*(Math.cos(t)) + w/2;
      const y = (h/2)*(Math.sin(t)) + h/2;
      verts.push(applyToPoint(m, x, y));
    }
    return verts;
  }

  throw new Error(`Unsupported vector source for node type ${node.type}`);
}

function dedupeClose(pts: Vec2[], eps=1e-3): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    if (out.length===0) { out.push(p); continue; }
    const q = out[out.length-1];
    if (Math.hypot(p[0]-q[0], p[1]-q[1]) > eps) out.push(p);
  }
  // close loop if end ≈ start
  if (out.length>2) {
    const a=out[0], b=out[out.length-1];
    if (Math.hypot(a[0]-b[0], a[1]-b[1]) <= eps) out.pop();
  }
  return out;
}
