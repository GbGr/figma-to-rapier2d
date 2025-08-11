import earcut from 'earcut';
// @ts-ignore
import decomp from 'poly-decomp';

export type Vec2 = [number, number];

export function areaSigned(poly: Vec2[]): number {
  let a = 0;
  for (let i=0; i<poly.length; i++) {
    const [x1,y1] = poly[i];
    const [x2,y2] = poly[(i+1)%poly.length];
    a += x1*y2 - x2*y1;
  }
  return 0.5 * a; // >0 => CCW (в Y-up), <0 => CW
}

export function ensureClockwise(poly: Vec2[]): Vec2[] {
  return areaSigned(poly) > 0 ? poly.slice().reverse() : poly;
}

export function ensureCCW(poly: Vec2[]): Vec2[] {
  return areaSigned(poly) < 0 ? poly.slice().reverse() : poly;
}

export function centroid(poly: Vec2[]): Vec2 {
  let cx=0, cy=0;
  for (const [x,y] of poly) { cx+=x; cy+=y; }
  return [cx/poly.length, cy/poly.length];
}

export function centerVertices(poly: Vec2[]): { center: Vec2, vertices: Vec2[] } {
  const c = centroid(poly);
  const v = poly.map(([x,y]) => [x-c[0], y-c[1]] as Vec2);
  return { center: c, vertices: v };
}

export function triangulateConcave(vertices: Vec2[]): { vertices: Vec2[], indices: number[] } {
  // Earcut expects flat array [x0,y0,x1,y1,...] in CCW Y-down, but we use Y-up CW.
  // Our vertices are already centered and will be in CW for Rapier. For earcut, we flip Y and reverse to CCW.
  const vCCW_Ydown = vertices.slice().reverse().flatMap(([x,y]) => [x, -y]);
  const indices = earcut(vCCW_Ydown);
  // indices refer to reversed list; but that's fine because geometry stays consistent when we build triangles downstream.
  return { vertices, indices: Array.from(indices) };
}

export function isConvex(vertices: Vec2[]): boolean {
  let sign = 0;
  for (let i=0; i<vertices.length; i++) {
    const p0 = vertices[i];
    const p1 = vertices[(i+1)%vertices.length];
    const p2 = vertices[(i+2)%vertices.length];
    const z = (p1[0]-p0[0])*(p2[1]-p1[1]) - (p1[1]-p0[1])*(p2[0]-p1[0]);
    if (z !== 0) {
      if (sign === 0) sign = Math.sign(z);
      else if (Math.sign(z) !== sign) return false;
    }
  }
  return true;
}

export function decomposeIfNeeded(vertices: Vec2[]): Vec2[][] {
  if (vertices.length <= 3 || isConvex(vertices)) return [ensureClockwise(vertices)];

  // poly-decomp ожидает CCW
  const ccw = ensureCCW(vertices);

  let decompPolys: number[][];
  try {
    decompPolys = decomp.quickDecomp(ccw as unknown as number[][]);
  } catch {
    console.warn('poly-decomp failed, falling back to simple decomposition');
    return [ensureClockwise(vertices)];
  }

  if (!decompPolys || decompPolys.length === 0) {
    return [ensureClockwise(vertices)];
  }

  return decompPolys.map(p => ensureClockwise(p as any));
}

// —— Simplification (RDP) ——

function perpendicularDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const [x,y] = p; const [x1,y1] = a; const [x2,y2] = b;
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1)*dx + (y - y1)*dy) / (dx*dx + dy*dy);
  const projX = x1 + t*dx, projY = y1 + t*dy;
  return Math.hypot(x - projX, y - projY);
}

function rdp(points: Vec2[], eps: number): Vec2[] {
  if (points.length <= 2) return points.slice();
  let maxDist = -1; let index = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) { maxDist = d; index = i; }
  }
  if (maxDist > eps) {
    const left = rdp(points.slice(0, index + 1), eps);
    const right = rdp(points.slice(index), eps);
    return left.slice(0, -1).concat(right);
  } else {
    return [points[0], points[points.length - 1]];
  }
}

export function simplifyPolygonRDPClosed(points: Vec2[], eps: number): Vec2[] {
  if (points.length <= 3) return points.slice();
  // Удаляем возможную дублирующую последнюю точку = первой
  let ring = points.slice();
  if (ring.length > 1) {
    const a = ring[0], b = ring[ring.length-1];
    if (Math.hypot(a[0]-b[0], a[1]-b[1]) < 1e-9) ring = ring.slice(0, -1);
  }
  // Запустим RDP по «разомкнутому» списку и снова замкнём контур
  const simplified = rdp(ring, eps);
  // Гарантии минимума вершин
  const out = simplified.length < 3 ? ring.slice(0, 3) : simplified;
  return out;
}

export function simplifyPolygon(
  vertices: Vec2[],
  opts?: { epsilon?: number; maxPoints?: number }
): Vec2[] {
  const eps = Math.max(0, opts?.epsilon ?? 1.5);
  const maxPts = opts?.maxPoints ?? Number.POSITIVE_INFINITY;

  // Сохраняем ориентацию: приводим к CW перед упрощением, чтобы после не потерять порядок
  const cw = ensureClockwise(vertices);
  let simp = simplifyPolygonRDPClosed(cw, eps);

  // Ограничение на максимальное число вершин (простая равномерная выборка)
  if (Number.isFinite(maxPts) && simp.length > maxPts) {
    const keep = Math.max(3, Math.floor(maxPts));
    const step = simp.length / keep;
    const reduced: Vec2[] = [];
    for (let i=0; i<keep; i++) reduced.push(simp[Math.floor(i*step)]);
    simp = reduced;
  }

  // Гарантируем CW на выходе
  return ensureClockwise(simp);
}
