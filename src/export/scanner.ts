import { buildGameObject } from './builders';
import { LevelData } from '../types';
import { makeReporter } from './reporter';

type V2 = [number, number];

function svec([x,y]: V2, s: number): V2 { return [x*s, y*s]; }
function sverts(vs: V2[], s: number): V2[] { return vs.map(v => svec(v, s)); }

/**
 * Export levels from the current Figma page.
 * @param ppm Pixels per meter (or another unit).
 */
export async function exportLevels(ppm: number): Promise<LevelData[]> {
  const selection = figma.currentPage.selection;
  const levels = findLevelBlocks(figma.currentPage.children);
  const reporter = makeReporter();

  const picked = selection.length ? selection.filter(n => n.name.startsWith('LevelBlock:')) as FrameNode[] : levels;
  const results: LevelData[] = [];
  for (const level of picked) {
    const name = level.name.replace(/^LevelBlock:/, '').trim();
    const levelData: LevelData = {
      name,
      width: level.width,
      height: level.height,
      gameObjects: [],
      meta: {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        warnings: reporter.warnings,
        stats: reporter.stats,
        units: { pixelsPerUnit: ppm } // NEW
      } as any
    };

    const gameObjects = findGameObjects(level);
    if (gameObjects.length === 0) reporter.warn(`Level ${name} has no GameObject groups.`);

    for (const go of gameObjects) {
      try {
        const built = buildGameObject(go, level, reporter);
        levelData.gameObjects.push(built);
      } catch (e: any) {
        reporter.warn(`Failed to build GameObject ${go.name}: ${e.message}`);
      }
      figma.ui.postMessage({ type: 'progress', text: `Processed ${go.name}` });
      await new Promise(r => setTimeout(r, 0)); // yield
    }

    // NEW: apply scaling (pixels → units)
    const s = 1 / (ppm || 1);
    results.push(scaleLevel(levelData, s));
  }

  return results;
}

function findLevelBlocks(nodes: ReadonlyArray<SceneNode>): FrameNode[] {
  const out: FrameNode[] = [];
  for (const n of nodes) {
    if (n.type === 'FRAME' && n.name.startsWith('LevelBlock:')) out.push(n as FrameNode);
    if ('children' in n) out.push(...findLevelBlocks((n as any).children as SceneNode[]));
  }
  return out;
}

function findGameObjects(level: FrameNode): GroupNode[] {
  const out: GroupNode[] = [];
  const walk = (nodes: ReadonlyArray<SceneNode>) => {
    for (const n of nodes) {
      if (n.type === 'GROUP' && n.name.startsWith('GameObject:')) out.push(n as GroupNode);
      if ('children' in n) walk((n as any).children as SceneNode[]);
    }
  };
  walk(level.children);
  return out;
}

function scaleCollider(c: any, s: number): any {
  switch (c?.type) {
    case 'Cuboid':
      return { ...c, position: svec(c.position, s), size: svec(c.size, s) };
    case 'Ball':
      return { ...c, position: svec(c.position, s), radius: c.radius * s };
    case 'ConvexHull':
      return { ...c, position: svec(c.position, s), vertices: sverts(c.vertices, s) };
    case 'Polyline':
      return { ...c, position: svec(c.position, s), vertices: sverts(c.vertices, s) };
    case 'Trimesh':
      return {
        ...c,
        position: svec(c.position, s),
        triangles: { vertices: sverts(c.triangles.vertices, s), indices: c.triangles.indices }
      };
    case 'Compound':
      return {
        ...c,
        position: svec(c.position, s),
        children: (c.children || []).map((ch: any) => scaleCollider(ch, s))
      };
    default:
      return c;
  }
}

function scaleLevel(level: LevelData, s: number): LevelData {
  return {
    ...level,
    width: level.width * s,
    height: level.height * s,
    gameObjects: level.gameObjects.map(go => ({
      ...go,
      position: svec(go.position as V2, s),
      collider: go.collider ? scaleCollider(go.collider, s) : null
    })),
    meta: {
      ...level.meta,
      // expose chosen units
      units: { pixelsPerUnit: (level.meta as any).units?.pixelsPerUnit ?? (1 / s === 0 ? 1 : 1 / s) }
    } as any
  };
}

