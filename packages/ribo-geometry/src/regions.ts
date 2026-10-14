/**
 * Profile detection: the closed regions a set of sketch curves encloses.
 *
 * The curves are split at every intersection into edges of a planar graph.
 * Dangling edges are dropped, and walking the graph with "always take the
 * next edge clockwise" traces every face once: bounded faces come out
 * counter-clockwise (positive area), the outside of each connected component
 * clockwise. Those outsides become the holes of the smallest face around them.
 */

import type { LoopSegment, PlanCurve, PlanRegion, Vec2 } from 'ribo-contracts/geometry'

const EPS = 1e-7
const TWO_PI = Math.PI * 2
/** Arc sampling for outlines: segments per full turn */
const SAMPLES_PER_TURN = 72

// ----------------------------------------------------------------- curves

export type Curve =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'circle'; c: Vec2; r: number }
  /** Counter-clockwise from angle a0 over sweep */
  | { kind: 'arc'; c: Vec2; r: number; a0: number; sweep: number }

const normAngle = (a: number) => ((a % TWO_PI) + TWO_PI) % TWO_PI

export function toCurve(curve: PlanCurve): Curve | undefined {
  switch (curve.kind) {
    case 'line':
      return dist(curve.from, curve.to) < EPS ? undefined : { kind: 'line', a: curve.from, b: curve.to }
    case 'circle':
      return curve.radius < EPS ? undefined : { kind: 'circle', c: curve.center, r: curve.radius }
    case 'arc': {
      const r = dist(curve.center, curve.from)
      if (r < EPS) return undefined
      const a0 = angleOf(curve.center, curve.from)
      const a1 = angleOf(curve.center, curve.to)
      let sweep = normAngle(a1 - a0)
      if (sweep < EPS) sweep = TWO_PI
      return { kind: 'arc', c: curve.center, r, a0, sweep }
    }
  }
}

const dist = (p: Vec2, q: Vec2) => Math.hypot(q[0] - p[0], q[1] - p[1])
const angleOf = (c: Vec2, p: Vec2) => Math.atan2(p[1] - c[1], p[0] - c[0])
const onCircle = (c: Vec2, r: number, a: number): Vec2 => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]

/** Parameter range: line [0,1], circle [0,2π), arc [0,sweep] (angle past a0) */
export function pointAt(curve: Curve, t: number): Vec2 {
  if (curve.kind === 'line') return [curve.a[0] + (curve.b[0] - curve.a[0]) * t, curve.a[1] + (curve.b[1] - curve.a[1]) * t]
  if (curve.kind === 'circle') return onCircle(curve.c, curve.r, t)
  return onCircle(curve.c, curve.r, curve.a0 + t)
}

/** Parameter of a point known to lie on the curve, or undefined when outside its range */
export function paramOf(curve: Curve, p: Vec2): number | undefined {
  if (curve.kind === 'line') {
    const dx = curve.b[0] - curve.a[0]
    const dy = curve.b[1] - curve.a[1]
    const t = ((p[0] - curve.a[0]) * dx + (p[1] - curve.a[1]) * dy) / (dx * dx + dy * dy)
    const tol = EPS / Math.hypot(dx, dy)
    if (t < -tol || t > 1 + tol) return undefined
    return Math.min(1, Math.max(0, t))
  }
  const a = angleOf(curve.c, p)
  if (curve.kind === 'circle') return normAngle(a)
  let t = normAngle(a - curve.a0)
  const tol = EPS / curve.r
  if (t > TWO_PI - tol) t = 0
  if (t > curve.sweep + tol) return undefined
  return Math.min(curve.sweep, t)
}

function lineLine(p: Curve & { kind: 'line' }, q: Curve & { kind: 'line' }): Vec2[] {
  const r: Vec2 = [p.b[0] - p.a[0], p.b[1] - p.a[1]]
  const s: Vec2 = [q.b[0] - q.a[0], q.b[1] - q.a[1]]
  const denom = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(denom) < 1e-12) {
    // Parallel. Collinear overlaps only meet at shared endpoints
    return [p.a, p.b, q.a, q.b].filter((point) => onCurve(p, point) && onCurve(q, point))
  }
  const qp: Vec2 = [q.a[0] - p.a[0], q.a[1] - p.a[1]]
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denom
  const u = (qp[0] * r[1] - qp[1] * r[0]) / denom
  const tolT = EPS / Math.hypot(...r)
  const tolU = EPS / Math.hypot(...s)
  if (t < -tolT || t > 1 + tolT || u < -tolU || u > 1 + tolU) return []
  return [pointAt(p, Math.min(1, Math.max(0, t)))]
}

