export interface LevelData {
  name: string;
  width: number;
  height: number;
  gameObjects: GameObjectData[];
  meta: { version: string; timestamp: string; warnings: string[]; stats: ExportStats; units?: { pixelsPerUnit: number } };
}

export interface ExportStats {
  levels: number;
  gameObjects: number;
  colliders: Record<string, number>; // by collider type
}

export interface GameObjectData {
  name: string;
  position: [number, number]; // center-relative within level (Rapier coords, Y-up)
  rotation: number; // radians
  collider: ColliderData | null;
  bodyType: 'Static' | 'Dynamic' | 'Kinematic';
  customParams: Record<string, string>;
}

export type ColliderType = 'Cuboid' | 'Ball' | 'ConvexHull' | 'Trimesh' | 'Polyline' | 'Compound';

export interface ColliderDataBase {
  type: ColliderType;
  position: [number, number]; // local offset from GO center (Rapier coords)
  rotation: number;            // local rotation rel. GO
}

export interface CuboidCollider extends ColliderDataBase {
  type: 'Cuboid';
  size: [number, number]; // full width/height (not half extents)
}

export interface BallCollider extends ColliderDataBase {
  type: 'Ball';
  radius: number;
}

export interface ConvexHullCollider extends ColliderDataBase {
  type: 'ConvexHull';
  vertices: [number, number][]; // centered around collider center
}

export interface PolylineCollider extends ColliderDataBase {
  type: 'Polyline';
  vertices: [number, number][];
}

export interface TrimeshCollider extends ColliderDataBase {
  type: 'Trimesh';
  triangles: { vertices: [number, number][], indices: number[] };
}

export interface CompoundCollider extends ColliderDataBase {
  type: 'Compound';
  children: ColliderData[];
}

export type ColliderData =
  | CuboidCollider | BallCollider | ConvexHullCollider
  | PolylineCollider | TrimeshCollider | CompoundCollider;
