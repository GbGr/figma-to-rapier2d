import { applyToPoint, Mat2x3 } from './transforms';
import { Vec2 } from './polygons';

// ===== NEW: числовой токенайзер для SVG =====
function* numStream(src: string): Generator<number> {
  // поддерживает e/E, знаки, дроби
  const re = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) yield parseFloat(m[0]);
}

type Contour = { pts: Vec2[]; closed: boolean };

type FlattenOpts = {
  curveTol?: number; // допуск на кривых (px)
  arcTol?: number;   // допуск на хорде дуги (px)
  maxRecursion?: number;
};

const DEFAULT_OPTS: Required<FlattenOpts> = {
  curveTol: 0.75,
  arcTol: 0.75,
  maxRecursion: 10,
};

// ===== NEW: геометрия Безье и дуг =====
function distPointToLine([x,y]: Vec2, [x1,y1]: Vec2, [x2,y2]: Vec2): number {
  const A = x - x1, B = y - y1, C = x2 - x1, D = y2 - y1;
  const len2 = C*C + D*D || 1e-12;
  const t = (A*C + B*D) / len2;
  const px = x1 + t*C, py = y1 + t*D;
  return Math.hypot(x - px, y - py);
}

function flattenQuad(p0: Vec2, p1: Vec2, p2: Vec2, tol: number, out: Vec2[], depth=0, maxDepth=10) {
  // плоскостность = расстояние контрольной к прямой (p0-p2)
  const flat = distPointToLine(p1, p0, p2) <= tol;
  if (flat || depth >= maxDepth) { out.push(p2); return; }
  // де Кастельжо
  const p01: Vec2 = [(p0[0]+p1[0])/2, (p0[1]+p1[1])/2];
  const p12: Vec2 = [(p1[0]+p2[0])/2, (p1[1]+p2[1])/2];
  const p012: Vec2 = [(p01[0]+p12[0])/2, (p01[1]+p12[1])/2];
  flattenQuad(p0, p01, p012, tol, out, depth+1, maxDepth);
  flattenQuad(p012, p12, p2, tol, out, depth+1, maxDepth);
}

function flattenCubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, tol: number, out: Vec2[], depth=0, maxDepth=10) {
  // плоскостность: макс расстояние p1/p2 к прямой (p0-p3)
  const d = Math.max(distPointToLine(p1, p0, p3), distPointToLine(p2, p0, p3));
  if (d <= tol || depth >= maxDepth) { out.push(p3); return; }
  // де Кастельжо
  const p01: Vec2 = [(p0[0]+p1[0])/2, (p0[1]+p1[1])/2];
  const p12: Vec2 = [(p1[0]+p2[0])/2, (p1[1]+p2[1])/2];
  const p23: Vec2 = [(p2[0]+p3[0])/2, (p2[1]+p3[1])/2];
  const p012: Vec2 = [(p01[0]+p12[0])/2, (p01[1]+p12[1])/2];
  const p123: Vec2 = [(p12[0]+p23[0])/2, (p12[1]+p23[1])/2];
  const p0123: Vec2 = [(p012[0]+p123[0])/2, (p012[1]+p123[1])/2];
  flattenCubic(p0, p01, p012, p0123, tol, out, depth+1, maxDepth);
  flattenCubic(p0123, p123, p23, p3, tol, out, depth+1, maxDepth);
}