function lineCircle(line: Curve & { kind: 'line' }, c: Vec2, r: number): Vec2[] {
  const d: Vec2 = [line.b[0] - line.a[0], line.b[1] - line.a[1]]
  const f: Vec2 = [line.a[0] - c[0], line.a[1] - c[1]]
  const a = d[0] * d[0] + d[1] * d[1]
  const b = 2 * (f[0] * d[0] + f[1] * d[1])
  const k = f[0] * f[0] + f[1] * f[1] - r * r
  let disc = b * b - 4 * a * k
  // Tangent contact
  if (disc < 0 && disc > -1e-9 * a * r * r) disc = 0
  if (disc < 0) return []
  const root = Math.sqrt(disc)
  const ts = disc === 0 ? [-b / (2 * a)] : [(-b - root) / (2 * a), (-b + root) / (2 * a)]
  return ts.map((t) => pointAt(line, t))
}

function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = dist(c1, c2)
  if (d < EPS || d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS) return []
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a))
  const m: Vec2 = [c1[0] + (a * (c2[0] - c1[0])) / d, c1[1] + (a * (c2[1] - c1[1])) / d]
  if (h < EPS) return [m]
  const ox = (h * (c2[1] - c1[1])) / d
  const oy = (h * (c2[0] - c1[0])) / d
  return [
    [m[0] + ox, m[1] - oy],
    [m[0] - ox, m[1] + oy],
  ]
}

/** Intersection points of two curves, restricted to both curves' ranges */
export function intersect(p: Curve, q: Curve): Vec2[] {
  let candidates: Vec2[]
  if (p.kind === 'line' && q.kind === 'line') return lineLine(p, q)
  if (p.kind === 'line') candidates = lineCircle(p, (q as { c: Vec2 }).c, (q as { r: number }).r)
  else if (q.kind === 'line') candidates = lineCircle(q, p.c, p.r)
  else candidates = circleCircle(p.c, p.r, q.c, q.r)
  // Arc endpoints touching the other curve are found by the endpoint pass in splitParams
  return candidates.filter((point) => paramOf(p, point) !== undefined && paramOf(q, point) !== undefined)
}

function endpoints(curve: Curve): Vec2[] {
  if (curve.kind === 'line') return [curve.a, curve.b]
  if (curve.kind === 'arc') return [pointAt(curve, 0), pointAt(curve, curve.sweep)]
  return []
}

// ------------------------------------------------------------------ graph

interface Edge {
  curve: Curve
  t0: number
  t1: number
  from: number
  to: number
}

interface HalfEdge {
  edge: Edge
  /** Travels from t0 to t1 */
  forward: boolean
  from: number
  to: number
  angle: number
  twin?: HalfEdge
  next?: HalfEdge
  visited: boolean
}

class VertexIndex {
  readonly points: Vec2[] = []
  private readonly keys = new Map<string, number>()

  id(p: Vec2): number {
    const scale = 1e5
    const kx = Math.round(p[0] * scale)
    const ky = Math.round(p[1] * scale)
    // Look in the neighbouring cells too, so rounding never separates equal points
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const hit = this.keys.get(`${kx + dx},${ky + dy}`)
        if (hit !== undefined && dist(this.points[hit]!, p) < 2 / scale) return hit
      }
    }
    const id = this.points.length
    this.points.push(p)
    this.keys.set(`${kx},${ky}`, id)
    return id
  }
}

function splitParams(curves: Curve[]): number[][] {
  const params = curves.map((curve) => (curve.kind === 'line' ? [0, 1] : curve.kind === 'arc' ? [0, curve.sweep] : []))
  const add = (i: number, p: Vec2) => {
    const t = paramOf(curves[i]!, p)
    if (t !== undefined) params[i]!.push(t)
  }
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      for (const p of intersect(curves[i]!, curves[j]!)) {
        add(i, p)
        add(j, p)
      }
      // T-junctions: an endpoint lying on the other curve
      for (const p of endpoints(curves[i]!)) if (paramOf(curves[j]!, p) !== undefined && onCurve(curves[j]!, p)) add(j, p)
      for (const p of endpoints(curves[j]!)) if (paramOf(curves[i]!, p) !== undefined && onCurve(curves[i]!, p)) add(i, p)
    }
  }
  return params.map((list, i) => {
    const curve = curves[i]!
    const tol = curve.kind === 'line' ? EPS / dist(curve.a, curve.b) : EPS / curve.r
    const sorted = [...list].sort((a, b) => a - b)
    return sorted.filter((t, k) => k === 0 || t - sorted[k - 1]! > tol)
  })
}

