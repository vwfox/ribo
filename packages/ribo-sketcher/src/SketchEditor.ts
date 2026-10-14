/**
 * Geometry of the open sketch: reading it as plain curves, hit-testing,
 * snapping, and creating points, curves, constraints and dimensions.
 */

import type { EObject } from '@emfts/core'
import type { DocumentService, Notifier, PlanCurve, Vec2 } from 'ribo-contracts'
import { closestPoint } from 'ribo-geometry'
import {
  ConstraintKind,
  DimensionKind,
  RiboFactory,
  isArc,
  isCircle,
  isDimension,
  isGeometricConstraint,
  isLine,
  pointsOf,
  type Dimension,
  type GeometricConstraint,
  type Sketch,
  type SketchArc,
  type SketchCircle,
  type SketchConstraint,
  type SketchCurve,
  type SketchLine,
  type SketchPoint,
} from 'ribo-model'

export const dist = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1])
export const pos = (p: SketchPoint): Vec2 => [p.x, p.y]

/** Where a pointer position lands: on an existing point, a midpoint, a curve, or free */
export type Snap =
  | { kind: 'point'; point: SketchPoint; at: Vec2 }
  | { kind: 'midpoint'; line: SketchLine; at: Vec2 }
  | { kind: 'curve'; curve: SketchCurve; at: Vec2 }
  | { kind: 'free'; at: Vec2 }

export function planCurve(curve: SketchCurve): PlanCurve | undefined {
  const construction = curve.construction ?? false
  if (isLine(curve) && curve.start && curve.end) return { kind: 'line', from: pos(curve.start), to: pos(curve.end), construction }
  if (isCircle(curve) && curve.center) return { kind: 'circle', center: pos(curve.center), radius: curve.radius, construction }
  if (isArc(curve) && curve.center && curve.start && curve.end) {
    return { kind: 'arc', center: pos(curve.center), radius: dist(pos(curve.center), pos(curve.start)), from: pos(curve.start), to: pos(curve.end), construction }
  }
  return undefined
}

export function midpoint(line: SketchLine): Vec2 {
  return [(line.start.x + line.end.x) / 2, (line.start.y + line.end.y) / 2]
}

export class SketchEditor {
  readonly factory = RiboFactory.eINSTANCE

  constructor(
    readonly sketch: Sketch,
    readonly document: DocumentService,
    private readonly notifier: Notifier,
  ) {}

  // ---------------------------------------------------------------- query

  points(): SketchPoint[] {
    return this.sketch.points.toArray()
  }

  curves(): SketchCurve[] {
    return this.sketch.curves.toArray()
  }

  /** Nearest point within the tolerance (mm), optionally skipping some */
  pointAt(p: Vec2, tolerance: number, skip: Set<SketchPoint> = new Set()): SketchPoint | undefined {
    let best: SketchPoint | undefined
    let bestDistance = tolerance
    for (const point of this.points()) {
      if (skip.has(point)) continue
      const d = dist(pos(point), p)
      if (d <= bestDistance) {
        best = point
        bestDistance = d
      }
    }
    return best
  }

  curveAt(p: Vec2, tolerance: number, skip: Set<SketchCurve> = new Set()): { curve: SketchCurve; at: Vec2; t: number } | undefined {
    let best: { curve: SketchCurve; at: Vec2; t: number } | undefined
    let bestDistance = tolerance
    for (const curve of this.curves()) {
      if (skip.has(curve)) continue
      const plan = planCurve(curve)
      const hit = plan && closestPoint(plan, p)
      if (hit && hit.distance <= bestDistance) {
        best = { curve, at: hit.point, t: hit.t }
        bestDistance = hit.distance
      }
    }
    return best
  }

