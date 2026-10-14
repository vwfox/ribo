/**
 * Replays a build plan with replicad. Runs inside the kernel worker, after
 * OpenCascade has been handed to replicad (setOC).
 */

import {
  Plane,
  cast,
  draw,
  drawCircle,
  drawRectangle,
  getOC,
  makeCompound,
  makeVertex,
  measureDistanceBetween,
  measureVolume,
  type AnyShape,
  type Drawing,
  type Edge,
  type Face,
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
  type ModifierFeature,
  type PlanFeature,
  type PlanRegion,
  type Vec2,
} from 'ribo-contracts/geometry'

type SketchFeature = Extract<PlanFeature, { kind: 'sketch' }>
type ProfileFeature = Extract<PlanFeature, { kind: 'extrude' | 'revolve' }>
type Vec3 = [number, number, number]

/**
 * How far a remembered edge midpoint or face point may lie from the edge or
 * face it stands for. Picks are remembered by position, so a change that
 * moves an edge further than this loses it - the feature then reports it.
 */
const PICK_TOLERANCE = 0.5

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

/** For each point, the nearest of the candidates within the pick tolerance */
function nearest<T extends Edge | Face>(points: Vec3[], candidates: { body: number; shape: T }[]): ({ body: number; shape: T } | undefined)[] {
  return points.map((point) => {
    const vertex = makeVertex(point)
    let best: { body: number; shape: T } | undefined
    let bestDistance = PICK_TOLERANCE
    for (const candidate of candidates) {
      const distance = measureDistanceBetween(candidate.shape, vertex)
      if (distance <= bestDistance) {
        best = candidate
        bestDistance = distance
      }
    }
    vertex.delete()
    return best
  })
}

/** True when OpenCascade's checker finds nothing wrong with the shape */
function isValidSolid(shape: Shape3D): boolean {
  const oc = getOC()
  const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false, false)
  try {
    return analyzer.IsValid(shape.wrapped)
  } finally {
    analyzer.delete()
  }
}

/**
 * Hollows a body, removing the given faces; thickness goes inward.
 *
 * Calls OpenCascade directly rather than through replicad's shell, which
 * hands back whatever the builder produced: on some bodies that is an
 * invalid solid with reversed faces and wrong walls, or the body unchanged.
 * Each result is checked; rounded joins come first, sharp intersections are
 * the fallback that often succeeds where they fail.
 */
function hollow(body: Shape3D, faces: Face[], thickness: number): Shape3D {
  const oc = getOC()
  const volume = measureVolume(body)
  for (const join of [oc.GeomAbs_JoinType.GeomAbs_Arc, oc.GeomAbs_JoinType.GeomAbs_Intersection]) {
    const closing = new oc.NCollection_List_TopoDS_Shape()
    const builder = new oc.BRepOffsetAPI_MakeThickSolid()
    try {
      for (const face of faces) closing.Append(face.wrapped)
      const intersection = join === oc.GeomAbs_JoinType.GeomAbs_Intersection
      builder.MakeThickSolidByJoin(body.wrapped, closing, -thickness, 1e-3, oc.BRepOffset_Mode.BRepOffset_Skin, intersection, false, join, false)
      if (!builder.IsDone()) continue
      const result = cast(builder.Shape()) as Shape3D
      const remaining = measureVolume(result)
      if (remaining > 1e-6 && remaining < volume * (1 - 1e-6) && isValidSolid(result)) return result
      result.delete()
    } catch {
      // try the next join type
    } finally {
      builder.delete()
      closing.delete()
    }
  }
  throw new Error('Schale nicht möglich – Wandstärke zu groß oder die offene Fläche grenzt an eine Rundung. Tipp: Schale vor dem Abrunden anlegen.')
}

/** A unit vector perpendicular to n */
function perpendicular([x, y, z]: Vec3): Vec3 {
  const a: Vec3 = Math.abs(x) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const c: Vec3 = [y * a[2] - z * a[1], z * a[0] - x * a[2], x * a[1] - y * a[0]]
  const length = Math.hypot(...c)
  return [c[0] / length, c[1] / length, c[2] / length]
}

/**
 * Turns a full shell into a hollow of limited depth: the hollow (body minus
 * shell) is cut down to a slab reaching `depth` in from the open face, and
 * only that is removed from the body. Side walls keep the wall thickness.
 */
