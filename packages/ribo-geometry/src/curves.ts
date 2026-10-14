/**
 * Queries on single sketch curves: nearest point, intersections with others.
 */

import type { PlanCurve, Vec2 } from 'ribo-contracts/geometry'
import { intersect, onCurve, paramOf, pointAt, toCurve, type Curve } from './regions'

export { type Curve } from './regions'

const TWO_PI = Math.PI * 2

/** Closest point on a curve, with its parameter (line 0..1, circle angle, arc angle past start) */
export function closestPoint(planCurve: PlanCurve, p: Vec2): { point: Vec2; t: number; distance: number } | undefined {
  const curve = toCurve(planCurve)
  if (!curve) return undefined
  if (curve.kind === 'line') {
    const dx = curve.b[0] - curve.a[0]
    const dy = curve.b[1] - curve.a[1]
    const t = Math.min(1, Math.max(0, ((p[0] - curve.a[0]) * dx + (p[1] - curve.a[1]) * dy) / (dx * dx + dy * dy)))
    const point = pointAt(curve, t)
    return { point, t, distance: Math.hypot(point[0] - p[0], point[1] - p[1]) }
  }
  const angle = Math.atan2(p[1] - curve.c[1], p[0] - curve.c[0])
  let t = curve.kind === 'circle' ? (angle + TWO_PI) % TWO_PI : (((angle - curve.a0) % TWO_PI) + TWO_PI) % TWO_PI
  if (curve.kind === 'arc' && t > curve.sweep) {
    // Outside the arc: the nearer end
    const toStart = TWO_PI - t
    const toEnd = t - curve.sweep
    t = toStart < toEnd ? 0 : curve.sweep
  }
  const point = pointAt(curve, t)
  return { point, t, distance: Math.hypot(point[0] - p[0], point[1] - p[1]) }
}

/** Parameters along `planCurve` where the other curves cross or touch it, sorted */
export function crossings(planCurve: PlanCurve, others: PlanCurve[]): { t: number; point: Vec2; other: number }[] {
  const curve = toCurve(planCurve)
  if (!curve) return []
  const result: { t: number; point: Vec2; other: number }[] = []
  others.forEach((otherCurve, other) => {
    const o = toCurve(otherCurve)
    if (!o) return
    const points: Vec2[] = [...intersect(curve, o)]
    // Endpoints of the other curve lying on this one (T-junctions)
    if (o.kind === 'line') points.push(o.a, o.b)
    if (o.kind === 'arc') points.push(pointAt(o, 0), pointAt(o, o.sweep))
    for (const point of points) {
      if (!onCurve(curve, point) || !onCurve(o, point)) continue
      const t = paramOf(curve, point)
      if (t === undefined) continue
      if (!result.some((r) => Math.abs(r.t - t) < 1e-9)) result.push({ t, point, other })
    }
  })
  return result.sort((a, b) => a.t - b.t)
}

export function curvePoint(planCurve: PlanCurve, t: number): Vec2 | undefined {
  const curve = toCurve(planCurve)
  return curve ? pointAt(curve, t) : undefined
}

/** Parameter range of a curve: [0, 1] for lines, [0, 2π) for circles, [0, sweep] for arcs */
export function paramRange(planCurve: PlanCurve): [number, number] | undefined {
  const curve: Curve | undefined = toCurve(planCurve)
  if (!curve) return undefined
  if (curve.kind === 'line') return [0, 1]
  if (curve.kind === 'circle') return [0, TWO_PI]
  return [0, curve.sweep]
}
