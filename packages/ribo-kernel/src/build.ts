/**
 * Replays a build plan with replicad. Runs inside the kernel worker, after
 * OpenCascade has been handed to replicad (setOC).
 */

import {
  Plane,
  draw,
  drawCircle,
  makeCompound,
  measureVolume,
  type AnyShape,
  type Drawing,
  type Shape3D,
  type Sketch,
} from 'replicad'
import {
  PLANE_BASIS,
  type BodyFace,
  type BodyMesh,
  type BuildPlan,
  type FeatureProblem,
  type LoopSegment,
  type PlanFeature,
  type PlanRegion,
  type Vec2,
} from 'ribo-contracts/geometry'

type SketchFeature = Extract<PlanFeature, { kind: 'sketch' }>
type ProfileFeature = Extract<PlanFeature, { kind: 'extrude' | 'revolve' }>
type Vec3 = [number, number, number]

const MESH_OPTIONS = { tolerance: 0.02, angularTolerance: 10 }

export interface BuiltDesign {
  bodies: Shape3D[]
  problems: FeatureProblem[]
}

/** Point halfway along an arc segment, in its direction of travel */
function arcMidpoint(segment: Extract<LoopSegment, { kind: 'arc' }>): Vec2 {
  const [cx, cy] = segment.center
  const a0 = Math.atan2(segment.from[1] - cy, segment.from[0] - cx)
  const a1 = Math.atan2(segment.to[1] - cy, segment.to[0] - cx)
  let sweep = a1 - a0
  if (segment.ccw) {
    while (sweep <= 0) sweep += 2 * Math.PI
  } else {
    while (sweep >= 0) sweep -= 2 * Math.PI
  }
  const mid = a0 + sweep / 2
  return [cx + segment.radius * Math.cos(mid), cy + segment.radius * Math.sin(mid)]
}

function loopDrawing(loop: LoopSegment[]): Drawing {
  const first = loop[0]!
  if (first.kind === 'circle') return drawCircle(first.radius).translate(first.center[0], first.center[1])

  const pen = draw(first.from)
  loop.forEach((segment, i) => {
    const last = i === loop.length - 1
    if (segment.kind === 'line') {
      // The closing line is added by close()
      if (!last) pen.lineTo(segment.to)
    } else if (segment.kind === 'arc') {
      // End exactly on the start point, so close() finds the loop closed
      pen.threePointsArcTo(last ? first.from : segment.to, arcMidpoint(segment))
    }
  })
  return pen.close()
}

function regionDrawing(region: PlanRegion): Drawing {
  let drawing = loopDrawing(region.outer)
  for (const hole of region.holes) drawing = drawing.cut(loopDrawing(hole))
  return drawing
}

function sketchPlane(sketch: SketchFeature, offset = sketch.offset): Plane {
  const basis = PLANE_BASIS[sketch.plane]
  const origin: Vec3 = [basis.normal[0] * offset, basis.normal[1] * offset, basis.normal[2] * offset]
  return new Plane(origin, [...basis.x], [...basis.normal])
}

/** Sketch coordinates to world coordinates */
function toWorld(sketch: SketchFeature, [u, v]: Vec2, offset = sketch.offset): Vec3 {
  const { x, y, normal } = PLANE_BASIS[sketch.plane]
  return [0, 1, 2].map((i) => x[i]! * u + y[i]! * v + normal[i]! * offset) as Vec3
}

/** The selected regions as one drawing; adjacent regions merge in 2D */
function profileDrawing(sketch: SketchFeature, feature: ProfileFeature): Drawing {
  if (feature.profiles.length === 0) throw new Error('Kein Profil gewählt')
  const drawings = feature.profiles.map((i) => {
    const region = sketch.regions[i]
    if (!region) throw new Error('Ein gewähltes Profil existiert nicht mehr')
    return regionDrawing(region)
  })
  return drawings.slice(1).reduce((all, next) => all.fuse(next), drawings[0]!)
}

function toolOf(sketch: SketchFeature, feature: ProfileFeature): Shape3D {
  const drawing = profileDrawing(sketch, feature)
  if (feature.kind === 'extrude') {
    if (feature.distance <= 0) throw new Error('Abstand muss größer als 0 sein')
    const offset = feature.direction === 'Symmetric' ? sketch.offset - feature.distance / 2 : sketch.offset
    const placed = drawing.sketchOnPlane(sketchPlane(sketch, offset)) as Sketch
    return placed.extrude(feature.direction === 'Reversed' ? -feature.distance : feature.distance)
  }
  if (feature.angle <= 0 || feature.angle > 360) throw new Error('Winkel muss zwischen 0 und 360° liegen')
  const [du, dv] = feature.axis.direction
  if (Math.hypot(du, dv) < 1e-9) throw new Error('Die Drehachse hat keine Länge')
  const { x, y } = PLANE_BASIS[sketch.plane]
  const direction = [0, 1, 2].map((i) => x[i]! * du + y[i]! * dv) as Vec3
  const placed = drawing.sketchOnPlane(sketchPlane(sketch)) as Sketch
  return placed.revolve(direction, { origin: toWorld(sketch, feature.axis.origin), angle: feature.angle })
}

