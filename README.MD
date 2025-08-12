# Figma → Rapier 2D Collider Exporter

## Overview

This Figma plugin exports physics colliders from level designs directly into ready-to-use JSON for the Rapier 2D physics engine. All calculations—transformations, anchor adjustments, polygon processing—are performed in the plugin so the output requires **no additional processing**.

## Features

- **Supported collider types**:
    - `Cuboid` → Box collider
    - `Ball` → Circle collider
    - `Convex` → Convex polygon, with auto-decomposition into Compound if non-convex
    - `Trimesh` → Concave polygon, triangulated
    - `Polyline` → Open polyline
    - `Compound` → Group of colliders
    - `SimplifiedConvex` → Simplified convex polygon with configurable vertex reduction
- **Body types**: `Static`, `Dynamic`, `Kinematic`
- **Custom parameters** for physics properties and simplification settings
- **Matrix transformation handling**: rotation, position, scale, mirroring (flip)
- **Anchor point conversion**: top-left (Figma) → center (Rapier)
- **Convex decomposition** using `poly-decomp`
- **Concave triangulation** using `earcut`
- **Validation & warnings** for missing/invalid data
- **Batch export** with metadata and statistics
- **Canvas preview** of exported colliders before download

## Figma Structure Convention

```
LevelBlock:NAME (Frame)
 └── GameObject:NAME (Group)
     ├── Collider:TYPE (Node)
     ├── BodyType:TYPE (Text)
     └── CustomParam:KEY:VALUE (Text)
```

## Custom Parameters

Example:

```
CustomParam:friction:0.5
CustomParam:restitution:0.8
CustomParam:density:2.0
CustomParam:isSensor:true
CustomParam:simplifyEpsilon:2.0
CustomParam:simplifyMaxPoints:12
```

## SimplifiedConvex

A special collider type that:

1. Reads the original polygon vertices
2. Simplifies them using Ramer–Douglas–Peucker algorithm
3. Processes as a Convex collider (with decomposition if needed)

Parameters:

- `simplifyEpsilon` → simplification tolerance (default `1.5`)
- `simplifyMaxPoints` → max vertices after simplification (default `Infinity`)

## Output Format

```ts
interface LevelData {
  name: string;
  width: number;
  height: number;
  gameObjects: GameObjectData[];
}

interface GameObjectData {
  name: string;
  position: [number, number];
  rotation: number;
  collider: ColliderData;
  bodyType: 'Static' | 'Dynamic' | 'Kinematic';
  customParams: Record<string, string>;
}

interface ColliderData {
  type: 'Cuboid' | 'Ball' | 'ConvexHull' | 'Trimesh' | 'Polyline' | 'Compound';
  position: [number, number];
  rotation: number;
  size?: [number, number];
  radius?: number;
  vertices?: [number, number][];
  triangles?: { vertices: [number, number][], indices: number[] };
  children?: ColliderData[];
}
```

## Installation

1. Clone the repository
2. Run `npm install`
3. Build with `npm run build`
4. Load the plugin into Figma via `Development → Import plugin from manifest`

## Usage

1. Create a LevelBlock frame in Figma
2. Add GameObjects with colliders, body type, and optional custom parameters
3. Open the plugin, preview colliders in canvas
4. Click **Download JSON** to export for Rapier 2D

## License

MIT

