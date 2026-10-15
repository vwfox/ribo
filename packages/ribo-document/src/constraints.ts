/**
 * Alignments as partial constraints, solved together.
 *
 * Unlike a joint, an alignment does not tie two frames together; each pair
 * of references takes away only what it says:
 *
 *   face   – face    the planes coincide (facing each other or flush), at a distance
 *   edge   – edge    the lines coincide, running the same way (or against, flipped)
 *   circle – circle  the axes coincide, the circles at a distance along it
 *   face   – edge    the edge lies in the plane
 *   face   – circle  the circle lies on the plane
 *   edge   – circle  the centre lies on the line
 *
 * What the alignments leave free comes from where the component sits on its
 * own, so several alignments on one component add up - a face on a face plus
 * an edge on an edge fix a part completely - and the free directions can be
 * moved by hand. The components are found by Levenberg-Marquardt from their
 * own placements.
 */

import type { Matrix, Vec3 } from 'ribo-contracts'
import { applyDirection, applyPoint, multiply, translation } from 'ribo-geometry'
import type { JointOrigin } from 'ribo-model'

type Kind = 'Face' | 'CircularEdge' | 'Edge'

/** A reference in its component's coordinates */
export interface Reference {
  component: number
  kind: Kind
  origin: Vec3
  z: Vec3
  x: Vec3
}

export interface Alignment {
  first: Reference
  second: Reference
  /** Faces: flush (same direction) instead of facing each other. Edges: running against each other */
  flush: boolean
  offset: number
}

export function referenceOf(origin: JointOrigin, component: number): Reference {
  return {
    component,
    kind: (origin.kind ?? 'Face') as Kind,
    origin: [origin.originX, origin.originY, origin.originZ],
    z: [origin.zX, origin.zY, origin.zZ],
    x: [origin.xX, origin.xY, origin.xZ],
  }
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(...a) || 1))
/** The part of v square to the unit direction d */
const across = (v: Vec3, d: Vec3) => sub(v, scale(d, dot(v, d)))

/** The direction a reference is about: the normal of a face, the axis of a circle, the run of an edge */
const directionOf = (r: { kind: Kind; z: Vec3; x: Vec3 }) => (r.kind === 'Edge' ? r.x : r.z)

/** Rotation by the rotation vector w (radians), as a matrix */
function rotationVector(w: Vec3): Matrix {
  const angle = Math.hypot(...w)
  if (angle < 1e-12) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const [x, y, z] = scale(w, 1 / angle)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0, t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0, t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0, 0, 0, 0, 1]
}

/** The smallest rotation turning unit a onto unit b, as a rotation vector */
function turning(a: Vec3, b: Vec3): Vec3 {
  const axis = cross(a, b)
  const sin = Math.hypot(...axis)
  const cos = dot(a, b)
  if (sin < 1e-9) {
    if (cos > 0) return [0, 0, 0]
    // Opposite: half a turn about any axis square to a
    const other: Vec3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    return scale(unit(cross(a, other)), Math.PI)
  }
  return scale(axis, Math.atan2(sin, cos) / sin)
}

/** Residuals of one alignment between two placed references (world coordinates) */
function residuals(a: Alignment, ma: Matrix, mb: Matrix): number[] {
  const pa = applyPoint(ma, a.first.origin)
  const pb = applyPoint(mb, a.second.origin)
  const da = unit(applyDirection(ma, directionOf(a.first)))
  const db = unit(applyDirection(mb, directionOf(a.second)))
  const kinds = [a.first.kind, a.second.kind].sort().join('-')
  const gap = sub(pb, pa)
  switch (kinds) {
    case 'Face-Face':
      // Facing: the normals oppose; flush: they agree
      return [...add(db, scale(da, a.flush ? -1 : 1)), dot(gap, da) - a.offset]
    case 'Edge-Edge':
      return [...sub(db, scale(da, a.flush ? -1 : 1)), ...across(gap, da)]
    case 'CircularEdge-CircularEdge':
      return [...cross(da, db), ...across(gap, da), dot(gap, da) - a.offset]
    case 'Edge-Face': {
      const [plane, point, line] = a.first.kind === 'Face' ? [da, pa, db] : [db, pb, da]
      const other = a.first.kind === 'Face' ? pb : pa
      return [dot(line, plane), dot(sub(other, point), plane) - a.offset]
    }
    case 'CircularEdge-Face': {
      const [plane, point, axis] = a.first.kind === 'Face' ? [da, pa, db] : [db, pb, da]
      const centre = a.first.kind === 'Face' ? pb : pa
      return [...cross(axis, plane), dot(sub(centre, point), plane) - a.offset]
    }
    case 'CircularEdge-Edge': {
      const [line, point, centre] = a.first.kind === 'Edge' ? [da, pa, pb] : [db, pb, pa]
      return across(sub(centre, point), line)
    }
    default:
      return []
  }
}

