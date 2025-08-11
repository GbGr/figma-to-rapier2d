export interface Reporter {
  warnings: string[];
  stats: { levels: number; gameObjects: number; colliders: Record<string, number> };
  warn(msg: string): void;
  bump(kind: string): void;
}

export function makeReporter(): Reporter {
  return {
    warnings: [],
    stats: { levels: 0, gameObjects: 0, colliders: {} },
    warn(msg) { this.warnings.push(msg); figma.ui.postMessage({ type:'warn', text: msg }); },
    bump(kind) { this.stats.colliders[kind] = (this.stats.colliders[kind]||0)+1; }
  };
}
