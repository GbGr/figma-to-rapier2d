import { getNodeRotation, getPositionWithAnchorAdjustment, localOffsetBetween, toRapierFromFigmaWorld, toGoLocal } from '../geometry/transforms';
import { getWorldPolygonVertices } from '../geometry/paths';
import {
  centerVertices, ensureClockwise, decomposeIfNeeded, triangulateConcave, Vec2, simplifyPolygon,
} from '../geometry/polygons';
import type { GameObjectData, ColliderData, CuboidCollider, BallCollider, ConvexHullCollider, TrimeshCollider, PolylineCollider, CompoundCollider } from '../types';
import { Reporter } from './reporter';

export function buildGameObject(go: GroupNode, level: FrameNode, reporter: Reporter): GameObjectData {
  const name = go.name.replace(/^GameObject:/, '').trim();

  // NEW: use rigid body AABB center
  const rbCenter = computeRigidBodyCenter(go, level);

  const rotation = getNodeRotation(go);
  const bodyType = findBodyType(go) || 'Static';
  const customParams = findCustomParams(go);

  // pass the rbCenter down so colliders are relative to it
  const collider = buildCollider(go, level, reporter, rbCenter);

  return { name, position: rbCenter, rotation, collider, bodyType, customParams };
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

function buildCollider(go: GroupNode, level: FrameNode, reporter: Reporter, anchor: Vec2): ColliderData | null {
  // If there are multiple Collider:* nodes, wrap in Compound
  const colliders = go.children.filter(n => n.name.startsWith('Collider:'));
  if (colliders.length === 0) { reporter.warn(`GameObject ${go.name} has no Collider:* node.`); return null; }
  if (colliders.length > 1) {
    const children = colliders.map(n => buildSingleCollider(n, go, level, reporter, anchor)).filter(Boolean) as ColliderData[];
    const compound: CompoundCollider = {
      type: 'Compound',
      position: [0,0],
      rotation: 0,
      children
    };
    reporter.bump('Compound');
    return compound;
  }
  return buildSingleCollider(colliders[0], go, level, reporter, anchor);
}

function buildSingleCollider(node: SceneNode, go: GroupNode, level: FrameNode, reporter: Reporter, anchor: Vec2): ColliderData | null {
  if (!node.name.startsWith('Collider:')) return null;
  const type = node.name.replace(/^Collider:/,'').trim();

  // local offset/rotation RELATIVE TO RIGID BODY (anchor), not the GO center
  const localRot = getNodeRotation(node) - getNodeRotation(go);

  switch (type) {
    case 'Cuboid': {
      if (!('width' in node && 'height' in node)) { reporter.warn(`${node['name']} missing width/height.`); return null; }
      const size: [number, number] = [(node as any).width, (node as any).height];
      const position = localOffsetToAnchor(node, anchor, level);       // CHANGED
      const out: CuboidCollider = { type: 'Cuboid', position, rotation: localRot, size };
      reporter.bump('Cuboid');
      return out;
    }
    case 'Ball': {
      if (!('width' in node && 'height' in node)) { reporter.warn(`${node['name']} missing width/height.`); return null; }
      const w = (node as any).width as number; const h = (node as any).height as number;
      const radius = (w + h) * 0.25;
      const position = localOffsetToAnchor(node, anchor, level);       // CHANGED
      const out: BallCollider = { type: 'Ball', position, rotation: localRot, radius };
      reporter.bump('Ball');
      return out;
    }
    case 'Convex': {
      const worldVertsTL = getWorldPolygonVertices(node);
      const vertsRapierWorld = worldVertsTL.map(p => toRapierFromFigmaWorld(p, level));

      // Use RB anchor (AABB center) + GO rotation
      const goRot = getNodeRotation(go);
      const vertsRBLocal = vertsRapierWorld.map(v => toGoLocal(v as Vec2, anchor, goRot)); // CHANGED

      const cw = ensureClockwise(vertsRBLocal as any);
      const { center: polyCenter, vertices: centered } = centerVertices(cw);

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
    case 'Trimesh': {
      const worldVertsTL = getWorldPolygonVertices(node);
      const vertsRapierWorld = worldVertsTL.map(p => toRapierFromFigmaWorld(p, level));
      const goRot = getNodeRotation(go);
      const vertsRBLocal = vertsRapierWorld.map(v => toGoLocal(v as Vec2, anchor, goRot)); // CHANGED

      const cw = ensureClockwise(vertsRBLocal as any);
      const { center, vertices } = centerVertices(cw);
      const { indices } = triangulateConcave(vertices as any);
      const out: TrimeshCollider = { type:'Trimesh', position: center as Vec2, rotation: 0, triangles: { vertices: vertices as any, indices } };
      reporter.bump('Trimesh');
      return out;
    }
    case 'Polyline': {
      const worldVertsTL = getWorldPolygonVertices(node);
      const vertsRapierWorld = worldVertsTL.map(p => toRapierFromFigmaWorld(p, level));
      const goRot = getNodeRotation(go);
      const vertsRBLocal = vertsRapierWorld.map(v => toGoLocal(v as Vec2, anchor, goRot)); // CHANGED

      const { center, vertices } = centerVertices(vertsRBLocal as any);
      const out: PolylineCollider = { type:'Polyline', position: center as Vec2, rotation: 0, vertices: vertices as any };
      reporter.bump('Polyline');
      return out;
    }
    case 'Compound': {
      if (!('children' in node)) { reporter.warn(`Compound collider must be Group/Frame.`); return null; }

      const colliderDescendants = collectColliderDescendants(node as any);
      if (colliderDescendants.length === 0) {
        reporter.warn(`${node.name} has no Collider:* descendants.`);
      }

      const children = colliderDescendants
        .map((c: SceneNode) => buildChildRelativeToParent(c, node as SceneNode, level, reporter))
        .filter(Boolean) as ColliderData[];

      // Position this compound relative to the RB anchor (not GO)
      const localPos = localOffsetToAnchor(node, anchor, level);        // CHANGED
      const localRot = getNodeRotation(node) - getNodeRotation(go);

      const out: CompoundCollider = { type: 'Compound', position: localPos as Vec2, rotation: localRot, children };
      reporter.bump('Compound');
      return out;
    }
    case 'SimplifiedConvex': {
      const worldVertsTL = getWorldPolygonVertices(node);
      const vertsRapierWorld = worldVertsTL.map(p => toRapierFromFigmaWorld(p, level));

      const goRot = getNodeRotation(go);
      const vertsRBLocal = vertsRapierWorld.map(v => toGoLocal(v as Vec2, anchor, goRot)); // CHANGED

      const params = findCustomParams(go);
      const eps = params.simplifyEpsilon ? parseFloat(params.simplifyEpsilon) : 1.5;
      const maxPts = params.simplifyMaxPoints ? parseInt(params.simplifyMaxPoints, 10) : Number.POSITIVE_INFINITY;

      const simplifiedCW = simplifyPolygon(vertsRBLocal as any, { epsilon: eps, maxPoints: maxPts });

      const { center: polyCenter, vertices: centered } = centerVertices(simplifiedCW);
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

// add near the top of builders.ts
function colliderLeafNodes(root: SceneNode): SceneNode[] {
  // get Collider:* leaves (skip "Compound" wrappers themselves)
  const all = collectColliderDescendants(root);
  return all.filter(n => !/^Collider:\s*Compound\b/.test(n.name));
}

function colliderWorldPointsRapier(nodes: SceneNode[], level: FrameNode): Vec2[] {
  const pts: Vec2[] = [];
  for (const n of nodes) {
    const worldVertsTL = getWorldPolygonVertices(n);
    pts.push(...worldVertsTL.map(p => toRapierFromFigmaWorld(p, level)) as Vec2[]);
  }
  return pts;
}

function aabbCenter(points: Vec2[]): Vec2 {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x,y] of points) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return [(minX + maxX) * 0.5, (minY + maxY) * 0.5];
}

function computeRigidBodyCenter(go: GroupNode, level: FrameNode): Vec2 {
  const directColliders = go.children.filter(n => n.name.trim().startsWith('Collider:'));
  if (directColliders.length === 0) {
    // no colliders — fall back to group visual center (previous behavior)
    return getPositionWithAnchorAdjustment(go, level) as Vec2;
  }
  // collect all collider leaves from each top-level collider (flatten compound)
  const leaves: SceneNode[] = [];
  for (const c of directColliders) {
    if (/^Collider:\s*Compound\b/.test(c.name)) {
      leaves.push(...colliderLeafNodes(c));
    } else {
      leaves.push(c);
    }
  }
  const pts = colliderWorldPointsRapier(leaves, level);
  if (pts.length === 0) {
    return getPositionWithAnchorAdjustment(go, level) as Vec2;
  }
  return aabbCenter(pts);
}

function localOffsetToAnchor(node: SceneNode, anchorRapier: Vec2, level: FrameNode): Vec2 {
  const c = getPositionWithAnchorAdjustment(node, level) as Vec2; // node’s world center → Rapier
  return [c[0] - anchorRapier[0], c[1] - anchorRapier[1]];
}