/** Distance (mm, or radians for directions) by which an alignment misses */
export function alignmentError(a: Alignment, ma: Matrix, mb: Matrix): number {
  return Math.max(0, ...residuals(a, ma, mb).map(Math.abs))
}

const TOLERANCE = 1e-4
const MAX_ITERATIONS = 100

/**
 * Places the free components so that the alignments hold, staying as close
 * to their own placements as the alignments allow.
 *
 * @param free component indexes to solve for
 * @param placements the known placements, and the own placements of the free ones
 * @returns the solved placements of the free components
 */
export function solveAlignments(alignments: Alignment[], free: number[], placements: Matrix[]): { placements: Map<number, Matrix>; freedom: Map<number, number> } {
  // Each free component moves by a rotation w about a pivot c, then a shift t: M = T(c + t) · R(w) · T(-c) · M0
  const pivots = new Map<number, Vec3>()
  const starts = new Map<number, Matrix>()
  for (const component of free) {
    const points = alignments.flatMap((a) => [a.first, a.second].filter((r) => r.component === component).map((r) => applyPoint(placements[component]!, r.origin)))
    pivots.set(component, points.length ? scale(points.reduce(add), 1 / points.length) : [0, 0, 0])
    starts.set(component, placements[component]!)
  }

  const placementOf = (component: number, x: number[]): Matrix => {
    const slot = free.indexOf(component)
    if (slot < 0) return placements[component]!
    const c = pivots.get(component)!
    const t: Vec3 = [x[slot * 6]!, x[slot * 6 + 1]!, x[slot * 6 + 2]!]
    const w: Vec3 = [x[slot * 6 + 3]!, x[slot * 6 + 4]!, x[slot * 6 + 5]!]
    return multiply(translation(add(c, t)), multiply(rotationVector(w), multiply(translation(scale(c, -1)), starts.get(component)!)))
  }

  // First turn each free component so its first direction-giving alignment is not stuck half a turn off
  for (const component of free) {
    for (const a of alignments) {
      const [own, other] = a.second.component === component ? [a.second, a.first] : a.first.component === component ? [a.first, a.second] : [undefined, undefined]
      if (!own || !other || own.kind !== other.kind || (free.includes(other.component) && other.component !== component)) continue
      const mine = unit(applyDirection(starts.get(component)!, directionOf(own)))
      const target = unit(applyDirection(placements[other.component]!, directionOf(other)))
      // Faces face each other unless flush, edges run alike unless flipped, axes are only lines
      const wanted =
        own.kind === 'Face' ? scale(target, a.flush ? 1 : -1) : own.kind === 'Edge' ? scale(target, a.flush ? -1 : 1) : dot(mine, target) < 0 ? scale(target, -1) : target
      const c = applyPoint(starts.get(component)!, own.origin)
      starts.set(component, multiply(translation(c), multiply(rotationVector(turning(mine, wanted)), multiply(translation(scale(c, -1)), starts.get(component)!))))
      pivots.set(component, c)
      break
    }
  }

  const residualsAt = (x: number[]) => alignments.flatMap((a) => residuals(a, placementOf(a.first.component, x), placementOf(a.second.component, x)))
  // A light pull back to the own placement keeps the free directions where they were; then a pass without it
  let x = new Array<number>(free.length * 6).fill(0)
  x = levenbergMarquardt((v) => [...residualsAt(v), ...v.map((u) => u * 1e-6)], x)
  x = levenbergMarquardt(residualsAt, x)
  // Degrees of freedom left per component: 6 minus the rank of its columns of the Jacobian
  const freedom = new Map<number, number>()
  const base = residualsAt(x)
  free.forEach((component, slot) => {
    const columns: number[][] = []
    for (let j = slot * 6; j < slot * 6 + 6; j++) {
      const step = [...x]
      step[j]! += 1e-6
      columns.push(residualsAt(step).map((v, i) => (v - base[i]!) / 1e-6))
    }
    freedom.set(component, 6 - rankOf(columns))
  })
  return { placements: new Map(free.map((component) => [component, placementOf(component, x)])), freedom }
}

