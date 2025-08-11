import { buildGameObject } from './builders';
import { LevelData } from '../types';
import { makeReporter } from './reporter';

export async function exportLevels(): Promise<LevelData[]> {
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
      meta: { version: '1.0.0', timestamp: new Date().toISOString(), warnings: reporter.warnings, stats: reporter.stats }
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

    results.push(levelData);
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
