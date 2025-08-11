export type Vec2 = [number, number];

export function sub(a: Vec2, b: Vec2): Vec2 { return [a[0]-b[0], a[1]-b[1]]; }
export function add(a: Vec2, b: Vec2): Vec2 { return [a[0]+b[0], a[1]+b[1]]; }
export function rot(p: Vec2, ang: number): Vec2 {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [p[0]*c - p[1]*s, p[0]*s + p[1]*c];
}

export function toGoLocal(pWorld: Vec2, goPos: Vec2, goRot: number): Vec2 {
  return rot(sub(pWorld, goPos), -goRot);
}

export type Mat2x3 = Readonly<[[number, number, number],[number, number, number]]>;

export function applyToPoint(m: Mat2x3, x: number, y: number): [number, number] {
  return [m[0][0]*x + m[0][1]*y + m[0][2], m[1][0]*x + m[1][1]*y + m[1][2]];
}

export function getRotationFromMatrix(matrix: Mat2x3): number {
  // Rotation is atan2 of first column (a,b)
  const a = matrix[0][0];
  const b = matrix[0][1];
  return Math.atan2(b, a);
}

export function figmaWorldToLevelLocal(p: [number, number], levelFrame: FrameNode): [number, number] {
  const levelM = levelFrame.absoluteTransform as Mat2x3;
  const levelTopLeft: [number, number] = [levelM[0][2], levelM[1][2]];
  return [p[0] - levelTopLeft[0], p[1] - levelTopLeft[1]]; // still TL, Y-down
}

export function tlToCenterYUp(pTL: [number, number], levelSize: { width: number; height: number }): [number, number] {
  const cx = pTL[0] - levelSize.width / 2;
  const cy = (levelSize.height / 2) - pTL[1];
  return [cx, cy];
}

export function toRapierFromFigmaWorld(pWorld: [number, number], levelFrame: FrameNode): [number, number] {
  const levelSize = { width: levelFrame.width, height: levelFrame.height };
  const pTL = figmaWorldToLevelLocal(pWorld, levelFrame);
  return tlToCenterYUp(pTL, levelSize);
}

export function getNodeCenterInWorld(node: SceneNode): [number, number] {
  const m = node.absoluteTransform as Mat2x3;
  const w = ('width' in node) ? (node as any).width : 0;
  const h = ('height' in node) ? (node as any).height : 0;
  return applyToPoint(m, w/2, h/2);
}

export function getNodeRotation(node: SceneNode): number {
  return getRotationFromMatrix(node.absoluteTransform as Mat2x3);
}

export function getPositionWithAnchorAdjustment(node: SceneNode, relativeTo: FrameNode): [number, number] {
  // Center of node in Rapier coords, relative to LevelBlock center
  const worldCenter = getNodeCenterInWorld(node);
  return toRapierFromFigmaWorld(worldCenter, relativeTo);
}

export function localOffsetBetween(nodeA: SceneNode, nodeB: SceneNode, level: FrameNode): [number, number] {
  // Rapier-space (center-origin, Y-up) offset: A - B
  const a = getPositionWithAnchorAdjustment(nodeA, level);
  const b = getPositionWithAnchorAdjustment(nodeB, level);
  return [a[0]-b[0], a[1]-b[1]];
}