function combine(bodies: Shape3D[], tool: Shape3D, feature: ProfileFeature): Shape3D[] {
  switch (feature.operation) {
    case 'NewBody':
      return [...bodies, tool]
    case 'Join': {
      if (bodies.length === 0) return [tool]
      const last = bodies[bodies.length - 1]!
      const joined = last.fuse(tool)
      last.delete()
      tool.delete()
      return [...bodies.slice(0, -1), joined]
    }
    case 'Cut':
    case 'Intersect': {
      if (bodies.length === 0) {
        tool.delete()
        throw new Error(feature.operation === 'Cut' ? 'Kein Körper zum Schneiden vorhanden' : 'Kein Körper zum Verschneiden vorhanden')
      }
      const result = bodies.map((body) => {
        const next = feature.operation === 'Cut' ? body.cut(tool) : body.intersect(tool)
        body.delete()
        return next
      })
      tool.delete()
      return result
    }
  }
}

/** Replays the plan; a failing feature is reported and skipped. */
export function buildDesign(plan: BuildPlan): BuiltDesign {
  const sketches = new Map<number, SketchFeature>()
  const problems: FeatureProblem[] = []
  let bodies: Shape3D[] = []

  for (const feature of plan.features) {
    try {
      if (feature.kind === 'sketch') {
        sketches.set(feature.index, feature)
        continue
      }
      const sketch = sketches.get(feature.sketch)
      if (!sketch) throw new Error('Die Skizze dieses Features ist nicht verfügbar')
      bodies = combine(bodies, toolOf(sketch, feature), feature)
    } catch (error) {
      problems.push({ index: feature.index, message: messageOf(error) })
    }
  }

  return { bodies, problems }
}

/** The plane of a face group when all its normals agree, i.e. the face is flat */
function planeOfGroup(mesh: { vertices: number[]; normals: number[]; triangles: number[] }, start: number, count: number) {
  const first = mesh.triangles[start]!
  const n: Vec3 = [mesh.normals[first * 3]!, mesh.normals[first * 3 + 1]!, mesh.normals[first * 3 + 2]!]
  for (let i = start; i < start + count; i++) {
    const v = mesh.triangles[i]!
    const dot = n[0] * mesh.normals[v * 3]! + n[1] * mesh.normals[v * 3 + 1]! + n[2] * mesh.normals[v * 3 + 2]!
    if (dot < 0.99999) return undefined
  }
  const origin: Vec3 = [mesh.vertices[first * 3]!, mesh.vertices[first * 3 + 1]!, mesh.vertices[first * 3 + 2]!]
  return { origin, normal: n }
}

export function meshBody(body: Shape3D): BodyMesh {
  const mesh = body.mesh(MESH_OPTIONS)
  const edges = body.meshEdges(MESH_OPTIONS)
  const [[minX, minY, minZ], [maxX, maxY, maxZ]] = body.boundingBox.bounds
  const faces: BodyFace[] = mesh.faceGroups.map((group) => ({
    start: group.start,
    count: group.count,
    plane: planeOfGroup(mesh, group.start, group.count),
  }))
  return {
    vertices: new Float32Array(mesh.vertices),
    normals: new Float32Array(mesh.normals),
    triangles: new Uint32Array(mesh.triangles),
    edges: new Float32Array(edges.lines),
    bounds: [minX, minY, minZ, maxX, maxY, maxZ],
    volume: measureVolume(body),
    faces,
  }
}

export function exportBodies(bodies: Shape3D[], format: 'stl' | 'step'): Blob {
  if (bodies.length === 0) throw new Error('Es gibt keinen Körper zum Exportieren')
  const shape: AnyShape = bodies.length === 1 ? bodies[0]! : makeCompound(bodies)
  try {
    return format === 'stl' ? (shape as Shape3D).blobSTL({ ...MESH_OPTIONS, binary: true }) : (shape as Shape3D).blobSTEP()
  } finally {
    if (shape !== bodies[0]) shape.delete()
  }
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  // OpenCascade throws plain numbers (pointers to Standard_Failure)
  if (typeof error === 'number') return 'Geometrie-Operation fehlgeschlagen'
  return String(error)
}