function limitDepth(body: Shape3D, shelled: Shape3D, face: Face, at: Vec3, depth: number): Shape3D {
  const n = face.normalAt(at)
  const normal: Vec3 = [n.x, n.y, n.z]
  n.delete()
  const cavity = body.cut(shelled)
  shelled.delete()
  // A slab far wider than the body, from the open face inward
  const size = 1e5
  const plane = new Plane(at, perpendicular(normal), normal)
  const slab = (drawRectangle(size, size).sketchOnPlane(plane) as Sketch).extrude(-depth)
  const limited = cavity.intersect(slab)
  cavity.delete()
  slab.delete()
  const result = body.cut(limited)
  limited.delete()
  return result
}

/** Applies a fillet, chamfer or shell to the bodies its picks lie on */
function modify(bodies: Shape3D[], feature: ModifierFeature): { bodies: Shape3D[]; missing?: string } {
  const points = feature.kind === 'shell' ? feature.faces : feature.edges
  if (points.length === 0) throw new Error(feature.kind === 'shell' ? 'Keine Fläche gewählt' : 'Keine Kante gewählt')
  const size = feature.kind === 'fillet' ? feature.radius : feature.kind === 'chamfer' ? feature.distance : feature.thickness
  if (!(size > 0)) throw new Error('Der Wert muss größer als 0 sein')

  const candidates =
    feature.kind === 'shell'
      ? bodies.flatMap((body, i) => body.faces.map((shape) => ({ body: i, shape: shape as Edge | Face })))
      : bodies.flatMap((body, i) => body.edges.map((shape) => ({ body: i, shape: shape as Edge | Face })))
  try {
    const found = nearest(points, candidates)
    const lost = found.filter((f) => !f).length
    if (lost === points.length) {
      throw new Error(feature.kind === 'shell' ? 'Die gewählten Flächen gibt es nicht mehr' : 'Die gewählten Kanten gibt es nicht mehr')
    }
    const byBody = new Map<number, (Edge | Face)[]>()
    for (const hit of found) {
      if (!hit) continue
      if (!byBody.has(hit.body)) byBody.set(hit.body, [])
      byBody.get(hit.body)!.push(hit.shape)
    }
    const next = bodies.map((body, i) => {
      const picked = byBody.get(i)
      if (!picked) return body
      let result: Shape3D
      if (feature.kind === 'shell') {
        result = hollow(body, picked as Face[], size)
        if (feature.depth !== undefined) result = limitDepth(body, result, picked[0] as Face, feature.faces[0]!, feature.depth)
      } else {
        const edges = picked as Edge[]
        const pick = (edge: Edge) => (edges.some((e) => e.isSame(edge)) ? size : null)
        result = feature.kind === 'fillet' ? body.fillet(pick) : body.chamfer(pick)
      }
      body.delete()
      return result
    })
    const what = feature.kind === 'shell' ? 'Fläche(n)' : 'Kante(n)'
    return { bodies: next, missing: lost ? `${lost} gewählte ${what} nicht mehr gefunden` : undefined }
  } catch (error) {
    const message = messageOf(error)
    if (message === 'Geometrie-Operation fehlgeschlagen') {
      throw new Error(feature.kind === 'shell' ? 'Schale nicht möglich – Wandstärke zu groß?' : 'Nicht möglich – Wert zu groß für die gewählten Kanten?')
    }
    throw error
  } finally {
    for (const candidate of candidates) candidate.shape.delete()
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
      if (feature.kind === 'fillet' || feature.kind === 'chamfer' || feature.kind === 'shell') {
        const { bodies: next, missing } = modify(bodies, feature)
        bodies = next
        if (missing) problems.push({ index: feature.index, message: missing })
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
  const edgeGroups = edges.edgeGroups.map((group) => ({ start: group.start * 3, count: group.count * 3 }))
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
    edgeGroups,
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
  // OpenCascade throws plain numbers (pointers to Standard_Failure) or WASM exceptions
  if (typeof error === 'number') return 'Geometrie-Operation fehlgeschlagen'
  if (typeof WebAssembly !== 'undefined' && 'Exception' in WebAssembly && error instanceof (WebAssembly as unknown as { Exception: new () => object }).Exception) {
    return 'Geometrie-Operation fehlgeschlagen'
  }
  return String(error)
}