/** Rank of a set of vectors, by elimination with a relative tolerance */
function rankOf(vectors: number[][]): number {
  const rows = vectors.map((v) => [...v])
  const scale = Math.max(1e-12, ...rows.flatMap((v) => v.map(Math.abs)))
  let rank = 0
  const length = rows[0]?.length ?? 0
  for (let col = 0; col < length && rank < rows.length; col++) {
    let pivot = rank
    for (let row = rank + 1; row < rows.length; row++) if (Math.abs(rows[row]![col]!) > Math.abs(rows[pivot]![col]!)) pivot = row
    if (Math.abs(rows[pivot]![col]!) < scale * 1e-6) continue
    ;[rows[rank], rows[pivot]] = [rows[pivot]!, rows[rank]!]
    for (let row = rank + 1; row < rows.length; row++) {
      const f = rows[row]![col]! / rows[rank]![col]!
      for (let k = col; k < length; k++) rows[row]![k]! -= f * rows[rank]![k]!
    }
    rank++
  }
  return rank
}

/** Least squares of the residuals, from x */
function levenbergMarquardt(objective: (x: number[]) => number[], start: number[]): number[] {
  let x = start
  let r = objective(x)
  let cost = r.reduce((s, v) => s + v * v, 0)
  let lambda = 1e-3
  const h = 1e-6
  for (let iteration = 0; iteration < MAX_ITERATIONS && cost > 1e-20; iteration++) {
    // Jacobian by central differences
    const n = x.length
    const columns: number[][] = []
    for (let j = 0; j < n; j++) {
      const up = [...x]
      const down = [...x]
      up[j]! += h
      down[j]! -= h
      const ru = objective(up)
      const rd = objective(down)
      columns.push(ru.map((v, i) => (v - rd[i]!) / (2 * h)))
    }
    // Normal equations (JᵀJ + λ·(diag + I)) δ = -Jᵀr; the I keeps directions no alignment touches still
    const a = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => columns[i]!.reduce((s, v, k) => s + v * columns[j]![k]!, 0)))
    const g = columns.map((column) => column.reduce((s, v, k) => s + v * r[k]!, 0))
    let improved = false
    for (let attempt = 0; attempt < 20 && !improved; attempt++) {
      const m = a.map((row, i) => row.map((v, j) => (i === j ? v + lambda * (v + 1) : v)))
      const delta = solveLinear(m, g.map((v) => -v))
      if (!delta) break
      const next = x.map((v, i) => v + delta[i]!)
      const rn = objective(next)
      const cn = rn.reduce((s, v) => s + v * v, 0)
      if (cn < cost) {
        x = next
        r = rn
        cost = cn
        lambda = Math.max(1e-12, lambda / 5)
        improved = true
      } else lambda *= 4
    }
    if (!improved) break
  }
  return x
}

/** Gaussian elimination with partial pivoting; undefined when singular */
function solveLinear(a: number[][], b: number[]): number[] | undefined {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]!])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row
    if (Math.abs(m[pivot]![col]!) < 1e-14) return undefined
    ;[m[col], m[pivot]] = [m[pivot]!, m[col]!]
    for (let row = col + 1; row < n; row++) {
      const f = m[row]![col]! / m[col]![col]!
      for (let k = col; k <= n; k++) m[row]![k]! -= f * m[col]![k]!
    }
  }
  const out = new Array<number>(n).fill(0)
  for (let row = n - 1; row >= 0; row--) {
    let s = m[row]![n]!
    for (let k = row + 1; k < n; k++) s -= m[row]![k]! * out[k]!
    out[row] = s / m[row]![row]!
  }
  return out
}

export { TOLERANCE as ALIGNMENT_TOLERANCE }