export function onCurve(curve: Curve, p: Vec2): boolean {
  if (curve.kind === 'line') {
    const t = paramOf(curve, p)
    return t !== undefined && dist(pointAt(curve, t), p) < 1e-6
  }
  return Math.abs(dist(curve.c, p) - curve.r) < 1e-6
}

function departureAngle(curve: Curve, t0: number, t1: number, from: Vec2): number {
  // Chord to a point just along the edge: the tangent, nudged by the curvature,
  // so a line and an arc leaving tangentially still sort apart
  const p = pointAt(curve, t0 + (t1 - t0) * 1e-4)
  return Math.atan2(p[1] - from[1], p[0] - from[0])
}

// ---------------------------------------------------------------- loops

interface Loop {
  segments: LoopSegment[]
  polygon: Vec2[]
  area: number
  component: number
}

function sampleEdge(edge: Edge, forward: boolean): Vec2[] {
  const { curve } = edge
  const [ta, tb] = forward ? [edge.t0, edge.t1] : [edge.t1, edge.t0]
  if (curve.kind === 'line') return [pointAt(curve, ta)]
  const n = Math.max(2, Math.ceil((Math.abs(tb - ta) / TWO_PI) * SAMPLES_PER_TURN))
  return [...Array(n).keys()].map((i) => pointAt(curve, ta + ((tb - ta) * i) / n))
}

function segmentOf(half: HalfEdge, points: Vec2[]): LoopSegment {
  const { curve } = half.edge
  const from = points[half.from]!
  const to = points[half.to]!
  if (curve.kind === 'line') return { kind: 'line', from, to }
  // Edges of arcs and of split circles run counter-clockwise in parameter order
  return { kind: 'arc', from, to, center: curve.c, radius: curve.r, ccw: half.forward }
}

const signedArea = (polygon: Vec2[]) => {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x1, y1] = polygon[i]!
    const [x2, y2] = polygon[(i + 1) % polygon.length]!
    sum += x1 * y2 - x2 * y1
  }
  return sum / 2
}

export function pointInPolygon(p: Vec2, polygon: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!
    const [xj, yj] = polygon[j]!
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** A point well inside a polygon with holes: middle of the widest horizontal span */
function interiorPoint(outer: Vec2[], holes: Vec2[][]): Vec2 {
  const ys = outer.map((p) => p[1])
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const height = maxY - minY
  let best: { x: number; y: number; width: number } | undefined
  for (const f of [0.5, 0.3, 0.7, 0.4, 0.6, 0.2, 0.8, 0.1, 0.9]) {
    const y = minY + height * f + height * 1.234e-6
    const xs: number[] = []
    for (const polygon of [outer, ...holes]) {
      for (let i = 0; i < polygon.length; i++) {
        const [x1, y1] = polygon[i]!
        const [x2, y2] = polygon[(i + 1) % polygon.length]!
        if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1))
      }
    }
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const width = xs[i + 1]! - xs[i]!
      if (!best || width > best.width) best = { x: (xs[i]! + xs[i + 1]!) / 2, y, width }
    }
  }
  return best ? [best.x, best.y] : outer[0]!
}

// ------------------------------------------------------------------- main