  /** Snap target for drawing. Points win over midpoints, midpoints over curves. */
  snap(p: Vec2, tolerance: number, skip: Set<SketchPoint> = new Set()): Snap {
    const point = this.pointAt(p, tolerance, skip)
    if (point) return { kind: 'point', point, at: pos(point) }
    for (const curve of this.curves()) {
      if (!isLine(curve) || !curve.start || !curve.end) continue
      if (skip.has(curve.start) && skip.has(curve.end)) continue
      const m = midpoint(curve)
      if (dist(m, p) <= tolerance) return { kind: 'midpoint', line: curve, at: m }
    }
    const curves = new Set(this.curves().filter((c) => pointsOf(c).some((q) => skip.has(q))))
    const onCurve = this.curveAt(p, tolerance * 0.8, curves)
    if (onCurve) return { kind: 'curve', curve: onCurve.curve, at: onCurve.at }
    return { kind: 'free', at: p }
  }

  // --------------------------------------------------------------- create

  point(at: Vec2): SketchPoint {
    const point = this.factory.createSketchPoint()
    point.x = at[0]
    point.y = at[1]
    this.sketch.points.add(point)
    return point
  }

  /** The point a snap stands for: the snapped one, or a new one tied to what it snapped to */
  resolve(snap: Snap): SketchPoint {
    if (snap.kind === 'point') return snap.point
    const point = this.point(snap.at)
    if (snap.kind === 'midpoint') this.constraint(ConstraintKind.Midpoint, [point], [snap.line])
    if (snap.kind === 'curve') this.constraint(ConstraintKind.Coincident, [point], [snap.curve])
    return point
  }

  line(start: SketchPoint, end: SketchPoint, construction = false): SketchLine {
    const line = this.factory.createSketchLine()
    line.start = start
    line.end = end
    line.construction = construction
    this.sketch.curves.add(line)
    return line
  }

  circle(center: SketchPoint, radius: number, construction = false): SketchCircle {
    const circle = this.factory.createSketchCircle()
    circle.center = center
    circle.radius = radius
    circle.construction = construction
    this.sketch.curves.add(circle)
    return circle
  }

  /** Counter-clockwise from start to end */
  arc(center: SketchPoint, start: SketchPoint, end: SketchPoint): SketchArc {
    const arc = this.factory.createSketchArc()
    arc.center = center
    arc.start = start
    arc.end = end
    this.sketch.curves.add(arc)
    return arc
  }

  constraint(kind: ConstraintKind, points: SketchPoint[], curves: SketchCurve[]): GeometricConstraint {
    const constraint = this.factory.createGeometricConstraint()
    constraint.kind = kind
    points.forEach((p) => constraint.points.add(p))
    curves.forEach((c) => constraint.curves.add(c))
    this.sketch.constraints.add(constraint)
    return constraint
  }

  dimension(kind: DimensionKind, points: SketchPoint[], curves: SketchCurve[], expression: string, label: Vec2): Dimension {
    const dimension = this.factory.createDimension()
    dimension.kind = kind
    dimension.expression = expression
    dimension.labelX = label[0]
    dimension.labelY = label[1]
    points.forEach((p) => dimension.points.add(p))
    curves.forEach((c) => dimension.curves.add(c))
    this.sketch.constraints.add(dimension)
    return dimension
  }

  /**
   * Adds a constraint and solves. If the sketch becomes over-constrained the
   * constraint is taken out again and false returned.
   */
  tryAdd(add: () => SketchConstraint, message = 'Diese Abhängigkeit widerspricht vorhandenen Abhängigkeiten'): boolean {
    const constraint = add()
    const outcome = this.document.solveSketch(this.sketch)
    if (outcome && (!outcome.ok || outcome.conflicting.includes(constraint) || outcome.invalid.includes(constraint))) {
      this.sketch.constraints.remove(constraint)
      this.document.solveSketch(this.sketch)
      if (message) this.notifier.error(outcome.invalid.includes(constraint) ? 'Der Wert ist ungültig' : message)
      return false
    }
    return true
  }

