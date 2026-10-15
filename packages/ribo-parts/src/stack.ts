/**
 * What a screw clamps: the material along its axis, found by casting lines
 * parallel to the hole axis through the placed bodies.
 */

import type { BodyMesh, Matrix, Vec3 } from 'ribo-contracts'
import { applyDirection, applyPoint, invert } from 'ribo-geometry'
import type { Stack } from './fastener'

/** A hole edge in world coordinates */
export interface HoleEdge {
  point: Vec3
  axis: Vec3
  radius: number
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(...a) || 1))

/** Clearance of the sampling lines from the hole wall, mm */
const BESIDE_HOLE_MM = 0.6
/** Material closer than this is one piece, mm */
const TOUCHING_MM = 0.05

interface Hit {
  t: number
  entering: boolean
}

/** Where a line p + t·a crosses the surface of the placed bodies */
function crossings(bodies: { mesh: BodyMesh; placement: Matrix }[], p: Vec3, a: Vec3): Hit[] {
  const hits: Hit[] = []
  for (const { mesh, placement } of bodies) {
    // Into body coordinates: the line, not every vertex, is transformed
    const inverse = invert(placement)
    const lp = applyPoint(inverse, p)
    const la = applyDirection(inverse, a)
    const v = mesh.vertices
    const tri = mesh.triangles
    for (let i = 0; i < tri.length; i += 3) {
      const i0 = tri[i]! * 3
      const i1 = tri[i + 1]! * 3
      const i2 = tri[i + 2]! * 3
      const v0: Vec3 = [v[i0]!, v[i0 + 1]!, v[i0 + 2]!]
      const e1: Vec3 = [v[i1]! - v0[0], v[i1 + 1]! - v0[1], v[i1 + 2]! - v0[2]]
      const e2: Vec3 = [v[i2]! - v0[0], v[i2 + 1]! - v0[1], v[i2 + 2]! - v0[2]]
      // Möller-Trumbore, both directions of the line
      const h = cross(la, e2)
      const det = dot(e1, h)
      if (Math.abs(det) < 1e-12) continue
      const s = sub(lp, v0)
      const u = dot(s, h) / det
      if (u < 0 || u > 1) continue
      const q = cross(s, e1)
      const w = dot(la, q) / det
      if (w < 0 || u + w > 1) continue
      const t = dot(e2, q) / det
      // Facing the line's direction: the line leaves the material there
      const normal = cross(e1, e2)
      hits.push({ t, entering: dot(normal, la) < 0 })
    }
  }
  return hits.sort((x, y) => x.t - y.t)
}

/** The stretches of material along the line, merged where they touch */
function segments(hits: Hit[]): [number, number][] {
  const out: [number, number][] = []
  let depth = 0
  let start = 0
  let last: Hit | undefined
  for (const hit of hits) {
    // A line through a mesh edge meets both neighbouring triangles
    if (last && Math.abs(hit.t - last.t) < 1e-7 && hit.entering === last.entering) continue
    last = hit
    if (hit.entering) {
      if (depth === 0) start = hit.t
      depth++
    } else if (depth > 0) {
      depth--
      if (depth === 0) {
        const previous = out.at(-1)
        if (previous && start - previous[1] < TOUCHING_MM) previous[1] = hit.t
        else out.push([start, hit.t])
      }
    }
  }
  return out
}

const distanceTo = ([from, to]: [number, number], t: number) => (t < from ? from - t : t > to ? t - to : 0)

/**
 * The stack a screw through the head-side part and the nut-side part clamps.
 * The hole edges are best picked where the parts touch; either part's
 * material is found along the axis on its own, so it does not matter which
 * way the axis points. Undefined when the lines beside the hole miss a part.
 */
export function stackBetween(
  headBodies: { mesh: BodyMesh; placement: Matrix }[],
  nutBodies: { mesh: BodyMesh; placement: Matrix }[],
  head: HoleEdge,
  nut: HoleEdge,
): Stack | undefined {
  const axis = unit(head.axis)
  const tNut = dot(sub(nut.point, head.point), axis)
  const side = unit(Math.abs(axis[0]) < 0.9 ? cross(axis, [1, 0, 0]) : cross(axis, [0, 1, 0]))
  const other = cross(axis, side)
  // Beside the wider of the two holes, so neither side's lines run down a hole
  const widest = Math.max(head.radius, nut.radius)
  const off = widest > 0 ? widest + BESIDE_HOLE_MM : 0
  let best: Stack | undefined
  for (const direction of off ? [side, scale(side, -1), other, scale(other, -1)] : [[0, 0, 0] as Vec3]) {
    const from = add(head.point, scale(direction, off))
    const headRuns = segments(crossings(headBodies, from, axis))
    const nutRuns = segments(crossings(nutBodies, from, axis))
    if (!headRuns.length || !nutRuns.length) continue
    const nearest = (runs: [number, number][], t: number) => runs.reduce((a, b) => (distanceTo(b, t) < distanceTo(a, t) ? b : a))
    const headRun = nearest(headRuns, 0)
    const nutRun = nearest(nutRuns, tNut)
    if (distanceTo(headRun, 0) > 1 || distanceTo(nutRun, tNut) > 1) continue
    const overlap = Math.min(headRun[1], nutRun[1]) - Math.max(headRun[0], nutRun[0])
    // The head sits on the far side of its part from the nut's part
    const towardsNut = (nutRun[0] + nutRun[1]) / 2 >= (headRun[0] + headRun[1]) / 2 ? 1 : -1
    const seatAt = towardsNut > 0 ? Math.min(headRun[0], nutRun[0]) : Math.max(headRun[1], nutRun[1])
    const stack: Stack = {
      seat: add(head.point, scale(axis, seatAt)),
      direction: scale(axis, towardsNut),
      grip: Math.max(headRun[1], nutRun[1]) - Math.min(headRun[0], nutRun[0]),
      headPart: headRun[1] - headRun[0],
      hole: head.radius > 0 ? head.radius * 2 : undefined,
      nutHole: nut.radius > 0 ? nut.radius * 2 : undefined,
      overlap: overlap > TOUCHING_MM ? overlap : undefined,
    }
    // Beside the hole may lie a slot or an edge: the fullest line counts
    if (!best || stack.grip > best.grip) best = stack
  }
  return best
}

/**
 * How deep material reaches into the cylinder of the given radius around the
 * axis, between `from` and `to` along it (mm from `point`); 0 when it is free.
 */
export function materialIn(bodies: { mesh: BodyMesh; placement: Matrix }[], point: Vec3, axis: Vec3, radius: number, from: number, to: number): number {
  const a = unit(axis)
  const side = unit(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]))
  const other = cross(a, side)
  let deepest = 0
  // The rim and half way in, all round
  for (const r of [radius * 0.95, radius * 0.5]) {
    for (let k = 0; k < 8; k++) {
      const angle = (k * Math.PI) / 4
      const from3 = add(point, add(scale(side, Math.cos(angle) * r), scale(other, Math.sin(angle) * r)))
      for (const [start, end] of segments(crossings(bodies, from3, a))) {
        const inside = Math.min(end, to) - Math.max(start, from)
        if (inside > deepest) deepest = inside
      }
    }
  }
  return deepest > TOUCHING_MM ? deepest : 0
}