/** The closed regions formed by the given (non-construction) curves. */
export function findRegions(planCurves: PlanCurve[]): PlanRegion[] {
  const curves = planCurves.map(toCurve).filter((c): c is Curve => c !== undefined)
  const params = splitParams(curves)
  const vertices = new VertexIndex()
  const edges: Edge[] = []
  const loops: Loop[] = []
  let nextComponent = 0

  curves.forEach((curve, i) => {
    const ts = params[i]!
    if (curve.kind === 'circle' && ts.length === 0) {
      // A free circle is a loop on its own: inside counter-clockwise, outside clockwise
      const component = nextComponent++
      const polygon = [...Array(SAMPLES_PER_TURN).keys()].map((k) => pointAt(curve, (TWO_PI * k) / SAMPLES_PER_TURN))
      const segment: LoopSegment = { kind: 'circle', center: curve.c, radius: curve.r }
      loops.push({ segments: [segment], polygon, area: signedArea(polygon), component })
      loops.push({ segments: [segment], polygon: [...polygon].reverse(), area: -signedArea(polygon), component })
      return
    }
    const cuts = curve.kind === 'circle' ? [...ts, ts[0]! + TWO_PI] : ts
    for (let k = 0; k + 1 < cuts.length; k++) {
      const t0 = cuts[k]!
      const t1 = cuts[k + 1]!
      const from = vertices.id(pointAt(curve, t0))
      const to = vertices.id(pointAt(curve, t1))
      if (from === to && curve.kind === 'line') continue
      edges.push({ curve, t0, t1, from, to })
    }
  })

  // Drop dangling edges until every vertex has at least two edges
  let alive = edges
  for (;;) {
    const degree = new Map<number, number>()
    for (const e of alive) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
    }
    const kept = alive.filter((e) => (degree.get(e.from) ?? 0) > 1 && (degree.get(e.to) ?? 0) > 1)
    if (kept.length === alive.length) break
    alive = kept
  }

  // Connected components of the graph
  const parent = new Map<number, number>()
  const find = (v: number): number => {
    const p = parent.get(v) ?? v
    if (p === v) return v
    const root = find(p)
    parent.set(v, root)
    return root
  }
  for (const e of alive) parent.set(find(e.from), find(e.to))
  const componentOf = new Map<number, number>()
  const component = (v: number) => {
    const root = find(v)
    if (!componentOf.has(root)) componentOf.set(root, nextComponent++)
    return componentOf.get(root)!
  }

  // Half-edges, sorted counter-clockwise around each vertex
  const points = vertices.points
  const outgoing = new Map<number, HalfEdge[]>()
  for (const edge of alive) {
    const forward: HalfEdge = {
      edge,
      forward: true,
      from: edge.from,
      to: edge.to,
      angle: departureAngle(edge.curve, edge.t0, edge.t1, points[edge.from]!),
      visited: false,
    }
    const backward: HalfEdge = {
      edge,
      forward: false,
      from: edge.to,
      to: edge.from,
      angle: departureAngle(edge.curve, edge.t1, edge.t0, points[edge.to]!),
      visited: false,
    }
    forward.twin = backward
    backward.twin = forward
    for (const half of [forward, backward]) {
      if (!outgoing.has(half.from)) outgoing.set(half.from, [])
      outgoing.get(half.from)!.push(half)
    }
  }
  for (const list of outgoing.values()) list.sort((a, b) => a.angle - b.angle)
  for (const list of outgoing.values()) {
    for (const half of list) {
      // Arriving at v over `half`, leave by the edge just clockwise of the way back
      const around = outgoing.get(half.to)!
      const back = around.indexOf(half.twin!)
      half.next = around[(back - 1 + around.length) % around.length]
    }
  }

  for (const list of outgoing.values()) {
    for (const start of list) {
      if (start.visited) continue
      const segments: LoopSegment[] = []
      const polygon: Vec2[] = []
      let half: HalfEdge | undefined = start
      let guard = 0
      while (half && !half.visited && guard++ < 100000) {
        half.visited = true
        segments.push(segmentOf(half, points))
        polygon.push(...sampleEdge(half.edge, half.forward))
        half = half.next
      }
      if (half !== start || polygon.length < 2) continue
      loops.push({ segments, polygon, area: signedArea(polygon), component: component(start.from) })
    }
  }

  const faces = loops.filter((l) => l.area > EPS)
  const outsides = loops.filter((l) => l.area < -EPS)

  const holesOf = new Map<Loop, Loop[]>(faces.map((f) => [f, []]))
  for (const outside of outsides) {
    // The smallest face of another component around this component
    const probe = outside.polygon[0]!
    let owner: Loop | undefined
    for (const face of faces) {
      if (face.component === outside.component) continue
      if (!pointInPolygon(probe, face.polygon)) continue
      if (!owner || face.area < owner.area) owner = face
    }
    if (owner) holesOf.get(owner)!.push(outside)
  }

  const regions: PlanRegion[] = faces.map((face) => {
    const holes = holesOf.get(face)!
    const holeOutlines = holes.map((h) => h.polygon)
    return {
      outer: face.segments,
      holes: holes.map((h) => h.segments),
      outline: face.polygon,
      holeOutlines,
      area: face.area + holes.reduce((sum, h) => sum + h.area, 0),
      inside: interiorPoint(face.polygon, holeOutlines),
      depth: 0,
    }
  })
  for (const region of regions) {
    region.depth = regions.filter((other) => other !== region && pointInPolygon(region.inside, other.outline)).length
  }
  return regions
}

/** Index of the region containing a point, or -1 */
export function regionAt(regions: PlanRegion[], p: Vec2): number {
  let best = -1
  regions.forEach((region, i) => {
    if (!pointInPolygon(p, region.outline)) return
    if (region.holeOutlines.some((hole) => pointInPolygon(p, hole))) return
    if (best < 0 || region.area < regions[best]!.area) best = i
  })
  return best
}
