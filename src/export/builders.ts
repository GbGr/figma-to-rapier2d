import { getNodeRotation, getPositionWithAnchorAdjustment, localOffsetBetween, toRapierFromFigmaWorld, toGoLocal } from '../geometry/transforms';
import { getWorldPolygonVertices } from '../geometry/paths';
import {
  centerVertices, ensureClockwise, decomposeIfNeeded, triangulateConcave, Vec2, simplifyPolygon,
} from '../geometry/polygons';
import type { GameObjectData, ColliderData, CuboidCollider, BallCollider, ConvexHullCollider, TrimeshCollider, PolylineCollider, CompoundCollider } from '../types';
import { Reporter } from './reporter';

export function buildGameObject(go: GroupNode, level: FrameNode, reporter: Reporter): GameObjectData {
  const name = go.name.replace(/^GameObject:/, '').trim();
  const position = getPositionWithAnchorAdjustment(go, level);
  const rotation = getNodeRotation(go);
  const bodyType = findBodyType(go) || 'Static';
  const customParams = findCustomParams(go);
  const collider = buildCollider(go, level, reporter);

  return { name, position, rotation, collider, bodyType, customParams };
}

function findBodyType(go: GroupNode): GameObjectData['bodyType'] | null {
  for (const n of go.children) {
    if (n.type === 'TEXT' && n.name.startsWith('BodyType:')) {
      const t = n.name.replace(/^BodyType:/,'').trim();
      if (t === 'Static' || t === 'Dynamic' || t === 'Kinematic') return t;
    }
  }
  return null;
}

function findCustomParams(go: GroupNode): Record<string,string> {
  const params: Record<string,string> = {};
  for (const n of go.children) {
    if (n.type === 'TEXT' && n.name.startsWith('CustomParam:')) {
      const rest = n.name.replace(/^CustomParam:/,'').trim();
      const idx = rest.indexOf(':');
      if (idx>0) {
        const key = rest.slice(0,idx).trim();
        params[key]=rest.slice(idx+1).trim();
      }
    }
  }
  return params;
}

function buildCollider(go: GroupNode, level: FrameNode, reporter: Reporter): ColliderData | null {
  // If there are multiple Collider:* nodes, wrap in Compound
  const colliders = go.children.filter(n => n.name.startsWith('Collider:'));
  if (colliders.length === 0) { reporter.warn(`GameObject ${go.name} has no Collider:* node.`); return null; }
  if (colliders.length > 1) {
    const children = colliders.map(n => buildSingleCollider(n, go, level, reporter)).filter(Boolean) as ColliderData[];
    const compound: CompoundCollider = {
      type: 'Compound',
      position: [0,0],
      rotation: 0,
      children
    };
    reporter.bump('Compound');
    return compound;
  }
  return buildSingleCollider(colliders[0], go, level, reporter);
}