// преобразование A-дуги из формата SVG endpoint → центр-параметризация
function svgArcToCenter(x1: number, y1: number, rx: number, ry: number, phi: number, fa: number, fs: number, x2: number, y2: number) {
  // алгоритм из спецификации SVG
  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p =  cosPhi*dx + sinPhi*dy;
  const y1p = -sinPhi*dx + cosPhi*dy;

  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return { cx: x1, cy: y1, theta1: 0, dtheta: 0, rx, ry, phi };

  // корректировка радиусов
  const rAdj = (x1p*x1p)/(rx*rx) + (y1p*y1p)/(ry*ry);
  if (rAdj > 1) { const s = Math.sqrt(rAdj); rx *= s; ry *= s; }

  const sign = (fa === fs ? -1 : 1);
  const num = rx*rx*ry*ry - rx*rx*y1p*y1p - ry*ry*x1p*x1p;
  const den = rx*rx*y1p*y1p + ry*ry*x1p*x1p;
  const co = sign * Math.sqrt(Math.max(0, num/den));

  const cxp =  co * (rx*y1p)/ry;
  const cyp = -co * (ry*x1p)/rx;

  const cx = cosPhi*cxp - sinPhi*cyp + (x1 + x2)/2;
  const cy = sinPhi*cxp + cosPhi*cyp + (y1 + y2)/2;

  const ux = (x1p - cxp)/rx, uy = (y1p - cyp)/ry;
  const vx = (-x1p - cxp)/rx, vy = (-y1p - cyp)/ry;

  const ang = (uX:number,uY:number,vX:number,vY:number) => {
    const dot = uX*vX + uY*vY;
    const det = uX*vY - uY*vX;
    let a = Math.atan2(det, dot);
    return a;
  };

  let theta1 = ang(1,0, ux,uy);
  let dtheta = ang(ux,uy, vx,vy);
  if (!fs && dtheta > 0) dtheta -= 2*Math.PI;
  if ( fs && dtheta < 0) dtheta += 2*Math.PI;

  return { cx, cy, theta1, dtheta, rx, ry, phi };
}

function flattenArc(p0: Vec2, rx: number, ry: number, xAxisRot: number, largeArc: number, sweep: number, p: Vec2, tol: number, out: Vec2[]) {
  const { cx, cy, theta1, dtheta, rx: RX, ry: RY, phi } =
    svgArcToCenter(p0[0], p0[1], rx, ry, xAxisRot, largeArc, sweep, p[0], p[1]);
  if (RX === 0 || RY === 0 || dtheta === 0) { out.push(p); return; }

  // шаг по углу через погрешность хорды: err ≈ r_max*(1 - cos(Δ/2)) <= tol
  const rMax = Math.max(RX, RY);
  const maxDelta = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(rMax, 1e-6))));
  const segs = Math.max(1, Math.ceil(Math.abs(dtheta) / (isFinite(maxDelta) && maxDelta>1e-3 ? maxDelta : (Math.PI/12))));
  const delta = dtheta / segs;

  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
  for (let i = 1; i <= segs; i++) {
    const t = theta1 + delta * i;
    const x = cx + RX * Math.cos(t);
    const y = cy + RY * Math.sin(t);
    // поворот эллипса (xAxisRot = phi) уже учтен в svgArcToCenter → координаты в системе документа
    out.push([x, y]);
  }
}