  /** Adds a horizontal or vertical constraint when a line is drawn nearly so */
  inferAxis(line: SketchLine, toleranceDegrees = 2): void {
    const dx = line.end.x - line.start.x
    const dy = line.end.y - line.start.y
    const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI)
    const horizontal = angle < toleranceDegrees || angle > 180 - toleranceDegrees
    const vertical = Math.abs(angle - 90) < toleranceDegrees
    if (!horizontal && !vertical) return
    // Both ends already pinned (e.g. snapped): adding it could over-constrain, so test
    this.tryAdd(() => this.constraint(horizontal ? ConstraintKind.Horizontal : ConstraintKind.Vertical, [], [line]), '')
  }

  /**
   * Copies curves through a point transform. Points shared between the copied
   * curves stay shared; `keep` can map a point to itself (e.g. one lying on a
   * mirror line). A mirroring transform reverses arcs, so their start and end swap.
   */
  copy(
    curves: SketchCurve[],
    transform: (p: Vec2) => Vec2,
    mirrors = false,
    keep: (p: SketchPoint) => boolean = () => false,
  ): { points: Map<SketchPoint, SketchPoint>; curves: SketchCurve[] } {
    const points = new Map<SketchPoint, SketchPoint>()
    const map = (p: SketchPoint) => {
      if (keep(p)) return p
      let copy = points.get(p)
      if (!copy) {
        copy = this.point(transform(pos(p)))
        points.set(p, copy)
      }
      return copy
    }
    const copies: SketchCurve[] = []
    for (const curve of curves) {
      let copy: SketchCurve | undefined
      if (isLine(curve)) copy = this.line(map(curve.start), map(curve.end), curve.construction)
      else if (isCircle(curve)) copy = this.circle(map(curve.center), curve.radius, curve.construction)
      else if (isArc(curve)) {
        copy = mirrors ? this.arc(map(curve.center), map(curve.end), map(curve.start)) : this.arc(map(curve.center), map(curve.start), map(curve.end))
        copy.construction = curve.construction
      }
      if (copy) copies.push(copy)
    }
    return { points, curves: copies }
  }

  /**
   * The curves connected to one through shared end points, in chain order,
   * with each curve's direction of travel. Circles stand alone.
   */
  chain(start: SketchCurve): { curve: SketchCurve; forward: boolean }[] {
    if (!isLine(start) && !isArc(start)) return [{ curve: start, forward: true }]
    const ends = (c: SketchCurve): [SketchPoint, SketchPoint] | undefined =>
      isLine(c) ? [c.start, c.end] : isArc(c) ? [c.start, c.end] : undefined
    const candidates = this.curves().filter((c) => (isLine(c) || isArc(c)) && !c.construction === !start.construction)
    const used = new Set<SketchCurve>([start])
    const next = (point: SketchPoint) => {
      const at = candidates.filter((c) => !used.has(c) && ends(c)!.includes(point))
      // A branch point ends the chain: which way to go would be a guess
      return at.length === 1 ? at[0] : undefined
    }
    const result: { curve: SketchCurve; forward: boolean }[] = [{ curve: start, forward: true }]
    // Walk forward from the end, then backward from the start
    let point = ends(start)![1]
    for (let c = next(point); c; c = next(point)) {
      used.add(c)
      const [a, b] = ends(c)!
      result.push({ curve: c, forward: a === point })
      point = a === point ? b : a
    }
    point = ends(start)![0]
    for (let c = next(point); c; c = next(point)) {
      used.add(c)
      const [a, b] = ends(c)!
      result.unshift({ curve: c, forward: b === point })
      point = b === point ? a : b
    }
    return result
  }

  /** Removes a point if no curve and no constraint uses it any more */
  dropIfUnused(point: SketchPoint): void {
    if (point.origin) return
    if (this.curves().some((c) => pointsOf(c).includes(point))) return
    if (this.sketch.constraints.toArray().some((c) => c.points.contains(point))) return
    this.sketch.points.remove(point)
  }

  /** Existing Fix constraint on an object, if any */
  fixOf(object: SketchPoint | SketchCurve): GeometricConstraint | undefined {
    return this.sketch.constraints
      .toArray()
      .find(
        (c): c is GeometricConstraint =>
          isGeometricConstraint(c) && c.kind === ConstraintKind.Fix && ((c.points.contains(object as SketchPoint) as boolean) || c.curves.contains(object as SketchCurve)),
      )
  }

  isDimension(object: EObject | undefined): object is Dimension {
    return isDimension(object)
  }
}