function buildSingleCollider(node: SceneNode, go: GroupNode, level: FrameNode, reporter: Reporter): ColliderData | null {
  if (!node.name.startsWith('Collider:')) return null;
  const type = node.name.replace(/^Collider:/,'').trim();
  const localPos = localOffsetBetween(node, go, level);
  const localRot = getNodeRotation(node) - getNodeRotation(go);

  switch (type) {
    case 'Cuboid': {
      if (!('width' in node && 'height' in node)) { reporter.warn(`${node['name']} missing width/height.`); return null; }
      const size: [number, number] = [(node as any).width, (node as any).height];
      const out: CuboidCollider = { type: 'Cuboid', position: localPos, rotation: localRot, size };
      reporter.bump('Cuboid');
      return out;
    }
    case 'Ball': {
      if (!('width' in node && 'height' in node)) { reporter.warn(`${node['name']} missing width/height.`); return null; }
      const w = (node as any).width as number; const h = (node as any).height as number;
      const radius = (w + h) * 0.25; // avg of half-axes (robust against non-uniform scale → use ellipse approx)
      const out: BallCollider = { type: 'Ball', position: localPos, rotation: localRot, radius };
      reporter.bump('Ball');
      return out;
    }
    case 'Convex': {
      const worldVertsTL = getWorldPolygonVertices(node);
      const vertsRapierWorld = worldVertsTL.map(p => toRapierFromFigmaWorld(p, level));

      const goPos: Vec2 = getPositionWithAnchorAdjustment(go, level);
      const goRot = getNodeRotation(go);
      const vertsGoLocal = vertsRapierWorld.map(v => toGoLocal(v as Vec2, goPos, goRot));

      const cw = ensureClockwise(vertsGoLocal as any);
      const { center: polyCenter, vertices: centered } = centerVertices(cw);

      const needDecomp = !isConvexSafe(centered) && centered.length > 3;

      if (needDecomp) {
        const parts = decomposeIfNeeded(centered); // вернёт >=1 CW-часть
        const children = parts.map(part => {
          const { center: cPart, vertices: vLocal } = centerVertices(part);
          return {
            type: 'ConvexHull',
            position: cPart as Vec2,
            rotation: 0,
            vertices: ensureClockwise(vLocal as any)
          } as ConvexHullCollider;
        });

        const out: CompoundCollider = { type: 'Compound', position: polyCenter as Vec2, rotation: 0, children };
        reporter.bump('Compound');
        return out;
      } else {
        const out: ConvexHullCollider = {
          type: 'ConvexHull',
          position: polyCenter as Vec2,
          rotation: 0,
          vertices: centered as any
        };
        reporter.bump('ConvexHull');
        return out;
      }
    }
    case 'Trimesh': {
      const worldVertsTL = getWorldPolygonVertices(node);
      const vertsRapierWorld = worldVertsTL.map(p => toRapierFromFigmaWorld(p, level));
      const goPos: Vec2 = getPositionWithAnchorAdjustment(go, level);
      const goRot = getNodeRotation(go);
      const vertsGoLocal = vertsRapierWorld.map(v => toGoLocal(v as Vec2, goPos, goRot));

      const cw = ensureClockwise(vertsGoLocal as any);
      const { center, vertices } = centerVertices(cw);
      const { indices } = triangulateConcave(vertices as any);
      const out: TrimeshCollider = { type:'Trimesh', position: center as Vec2, rotation: 0, triangles: { vertices: vertices as any, indices } };
      reporter.bump('Trimesh');
      return out;
    }
    case 'Polyline': {
      const worldVertsTL = getWorldPolygonVertices(node);
      const vertsRapierWorld = worldVertsTL.map(p => toRapierFromFigmaWorld(p, level));
      const goPos: Vec2 = getPositionWithAnchorAdjustment(go, level);
      const goRot = getNodeRotation(go);
      const vertsGoLocal = vertsRapierWorld.map(v => toGoLocal(v as Vec2, goPos, goRot));

      const { center, vertices } = centerVertices(vertsGoLocal as any);
      const out: PolylineCollider = { type:'Polyline', position: center as Vec2, rotation: 0, vertices: vertices as any };
      reporter.bump('Polyline');
      return out;
    }
    case 'Compound': {
      if (!('children' in node)) { reporter.warn(`Compound collider must be Group/Frame.`); return null; }

      // Recursively collect all Collider:* descendants (not just direct children)
      const colliderDescendants = collectColliderDescendants(node as any);
      if (colliderDescendants.length === 0) {
        reporter.warn(`${node.name} has no Collider:* descendants.`);
      }

      // Children build relative to the Compound container
      const children = colliderDescendants
        .map((c: SceneNode) => buildChildRelativeToParent(c, node as SceneNode, level, reporter))
        .filter(Boolean) as ColliderData[];

      const localPos = localOffsetBetween(node, go, level);
      const localRot = getNodeRotation(node) - getNodeRotation(go);

      const out: CompoundCollider = { type: 'Compound', position: localPos, rotation: localRot, children };
      reporter.bump('Compound');
      return out;
    }
    case 'SimplifiedConvex': {
      // 1) Мировые вершины фигуры
      const worldVertsTL = getWorldPolygonVertices(node);
      const vertsRapierWorld = worldVertsTL.map(p => toRapierFromFigmaWorld(p, level));

      // 2) В локальные координаты GO (запекаем поворот/flip в вершины)
      const goPos: Vec2 = getPositionWithAnchorAdjustment(go, level);
      const goRot = getNodeRotation(go);
      const vertsGoLocal = vertsRapierWorld.map(v => toGoLocal(v as Vec2, goPos, goRot));

      // 3) Считываем кастомные параметры
      const params = findCustomParams(go); // уже есть в файле
      const eps = params.simplifyEpsilon ? parseFloat(params.simplifyEpsilon) : 1.5;
      const maxPts = params.simplifyMaxPoints ? parseInt(params.simplifyMaxPoints, 10) : Number.POSITIVE_INFINITY;

      // 4) Упрощаем контур (RDP), сохраняем ориентацию CW
      const simplifiedCW = simplifyPolygon(vertsGoLocal as any, { epsilon: eps, maxPoints: maxPts });

      // 5) Центрируем упрощённый полигон
      const { center: polyCenter, vertices: centered } = centerVertices(simplifiedCW);

      // 6) Если невыпуклый — декомпозиция (в ЛОКАЛЬНОЙ системе GO)
      const needDecomp = !isConvexSafe(centered) && centered.length > 3;
      if (needDecomp) {
        const parts = decomposeIfNeeded(centered);
        const children = parts.map(part => {
          const { center: cPart, vertices: vLocal } = centerVertices(part);
          return { type: 'ConvexHull', position: cPart as Vec2, rotation: 0, vertices: ensureClockwise(vLocal as any) } as ConvexHullCollider;
        });
        const out: CompoundCollider = { type: 'Compound', position: polyCenter as Vec2, rotation: 0, children };
        reporter.bump('Compound');
        return out;
      } else {
        const out: ConvexHullCollider = { type: 'ConvexHull', position: polyCenter as Vec2, rotation: 0, vertices: centered as any };
        reporter.bump('ConvexHull');
        return out;
      }
    }

    default:
      reporter.warn(`Unsupported collider type: ${type}`);
      return null;
  }
}

