/**
 * Geometry data exchanged with the kernel worker.
 *
 * Plain data only and no imports: this file is loaded inside the worker too.
 */

// ---------------------------------------------------------------------------
// Build plan: the design with every expression evaluated, as plain data that
// crosses the worker boundary
// ---------------------------------------------------------------------------

export type PlanPlane = 'XY' | 'XZ' | 'YZ'

type ReadonlyVec3 = readonly [number, number, number]

/**
 * Sketch coordinate systems of the origin planes, right-handed (x × y = normal).
 * A sketch with offset d sits at d · normal. Kernel and viewport both use this,
 * so outlines and solids line up.
 */
export const PLANE_BASIS: Record<PlanPlane, { x: ReadonlyVec3; y: ReadonlyVec3; normal: ReadonlyVec3 }> = {
  XY: { x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] },
  XZ: { x: [1, 0, 0], y: [0, 0, 1], normal: [0, -1, 0] },
  YZ: { x: [0, 1, 0], y: [0, 0, 1], normal: [1, 0, 0] },
}

export type Vec2 = [number, number]

/** A piece of a profile boundary in sketch coordinates */
export type LoopSegment =
  | { kind: 'line'; from: Vec2; to: Vec2 }
  /** Arc from `from` to `to` around center, counter-clockwise when ccw */
  | { kind: 'arc'; from: Vec2; to: Vec2; center: Vec2; radius: number; ccw: boolean }
  /** A whole circle forming a loop on its own */
  | { kind: 'circle'; center: Vec2; radius: number }

/** A closed area of a sketch: what Fusion calls a profile */
export interface PlanRegion {
  /** Counter-clockwise outer boundary */
  outer: LoopSegment[]
  /** Clockwise inner boundaries */
  holes: LoopSegment[][]
  /** Sampled polygons of outer and holes, for display and picking */
  outline: Vec2[]
  holeOutlines: Vec2[][]
  area: number
  /** A point inside the region */
  inside: Vec2
  /** How many other regions enclose this one; even depths are the default profiles */
  depth: number
}

/** Sketch curves for display */
export type PlanCurve =
  | { kind: 'line'; from: Vec2; to: Vec2; construction: boolean }
  | { kind: 'circle'; center: Vec2; radius: number; construction: boolean }
  /** Counter-clockwise from `from` to `to` */
  | { kind: 'arc'; center: Vec2; radius: number; from: Vec2; to: Vec2; construction: boolean }

export type PlanOperation = 'NewBody' | 'Join' | 'Cut' | 'Intersect'

export type PlanFeature =
  | { kind: 'sketch'; index: number; plane: PlanPlane; offset: number; curves: PlanCurve[]; regions: PlanRegion[] }
  | {
      kind: 'extrude'
      index: number
      /** Timeline index of the sketch */
      sketch: number
      /** Indexes into the sketch's regions */
      profiles: number[]
      operation: PlanOperation
      distance: number
      direction: 'OneSide' | 'Reversed' | 'Symmetric'
    }
  | {
      kind: 'revolve'
      index: number
      sketch: number
      profiles: number[]
      operation: PlanOperation
      /** Axis in sketch coordinates */
      axis: { origin: Vec2; direction: Vec2 }
      /** Degrees */
      angle: number
    }

export type Vec3 = [number, number, number]

/** Features that modify the bodies built so far */
export type ModifierFeature =
  | { kind: 'fillet'; index: number; edges: Vec3[]; radius: number }
  | { kind: 'chamfer'; index: number; edges: Vec3[]; distance: number }
  /**
   * Hollows the body the faces belong to, removing them; thickness goes
   * inward. With a depth the hollow reaches only that far in from the first face.
   */
  | { kind: 'shell'; index: number; faces: Vec3[]; thickness: number; depth?: number }

export interface BuildPlan {
  features: (PlanFeature | ModifierFeature)[]
}

/** A problem with one timeline feature, by its index in Design.features. */
export interface FeatureProblem {
  index: number
  message: string
}

// ---------------------------------------------------------------------------
// Kernel
// ---------------------------------------------------------------------------

export interface BodyMesh {
  /** xyz triples */
  vertices: Float32Array
  normals: Float32Array
  triangles: Uint32Array
  /** Line segment endpoints, xyz pairs */
  edges: Float32Array
  /** Per B-rep edge: first float index into `edges` and number of floats */
  edgeGroups: { start: number; count: number }[]
  /** [minX, minY, minZ, maxX, maxY, maxZ] */
  bounds: [number, number, number, number, number, number]
  /** Volume in mm³ */
  volume: number
  /** Triangle ranges of the B-rep faces, with the plane of the planar ones */
  faces: BodyFace[]
}

export interface BodyFace {
  /** First index into `triangles` and number of indexes */
  start: number
  count: number
  /** Set for planar faces: a point on the face and its outward normal */
  plane?: { origin: Vec3; normal: Vec3 }
}

export interface BuildResult {
  bodies: BodyMesh[]
  problems: FeatureProblem[]
  /** Milliseconds the kernel needed */
  duration: number
}

export type ExportFormat = 'stl' | 'step' | '3mf'