// ===== NEW: разбор и распрямление path.data → контуры =====
function flattenSVGPath(data: string, opts?: FlattenOpts): Contour[] {
  const { curveTol, arcTol, maxRecursion } = { ...DEFAULT_OPTS, ...(opts||{}) };
  const contours: Contour[] = [];
  let curr: Vec2 = [0,0], start: Vec2 = [0,0];
  let lastC2: Vec2 | null = null;   // для S/T (отражение)
  let active: Vec2[] | null = null;

  const parts = data.match(/[a-zA-Z]|[-+]?(\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  // Разбираем «по командам»: ищем буквы, затем читаем нужное кол-во чисел
  for (let i = 0; i < parts.length; ) {
    const cmd = parts[i++];
    if (!/[a-zA-Z]/.test(cmd)) continue;
    const isRel = cmd >= 'a' && cmd <= 'z';
    const C = cmd.toUpperCase();

    const take = (n: number): number[] => {
      const arr: number[] = [];
      for (let k=0;k<n && i<parts.length;k++,i++) arr.push(parseFloat(parts[i]));
      return arr;
    };

    const lineTo = (x: number, y: number) => {
      const p: Vec2 = isRel ? [curr[0]+x, curr[1]+y] : [x,y];
      if (active && (active.length === 0 || (p[0] !== active[active.length-1][0] || p[1] !== active[active.length-1][1]))) active.push(p);
      curr = p; lastC2 = null;
    };

    switch (C) {
      case 'M': {
        const [x,y] = take(2);
        curr = isRel ? [curr[0]+x, curr[1]+y] : [x,y];
        start = curr;
        // начинаем новый контур
        if (active && active.length) contours.push({ pts: active, closed: false });
        active = [[curr[0], curr[1]]];
        // последующие пары трактуются как L
        while (i < parts.length && !/[a-zA-Z]/.test(parts[i])) {
          const [lx,ly] = take(2);
          lineTo(lx,ly);
        }
        break;
      }
      case 'L': {
        while (i < parts.length && !/[a-zA-Z]/.test(parts[i])) {
          const [x,y] = take(2);
          lineTo(x,y);
        }
        break;
      }
      case 'H': {
        while (i < parts.length && !/[a-zA-Z]/.test(parts[i])) {
          const [x] = take(1);
          const nx = isRel ? curr[0]+x : x;
          lineTo(nx - (isRel ? curr[0] : 0), 0); // через lineTo c учётом isRel
          curr = [nx, curr[1]];
        }
        break;
      }
      case 'V': {
        while (i < parts.length && !/[a-zA-Z]/.test(parts[i])) {
          const [y] = take(1);
          const ny = isRel ? curr[1]+y : y;
          lineTo(0, ny - (isRel ? curr[1] : 0));
          curr = [curr[0], ny];
        }
        break;
      }
      case 'Q': {
        while (i < parts.length && !/[a-zA-Z]/.test(parts[i])) {
          const [x1,y1,x,y] = take(4);
          const c1: Vec2 = isRel ? [curr[0]+x1, curr[1]+y1] : [x1,y1];
          const p: Vec2 = isRel ? [curr[0]+x, curr[1]+y] : [x,y];
          const out: Vec2[] = [];
          flattenQuad(curr, c1, p, curveTol, out, 0, maxRecursion);
          if (active) active.push(...out);
          curr = p; lastC2 = c1; // для T отразим c1 вокруг p
        }
        break;
      }
      case 'T': {
        while (i < parts.length && !/[a-zA-Z]/.test(parts[i])) {
          const [x,y] = take(2);
          const p: Vec2 = isRel ? [curr[0]+x, curr[1]+y] : [x,y];
          const c1: [number, number] = lastC2
            ? [2*curr[0]-lastC2[0], 2*curr[1]-lastC2[1]]
            : curr;
          const out: Vec2[] = [];
          flattenQuad(curr, c1, p, curveTol, out, 0, maxRecursion);
          if (active) active.push(...out);
          curr = p; lastC2 = c1;
        }
        break;
      }
      case 'C': {
        while (i < parts.length && !/[a-zA-Z]/.test(parts[i])) {
          const [x1,y1,x2,y2,x,y] = take(6);
          const c1: Vec2 = isRel ? [curr[0]+x1, curr[1]+y1] : [x1,y1];
          const c2: Vec2 = isRel ? [curr[0]+x2, curr[1]+y2] : [x2,y2];
          const p:  Vec2 = isRel ? [curr[0]+x,  curr[1]+y ] : [x,y];
          const out: Vec2[] = [];
          flattenCubic(curr, c1, c2, p, curveTol, out, 0, maxRecursion);
          if (active) active.push(...out);
          curr = p; lastC2 = c2;
        }
        break;
      }
      case 'S': {
        while (i < parts.length && !/[a-zA-Z]/.test(parts[i])) {
          const [x2,y2,x,y] = take(4);
          const c1 = lastC2 ? [2*curr[0]-lastC2[0], 2*curr[1]-lastC2[1]] as Vec2 : curr;
          const c2: Vec2 = isRel ? [curr[0]+x2, curr[1]+y2] : [x2,y2];
          const p:  Vec2 = isRel ? [curr[0]+x,  curr[1]+y ] : [x,y];
          const out: Vec2[] = [];
          flattenCubic(curr, c1, c2, p, curveTol, out, 0, maxRecursion);
          if (active) active.push(...out);
          curr = p; lastC2 = c2;
        }
        break;
      }
      case 'A': {
        while (i < parts.length && !/[a-zA-Z]/.test(parts[i])) {
          const [rx,ry,rot,largeArc,sweep,x,y] = take(7);
          const p: Vec2 = isRel ? [curr[0]+x, curr[1]+y] : [x,y];
          const out: Vec2[] = [];
          flattenArc(curr, rx, ry, (rot*Math.PI)/180, largeArc|0, sweep|0, p, arcTol, out);
          if (active) active.push(...out);
          curr = p; lastC2 = null;
        }
        break;
      }
      case 'Z': {
        if (active) {
          // закрыть контур, если последняя точка ≠ start
          if (active.length && (active[0][0] !== active[active.length-1][0] || active[0][1] !== active[active.length-1][1])) {
            active.push([active[0][0], active[0][1]]);
          }
          contours.push({ pts: active, closed: true });
          active = null;
        }
        curr = start; lastC2 = null;
        break;
      }
      default:
        // игнор нераспознанного
        break;
    }
  }
  if (active && active.length) contours.push({ pts: active, closed: false });
  return contours.map(c => ({ pts: dedupeClose(c.pts), closed: c.closed }));
}

// ====== UPDATED: извлечение вершин в мировых координатах ======

export function getWorldPolygonVertices(
  node: SceneNode,
  opts?: { curveTol?: number; arcTol?: number }
): Vec2[] {
  if ('vectorPaths' in node && (node as any).vectorPaths?.length) {
    const m = node.absoluteTransform as Mat2x3;
    const vps = (node as any).vectorPaths as ReadonlyArray<{ data: string }>;
    // собираем все контуры из всех path'ов
    const contours: Contour[] = [];
    for (const { data } of vps) {
      const cs = flattenSVGPath(data, opts);
      contours.push(...cs);
    }
    if (contours.length === 0) return [];

    // трансформируем в мир (Figma TL, Y-down)
    const worldContours = contours.map(c => ({
      closed: c.closed,
      pts: c.pts.map(([x,y]) => applyToPoint(m, x, y) as Vec2)
    }));

    // 1) если есть замкнутые — берём с наибольшей площадью bbox
    const closed = worldContours.filter(c => c.closed && c.pts.length >= 3);
    const areaOfBBox = (pts: Vec2[]) => {
      let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
      for (const [x,y] of pts) { if (x<minX) minX=x; if (y<minY) minY=y; if (x>maxX) maxX=x; if (y>maxY) maxY=y; }
      return (maxX-minX)*(maxY-minY);
    };
    if (closed.length) {
      closed.sort((a,b) => areaOfBBox(b.pts) - areaOfBBox(a.pts));
      return dedupeClose(closed[0].pts);
    }

    // 2) иначе возвращаем самый длинный открытый (для Polyline-коллайдера)
    worldContours.sort((a,b) => b.pts.length - a.pts.length);
    return dedupeClose(worldContours[0].pts);
  }

  // Rect/Frame/Group: 4 угла
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

  // Ellipse: адаптивная аппроксимация по допуску
  if (node.type === 'ELLIPSE') {
    const m = node.absoluteTransform as Mat2x3;
    const w = (node as any).width as number; const h = (node as any).height as number;
    const rx = w/2, ry = h/2;
    const tol = opts?.curveTol ?? DEFAULT_OPTS.curveTol;
    // шаг по углу через погрешность хорды
    const rMax = Math.max(rx, ry);
    const maxDelta = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / Math.max(rMax, 1e-6))));
    const segs = Math.max(12, Math.ceil((2*Math.PI) / (isFinite(maxDelta) && maxDelta>1e-3 ? maxDelta : (Math.PI/12))));
    const verts: Vec2[] = [];
    for (let i=0;i<segs;i++) {
      const t = (i/segs)*Math.PI*2;
      const x = rx + rx*Math.cos(t);
      const y = ry + ry*Math.sin(t);
      verts.push(applyToPoint(m, x, y));
    }
    return dedupeClose(verts);
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