function isConvexSafe(vertices: Vec2[]): boolean {
  // tolerance for almost-collinear
  let sign = 0; const n = vertices.length;
  for (let i=0;i<n;i++) {
    const p0 = vertices[i]; const p1 = vertices[(i+1)%n]; const p2 = vertices[(i+2)%n];
    const z = (p1[0]-p0[0])*(p2[1]-p1[1]) - (p1[1]-p0[1])*(p2[0]-p1[0]);
    if (Math.abs(z) < 1e-6) continue;
    const s = Math.sign(z);
    if (!sign) sign = s; else if (s !== sign) return false;
  }
  return true;
}

function collectColliderDescendants(root: SceneNode): SceneNode[] {
  const out: SceneNode[] = [];
  const walk = (n: SceneNode) => {
    if ('children' in (n as any)) {
      for (const ch of (n as any).children as SceneNode[]) {
        if (ch.name.trim().startsWith('Collider:')) out.push(ch);
        walk(ch);
      }
    }
  };
  walk(root);
  return out;
}

// Builds ColliderData relative to parent node (for Compound children)
function buildChildRelativeToParent(
  child: SceneNode,
  parent: SceneNode,
  level: FrameNode,
  reporter: Reporter
): ColliderData | null {
  if (!child.name || !child.name.trim().startsWith('Collider:')) return null;
  const type = child.name.replace(/^Collider:/, '').trim();

  const position = localOffsetBetween(child, parent, level);
  const rotation = getNodeRotation(child) - getNodeRotation(parent);

  switch (type) {
    case 'Cuboid': {
      if (!('width' in child && 'height' in child)) { reporter.warn(`${child['name']} missing width/height.`); return null; }
      const size: [number, number] = [(child as any).width, (child as any).height];
      return { type: 'Cuboid', position, rotation, size } as CuboidCollider;
    }
    case 'Ball': {
      if (!('width' in child && 'height' in child)) { reporter.warn(`${child['name']} missing width/height.`); return null; }
      const w = (child as any).width as number; const h = (child as any).height as number;
      const radius = (w + h) * 0.25;
      return { type: 'Ball', position, rotation, radius } as BallCollider;
    }
    case 'Convex': {
      const worldVertsTL = getWorldPolygonVertices(child);
      const vertsRapier = worldVertsTL.map(p => toRapierFromFigmaWorld(p, level));
      const { vertices } = centerVertices(ensureClockwise(vertsRapier));
      return { type: 'ConvexHull', position, rotation, vertices } as ConvexHullCollider;
    }
    case 'Trimesh': {
      const worldVertsTL = getWorldPolygonVertices(child);
      const vertsRapier = worldVertsTL.map(p => toRapierFromFigmaWorld(p, level));
      const { vertices } = centerVertices(ensureClockwise(vertsRapier));
      const { indices } = triangulateConcave(vertices);
      return { type: 'Trimesh', position, rotation, triangles: { vertices, indices } } as TrimeshCollider;
    }
    case 'Polyline': {
      const worldVertsTL = getWorldPolygonVertices(child);
      const vertsRapier = worldVertsTL.map(p => toRapierFromFigmaWorld(p, level));
      const { vertices } = centerVertices(vertsRapier);
      return { type: 'Polyline', position, rotation, vertices } as PolylineCollider;
    }
    case 'Compound': {
      // Nested Compound -> recursion
      const nestedChildren = collectColliderDescendants(child as any)
        .map((gc: SceneNode) => buildChildRelativeToParent(gc, child as SceneNode, level, reporter))
        .filter(Boolean) as ColliderData[];
      return { type: 'Compound', position, rotation, children: nestedChildren } as CompoundCollider;
    }
    default:
      reporter.warn(`Unsupported collider type: ${type}`);
      return null;
  }
}

